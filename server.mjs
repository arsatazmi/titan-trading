import http from 'node:http';
import { remoteEnabled, withRemoteState } from './lib/store.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  getDb, load, save, resetDemo, getSecret, hashPassword, verifyPassword, id, now, addDays,
  logEvent, publicUser, findUserByEmail, findUserById, findPlan, accountsForUser,
  paymentsForUser, isSubscriptionActive, stopAccount, tickSimulation
} from './lib/store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const COOKIE = 'tt_session';
const SESSION_DAYS = 7;
const MAX_BODY = 100_000;
const DEMO_NOTICE = 'Mode demo: tidak ada trading nyata, tidak ada pembayaran nyata, dan jangan masukkan password broker asli.';
// Experimental DEMO only. BTC requires protocol-4; local opt-in, fresh quote
// and short lease are all required; broker execution is not guaranteed.
const PILOT_DEMO_ENABLED = true;
const PAYMENT_METHODS = [
  { id: 'bank_demo', label: 'Transfer Bank Demo', instruction: 'Rekening demo: 0000-0000-0000 a.n. TitanTrading Demo. Jangan transfer uang nyata.' },
  { id: 'qris_demo', label: 'QRIS Demo', instruction: 'QRIS demo: TT-DEMO-QRIS. Jangan scan atau bayar di dunia nyata.' },
  { id: 'ewallet_demo', label: 'E-Wallet Demo', instruction: 'Nomor demo: 0800-0000-0000. Jangan kirim saldo nyata.' },
  { id: 'usdt_demo', label: 'USDT Demo', instruction: 'Alamat demo: TT-DEMO-USDT-000. Jangan kirim aset kripto nyata.' }
];
const loginAttempts = new Map();

load();
getSecret();

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function send(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(body);
}

function fail(res, status, message, code = 'error') {
  send(res, status, { ok: false, error: message, code });
}

function ok(res, data = {}) {
  send(res, 200, { ok: true, ...data });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Payload terlalu besar.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Body JSON tidak valid.'));
      }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(header.split(';').map((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return null;
    return [part.slice(0, idx).trim(), decodeURIComponent(part.slice(idx + 1).trim())];
  }).filter(Boolean));
}

function cleanupSessions() {
  const d = getDb();
  const before = d.sessions.length;
  d.sessions = d.sessions.filter((s) => new Date(s.expiresAt).getTime() > Date.now());
  if (d.sessions.length !== before) save();
}

function createSession(user) {
  const d = getDb();
  cleanupSessions();
  const token = crypto.randomBytes(32).toString('hex');
  const csrf = crypto.randomBytes(24).toString('hex');
  const session = {
    id: id('ses'),
    userId: user.id,
    tokenHash: sha256(token),
    csrf,
    createdAt: now(),
    expiresAt: addDays(now(), SESSION_DAYS)
  };
  d.sessions.push(session);
  save();
  return { token, session };
}

function destroySession(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return;
  const d = getDb();
  d.sessions = d.sessions.filter((s) => s.tokenHash !== sha256(token));
  save();
}

function auth(req) {
  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const token = bearer || parseCookies(req)[COOKIE];
  if (!token) return null;
  const d = getDb();
  const session = d.sessions.find((s) => s.tokenHash === sha256(token) && new Date(s.expiresAt).getTime() > Date.now());
  if (!session) return null;
  const user = findUserById(session.userId);
  if (!user) return null;
  return { user, session };
}

function setCookie(res, token) {
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; ${process.env.VERCEL ? 'Secure; ' : ''}Max-Age=${SESSION_DAYS * 86400}`);
}

function clearCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; ${process.env.VERCEL ? 'Secure; ' : ''}Max-Age=0`);
}

function requireAuth(req, res) {
  const ctx = auth(req);
  if (!ctx) {
    fail(res, 401, 'Silakan masuk terlebih dahulu.', 'unauthorized');
    return null;
  }
  return ctx;
}

function requireAdmin(req, res) {
  const ctx = requireAuth(req, res);
  if (!ctx) return null;
  if (ctx.user.role !== 'admin') {
    fail(res, 403, 'Akses admin diperlukan.', 'forbidden');
    return null;
  }
  return ctx;
}

