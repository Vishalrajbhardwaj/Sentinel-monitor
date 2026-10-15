// Automatic hourly report: route uptime/latency/issues, attacks, resource occupancy → stored, emailed, pushed.
const { state, bus, pushBounded, uid, LIMITS } = require('./store');
const notify = require('./notify');
const { capacity } = require('./metrics');
const { TYPES } = require('./threats');
const { ISSUES } = require('./checker');
const issueLabel = (k) => (ISSUES[k]?.label || k.replace(/_/g, ' ')).toLowerCase();
const config = require('./config');

const HOUR = 3600_000;
const hourStart = (t = Date.now()) => config.hourStart(t);

function freshHour(start = hourStart()) {
  return { start, routes: {}, threats: {}, threatIPs: {}, alerts: { total: 0, critical: 0, high: 0, warning: 0 }, alertIds: [] };
}

function acc() {
  if (!state.hour || !state.hour.start) state.hour = freshHour();
  return state.hour;
}

bus.on('check', ({ routeId, res }) => {
  const h = acc();
  const r = (h.routes[routeId] = h.routes[routeId] || { checks: 0, ok: 0, degraded: 0, fail: 0, msSum: 0, msN: 0, msMax: 0, issues: {} });
  r.checks++;
  if (res.result === 'ok') r.ok++; else if (res.result === 'degraded') r.degraded++; else r.fail++;
  if (res.ms != null) { r.msSum += res.ms; r.msN++; r.msMax = Math.max(r.msMax, res.ms); }
  if (res.issue) r.issues[res.issue] = (r.issues[res.issue] || 0) + 1;
});

const seenThreat = new Map(); // threat id -> count already counted this hour
bus.on('threat', (th) => {
  const h = acc();
  const prev = seenThreat.get(th.id) || 0;
  const delta = th.count - prev;
  seenThreat.set(th.id, th.count);
  if (delta <= 0) return;
  h.threats[th.type] = (h.threats[th.type] || 0) + delta;
  if (th.ip) h.threatIPs[th.ip] = (h.threatIPs[th.ip] || 0) + delta;
});

bus.on('alert', (a) => {
  const h = acc();
  if (a.status !== 'open' || h.alertIds.includes(a.id)) return;
  h.alertIds.push(a.id);
  h.alerts.total++;
  if (h.alerts[a.severity] !== undefined) h.alerts[a.severity]++;
});

