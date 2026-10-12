/* Shared helpers for the AI Map test pages. Plain script (works from file:// without a web server). */
(function () {
  const KEY = 'aimapTest.';
  const get = (k, d) => { try { return localStorage.getItem(KEY + k) ?? d; } catch { return d; } };
  const put = (k, v) => { try { v ? localStorage.setItem(KEY + k, v) : localStorage.removeItem(KEY + k); } catch {} };

  const T = {
    get base() { return get('base', 'http://localhost:8080').replace(/\/+$/, ''); },
    set base(v) { put('base', (v || '').trim().replace(/\/+$/, '')); },
    /** Admin token: ADMIN_API_TOKEN or a session token from login. */
    get token() { return get('token', ''); },
    set token(v) { put('token', v); },
    api(path) { return `${T.base}/api/v1${path}`; },

    /** fetch with timing, request id and JSON parsing; never throws. */
    async call(method, path, body, opts = {}) {
      const headers = {};
      if (body !== undefined) headers['content-type'] = opts.contentType || 'application/json';
      if (opts.auth !== false && T.token) headers.authorization = `Bearer ${T.token}`;
      const t0 = performance.now();
      try {
        const res = await fetch(path.startsWith('http') ? path : T.api(path), { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
        const ms = Math.round(performance.now() - t0);
        const text = await res.text();
        let data = text;
        try { data = text ? JSON.parse(text) : null; } catch {}
        return { ok: res.ok, status: res.status, ms, data, requestId: res.headers.get('x-request-id'), headers: res.headers };
      } catch (err) {
        return { ok: false, status: 0, ms: Math.round(performance.now() - t0), data: `Network/CORS error: ${err.message}`, requestId: null };
      }
    },

    pill(r) {
      const cls = r.status === 0 ? 'bad' : r.ok ? 'ok' : r.status === 401 ? 'warn' : 'bad';
      return `<span class="pill ${cls}">${r.status || 'ERR'}</span> <span class="muted">${r.ms} ms${r.requestId ? ' · id ' + r.requestId.slice(0, 8) : ''}</span>`;
    },

    show(el, r) {
      if (typeof el === 'string') el = document.querySelector(el);
      el.innerHTML = `${T.pill(r)}<pre>${T.esc(typeof r.data === 'string' ? r.data : JSON.stringify(r.data, null, 2))}</pre>`;
    },

    esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); },

    log(el, text) {
      if (typeof el === 'string') el = document.querySelector(el);
      const time = new Date().toLocaleTimeString();
      el.textContent = `${time}  ${text}\n` + el.textContent.slice(0, 20000);
    },

    /** Loads the SDK (global AiMap) from the map server. */
    loadSdk() {
      if (window.AiMap) return Promise.resolve(window.AiMap);
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = `${T.base}/sdk/aimap-sdk.js`;
        s.onload = () => resolve(window.AiMap);
        s.onerror = () => reject(new Error(`Cannot load ${s.src} — is the server running?`));
        document.head.append(s);
      });
    },

    async layers() {
      const r = await T.call('GET', '/layers', undefined, { auth: false });
      return r.ok ? r.data : [];
    },

    /** Header with navigation and server/admin status, shared by every page. */
    header(active) {
      const pages = [['index.html', 'Start'], ['rest.html', 'REST API'], ['embed.html', 'Embed (iframe)'], ['maplibre.html', 'Own MapLibre map'], ['realtime.html', 'Real-time'], ['traffic.html', 'Traffic test']];
      const h = document.createElement('header');
      h.innerHTML = `<h1>AI Map · test pages</h1><nav>${pages.map(([href, label]) => `<a href="${href}" class="${href === active ? 'on' : ''}">${label}</a>`).join('')}</nav>
        <div class="conn"><span>Server <b id="hdr-base"></b></span><span id="hdr-status" class="pill">…</span><span id="hdr-admin" class="pill">…</span></div>`;
      document.body.prepend(h);
      h.querySelector('#hdr-base').textContent = T.base;
      T.refreshHeader();
    },

    async refreshHeader() {
      const st = document.getElementById('hdr-status');
      const ad = document.getElementById('hdr-admin');
      if (!st) return;
      const health = await T.call('GET', '/health', undefined, { auth: false });
      st.className = `pill ${health.ok ? 'ok' : 'bad'}`;
      st.textContent = health.ok ? 'online' : 'offline';
      const session = await T.call('GET', '/auth/session');
      const admin = session.ok && session.data.admin;
      ad.className = `pill ${admin ? 'ok' : 'warn'}`;
      ad.textContent = admin ? 'admin' : T.token ? 'token invalid' : 'viewer (read-only)';
      return admin;
    },
  };
  window.T = T;
})();
