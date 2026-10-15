// Sentinel hub — API + live stream + collectors. Start with: node server/index.js
const path = require('path');
const express = require('express');
const config = require('./config');
const store = require('./store');
const { state, bus } = store;
const alerts = require('./alerts');
const notify = require('./notify');
const checker = require('./checker');
const metrics = require('./metrics');
const threats = require('./threats');
const reports = require('./reports');
const auth = require('./auth');
const { createSampler, hostInfo } = require('./collectors/system');
const { tailFile, parseAccessLine, parseAuthLine } = require('./collectors/logtail');
const { startRansomwareWatch } = require('./collectors/fswatch');

store.load();
alerts.rebuildIndex();

const app = express();
app.disable('x-powered-by');
if (config.TRUST_PROXY) app.set('trust proxy', true);
app.use(express.json({ limit: '5mb' }));

// Basic security headers for the dashboard itself
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  next();
});

// ---------------- helpers ----------------
const SEV = { critical: 3, high: 2, warning: 1, info: 0 };

function uptimeOf(checks, since) {
  const pts = checks.filter((c) => c.t >= since);
  if (!pts.length) return null;
  return +((pts.filter((c) => c.r === 'ok' || c.r === 'degraded').length / pts.length) * 100).toFixed(2);
}

function routeSummary(r) {
  const rs = state.routeState[r.id] || { status: 'pending' };
  const checks = state.checks[r.id] || [];
  const day = Date.now() - 86400_000;
  const okMs = checks.filter((c) => c.t >= day && c.ms != null);
  return {
    ...r,
    target: r.type === 'tcp' ? `${r.host}:${r.port}` : `${r.method} ${r.url}`,
    state: rs,
    uptime24h: uptimeOf(checks, day),
    avgMs24h: okMs.length ? Math.round(okMs.reduce((a, c) => a + c.ms, 0) / okMs.length) : null,
    spark: checks.slice(-40),
  };
}

function overallStatus() {
  const open = alerts.openAlerts();
  const routeStates = state.routes.filter((r) => !r.paused).map((r) => state.routeState[r.id]?.status || 'pending');
  const servers = Object.values(state.servers);
  let level = 'healthy';
  const reasons = [];
  const down = routeStates.filter((s) => s === 'down').length;
  const mism = routeStates.filter((s) => s === 'mismatch').length;
  const degr = routeStates.filter((s) => s === 'degraded').length;
  const crit = open.filter((a) => a.severity === 'critical');
  const offline = servers.filter((s) => !s.online);
  if (down) reasons.push(`${down} route${down > 1 ? 's' : ''} down`);
  if (mism) reasons.push(`${mism} route${mism > 1 ? 's' : ''} returning wrong result`);
  if (degr) reasons.push(`${degr} slow`);
  if (offline.length) reasons.push(`${offline.length} server${offline.length > 1 ? 's' : ''} offline`);
  const ransom = open.filter((a) => a.category === 'ransomware');
  if (ransom.length) reasons.unshift('RANSOMWARE ACTIVITY');
  const sec = open.filter((a) => a.category === 'security');
  if (sec.length) reasons.push(`${sec.length} active attack${sec.length > 1 ? 's' : ''}`);
  const res = open.filter((a) => a.category === 'resources');
  if (res.length) reasons.push(`${res.length} resource warning${res.length > 1 ? 's' : ''}`);
  if (mism || degr || open.length) level = 'warning';
  if (down || crit.length || offline.length || ransom.length) level = 'critical';
  return { level, reasons, text: reasons.length ? reasons.join(' · ') : 'All systems operational' };
}

// ---------------- auth ----------------
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  if (!auth.loginAllowed(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  if (auth.safeEqual(req.body?.password || '', config.ADMIN_PASSWORD)) return res.json({ token: auth.issue() });
  const n = auth.loginFailed(ip);
  if (n >= 5) threats.record({ serverId: config.SERVER_ID, type: 'DASHBOARD_LOGIN', ip, route: '/api/login', method: 'POST', status: 401, ua: req.get('user-agent') || '', desc: `${n} failed dashboard logins` });
  res.status(401).json({ error: 'Wrong password' });
});

app.get('/api/public/info', (req, res) => res.json({ name: config.SERVER_NAME, demo: config.DEMO, vapidPublicKey: notify.vapidPublicKey }));

