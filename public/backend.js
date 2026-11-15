/* Titan Vault — real backend bridge.
   Provides the same Firebase-shaped globals the portal UI expects, but talks to
   our own API (Supabase Auth + Postgres). No simulation, no demo data. */
(function () {
  'use strict';

  const auth = { __titan: true };
  const db = { __titan: true };
  const provider = { __google: true };
  let currentUser = null;
  let sessionLoaded = false;
  const listeners = [];
  const pollers = new Map();

  function emit() {
    listeners.slice().forEach((cb) => { try { cb(currentUser); } catch (e) { console.error(e); } });
  }
  function setUser(u) {
    currentUser = u || null;
    sessionLoaded = true;
    emit();
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Titan-Client': '1',
        ...(options.headers || {})
      }
    });
    let data = {};
    try { data = await response.json(); } catch { /* ignore */ }
    if (!response.ok || data.ok === false) {
      const err = new Error(data.error || `Permintaan gagal (${response.status})`);
      err.status = response.status;
      throw err;
    }
    return data;
  }

  function ref(dbOrPath, pathMaybe) {
    const p = typeof dbOrPath === 'string' ? dbOrPath : String(pathMaybe || '');
    return { path: p, __ref: true };
  }
  const query = (r) => '/api/state?path=' + encodeURIComponent(r.path);

  // All writes go through POST with an explicit operation, so the browser
  // never depends on PUT/PATCH/DELETE being routed by the hosting platform.
  function write(op, r, payload) {
    return api('/api/state', {
      method: 'POST',
      body: JSON.stringify({ op, path: r.path, ...payload })
    }).then((d) => { refresh(); return d.value; });
  }
  function set(r, value) { return write('set', r, { value }); }
  function update(r, patch) { return write('update', r, { patch }); }
  function remove(r) { return write('remove', r, {}); }
  function get(r) {
    return api(query(r)).then((d) => d.value);
  }
  function push(r) {
    const key = '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    return { path: r.path.replace(/\/$/, '') + '/' + key, __ref: true };
  }
  function onValue(r, cb) {
    const pathname = r.path;
    if (pollers.has(pathname)) clearInterval(pollers.get(pathname));
    let last = null;
    let first = true;
    const tick = async () => {
      try {
        const d = await api(query(r));
        const value = d.value === undefined ? null : d.value;
        const serialized = JSON.stringify(value);
        if (first || serialized !== last) {
          first = false;
          last = serialized;
          cb({ val: () => value, exists: () => value !== null, key: pathname.split('/').pop() });
        }
      } catch { /* transient error: keep listening */ }
    };
    tick();
    const id = setInterval(tick, 4000);
    pollers.set(pathname, { id, tick });
    return () => { clearInterval(id); pollers.delete(pathname); };
  }
  function clearPollers() {
    pollers.forEach(({ id }) => clearInterval(id));
    pollers.clear();
  }
  // Re-read immediately after a write instead of waiting for the next poll.
  function refresh() {
    pollers.forEach(({ tick }) => { try { tick(); } catch (e) { /* ignore */ } });
  }

  const fbAuthMethods = {
    async signInWithEmailAndPassword(_auth, email, password) {
      const d = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      setUser(d.user);
      return { user: d.user };
    },
    async createUserWithEmailAndPassword(_auth, email, password, name) {
      const d = await api('/api/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name: name || '' })
      });
      setUser(d.user);
      return { user: d.user };
    },
    async signInWithPopup() {
      const d = await api('/api/oauth-google');
      if (!d.enabled) throw new Error(d.error || 'Google sign-in belum diaktifkan. Gunakan email & password.');
      window.location.href = d.url;
      return new Promise(() => {}); // navigation takes over
    },
    async signOut() {
      try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch { /* ignore */ }
      clearPollers();
      setUser(null);
    },
    onAuthStateChanged(_auth, cb) {
      listeners.push(cb);
      if (sessionLoaded) { try { cb(currentUser); } catch (e) { /* ignore */ } }
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    }
  };

  window.firebaseAuth = auth;
  window.firebaseDb = db;
  window.googleProvider = provider;
  window.rtdbMethods = { ref, set, get, onValue, update, push, remove };
  window.titanRefresh = refresh;
  window.fbAuthMethods = fbAuthMethods;

  // Mirror Firebase's onAuthStateChanged observer used by the original page.
  fbAuthMethods.onAuthStateChanged(auth, (user) => {
    const portal = document.getElementById('portal-section');
    const authSection = document.getElementById('auth-section');
    const navAdmin = document.getElementById('nav-admin');
    if (user) {
      if (authSection) authSection.classList.add('hidden');
      if (portal) portal.classList.remove('hidden');
      if (navAdmin) navAdmin.classList.toggle('hidden', !user.isAdmin);
      if (typeof window.listenToUserData === 'function') window.listenToUserData({ ...user, email: user.login || user.email });
    } else {
      clearPollers();
      if (portal) portal.classList.add('hidden');
      if (authSection) authSection.classList.remove('hidden');
      if (navAdmin) navAdmin.classList.add('hidden');
    }
  });

  async function checkSession() {
    try {
      const d = await api('/api/session');
      setUser(d.user || null);
    } catch {
      setUser(null);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkSession);
  } else {
    checkSession();
  }
})();
