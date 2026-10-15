// Server registry + resource metrics: live series, minute/hour aggregates, capacity verdicts, threshold alerts.
const { state, bus, pushBounded, LIMITS } = require('./store');
const alerts = require('./alerts');
const config = require('./config');

function capacity(cpu, mem) {
  const occ = Math.max(cpu || 0, mem || 0);
  let verdict = 'Free';
  if (occ >= 85) verdict = 'Overloaded';
  else if (occ >= 70) verdict = 'Busy';
  else if (occ >= 40) verdict = 'Moderate';
  return { occupied: Math.round(occ), free: Math.max(0, 100 - Math.round(occ)), verdict };
}

function ensureServer(id, name, info) {
  let s = state.servers[id];
  if (!s) {
    s = state.servers[id] = { id, name: name || id, info: info || {}, firstSeen: Date.now(), lastSeen: 0, online: true, latest: null, series: [], minutes: [], hours: [], local: id === config.SERVER_ID };
  }
  if (name) s.name = name;
  if (info) s.info = info;
  s.series = s.series || [];
  s.minutes = s.minutes || [];
  s.hours = s.hours || [];
  return s;
}

const minuteAcc = {}; // serverId -> {t, n, cpu, cpuMax, mem, memMax, disk, load, rx, tx, conns}
const hourAcc = {};

function accumulate(store, key, t, sample, size) {
  let a = store[key];
  if (a && a.t !== t) { flush(a); a = null; }
  if (!a) a = store[key] = { t, n: 0, cpu: 0, cpuMax: 0, mem: 0, memMax: 0, disk: 0, load: 0, rx: 0, tx: 0, conns: 0, flushTo: null, size };
  a.n++;
  a.cpu += sample.cpu; a.cpuMax = Math.max(a.cpuMax, sample.cpu);
  a.mem += sample.mem.pct; a.memMax = Math.max(a.memMax, sample.mem.pct);
  a.disk = sample.disk;
  a.load += sample.load[0];
  a.rx += sample.rx || 0; a.tx += sample.tx || 0;
  a.conns = Math.max(a.conns, sample.conns || 0);
  return a;
}

function flatten(a) {
  return {
    t: a.t, cpu: +(a.cpu / a.n).toFixed(1), cpuMax: +a.cpuMax.toFixed(1), mem: +(a.mem / a.n).toFixed(1), memMax: +a.memMax.toFixed(1),
    disk: a.disk, load: +(a.load / a.n).toFixed(2), rx: Math.round(a.rx / a.n), tx: Math.round(a.tx / a.n), conns: a.conns,
  };
}

function flush(a) {
  if (a.flushTo) pushBounded(a.flushTo, flatten(a), a.size);
}

function processSample(serverId, sample, { name, info } = {}) {
  const s = ensureServer(serverId, name, info);
  const wasOffline = !s.online;
  s.lastSeen = Date.now();
  s.online = true;
  s.latest = sample;
  pushBounded(s.series, { t: sample.t, cpu: sample.cpu, mem: sample.mem.pct, disk: sample.disk, load: sample.load[0], rx: sample.rx, tx: sample.tx, conns: sample.conns }, LIMITS.rawSamples);

  const m = accumulate(minuteAcc, serverId, Math.floor(sample.t / 60000) * 60000, sample, LIMITS.minuteSamples);
  m.flushTo = s.minutes;
  const h = accumulate(hourAcc, serverId, config.hourStart(sample.t), sample, LIMITS.hourly);
  h.flushTo = s.hours;

  if (wasOffline && alerts.isOpen(`offline:${serverId}`)) alerts.resolve(`offline:${serverId}`, `${s.name} is reporting again.`);
  evaluate(s);
  bus.emit('metrics', { serverId, name: s.name, sample, capacity: capacity(sample.cpu, sample.mem.pct) });
}

