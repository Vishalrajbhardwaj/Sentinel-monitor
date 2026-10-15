// Follows log files (survives rotation/truncation) and parses access + auth log lines.
const fs = require('fs');

function tailFile(file, onLine, { fromStart = false, intervalMs = 1000 } = {}) {
  let pos = 0;
  let buf = '';
  let ino = null;
  try {
    const st = fs.statSync(file);
    pos = fromStart ? 0 : st.size;
    ino = st.ino;
  } catch {}

  function readNew() {
    let st;
    try { st = fs.statSync(file); } catch { return; }
    if (st.ino !== ino || st.size < pos) { pos = 0; ino = st.ino; buf = ''; } // rotated or truncated
    if (st.size === pos) return;
    const len = Math.min(st.size - pos, 8 * 1024 * 1024); // cap a single read
    const fd = fs.openSync(file, 'r');
    try {
      const chunk = Buffer.alloc(len);
      fs.readSync(fd, chunk, 0, len, pos);
      pos += len;
      buf += chunk.toString('utf8');
    } finally { fs.closeSync(fd); }
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const l of lines) if (l.trim()) { try { onLine(l); } catch (e) { /* ignore bad line */ } }
  }

  const timer = setInterval(readNew, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
// nginx / apache combined: 1.2.3.4 - - [10/Oct/2026:13:55:36 +0530] "GET /x HTTP/1.1" 200 2326 "ref" "ua" [rt]
const COMBINED = /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+)(?: (.*?))?(?: HTTP\/[\d.]+)?" (\d{3}) (\S+)(?: "([^"]*)" "([^"]*)")?(?:\s+([\d.]+))?/;

function parseClfDate(s) {
  const m = s.match(/(\d+)\/(\w+)\/(\d+):(\d+):(\d+):(\d+) ([+-]\d{4})/);
  if (!m) return Date.now();
  const off = (m[7][0] === '-' ? -1 : 1) * (+m[7].slice(1, 3) * 60 + +m[7].slice(3)) * 60000;
  return Date.UTC(+m[3], MONTHS[m[2]] ?? 0, +m[1], +m[4], +m[5], +m[6]) - off;
}

function parseAccessLine(line) {
  line = line.trim();
  if (line.startsWith('{')) {
    const j = JSON.parse(line);
    const url = j.path || j.uri || j.request_uri || j.url || '/';
    return {
      ip: j.ip || j.remote_addr || j.client_ip || j.remoteAddress || '-',
      method: (j.method || j.request_method || 'GET').toUpperCase(),
      path: url,
      status: +(j.status || j.statusCode || 0),
      ua: j.ua || j.user_agent || j.http_user_agent || '',
      ms: j.ms ?? (j.request_time ? +j.request_time * 1000 : undefined),
      t: j.time ? Date.parse(j.time) || Date.now() : Date.now(),
    };
  }
  const m = line.match(COMBINED);
  if (!m) return null;
  return {
    ip: m[1], t: parseClfDate(m[2]), method: m[3].toUpperCase(), path: m[4] || '/',
    status: +m[5], ua: m[8] || '', ms: m[9] ? +m[9] * 1000 : undefined,
  };
}

// sshd lines from /var/log/auth.log or /var/log/secure (or journald export)
function parseAuthLine(line) {
  let m = line.match(/(Failed password|Invalid user|authentication failure|Failed publickey).*?(?:for (?:invalid user )?(\S+) )?from (\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]+)/i);
  if (m) return { kind: 'fail', user: m[2] || '?', ip: m[3], t: Date.now() };
  m = line.match(/Accepted (\S+) for (\S+) from (\S+)/);
  if (m) return { kind: 'accept', method: m[1], user: m[2], ip: m[3], t: Date.now() };
  return null;
}

module.exports = { tailFile, parseAccessLine, parseAuthLine };
