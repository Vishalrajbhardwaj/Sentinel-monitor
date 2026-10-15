// Threat engine: signature + behaviour detection over HTTP requests, SSH auth events and ransomware events.
const { state, bus, pushBounded, uid, LIMITS } = require('./store');
const alerts = require('./alerts');

const TYPES = {
  SQL_INJECTION:     { label: 'SQL Injection',              cat: 'attack',     sev: 'high' },
  XSS:               { label: 'Cross-Site Scripting',       cat: 'attack',     sev: 'warning' },
  PATH_TRAVERSAL:    { label: 'Path Traversal',             cat: 'attack',     sev: 'high' },
  CMD_INJECTION:     { label: 'Command Injection',          cat: 'attack',     sev: 'critical' },
  LOG4SHELL:         { label: 'Log4Shell / JNDI Exploit',   cat: 'attack',     sev: 'critical' },
  SENSITIVE_PROBE:   { label: 'Sensitive File Probe',       cat: 'recon',      sev: 'warning' },
  SCANNER:           { label: 'Vulnerability Scanner',      cat: 'recon',      sev: 'warning' },
  SCANNING:          { label: 'Directory Enumeration',      cat: 'recon',      sev: 'warning' },
  BRUTE_FORCE:       { label: 'Brute-force Login',          cat: 'attack',     sev: 'high' },
  SSH_BRUTE_FORCE:   { label: 'SSH Brute-force',            cat: 'attack',     sev: 'high' },
  FLOOD:             { label: 'Request Flood (DoS)',        cat: 'attack',     sev: 'high' },
  DDOS:              { label: 'Traffic Spike (DDoS)',       cat: 'attack',     sev: 'critical' },
  RANSOMWARE_CANARY: { label: 'Ransomware: canary tripped', cat: 'ransomware', sev: 'critical' },
  RANSOMWARE_EXT:    { label: 'Ransomware: encrypted files', cat: 'ransomware', sev: 'critical' },
  RANSOM_NOTE:       { label: 'Ransomware: ransom note',    cat: 'ransomware', sev: 'critical' },
  MASS_FILE_CHANGE:  { label: 'Mass File Modification',     cat: 'ransomware', sev: 'high' },
  HIGH_ENTROPY:      { label: 'Encrypted-looking Writes',   cat: 'ransomware', sev: 'high' },
  DASHBOARD_LOGIN:   { label: 'Dashboard Login Attack',     cat: 'attack',     sev: 'high' },
  ROOT_LOGIN:        { label: 'Root SSH Login',             cat: 'audit',      sev: 'warning' },
};