// Sustained-threshold evaluation over the last ~30s of samples
function evaluate(s) {
  const st = state.settings;
  const recent = s.series.slice(-6);
  if (recent.length < 3) return;
  const avg = (k) => recent.reduce((a, x) => a + (x[k] || 0), 0) / recent.length;
  const top = (s.latest.top || []).slice(0, 3).map((p) => `${p.name} ${p.cpu}% CPU / ${p.mem}% MEM`).join(', ');

  const checks = [
    { k: 'cpu', label: 'CPU', v: avg('cpu'), warn: st.cpuWarn, crit: st.cpuCrit, action: `Find the busy process (top: ${top || 'n/a'}). Scale up or optimise, check for crypto-miners if unexpected.` },
    { k: 'mem', label: 'Memory', v: avg('mem'), warn: st.memWarn, crit: st.memCrit, action: `Check for memory leaks / restart the heavy service (top: ${top || 'n/a'}). Add swap or RAM.` },
    { k: 'disk', label: 'Disk', v: s.latest.disk, warn: st.diskWarn, crit: st.diskCrit, action: 'Clear old logs (journalctl --vacuum-time=7d), rotate logs, delete old backups/docker images (docker system prune), or grow the volume.' },
  ];
  for (const c of checks) {
    const key = `res:${c.k}:${s.id}`;
    if (c.v >= c.warn) {
      alerts.raise({
        key, severity: c.v >= c.crit ? 'critical' : 'warning', category: 'resources',
        title: `${c.label} ${c.v >= c.crit ? 'critical' : 'high'} on ${s.name}`,
        message: `${c.label} usage is ${c.v.toFixed(0)}% (threshold ${c.warn}%). Server is ${capacity(s.latest.cpu, s.latest.mem.pct).verdict.toLowerCase()}.`,
        action: c.action, details: { Server: s.name, [c.label]: `${c.v.toFixed(1)}%`, 'Load avg': s.latest.load.join(' / '), 'Top processes': top },
        serverId: s.id, link: '/#/resources',
      });
    } else if (c.v < c.warn - 5 && alerts.isOpen(key)) {
      alerts.resolve(key, `${c.label} back to ${c.v.toFixed(0)}%.`);
    }
  }
}

// Offline detection for remote agents
setInterval(() => {
  const now = Date.now();
  for (const s of Object.values(state.servers)) {
    if (s.local) continue;
    if (s.online && now - s.lastSeen > 60_000) {
      s.online = false;
      alerts.raise({
        key: `offline:${s.id}`, severity: 'critical', category: 'health',
        title: `${s.name} is not responding`,
        message: `No heartbeat from the agent for ${Math.round((now - s.lastSeen) / 1000)}s. The server may be down, overloaded or disconnected.`,
        action: 'Check if the machine is up (ping/SSH), check the agent service (systemctl status sentinel-agent), check the network/firewall.',
        details: { Server: s.name, 'Last seen': new Date(s.lastSeen).toISOString() }, serverId: s.id, link: '/#/resources',
      });
      bus.emit('server', { id: s.id, online: false });
    }
  }
}, 15_000).unref();

function summary(s) {
  const l = s.latest;
  return {
    id: s.id, name: s.name, online: s.online, local: !!s.local, lastSeen: s.lastSeen, info: s.info,
    latest: l, capacity: l ? capacity(l.cpu, l.mem.pct) : null,
    spark: s.series.slice(-60).map((x) => ({ t: x.t, cpu: x.cpu, mem: x.mem })),
  };
}

function detail(id) {
  const s = state.servers[id];
  if (!s) return null;
  // hourly occupancy for last 24h (completed hours + current partial)
  const hours = [...s.hours.slice(-23)];
  if (hourAcc[id]) hours.push(flatten(hourAcc[id]));
  return { ...summary(s), series: s.series, minutes: s.minutes, hours: hours.map((h) => ({ ...h, ...capacity(h.cpu, h.mem) })) };
}

module.exports = { processSample, ensureServer, summary, detail, capacity };
