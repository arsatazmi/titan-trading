import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const COOKIE = 'tv_session';
const SESSION_DAYS = 30;
const MAX_BODY = 1_000_000;

const SUPABASE_URL = String(process.env.SUPABASE_URL || 'https://zwiatrbdvetqcjivqomo.supabase.co').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp3aWF0cmJkdmV0cWNqaXZxb21vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2NzU1NDcsImV4cCI6MjExMDI1MTU0N30.Z4sRf7J9SpotR55gDC9ce9By2ipfrl58docBSUCDLmk';
const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || 'arsatazmi12@gmail.com,starboy@titanvault.local,starboy')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const GOOGLE_OAUTH_ENABLED = process.env.GOOGLE_OAUTH_ENABLED === 'true';

// A plain username (no "@") is accepted as a login id and mapped to a private
// email identity inside Supabase Auth. Example: "starboy" -> "starboy@titanvault.local".
const LOGIN_DOMAIN = 'titanvault.local';
function normalizeLogin(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.includes('@')) return raw;
  if (!/^[a-z0-9._-]{2,64}$/.test(raw)) return '';
  return `${raw}@${LOGIN_DOMAIN}`;
}
function loginLabel(value) {
  const raw = String(value || '').trim().toLowerCase();
  return raw.includes('@') ? raw.split('@')[0] : raw;
}

/* Broker credentials are encrypted at rest (AES-256-GCM). The key is derived
   from the server-side service key, so it is never shipped to the browser. */
const CREDENTIAL_KEY = crypto.scryptSync(
  SERVICE_KEY || 'titan-vault-local-development',
  'titan-vault-broker-credentials-v1',
  32
);
const ENC_PREFIX = 'enc:v1:';
function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', CREDENTIAL_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ENC_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}
function decryptSecret(value) {
  if (typeof value !== 'string' || !value.startsWith(ENC_PREFIX)) return value;
  try {
    const buf = Buffer.from(value.slice(ENC_PREFIX.length), 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', CREDENTIAL_KEY, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  } catch { return value; }
}
function mapPasswords(value, transform) {
  if (Array.isArray(value)) return value.map((v) => mapPasswords(v, transform));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = k === 'password' && typeof v === 'string' ? transform(v) : mapPasswords(v, transform);
    }
    return out;
  }
  return value;
}
const encryptCredentials = (v) => mapPasswords(v, (s) => s.startsWith(ENC_PREFIX) ? s : encryptSecret(s));
const decryptCredentials = (v) => mapPasswords(v, decryptSecret);

const PLANS = [
  { id: 'pro', name: 'PRO', price: 50, accountLimit: 1, features: ['1 broker account limit (MT4 or MT5)', 'Start and stop the XAUUSD bot'] },
  { id: 'bronze', name: 'BRONZE', price: 100, accountLimit: 3, features: ['Up to 3 broker accounts limit', 'Start and stop the bot per account'] },
  { id: 'platinum', name: 'PLATINUM', price: 250, accountLimit: 0, features: ['Unlimited broker accounts', 'Start and stop the bot per account'] }
];
const PAYMENT_METHODS = [
  { id: 'dana', label: 'DANA E-WALLETS', number: '0856-9333-8337', digits: '085693338337', holder: 'Siti Nurkomalasari' },
  { id: 'mandiri', label: 'BANK MANDIRI', number: '1260009995357', digits: '1260009995357', holder: 'Muhammad Basir' }
];
const OWNER_WHATSAPP = {
  label: 'Syadtech.ID',
  number: '083830065860',
  url: 'https://wa.me/6283830065860'
};

/* ------------------------------------------------------------------ helpers */
function send(res, status, data, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(JSON.stringify(data));
}
const ok = (res, data = {}) => send(res, 200, { ok: true, ...data });
const fail = (res, status, message, code = 'error') => send(res, status, { ok: false, error: message, code });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Payload terlalu besar.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('Body JSON tidak valid.')); }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(header.split(';').map((part) => {
    const i = part.indexOf('=');
    if (i < 0) return null;
    try { return [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim())]; }
    catch { return [part.slice(0, i).trim(), part.slice(i + 1).trim()]; }
  }).filter(Boolean));
}

