// In-memory state with periodic JSON persistence. Everything is bounded so the file stays small.
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const config = require('./config');

const FILE = path.join(config.DATA_DIR, 'state.json');

const LIMITS = {
  checksPerRoute: 600,   // ~10h at 60s interval
  rawSamples: 720,       // 1h at 5s
  minuteSamples: 1440,   // 24h
  traffic: 1440,         // 24h of per-minute traffic
  threats: 3000,
  alerts: 1000,
  reports: 336,          // 14 days of hourly reports
  hourly: 168,           // 7 days of hourly resource buckets
};

const DEFAULT_SETTINGS = {
  cpuWarn: 80, cpuCrit: 95,
  memWarn: 85, memCrit: 95,
  diskWarn: 80, diskCrit: 92,
  failuresBeforeAlert: 2,
  alertCooldownMin: 15,
  emailMinSeverity: 'high',      // info | warning | high | critical
  pushMinSeverity: 'warning',
  hourlyEmail: true,
  hourlyPush: true,
  emailTo: [],                   // overrides ALERT_EMAIL_TO when non-empty
  bruteForceThreshold: 10,       // failed logins / IP / 5 min
  scanThreshold: 40,             // 404s / IP / 5 min
  floodThreshold: 600,           // requests / IP / minute
  massFileChangeThreshold: 100,  // file changes / 30 s in protected folders
  autoBlockHint: true,
};

const bus = new EventEmitter();
bus.setMaxListeners(200);

const state = {
  routes: [],
  routeState: {},
  checks: {},
  servers: {},
  traffic: {},        // serverId -> [{t, req, s2, s3, s4, s5, ips}]
  threats: [],
  alerts: [],
  reports: [],
  ipStats: {},        // ip -> {req, threats, types:{}, first, last, blocked}
  pushSubs: [],
  settings: { ...DEFAULT_SETTINGS },
  hour: null,         // current hour accumulator (reports.js)
  meta: { startedAt: Date.now() },
};

function pushBounded(arr, item, max) {
  arr.push(item);
  if (arr.length > max) arr.splice(0, arr.length - max);
}

function load() {
  try {
    if (!fs.existsSync(FILE)) return;
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const k of Object.keys(state)) if (saved[k] !== undefined) state[k] = saved[k];
    state.settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}) };
    if (!config.DEMO) removeStaleDemoData();
    // raw samples are not persisted; reset live fields
    for (const s of Object.values(state.servers)) { s.series = []; s.online = s.id === config.SERVER_ID; }
    state.meta.startedAt = Date.now();
  } catch (e) {
    console.error('[store] could not load state:', e.message);
  }
}

function removeStaleDemoData() {
  const demoRouteIds = new Set(state.routes
    .filter((r) => r.url?.includes('/demo-api/') ||
      (r.type === 'tcp' && r.host === '127.0.0.1' && r.port === 6399) ||
      (r.name === 'Hub port' && r.host === '127.0.0.1'))
    .map((r) => r.id));
  const demoServerIds = Object.values(state.servers)
    .filter((s) => (s.id === 'payments-api' && s.name === 'payments-api-01') || (s.id === 'db-replica' && s.name === 'db-replica-02'))
    .map((s) => s.id);
  if (!demoRouteIds.size && !demoServerIds.length) return;

  state.routes = state.routes.filter((r) => !demoRouteIds.has(r.id));
  for (const id of demoRouteIds) {
    delete state.routeState[id];
    delete state.checks[id];
  }
  for (const id of demoServerIds) delete state.servers[id];
  const local = state.servers[config.SERVER_ID];
  if (local) {
    local.latest = null;
    local.series = [];
    local.minutes = [];
    local.hours = [];
    local.firstSeen = Date.now();
    local.lastSeen = 0;
    local.online = true;
  }

  // Old demo records have no provenance, so reset mixed-in traffic and event history.
  state.traffic = {};
  state.threats = [];
  state.alerts = [];
  state.reports = [];
  state.ipStats = {};
  state.hour = null;
  console.warn('[store] Removed stale demo data; real monitoring history will build from live sources.');
}

let saving = false;
function save() {
  if (saving) return;
  saving = true;
  try {
    const servers = {};
    for (const [id, s] of Object.entries(state.servers)) servers[id] = { ...s, series: [] };
    const ipStats = Object.fromEntries(
      Object.entries(state.ipStats).sort((a, b) => b[1].threats - a[1].threats || b[1].req - a[1].req).slice(0, 300)
    );
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ ...state, servers, ipStats }));
    fs.renameSync(tmp, FILE);
  } catch (e) {
    console.error('[store] save failed:', e.message);
  } finally {
    saving = false;
  }
}

function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

module.exports = { state, bus, load, save, pushBounded, uid, LIMITS, DEFAULT_SETTINGS };