const SIGS = [
  ['LOG4SHELL', /\$\{\s*(jndi|lower|upper|env|sys|::-)/i],
  ['SQL_INJECTION', /(\bunion\b[\s\S]{0,20}\bselect\b|\bselect\b[\s\S]{1,40}\bfrom\b[\s\S]{0,40}(information_schema|pg_|mysql\.|sysobjects)|'\s*(or|and)\s*'?\d+'?\s*=\s*'?\d+|\b(or|and)\s+\d+\s*=\s*\d+\s*(--|#|\/\*)|\bsleep\s*\(\s*\d+\s*\)|\bbenchmark\s*\(|\bwaitfor\s+delay\b|;\s*(drop|truncate|alter|insert|delete|update)\s+\w|\bxp_cmdshell\b|\bload_file\s*\(|\binto\s+outfile\b)/i],
  ['XSS', /(<\s*script\b|<\s*\/\s*script|javascript\s*:|\bon(error|load|mouseover|focus|click)\s*=|<\s*(img|svg|iframe|body)\b[^>]*\bon\w+\s*=|document\.cookie|\balert\s*\(|<\s*iframe)/i],
  ['PATH_TRAVERSAL', /(\.\.[\/\\]){1,}|\/etc\/(passwd|shadow|hosts)|\b(boot|win)\.ini\b|\/proc\/self\/|c:\\windows/i],
  ['CMD_INJECTION', /([;|`]\s*(cat|wget|curl|nc|ncat|bash|sh|chmod|rm|python|perl|powershell)\b|\$\((?!\s*\))|\b(\/bin\/(ba)?sh|cmd\.exe|powershell\.exe)\b|\|\s*sh\b)/i],
  ['SENSITIVE_PROBE', /^\/?(?:[^?#]*\/)?(\.env(\.\w+)?|\.git\/|\.svn\/|\.htaccess|\.htpasswd|\.aws\/|\.ssh\/|\.DS_Store|wp-config\.php|config\.php(\.bak)?|phpinfo\.php|phpmyadmin|pma\/|adminer\.php|server-status|actuator\/(env|heapdump)|\.well-known\/security\.txt\.bak|backup\.(zip|sql|tar\.gz)|db\.sql|dump\.sql|id_rsa|web\.config|xmlrpc\.php|wp-login\.php|wp-admin|cgi-bin\/|vendor\/phpunit|_profiler|telescope|\.vscode\/|docker-compose\.ya?ml)(\b|$)/i],
];
const SCANNER_UA = /(sqlmap|nikto|nmap|masscan|zgrab|gobuster|dirbuster|dirb\/|wfuzz|ffuf|feroxbuster|wpscan|nuclei|acunetix|nessus|openvas|w3af|arachni|havij|netsparker|burp|zmeu|jorgee|httpx|interactsh|fimap|commix|hydra|medusa)/i;
const AUTH_ROUTE = /(login|signin|sign-in|auth|token|session|oauth|password|otp|verify|wp-login|admin)/i;

const SUGGEST = {
  attack: (ip) => `Block the source: sudo ufw deny from ${ip}  (or add “deny ${ip};” in nginx). Consider fail2ban + a WAF (Cloudflare) for this route.`,
  recon: (ip) => `Someone is mapping your server. Block ${ip} if it repeats, make sure sensitive files (.env, .git, backups) are not publicly served.`,
  BRUTE_FORCE: (ip) => `Rate-limit the login route, enable CAPTCHA/2FA, block ${ip}: sudo ufw deny from ${ip}`,
  SSH_BRUTE_FORCE: (ip) => `Disable SSH password login (PasswordAuthentication no), use keys only, install fail2ban, block ${ip}.`,
  FLOOD: (ip) => `Rate-limit per IP (nginx limit_req) and block ${ip}. Put the site behind Cloudflare if it continues.`,
  DDOS: () => `Enable DDoS protection (Cloudflare “Under Attack” mode), add nginx limit_req/limit_conn, scale up instances.`,
  ransomware: () => `ISOLATE NOW: disconnect the server from the network, stop the offending process (check top processes), do NOT pay, restore from offline backups.`,
  ROOT_LOGIN: (ip) => `Confirm this login was you. If not, rotate keys/passwords immediately and disable root SSH (PermitRootLogin no).`,
  DASHBOARD_LOGIN: (ip) => `Someone is guessing your Sentinel password. Use a long password and block ${ip}.`,
};

function suggestion(type, ip) {
  const meta = TYPES[type];
  const f = SUGGEST[type] || SUGGEST[meta.cat] || SUGGEST.attack;
  return f(ip || 'the source IP');
}

// ---------- aggregation ----------
const recentIdx = new Map(); // aggKey -> threat
function record({ serverId, type, severity, ip = '', route = '', method = '', status, ua = '', sample = '', desc = '', count = 1, path: filePath }) {
  const meta = TYPES[type];
  const now = Date.now();
  // one incident per attacker per attack type (routes hit are collected on the incident)
  const aggKey = `${serverId}|${type}|${ip || route}`;
  let th = recentIdx.get(aggKey);
  const sev = severity || meta.sev;

  if (th && now - th.lastT < 15 * 60_000) {
    th.count += count;
    th.lastT = now;
    if (sample) th.sample = sample.slice(0, 300);
    if (desc) th.desc = desc;
    if (route && route !== '*') { th.route = route; th.method = method || th.method; th.status = status ?? th.status; }
    if (route && route !== '*' && th.routes.length < 15 && !th.routes.includes(route)) th.routes.push(route);
    if (filePath && th.paths.length < 20 && !th.paths.includes(filePath)) th.paths.push(filePath);
    if (rank(sev) > rank(th.severity)) th.severity = sev;
    if (th.count >= 50 && th.severity === 'warning') th.severity = 'high';
  } else {
    th = {
      id: uid('th_'), t: now, lastT: now, serverId, type, label: meta.label, category: meta.cat, severity: sev,
      ip, route, method, status, ua: ua.slice(0, 200), sample: sample.slice(0, 300), desc, count,
      routes: route && route !== '*' ? [route] : [], paths: filePath ? [filePath] : [], action: suggestion(type, ip),
    };
    pushBounded(state.threats, th, LIMITS.threats);
    recentIdx.set(aggKey, th);
    if (recentIdx.size > 5000) for (const [k, v] of recentIdx) if (now - v.lastT > 15 * 60_000) recentIdx.delete(k);
  }

  if (ip) {
    const s = (state.ipStats[ip] = state.ipStats[ip] || { req: 0, threats: 0, types: {}, first: now, last: now });
    s.threats += count; s.last = now; s.types[type] = (s.types[type] || 0) + count;
  }

  bus.emit('threat', th);

  // Alert for meaningful threats (single XSS/recon probes are logged but don't page you)
  const sevNow = th.severity;
  if (rank(sevNow) >= 2 || (meta.cat !== 'recon' && th.count >= 5)) {
    const server = state.servers[serverId];
    const where = th.routes.length ? ` on ${th.routes.slice(0, 3).join(', ')}${th.routes.length > 3 ? ` +${th.routes.length - 3} more` : ''}` : '';
    alerts.raise({
      key: `threat:${aggKey}`,
      severity: sevNow,
      category: meta.cat === 'ransomware' ? 'ransomware' : 'security',
      title: `${meta.label} on ${server ? server.name : serverId}`,
      message: meta.cat === 'ransomware'
        ? `${th.desc || meta.label}. ${th.paths.length ? 'Path: ' + th.paths[th.paths.length - 1] : ''}`.trim()
        : `${th.count} malicious event${th.count > 1 ? 's' : ''} from ${ip || 'multiple sources'}${where}${th.desc ? ' (' + th.desc + ')' : ''}.`,
      action: th.action,
      details: { Type: meta.label, 'Source IP': ip || undefined, [meta.cat === 'ransomware' ? 'Folder' : 'Routes']: th.routes.join(', ') || undefined, Count: th.count, Sample: th.sample || undefined, Files: th.paths.slice(-5).join(', ') || undefined, Server: server ? server.name : serverId },
      serverId,
      link: '/#/security',
    });
  }
  return th;
}

function rank(s) { return { info: 0, warning: 1, high: 2, critical: 3 }[s] ?? 1; }

// ---------- behaviour windows ----------
const win = new Map(); // `${kind}|${ip}` -> timestamps
function hit(kind, ip, windowMs) {
  const k = kind + '|' + ip;
  const now = Date.now();
  let arr = win.get(k);
  if (!arr) { arr = []; win.set(k, arr); }
  arr.push(now);
  while (arr.length && now - arr[0] > windowMs) arr.shift();
  return arr.length;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of win) if (!arr.length || now - arr[arr.length - 1] > 10 * 60_000) win.delete(k);
}, 60_000).unref();

// ---------- traffic minute buckets ----------
const cur = {}; // serverId -> {t, req, s2,s3,s4,s5, ips:Set, routes:{}}
let baseline = {}; // serverId -> EMA of req/min

function bucket(serverId, t) {
  const minute = Math.floor(t / 60000) * 60000;
  let b = cur[serverId];
  if (!b || b.t !== minute) {
    if (b) flushBucket(serverId, b);
    b = cur[serverId] = { t: minute, req: 0, s2: 0, s3: 0, s4: 0, s5: 0, ips: new Set(), routes: {} };
  }
  return b;
}

function flushBucket(serverId, b) {
  const arr = (state.traffic[serverId] = state.traffic[serverId] || []);
  pushBounded(arr, { t: b.t, req: b.req, s2: b.s2, s3: b.s3, s4: b.s4, s5: b.s5, ips: b.ips.size }, LIMITS.traffic);
  bus.emit('traffic', { serverId, ...arr[arr.length - 1] });

  // Global spike detection (DDoS)
  const base = baseline[serverId];
  if (base !== undefined && b.req > Math.max(1500, base * 6)) {
    record({ serverId, type: 'DDOS', ip: '', route: '', desc: `${b.req} req/min vs normal ~${Math.round(base)} from ${b.ips.size} IPs` });
  }
  baseline[serverId] = base === undefined ? b.req : base * 0.9 + Math.min(b.req, (base || 1) * 3) * 0.1;

  // 5xx error spike → route health issue
  if (b.req >= 20 && b.s5 / b.req >= 0.1) {
    const worst = Object.entries(b.routes).sort((x, y) => y[1] - x[1])[0];
    const server = state.servers[serverId];
    alerts.raise({
      key: `errspike:${serverId}`,
      severity: b.s5 / b.req >= 0.3 ? 'critical' : 'high',
      category: 'health',
      title: `Server errors spiking on ${server ? server.name : serverId}`,
      message: `${b.s5} of ${b.req} requests (${Math.round((b.s5 / b.req) * 100)}%) returned 5xx in the last minute${worst ? `. Worst route: ${worst[0]} (${worst[1]} errors)` : ''}.`,
      action: 'Check application logs for the worst route, recent deploys, database/upstream availability.',
      details: { 'Error rate': `${Math.round((b.s5 / b.req) * 100)}%`, 'Worst route': worst ? worst[0] : '', Requests: b.req },
      serverId,
      link: '/#/security',
    });
  } else if (b.req >= 20 && alerts.isOpen(`errspike:${serverId}`)) {
    alerts.resolve(`errspike:${serverId}`, 'Error rate is back under 10%.');
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [id, b] of Object.entries(cur)) if (now - b.t >= 60_000) { flushBucket(id, b); delete cur[id]; }
}, 5_000).unref();

function routeKey(p) {
  const clean = (p || '/').split('?')[0];
  return clean.replace(/\/\d+(?=\/|$)/g, '/:id').replace(/\/[0-9a-f]{16,}(?=\/|$)/gi, '/:hash').slice(0, 120);
}

function safeDecode(s) {
  let out = s;
  for (let i = 0; i < 2; i++) { try { const d = decodeURIComponent(out.replace(/\+/g, ' ')); if (d === out) break; out = d; } catch { break; } }
  return out;
}

// ---------- public: process a single HTTP request ----------
function processRequest(serverId, r) {
  if (!r || !r.ip) return;
  const s = state.settings;
  const t = r.t || Date.now();
  const b = bucket(serverId, Date.now());
  b.req++;
  const cls = Math.floor((r.status || 0) / 100);
  if (cls >= 2 && cls <= 5) b['s' + cls]++;
  b.ips.add(r.ip);
  const rk = routeKey(r.path);
  if (cls === 5) b.routes[`${r.method} ${rk}`] = (b.routes[`${r.method} ${rk}`] || 0) + 1;

  const ipS = (state.ipStats[r.ip] = state.ipStats[r.ip] || { req: 0, threats: 0, types: {}, first: t, last: t });
  ipS.req++; ipS.last = t;
  if (Object.keys(state.ipStats).length > 8000) pruneIps();

  const decoded = safeDecode(r.path || '');
  const base = { serverId, ip: r.ip, route: rk, method: r.method, status: r.status, ua: r.ua || '', sample: `${r.method} ${decoded}` };

  const scannerUa = r.ua && SCANNER_UA.test(r.ua) ? r.ua.match(SCANNER_UA)[1] : null;
  let matched = false;
  for (const [type, re] of SIGS) {
    const target = type === 'SENSITIVE_PROBE' ? decoded.split('?')[0] : decoded;
    if (re.test(target) || (type === 'LOG4SHELL' && re.test(r.ua || ''))) {
      record({ ...base, type, desc: scannerUa ? `using ${scannerUa}` : '' });
      matched = true;
      break;
    }
  }
  if (!matched && scannerUa) record({ ...base, type: 'SCANNER', desc: `tool: ${scannerUa}` });

  if ((r.status === 401 || r.status === 403) && AUTH_ROUTE.test(r.path || '')) {
    const n = hit('auth', r.ip, 5 * 60_000);
    if (n >= s.bruteForceThreshold) record({ ...base, type: 'BRUTE_FORCE', severity: n >= s.bruteForceThreshold * 3 ? 'critical' : 'high', desc: `${n} failed logins in 5 min`, count: 1 });
  }
  if (r.status === 404) {
    const n = hit('404', r.ip, 5 * 60_000);
    if (n >= s.scanThreshold && n % 10 === 0) record({ ...base, route: '*', type: 'SCANNING', desc: `${n} not-found requests in 5 min`, count: 10 });
  }
  const rate = hit('rate', r.ip, 60_000);
  if (rate >= s.floodThreshold && rate % 100 === 0) record({ ...base, route: '*', type: 'FLOOD', desc: `${rate} requests in 1 min from one IP`, count: 100 });
}

function pruneIps() {
  const entries = Object.entries(state.ipStats).sort((a, b) => b[1].threats - a[1].threats || b[1].last - a[1].last);
  state.ipStats = Object.fromEntries(entries.slice(0, 4000));
}

// ---------- public: SSH auth events ----------
function processAuth(serverId, ev) {
  if (!ev) return;
  if (ev.kind === 'fail') {
    const n = hit('ssh', ev.ip, 5 * 60_000);
    if (n >= 5) record({ serverId, type: 'SSH_BRUTE_FORCE', ip: ev.ip, route: 'sshd', sample: `user=${ev.user}`, desc: `${n} failed SSH logins in 5 min`, severity: n >= 30 ? 'critical' : 'high' });
  } else if (ev.kind === 'accept' && ev.user === 'root') {
    record({ serverId, type: 'ROOT_LOGIN', ip: ev.ip, route: 'sshd', sample: `${ev.method} for root` });
  }
}

// ---------- public: ransomware events ----------
function processFileEvent(serverId, ev) {
  record({ serverId, type: ev.type, severity: ev.severity, desc: ev.desc, path: ev.path, route: ev.dir || '', count: ev.count || 1, sample: ev.path || '' });
}

function stats({ hours = 24 } = {}) {
  const since = Date.now() - hours * 3600_000;
  const list = state.threats.filter((t) => t.lastT >= since);
  const byType = {}, byCat = {}, bySev = {};
  for (const t of list) {
    byType[t.type] = (byType[t.type] || 0) + t.count;
    byCat[t.category] = (byCat[t.category] || 0) + t.count;
    bySev[t.severity] = (bySev[t.severity] || 0) + 1;
  }
  const topIPs = Object.entries(state.ipStats)
    .filter(([, s]) => s.threats > 0 && s.last >= since)
    .sort((a, b) => b[1].threats - a[1].threats)
    .slice(0, 12)
    .map(([ip, s]) => ({ ip, ...s, mainType: Object.entries(s.types).sort((a, b) => b[1] - a[1])[0]?.[0] }));
  const topRoutes = {};
  for (const t of list) if (t.category !== 'ransomware') for (const r of (t.routes && t.routes.length ? t.routes : t.route && t.route !== '*' ? [t.route] : [])) topRoutes[r] = (topRoutes[r] || 0) + Math.max(1, Math.round(t.count / Math.max(1, (t.routes || []).length)));
  // threats per 30-min bucket for timeline
  const step = 30 * 60_000;
  const start = Math.floor(since / step) * step;
  const timeline = [];
  for (let x = start; x <= Date.now(); x += step) timeline.push({ t: x, attack: 0, recon: 0, ransomware: 0 });
  for (const t of list) {
    const i = Math.floor((t.t - start) / step);
    if (timeline[i] && timeline[i][t.category] !== undefined) timeline[i][t.category] += t.count;
    else if (timeline[i]) timeline[i].attack += t.count;
  }
  return {
    total: list.reduce((a, t) => a + t.count, 0), incidents: list.length, byType, byCat, bySev, topIPs,
    topRoutes: Object.entries(topRoutes).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([route, count]) => ({ route, count })),
    timeline, types: TYPES,
  };
}

module.exports = { processRequest, processAuth, processFileEvent, record, stats, suggestion, TYPES };
