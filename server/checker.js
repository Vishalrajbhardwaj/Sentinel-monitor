// Route / API health checker: hits each configured route, compares against the expected result,
// classifies what went wrong, and raises/clears alerts.
const net = require('net');
const tls = require('tls');
const { state, bus, pushBounded, uid, LIMITS } = require('./store');
const alerts = require('./alerts');

const ISSUES = {
  DNS_FAILURE:        { label: 'DNS failure',           sev: 'critical', hint: 'Domain cannot be resolved. Check DNS records / domain expiry.' },
  CONNECTION_REFUSED: { label: 'Connection refused',    sev: 'critical', hint: 'Nothing is listening on that port — the service/container is probably stopped or crashed. Restart it (pm2/systemctl/docker).' },
  TIMEOUT:            { label: 'Timeout',               sev: 'critical', hint: 'No response in time — server overloaded, hung process, DB lock or firewall dropping packets.' },
  TLS_ERROR:          { label: 'SSL/TLS error',         sev: 'critical', hint: 'TLS handshake failed — certificate expired, wrong hostname or bad chain. Renew with certbot.' },
  NETWORK_ERROR:      { label: 'Network error',         sev: 'critical', hint: 'Connection reset / unreachable host. Check server network, load balancer and firewall.' },
  HTTP_5XX:           { label: 'Server error (5xx)',    sev: 'critical', hint: 'The app crashed or an upstream (DB, cache, 3rd-party API) failed. Check app logs for this route.' },
  HTTP_502_504:       { label: 'Gateway error',         sev: 'critical', hint: 'Reverse proxy (nginx/LB) cannot reach the app — app process down or too slow.' },
  AUTH_FAILED:        { label: 'Auth rejected (401/403)', sev: 'high',   hint: 'Monitor token/API key expired or permissions changed.' },
  NOT_FOUND:          { label: 'Route not found (404)', sev: 'high',     hint: 'Route missing — bad deploy, renamed path or proxy rule removed.' },
  RATE_LIMITED:       { label: 'Rate limited (429)',    sev: 'warning',  hint: 'Too many requests — lower check frequency or whitelist the monitor IP.' },
  STATUS_MISMATCH:    { label: 'Unexpected status',     sev: 'high',     hint: 'Status code differs from what this route should return.' },
  BODY_MISMATCH:      { label: 'Response mismatch',     sev: 'high',     hint: 'Response came back but the content is not what was expected — logic/data issue.' },
  SLOW_RESPONSE:      { label: 'Slow response',         sev: 'warning',  hint: 'Responding slower than the allowed latency — check DB queries, CPU and traffic.' },
  SSL_EXPIRING:       { label: 'SSL expiring soon',     sev: 'warning',  hint: 'Renew the SSL certificate before it expires (certbot renew).' },
};

const sslCache = new Map(); // host -> {t, daysLeft, error}

function getPath(obj, p) {
  return p.split('.').reduce((o, k) => (o == null ? undefined : o[/^\d+$/.test(k) ? +k : k]), obj);
}

function statusMatches(expect, code) {
  if (expect === undefined || expect === null || expect === '') return code >= 200 && code < 400;
  return String(expect).split(',').map((s) => s.trim()).some((e) => {
    if (/^\dxx$/i.test(e)) return Math.floor(code / 100) === +e[0];
    return +e === code;
  });
}

function classifyHttp(code) {
  if (code === 502 || code === 503 || code === 504) return 'HTTP_502_504';
  if (code >= 500) return 'HTTP_5XX';
  if (code === 401 || code === 403) return 'AUTH_FAILED';
  if (code === 404) return 'NOT_FOUND';
  if (code === 429) return 'RATE_LIMITED';
  return 'STATUS_MISMATCH';
}

function classifyError(e) {
  const c = e?.cause?.code || e?.code || '';
  if (e.name === 'AbortError' || e.name === 'TimeoutError' || c === 'ETIMEDOUT' || c === 'UND_ERR_CONNECT_TIMEOUT' || c === 'UND_ERR_HEADERS_TIMEOUT') return 'TIMEOUT';
  if (c === 'ENOTFOUND' || c === 'EAI_AGAIN') return 'DNS_FAILURE';
  if (c === 'ECONNREFUSED') return 'CONNECTION_REFUSED';
  if (/CERT|SSL|TLS|SELF_SIGNED|ERR_TLS/i.test(c) || /certificate|ssl|tls/i.test(e?.cause?.message || '')) return 'TLS_ERROR';
  return 'NETWORK_ERROR';
}