function originOf(req) {
  const proto = String(req.headers['x-forwarded-proto'] || (process.env.VERCEL ? 'https' : 'http')).split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function cookieSecure(req) {
  return process.env.VERCEL === '1' || originOf(req).startsWith('https://');
}

function setCookie(res, tokens, req) {
  const value = encodeURIComponent(JSON.stringify(tokens));
  res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; ${cookieSecure(req) ? 'Secure; ' : ''}Max-Age=${SESSION_DAYS * 86400}`);
}
function clearCookie(res, req) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; ${cookieSecure(req) ? 'Secure; ' : ''}Max-Age=0`);
}

function checkMutation(req, res) {
  if (req.headers['x-titan-client'] !== '1') {
    fail(res, 403, 'Permintaan tidak sah.', 'csrf');
    return false;
  }
  const origin = req.headers.origin;
  if (origin) {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0];
    try {
      if (new URL(origin).hostname !== host) {
        fail(res, 403, 'Origin tidak cocok.', 'csrf');
        return false;
      }
    } catch {
      fail(res, 403, 'Origin tidak valid.', 'csrf');
      return false;
    }
  }
  return true;
}

/* --------------------------------------------------------------- Supabase IO */
async function sbFetch(pathname, { method = 'GET', body, key = SERVICE_KEY, headers = {} } = {}) {
  const response = await fetch(SUPABASE_URL + pathname, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { ok: response.ok, status: response.status, data };
}

async function authGrant(credential, grantType) {
  return sbFetch(`/auth/v1/token?grant_type=${grantType}`, { method: 'POST', body: credential, key: ANON_KEY });
}
async function authUser(accessToken) {
  return sbFetch('/auth/v1/user', { key: ANON_KEY, headers: { Authorization: `Bearer ${accessToken}` } });
}
function publicUser(u, tokens) {
  const email = String(u?.email || '').toLowerCase();
  return {
    uid: u?.id || '',
    email: u?.email || '',
    login: u?.user_metadata?.login || (u?.email ? String(u.email).split('@')[0] : ''),
    displayName: u?.user_metadata?.name || u?.user_metadata?.login || (u?.email ? String(u.email).split('@')[0] : ''),
    isAdmin: ADMIN_EMAILS.includes(email)
  };
}

async function getRow(uid, email = '', isAdmin = false, create = true) {
  const r = await sbFetch(`/rest/v1/titan_vault_users?uid=eq.${encodeURIComponent(uid)}&select=*`);
  if (r.ok && Array.isArray(r.data) && r.data.length) return r.data[0];
  if (!create) return null;
  const created = await sbFetch('/rest/v1/titan_vault_users?on_conflict=uid', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: { uid, email: email || '', data: {}, is_admin: isAdmin, updated_at: new Date().toISOString() }
  });
  if (created.ok && Array.isArray(created.data) && created.data.length) return created.data[0];
  return { uid, email: email || '', data: {}, is_admin: isAdmin };
}
async function saveRow(row, data) {
  return sbFetch('/rest/v1/titan_vault_users?on_conflict=uid', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: {
      uid: row.uid,
      email: row.email || '',
      data,
      is_admin: !!row.is_admin,
      updated_at: new Date().toISOString()
    }
  });
}
async function logEvent(user, action, detail = {}) {
  try {
    await sbFetch('/rest/v1/titan_vault_events', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: {
        actor_uid: user?.uid || null,
        actor_email: user?.email || '',
        action,
        detail
      }
    });
  } catch { /* audit logging must never break a request */ }
}

