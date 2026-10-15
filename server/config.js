// Loads configuration from .env (no external dependency) + process.env
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
// Command-line flags work the same on Windows, macOS and Linux:
//   node server/index.js --demo --port=9000   (same as DEMO=true PORT=9000)
for (const arg of process.argv.slice(2)) {
  const m = arg.match(/^--([a-z0-9-]+)(?:=(.*))?$/i);
  if (m) process.env[m[1].toUpperCase().replace(/-/g, '_')] = m[2] ?? 'true';
}
loadDotEnv(path.join(ROOT, '.env'));
// Hour boundaries for reports follow this timezone (e.g. Asia/Kolkata), not the server's UTC clock
if (process.env.TIMEZONE) process.env.TZ = process.env.TIMEZONE;
fs.mkdirSync(DATA_DIR, { recursive: true });

const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
const bool = (v, d = false) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));
const num = (v, d) => (v === undefined || v === '' || isNaN(+v) ? d : +v);

function persistentSecret(name) {
  const f = path.join(DATA_DIR, name);
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}

const env = process.env;
const config = {
  ROOT,
  DATA_DIR,
  PORT: num(env.PORT, 8080),
  HOST: env.HOST || '0.0.0.0',
  SERVER_ID: env.SERVER_ID || 'main',
  SERVER_NAME: env.SERVER_NAME || require('os').hostname(),
  PUBLIC_URL: (env.PUBLIC_URL || '').replace(/\/$/, ''),
  ADMIN_PASSWORD: env.ADMIN_PASSWORD || 'admin123',
  AUTH_SECRET: env.AUTH_SECRET || persistentSecret('auth.secret'),
  AGENT_TOKEN: env.AGENT_TOKEN || persistentSecret('agent.token'),
  TRUST_PROXY: bool(env.TRUST_PROXY, true),

  // Email option 1: Resend (https://resend.com) — just an API key, sent over HTTPS
  RESEND_API_KEY: (env.RESEND_API_KEY || '').trim(),
  RESEND_API_URL: (env.RESEND_API_URL || 'https://api.resend.com').replace(/\/$/, ''),
  // Email option 2: SMTP — Gmail app passwords, Zoho, SES, Brevo, etc.
  SMTP_HOST: env.SMTP_HOST || '',
  SMTP_PORT: num(env.SMTP_PORT, 465),
  SMTP_SECURE: bool(env.SMTP_SECURE, num(env.SMTP_PORT, 465) === 465),
  SMTP_USER: env.SMTP_USER || '',
  SMTP_PASS: env.SMTP_PASS || '',
  MAIL_FROM: env.MAIL_FROM || (env.RESEND_API_KEY ? 'vishalrajcspl@gmail.com' : env.SMTP_USER) || '',
  ALERT_EMAIL_TO: list(env.ALERT_EMAIL_TO),

  // Optional extra phone channel: ntfy.sh topic URL (works without installing the PWA)
  NTFY_URL: env.NTFY_URL || '',
  NTFY_TOKEN: env.NTFY_TOKEN || '',
  VAPID_SUBJECT: env.VAPID_SUBJECT || 'mailto:admin@example.com',

  // Security sources on THIS machine (remote machines use the agent)
  LOG_FILES: list(env.LOG_FILES),          // nginx/apache access logs (combined format or JSON lines)
  AUTH_LOG: env.AUTH_LOG || '',            // /var/log/auth.log or /var/log/secure for SSH brute force
  WATCH_DIRS: list(env.WATCH_DIRS),        // folders to protect from ransomware
  DISK_PATHS: list(env.DISK_PATHS).length ? list(env.DISK_PATHS) : [process.platform === 'win32' ? path.parse(process.cwd()).root : '/'],
  MONITOR_LOCAL: bool(env.MONITOR_LOCAL, true),

  DEMO: bool(env.DEMO, false),
  TIMEZONE: env.TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone,
};

// Start of the local hour containing t (handles half-hour offsets like IST)
config.hourStart = (t = Date.now()) => { const d = new Date(t); d.setMinutes(0, 0, 0); return d.getTime(); };

module.exports = config;