function sslDaysLeft(host, port = 443) {
  return new Promise((resolve) => {
    const sock = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: 8000 }, () => {
      const cert = sock.getPeerCertificate();
      sock.end();
      if (!cert || !cert.valid_to) return resolve(null);
      resolve(Math.floor((new Date(cert.valid_to) - Date.now()) / 86400000));
    });
    sock.on('error', () => resolve(null));
    sock.on('timeout', () => { sock.destroy(); resolve(null); });
  });
}

function tcpCheck(host, port, timeout) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const sock = net.connect({ host, port });
    const done = (err) => { sock.destroy(); resolve({ ms: Math.round(performance.now() - t0), err }); };
    sock.setTimeout(timeout, () => done({ name: 'TimeoutError' }));
    sock.on('connect', () => done(null));
    sock.on('error', (e) => done(e));
  });
}

async function runCheck(route) {
  const t = Date.now();
  const timeout = route.timeoutMs || 10000;
  const res = { t, ok: false, result: 'down', ms: null, code: null, issue: null, detail: '' };

  try {
    if (route.type === 'tcp') {
      const { ms, err } = await tcpCheck(route.host, +route.port, timeout);
      res.ms = ms;
      if (err) { res.issue = classifyError(err); res.detail = err.code || err.message || err.name; }
      else { res.ok = true; res.result = 'ok'; }
    } else {
      const headers = { 'User-Agent': 'Sentinel-Monitor/1.0', ...(route.headers || {}) };
      const opts = { method: route.method || 'GET', headers, signal: AbortSignal.timeout(timeout), redirect: 'follow' };
      if (route.body && !['GET', 'HEAD'].includes(opts.method)) {
        opts.body = typeof route.body === 'string' ? route.body : JSON.stringify(route.body);
        if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
      }
      const t0 = performance.now();
      const r = await fetch(route.url, opts);
      const text = await r.text();
      res.ms = Math.round(performance.now() - t0);
      res.code = r.status;
      res.size = text.length;
      res.preview = text.slice(0, 280);

      if (!statusMatches(route.expectStatus, r.status)) {
        res.issue = classifyHttp(r.status);
        res.detail = `Expected ${route.expectStatus || '2xx/3xx'}, got ${r.status}`;
      } else if (route.expectContains && !text.includes(route.expectContains)) {
        res.issue = 'BODY_MISMATCH';
        res.detail = `Response does not contain “${route.expectContains}”`;
      } else if (route.expectNotContains && text.includes(route.expectNotContains)) {
        res.issue = 'BODY_MISMATCH';
        res.detail = `Response contains forbidden text “${route.expectNotContains}”`;
      } else if (route.expectJsonPath) {
        let json;
        try { json = JSON.parse(text); } catch { json = undefined; }
        const actual = json === undefined ? undefined : getPath(json, route.expectJsonPath);
        const want = route.expectJsonValue;
        const okVal = want === undefined || want === '' ? actual !== undefined : String(actual) === String(want);
        if (!okVal) {
          res.issue = 'BODY_MISMATCH';
          res.detail = json === undefined ? 'Response is not valid JSON' : `${route.expectJsonPath} = ${JSON.stringify(actual)} (expected ${want === undefined || want === '' ? 'present' : JSON.stringify(want)})`;
        }
      }

      if (!res.issue) {
        res.ok = true;
        res.result = 'ok';
        if (route.maxLatencyMs && res.ms > route.maxLatencyMs) {
          res.result = 'degraded';
          res.issue = 'SLOW_RESPONSE';
          res.detail = `${res.ms} ms > limit ${route.maxLatencyMs} ms`;
        }
      } else {
        res.result = ['BODY_MISMATCH', 'STATUS_MISMATCH', 'AUTH_FAILED', 'NOT_FOUND', 'RATE_LIMITED'].includes(res.issue) ? 'mismatch' : 'down';
      }

      // SSL expiry (cached 6h)
      if (route.url.startsWith('https://')) {
        const u = new URL(route.url);
        let c = sslCache.get(u.host);
        if (!c || Date.now() - c.t > 6 * 3600_000) {
          c = { t: Date.now(), days: await sslDaysLeft(u.hostname, +(u.port || 443)) };
          sslCache.set(u.host, c);
        }
        res.sslDays = c.days;
        if (res.ok && c.days !== null && c.days <= 14) {
          res.result = 'degraded';
          res.issue = res.issue || 'SSL_EXPIRING';
          if (res.issue === 'SSL_EXPIRING') res.detail = `Certificate expires in ${c.days} day(s)`;
        }
      }
    }
  } catch (e) {
    res.ms = res.ms ?? Date.now() - t;
    res.issue = classifyError(e);
    res.detail = (e?.cause?.code || '') + ' ' + (e?.cause?.message || e.message || '');
    res.result = 'down';
  }
  res.detail = (res.detail || '').trim();
  return res;
}