// ---------------- agent ingest (remote servers & app middleware) ----------------
app.post('/api/agent/push', auth.requireAgent, (req, res) => {
  const b = req.body || {};
  const sid = String(b.serverId || 'agent').slice(0, 64);
  if (b.sample) metrics.processSample(sid, b.sample, { name: b.name, info: b.info });
  else if (b.name) { const s = metrics.ensureServer(sid, b.name, b.info); s.lastSeen = Date.now(); s.online = true; }
  for (const r of (b.requests || []).slice(0, 20000)) threats.processRequest(sid, r);
  for (const e of (b.auth || []).slice(0, 5000)) threats.processAuth(sid, e);
  for (const e of (b.files || []).slice(0, 1000)) threats.processFileEvent(sid, e);
  res.json({ ok: true });
});

// ---------------- dashboard API ----------------
const api = express.Router();
api.use(auth.requireAuth);

api.get('/overview', (req, res) => {
  const routes = state.routes.map(routeSummary);
  const open = alerts.openAlerts().sort((a, b) => SEV[b.severity] - SEV[a.severity] || b.lastT - a.lastT);
  const st = threats.stats({ hours: 24 });
  res.json({
    server: { id: config.SERVER_ID, name: config.SERVER_NAME, startedAt: state.meta.startedAt, demo: config.DEMO },
    status: overallStatus(),
    counts: {
      routes: routes.length,
      ok: routes.filter((r) => r.state.status === 'ok').length,
      down: routes.filter((r) => r.state.status === 'down').length,
      mismatch: routes.filter((r) => r.state.status === 'mismatch').length,
      degraded: routes.filter((r) => r.state.status === 'degraded').length,
      openAlerts: open.length,
      critical: open.filter((a) => a.severity === 'critical').length,
      threats24h: st.total,
      incidents24h: st.incidents,
      servers: Object.keys(state.servers).length,
      online: Object.values(state.servers).filter((s) => s.online).length,
    },
    routes,
    servers: Object.values(state.servers).map(metrics.summary),
    alerts: open.slice(0, 20),
    threats: state.threats.slice(-15).reverse(),
    threatStats: st,
    hour: reports.now(),
    notify: notify.status,
  });
});

