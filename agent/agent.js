#!/usr/bin/env node
// Sentinel agent — run on every other server you want watched. No npm install needed (Node 18+).
// Sends resource metrics, parsed access-log requests, SSH auth events and ransomware file events to the hub.
//
//   AGENT_HUB_URL=https://monitor.example.com AGENT_TOKEN=xxxx AGENT_NAME=api-01 \
//   AGENT_LOG_FILES=/var/log/nginx/access.log AGENT_AUTH_LOG=/var/log/auth.log AGENT_WATCH_DIRS=/var/www \
//   node agent/agent.js
const os = require('os');
const path = require('path');
const fs = require('fs');

// optional .env next to the agent
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { createSampler, hostInfo } = require('../server/collectors/system');
const { tailFile, parseAccessLine, parseAuthLine } = require('../server/collectors/logtail');
const { startRansomwareWatch } = require('../server/collectors/fswatch');

const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
const HUB = (process.env.AGENT_HUB_URL || '').replace(/\/$/, '');
const TOKEN = process.env.AGENT_TOKEN || '';
const NAME = process.env.AGENT_NAME || os.hostname();
const ID = (process.env.AGENT_ID || NAME).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
const INTERVAL = Math.max(5, +(process.env.AGENT_INTERVAL || 10)) * 1000;
const LOGS = list(process.env.AGENT_LOG_FILES);
const AUTH = process.env.AGENT_AUTH_LOG || '';
const DIRS = list(process.env.AGENT_WATCH_DIRS);
const DISKS = list(process.env.AGENT_DISK_PATHS).length ? list(process.env.AGENT_DISK_PATHS) : ['/'];

if (!HUB || !TOKEN) {
  console.error('Set AGENT_HUB_URL and AGENT_TOKEN (copy them from Sentinel → Settings → Connect another server).');
  process.exit(1);
}

const sample = createSampler({ diskPaths: DISKS });
const info = hostInfo();
const buf = { requests: [], auth: [], files: [] };
let dropped = 0;
const MAX = 20000;
const push = (k, v) => { if (!v) return; if (buf[k].length >= MAX) { dropped++; return; } buf[k].push(v); };

for (const f of LOGS) { console.log('[agent] following', f); tailFile(f, (l) => push('requests', parseAccessLine(l))); }
if (AUTH) { console.log('[agent] following', AUTH); tailFile(AUTH, (l) => push('auth', parseAuthLine(l))); }
if (DIRS.length) {
  startRansomwareWatch({
    dirs: DIRS,
    getSettings: () => ({ massFileChangeThreshold: +(process.env.AGENT_MASS_CHANGE || 100) }),
    emit: (ev) => { push('files', ev); flush(); }, // ransomware events are sent immediately
  });
}

let sending = false;
let failures = 0;
async function flush(withSample = false) {
  if (sending) return;
  sending = true;
  const body = { serverId: ID, name: NAME, info, requests: buf.requests.splice(0), auth: buf.auth.splice(0), files: buf.files.splice(0) };
  try {
    if (withSample) body.sample = await sample();
    const r = await fetch(HUB + '/api/agent/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Token': TOKEN },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status + (r.status === 401 ? ' (wrong AGENT_TOKEN)' : ''));
    if (failures) console.log('[agent] connection to hub restored');
    failures = 0;
    if (dropped) { console.warn(`[agent] dropped ${dropped} log lines while hub was unreachable`); dropped = 0; }
  } catch (e) {
    failures++;
    // put events back so nothing is lost on a short outage
    buf.requests.unshift(...body.requests.slice(-MAX / 2));
    buf.auth.unshift(...body.auth);
    buf.files.unshift(...body.files);
    if (failures === 1 || failures % 30 === 0) console.error('[agent] cannot reach hub:', e.message);
  } finally {
    sending = false;
  }
}

setInterval(() => flush(true), INTERVAL);
setTimeout(() => flush(true), 1500);
console.log(`[agent] ${NAME} (${ID}) → ${HUB} every ${INTERVAL / 1000}s`);
