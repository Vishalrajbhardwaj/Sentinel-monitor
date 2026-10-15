/* Sentinel dashboard — vanilla JS PWA. All server/attacker supplied strings go through esc(). */
(() => {
  'use strict';
  const C = window.Charts;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------------------------------------------------------- icons
  const I = {
    overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/></svg>',
    routes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 7v10M6 12h4a4 4 0 0 0 4-4V8m0 8v-.5A3.5 3.5 0 0 0 10.5 12"/></svg>',
    security: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.4 7.5 9.5 4.4-1.1 7.5-4.9 7.5-9.5V6L12 3Z"/><path d="M12 8v4.5M12 16h.01"/></svg>',
    servers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4" width="17" height="6.5" rx="1.5"/><rect x="3.5" y="13.5" width="17" height="6.5" rx="1.5"/><path d="M7 7.25h.01M7 16.75h.01M11 7.25h6M11 16.75h6"/></svg>',
    reports: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
    alerts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 5v14l11-7L7 5Z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14"/></svg>',
  };
  const BRAND = '<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="8" fill="var(--inset)" stroke="var(--line-2)"/><rect x="6" y="6" width="9" height="9" rx="2.2" fill="var(--good)"/><rect x="17" y="6" width="9" height="9" rx="2.2" fill="var(--unlit)" stroke="var(--line-2)"/><rect x="6" y="17" width="9" height="9" rx="2.2" fill="var(--unlit)" stroke="var(--line-2)"/><rect x="17" y="17" width="9" height="9" rx="2.2" fill="var(--unlit)" stroke="var(--line-2)"/></svg>';

  function lamp(status) {
    const s = { ok: 'ok', degraded: 'degraded', mismatch: 'mismatch', down: 'down' }[status] || 'pending';
    const shapes = {
      ok: '<circle cx="7" cy="7" r="5.5" fill="currentColor"/>',
      degraded: '<path d="M7 1.3 13 12.2H1Z" fill="currentColor"/>',
      mismatch: '<rect x="1.8" y="1.8" width="10.4" height="10.4" rx="1.6" fill="currentColor"/>',
      down: '<path d="M4.4 1h5.2L13 4.4v5.2L9.6 13H4.4L1 9.6V4.4Z" fill="currentColor"/><path d="m4.8 4.8 4.4 4.4m0-4.4-4.4 4.4" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>',
      pending: '<circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/>',
    };
    const label = { ok: 'Healthy', degraded: 'Slow', mismatch: 'Wrong result', down: 'Down', pending: 'Pending' }[s];
    return `<svg class="lamp s-${s}" viewBox="0 0 14 14" role="img" aria-label="${label}">${shapes[s]}</svg>`;
  }
  const STATUS_WORD = { ok: 'Healthy', degraded: 'Slow', mismatch: 'Wrong result', down: 'Down', pending: 'Pending' };
  const SEV_LABEL = { critical: 'Critical', high: 'High', warning: 'Warning', info: 'Info' };
  const sevBadge = (s) => `<span class="sev sev-${esc(s)}">${SEV_LABEL[s] || esc(s)}</span>`;
  const ISSUE = {
    DNS_FAILURE: 'DNS failure', CONNECTION_REFUSED: 'Connection refused', TIMEOUT: 'Timeout', TLS_ERROR: 'SSL/TLS error', NETWORK_ERROR: 'Network error',
    HTTP_5XX: 'Server error (5xx)', HTTP_502_504: 'Gateway error', AUTH_FAILED: 'Auth rejected', NOT_FOUND: 'Route not found (404)', RATE_LIMITED: 'Rate limited',
    STATUS_MISMATCH: 'Unexpected status', BODY_MISMATCH: 'Response mismatch', SLOW_RESPONSE: 'Slow response', SSL_EXPIRING: 'SSL expiring',
  };

  // ---------------------------------------------------------------- formatting
  const ago = (t) => {
    if (!t) return 'never';
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 10) return 'just now';
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  };
  const hhmm = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const hourRange = (a, b) => `${new Date(a).toLocaleDateString([], { day: '2-digit', month: 'short' })}, ${hhmm(a)}–${hhmm(b)}`;
  const ms = (v) => (v == null ? '—' : v >= 1000 ? (v / 1000).toFixed(1) + ' s' : v + ' ms');
  const pct = (v, d = 0) => (v == null ? '—' : (+v).toFixed(d) + '%');
  const bytes = (b) => { if (b == null) return '—'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return `${b.toFixed(b < 10 && i ? 1 : 0)} ${u[i]}`; };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const dur = (sec) => { const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600); return d ? `${d}d ${h}h` : `${h}h ${Math.floor((sec % 3600) / 60)}m`; };

  // ---------------------------------------------------------------- state & api
  const S = {
    token: localStorage.getItem('sentinel.token') || '',
    info: null, ov: null, settings: null, serverSel: localStorage.getItem('sentinel.server') || null,
    threatCat: 'all', routeFilter: 'all', alertFilter: 'open', live: {}, cache: {}, installEvt: null, connected: false,
  };

  async function api(path, opts = {}) {
    const r = await fetch('/api' + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.token },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (r.status === 401) { logout(); throw new Error('Signed out'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Request failed (' + r.status + ')');
    return data;
  }

  function toast(title, body = '', kind = '') {
    const box = $('#toasts');
    if (!box) return;
    while (box.children.length >= 3) box.firstChild.remove();
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    const b = document.createElement('b'); b.textContent = title; t.appendChild(b);
    if (body) t.appendChild(document.createTextNode(body));
    box.appendChild(t);
    setTimeout(() => t.remove(), 6000);
  }

  // ---------------------------------------------------------------- login
  function renderLogin(msg = '') {
    document.body.innerHTML = `
      <main class="login"><form class="login-card" id="loginForm">
        <div class="brand">${BRAND}<div><div class="brand-name">Sentinel</div><div class="brand-host">Server &amp; security monitor</div></div></div>
        <div class="login-lamps" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <h1>Sign in</h1>
        <p>Use the dashboard password from your server’s .env file.</p>
        <div class="field"><label for="pw">Password</label><input class="input" id="pw" type="password" autocomplete="current-password" required autofocus></div>
        <div class="err" id="loginErr">${esc(msg)}</div>
        <button class="btn btn-primary" style="width:100%;height:42px;margin-top:6px">Sign in</button>
      </form></main>`;
    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button'); btn.disabled = true;
      try {
        const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('#pw').value }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Sign in failed');
        S.token = d.token; localStorage.setItem('sentinel.token', d.token);
        boot();
      } catch (err) { $('#loginErr').textContent = err.message; btn.disabled = false; }
    });
  }
  function logout() {
    S.token = ''; localStorage.removeItem('sentinel.token');
    if (S.es) S.es.close();
    renderLogin();
  }

  // ---------------------------------------------------------------- shell
  const NAV = [
    ['overview', 'Overview', '#/'], ['routes', 'Routes', '#/routes'], ['security', 'Security', '#/security'],
    ['servers', 'Servers', '#/servers'], ['reports', 'Reports', '#/reports'],
  ];
  function renderShell() {
    const name = esc(S.info?.name || 'server');
    document.body.innerHTML = `
      <div class="app">
        <nav class="rail" aria-label="Main">
          <div class="brand">${BRAND}<div><div class="brand-name">Sentinel</div><div class="brand-host">${name}</div></div></div>
          ${NAV.map(([k, l, h]) => `<a class="nav-link" href="${h}" data-nav="${k}">${I[k]}<span>${l}</span><span class="nav-badge hidden" data-badge="${k}"></span></a>`).join('')}
          <a class="nav-link" href="#/alerts" data-nav="alerts">${I.alerts}<span>Alerts</span><span class="nav-badge hidden" data-badge="alerts"></span></a>
          <div class="rail-foot">
            <a class="nav-link" href="#/settings" data-nav="settings">${I.settings}<span>Settings</span></a>
            <div class="conn"><span class="live-dot" id="liveDot"></span><span id="liveTxt">Connecting…</span></div>
          </div>
        </nav>
        <header class="topbar">
          <div class="brand">${BRAND}<div><div class="brand-name">Sentinel</div><div class="brand-host">${name}</div></div></div>
          <div class="acts">
            <span class="live-dot" id="liveDot2" title="Live connection"></span>
            <a class="btn btn-ghost icon-btn" href="#/alerts" aria-label="Alerts" style="position:relative">${I.alerts}<span class="nav-badge hidden" data-badge="alerts" style="position:absolute;top:-2px;right:-4px;transform:scale(.85)"></span></a>
            <a class="btn btn-ghost icon-btn" href="#/settings" aria-label="Settings">${I.settings}</a>
          </div>
        </header>
        <main class="main" id="view" tabindex="-1"></main>
        <nav class="tabbar" aria-label="Main">
          ${NAV.map(([k, l, h]) => `<a href="${h}" data-nav="${k}">${I[k]}<span>${l}</span><i class="dot hidden" data-dot="${k}"></i></a>`).join('')}
        </nav>
      </div>
      <div class="toasts" id="toasts" aria-live="polite"></div>
      <dialog class="sheet" id="sheet"></dialog>`;
  }

  function setNav(key) {
    $$('[data-nav]').forEach((a) => (a.dataset.nav === key ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  }

  function updateBadges(ov) {
    if (!ov) return;
    const open = ov.alerts || [];
    const cnt = (cat) => open.filter((a) => (cat ? a.category === cat || (cat === 'security' && a.category === 'ransomware') : true));
    const set = (key, list) => {
      const crit = list.some((a) => a.severity === 'critical');
      $$(`[data-badge="${key}"]`).forEach((b) => { b.textContent = list.length; b.className = `nav-badge ${crit ? 'critical' : 'caution'}${list.length ? '' : ' hidden'}`; });
      $$(`[data-dot="${key}"]`).forEach((d) => { d.classList.toggle('hidden', !list.length); d.style.background = crit ? 'var(--critical)' : 'var(--caution)'; });
    };
    set('alerts', open);
    set('routes', open.filter((a) => a.routeId));
    set('security', cnt('security'));
    set('servers', cnt('resources').concat(open.filter((a) => a.key.startsWith('offline:'))));
    const lvl = ov.status.level;
    document.title = (lvl === 'critical' ? '● ' : lvl === 'warning' ? '▲ ' : '') + 'Sentinel';
  }

  // ---------------------------------------------------------------- router
  let currentView = null;
  let renderToken = 0;
  async function route() {
    const hash = location.hash.replace(/^#/, '') || '/';
    const parts = hash.split('/').filter(Boolean);
    const view = parts[0] || 'overview';
    const map = { overview: viewOverview, routes: parts[1] ? () => viewRoute(parts[1]) : viewRoutes, security: viewSecurity, servers: viewServers, reports: parts[1] ? () => viewReport(parts[1]) : viewReports, alerts: viewAlerts, settings: viewSettings };
    const fn = map[view] || viewOverview;
    setNav(view === 'overview' ? 'overview' : view);
    currentView = { fn, key: hash };
    const my = ++renderToken;
    try { await fn(my); } catch (e) { if (my === renderToken) $('#view').innerHTML = `<div class="empty"><strong>Couldn’t load this page</strong>${esc(e.message)}</div>`; }
    C.hideTip();
  }
  async function refresh() { if (currentView) { const my = ++renderToken; try { await currentView.fn(my, true); } catch {} } }
  const view = () => $('#view');
  const stale = (my) => my !== renderToken;

  // ---------------------------------------------------------------- OVERVIEW
  function annunciator(ov) {
    const open = ov.alerts || [];
    const worst = (list) => (list.some((a) => a.severity === 'critical') ? 'critical' : list.some((a) => a.severity === 'high') ? 'serious' : list.length ? 'caution' : '');
    const byKey = (p) => open.filter((a) => a.key.startsWith(p));
    const c = ov.counts;
    const servers = ov.servers || [];
    const maxOf = (f) => Math.max(0, ...servers.filter((s) => s.online && s.latest).map(f));
    const hourTraffic = Object.values(ov.hour?.traffic || {}).reduce((a, t) => ({ req: a.req + t.req, s5: a.s5 + t.s5 }), { req: 0, s5: 0 });
    const secOpen = open.filter((a) => a.category === 'security');
    const ransom = open.filter((a) => a.category === 'ransomware');
    const tiles = [
      { k: 'ROUTES', href: '#/routes', lit: c.down ? 'critical' : c.mismatch ? 'serious' : c.degraded ? 'caution' : '', v: c.down || c.mismatch || c.degraded ? [c.down && `${c.down} down`, c.mismatch && `${c.mismatch} wrong`, c.degraded && `${c.degraded} slow`].filter(Boolean).join(', ') : `${c.ok}/${c.routes} healthy` },
      { k: 'ATTACKS', href: '#/security', lit: worst(secOpen), v: secOpen.length ? `${plural(secOpen.length, 'active attack')}` : `${C.compact(c.threats24h)} seen in 24h` },
      { k: 'RANSOMWARE', href: '#/security', lit: ransom.length ? 'critical' : '', v: ransom.length ? 'Activity detected' : 'Watching files' },
      { k: 'SERVERS', href: '#/servers', lit: c.online < c.servers ? 'critical' : '', v: `${c.online}/${c.servers} online` },
      { k: 'CPU', href: '#/servers', lit: worst(byKey('res:cpu')), v: `peak ${pct(maxOf((s) => s.latest.cpu))}` },
      { k: 'MEMORY', href: '#/servers', lit: worst(byKey('res:mem')), v: `peak ${pct(maxOf((s) => s.latest.mem.pct))}` },
      { k: 'DISK', href: '#/servers', lit: worst(byKey('res:disk')), v: `peak ${pct(maxOf((s) => s.latest.disk))}` },
      { k: '5XX ERRORS', href: '#/security', lit: worst(byKey('errspike')), v: hourTraffic.req ? `${hourTraffic.s5} this hour` : 'No traffic data' },
    ];
    const lvl = ov.status.level;
    const unacked = open.some((a) => !a.ack && a.severity !== 'info');
    const mLit = lvl === 'critical' ? 'critical' : lvl === 'warning' ? 'caution' : '';
    const mLegend = lvl === 'critical' ? 'Master warning' : lvl === 'warning' ? 'Master caution' : 'All normal';
    return `
      <section class="annunciator" aria-label="System status panel">
        <button class="ann master ${mLit ? 'lit-' + mLit : ''} ${mLit && unacked ? 'unacked' : ''}" id="master" aria-label="${esc(mLegend)}. ${mLit ? 'Press to acknowledge all alerts' : 'Open alerts'}">
          ${mLit ? '' : '<span class="ann-pip"></span>'}
          <span class="ann-legend">${mLegend}</span>
          <span class="ann-value">${mLit ? (unacked ? 'Press to acknowledge' : open.length ? 'Acknowledged — still active' : 'Re-checking before it alerts') : 'Nothing needs you'}</span>
        </button>
        ${tiles.map((t) => `<a class="ann ${t.lit ? 'lit-' + t.lit : ''}" href="${t.href}" style="text-decoration:none"><span class="ann-pip"></span><span class="ann-legend">${t.k}</span><span class="ann-value">${esc(t.v)}</span></a>`).join('')}
      </section>`;
  }

  function issueItem(a) {
    const target = a.routeId ? `#/routes/${a.routeId}` : a.category === 'resources' || a.key.startsWith('offline:') ? '#/servers' : a.category === 'health' ? '#/routes' : '#/security';
    const ch = (a.channels || []).map((c) => (c === 'email' ? 'emailed' : c === 'push' ? 'pushed to phone' : c)).join(', ');
    return `<div class="issue">
      ${sevBadge(a.severity)}
      <div class="issue-title">${esc(a.title)}</div>
      <div class="issue-meta">${ago(a.t)}${a.count > 1 ? ` · ×${a.count}` : ''}</div>
      <div class="issue-msg">${esc(a.message)}</div>
      ${a.action ? `<div class="issue-fix"><b>What to do</b> ${esc(a.action)}</div>` : ''}
      <div class="issue-acts">
        <a class="btn btn-sm" href="${target}">Open</a>
        ${a.ack ? '<span class="muted" style="font-size:13px;align-self:center">Acknowledged</span>' : `<button class="btn btn-sm btn-ghost" data-ack="${esc(a.id)}">${I.check}Acknowledge</button>`}
        ${ch ? `<span class="muted" style="font-size:12.5px;align-self:center">${esc(ch)}</span>` : ''}
      </div>
    </div>`;
  }

  function meterRow(label, v, warn, crit) {
    const cls = v >= crit ? 'critical' : v >= warn ? 'caution' : '';
    return `<div class="meter"><span class="meter-label">${label}</span><div class="meter-track" role="meter" aria-valuenow="${v}" aria-valuemin="0" aria-valuemax="100" aria-label="${label}"><div class="meter-fill ${cls}" style="width:${Math.min(100, v)}%"></div><span class="meter-mark" style="left:${warn}%" title="Alert at ${warn}%"></span></div><span class="meter-val">${pct(v)}</span></div>`;
  }

  function capacityBlock(s, st) {
    if (!s.latest) return `<div class="muted">Waiting for first sample…</div>`;
    const l = s.latest;
    const v = s.capacity;
    const word = { Free: 'ok', Moderate: 'ok', Busy: 'degraded', Overloaded: 'down' }[v.verdict];
    return `
      <div class="verdict">${lamp(s.online ? word : 'down')}<span class="verdict-word">${s.online ? esc(v.verdict) : 'Offline'}</span><span class="verdict-free">${v.occupied}% occupied, ${v.free}% free</span></div>
      ${meterRow('CPU', l.cpu, st.cpuWarn, st.cpuCrit)}
      ${meterRow('Memory', l.mem.pct, st.memWarn, st.memCrit)}
      ${meterRow('Disk', l.disk, st.diskWarn, st.diskCrit)}`;
  }

  function routeRows(routes, { head = true, group = false } = {}) {
    if (!routes.length) return `<div class="empty"><strong>No routes yet</strong>Add the API routes you want checked — Sentinel will call them on a schedule and compare the response with what you expect.<div style="margin-top:14px"><button class="btn btn-primary" data-add-route>${I.plus}Add route</button></div></div>`;
    let out = head ? `<div class="rrow head"><span></span><span>Route</span><span>Response time, last checks</span><span class="rnum">Uptime 24h</span><span class="rnum">Avg</span><span>Last result</span></div>` : '';
    let lastGroup = null;
    const order = { down: 0, mismatch: 1, degraded: 2, pending: 3, ok: 4 };
    const list = group ? [...routes].sort((a, b) => (a.group || '').localeCompare(b.group || '') || order[a.state.status] - order[b.state.status]) : [...routes].sort((a, b) => order[a.state.status] - order[b.state.status]);
    for (const r of list) {
      if (group && (r.group || 'Ungrouped') !== lastGroup) { lastGroup = r.group || 'Ungrouped'; out += `<div class="group-label">${esc(lastGroup)}</div>`; }
      const st = r.state;
      const issue = st.status === 'ok' ? `<span class="s-ok status-word">OK</span> <span class="muted">${ms(st.lastMs)} · ${ago(st.lastCheck)}</span>` : st.status === 'pending' ? '<span class="muted">Waiting for first check</span>' : `<b class="s-${st.status}">${esc(ISSUE[st.lastIssue] || STATUS_WORD[st.status])}</b> <span class="muted">${esc(st.lastDetail || '')}</span>`;
      out += `<a class="rrow" href="#/routes/${esc(r.id)}">
        ${lamp(r.paused ? 'pending' : st.status)}
        <span style="min-width:0"><span class="rname">${esc(r.name)}${r.paused ? ' <span class="muted">(paused)</span>' : ''}</span><span class="rtarget mono">${esc(r.target)}</span></span>
        <span class="spark" data-spark="${esc(r.id)}" data-limit="${r.maxLatencyMs || ''}"></span>
        <span class="rnum">${r.uptime24h == null ? '—' : pct(r.uptime24h, r.uptime24h < 100 ? 1 : 0)}</span>
        <span class="rnum">${ms(r.avgMs24h)}</span>
        <span class="rissue">${issue}</span>
      </a>`;
    }
    return out;
  }
  function drawSparks(routes) {
    for (const r of routes) { const elx = $(`[data-spark="${CSS.escape(r.id)}"]`); if (elx) C.spark(elx, r.spark || [], { limit: r.maxLatencyMs }); }
  }

  function threatItem(t, full = false) {
    const routes = (t.routes && t.routes.length ? t.routes : t.route ? [t.route] : []).filter((x) => x && x !== '*');
    const where = t.category === 'ransomware' ? (t.paths && t.paths.length ? t.paths[t.paths.length - 1] : t.route) : routes.slice(0, 3).join(', ') + (routes.length > 3 ? ` +${routes.length - 3}` : '');
    return `<div class="feed-item">
      ${sevBadge(t.severity)}
      <div class="what">${esc(t.label)}${t.count > 1 ? ` <span class="muted num">×${C.compact(t.count)}</span>` : ''}</div>
      <div class="when">${ago(t.lastT)}</div>
      <div class="detail">${t.ip ? `from <span class="mono">${esc(t.ip)}</span>` : ''}${where ? ` on <span class="mono">${esc(where)}</span>` : ''}${t.desc ? ` — ${esc(t.desc)}` : ''}</div>
      ${full ? `<details class="more"><summary>Details and fix</summary>
        ${t.sample ? `<div class="codebox" style="margin-bottom:8px">${esc(t.sample)}</div>` : ''}
        ${t.ua ? `<div class="muted" style="margin-bottom:8px">User-Agent: <span class="mono">${esc(t.ua)}</span></div>` : ''}
        ${t.action ? `<div class="issue-fix" style="margin-bottom:8px"><b>What to do</b> ${esc(t.action)}</div>` : ''}
        ${t.ip ? `<div class="codebox">sudo ufw deny from ${esc(t.ip)}<button class="btn btn-sm copy" data-copy="sudo ufw deny from ${esc(t.ip)}">Copy</button></div>` : ''}
      </details>` : ''}
    </div>`;
  }

  async function viewOverview(my, soft) {
    const ov = await api('/overview');
    if (stale(my)) return;
    S.ov = ov;
    if (!S.settings) S.settings = (await api('/settings')).settings;
    const st = S.settings;
    updateBadges(ov);
    const open = ov.alerts;
    const lvl = ov.status.level;
    const n = open.filter((a) => a.severity !== 'info').length || ov.status.reasons.length;
    const headline = lvl === 'healthy' ? 'Everything is running normally' : lvl === 'critical' ? `${plural(n, 'problem')} need${n === 1 ? 's' : ''} attention` : `Running with ${plural(n, 'warning')}`;
    const hour = ov.hour;
    const scroll = soft ? window.scrollY : 0;
    view().innerHTML = `
      ${ov.server.demo ? `<div class="callout">${I.info}<div><b>Demo mode.</b> The routes, attacks and two extra servers are simulated so you can explore. Set <span class="mono">DEMO=false</span> in .env and add your real routes.</div></div>` : ''}
      <div class="status-line">
        <div><h1>${esc(headline)}</h1><div class="why">${esc(ov.status.text)}</div></div>
        <div class="clock"><span class="live-dot ${S.connected ? 'on' : ''}"></span>Live · updated ${hhmm(Date.now())}</div>
      </div>
      ${annunciator(ov)}
      <div class="grid g-main">
        <section class="panel">
          <div class="panel-head"><h2>What needs attention</h2>${open.length ? `<button class="btn btn-sm btn-ghost" id="ackAll">Acknowledge all</button>` : ''}</div>
          ${open.length ? open.slice(0, 6).map(issueItem).join('') + (open.length > 6 ? `<a class="btn btn-sm" href="#/alerts" style="margin-top:10px">See all ${open.length} alerts</a>` : '') : `<div class="empty"><strong>Nothing needs you right now</strong>Every route is answering as expected and no attacks are active. You’ll get an email and a phone notification the moment that changes.</div>`}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Server capacity</h2><a class="sub" href="#/servers">Details</a></div>
          <div class="stack">${ov.servers.map((s) => `<div><div style="font-weight:600;margin-bottom:6px;display:flex;justify-content:space-between;gap:8px"><span>${esc(s.name)}</span><span class="muted num" style="font-weight:400;font-size:13px">load ${s.latest ? s.latest.load[0] : '—'}</span></div>${capacityBlock(s, st)}</div>`).join('<hr style="border:0;border-top:1px solid var(--line);margin:0">')}</div>
        </section>
      </div>
      <section class="panel panel-flush" style="margin-top:16px">
        <div class="panel-head"><h2>Routes</h2><span class="sub">${ov.counts.ok} of ${ov.counts.routes} healthy</span></div>
        <div class="rboard" style="margin-top:10px">${routeRows(ov.routes)}</div>
      </section>
      <div class="grid g-2" style="margin-top:16px">
        <section class="panel">
          <div class="panel-head"><h2>Latest security events</h2><a class="sub" href="#/security">All events</a></div>
          ${ov.threats.length ? ov.threats.slice(0, 6).map((t) => threatItem(t)).join('') : '<div class="empty"><strong>No attacks seen</strong>Connect your access logs (LOG_FILES) or the agent to start detecting attacks.</div>'}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>This hour so far</h2><a class="sub" href="#/reports">Hourly reports</a></div>
          <ul class="lines">${hour.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
          <button class="btn btn-sm" id="sendNow">${I.mail}Email this report now</button>
        </section>
      </div>`;
    drawSparks(ov.routes);
    $('#master').onclick = async () => {
      if (ov.status.level === 'healthy') { location.hash = '#/alerts'; return; }
      await api('/alerts/ack-all', { method: 'POST' });
      toast('Alerts acknowledged', 'They stay listed until the problem is fixed.', 'info');
      refresh();
    };
    $('#ackAll') && ($('#ackAll').onclick = $('#master').onclick);
    $('#sendNow').onclick = sendReportNow;
    if (soft) window.scrollTo(0, scroll);
  }

  async function sendReportNow(e) {
    const b = e.currentTarget; b.disabled = true;
    try {
      const r = await api('/reports/send-now', { method: 'POST' });
      toast(r.email ? 'Report emailed' : 'Report not emailed', r.email ? `Also pushed to ${plural(r.push, 'device')}.` : 'Email isn’t set up yet — see Settings.', r.email ? 'info' : 'warning');
    } catch (err) { toast('Could not send', err.message, 'warning'); }
    b.disabled = false;
  }

  // ---------------------------------------------------------------- ROUTES
  async function viewRoutes(my, soft) {
    const routes = await api('/routes');
    if (stale(my)) return;
    S.cache.routes = routes;
    const f = S.routeFilter;
    const list = routes.filter((r) => f === 'all' || (f === 'problems' ? r.state.status !== 'ok' : r.state.status === 'ok'));
    const probs = routes.filter((r) => r.state.status !== 'ok' && r.state.status !== 'pending').length;
    view().innerHTML = `
      <div class="page-head">
        <div><h1>Routes</h1><p>Each route is called on its own schedule. A check passes only when the status code, response content and speed all match what you set.</p></div>
        <div class="head-actions"><button class="btn btn-primary" data-add-route>${I.plus}Add route</button></div>
      </div>
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
        <div class="seg" role="group" aria-label="Filter routes">
          ${[['all', `All ${routes.length}`], ['problems', `Problems ${probs}`], ['ok', 'Healthy']].map(([k, l]) => `<button aria-pressed="${f === k}" data-rf="${k}">${l}</button>`).join('')}
        </div>
        <span class="muted" style="font-size:13px">Lamp shapes: ${lamp('ok')} healthy ${lamp('degraded')} slow ${lamp('mismatch')} wrong result ${lamp('down')} down</span>
      </div>
      <section class="panel panel-flush"><div class="rboard">${routeRows(list, { group: true })}</div></section>`;
    drawSparks(list);
    $$('[data-rf]').forEach((b) => (b.onclick = () => { S.routeFilter = b.dataset.rf; viewRoutes(++renderToken); }));
  }

  async function viewRoute(id, my, soft) {
    if (typeof my !== 'number') { my = renderToken; }
    const r = await api('/routes/' + encodeURIComponent(id));
    if (stale(my)) return;
    const st = r.state;
    const last = r.checks[r.checks.length - 1];
    const expectRows = [];
    if (r.type === 'tcp') expectRows.push(['Port', 'accepts a connection']);
    else {
      expectRows.push(['Status', r.expectStatus || '2xx or 3xx']);
      if (r.expectContains) expectRows.push(['Contains', `“${r.expectContains}”`]);
      if (r.expectNotContains) expectRows.push(['Must not contain', `“${r.expectNotContains}”`]);
      if (r.expectJsonPath) expectRows.push([`JSON ${r.expectJsonPath}`, r.expectJsonValue !== undefined && r.expectJsonValue !== '' ? `= ${r.expectJsonValue}` : 'is present']);
      expectRows.push(['Speed', `under ${ms(r.maxLatencyMs)}`]);
    }
    const okNow = st.status === 'ok';
    const gotRows = [];
    if (last) {
      if (r.type !== 'tcp') gotRows.push(['Status', last.c ?? 'no response', last.c != null && !['HTTP_5XX', 'HTTP_502_504', 'AUTH_FAILED', 'NOT_FOUND', 'RATE_LIMITED', 'STATUS_MISMATCH'].includes(last.i)]);
      gotRows.push(['Result', last.i ? ISSUE[last.i] || last.i : 'Matches', !last.i]);
      if (last.d) gotRows.push(['Detail', last.d, !last.i]);
      gotRows.push(['Speed', ms(last.ms), last.i !== 'SLOW_RESPONSE' && last.i !== 'TIMEOUT']);
      if (st.sslDays != null) gotRows.push(['SSL', `${st.sslDays} days left`, st.sslDays > 14]);
    }
    const issueList = Object.entries(r.issues).sort((a, b) => b[1] - a[1]);
    const statusColor = { ok: '--good', degraded: '--caution', mismatch: '--serious', down: '--critical' };
    view().innerHTML = `
      <a class="back" href="#/routes">${I.back}All routes</a>
      <div class="page-head">
        <div><h1 style="display:flex;align-items:center;gap:12px">${lamp(st.status)}${esc(r.name)}</h1><p class="mono" style="overflow-wrap:anywhere">${esc(r.target)}</p></div>
        <div class="head-actions">
          <button class="btn" id="checkNow">${I.play}Check now</button>
          <button class="btn" id="editRoute">Edit</button>
        </div>
      </div>
      <div class="stats" style="margin-bottom:16px">
        <div class="stat"><div class="stat-label">Status</div><div class="stat-value s-${st.status}" style="font-size:24px">${STATUS_WORD[st.status] || st.status}</div><div class="stat-note">checked ${ago(st.lastCheck)}, every ${r.intervalSec}s</div></div>
        <div class="stat"><div class="stat-label">Uptime, 24 hours</div><div class="stat-value">${r.uptime24h == null ? '—' : pct(r.uptime24h, 2)}</div><div class="stat-note">${r.checks.length} checks stored</div></div>
        <div class="stat"><div class="stat-label">Average response</div><div class="stat-value">${ms(r.avgMs24h)}</div><div class="stat-note">limit ${ms(r.maxLatencyMs)}</div></div>
        <div class="stat"><div class="stat-label">Last failure</div><div class="stat-value" style="font-size:24px">${st.lastFailAt ? ago(st.lastFailAt) : 'None'}</div><div class="stat-note">${st.consecutive ? `${plural(st.consecutive, 'failure')} in a row` : 'passing'}</div></div>
      </div>
      <section class="panel" style="margin-bottom:16px">
        <div class="panel-head"><h2>Expected vs. last response</h2><span class="sub">${okNow ? 'Result matches' : 'Result does not match'}</span></div>
        <div class="compare">
          <div><h3>You expect</h3><dl>${expectRows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>
          <div><h3>Server returned ${last ? hhmm(last.t) : ''}</h3><dl>${gotRows.map(([k, v, good]) => `<dt>${esc(k)}</dt><dd class="${good ? 'good' : 'bad'}">${esc(v)}</dd>`).join('') || '<dd class="muted">No checks yet</dd>'}</dl></div>
        </div>
        ${!okNow && st.lastIssue ? `<div class="issue-fix" style="margin-top:12px"><b>What to do</b> ${esc(r.issueMeta[st.lastIssue]?.hint || '')}</div>` : ''}
        ${st.preview ? `<details class="more" style="margin-top:12px"><summary>Response body preview</summary><div class="codebox">${esc(st.preview)}</div></details>` : ''}
      </section>
      <div class="grid g-main">
        <section class="panel">
          <div class="panel-head"><h2>Response time</h2><span class="sub">last ${Math.min(r.checks.length, window.innerWidth < 720 ? 90 : 240)} checks</span></div>
          <div class="chart" id="latChart"></div>
          <div class="legend"><span><i style="background:var(--data);height:3px"></i>Response time</span><span><i style="background:var(--critical)"></i>Down</span><span><i style="background:var(--serious)"></i>Wrong result</span><span><i style="background:var(--set);height:2px"></i>Your limit</span></div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Uptime by hour</h2><span class="sub">last 24 hours</span></div>
          <div class="strip" id="strip">${r.hourly.map((h) => { const c = h.uptime == null ? '' : h.uptime >= 99.5 ? 'var(--good)' : h.uptime >= 95 ? 'var(--caution)' : h.uptime >= 80 ? 'var(--serious)' : 'var(--critical)'; return `<i tabindex="0" style="${c ? 'background:' + c : ''}" data-h='${esc(JSON.stringify(h))}' aria-label="${hhmm(h.t)}: ${h.uptime == null ? 'no data' : h.uptime + '% uptime'}"></i>`; }).join('')}</div>
          <div class="strip-axis"><span>${r.hourly[0] ? hhmm(r.hourly[0].t) : ''}</span><span>now</span></div>
          <div class="legend"><span><i style="background:var(--good)"></i>≥ 99.5%</span><span><i style="background:var(--caution)"></i>≥ 95%</span><span><i style="background:var(--serious)"></i>≥ 80%</span><span><i style="background:var(--critical)"></i>below 80%</span></div>
          <h3 style="font-size:14px;margin:18px 0 6px">Issue types seen</h3>
          ${issueList.length ? `<table class="table">${issueList.map(([k, n]) => `<tr><td>${esc(ISSUE[k] || k)}</td><td class="r">${n}</td></tr>`).join('')}</table>` : '<div class="muted">No issues recorded.</div>'}
        </section>
      </div>
      <section class="panel" style="margin-top:16px">
        <div class="panel-head"><h2>Check log</h2><span class="sub">newest first</span></div>
        <div class="checklog">${r.checks.slice().reverse().slice(0, 150).map((c) => `<div class="row">${lamp(c.r)}<span class="num">${new Date(c.t).toLocaleTimeString([], { hour12: false })}</span><span class="num">${ms(c.ms)}</span><span class="num muted">${c.c ?? '—'}</span><span class="${c.i ? 's-' + c.r : 'muted'}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.i ? esc((ISSUE[c.i] || c.i) + (c.d ? ' — ' + c.d : '')) : 'OK'}</span></div>`).join('') || '<div class="muted">No checks yet</div>'}</div>
      </section>`;
    const recent = r.checks.slice(-(window.innerWidth < 720 ? 90 : 240));
    const pts = recent.map((c) => ({ t: c.t, v: c.ms }));
    const markers = recent.filter((c) => c.r === 'down' || c.r === 'mismatch').map((c) => ({ t: c.t, v: c.ms ?? 0, color: C.css(c.r === 'down' ? '--critical' : '--serious') }));
    C.line($('#latChart'), { series: [{ name: 'Response time', color: C.css('--data'), points: pts, markers }], limits: r.type === 'tcp' ? [] : [{ v: r.maxLatencyMs, label: `limit ${ms(r.maxLatencyMs)}` }], yFormat: (v) => (v >= 1000 ? (v / 1000).toFixed(1) + 's' : Math.round(v) + ''), tipFormat: ms, height: 200, label: 'Response time chart' });
    $$('#strip i').forEach((cell) => {
      const show = (e) => { const h = JSON.parse(cell.dataset.h); const rr = cell.getBoundingClientRect(); C.showTip(e?.clientX ?? rr.left, e?.clientY ?? rr.top, `${hhmm(h.t)}–${hhmm(h.t + 3600_000)}`, h.uptime == null ? [{ value: 'No checks' }] : [{ value: pct(h.uptime, 1), label: 'uptime' }, { value: ms(h.avgMs), label: 'average' }, { value: String(h.fails), label: 'failed checks' }]); };
      cell.addEventListener('pointermove', show); cell.addEventListener('focus', () => show()); cell.addEventListener('pointerleave', C.hideTip); cell.addEventListener('blur', C.hideTip);
    });
    $('#checkNow').onclick = async (e) => {
      e.currentTarget.disabled = true;
      const res = await api(`/routes/${encodeURIComponent(id)}/check`, { method: 'POST' });
      toast(res.ok ? 'Check passed' : 'Check failed', res.ok ? `${ms(res.ms)} · HTTP ${res.code ?? ''}` : `${ISSUE[res.issue] || res.issue || ''} ${res.detail || ''}`, res.ok ? 'info' : 'high');
      viewRoute(id, ++renderToken);
    };
    $('#editRoute').onclick = () => routeForm(r);
    void statusColor;
  }

  // Add / edit route sheet
  function routeForm(r = null) {
    const d = r || { type: 'http', method: 'GET', expectStatus: '200', maxLatencyMs: 2000, timeoutMs: 10000, intervalSec: 60 };
    const sheet = $('#sheet');
    const hdrs = d.headers && Object.keys(d.headers).length ? JSON.stringify(d.headers, null, 2) : '';
    sheet.innerHTML = `
      <form method="dialog" id="rf">
        <div class="sheet-head"><h2>${r ? 'Edit route' : 'Add route'}</h2><button class="btn btn-ghost icon-btn" value="cancel" aria-label="Close">${I.close}</button></div>
        <div class="sheet-body">
          <div class="form-grid">
            <div class="field full"><label for="f-name">Name</label><input class="input" id="f-name" name="name" value="${esc(d.name || '')}" placeholder="Orders API" required></div>
            <div class="field"><label for="f-type">Check type</label><select class="input" id="f-type" name="type"><option value="http" ${d.type !== 'tcp' ? 'selected' : ''}>HTTP / API route</option><option value="tcp" ${d.type === 'tcp' ? 'selected' : ''}>TCP port (database, Redis…)</option></select></div>
            <div class="field"><label for="f-group">Group</label><input class="input" id="f-group" name="group" value="${esc(d.group || '')}" placeholder="Payments"></div>
            <div class="field http"><label for="f-method">Method</label><select class="input" id="f-method" name="method">${['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map((m) => `<option ${d.method === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
            <div class="field http"><label for="f-status">Expected status</label><input class="input" id="f-status" name="expectStatus" value="${esc(d.expectStatus ?? '')}" placeholder="200 or 2xx or 200,204"></div>
            <div class="field full http"><label for="f-url">URL</label><input class="input mono" id="f-url" name="url" value="${esc(d.url || '')}" placeholder="https://api.yourapp.com/v1/health"></div>
            <div class="field tcp"><label for="f-host">Host</label><input class="input mono" id="f-host" name="host" value="${esc(d.host || '')}" placeholder="10.0.0.5"></div>
            <div class="field tcp"><label for="f-port">Port</label><input class="input" id="f-port" name="port" type="number" value="${esc(d.port || '')}" placeholder="5432"></div>
            <div class="field http"><label for="f-contains">Response must contain</label><input class="input" id="f-contains" name="expectContains" value="${esc(d.expectContains || '')}" placeholder='"status":"ok"'><span class="hint">Optional text the body must include</span></div>
            <div class="field http"><label for="f-notcontains">Response must not contain</label><input class="input" id="f-notcontains" name="expectNotContains" value="${esc(d.expectNotContains || '')}" placeholder="error"></div>
            <div class="field http"><label for="f-jp">JSON field</label><input class="input mono" id="f-jp" name="expectJsonPath" value="${esc(d.expectJsonPath || '')}" placeholder="data.status"><span class="hint">Dot path, e.g. data.items.0.id</span></div>
            <div class="field http"><label for="f-jv">JSON field must equal</label><input class="input" id="f-jv" name="expectJsonValue" value="${esc(d.expectJsonValue ?? '')}" placeholder="ok (blank = just present)"></div>
            <div class="field http"><label for="f-lat">Slow if over (ms)</label><input class="input" id="f-lat" name="maxLatencyMs" type="number" value="${esc(d.maxLatencyMs || 2000)}"></div>
            <div class="field"><label for="f-to">Timeout (ms)</label><input class="input" id="f-to" name="timeoutMs" type="number" value="${esc(d.timeoutMs || 10000)}"></div>
            <div class="field"><label for="f-int">Check every (seconds)</label><input class="input" id="f-int" name="intervalSec" type="number" min="10" value="${esc(d.intervalSec || 60)}"></div>
            <div class="field"><label for="f-paused">Monitoring</label><select class="input" id="f-paused" name="paused"><option value="">Active</option><option value="1" ${d.paused ? 'selected' : ''}>Paused</option></select></div>
            <div class="field full http"><label for="f-headers">Headers (JSON)</label><textarea class="input" id="f-headers" name="headers" placeholder='{ "Authorization": "Bearer …" }'>${esc(hdrs)}</textarea></div>
            <div class="field full http"><label for="f-body">Request body</label><textarea class="input" id="f-body" name="body" placeholder='{ "email": "monitor@yourapp.com" }'>${esc(typeof d.body === 'object' ? JSON.stringify(d.body) : d.body || '')}</textarea></div>
          </div>
          <div id="testOut"></div>
        </div>
        <div class="sheet-foot">
          ${r ? `<button type="button" class="btn btn-danger left" id="delRoute">Delete</button>` : ''}
          <button type="button" class="btn" id="testRoute">${I.play}Test now</button>
          <button type="submit" class="btn btn-primary" value="save">${r ? 'Save changes' : 'Add route'}</button>
        </div>
      </form>`;
    const form = $('#rf');
    const syncType = () => { const tcp = $('#f-type').value === 'tcp'; $$('.http', form).forEach((x) => x.classList.toggle('hidden', tcp)); $$('.tcp', form).forEach((x) => x.classList.toggle('hidden', !tcp)); };
    $('#f-type').onchange = syncType; syncType();
    const collect = () => { const o = Object.fromEntries(new FormData(form).entries()); o.paused = !!o.paused; return o; };
    $('#testRoute').onclick = async (e) => {
      const b = e.currentTarget; b.disabled = true; $('#testOut').innerHTML = '<div class="test-result muted">Calling the route…</div>';
      try {
        const res = await api('/routes/test', { method: 'POST', body: collect() });
        $('#testOut').innerHTML = `<div class="test-result">${lamp(res.result)} <b class="s-${res.result}">${res.ok && res.result === 'ok' ? 'Matches what you expect' : esc(ISSUE[res.issue] || res.result)}</b> <span class="muted">${ms(res.ms)}${res.code ? ' · HTTP ' + res.code : ''}</span>${res.detail ? `<div style="margin-top:6px">${esc(res.detail)}</div>` : ''}${res.preview ? `<div class="codebox" style="margin-top:8px">${esc(res.preview)}</div>` : ''}</div>`;
      } catch (err) { $('#testOut').innerHTML = `<div class="test-result s-down">${esc(err.message)}</div>`; }
      b.disabled = false;
    };
    if (r) $('#delRoute').onclick = async () => {
      if (!confirm(`Stop monitoring “${r.name}” and delete its history?`)) return;
      await api('/routes/' + encodeURIComponent(r.id), { method: 'DELETE' });
      sheet.close(); toast('Route deleted', r.name, 'info'); location.hash = '#/routes';
    };
    form.addEventListener('submit', async (e) => {
      if (e.submitter?.value !== 'save') return;
      e.preventDefault();
      try {
        const saved = await api(r ? '/routes/' + encodeURIComponent(r.id) : '/routes', { method: r ? 'PUT' : 'POST', body: collect() });
        sheet.close();
        toast(r ? 'Route saved' : 'Route added', 'First check is running now.', 'info');
        location.hash = '#/routes/' + saved.id;
        if (r) route();
      } catch (err) { $('#testOut').innerHTML = `<div class="test-result s-down">${esc(err.message)}</div>`; }
    });
    sheet.showModal();
  }

  // ---------------------------------------------------------------- SECURITY
  async function viewSecurity(my, soft) {
    const [st, list] = await Promise.all([api('/threats/stats?hours=24&minutes=360'), api('/threats?limit=200')]);
    if (stale(my)) return;
    S.cache.sec = { st, list };
    const cat = S.threatCat;
    const filtered = list.filter((t) => cat === 'all' || t.category === cat);
    const ransomOpen = (S.ov?.alerts || []).some((a) => a.category === 'ransomware');
    const types = Object.entries(st.byType).sort((a, b) => b[1] - a[1]);
    const maxT = Math.max(1, ...types.map((t) => t[1]));
    const scroll = soft ? window.scrollY : 0;
    view().innerHTML = `
      <div class="page-head"><div><h1>Security</h1><p>Attacks found in your access logs, SSH logins and protected folders over the last 24 hours. Each incident groups one attacker’s repeated attempts.</p></div></div>
      ${ransomOpen ? `<div class="callout warn" style="border-color:var(--critical)">${I.security}<div><b>Ransomware activity detected.</b> Disconnect the affected server from the network, stop the process that is changing files, and restore from an offline backup. Don’t pay.</div></div>` : ''}
      <div class="stats" style="margin-bottom:16px">
        <div class="stat"><div class="stat-label">Malicious requests</div><div class="stat-value">${C.compact(st.total)}</div><div class="stat-note">last 24 hours</div></div>
        <div class="stat"><div class="stat-label">Incidents</div><div class="stat-value">${st.incidents}</div><div class="stat-note">${(st.bySev.critical || 0) + (st.bySev.high || 0)} high or critical</div></div>
        <div class="stat"><div class="stat-label">Attacking IPs</div><div class="stat-value">${st.topIPs.length}${st.topIPs.length >= 12 ? '+' : ''}</div><div class="stat-note">${st.topIPs[0] ? 'top: ' + esc(st.topIPs[0].ip) : 'none'}</div></div>
        <div class="stat"><div class="stat-label">Ransomware</div><div class="stat-value ${st.byCat.ransomware ? 's-down' : 's-ok'}" style="font-size:24px">${st.byCat.ransomware ? 'Detected' : 'None found'}</div><div class="stat-note">canary files + file-change watch</div></div>
      </div>
      <div class="grid g-2">
        <section class="panel"><div class="chart-title">Requests per minute</div><div class="chart-sub">all servers, last 6 hours</div><div class="chart" id="reqChart"></div></section>
        <section class="panel"><div class="chart-title">Server errors (5xx) per minute</div><div class="chart-sub">a spike usually means a broken route or an attack landing</div><div class="chart" id="errChart"></div></section>
      </div>
      <div class="grid g-2" style="margin-top:16px">
        <section class="panel"><div class="chart-title">Malicious events per 30 minutes</div><div class="chart-sub">last 24 hours</div><div class="chart" id="thChart"></div></section>
        <section class="panel">
          <div class="panel-head"><h2>Attack types</h2><span class="sub">24 hours</span></div>
          ${types.length ? `<table class="table">${types.map(([k, n]) => `<tr><td style="width:46%">${esc(st.types[k]?.label || k)}</td><td><div style="height:10px;border-radius:0 4px 4px 0;background:var(--data);width:${Math.max(2, (n / maxT) * 100)}%"></div></td><td class="r" style="width:60px">${C.compact(n)}</td></tr>`).join('')}</table>` : '<div class="empty">No attacks recorded</div>'}
        </section>
      </div>
      <div class="grid g-main" style="margin-top:16px">
        <section class="panel">
          <div class="panel-head" style="flex-wrap:wrap"><h2>Incidents</h2>
            <div class="seg" role="group" aria-label="Filter incidents">${[['all', 'All'], ['attack', 'Attacks'], ['recon', 'Scanning'], ['ransomware', 'Ransomware'], ['audit', 'Logins']].map(([k, l]) => `<button aria-pressed="${cat === k}" data-cat="${k}">${l}</button>`).join('')}</div>
          </div>
          ${filtered.length ? filtered.slice(0, S.threatLimit || 20).map((t) => threatItem(t, true)).join('') + (filtered.length > (S.threatLimit || 20) ? `<button class="btn btn-sm" id="moreTh" style="margin-top:12px">Show ${Math.min(40, filtered.length - (S.threatLimit || 20))} more</button>` : '') : '<div class="empty"><strong>Nothing in this category</strong>No events of this kind in the stored history.</div>'}
        </section>
        <div class="stack">
          <section class="panel">
            <div class="panel-head"><h2>Top attacking IPs</h2></div>
            ${st.topIPs.length ? `<div class="table-wrap"><table class="table"><tr><th>IP</th><th>Main attack</th><th class="r">Events</th></tr>${st.topIPs.map((x) => `<tr><td class="mono">${esc(x.ip)}</td><td>${esc(st.types[x.mainType]?.label || x.mainType || '')}</td><td class="r">${C.compact(x.threats)}</td></tr>`).join('')}</table></div>
            <details class="more" style="margin-top:12px"><summary>Block all of these</summary><div class="codebox">${esc(st.topIPs.map((x) => `sudo ufw deny from ${x.ip}`).join('\n'))}<button class="btn btn-sm copy" data-copy="${esc(st.topIPs.map((x) => `sudo ufw deny from ${x.ip}`).join('\n'))}">Copy</button></div></details>` : '<div class="muted">No attackers seen.</div>'}
          </section>
          <section class="panel">
            <div class="panel-head"><h2>Most targeted routes</h2></div>
            ${st.topRoutes.length ? `<table class="table">${st.topRoutes.map((x) => `<tr><td class="mono" style="overflow-wrap:anywhere">${esc(x.route)}</td><td class="r">${C.compact(x.count)}</td></tr>`).join('')}</table>` : '<div class="muted">No targeted routes.</div>'}
          </section>
        </div>
      </div>`;
    // merge traffic of all servers per minute
    const merged = {};
    for (const arr of Object.values(st.traffic)) for (const m of arr) { const o = (merged[m.t] = merged[m.t] || { t: m.t, req: 0, s5: 0 }); o.req += m.req; o.s5 += m.s5; }
    const tr = Object.values(merged).sort((a, b) => a.t - b.t);
    C.line($('#reqChart'), { series: [{ name: 'requests', color: C.css('--data'), points: tr.map((m) => ({ t: m.t, v: m.req })) }], height: 170, tipFormat: (v) => `${Math.round(v)}/min`, label: 'Requests per minute' });
    C.line($('#errChart'), { series: [{ name: '5xx errors', color: C.css('--data'), points: tr.map((m) => ({ t: m.t, v: m.s5 })) }], height: 170, tipFormat: (v) => `${Math.round(v)}/min`, label: 'Server errors per minute' });
    C.bars($('#thChart'), {
      height: 170, label: 'Malicious events per 30 minutes',
      bars: st.timeline.map((b) => ({ label: hhmm(b.t), head: `${hhmm(b.t)}–${hhmm(b.t + 1800_000)}`, v: b.attack + b.recon + b.ransomware + (b.audit || 0), tip: [{ value: String(b.attack), label: 'attacks' }, { value: String(b.recon), label: 'scanning' }, { value: String(b.ransomware), label: 'ransomware' }] })),
    });
    $$('[data-cat]').forEach((b) => (b.onclick = () => { S.threatCat = b.dataset.cat; S.threatLimit = 20; viewSecurity(++renderToken); }));
    $('#moreTh') && ($('#moreTh').onclick = () => { S.threatLimit = (S.threatLimit || 20) + 40; viewSecurity(++renderToken, true); });
    if (soft) window.scrollTo(0, scroll);
  }

  // ---------------------------------------------------------------- SERVERS
  async function viewServers(my, soft) {
    const servers = await api('/servers');
    if (stale(my)) return;
    if (!S.settings) S.settings = (await api('/settings')).settings;
    const st = S.settings;
    if (!servers.length) { view().innerHTML = '<div class="empty"><strong>No servers reporting</strong>The hub reports itself automatically. Add other machines with the agent (Settings → Connect another server).</div>'; return; }
    if (!servers.find((s) => s.id === S.serverSel)) S.serverSel = servers[0].id;
    const d = await api('/servers/' + encodeURIComponent(S.serverSel));
    if (stale(my)) return;
    S.cache.server = d;
    const l = d.latest || {};
    const scroll = soft ? window.scrollY : 0;
    const colorFor = (v, w, c) => (v >= c ? 'var(--critical)' : v >= w ? 'var(--caution)' : 'var(--data)');
    view().innerHTML = `
      <div class="page-head"><div><h1>Servers</h1><p>Live resource use, sampled every 5 seconds. “Occupied” is the higher of CPU and memory use — the part of the server that’s already busy.</p></div></div>
      <div class="srv-cards" role="group" aria-label="Choose server">
        ${servers.map((s) => `<button class="srv-card" aria-pressed="${s.id === S.serverSel}" data-srv="${esc(s.id)}">
          <div class="row1"><span class="name">${esc(s.name)}</span><span class="status-word ${s.online ? '' : 's-down'}" style="display:flex;align-items:center;gap:6px">${lamp(!s.online ? 'down' : s.capacity?.verdict === 'Overloaded' ? 'down' : s.capacity?.verdict === 'Busy' ? 'degraded' : 'ok')}${s.online ? esc(s.capacity?.verdict || '') : 'Offline'}</span></div>
          <div class="minibars">${s.latest ? [['CPU', s.latest.cpu, st.cpuWarn, st.cpuCrit], ['Memory', s.latest.mem.pct, st.memWarn, st.memCrit], ['Disk', s.latest.disk, st.diskWarn, st.diskCrit]].map(([k, v, w, c]) => `<div class="minibar"><span>${k}</span><b>${pct(v)}</b><i style="--w:${Math.min(100, v)}%;--c:${colorFor(v, w, c)}"></i></div>`).join('') : '<span class="muted">no data</span>'}</div>
        </button>`).join('')}
      </div>
      <div class="grid g-main">
        <div><section class="panel">
          <div class="panel-head"><h2>${esc(d.name)}</h2><span class="sub">${d.online ? `live · ${ago(d.lastSeen)}` : 'offline since ' + ago(d.lastSeen)}</span></div>
          <div class="grid g-2">
            <div><div class="chart-title">CPU</div><div class="chart-sub">last hour, %</div><div class="chart" id="cpuChart"></div></div>
            <div><div class="chart-title">Memory</div><div class="chart-sub">last hour, %</div><div class="chart" id="memChart"></div></div>
          </div>
          <div class="chart-title" style="margin-top:18px">Occupied, hour by hour</div>
          <div class="chart-sub">average of CPU or memory, whichever is higher — answers “how busy was the server each hour?”</div>
          <div class="chart" id="hourChart"></div>
        </section>
          <section class="panel" style="margin-top:16px"><div class="panel-head"><h2>Busiest processes</h2></div>
            ${(l.top || []).length ? `<table class="table"><tr><th>Process</th><th class="r">CPU</th><th class="r">Mem</th></tr>${l.top.map((p) => `<tr><td><span class="mono">${esc(p.name)}</span> <span class="muted num" style="font-size:12px">${p.pid}</span></td><td class="r">${pct(p.cpu, 1)}</td><td class="r">${pct(p.mem, 1)}</td></tr>`).join('')}</table>` : '<div class="muted">Not available on this platform.</div>'}
          </section>
        </div>
        <div class="stack">
          <section class="panel"><div class="panel-head"><h2>Right now</h2></div>${capacityBlock(d, st)}
            <table class="table" style="margin-top:8px">
              <tr><td class="muted">Load average</td><td class="r">${l.load ? l.load.join(' / ') : '—'}</td></tr>
              <tr><td class="muted">Memory used</td><td class="r">${l.mem ? `${bytes(l.mem.used)} of ${bytes(l.mem.total)}` : '—'}</td></tr>
              ${(l.disks || []).map((x) => `<tr><td class="muted">Disk <span class="mono">${esc(x.path)}</span></td><td class="r">${bytes(x.free)} free of ${bytes(x.total)}</td></tr>`).join('')}
              <tr><td class="muted">Network in / out</td><td class="r">${l.rx == null ? '—' : `${bytes(l.rx)}/s · ${bytes(l.tx)}/s`}</td></tr>
              <tr><td class="muted">Open connections</td><td class="r">${l.conns ?? '—'}</td></tr>
              <tr><td class="muted">Processes</td><td class="r">${l.procCount ?? '—'}</td></tr>
              <tr><td class="muted">Uptime</td><td class="r">${l.uptime ? dur(l.uptime) : '—'}</td></tr>
            </table>
          </section>

          <section class="panel"><div class="panel-head"><h2>Machine</h2></div>
            <table class="table">
              ${[['Host', d.info?.hostname], ['System', d.info?.platform], ['CPU', d.info?.cpuModel ? `${d.info.cpuModel} (${d.info.cores} cores)` : d.info?.cores], ['RAM', d.info?.memTotal ? bytes(d.info.memTotal) : null]].filter((x) => x[1]).map(([k, v]) => `<tr><td class="muted">${k}</td><td class="r" style="overflow-wrap:anywhere">${esc(v)}</td></tr>`).join('')}
            </table>
          </section>
        </div>
      </div>`;
    drawServerCharts(d, st);
    $$('[data-srv]').forEach((b) => (b.onclick = () => { S.serverSel = b.dataset.srv; localStorage.setItem('sentinel.server', S.serverSel); viewServers(++renderToken); }));
    if (soft) window.scrollTo(0, scroll);
  }
  function drawServerCharts(d, st) {
    const series = d.series && d.series.length > 3 ? d.series : (d.minutes || []).slice(-60);
    C.line($('#cpuChart'), { series: [{ name: 'CPU', color: C.css('--data'), points: series.map((x) => ({ t: x.t, v: x.cpu })) }], yMax: 100, limits: [{ v: st.cpuWarn, label: `alert ${st.cpuWarn}%` }], height: 150, tipFormat: (v) => pct(v, 1), yFormat: (v) => v + '%', label: 'CPU usage' });
    C.line($('#memChart'), { series: [{ name: 'Memory', color: C.css('--data'), points: series.map((x) => ({ t: x.t, v: x.mem })) }], yMax: 100, limits: [{ v: st.memWarn, label: `alert ${st.memWarn}%` }], height: 150, tipFormat: (v) => pct(v, 1), yFormat: (v) => v + '%', label: 'Memory usage' });
    const vc = { Free: C.css('--good'), Moderate: C.css('--data'), Busy: C.css('--caution'), Overloaded: C.css('--critical') };
    C.bars($('#hourChart'), {
      height: 180, yMax: 100, yFormat: (v) => v + '%', label: 'Occupied per hour',
      bars: (d.hours || []).map((h) => ({ label: hhmm(h.t), head: `${hhmm(h.t)}–${hhmm(h.t + 3600_000)} · ${h.verdict}`, v: h.occupied, color: vc[h.verdict], tip: [{ value: `${h.occupied}%`, label: 'occupied' }, { value: `${h.free}%`, label: 'free' }, { value: pct(h.cpu, 1), label: `CPU avg (peak ${pct(h.cpuMax, 0)})` }, { value: pct(h.mem, 1), label: 'memory avg' }] })),
      legend: [{ color: vc.Free, label: 'Free, under 40%' }, { color: vc.Moderate, label: 'Moderate' }, { color: vc.Busy, label: 'Busy, 70%+' }, { color: vc.Overloaded, label: 'Overloaded, 85%+' }],
    });
  }

  // ---------------------------------------------------------------- REPORTS
  async function viewReports(my) {
    const [list, cur] = await Promise.all([api('/reports'), api('/reports/current')]);
    if (stale(my)) return;
    const stWord = { healthy: 'ok', issues: 'degraded', critical: 'down' };
    view().innerHTML = `
      <div class="page-head"><div><h1>Hourly reports</h1><p>At the top of every hour Sentinel writes a report — route uptime, attacks, and how much of each server was occupied — and sends it by email and to your phone.</p></div>
        <div class="head-actions"><button class="btn" id="sendNow">${I.mail}Email current hour now</button></div></div>
      <section class="panel" style="margin-bottom:16px">
        <div class="panel-head"><h2>Current hour, in progress</h2><span class="sub">${hourRange(cur.hourStart, Date.now())}</span></div>
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px">${lamp(stWord[cur.status])}<b class="s-${stWord[cur.status]}">${esc(cur.status[0].toUpperCase() + cur.status.slice(1))}</b></div>
        <ul class="lines" style="margin:0">${cur.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      </section>
      <section class="panel panel-flush">
        <div class="panel-head"><h2>Past reports</h2><span class="sub">${list.length} stored</span></div>
        <div style="margin-top:10px">
        ${list.length ? list.map((r) => `<a class="rep-row" href="#/reports/${esc(r.id)}">
            ${lamp(stWord[r.status])}
            <span class="rep-when">${hourRange(r.hourStart, r.hourEnd)}</span>
            <span class="rep-sum">${esc(r.summary)}</span>
            <span class="rep-figs"><span>${r.uptime == null ? '—' : pct(r.uptime, 1)} uptime</span><span>${C.compact(r.threats.total)} threats</span></span>
          </a>`).join('') : '<div class="empty"><strong>First report arrives at the top of the hour</strong>Reports are kept for 14 days.</div>'}
        </div>
      </section>`;
    $('#sendNow').onclick = sendReportNow;
  }

  async function viewReport(id, my) {
    if (typeof my !== 'number') my = renderToken;
    const r = await api('/reports/' + encodeURIComponent(id));
    if (stale(my)) return;
    const stWord = { healthy: 'ok', issues: 'degraded', critical: 'down' };
    view().innerHTML = `
      <a class="back" href="#/reports">${I.back}All reports</a>
      <div class="page-head"><div><h1 style="display:flex;gap:12px;align-items:center">${lamp(stWord[r.status])}${hourRange(r.hourStart, r.hourEnd)}</h1><p>${esc(r.summary)}</p></div></div>
      <div class="stats" style="margin-bottom:16px">
        <div class="stat"><div class="stat-label">Average uptime</div><div class="stat-value">${r.uptime == null ? '—' : pct(r.uptime, 2)}</div></div>
        <div class="stat"><div class="stat-label">Routes with failures</div><div class="stat-value">${r.routes.filter((x) => x.fail).length}</div><div class="stat-note">of ${r.routes.length}</div></div>
        <div class="stat"><div class="stat-label">Malicious events</div><div class="stat-value">${C.compact(r.threats.total)}</div></div>
        <div class="stat"><div class="stat-label">Alerts raised</div><div class="stat-value">${r.alerts.total}</div><div class="stat-note">${r.alerts.critical} critical</div></div>
      </div>
      <section class="panel" style="margin-bottom:16px"><div class="panel-head"><h2>Routes</h2></div><div class="table-wrap"><table class="table">
        <tr><th></th><th>Route</th><th class="r">Checks</th><th class="r">Failed</th><th class="r">Uptime</th><th class="r">Avg</th><th class="r">Max</th><th>Issues</th></tr>
        ${r.routes.map((x) => `<tr><td>${lamp(x.fail ? (x.issues[0] && ['BODY_MISMATCH', 'NOT_FOUND', 'AUTH_FAILED', 'STATUS_MISMATCH'].includes(x.issues[0].issue) ? 'mismatch' : 'down') : x.degraded ? 'degraded' : x.checks ? 'ok' : 'pending')}</td><td><b>${esc(x.name)}</b><div class="mono muted" style="font-size:12px">${esc(x.target)}</div></td><td class="r">${x.checks}</td><td class="r">${x.fail}</td><td class="r">${x.uptime == null ? '—' : pct(x.uptime, 1)}</td><td class="r">${ms(x.avgMs)}</td><td class="r">${ms(x.maxMs)}</td><td>${x.issues.map((i) => `${esc(ISSUE[i.issue] || i.issue)} ×${i.n}`).join(', ') || '<span class="muted">none</span>'}</td></tr>`).join('')}
      </table></div></section>
      <div class="grid g-2">
        <section class="panel"><div class="panel-head"><h2>Server capacity</h2></div><table class="table">
          <tr><th>Server</th><th class="r">CPU avg / peak</th><th class="r">Memory</th><th class="r">Disk</th><th>Verdict</th></tr>
          ${r.resources.filter((x) => x.samples).map((x) => `<tr><td><b>${esc(x.name)}</b></td><td class="r">${pct(x.cpuAvg)} / ${pct(x.cpuMax)}</td><td class="r">${pct(x.memAvg)}</td><td class="r">${pct(x.disk)}</td><td>${esc(x.verdict)}, ${x.free}% free</td></tr>`).join('')}
        </table></section>
        <section class="panel"><div class="panel-head"><h2>Security</h2></div>
          ${r.threats.byType.length ? `<table class="table">${r.threats.byType.map((t) => `<tr><td>${esc(t.label)}</td><td class="r">${t.n}</td></tr>`).join('')}</table>${r.threats.topIPs.length ? `<p class="muted" style="font-size:13px">Top sources: ${r.threats.topIPs.map((x) => `<span class="mono">${esc(x.ip)}</span> (${x.n})`).join(', ')}</p>` : ''}` : '<div class="empty">No attacks this hour</div>'}
        </section>
      </div>`;
  }

  // ---------------------------------------------------------------- ALERTS
  async function viewAlerts(my) {
    const list = await api('/alerts?limit=300' + (S.alertFilter === 'open' ? '&status=open' : ''));
    if (stale(my)) return;
    view().innerHTML = `
      <div class="page-head"><div><h1>Alerts</h1><p>Every alert Sentinel raised, with what to do about it. Open alerts close themselves once the problem is gone.</p></div>
        <div class="head-actions"><button class="btn" id="ackAll">${I.check}Acknowledge all</button></div></div>
      <div class="seg" role="group" aria-label="Filter alerts" style="margin-bottom:12px">${[['open', 'Open'], ['all', 'History']].map(([k, l]) => `<button aria-pressed="${S.alertFilter === k}" data-af="${k}">${l}</button>`).join('')}</div>
      <section class="panel">${list.length ? list.map((a) => a.status === 'open' ? issueItem(a) : `<div class="issue">${lamp('ok')}<div class="issue-title">${esc(a.title)} <span class="muted" style="font-weight:400">— resolved</span></div><div class="issue-meta">${ago(a.resolvedAt || a.lastT)}</div><div class="issue-msg">${esc(a.message)} Lasted ${Math.max(1, Math.round(((a.resolvedAt || a.lastT) - a.t) / 60000))} min.</div></div>`).join('') : '<div class="empty"><strong>No open alerts</strong>When something breaks you’ll see it here, in your email and on your phone.</div>'}</section>`;
    $$('[data-af]').forEach((b) => (b.onclick = () => { S.alertFilter = b.dataset.af; viewAlerts(++renderToken); }));
    $('#ackAll').onclick = async () => { await api('/alerts/ack-all', { method: 'POST' }); toast('All alerts acknowledged', '', 'info'); viewAlerts(++renderToken); };
  }

  // ---------------------------------------------------------------- SETTINGS
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  async function pushState() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return { supported: false };
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return { supported: true, subscribed: !!sub, permission: Notification.permission, sub };
  }
  function b64ToU8(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }
  async function enablePush() {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notifications are blocked for this site. Allow them in your browser or phone settings.');
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(S.info.vapidPublicKey) });
    const label = `${/android/i.test(navigator.userAgent) ? 'Android' : isIOS() ? 'iPhone/iPad' : /mac/i.test(navigator.userAgent) ? 'Mac' : /windows/i.test(navigator.userAgent) ? 'Windows' : 'Device'} · ${new Date().toLocaleDateString()}`;
    await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), label } });
  }

  async function viewSettings(my) {
    const [cfg, ps] = await Promise.all([api('/settings'), pushState().catch(() => ({ supported: false }))]);
    if (stale(my)) return;
    S.settings = cfg.settings;
    const s = cfg.settings, env = cfg.env, ns = cfg.notify;
    const sevOpts = (v) => ['info', 'warning', 'high', 'critical'].map((k) => `<option value="${k}" ${v === k ? 'selected' : ''}>${SEV_LABEL[k]} and above</option>`).join('');
    const hubUrl = location.origin;
    let pushHtml;
    if (!ps.supported) pushHtml = isIOS() && !isStandalone() ? `<div class="callout">${I.phone}<div><b>On iPhone, install the app first.</b> Tap Share → “Add to Home Screen”, open Sentinel from your home screen, then come back here to turn on notifications.</div></div>` : `<div class="callout warn">${I.info}<div>This browser can’t receive push notifications. Use Chrome, Edge, Firefox or Safari 16.4+, over HTTPS.</div></div>`;
    else pushHtml = `<div class="switch"><div><div class="label">Notifications on this device</div><div class="hint">${ps.subscribed ? 'On — alerts will pop up even when the app is closed.' : ps.permission === 'denied' ? 'Blocked in browser settings.' : 'Off'}</div></div>${ps.subscribed ? `<button class="btn btn-sm" id="pushOff">Turn off</button>` : `<button class="btn btn-sm btn-primary" id="pushOn">${I.phone}Turn on</button>`}</div>`;
    view().innerHTML = `
      <div class="page-head"><div><h1>Settings</h1><p>Where alerts go, when they fire, and how to connect more servers.</p></div></div>
      <div class="grid g-2">
        <div class="stack">
          <section class="panel">
            <div class="panel-head"><h2>Install the app</h2></div>
            <p class="ink2" style="margin-top:0">Sentinel installs like a native app on Android, iPhone, Mac and Windows — with its own icon and notifications.</p>
            ${S.installEvt ? `<button class="btn btn-primary" id="installBtn">${I.download}Install Sentinel</button>` : isStandalone() ? `<div class="status-word s-ok" style="display:flex;gap:8px;align-items:center">${lamp('ok')}Installed — you’re using the app</div>` : isIOS() ? '<p class="ink2">On iPhone/iPad: open this page in Safari, tap Share, then “Add to Home Screen”.</p>' : '<p class="ink2">Use your browser menu → “Install app” (Chrome/Edge) or “Add to Dock” (Safari on Mac).</p>'}
          </section>
          <section class="panel">
            <div class="panel-head"><h2>Phone and desktop notifications</h2><span class="sub">${cfg.pushDevices.length} device${cfg.pushDevices.length === 1 ? '' : 's'}</span></div>
            ${pushHtml}
            ${cfg.pushDevices.length ? `<table class="table" style="margin-top:6px">${cfg.pushDevices.map((d) => `<tr><td>${I.phone.replace('<svg', '<svg width="16" height="16" style="vertical-align:-3px;margin-right:6px"')}${esc(d.label || 'Device')}</td><td class="r muted">${ago(d.createdAt)}</td></tr>`).join('')}</table>` : ''}
            <div class="switch"><div><div class="label">Push alerts from</div><div class="hint">Lower levels are still shown in the app</div></div><select class="input" style="width:auto" data-set="pushMinSeverity">${sevOpts(s.pushMinSeverity)}</select></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn btn-sm" data-test="push">Send test notification</button>${env.ntfy ? '<button class="btn btn-sm" data-test="ntfy">Test ntfy</button>' : ''}</div>
            ${ns.push.lastError ? `<p class="s-down" style="font-size:13px">Last push error: ${esc(ns.push.lastError)}</p>` : ''}
          </section>
          <section class="panel">
            <div class="panel-head"><h2>Email alerts</h2><span class="sub ${ns.email.configured ? 's-ok' : 's-degraded'}">${ns.email.configured ? `Sending with ${esc(ns.email.provider)}` : 'Not set up'}</span></div>
            ${ns.email.configured ? `<p class="muted" style="margin-top:0;font-size:13px">From <span class="mono">${esc(ns.email.from)}</span></p>` : `<div class="callout warn">${I.mail}<div>Add <span class="mono">RESEND_API_KEY=re_…</span> to the .env file and restart (or the <span class="mono">SMTP_…</span> settings for Gmail and other mail servers).</div></div>`}
            <div class="field"><label for="emailTo">Send alerts to</label><input class="input" id="emailTo" value="${esc((s.emailTo.length ? s.emailTo : env.emailTo).join(', '))}" placeholder="you@example.com, team@example.com"><span class="hint">Comma-separated. Overrides ALERT_EMAIL_TO.</span></div>
            <div class="switch" style="margin-top:6px"><div><div class="label">Email alerts from</div></div><select class="input" style="width:auto" data-set="emailMinSeverity">${sevOpts(s.emailMinSeverity)}</select></div>
            <div class="switch"><div><div class="label">Hourly report by email</div><div class="hint">Sent at the top of every hour</div></div><input type="checkbox" class="toggle" data-set="hourlyEmail" ${s.hourlyEmail ? 'checked' : ''} aria-label="Hourly report by email"></div>
            <div class="switch"><div><div class="label">Hourly summary to phone</div></div><input type="checkbox" class="toggle" data-set="hourlyPush" ${s.hourlyPush ? 'checked' : ''} aria-label="Hourly summary to phone"></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn btn-sm btn-primary" id="saveEmail">Save recipients</button><button class="btn btn-sm" data-test="email">Send test email</button></div>
            ${ns.email.lastError && ns.email.configured ? `<p class="s-down" style="font-size:13px">Last email error: ${esc(ns.email.lastError)}</p>` : ''}
          </section>
        </div>
        <div class="stack">
          <section class="panel">
            <div class="panel-head"><h2>When to alert</h2></div>
            <div class="form-grid">
              ${[['cpuWarn', 'CPU warning %'], ['cpuCrit', 'CPU critical %'], ['memWarn', 'Memory warning %'], ['memCrit', 'Memory critical %'], ['diskWarn', 'Disk warning %'], ['diskCrit', 'Disk critical %'], ['failuresBeforeAlert', 'Failed checks before alert'], ['alertCooldownMin', 'Repeat reminder after (min)'], ['bruteForceThreshold', 'Failed logins per IP / 5 min'], ['scanThreshold', '404s per IP / 5 min'], ['floodThreshold', 'Requests per IP / min'], ['massFileChangeThreshold', 'File changes / 30 s (ransomware)']].map(([k, l]) => `<div class="field"><label for="t-${k}">${l}</label><input class="input num" id="t-${k}" type="number" data-num="${k}" value="${esc(s[k])}"></div>`).join('')}
            </div>
            <button class="btn btn-primary" id="saveThr" style="margin-top:14px">Save thresholds</button>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>Connect another server</h2></div>
            <p class="ink2" style="margin-top:0">Run the agent on any other Linux or Mac server. It sends CPU, memory and disk every 10 seconds, plus attacks from its logs and ransomware checks on its folders.</p>
            <div class="codebox">AGENT_HUB_URL=${esc(hubUrl)} \\
AGENT_TOKEN=${esc(env.agentToken)} \\
AGENT_NAME=$(hostname) \\
AGENT_LOG_FILES=/var/log/nginx/access.log \\
AGENT_WATCH_DIRS=/var/www \\
node agent/agent.js<button class="btn btn-sm copy" data-copy="AGENT_HUB_URL=${esc(hubUrl)} AGENT_TOKEN=${esc(env.agentToken)} AGENT_NAME=$(hostname) AGENT_LOG_FILES=/var/log/nginx/access.log AGENT_WATCH_DIRS=/var/www node agent/agent.js">Copy</button></div>
            <p class="muted" style="font-size:13px">Keep this token secret. The README has a systemd service file so the agent starts on boot.</p>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>This hub</h2></div>
            <table class="table">
              <tr><td class="muted">Name</td><td>${esc(env.serverName)}</td></tr>
              <tr><td class="muted">Access logs</td><td class="mono">${esc(env.logFiles.join(', ') || 'none — set LOG_FILES')}</td></tr>
              <tr><td class="muted">SSH log</td><td class="mono">${esc(env.authLog || 'none — set AUTH_LOG')}</td></tr>
              <tr><td class="muted">Protected folders</td><td class="mono">${esc(env.watchDirs.join(', ') || 'none — set WATCH_DIRS')}</td></tr>
              <tr><td class="muted">Disks</td><td class="mono">${esc(env.diskPaths.join(', '))}</td></tr>
            </table>
            <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
              <button class="btn btn-sm" id="themeBtn">${I.moon}Theme: ${esc(localStorage.getItem('sentinel.theme') || 'system')}</button>
              <button class="btn btn-sm btn-ghost" id="logoutBtn">Sign out</button>
            </div>
          </section>
          ${env.demo ? `<section class="panel"><div class="panel-head"><h2>Try it: simulate an incident</h2></div><p class="ink2" style="margin-top:0">Demo mode only. Each button triggers real detection and real alerts (email/push if set up).</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap">${[['sqli', 'SQL injection'], ['brute', 'Brute-force login'], ['scanner', 'Scanner'], ['flood', 'Request flood'], ['ssh', 'SSH brute-force'], ['ransomware', 'Ransomware'], ['cpu', 'CPU overload'], ['outage', 'Orders API outage']].map(([k, l]) => `<button class="btn btn-sm" data-sim="${k}">${l}</button>`).join('')}</div></section>` : ''}
        </div>
      </div>`;

    const save = async (body, msg = 'Saved') => { S.settings = await api('/settings', { method: 'PUT', body }); toast(msg, '', 'info'); };
    $$('[data-set]').forEach((x) => (x.onchange = () => save({ [x.dataset.set]: x.type === 'checkbox' ? x.checked : x.value })));
    $('#saveEmail').onclick = () => save({ emailTo: $('#emailTo').value }, 'Recipients saved');
    $('#saveThr').onclick = () => save(Object.fromEntries($$('[data-num]').map((x) => [x.dataset.num, +x.value])), 'Thresholds saved');
    $$('[data-test]').forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      try {
        const r = await api('/notify/test', { method: 'POST', body: { channel: b.dataset.test } });
        const v = r.results[b.dataset.test];
        const okMsg = { email: 'Test email sent', push: `Sent to ${plural(v || 0, 'device')}`, ntfy: 'Sent to ntfy' }[b.dataset.test];
        toast(v ? okMsg : 'Not sent', v ? '' : (r.status[b.dataset.test]?.lastError || (b.dataset.test === 'push' ? 'No devices have notifications turned on.' : 'Check configuration.')), v ? 'info' : 'warning');
      } catch (e) { toast('Test failed', e.message, 'warning'); }
      b.disabled = false;
    }));
    $('#pushOn') && ($('#pushOn').onclick = async (e) => { e.currentTarget.disabled = true; try { await enablePush(); toast('Notifications on', 'This device will get alerts.', 'info'); } catch (err) { toast('Couldn’t turn on notifications', err.message, 'warning'); } viewSettings(++renderToken); });
    $('#pushOff') && ($('#pushOff').onclick = async () => { const st = await pushState(); if (st.sub) { await api('/push/unsubscribe', { method: 'POST', body: { endpoint: st.sub.endpoint } }); await st.sub.unsubscribe(); } toast('Notifications off', '', 'info'); viewSettings(++renderToken); });
    $('#installBtn') && ($('#installBtn').onclick = async () => { S.installEvt.prompt(); await S.installEvt.userChoice; S.installEvt = null; viewSettings(++renderToken); });
    $('#logoutBtn').onclick = logout;
    $('#themeBtn').onclick = () => {
      const order = ['system', 'dark', 'light'];
      const cur = localStorage.getItem('sentinel.theme') || 'system';
      const next = order[(order.indexOf(cur) + 1) % 3];
      localStorage.setItem('sentinel.theme', next); applyTheme(); viewSettings(++renderToken);
    };
    $$('[data-sim]').forEach((b) => (b.onclick = async () => { b.disabled = true; await api('/demo/simulate', { method: 'POST', body: { kind: b.dataset.sim } }); toast('Simulation started', b.textContent + ' — watch the Overview.', 'info'); setTimeout(() => (b.disabled = false), 3000); }));
  }

  function applyTheme() {
    const t = localStorage.getItem('sentinel.theme') || 'system';
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    $('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1319' : '#e7ebef');
  }

  // ---------------------------------------------------------------- live stream
  let refreshTimer = null;
  const toasted = new Set();
  function softRefresh(delay = 1200) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if ($('dialog[open]') || document.hidden) return;
      const k = currentView?.key || '/';
      if (/^\/(routes\/|reports|settings)/.test(k)) return; // detail/forms: don't yank the page
      refresh();
    }, delay);
  }
  function setConn(on) {
    S.connected = on;
    for (const id of ['liveDot', 'liveDot2']) { const d = document.getElementById(id); if (d) d.classList.toggle('on', on); }
    const t = $('#liveTxt'); if (t) t.textContent = on ? 'Live' : 'Reconnecting…';
  }
  function connect() {
    if (S.es) S.es.close();
    const es = new EventSource('/api/stream?token=' + encodeURIComponent(S.token));
    S.es = es;
    es.addEventListener('hello', () => setConn(true));
    es.onerror = () => { setConn(false); if (es.readyState === 2) setTimeout(connect, 5000); };
    let lastMetricsDraw = 0;
    es.addEventListener('metrics', (e) => {
      const d = JSON.parse(e.data);
      const k = currentView?.key || '/';
      if (k.startsWith('/servers') && S.cache.server && d.serverId === S.cache.server.id && Date.now() - lastMetricsDraw > 4000) {
        lastMetricsDraw = Date.now();
        const sv = S.cache.server;
        sv.series.push({ t: d.sample.t, cpu: d.sample.cpu, mem: d.sample.mem.pct, disk: d.sample.disk });
        if (sv.series.length > 720) sv.series.shift();
        if (!$(".tip.on")) softRefresh(300);
      } else if (k === '/' && Date.now() - lastMetricsDraw > 10000) { lastMetricsDraw = Date.now(); softRefresh(800); }
    });
    es.addEventListener('alert', (e) => {
      const a = JSON.parse(e.data);
      if (a.status === 'open' && !toasted.has(a.id) && Date.now() - a.t < 15000) { toasted.add(a.id); toast(a.title, a.message, a.severity); }
      softRefresh(600);
    });
    es.addEventListener('check', () => softRefresh(1500));
    es.addEventListener('threat', () => { if ((currentView?.key || '').startsWith('/security') || currentView?.key === '/') softRefresh(2500); });
    es.addEventListener('report', (e) => { const r = JSON.parse(e.data); toast('Hourly report ready', `Status: ${r.status}`, r.status === 'critical' ? 'critical' : 'info'); });
  }

  // ---------------------------------------------------------------- global events
  document.addEventListener('click', async (e) => {
    const ack = e.target.closest('[data-ack]');
    if (ack) { e.preventDefault(); await api(`/alerts/${encodeURIComponent(ack.dataset.ack)}/ack`, { method: 'POST' }); refresh(); return; }
    const cp = e.target.closest('[data-copy]');
    if (cp) { e.preventDefault(); try { await navigator.clipboard.writeText(cp.dataset.copy); cp.textContent = 'Copied'; setTimeout(() => (cp.textContent = 'Copy'), 1500); } catch { toast('Copy failed', 'Select the text and copy it manually.'); } return; }
    if (e.target.closest('[data-add-route]')) { e.preventDefault(); routeForm(); }
  });
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (!$('dialog[open]')) refresh(); }, 250); });
  window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.token) { if (!S.es || S.es.readyState === 2) connect(); refresh(); } });
  setInterval(() => { if (!document.hidden && S.token && !$('dialog[open]')) softRefresh(0); }, 30000);

  async function boot() {
    applyTheme();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    try { S.info = await (await fetch('/api/public/info')).json(); } catch { S.info = { name: 'Sentinel' }; }
    if (!S.token) return renderLogin();
    renderShell();
    connect();
    route();
  }
  boot();
})();