function build(h, end = Date.now(), partial = false) {
  const routes = state.routes.map((rt) => {
    const r = h.routes[rt.id] || { checks: 0, ok: 0, degraded: 0, fail: 0, msSum: 0, msN: 0, msMax: 0, issues: {} };
    const uptime = r.checks ? +(((r.ok + r.degraded) / r.checks) * 100).toFixed(2) : null;
    return {
      id: rt.id, name: rt.name, target: rt.type === 'tcp' ? `${rt.host}:${rt.port}` : `${rt.method} ${rt.url}`,
      checks: r.checks, ok: r.ok, degraded: r.degraded, fail: r.fail, uptime,
      avgMs: r.msN ? Math.round(r.msSum / r.msN) : null, maxMs: r.msMax || null,
      issues: Object.entries(r.issues).map(([k, n]) => ({ issue: k, n })).sort((a, b) => b.n - a.n),
      status: state.routeState[rt.id]?.status || 'pending',
    };
  });

  const resources = Object.values(state.servers).map((s) => {
    const pts = (s.minutes || []).filter((m) => m.t >= h.start && m.t < end);
    const live = (s.series || []).filter((m) => m.t >= h.start && m.t < end);
    const src = pts.length ? pts : live.map((x) => ({ cpu: x.cpu, cpuMax: x.cpu, mem: x.mem, memMax: x.mem, disk: x.disk, load: x.load }));
    if (!src.length) return { id: s.id, name: s.name, online: s.online, samples: 0 };
    const avg = (k) => +(src.reduce((a, x) => a + (x[k] || 0), 0) / src.length).toFixed(1);
    const max = (k) => +Math.max(...src.map((x) => x[k] || 0)).toFixed(1);
    const cap = capacity(avg('cpu'), avg('mem'));
    return { id: s.id, name: s.name, online: s.online, samples: src.length, cpuAvg: avg('cpu'), cpuMax: max('cpuMax'), memAvg: avg('mem'), memMax: max('memMax'), disk: max('disk'), loadAvg: avg('load'), ...cap };
  });

  const traffic = {};
  for (const [sid, arr] of Object.entries(state.traffic)) {
    const pts = arr.filter((m) => m.t >= h.start && m.t < end);
    traffic[sid] = pts.reduce((a, m) => ({ req: a.req + m.req, s4: a.s4 + m.s4, s5: a.s5 + m.s5 }), { req: 0, s4: 0, s5: 0 });
  }

  const threatTotal = Object.values(h.threats).reduce((a, b) => a + b, 0);
  const MISMATCH = new Set(['BODY_MISMATCH', 'STATUS_MISMATCH', 'NOT_FOUND', 'AUTH_FAILED', 'RATE_LIMITED', 'SLOW_RESPONSE', 'SSL_EXPIRING']);
  const failing = routes.filter((r) => r.fail > 0);
  // "down for the hour": at least half the checks failed with an outage-type issue (timeout, refused, 5xx…)
  const down = routes.filter((r) => r.checks && r.fail / r.checks >= 0.5 && r.issues[0] && !MISMATCH.has(r.issues[0].issue));
  const ransomware = Object.keys(h.threats).some((k) => TYPES[k]?.cat === 'ransomware');
  const overloaded = resources.filter((r) => (r.cpuAvg || 0) >= 85 || (r.memAvg || 0) >= state.settings.memCrit || (r.disk || 0) >= state.settings.diskCrit);
  const offline = resources.filter((r) => r.online === false);

  let status = 'healthy';
  if (failing.length || threatTotal || h.alerts.high || resources.some((r) => r.verdict === 'Busy' || r.verdict === 'Overloaded')) status = 'issues';
  if (down.length || ransomware || h.alerts.critical || overloaded.length || offline.length) status = 'critical';

  const checked = routes.filter((r) => r.checks);
  const uptime = checked.length ? +(checked.reduce((a, r) => a + r.uptime, 0) / checked.length).toFixed(2) : null;

  const lines = [];
  lines.push(checked.length ? `${checked.length - failing.length}/${checked.length} routes fully healthy, average uptime ${uptime}%.` : 'No route checks ran this hour.');
  if (failing.length) lines.push(`Problems on: ${failing.map((r) => `${r.name} (${r.fail} failed${r.issues[0] ? ', ' + issueLabel(r.issues[0].issue) : ''})`).join('; ')}.`);
  lines.push(threatTotal ? `${threatTotal} malicious events detected — mostly ${Object.entries(h.threats).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => TYPES[k]?.label || k).join(' and ')}.` : 'No attacks detected.');
  for (const r of resources.filter((x) => x.samples)) lines.push(`${r.name}: ${r.verdict} — CPU avg ${r.cpuAvg}% (peak ${r.cpuMax}%), memory ${r.memAvg}%, disk ${r.disk}%, ${r.free}% capacity free.`);

  return {
    id: uid('rp_'), hourStart: h.start, hourEnd: end, generatedAt: Date.now(), partial, status, uptime,
    summary: lines.join(' '), lines, routes, resources, traffic,
    threats: {
      total: threatTotal,
      byType: Object.entries(h.threats).map(([type, n]) => ({ type, label: TYPES[type]?.label || type, category: TYPES[type]?.cat, n })).sort((a, b) => b.n - a.n),
      topIPs: Object.entries(h.threatIPs).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([ip, n]) => ({ ip, n })),
    },
    alerts: h.alerts,
  };
}

function fmtHour(t) {
  return new Date(t).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short', hour12: true });
}