/* --------------------------------------------------------------- session */
async function getSession(req, res) {
  const raw = parseCookies(req)[COOKIE];
  if (!raw) return null;
  let tokens;
  try { tokens = JSON.parse(decodeURIComponent(raw)); } catch { return null; }
  if (!tokens?.access_token) return null;
  let u = await authUser(tokens.access_token);
  if (!u.ok && tokens.refresh_token) {
    const refreshed = await authGrant({ refresh_token: tokens.refresh_token }, 'refresh_token');
    if (refreshed.ok) {
      tokens = {
        access_token: refreshed.data.access_token,
        refresh_token: refreshed.data.refresh_token || tokens.refresh_token
      };
      setCookie(res, tokens, req);
      u = await authUser(tokens.access_token);
    }
  }
  if (!u.ok) { clearCookie(res, req); return null; }
  const user = publicUser(u.data, tokens);
  // Ownership is persisted in the database, so it survives env/config changes
  // and works for username-based accounts too.
  if (!user.isAdmin) {
    try {
      const row = await getRow(user.uid, user.email, false, false);
      if (row?.is_admin) user.isAdmin = true;
    } catch { /* env list still applies */ }
  }
  return { user, tokens };
}
async function requireUser(req, res) {
  const s = await getSession(req, res);
  if (!s) { fail(res, 401, 'Silakan masuk terlebih dahulu.', 'unauthorized'); return null; }
  return s;
}
async function requireAdmin(req, res) {
  const s = await requireUser(req, res);
  if (!s) return null;
  if (!s.user.isAdmin) { fail(res, 403, 'Akses master diperlukan.', 'forbidden'); return null; }
  return s;
}

