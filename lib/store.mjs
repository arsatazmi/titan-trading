import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const context = new AsyncLocalStorage();
export const remoteEnabled = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
if (process.env.VERCEL && !remoteEnabled) throw new Error('Supabase environment variables required on Vercel');

const ROOT = path.resolve(process.env.TITAN_DATA_DIR || path.join(process.cwd(), 'data'));
const DB_FILE = path.join(ROOT, 'db.json');
const SECRET_FILE = path.join(ROOT, '.secret');

function ensureDir() {
  fs.mkdirSync(ROOT, { recursive: true });
}

export function getSecret() {
  if (remoteEnabled) return "unused-remote-secret";
  ensureDir();
  if (!fs.existsSync(SECRET_FILE)) {
    fs.writeFileSync(SECRET_FILE, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  }
  return fs.readFileSync(SECRET_FILE, 'utf8').trim();
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, salt, hash] = String(stored || '').split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const candidate = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

export function id(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(10).toString('hex')}`;
}

export function now() {
  return new Date().toISOString();
}

export function addDays(dateIso, days) {
  const d = new Date(dateIso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function seed() {
  const t = now();
  const adminId = id('usr');
  const clientId = id('usr');
  const pendingUserId = id('usr');
  const proPlan = 'pro';
  const starterPlan = 'starter';
  const acc1 = id('acc');
  const acc2 = id('acc');
  const payApproved = id('pay');
  const payPending = id('pay');
  return {
    meta: { version: 1, demo: true, createdAt: t, updatedAt: t },
    plans: [
      {
        id: starterPlan,
        name: 'Starter',
        priceIdr: 149000,
        periodDays: 30,
        accountLimit: 1,
        popular: false,
        active: true,
        features: ['1 akun broker demo', 'Start/stop bot simulasi', 'Riwayat pembayaran manual', 'Dukungan dasar']
      },
      {
        id: proPlan,
        name: 'Pro',
        priceIdr: 399000,
        periodDays: 30,
        accountLimit: 3,
        popular: true,
        active: true,
        features: ['3 akun broker demo', 'Start/stop bot simulasi', 'Prioritas konfirmasi pembayaran', 'Log aktivitas akun']
      },
      {
        id: 'elite',
        name: 'Elite',
        priceIdr: 999000,
        periodDays: 30,
        accountLimit: 0,
        popular: false,
        active: true,
        features: ['Akun broker demo tanpa batas', 'Start/stop bot simulasi', 'Prioritas dukungan', 'Ringkasan admin lanjutan']
      }
    ],
    users: [
      {
        id: adminId,
        name: 'Owner TitanTrading',
        email: 'admin@titantrading.demo',
        passwordHash: hashPassword('TitanAdmin!2026'),
        role: 'admin',
        status: 'active',
        createdAt: t,
        profile: { phone: '', company: 'TitanTrading Demo', notes: 'Akun admin demo.' },
        subscription: { planId: 'elite', status: 'active', startedAt: t, renewalAt: addDays(t, 3650), activatedBy: adminId }
      },
      {
        id: clientId,
        name: 'Klien Demo',
        email: 'client@titantrading.demo',
        passwordHash: hashPassword('TitanClient!2026'),
        role: 'client',
        status: 'active',
        createdAt: t,
        profile: { phone: '0800-0000-0000', company: '', notes: 'Semua data pada akun ini adalah demo.' },
        subscription: { planId: proPlan, status: 'active', startedAt: t, renewalAt: addDays(t, 30), activatedBy: adminId }
      },
      {
        id: pendingUserId,
        name: 'Calon Klien Demo',
        email: 'pending@titantrading.demo',
        passwordHash: hashPassword('TitanPending!2026'),
        role: 'client',
        status: 'active',
        createdAt: t,
        profile: { phone: '', company: '', notes: '' },
        subscription: { planId: starterPlan, status: 'pending', startedAt: null, renewalAt: null, activatedBy: null }
      }
    ],
    accounts: [
      {
        id: acc1,
        userId: clientId,
        label: 'Akun Demo Utama',
        broker: 'Broker Demo',
        platform: 'MT5',
        server: 'Demo-Server-01',
        loginId: 'DEMO-100001',
        notes: 'Tidak terhubung ke broker nyata.',
        risk: 'balanced',
        bot: { state: 'running', startedAt: t, stoppedAt: null, lastTick: t, equityDemo: 1000, pnlDemo: 0, tradesDemo: 0 },
        createdAt: t
      },
      {
        id: acc2,
        userId: clientId,
        label: 'Akun Demo Kedua',
        broker: 'Broker Demo',
        platform: 'MT4',
        server: 'Demo-Server-02',
        loginId: 'DEMO-100002',
        notes: 'Hanya simulasi tampilan.',
        risk: 'conservative',
        bot: { state: 'stopped', startedAt: null, stoppedAt: null, lastTick: null, equityDemo: 1000, pnlDemo: 0, tradesDemo: 0 },
        createdAt: t
      }
    ],
    payments: [
      {
        id: payApproved,
        userId: clientId,
        planId: proPlan,
        amountIdr: 399000,
        method: 'bank_demo',
        senderName: 'Klien Demo',
        reference: 'DEMO-REF-0001',
        note: 'Pembayaran demo yang sudah disetujui.',
        status: 'approved',
        createdAt: t,
        reviewedAt: t,
        reviewedBy: adminId,
        rejectReason: ''
      },
      {
        id: payPending,
        userId: pendingUserId,
        planId: starterPlan,
        amountIdr: 149000,
        method: 'qris_demo',
        senderName: 'Calon Klien Demo',
        reference: 'DEMO-REF-0002',
        note: 'Menunggu tinjauan admin demo.',
        status: 'pending',
        createdAt: t,
        reviewedAt: null,
        reviewedBy: null,
        rejectReason: ''
      }
    ],
    logs: [
      { id: id('log'), actorId: adminId, actorRole: 'admin', action: 'seed', targetType: 'system', targetId: 'demo', message: 'Data demo TitanTrading dibuat.', createdAt: t, meta: {} },
      { id: id('log'), actorId: clientId, actorRole: 'client', action: 'bot.start', targetType: 'account', targetId: acc1, message: 'Bot simulasi dijalankan pada Akun Demo Utama.', createdAt: t, meta: { simulated: true } }
    ],
    sessions: []
  };
}

let db = null;

export function load() {
  if (remoteEnabled) return;
  ensureDir();
  if (!fs.existsSync(DB_FILE)) {
    db = seed();
    save();
    return db;
  }
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  return db;
}

export function save() {
  if (context.getStore()) { context.getStore().dirty = true; return; }
  if (!db) return;
  db.meta.updatedAt = now();
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

export function getDb() {
  if (context.getStore()) return context.getStore().db;
  if (remoteEnabled) throw new Error("Remote state accessed outside request");
  if (!db) load();
  return db;
}

export function resetDemo() {
  if (context.getStore()) { context.getStore().db = seed(); save(); return getDb(); }
  db = seed();
  save();
  return db;
}

export function logEvent({ actorId = null, actorRole = 'system', action, targetType = 'system', targetId = '', message = '', meta = {} }) {
  const d = getDb();
  d.logs.unshift({ id: id('log'), actorId, actorRole, action, targetType, targetId, message, createdAt: now(), meta });
  d.logs = d.logs.slice(0, 1000);
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    profile: user.profile || {},
    subscription: user.subscription || null
  };
}

export function findUserByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  return getDb().users.find((u) => u.email.toLowerCase() === normalized) || null;
}

export function findUserById(userId) {
  return getDb().users.find((u) => u.id === userId) || null;
}

export function findPlan(planId) {
  return getDb().plans.find((p) => p.id === planId) || null;
}

export function accountsForUser(userId) {
  return getDb().accounts.filter((a) => a.userId === userId);
}

export function paymentsForUser(userId) {
  return getDb().payments.filter((p) => p.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function isSubscriptionActive(user) {
  const sub = user?.subscription;
  if (!sub || sub.status !== 'active') return false;
  if (!sub.renewalAt) return false;
  return new Date(sub.renewalAt).getTime() > Date.now();
}

export function stopAccount(account, reason = 'stopped') {
  account.bot = account.bot || {};
  account.bot.state = 'stopped';
  account.bot.stoppedAt = now();
  account.bot.lastTick = now();
  account.bot.stopReason = reason;
}

export function tickSimulation() {
  const d = getDb();
  let changed = false;
  for (const acc of d.accounts) {
    if (acc.bot?.state !== 'running') continue;
    const user = findUserById(acc.userId);
    if (!user || user.status !== 'active' || !isSubscriptionActive(user)) {
      stopAccount(acc, 'subscription_inactive');
      logEvent({ actorRole: 'system', action: 'bot.auto_stop', targetType: 'account', targetId: acc.id, message: `Bot simulasi dihentikan otomatis: langganan tidak aktif.`, meta: { simulated: true } });
      changed = true;
      continue;
    }
    const drift = (Math.random() - 0.48) * 4;
    acc.bot.pnlDemo = Math.round(((acc.bot.pnlDemo || 0) + drift) * 100) / 100;
    acc.bot.equityDemo = Math.round((1000 + acc.bot.pnlDemo) * 100) / 100;
    if (Math.random() > 0.7) acc.bot.tradesDemo = (acc.bot.tradesDemo || 0) + 1;
    acc.bot.lastTick = now();
    changed = true;
  }
  if (changed) save();
}

async function rest(endpoint, options = {}) {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${endpoint}`, {
    ...options,
    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json', ...options.headers },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Supabase request failed: ${response.status}`);
  return response.status === 204 ? null : response.json();
}

// Buffer the response until persistence succeeds. Revision checks prevent lost updates
// across concurrent serverless instances. On conflict the caller must retry.
export async function withRemoteState(req, res, handler) {
  if (!remoteEnabled) return handler(res);
  let rows = await rest('titan_demo_state?id=eq.1&select=payload,revision');
  if (!rows.length) {
    await rest('titan_demo_state?on_conflict=id', { method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates' },
      body: JSON.stringify({ id: 1, payload: seed(), revision: 0 }) });
    rows = await rest('titan_demo_state?id=eq.1&select=payload,revision');
  }
  const current = rows[0];
  const state = { db: current.payload, dirty: false };
  const headers = {};
  let status = 200, body;
  const buffered = {
    setHeader(key, value) { headers[key] = value; },
    writeHead(code, values) { status = code; Object.assign(headers, values); },
    end(value) { body = value; }
  };
  await context.run(state, async () => {
    if (Date.now() - (state.db.meta.lastSimulationAt || 0) >= 15000) {
      tickSimulation();
      state.db.meta.lastSimulationAt = Date.now();
      save();
    }
    await handler(buffered);
    if (state.dirty) {
      state.db.meta.updatedAt = now();
      const updated = await rest(`titan_demo_state?id=eq.1&revision=eq.${current.revision}`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ payload: state.db, revision: current.revision + 1 })
      });
      if (!updated.length) {
        res.writeHead(409, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: 'Ada pembaruan bersamaan. Silakan coba lagi.', code: 'state_conflict' }));
        return;
      }
    }
    res.writeHead(status, headers);
    res.end(body);
  });
}
