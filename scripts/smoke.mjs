// Smoke test: boots the Titan Vault server locally and verifies the routes that
// do not need outbound Supabase access, plus static assets and CSRF protection.
// Set TITAN_LIVE_BASE to run the same checks against a deployed instance.
import { spawn } from 'node:child_process';

const BASE = process.env.TITAN_LIVE_BASE || `http://127.0.0.1:${process.env.SMOKE_PORT || 3457}`;
let proc = null;
let passed = 0;
let failed = 0;

function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name} ${extra}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(pathname, { method = 'GET', body = null, headers = {} } = {}) {
  const r = await fetch(BASE + pathname, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === null ? undefined : JSON.stringify(body)
  });
  let data = null;
  let text = '';
  try { text = await r.text(); data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data, text };
}

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) return; } catch {}
    await sleep(200);
  }
  throw new Error('Server did not start.');
}

try {
  if (!process.env.TITAN_LIVE_BASE) {
    proc = spawn('node', ['server.mjs'], {
      cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, PORT: process.env.SMOKE_PORT || '3457', HOST: '127.0.0.1' },
      stdio: 'ignore'
    });
  }
  await waitUp();
  console.log(`Titan Vault smoke @ ${BASE}\n`);

  const health = await req('/api/health');
  check('health ok', health.status === 200 && health.data?.ok === true, JSON.stringify(health.data));
  check('health has no demo flag', health.data?.demo === undefined);

  const config = await req('/api/config');
  check('3 USD plans', config.data?.plans?.length === 3);
  check('plan prices 50/100/250', JSON.stringify(config.data?.plans?.map((p) => p.price)) === '[50,100,250]');
  check('3 real payment methods', config.data?.paymentMethods?.length === 3);
  check('MTN number is 0788087502', config.data?.paymentMethods?.[0]?.number === '0788087502');
  check('TRC20 wallet matches reference', config.data?.paymentMethods?.[2]?.number === 'TBghDNeXQ6sh6g3moaFvt5cPDx2DUEqtYz');

  const page = await req('/');
  check('portal HTML served', page.status === 200 && page.text.includes('Titan Vault - Account Portal'));
  check('portal uses real backend bridge', page.text.includes('/backend.js'));
  check('portal has no simulated flag', !/demo|simulasi|simulation/i.test(page.text));

  const admin = await req('/admin.html');
  check('master dashboard served', admin.status === 200 && admin.text.includes('Master Dashboard'));

  const callback = await req('/auth-callback.html');
  check('OAuth callback served', callback.status === 200 && callback.text.includes('/api/auth/session'));

  const backend = await req('/backend.js');
  check('backend bridge served', backend.status === 200 && backend.text.includes('/api/state'));

  const noSession = await req('/api/session');
  check('session is anonymous when not signed in', noSession.status === 200 && noSession.data?.user === null);

  const guarded = await req('/api/state?path=users/test');
  check('state requires authentication', guarded.status === 401, JSON.stringify(guarded.data));

  const guardedAdmin = await req('/api/admin/users');
  check('admin requires authentication', guardedAdmin.status === 401);

  const noCsrf = await req('/api/auth/login', { method: 'POST', body: { email: 'a@b.co', password: 'secret1' } });
  check('mutation without CSRF header rejected', noCsrf.status === 403, JSON.stringify(noCsrf.data));

  const google = await req('/api/auth/google');
  check('Google provider reports honest disabled state', google.status === 200 && google.data?.enabled === false);

  const missing = await req('/api/does-not-exist');
  check('unknown endpoint 404', missing.status === 404);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  if (proc) proc.kill();
}
