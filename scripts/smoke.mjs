// Smoke test: boots server on ephemeral port, exercises auth, RBAC, plan limits, payments, bot sim.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PORT = 3457;
const BASE = `http://127.0.0.1:${PORT}`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-smoke-'));
const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', TITAN_DATA_DIR: tmpDir };

const proc = spawn('node', ['server.mjs'], { cwd: path.resolve(import.meta.dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
proc.stdout.on('data', d => { out += d; });
proc.stderr.on('data', d => { out += d; });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch {}
    await sleep(200);
  }
  throw new Error('Server did not start. Output:\n' + out);
}

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name} ${extra}`); }
}

async function req(pathname, { method = 'GET', token = null, csrf = null, body = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (csrf) headers['X-CSRF-Token'] = csrf;
  const res = await fetch(BASE + pathname, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data; try { data = await res.json(); } catch { data = {}; }
  return { status: res.status, data };
}

try {
  await waitUp();
  console.log('Server up. Running checks…');

  const health = await req('/api/health');
  check('health ok', health.data.ok === true && health.data.demo === true);

  const boot = await req('/api/bootstrap');
  check('bootstrap has 3 plans', boot.data.plans?.length === 3);
  check('bootstrap has payment methods', boot.data.paymentMethods?.length >= 3);

  // login as client
  const client = await req('/api/auth/login', { method: 'POST', body: { email: 'client@titantrading.demo', password: 'TitanClient!2026' } });
  check('client login', client.status === 200 && client.data.ok, JSON.stringify(client.data));
  const cToken = client.data.sessionToken, cCsrf = client.data.csrfToken;
  check('client token+csrf issued', Boolean(cToken && cCsrf));

  // wrong password rejected
  const bad = await req('/api/auth/login', { method: 'POST', body: { email: 'client@titantrading.demo', password: 'wrong-password-1' } });
  check('wrong password rejected 401', bad.status === 401);

  // client cannot access admin
  const admAsClient = await req('/api/admin/overview', { token: cToken });
  check('client blocked from admin 403', admAsClient.status === 403);

  // client overview
  const ov = await req('/api/client/overview', { token: cToken });
  check('client overview ok', ov.data.ok === true && ov.data.stats.accountCount === 2);
  check('client sub active (pro)', ov.data.stats.subscriptionActive === true);

  // CSRF required on mutation
  const noCsrf = await req('/api/client/accounts', { method: 'POST', token: cToken, body: { label: 'X', broker: 'B', platform: 'MT5', server: 'S', loginId: 'D1' } });
  check('mutation without CSRF rejected 403', noCsrf.status === 403);

  // plan limit: pro = 3 accounts, client has 2 -> 1 more ok, next rejected
  const add1 = await req('/api/client/accounts', { method: 'POST', token: cToken, csrf: cCsrf, body: { label: 'Demo 3', broker: 'Broker Demo', platform: 'MT5', server: 'Demo-Server-01', loginId: 'DEMO-100003' } });
  check('add 3rd account ok (pro limit 3)', add1.status === 200, JSON.stringify(add1.data));
  const add2 = await req('/api/client/accounts', { method: 'POST', token: cToken, csrf: cCsrf, body: { label: 'Demo 4', broker: 'Broker Demo', platform: 'MT5', server: 'S', loginId: 'DEMO-100004' } });
  check('add 4th account rejected plan_limit', add2.status === 403 && add2.data.code === 'plan_limit', JSON.stringify(add2.data));

  // password field must never be accepted as loginId containing password
  const pw = await req('/api/client/accounts', { method: 'POST', token: cToken, csrf: cCsrf, body: { label: 'Evil', broker: 'B', platform: 'MT5', server: 'S', loginId: 'mypassword123' } });
  check('loginId containing "password" rejected', pw.status === 400);

  // bot start/stop simulation
  const accId = add1.data.account.id;
  const start = await req(`/api/client/accounts/${accId}/bot`, { method: 'POST', token: cToken, csrf: cCsrf, body: { action: 'start' } });
  check('bot start (simulated)', start.status === 200 && start.data.account.bot.state === 'running');
  const stop = await req(`/api/client/accounts/${accId}/bot`, { method: 'POST', token: cToken, csrf: cCsrf, body: { action: 'stop' } });
  check('bot stop (simulated)', stop.status === 200 && stop.data.account.bot.state === 'stopped');

  // pending user cannot start bot
  const pend = await req('/api/auth/login', { method: 'POST', body: { email: 'pending@titantrading.demo', password: 'TitanPending!2026' } });
  check('pending user login', pend.status === 200);
  const pToken = pend.data.sessionToken, pCsrf = pend.data.csrfToken;
  const pAcc = await req('/api/client/accounts', { method: 'POST', token: pToken, csrf: pCsrf, body: { label: 'P1', broker: 'B', platform: 'MT4', server: 'S', loginId: 'DEMO-P1' } });
  check('pending user can add account (starter limit 1)', pAcc.status === 200, JSON.stringify(pAcc.data));
  const pStart = await req(`/api/client/accounts/${pAcc.data.account.id}/bot`, { method: 'POST', token: pToken, csrf: pCsrf, body: { action: 'start' } });
  check('pending user bot start blocked subscription_inactive', pStart.status === 403 && pStart.data.code === 'subscription_inactive', JSON.stringify(pStart.data));

  // pending user submits payment, admin approves
  const pay = await req('/api/client/payments', { method: 'POST', token: pToken, csrf: pCsrf, body: { planId: 'starter', method: 'qris_demo', senderName: 'Calon Klien Demo', reference: 'DEMO-REF-9999', note: 'smoke' } });
  check('payment submit ok', pay.status === 200 && pay.data.payment.status === 'pending');
  const payId = pay.data.payment.id;

  // admin login + approve
  const admin = await req('/api/auth/login', { method: 'POST', body: { email: 'admin@titantrading.demo', password: 'TitanAdmin!2026' } });
  check('admin login', admin.status === 200 && admin.data.user.role === 'admin');
  const aToken = admin.data.sessionToken, aCsrf = admin.data.csrfToken;
  const approve = await req(`/api/admin/payments/${payId}/approve`, { method: 'POST', token: aToken, csrf: aCsrf, body: {} });
  check('admin approves payment', approve.status === 200 && approve.data.payment.status === 'approved');
  const approve2 = await req(`/api/admin/payments/${payId}/approve`, { method: 'POST', token: aToken, csrf: aCsrf, body: {} });
  check('double approve rejected 409', approve2.status === 409);

  // after approval, pending user can start bot
  const pStart2 = await req(`/api/client/accounts/${pAcc.data.account.id}/bot`, { method: 'POST', token: pToken, csrf: pCsrf, body: { action: 'start' } });
  check('bot start works after approval', pStart2.status === 200 && pStart2.data.account.bot.state === 'running', JSON.stringify(pStart2.data));

  // register new user
  const reg = await req('/api/auth/register', { method: 'POST', body: { name: 'Smoke User', email: 'smoke@example.com', password: 'SmokePass!2026' } });
  check('register ok', reg.status === 200 && reg.data.user.subscription.status === 'pending');
  const dup = await req('/api/auth/register', { method: 'POST', body: { name: 'Smoke User', email: 'smoke@example.com', password: 'SmokePass!2026' } });
  check('duplicate email rejected 409', dup.status === 409);

  // static pages serve
  const idx = await fetch(BASE + '/');
  check('index.html serves', idx.status === 200 && (await idx.text()).includes('TitanTrading'));
  const app = await fetch(BASE + '/app');
  check('app.html serves', app.status === 200);
  const adm = await fetch(BASE + '/admin');
  check('admin.html serves', adm.status === 200);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
} finally {
  proc.kill('SIGTERM');
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