// routes
api.get('/routes', (req, res) => res.json(state.routes.map(routeSummary)));
api.get('/routes/:id', (req, res) => {
  const r = state.routes.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  const checks = state.checks[r.id] || [];
  const HOUR = 3600_000;
  const start = config.hourStart() - 23 * HOUR;
  const hourly = [];
  for (let h = start; h <= Date.now(); h += HOUR) {
    const pts = checks.filter((c) => c.t >= h && c.t < h + HOUR);
    const ms = pts.filter((c) => c.ms != null);
    hourly.push({
      t: h, checks: pts.length,
      uptime: pts.length ? +((pts.filter((c) => c.r === 'ok' || c.r === 'degraded').length / pts.length) * 100).toFixed(1) : null,
      avgMs: ms.length ? Math.round(ms.reduce((a, c) => a + c.ms, 0) / ms.length) : null,
      fails: pts.filter((c) => c.r === 'down' || c.r === 'mismatch').length,
    });
  }
  const issues = {};
  for (const c of checks) if (c.i) issues[c.i] = (issues[c.i] || 0) + 1;
  res.json({
    ...routeSummary(r), checks, hourly, issues, issueMeta: checker.ISSUES,
    alerts: state.alerts.filter((a) => a.routeId === r.id).slice(-20).reverse(),
  });
});
api.post('/routes', (req, res) => {
  try {
    const r = checker.normalizeRoute(req.body || {});
    state.routes.push(r);
    store.save();
    checker.checkNow(r.id);
    res.json(r);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
api.put('/routes/:id', (req, res) => {
  const i = state.routes.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'not found' });
  try {
    state.routes[i] = checker.normalizeRoute(req.body || {}, state.routes[i]);
    store.save();
    checker.checkNow(state.routes[i].id);
    res.json(state.routes[i]);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
api.delete('/routes/:id', (req, res) => {
  state.routes = state.routes.filter((x) => x.id !== req.params.id);
  delete state.routeState[req.params.id];
  delete state.checks[req.params.id];
  alerts.resolve(`route:${req.params.id}`, 'Route removed from monitoring.');
  store.save();
  res.json({ ok: true });
});
api.post('/routes/:id/check', async (req, res) => {
  const r = await checker.checkNow(req.params.id);
  res.json(r || { error: 'busy or not found' });
});
api.post('/routes/test', async (req, res) => {
  try { res.json(await checker.runCheck(checker.normalizeRoute(req.body || {}))); } catch (e) { res.status(400).json({ error: e.message }); }
});

// servers / resources
api.get('/servers', (req, res) => res.json(Object.values(state.servers).map(metrics.summary)));
api.get('/servers/:id', (req, res) => {
  const d = metrics.detail(req.params.id);
  d ? res.json(d) : res.status(404).json({ error: 'not found' });
});
api.delete('/servers/:id', (req, res) => {
  if (req.params.id === config.SERVER_ID) return res.status(400).json({ error: 'cannot remove hub' });
  delete state.servers[req.params.id];
  alerts.resolve(`offline:${req.params.id}`, 'Server removed.');
  res.json({ ok: true });
});

// security
api.get('/threats', (req, res) => {
  let list = state.threats;
  if (req.query.category) list = list.filter((t) => t.category === req.query.category);
  if (req.query.severity) list = list.filter((t) => SEV[t.severity] >= SEV[req.query.severity]);
  if (req.query.ip) list = list.filter((t) => t.ip === req.query.ip);
  res.json(list.slice(-(+req.query.limit || 200)).reverse());
});
api.get('/threats/stats', (req, res) => {
  const st = threats.stats({ hours: +req.query.hours || 24 });
  const traffic = {};
  for (const [sid, arr] of Object.entries(state.traffic)) traffic[sid] = arr.slice(-(+req.query.minutes || 360));
  res.json({ ...st, traffic });
});

// alerts
api.get('/alerts', (req, res) => {
  let list = state.alerts;
  if (req.query.status) list = list.filter((a) => a.status === req.query.status);
  res.json(list.slice(-(+req.query.limit || 200)).reverse());
});
api.post('/alerts/:id/ack', (req, res) => res.json(alerts.ack(req.params.id) || { error: 'not found' }));
api.post('/alerts/ack-all', (req, res) => { alerts.ackAll(); res.json({ ok: true }); });

// reports
api.get('/reports', (req, res) => res.json(state.reports.slice().reverse().map(({ routes, resources, ...r }) => ({ ...r, routeCount: routes.length, resources: resources.map((x) => ({ name: x.name, verdict: x.verdict, free: x.free })) }))));
api.get('/reports/current', (req, res) => res.json(reports.now()));
api.get('/reports/:id', (req, res) => {
  const r = state.reports.find((x) => x.id === req.params.id);
  r ? res.json(r) : res.status(404).json({ error: 'not found' });
});
api.post('/reports/send-now', async (req, res) => {
  const rep = reports.now();
  const ok = await notify.sendEmail(reports.reportEmail(rep));
  const pushed = await notify.sendPush({ title: `Report (so far this hour): ${rep.status}`, body: rep.lines.slice(0, 3).join(' '), tag: 'hourly-report', url: '/#/reports' });
  res.json({ email: ok, push: pushed, report: rep });
});

// settings
api.get('/settings', (req, res) => res.json({
  settings: state.settings,
  env: {
    serverName: config.SERVER_NAME, publicUrl: config.PUBLIC_URL, smtp: !!config.SMTP_HOST, smtpUser: config.SMTP_USER, emailProvider: notify.status.email.provider, mailFrom: config.MAIL_FROM,
    emailTo: config.ALERT_EMAIL_TO, ntfy: !!config.NTFY_URL, logFiles: config.LOG_FILES, authLog: config.AUTH_LOG,
    watchDirs: config.WATCH_DIRS, diskPaths: config.DISK_PATHS, agentToken: config.AGENT_TOKEN, demo: config.DEMO,
  },
  notify: notify.status,
  pushDevices: state.pushSubs.map((s) => ({ endpoint: s.endpoint.slice(0, 60) + '…', label: s.label, createdAt: s.createdAt })),
}));
api.put('/settings', (req, res) => {
  const b = req.body || {};
  const s = state.settings;
  const nums = ['cpuWarn', 'cpuCrit', 'memWarn', 'memCrit', 'diskWarn', 'diskCrit', 'failuresBeforeAlert', 'alertCooldownMin', 'bruteForceThreshold', 'scanThreshold', 'floodThreshold', 'massFileChangeThreshold'];
  for (const k of nums) if (b[k] !== undefined && !isNaN(+b[k])) s[k] = +b[k];
  for (const k of ['hourlyEmail', 'hourlyPush', 'autoBlockHint']) if (b[k] !== undefined) s[k] = !!b[k];
  for (const k of ['emailMinSeverity', 'pushMinSeverity']) if (SEV[b[k]] !== undefined) s[k] = b[k];
  if (b.emailTo !== undefined) s.emailTo = (Array.isArray(b.emailTo) ? b.emailTo : String(b.emailTo).split(',')).map((x) => x.trim()).filter((x) => /.+@.+\..+/.test(x));
  store.save();
  res.json(s);
});

// notifications
api.post('/push/subscribe', (req, res) => {
  const sub = req.body?.subscription;
  if (!sub?.endpoint) return res.status(400).json({ error: 'bad subscription' });
  state.pushSubs = state.pushSubs.filter((s) => s.endpoint !== sub.endpoint);
  state.pushSubs.push({ ...sub, label: (req.body.label || req.get('user-agent') || '').slice(0, 80), createdAt: Date.now() });
  store.save();
  res.json({ ok: true, devices: state.pushSubs.length });
});
api.post('/push/unsubscribe', (req, res) => {
  state.pushSubs = state.pushSubs.filter((s) => s.endpoint !== req.body?.endpoint);
  store.save();
  res.json({ ok: true });
});
api.post('/notify/test', async (req, res) => {
  const ch = req.body?.channel || 'all';
  const out = {};
  const msg = `Test notification from Sentinel at ${new Date().toLocaleTimeString('en-IN')}. If you can read this, alerts will reach you.`;
  if (ch === 'all' || ch === 'email') out.email = await notify.sendEmail({ subject: '✅ Sentinel test alert', html: notify.emailShell('Test alert — notifications are working', '#22c55e', `<p style="font-size:15px">${msg}</p>`), text: msg });
  if (ch === 'all' || ch === 'push') out.push = await notify.sendPush({ title: '✅ Sentinel test', body: msg, tag: 'test', url: '/#/settings' });
  if (ch === 'all' || ch === 'ntfy') out.ntfy = await notify.sendNtfy({ title: 'Sentinel test', message: msg, severity: 'info' });
  res.json({ results: out, status: notify.status });
});

// ---------------- live stream (SSE) ----------------
const clients = new Set();
api.get('/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(`event: hello\ndata: ${JSON.stringify({ t: Date.now() })}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
});
function broadcast(event, data) {
  if (!clients.size) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(msg);
}
bus.on('metrics', (d) => broadcast('metrics', { serverId: d.serverId, name: d.name, capacity: d.capacity, sample: { ...d.sample, top: d.sample.top } }));
bus.on('check', (d) => broadcast('check', d));
bus.on('threat', (d) => broadcast('threat', d));
bus.on('alert', (d) => broadcast('alert', d));
bus.on('report', (d) => broadcast('report', { id: d.id, status: d.status, hourStart: d.hourStart }));
bus.on('traffic', (d) => broadcast('traffic', d));
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); broadcast('status', overallStatus()); }, 20_000).unref();