function reportEmail(rep) {
  const { esc } = notify;
  const color = { healthy: '#16a34a', issues: '#d97706', critical: '#dc2626' }[rep.status];
  const badge = (txt, c) => `<span style="display:inline-block;background:${c};color:#fff;font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;text-transform:uppercase;letter-spacing:.05em">${esc(txt)}</span>`;
  const routeRows = rep.routes.map((r) => {
    const c = r.fail ? '#dc2626' : r.degraded ? '#d97706' : '#16a34a';
    return `<tr style="border-top:1px solid #e2e8f0"><td style="padding:8px 10px;font-size:13px"><b>${esc(r.name)}</b><div style="color:#64748b;font-size:11px;font-family:ui-monospace,Menlo,monospace">${esc(r.target)}</div></td>
      <td style="padding:8px 10px;font-size:13px;color:${c};font-weight:700;text-align:right">${r.uptime ?? '—'}%</td>
      <td style="padding:8px 10px;font-size:13px;text-align:right">${r.avgMs ?? '—'} ms</td>
      <td style="padding:8px 10px;font-size:12px;color:#64748b">${r.issues.map((i) => `${esc(issueLabel(i.issue))} ×${i.n}`).join(', ') || 'none'}</td></tr>`;
  }).join('');
  const resRows = rep.resources.filter((r) => r.samples).map((r) => `<tr style="border-top:1px solid #e2e8f0"><td style="padding:8px 10px;font-size:13px"><b>${esc(r.name)}</b></td>
      <td style="padding:8px 10px;font-size:13px;text-align:right">${r.cpuAvg}% <span style="color:#94a3b8">/ ${r.cpuMax}%</span></td>
      <td style="padding:8px 10px;font-size:13px;text-align:right">${r.memAvg}%</td>
      <td style="padding:8px 10px;font-size:13px;text-align:right">${r.disk}%</td>
      <td style="padding:8px 10px;font-size:13px;text-align:right"><b>${esc(r.verdict)}</b> · ${r.free}% free</td></tr>`).join('');
  const thRows = rep.threats.byType.map((t) => `<tr style="border-top:1px solid #e2e8f0"><td style="padding:6px 10px;font-size:13px">${esc(t.label)}</td><td style="padding:6px 10px;font-size:13px;text-align:right;font-weight:700">${t.n}</td></tr>`).join('');
  const th = (cols) => `<tr>${cols.map((c, i) => `<th style="padding:8px 10px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;text-align:${i ? 'right' : 'left'}">${c}</th>`).join('')}</tr>`;

  const html = notify.emailShell(
    `Hourly report · ${fmtHour(rep.hourStart)} – ${fmtHour(rep.hourEnd).split(', ').pop()}`,
    color,
    `${badge(rep.status, color)}
     <p style="font-size:14px;line-height:1.6;margin:14px 0">${rep.lines.map(esc).join('<br>')}</p>
     <h3 style="font-size:14px;margin:20px 0 6px">Routes</h3>
     <table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:10px">${th(['Route', 'Uptime', 'Avg', 'Issues'])}${routeRows || '<tr><td style="padding:10px;font-size:13px">No routes configured</td></tr>'}</table>
     <h3 style="font-size:14px;margin:20px 0 6px">Server capacity</h3>
     <table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:10px">${th(['Server', 'CPU avg/peak', 'Memory', 'Disk', 'Status'])}${resRows || '<tr><td style="padding:10px;font-size:13px">No samples</td></tr>'}</table>
     <h3 style="font-size:14px;margin:20px 0 6px">Security (${rep.threats.total} events)</h3>
     ${thRows ? `<table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:10px">${thRows}</table>` : '<p style="font-size:13px;color:#16a34a;margin:0">No attacks detected this hour.</p>'}
     ${rep.threats.topIPs.length ? `<p style="font-size:12px;color:#64748b;margin-top:8px">Top sources: ${rep.threats.topIPs.map((x) => `${esc(x.ip)} (${x.n})`).join(', ')}</p>` : ''}`
  );
  return { subject: `${rep.status === 'healthy' ? '✅' : rep.status === 'issues' ? '⚠️' : '🚨'} Sentinel hourly: ${rep.status.toUpperCase()} — ${config.SERVER_NAME} ${fmtHour(rep.hourStart)}`, html, text: rep.lines.join('\n') };
}

async function finalize(h) {
  const rep = build(h, h.start + HOUR, false);
  pushBounded(state.reports, rep, LIMITS.reports);
  bus.emit('report', rep);
  const s = state.settings;
  if (s.hourlyEmail) notify.sendEmail(reportEmail(rep)).catch(() => {});
  if (s.hourlyPush) {
    const icon = { healthy: '✅', issues: '⚠️', critical: '🚨' }[rep.status];
    notify.sendPush({ title: `${icon} Hourly report: ${rep.status}`, body: rep.lines.slice(0, 3).join(' '), tag: 'hourly-report', url: `/#/reports/${rep.id}`, severity: rep.status === 'critical' ? 'critical' : 'info' }).catch(() => {});
  }
  return rep;
}

function start() {
  acc();
  setInterval(() => {
    const h = acc();
    const now = hourStart();
    if (h.start < now) {
      state.hour = freshHour(now);
      seenThreat.clear();
      // threats that keep aggregating across the hour boundary only count their new hits
      for (const t of state.threats.slice(-500)) if (Date.now() - t.lastT < 15 * 60_000) seenThreat.set(t.id, t.count);
      finalize(h).catch((e) => console.error('[reports]', e));
    }
  }, 15_000).unref();
}

function now() {
  return build(acc(), Date.now(), true);
}

module.exports = { start, now, build, reportEmail, finalize };