function applyResult(route, res) {
  const id = route.id;
  const rs = (state.routeState[id] = state.routeState[id] || { consecutive: 0, status: 'pending' });
  const arr = (state.checks[id] = state.checks[id] || []);
  pushBounded(arr, { t: res.t, r: res.result, ms: res.ms, c: res.code, i: res.issue, d: res.detail }, LIMITS.checksPerRoute);

  const prev = rs.status;
  rs.lastCheck = res.t;
  rs.lastMs = res.ms;
  rs.lastCode = res.code;
  rs.lastIssue = res.issue;
  rs.lastDetail = res.detail;
  rs.preview = res.preview;
  rs.sslDays = res.sslDays;
  if (res.result === 'ok') { rs.consecutive = 0; rs.lastOkAt = res.t; }
  else rs.consecutive++;
  if (res.result !== 'ok') rs.lastFailAt = res.t;

  const need = state.settings.failuresBeforeAlert || 2;
  // status shown only after it's confirmed (avoid flapping), except first ever check
  if (res.result === 'ok') rs.status = 'ok';
  else if (rs.consecutive >= need || prev === 'pending') rs.status = res.result;

  const key = `route:${id}`;
  if (res.result !== 'ok' && rs.consecutive >= need) {
    const meta = ISSUES[res.issue] || ISSUES.NETWORK_ERROR;
    const sev = res.result === 'degraded' ? 'warning' : meta.sev;
    const target = route.type === 'tcp' ? `${route.host}:${route.port}` : `${route.method || 'GET'} ${route.url}`;
    alerts.raise({
      key, severity: sev, category: 'health',
      title: `${route.name}: ${meta.label}`,
      message: `${target} — ${res.detail || meta.label}${res.code ? ` (HTTP ${res.code})` : ''}. Failing ${rs.consecutive} checks in a row.`,
      action: meta.hint,
      details: { Route: target, Issue: meta.label, 'HTTP status': res.code, 'Response time': res.ms != null ? res.ms + ' ms' : undefined, Detail: res.detail, 'Response preview': res.preview ? res.preview.slice(0, 160) : undefined },
      routeId: id, serverId: route.serverId, link: `/#/routes/${id}`,
    });
  } else if (res.result === 'ok' && alerts.isOpen(key)) {
    alerts.resolve(key, `${route.name} is healthy again (${res.ms} ms).`);
  }

  bus.emit('check', { routeId: id, res, state: rs });
}

// ---------- scheduler ----------
const running = new Set();
let MAX_PARALLEL = 8;

function tick() {
  const now = Date.now();
  for (const route of state.routes) {
    if (route.paused || running.has(route.id) || running.size >= MAX_PARALLEL) continue;
    const rs = state.routeState[route.id];
    const interval = (route.intervalSec || 60) * 1000;
    if (rs && rs.lastCheck && now - rs.lastCheck < interval) continue;
    checkNow(route.id);
  }
}

async function checkNow(id) {
  const route = state.routes.find((r) => r.id === id);
  if (!route || running.has(id)) return null;
  running.add(id);
  try {
    const res = await runCheck(route);
    if (state.routes.find((r) => r.id === id)) applyResult(route, res);
    return res;
  } finally {
    running.delete(id);
  }
}

function start() {
  setInterval(tick, 1000).unref?.();
  setTimeout(tick, 500);
}

function normalizeRoute(input, existing = {}) {
  const r = { ...existing };
  const fields = ['name', 'type', 'method', 'url', 'host', 'port', 'headers', 'body', 'expectStatus', 'expectContains', 'expectNotContains', 'expectJsonPath', 'expectJsonValue', 'maxLatencyMs', 'timeoutMs', 'intervalSec', 'group', 'serverId', 'paused'];
  for (const f of fields) if (input[f] !== undefined) r[f] = input[f];
  r.id = existing.id || uid('rt_');
  r.type = r.type === 'tcp' ? 'tcp' : 'http';
  r.method = (r.method || 'GET').toUpperCase();
  r.intervalSec = Math.max(10, Math.min(86400, +r.intervalSec || 60));
  r.timeoutMs = Math.max(1000, Math.min(60000, +r.timeoutMs || 10000));
  r.maxLatencyMs = r.maxLatencyMs ? +r.maxLatencyMs : 2000;
  if (typeof r.headers === 'string') { try { r.headers = r.headers.trim() ? JSON.parse(r.headers) : {}; } catch { r.headers = {}; } }
  r.name = r.name || (r.type === 'tcp' ? `${r.host}:${r.port}` : r.url);
  if (r.type === 'http') {
    try { new URL(r.url); } catch { throw new Error('Invalid URL'); }
  } else if (!r.host || !r.port) throw new Error('Host and port are required for TCP checks');
  return r;
}

module.exports = { start, checkNow, runCheck, normalizeRoute, ISSUES };
