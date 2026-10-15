// System resource sampler — CPU, memory, disk, load, network, connections, top processes.
// Dependency-free; works on Linux and macOS (Windows gets CPU/mem/disk). Shared by hub and agent.
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');

const isLinux = process.platform === 'linux';
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

function run(cmd, args, timeout = 4000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : stdout));
  });
}

function cpuTimes() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) {
    for (const v of Object.values(c.times)) total += v;
    idle += c.times.idle;
  }
  return { idle, total };
}

async function memory() {
  const total = os.totalmem();
  let available = os.freemem();
  if (isLinux) {
    try {
      const m = fs.readFileSync('/proc/meminfo', 'utf8').match(/MemAvailable:\s+(\d+)/);
      if (m) available = +m[1] * 1024;
    } catch {}
  } else if (isMac) {
    const out = await run('vm_stat', []);
    const page = +(out.match(/page size of (\d+)/) || [])[1] || 4096;
    const get = (k) => +((out.match(new RegExp(k + ':\\s+(\\d+)')) || [])[1] || 0);
    const avail = (get('Pages free') + get('Pages inactive') + get('Pages speculative') + get('Pages purgeable')) * page;
    if (avail > 0) available = avail;
  }
  const used = Math.max(0, total - available);
  return { total, used, pct: +((used / total) * 100).toFixed(1) };
}

function disks(paths) {
  const out = [];
  for (const p of paths) {
    try {
      const s = fs.statfsSync(p);
      const total = s.blocks * s.bsize;
      const used = (s.blocks - s.bfree) * s.bsize;
      const avail = s.bavail * s.bsize;
      out.push({ path: p, total, used, free: avail, pct: +((used / (used + avail)) * 100).toFixed(1) });
    } catch {}
  }
  return out;
}

function netBytes() {
  if (!isLinux) return null;
  try {
    let rx = 0, tx = 0;
    for (const line of fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2)) {
      const [name, rest] = line.split(':');
      if (!rest || name.trim() === 'lo') continue;
      const f = rest.trim().split(/\s+/);
      rx += +f[0]; tx += +f[8];
    }
    return { rx, tx };
  } catch { return null; }
}

function tcpEstablished() {
  if (!isLinux) return null;
  let n = 0;
  for (const f of ['/proc/net/tcp', '/proc/net/tcp6']) {
    try {
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      for (let i = 1; i < lines.length; i++) if (lines[i].split(/\s+/)[4] === '01') n++;
    } catch {}
  }
  return n;
}

async function topProcesses(limit = 6) {
  let out = '';
  if (isLinux) out = await run('ps', ['-eo', 'pid,comm,%cpu,%mem', '--sort=-%cpu', '--no-headers']);
  else if (isMac) out = await run('ps', ['-Aro', 'pid,comm,%cpu,%mem']);
  else return [];
  const rows = [];
  for (const line of out.trim().split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.+?)\s+([\d.]+)\s+([\d.]+)$/);
    if (!m) continue;
    rows.push({ pid: +m[1], name: m[2].split('/').pop().slice(0, 40), cpu: +m[3], mem: +m[4] });
  }
  return rows.filter((r) => r.name !== 'ps').slice(0, limit);
}

// Windows: busiest processes via CIM performance counters (PowerShell, no extra install)
const WIN_PS = "$p = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $_.Name -ne '_Total' -and $_.Name -ne 'Idle' }; " +
  "'COUNT,' + $p.Count; $p | Sort-Object PercentProcessorTime -Descending | Select-Object -First 8 | " +
  "ForEach-Object { '' + $_.IDProcess + ',' + $_.Name + ',' + $_.PercentProcessorTime + ',' + $_.WorkingSetPrivate }";
async function windowsProcesses(limit = 6) {
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_PS], 15000);
  if (!out) return { top: [], count: null };
  const cores = os.cpus().length || 1;
  const total = os.totalmem();
  let count = null;
  const top = [];
  for (const line of out.trim().split(/\r?\n/)) {
    const f = line.trim().split(',');
    if (f[0] === 'COUNT') { count = +f[1] || null; continue; }
    if (f.length < 4 || !/^\d+$/.test(f[0])) continue;
    top.push({ pid: +f[0], name: f[1].replace(/#\d+$/, '').slice(0, 40), cpu: +((+f[2] || 0) / cores).toFixed(1), mem: +(((+f[3] || 0) / total) * 100).toFixed(1) });
  }
  return { top: top.slice(0, limit), count };
}

async function processCount() {
  if (isLinux) {
    try { return fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).length; } catch {}
  }
  if (isWin) return null;
  const out = await run('ps', ['-A', '-o', 'pid=']);
  return out ? out.trim().split('\n').length : null;
}

function createSampler({ diskPaths = ['/'] } = {}) {
  let prevCpu = cpuTimes();
  let prevNet = netBytes();
  let prevT = Date.now();
  let procs = [];
  let procCount = null;
  let lastProcAt = 0;

  return async function sample() {
    const now = Date.now();
    const cur = cpuTimes();
    const dTotal = cur.total - prevCpu.total;
    const cpu = dTotal > 0 ? +((1 - (cur.idle - prevCpu.idle) / dTotal) * 100).toFixed(1) : 0;
    prevCpu = cur;

    const net = netBytes();
    const dt = Math.max(1, (now - prevT) / 1000);
    let rxRate = null, txRate = null;
    if (net && prevNet) { rxRate = Math.max(0, (net.rx - prevNet.rx) / dt); txRate = Math.max(0, (net.tx - prevNet.tx) / dt); }
    prevNet = net; prevT = now;

    if (now - lastProcAt > (isWin ? 60_000 : 30_000)) {
      lastProcAt = now;
      // refreshed in the background so a slow process listing never delays the sample
      (isWin ? windowsProcesses().then((r) => [r.top, r.count]) : Promise.all([topProcesses(), processCount()]))
        .then(([t, c]) => { procs = t; procCount = c; })
        .catch(() => {});
    }

    const mem = await memory();
    const dsk = disks(diskPaths);
    const load = os.loadavg();
    return {
      t: now,
      cpu: Math.max(0, Math.min(100, cpu)),
      cores: os.cpus().length,
      load: load.map((x) => +x.toFixed(2)),
      mem,
      disks: dsk,
      disk: dsk.length ? Math.max(...dsk.map((d) => d.pct)) : 0,
      rx: rxRate, tx: txRate,
      conns: tcpEstablished(),
      procCount,
      top: procs,
      uptime: os.uptime(),
    };
  };
}

function hostInfo() {
  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpuModel: (os.cpus()[0] || {}).model || '',
    cores: os.cpus().length,
    memTotal: os.totalmem(),
    node: process.version,
  };
}

module.exports = { createSampler, hostInfo };