function checkCsrf(req, res, ctx) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
  const token = req.headers['x-csrf-token'];
  if (!token || token !== ctx.session.csrf) {
    fail(res, 403, 'Token CSRF tidak valid. Muat ulang halaman.', 'csrf');
    return false;
  }
  return true;
}

function str(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function rateLimit(key, limit = 12, windowMs = 15 * 60 * 1000) {
  const t = Date.now();
  const item = loginAttempts.get(key) || { count: 0, resetAt: t + windowMs };
  if (t > item.resetAt) {
    item.count = 0;
    item.resetAt = t + windowMs;
  }
  item.count += 1;
  loginAttempts.set(key, item);
  return item.count <= limit;
}

function planForUser(user) {
  return findPlan(user?.subscription?.planId) || findPlan('starter');
}

function accountLimitForUser(user) {
  const plan = planForUser(user);
  return plan?.accountLimit ?? 1;
}

function enrichAccount(acc) {
  return { ...acc, simulated: true };
}

function clientOverview(user) {
  const accounts = accountsForUser(user.id).map(enrichAccount);
  const payments = paymentsForUser(user.id);
  const plan = planForUser(user);
  const logs = getDb().logs.filter((l) => l.actorId === user.id).slice(0, 30);
  return {
    user: publicUser(user),
    plan,
    accounts,
    payments,
    logs,
    stats: {
      accountCount: accounts.length,
      accountLimit: accountLimitForUser(user),
      runningBots: accounts.filter((a) => a.bot?.state === 'running').length,
      pendingPayments: payments.filter((p) => p.status === 'pending').length,
      subscriptionActive: isSubscriptionActive(user) && user.status === 'active'
    },
    demoNotice: DEMO_NOTICE
  };
}

function adminOverview() {
  const d = getDb();
  const users = d.users.map((u) => ({
    ...publicUser(u),
    planName: findPlan(u.subscription?.planId)?.name || '-',
    accountCount: accountsForUser(u.id).length,
    runningBots: accountsForUser(u.id).filter((a) => a.bot?.state === 'running').length
  }));
  const payments = d.payments.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((p) => ({
    ...p,
    userName: findUserById(p.userId)?.name || 'Tidak diketahui',
    userEmail: findUserById(p.userId)?.email || '',
    planName: findPlan(p.planId)?.name || p.planId
  }));
  return {
    stats: {
      totalUsers: d.users.length,
      activeSubscriptions: d.users.filter((u) => u.role === 'client' && isSubscriptionActive(u) && u.status === 'active').length,
      pendingPayments: d.payments.filter((p) => p.status === 'pending').length,
      approvedRevenueIdr: d.payments.filter((p) => p.status === 'approved').reduce((sum, p) => sum + p.amountIdr, 0),
      runningBots: d.accounts.filter((a) => a.bot?.state === 'running').length,
      totalAccounts: d.accounts.length
    },
    users,
    payments,
    plans: d.plans,
    logs: d.logs.slice(0, 100).map((l) => ({ ...l, actorEmail: l.actorId ? findUserById(l.actorId)?.email || '' : '' })),
    demoNotice: DEMO_NOTICE
  };
}

function validateAccountInput(body) {
  const label = str(body.label, 80);
  const broker = str(body.broker, 80);
  const platform = str(body.platform, 10).toUpperCase();
  const server = str(body.server, 120);
  const loginId = str(body.loginId, 80);
  const notes = str(body.notes, 500);
  const risk = ['conservative', 'balanced', 'aggressive'].includes(body.risk) ? body.risk : 'balanced';
  if (!label) throw new Error('Nama akun wajib diisi.');
  if (!broker) throw new Error('Nama broker demo wajib diisi.');
  if (!['MT4', 'MT5'].includes(platform)) throw new Error('Platform harus MT4 atau MT5.');
  if (!server) throw new Error('Server demo wajib diisi.');
  if (!loginId) throw new Error('ID login demo wajib diisi.');
  if (/password|pass|pwd/i.test(loginId)) throw new Error('Jangan masukkan password broker. Gunakan ID demo saja.');
  return { label, broker, platform, server, loginId, notes, risk };
}

function serveStatic(req, res, pathname) {
  let filePath;
  if (pathname === '/' || pathname === '/index.html') filePath = path.join(PUBLIC_DIR, 'index.html');
  else if (pathname === '/app' || pathname === '/app.html') filePath = path.join(PUBLIC_DIR, 'app.html');
  else if (pathname === '/admin' || pathname === '/admin.html') filePath = path.join(PUBLIC_DIR, 'admin.html');
  else {
    const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    filePath = path.join(PUBLIC_DIR, safe);
  }
  if (!filePath.startsWith(PUBLIC_DIR)) return fail(res, 403, 'Akses ditolak.', 'forbidden');
  fs.readFile(filePath, (err, data) => {
    if (err) return fail(res, 404, 'Tidak ditemukan.', 'not_found');
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.ico': 'image/x-icon'
    };
    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin'
    });
    res.end(data);
  });
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method;
  const isMutation = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method);
  const publicAuth = p === '/api/auth/login' || p === '/api/auth/register' || p === '/api/pilot/heartbeat';
  let ctx = null;
  if (isMutation && !publicAuth) {
    ctx = requireAuth(req, res);
    if (!ctx) return;
    if (!checkCsrf(req, res, ctx)) return;
  } else if (!publicAuth && p !== '/api/health' && p !== '/api/bootstrap') {
    ctx = requireAuth(req, res);
    if (!ctx) return;
  }
  let body = {};
  if (isMutation) {
    try {
      body = await readBody(req);
    } catch (err) {
      return fail(res, 400, err.message, 'bad_body');
    }
  }

  // Pilot credentials are independent of the public demo admin password.
  // A laptop generates both random values; the browser must provide them for every command.
  if (p.startsWith('/api/pilot/') && method === 'POST') {
    const deviceId = String(body.deviceId || '');
    const secret = String(body.secret || '');
    if (!/^[a-f0-9]{32}$/.test(deviceId) || !/^[a-f0-9]{64}$/.test(secret)) return fail(res, 400, 'ID atau kunci laptop tidak valid.');
    if (p !== '/api/pilot/heartbeat' && (!ctx || ctx.user.role !== 'admin')) return fail(res, 403, 'Akses admin diperlukan.');
    const db = getDb();
    db.pilotDevices ||= [];
    let device = db.pilotDevices.find(x => x.deviceId === deviceId);
    const hash = sha256(secret);
    const matches = device && crypto.timingSafeEqual(Buffer.from(device.secretHash, 'hex'), Buffer.from(hash, 'hex'));
    if (p === '/api/pilot/register') {
      if (device && !matches) return fail(res, 403, 'Kunci laptop tidak cocok.');
      if (!device) {
        if (db.pilotDevices.length >= 20) return fail(res, 400, 'Batas perangkat tercapai.');
        device = {deviceId, secretHash:hash, leaseUntil:0, lastSeen:0, status:null};
        db.pilotDevices.push(device); save();
      }
      return ok(res, {paired:true});
    }
    if (!matches) return fail(res, 403, 'Perangkat belum terdaftar atau kunci tidak cocok.');
    if (p === '/api/pilot/heartbeat') {
      // Never store broker login, server, credential, or arbitrary client-provided text.
      const st = body.status || {};
      const finite = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
      device.lastSeen = Date.now();
      device.status = {connected: st.connected === true, demo: st.demo === true, ready: st.ready === true,
        enabled: st.enabled === true, balance: finite(st.balance), equity: finite(st.equity),
        positions: Number.isInteger(st.positions) && st.positions >= 0 && st.positions <= 10000 ? st.positions : null,
        protocol: st.protocol === 4 ? 4 : (st.protocol === 3 ? 3 : (st.protocol === 2 ? 2 : 1)), quoteOkXau: st.quoteOkXau === true, quoteOkBtc: st.quoteOkBtc === true, btcNoDailyLimit: st.btcNoDailyLimit === true,
        state: ['stopped','running','blocked'].includes(st.state) ? st.state : 'stopped'};
      const selectedQuoteOk = device.symbol === '#BTCUSD' ? device.status.quoteOkBtc : device.status.quoteOkXau;
      if (!PILOT_DEMO_ENABLED || body.boot === true || (device.status.protocol < 3 || (device.symbol === '#BTCUSD' && device.status.protocol < 4)) || !device.status.connected || !device.status.demo || !device.status.ready || !device.status.enabled || device.status.state === 'blocked' || !selectedQuoteOk) device.leaseUntil=0;
      save();
      return ok(res, {run: device.leaseUntil > Date.now(), symbol: device.symbol || 'XAUUSD', leaseMs: Math.max(0, Math.min(35000, device.leaseUntil - Date.now()))});
    }
    if (p === '/api/pilot/status') {
      return ok(res, {online: Date.now()-device.lastSeen < 30000, lastSeen:device.lastSeen,
        status:device.status, symbol:device.symbol || 'XAUUSD', runningRequested:device.leaseUntil > Date.now()});
    }
    if (p === '/api/pilot/control') {
      if (body.action === 'stop') {device.leaseUntil=0; save(); return ok(res,{runningRequested:false});}
      if (!['start','renew'].includes(body.action)) return fail(res,400,'Perintah tidak dikenal.');
      if (!PILOT_DEMO_ENABLED) return fail(res,400,'Order demo sedang dinonaktifkan.');
      if (body.action === 'renew' && device.leaseUntil <= Date.now()) return fail(res,400,'Izin berjalan berakhir; tekan Start lagi.');
      const symbol = body.symbol || 'XAUUSD';
      if (!['XAUUSD','#BTCUSD'].includes(symbol)) return fail(res,400,'Simbol tidak didukung.');
      if ((device.status?.protocol || 0) < (symbol === '#BTCUSD' ? 4 : 3)) return fail(res,400,'Perbarui penghubung laptop sebelum menjalankan bot demo.');
      if (body.action === 'renew' && symbol !== (device.symbol || 'XAUUSD')) return fail(res,400,'Simbol berbeda; hentikan bot sebelum mengganti.');
      if (body.action === 'start' && device.leaseUntil > Date.now() && symbol !== (device.symbol || 'XAUUSD')) return fail(res,400,'Hentikan bot sebelum mengganti simbol.');
      if ((symbol === '#BTCUSD' && !device.status?.quoteOkBtc) || (symbol === 'XAUUSD' && !device.status?.quoteOkXau)) return fail(res,400,'Harga tidak segar atau waktu tick tidak valid; order diblokir.');
      if (Date.now()-device.lastSeen >= 30000 || !device.status?.connected || !device.status?.demo || !device.status?.ready || !device.status?.enabled || device.status?.state === 'blocked')
        return fail(res,400,'Laptop belum online, akun demo belum siap, atau bot sedang diblokir.');
      device.symbol=symbol; device.leaseUntil=Date.now()+35000; save();
      return ok(res, {runningRequested:true});
    }
    return fail(res,404,'Perintah tidak ditemukan.');
  }

  if (p === '/api/health' && method === 'GET') return ok(res, { status: 'healthy', demo: true, time: now() });
  if (p === '/api/bootstrap' && method === 'GET') {
    return ok(res, { plans: getDb().plans.filter((x) => x.active), paymentMethods: PAYMENT_METHODS, demoNotice: DEMO_NOTICE });
  }

  if (p === '/api/auth/register' && method === 'POST') {
    const name = str(body.name, 80);
    const email = str(body.email, 160).toLowerCase();
    const password = String(body.password || '');
    if (name.length < 2) return fail(res, 400, 'Nama minimal 2 karakter.');
    if (!validEmail(email)) return fail(res, 400, 'Email tidak valid.');
    if (password.length < 10) return fail(res, 400, 'Password minimal 10 karakter.');
    if (findUserByEmail(email)) return fail(res, 409, 'Email sudah terdaftar.');
    const user = {
      id: id('usr'), name, email, passwordHash: hashPassword(password), role: 'client', status: 'active', createdAt: now(),
      profile: { phone: '', company: '', notes: '' },
      subscription: { planId: 'starter', status: 'pending', startedAt: null, renewalAt: null, activatedBy: null }
    };
    getDb().users.push(user);
    logEvent({ actorId: user.id, actorRole: 'client', action: 'auth.register', targetType: 'user', targetId: user.id, message: 'Pendaftaran demo berhasil.' });
    const { token, session } = createSession(user);
    save();
    setCookie(res, token);
    return ok(res, { user: publicUser(user), csrfToken: session.csrf, sessionToken: token });
  }

  if (p === '/api/auth/login' && method === 'POST') {
    const email = str(body.email, 160).toLowerCase();
    const password = String(body.password || '');
    const ip = req.socket.remoteAddress || 'unknown';
    if (!rateLimit(`${ip}:${email}`)) return fail(res, 429, 'Terlalu banyak percobaan masuk. Coba lagi nanti.', 'rate_limited');
    const user = findUserByEmail(email);
    if (!user || !verifyPassword(password, user.passwordHash)) return fail(res, 401, 'Email atau password salah.', 'invalid_credentials');
    const { token, session } = createSession(user);
    logEvent({ actorId: user.id, actorRole: user.role, action: 'auth.login', targetType: 'user', targetId: user.id, message: 'Masuk ke portal demo.' });
    save();
    setCookie(res, token);
    return ok(res, { user: publicUser(user), csrfToken: session.csrf, sessionToken: token });
  }

  if (p === '/api/auth/logout' && method === 'POST') {
    destroySession(req);
    clearCookie(res);
    return ok(res);
  }

  if (p === '/api/me' && method === 'GET') {
    return ok(res, { user: publicUser(ctx.user), csrfToken: ctx.session.csrf, demoNotice: DEMO_NOTICE });
  }

  if (p === '/api/client/overview' && method === 'GET') return ok(res, clientOverview(ctx.user));

  if (p === '/api/client/profile' && method === 'PATCH') {
    const name = str(body.name, 80);
    if (name.length < 2) return fail(res, 400, 'Nama minimal 2 karakter.');
    ctx.user.name = name;
    ctx.user.profile = {
      phone: str(body.phone, 40),
      company: str(body.company, 100),
      notes: str(body.notes, 500)
    };
    logEvent({ actorId: ctx.user.id, actorRole: ctx.user.role, action: 'profile.update', targetType: 'user', targetId: ctx.user.id, message: 'Profil diperbarui.' });
    save();
    return ok(res, { user: publicUser(ctx.user) });
  }

  if (p === '/api/client/accounts' && method === 'GET') return ok(res, { accounts: accountsForUser(ctx.user.id).map(enrichAccount) });

  if (p === '/api/client/accounts' && method === 'POST') {
    let input;
    try { input = validateAccountInput(body); } catch (err) { return fail(res, 400, err.message); }
    const limit = accountLimitForUser(ctx.user);
    const count = accountsForUser(ctx.user.id).length;
    if (limit > 0 && count >= limit) return fail(res, 403, `Batas paket ${planForUser(ctx.user).name} adalah ${limit} akun.`, 'plan_limit');
    const acc = {
      id: id('acc'), userId: ctx.user.id, ...input,
      bot: { state: 'stopped', startedAt: null, stoppedAt: null, lastTick: null, equityDemo: 1000, pnlDemo: 0, tradesDemo: 0 },
      createdAt: now()
    };
    getDb().accounts.push(acc);
    logEvent({ actorId: ctx.user.id, actorRole: ctx.user.role, action: 'account.create', targetType: 'account', targetId: acc.id, message: `Akun demo ${acc.label} ditambahkan.` });
    save();
    return ok(res, { account: enrichAccount(acc) });
  }

  const accountMatch = p.match(/^\/api\/client\/accounts\/([\w-]+)$/);
  if (accountMatch) {
    const acc = getDb().accounts.find((a) => a.id === accountMatch[1] && a.userId === ctx.user.id);
    if (!acc) return fail(res, 404, 'Akun tidak ditemukan.', 'not_found');
    if (method === 'PATCH') {
      let input;
      try { input = validateAccountInput(body); } catch (err) { return fail(res, 400, err.message); }
      Object.assign(acc, input);
      logEvent({ actorId: ctx.user.id, actorRole: ctx.user.role, action: 'account.update', targetType: 'account', targetId: acc.id, message: `Akun demo ${acc.label} diperbarui.` });
      save();
      return ok(res, { account: enrichAccount(acc) });
    }
    if (method === 'DELETE') {
      getDb().accounts = getDb().accounts.filter((a) => a.id !== acc.id);
      logEvent({ actorId: ctx.user.id, actorRole: ctx.user.role, action: 'account.delete', targetType: 'account', targetId: acc.id, message: `Akun demo ${acc.label} dihapus.` });
      save();
      return ok(res);
    }
  }

  const botMatch = p.match(/^\/api\/client\/accounts\/([\w-]+)\/bot$/);
  if (botMatch && method === 'POST') {
    const acc = getDb().accounts.find((a) => a.id === botMatch[1] && a.userId === ctx.user.id);
    if (!acc) return fail(res, 404, 'Akun tidak ditemukan.', 'not_found');
    const action = str(body.action, 10);
    if (!['start', 'stop'].includes(action)) return fail(res, 400, 'Aksi harus start atau stop.');
    if (action === 'start') {
      if (ctx.user.status !== 'active') return fail(res, 403, 'Akun portal ditangguhkan.', 'suspended');
      if (!isSubscriptionActive(ctx.user)) return fail(res, 403, 'Langganan belum aktif atau sudah kedaluwarsa.', 'subscription_inactive');
      acc.bot.state = 'running';
      acc.bot.startedAt = now();
      acc.bot.stoppedAt = null;
      acc.bot.lastTick = now();
      acc.bot.stopReason = '';
      logEvent({ actorId: ctx.user.id, actorRole: ctx.user.role, action: 'bot.start', targetType: 'account', targetId: acc.id, message: `Bot simulasi dijalankan pada ${acc.label}.`, meta: { simulated: true } });
    } else {
      stopAccount(acc, 'user_stopped');
      logEvent({ actorId: ctx.user.id, actorRole: ctx.user.role, action: 'bot.stop', targetType: 'account', targetId: acc.id, message: `Bot simulasi dihentikan pada ${acc.label}.`, meta: { simulated: true } });
    }
    save();
    return ok(res, { account: enrichAccount(acc) });
  }

  if (p === '/api/client/payments' && method === 'GET') return ok(res, { payments: paymentsForUser(ctx.user.id) });

  if (p === '/api/client/payments' && method === 'POST') {
    const planId = str(body.planId, 40);
    const plan = findPlan(planId);
    if (!plan || !plan.active) return fail(res, 400, 'Paket tidak tersedia.');
    const methodId = str(body.method, 40);
    if (!PAYMENT_METHODS.some((m) => m.id === methodId)) return fail(res, 400, 'Metode pembayaran demo tidak valid.');
    const senderName = str(body.senderName, 100);
    const reference = str(body.reference, 120);
    const note = str(body.note, 500);
    if (!senderName) return fail(res, 400, 'Nama pengirim demo wajib diisi.');
    if (!reference) return fail(res, 400, 'Referensi demo wajib diisi.');
    const payment = {
      id: id('pay'), userId: ctx.user.id, planId, amountIdr: plan.priceIdr, method: methodId,
      senderName, reference, note, status: 'pending', createdAt: now(), reviewedAt: null, reviewedBy: null, rejectReason: ''
    };
    getDb().payments.push(payment);
    logEvent({ actorId: ctx.user.id, actorRole: ctx.user.role, action: 'payment.submit', targetType: 'payment', targetId: payment.id, message: `Konfirmasi pembayaran demo untuk paket ${plan.name} dikirim.` });
    save();
    return ok(res, { payment });
  }

  if (p === '/api/client/logs' && method === 'GET') {
    return ok(res, { logs: getDb().logs.filter((l) => l.actorId === ctx.user.id).slice(0, 100) });
  }

  if (p === '/api/admin/overview' && method === 'GET') {
    if (ctx.user.role !== 'admin') return fail(res, 403, 'Akses admin diperlukan.', 'forbidden');
    return ok(res, adminOverview());
  }

  if (p === '/api/admin/users' && method === 'GET') {
    if (ctx.user.role !== 'admin') return fail(res, 403, 'Akses admin diperlukan.', 'forbidden');
    return ok(res, { users: adminOverview().users });
  }

  const adminUserMatch = p.match(/^\/api\/admin\/users\/([\w-]+)$/);
  if (adminUserMatch && method === 'PATCH') {
    if (ctx.user.role !== 'admin') return fail(res, 403, 'Akses admin diperlukan.', 'forbidden');
    const user = findUserById(adminUserMatch[1]);
    if (!user) return fail(res, 404, 'Pengguna tidak ditemukan.', 'not_found');
    const status = str(body.status, 20);
    if (!['active', 'suspended'].includes(status)) return fail(res, 400, 'Status harus active atau suspended.');
    if (user.role === 'admin' && user.id === ctx.user.id && status !== 'active') return fail(res, 400, 'Tidak bisa menangguhkan diri sendiri.');
    user.status = status;
    if (status !== 'active') {
      for (const acc of accountsForUser(user.id)) stopAccount(acc, 'user_suspended');
    }
    logEvent({ actorId: ctx.user.id, actorRole: 'admin', action: 'admin.user_status', targetType: 'user', targetId: user.id, message: `Status pengguna ${user.email} menjadi ${status}.` });
    save();
    return ok(res, { user: publicUser(user) });
  }

  const adminActivateMatch = p.match(/^\/api\/admin\/users\/([\w-]+)\/activate$/);
  if (adminActivateMatch && method === 'POST') {
    if (ctx.user.role !== 'admin') return fail(res, 403, 'Akses admin diperlukan.', 'forbidden');
    const user = findUserById(adminActivateMatch[1]);
    if (!user) return fail(res, 404, 'Pengguna tidak ditemukan.', 'not_found');
    const planId = str(body.planId, 40) || user.subscription?.planId || 'starter';
    const plan = findPlan(planId);
    if (!plan) return fail(res, 400, 'Paket tidak ditemukan.');
    const days = Math.max(1, Math.min(3650, Number(body.days) || plan.periodDays));
    user.subscription = {
      planId, status: 'active', startedAt: user.subscription?.startedAt || now(), renewalAt: addDays(now(), days), activatedBy: ctx.user.id
    };
    user.status = 'active';
    logEvent({ actorId: ctx.user.id, actorRole: 'admin', action: 'admin.activate', targetType: 'user', targetId: user.id, message: `Langganan ${plan.name} untuk ${user.email} diaktifkan selama ${days} hari.` });
    save();
    return ok(res, { user: publicUser(user) });
  }

  const adminDeactivateMatch = p.match(/^\/api\/admin\/users\/([\w-]+)\/deactivate$/);
  if (adminDeactivateMatch && method === 'POST') {
    if (ctx.user.role !== 'admin') return fail(res, 403, 'Akses admin diperlukan.', 'forbidden');
    const user = findUserById(adminDeactivateMatch[1]);
    if (!user) return fail(res, 404, 'Pengguna tidak ditemukan.', 'not_found');
    user.subscription = { ...(user.subscription || {}), status: 'inactive', renewalAt: now() };
    for (const acc of accountsForUser(user.id)) stopAccount(acc, 'subscription_inactive');
    logEvent({ actorId: ctx.user.id, actorRole: 'admin', action: 'admin.deactivate', targetType: 'user', targetId: user.id, message: `Langganan ${user.email} dinonaktifkan.` });
    save();
    return ok(res, { user: publicUser(user) });
  }

  if (p === '/api/admin/payments' && method === 'GET') {
    if (ctx.user.role !== 'admin') return fail(res, 403, 'Akses admin diperlukan.', 'forbidden');
    return ok(res, { payments: adminOverview().payments });
  }

  const paymentReviewMatch = p.match(/^\/api\/admin\/payments\/([\w-]+)\/(approve|reject)$/);
  if (paymentReviewMatch && method === 'POST') {
    if (ctx.user.role !== 'admin') return fail(res, 403, 'Akses admin diperlukan.', 'forbidden');
    const payment = getDb().payments.find((x) => x.id === paymentReviewMatch[1]);
    if (!payment) return fail(res, 404, 'Pembayaran tidak ditemukan.', 'not_found');
    if (payment.status !== 'pending') return fail(res, 409, 'Pembayaran sudah ditinjau.', 'already_reviewed');
    const user = findUserById(payment.userId);
    const plan = findPlan(payment.planId);
    if (!user || !plan) return fail(res, 400, 'Data pembayaran tidak lengkap.');
    const decision = paymentReviewMatch[2];
    payment.reviewedAt = now();
    payment.reviewedBy = ctx.user.id;
    if (decision === 'approve') {
      payment.status = 'approved';
      user.subscription = {
        planId: plan.id,
        status: 'active',
        startedAt: user.subscription?.startedAt || now(),
        renewalAt: addDays(now(), plan.periodDays),
        activatedBy: ctx.user.id
      };
      user.status = 'active';
      logEvent({ actorId: ctx.user.id, actorRole: 'admin', action: 'payment.approve', targetType: 'payment', targetId: payment.id, message: `Pembayaran demo ${payment.reference} disetujui; paket ${plan.name} aktif.` });
    } else {
      const reason = str(body.reason, 300);
      if (!reason) return fail(res, 400, 'Alasan penolakan wajib diisi.');
      payment.status = 'rejected';
      payment.rejectReason = reason;
      logEvent({ actorId: ctx.user.id, actorRole: 'admin', action: 'payment.reject', targetType: 'payment', targetId: payment.id, message: `Pembayaran demo ${payment.reference} ditolak: ${reason}` });
    }
    save();
    return ok(res, { payment });
  }

  if (p === '/api/admin/logs' && method === 'GET') {
    if (ctx.user.role !== 'admin') return fail(res, 403, 'Akses admin diperlukan.', 'forbidden');
    return ok(res, { logs: adminOverview().logs });
  }

  const adminPlanMatch = p.match(/^\/api\/admin\/plans\/([\w-]+)$/);
  if (adminPlanMatch && method === 'PATCH') {
    if (ctx.user.role !== 'admin') return fail(res, 403, 'Akses admin diperlukan.', 'forbidden');
    const plan = findPlan(adminPlanMatch[1]);
    if (!plan) return fail(res, 404, 'Paket tidak ditemukan.', 'not_found');
    if (body.name !== undefined) plan.name = str(body.name, 60) || plan.name;
    if (body.priceIdr !== undefined) {
      const price = Number(body.priceIdr);
      if (!Number.isFinite(price) || price < 0) return fail(res, 400, 'Harga tidak valid.');
      plan.priceIdr = Math.round(price);
    }
    if (body.accountLimit !== undefined) {
      const limit = Number(body.accountLimit);
      if (!Number.isInteger(limit) || limit < 0) return fail(res, 400, 'Batas akun harus integer >= 0. 0 berarti tanpa batas.');
      plan.accountLimit = limit;
    }
    if (body.active !== undefined) plan.active = Boolean(body.active);
    logEvent({ actorId: ctx.user.id, actorRole: 'admin', action: 'admin.plan_update', targetType: 'plan', targetId: plan.id, message: `Paket ${plan.name} diperbarui.` });
    save();
    return ok(res, { plan });
  }

  if (p === '/api/admin/reset-demo' && method === 'POST') {
    if (ctx.user.role !== 'admin') return fail(res, 403, 'Akses admin diperlukan.', 'forbidden');
    resetDemo();
    clearCookie(res);
    return ok(res, { message: 'Data demo direset. Silakan masuk lagi.' });
  }

  return fail(res, 404, 'Endpoint tidak ditemukan.', 'not_found');
}

export async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await withRemoteState(req, res, (response) => handleApi(req, response, url));
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) return fail(res, 405, 'Metode tidak diizinkan.', 'method_not_allowed');
    serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) fail(res, 500, 'Terjadi kesalahan server.', 'server_error');
    else res.end();
  }
}

if (!remoteEnabled) setInterval(() => {
  try {
    const d = getDb();
    let changed = false;
    for (const user of d.users) {
      if (user.subscription?.status === 'active' && user.subscription.renewalAt && new Date(user.subscription.renewalAt).getTime() <= Date.now()) {
        user.subscription.status = 'expired';
        for (const acc of accountsForUser(user.id)) stopAccount(acc, 'subscription_expired');
        logEvent({ actorRole: 'system', action: 'subscription.expired', targetType: 'user', targetId: user.id, message: `Langganan ${user.email} kedaluwarsa.` });
        changed = true;
      }
    }
    if (changed) save();
    tickSimulation();
  } catch (err) {
    console.error('simulation tick error', err);
  }
}, 15000).unref();

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) http.createServer(handler).listen(PORT, HOST, () => {
  console.log(`TitanTrading demo listening on http://${HOST}:${PORT}`);
  console.log(DEMO_NOTICE);
});