app.use('/api', api);

// ---------------- demo mode ----------------
if (config.DEMO) require('./demo').install(app, { metrics, threats, checker, reports });

// ---------------- static PWA ----------------
const pub = path.join(config.ROOT, 'public');
app.use(express.static(pub, {
  setHeaders(res, file) {
    if (/sw\.js$|index\.html$|manifest\.webmanifest$/.test(file)) res.set('Cache-Control', 'no-cache');
    if (file.endsWith('.webmanifest')) res.set('Content-Type', 'application/manifest+json');
  },
}));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(pub, 'index.html')));

// ---------------- local collectors ----------------
if (config.MONITOR_LOCAL) {
  const sampler = createSampler({ diskPaths: config.DISK_PATHS });
  const info = hostInfo();
  metrics.ensureServer(config.SERVER_ID, config.SERVER_NAME, info).local = true;
  const tick = async () => { try { metrics.processSample(config.SERVER_ID, await sampler(), { name: config.SERVER_NAME, info }); } catch (e) { console.error('[metrics]', e.message); } };
  setInterval(tick, 5000);
  setTimeout(tick, 1000);
}
for (const f of config.LOG_FILES) {
  console.log('[logs] following', f);
  tailFile(f, (line) => threats.processRequest(config.SERVER_ID, parseAccessLine(line)));
}
if (config.AUTH_LOG) {
  console.log('[ssh] following', config.AUTH_LOG);
  tailFile(config.AUTH_LOG, (line) => threats.processAuth(config.SERVER_ID, parseAuthLine(line)));
}
if (config.WATCH_DIRS.length) {
  startRansomwareWatch({ dirs: config.WATCH_DIRS, getSettings: () => state.settings, emit: (ev) => threats.processFileEvent(config.SERVER_ID, ev) });
}

checker.start();
reports.start();
setInterval(store.save, 30_000).unref();
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { store.save(); process.exit(0); });

app.listen(config.PORT, config.HOST, () => {
  console.log(`\n  Sentinel running →  http://localhost:${config.PORT}`);
  console.log(`  Dashboard password: ${config.ADMIN_PASSWORD === 'admin123' ? 'admin123 (CHANGE THIS in .env!)' : '(from .env)'}`);
  console.log(`  Agent token: ${config.AGENT_TOKEN.slice(0, 6)}… (see Settings)\n`);
});