/* --------------------------------------------------------------- JSON path */
const splitPath = (p) => String(p || '').split('/').filter(Boolean);
function assertOwner(segments, uid, isAdmin) {
  if (segments[0] !== 'users') throw new Error('Path tidak valid.');
  const target = segments[1];
  if (!target) throw new Error('Path tidak valid.');
  if (target !== uid && !isAdmin) throw new Error('Akses ditolak.');
  return segments.slice(2);
}
function getAt(obj, keys) {
  let cur = obj;
  for (const k of keys) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return null;
    cur = cur[k];
  }
  return cur === undefined ? null : cur;
}
function setAt(obj, keys, value) {
  if (!keys.length) return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (typeof cur[k] !== 'object' || cur[k] === null || Array.isArray(cur[k])) cur[k] = {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
  return obj;
}
function updateAt(obj, keys, patch) {
  const clean = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  if (!keys.length) return { ...obj, ...clean };
  const cur = getAt(obj, keys);
  const merged = cur && typeof cur === 'object' && !Array.isArray(cur) ? { ...cur, ...clean } : { ...clean };
  return setAt(obj, keys, merged);
}
function deleteAt(obj, keys) {
  if (!keys.length) return {};
  const parent = getAt(obj, keys.slice(0, -1));
  if (parent && typeof parent === 'object') delete parent[keys[keys.length - 1]];
  return obj;
}

/* --------------------------------------------------------------- API */
async function handleApi(req, res, url, method, p) {
  if (p === '/api/health' && method === 'GET') {
    // Read-only probes so a deployed instance can confirm its Supabase wiring.
    const probe = async (...args) => { try { return await sbFetch(...args); } catch { return { ok: false }; } };
    const [rest, authSettings, authAdmin] = await Promise.all([
      probe('/rest/v1/titan_vault_users?select=uid&limit=1'),
      probe('/auth/v1/settings', { key: ANON_KEY }),
      probe('/auth/v1/admin/users?per_page=1', { key: SERVICE_KEY })
    ]);
    return ok(res, {
      status: (rest.ok && authSettings.ok && authAdmin.ok) ? 'healthy' : 'degraded',
      app: 'Titan Vault',
      time: new Date().toISOString(),
      checks: {
        database: rest.ok,
        authAnonKey: authSettings.ok,
        authAdminApi: authAdmin.ok
      }
    });
  }
  if (p === '/api/config' && method === 'GET') {
    return ok(res, { plans: PLANS, paymentMethods: PAYMENT_METHODS, ownerWhatsapp: OWNER_WHATSAPP, googleEnabled: GOOGLE_OAUTH_ENABLED });
  }

  if (p === '/api/oauth-google' && method === 'GET') {
    if (!GOOGLE_OAUTH_ENABLED) {
      return ok(res, { enabled: false, error: 'Google sign-in belum diaktifkan. Gunakan email & password, atau aktifkan provider Google di Supabase Auth.' });
    }
    const redirectTo = originOf(req) + '/auth-callback.html';
    const authUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}&response_type=token`;
    return ok(res, { enabled: true, url: authUrl });
  }

  if (p === '/api/register' && method === 'POST') {
    if (!checkMutation(req, res)) return;
    const body = await readBody(req);
    const loginInput = String(body.email || '').trim().toLowerCase();
    const email = normalizeLogin(loginInput);
    const password = String(body.password || '');
    const name = String(body.name || '').trim().slice(0, 120) || loginLabel(loginInput);
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(res, 400, 'Email atau username tidak valid.');
    if (password.length < 6) return fail(res, 400, 'Password minimal 6 karakter.');
    const created = await sbFetch('/auth/v1/admin/users', {
      method: 'POST',
      body: { email, password, email_confirm: true, user_metadata: { name, login: loginLabel(loginInput) } }
    });
    if (!created.ok) {
      const msg = created.data?.msg || created.data?.message || (typeof created.data === 'string' ? created.data : '');
      if (created.status === 422 || /already|registered|exist|duplicate/i.test(msg)) {
        return fail(res, 409, 'Email sudah terdaftar. Silakan masuk.');
      }
      return fail(res, 400, msg || 'Gagal membuat akun.');
    }
    const granted = await authGrant({ email, password }, 'password');
    if (!granted.ok) return fail(res, 400, 'Akun dibuat, tapi gagal masuk otomatis. Silakan masuk manual.');
    const tokens = { access_token: granted.data.access_token, refresh_token: granted.data.refresh_token };
    setCookie(res, tokens, req);
    const user = publicUser(granted.data.user || created.data, tokens);
    await getRow(user.uid, email, user.isAdmin, true);
    await logEvent(user, 'register', { email, name });
    return ok(res, { user });
  }

  if (p === '/api/login' && method === 'POST') {
    if (!checkMutation(req, res)) return;
    const body = await readBody(req);
    const email = normalizeLogin(body.email);
    const password = String(body.password || '');
    const granted = email ? await authGrant({ email, password }, 'password') : { ok: false };
    if (!granted.ok) return fail(res, 401, 'Email/username atau password salah.');
    const tokens = { access_token: granted.data.access_token, refresh_token: granted.data.refresh_token };
    setCookie(res, tokens, req);
    const user = publicUser(granted.data.user, tokens);
    await getRow(user.uid, email, user.isAdmin, true);
    await logEvent(user, 'login', { email });
    return ok(res, { user });
  }

  if (p === '/api/logout' && method === 'POST') {
    if (!checkMutation(req, res)) return;
    clearCookie(res, req);
    return ok(res, {});
  }

  if (p === '/api/oauth-session' && method === 'POST') {
    if (!checkMutation(req, res)) return;
    const body = await readBody(req);
    const access = String(body.access_token || '');
    const refresh = String(body.refresh_token || '');
    if (!access) return fail(res, 400, 'Token tidak ada.');
    const u = await authUser(access);
    if (!u.ok) return fail(res, 401, 'Token tidak valid.');
    const tokens = { access_token: access, refresh_token: refresh };
    setCookie(res, tokens, req);
    const user = publicUser(u.data, tokens);
    await getRow(user.uid, user.email, user.isAdmin, true);
    await logEvent(user, 'oauth_login', { email: user.email });
    return ok(res, { user });
  }

  if (p === '/api/session' && method === 'GET') {
    const s = await getSession(req, res);
    return ok(res, { user: s ? s.user : null });
  }

  if (p === '/api/state') {
    const s = await requireUser(req, res);
    if (!s) return;
    let keys;
    try { keys = assertOwner(splitPath(url.searchParams.get('path')), s.user.uid, s.user.isAdmin); }
    catch (err) { return fail(res, 400, err.message); }
    const row = await getRow(s.user.uid, s.user.email, s.user.isAdmin, true);
    const raw = row.data && typeof row.data === 'object' ? row.data : {};
    const data = decryptCredentials(raw); // work on plaintext credentials in memory
    if (method === 'GET') {
      const value = keys.length ? getAt(data, keys) : data;
      return ok(res, { value: value === undefined ? null : value });
    }
    if (!checkMutation(req, res)) return;
    const body = await readBody(req);
    let next;
    if (method === 'PUT') {
      next = keys.length ? setAt({ ...data }, keys, body.value) : setAt({}, [], body.value);
    } else if (method === 'PATCH') {
      next = keys.length ? updateAt({ ...data }, keys, body.patch) : updateAt({ ...data }, [], body.patch);
    } else if (method === 'DELETE') {
      next = keys.length ? deleteAt({ ...data }, keys) : {};
    } else {
      return fail(res, 405, 'Metode tidak didukung.');
    }

    // A bot start/stop is a real persisted command, recorded in the audit log
    // and consumed by the MT5 bridge worker through /api/admin-commands.
    if (method === 'PATCH' && body.patch && typeof body.patch.botRunning === 'boolean'
        && keys.join('/').includes('accounts/')) {
      await logEvent(s.user, body.patch.botRunning ? 'bot_start' : 'bot_stop', {
        path: keys.join('/'), target: keys[1] || s.user.uid
      });
    }

    const saved = await saveRow(row, encryptCredentials(next)); // never store plaintext
    if (!saved.ok) return fail(res, 502, 'Gagal menyimpan data ke database.');
    const value = keys.length ? getAt(next, keys) : next;
    return ok(res, { value: value === undefined ? null : value });
  }

  if (p === '/api/admin-users' && method === 'GET') {
    const s = await requireAdmin(req, res);
    if (!s) return;
    const r = await sbFetch('/rest/v1/titan_vault_users?select=*&order=created_at.desc');
    const rows = Array.isArray(r.data) ? r.data : [];
    const users = rows.map((row) => {
      const d = row.data && typeof row.data === 'object' ? row.data : {};
      const accounts = d.accounts && typeof d.accounts === 'object' ? d.accounts : {};
      return {
        uid: row.uid,
        email: d.login || d.email || row.email,
        name: d.name || '',
        isOwner: !!row.is_admin || ADMIN_EMAILS.includes(String(row.email || '').toLowerCase()),
        plan: d.plan || 'bronze',
        status: d.status || 'pending',
        startedDate: d.startedDate || null,
        renewalDate: d.renewalDate || null,
        accountCount: Object.keys(accounts).length,
        botsRunning: Object.values(accounts).filter((a) => a && a.botRunning).length,
        payments: d.payments && typeof d.payments === 'object' ? d.payments : {},
        createdAt: row.created_at
      };
    });
    return ok(res, { users });
  }

  if (p === '/api/admin-user' && method === 'PATCH') {
    const s = await requireAdmin(req, res);
    if (!s) return;
    if (!checkMutation(req, res)) return;
    const uid = String(url.searchParams.get('uid') || '');
    if (!uid) return fail(res, 400, 'UID pengguna tidak ada.');
    const row = await getRow(uid, '', false, false);
    if (!row) return fail(res, 404, 'Pengguna tidak ditemukan.');
    const body = await readBody(req);
    const data = { ...(row.data && typeof row.data === 'object' ? row.data : {}) };

    if (['pro', 'bronze', 'platinum'].includes(body.plan)) data.plan = body.plan;
    if (['active', 'pending', 'inactive'].includes(body.status)) {
      data.status = body.status;
      const now = new Date();
      if (body.status === 'active') {
        if (!data.startedDate) data.startedDate = now.toISOString();
        if (!data.renewalDate) data.renewalDate = new Date(now.getTime() + 30 * 86400000).toISOString();
      }
      if (body.status !== 'active' && data.accounts && typeof data.accounts === 'object') {
        Object.keys(data.accounts).forEach((k) => {
          if (data.accounts[k] && typeof data.accounts[k] === 'object') data.accounts[k].botRunning = false;
        });
      }
    }
    if (body.startedDate) data.startedDate = String(body.startedDate).slice(0, 60);
    if (body.renewalDate) data.renewalDate = String(body.renewalDate).slice(0, 60);
    if (body.approvePaymentKey && data.payments && data.payments[body.approvePaymentKey]) {
      data.payments[body.approvePaymentKey].status = 'active';
    }
    if (body.rejectPaymentKey && data.payments && data.payments[body.rejectPaymentKey]) {
      data.payments[body.rejectPaymentKey].status = 'rejected';
    }

    const saved = await saveRow(row, data);
    if (!saved.ok) return fail(res, 502, 'Gagal menyimpan perubahan.');
    await logEvent(s.user, 'admin_update_user', { uid, plan: data.plan, status: data.status });
    return ok(res, { uid, plan: data.plan, status: data.status });
  }

  // Real control-plane feed: the MT5 bridge worker polls this endpoint to pick
  // up start/stop commands. Broker passwords are never returned here.
  if (p === '/api/admin-commands' && method === 'GET') {
    const s = await requireAdmin(req, res);
    if (!s) return;
    const r = await sbFetch('/rest/v1/titan_vault_users?select=uid,email,data');
    const rows = Array.isArray(r.data) ? r.data : [];
    const commands = [];
    for (const row of rows) {
      const d = row.data && typeof row.data === 'object' ? row.data : {};
      if (d.status !== 'active') continue;
      const accounts = d.accounts && typeof d.accounts === 'object' ? d.accounts : {};
      for (const [accId, acc] of Object.entries(accounts)) {
        if (!acc || typeof acc !== 'object') continue;
        commands.push({
          uid: row.uid,
          email: row.email,
          accountId: accId,
          accountName: acc.name || '',
          broker: acc.broker || '',
          platform: acc.platform || 'MT5',
          server: acc.server || '',
          login: acc.login || '',
          running: !!acc.botRunning
        });
      }
    }
    return ok(res, { commands, generatedAt: new Date().toISOString() });
  }

  if (p === '/api/admin-events' && method === 'GET') {
    const s = await requireAdmin(req, res);
    if (!s) return;
    const r = await sbFetch('/rest/v1/titan_vault_events?select=*&order=created_at.desc&limit=100');
    return ok(res, { events: Array.isArray(r.data) ? r.data : [] });
  }

  return fail(res, 404, 'Endpoint tidak ditemukan.', 'not_found');
}

/* --------------------------------------------------------------- static */
function serveStatic(req, res, pathname) {
  let rel;
  if (pathname === '/' || pathname === '/index.html' || pathname === '/app' || pathname === '/app.html') rel = 'index.html';
  else if (pathname === '/admin' || pathname === '/admin.html') rel = 'admin.html';
  else if (pathname === '/auth/callback.html' || pathname === '/auth-callback.html') rel = 'auth-callback.html';
  else rel = pathname.replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!filePath.startsWith(PUBLIC_DIR)) return fail(res, 403, 'Akses ditolak.', 'forbidden');
  fs.readFile(filePath, (err, data) => {
    if (err) return fail(res, 404, 'Tidak ditemukan.', 'not_found');
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
      '.zip': 'application/zip', '.txt': 'text/plain; charset=utf-8'
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

/* --------------------------------------------------------------- handler */
export async function handler(req, res) {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const method = req.method || 'GET';
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url, method, url.pathname);
    return serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error('[titan-vault]', err);
    return fail(res, 500, err?.message || 'Kesalahan server.', 'server_error');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  http.createServer((req, res) => { handler(req, res).catch(() => {}); })
    .listen(PORT, HOST, () => console.log(`Titan Vault berjalan di http://${HOST}:${PORT}`));
}

// Exported for the smoke test's pure-function checks.
export { normalizeLogin, publicUser };
