// Delivery channels: Email (Resend API or SMTP), Web Push (installed PWA on phone/desktop), ntfy (optional)
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const webpush = require('web-push');
const config = require('./config');
const { state } = require('./store');

const SEV_COLOR = { critical: '#ef4444', high: '#f97316', warning: '#eab308', info: '#22c55e' };
const SEV_RANK = { info: 0, warning: 1, high: 2, critical: 3 };

const FROM = `Sentinel Monitor <${config.MAIL_FROM}>`;

const status = {
  email: { configured: false, provider: null, from: FROM, to: [], note: null, lastError: null, lastSent: null },
  push: { lastError: null, lastSent: null },
  ntfy: { configured: !!config.NTFY_URL, lastError: null, lastSent: null },
};

// ---------- Email ----------
let transporter = null;
if (config.MAIL_FROM_RAW && !config.MAIL_FROM_RAW.includes(config.MAIL_FROM || '@@')) {
  console.warn(`[email] MAIL_FROM "${config.MAIL_FROM_RAW}" can't be used as the sender${config.RESEND_API_KEY ? ' with Resend (only onboarding@resend.dev or your own verified domain work)' : ''} — using ${config.MAIL_FROM || 'nothing'}`);
}
if (config.RESEND_API_KEY) {
  status.email.configured = true;
  status.email.provider = 'Resend';
  if (!/^re_/.test(config.RESEND_API_KEY)) console.warn('[email] RESEND_API_KEY should start with re_ — check you copied the whole key');
} else if (config.SMTP_HOST && config.SMTP_USER) {
  if (config.SMTP_HOST.includes('@')) console.warn('[email] SMTP_HOST looks like an email address — it must be a server name such as smtp.gmail.com or smtp.resend.com');
  status.email.provider = 'SMTP';
  transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
  });
  status.email.configured = true;
}

function recipients() {
  return state.settings.emailTo && state.settings.emailTo.length ? state.settings.emailTo : config.ALERT_EMAIL_TO;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function emailShell(title, accent, bodyHtml) {
  const link = config.PUBLIC_URL
    ? `<a href="${config.PUBLIC_URL}" style="display:inline-block;margin-top:18px;background:#0f172a;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600">Open Sentinel dashboard</a>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
  <div style="max-width:640px;margin:0 auto;padding:24px">
    <div style="background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0">
      <div style="height:6px;background:${accent}"></div>
      <div style="padding:22px 24px">
        <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#64748b;font-weight:700">Sentinel · ${esc(config.SERVER_NAME)}</div>
        <h1 style="font-size:20px;margin:6px 0 14px">${esc(title)}</h1>
        ${bodyHtml}
        ${link}
      </div>
    </div>
    <p style="font-size:11px;color:#94a3b8;text-align:center;margin-top:14px">Sent automatically by Sentinel server monitor · ${new Date().toUTCString()}</p>
  </div></body></html>`;
}

// Resend over HTTPS. Sends are queued and spaced out so a burst of alerts doesn't hit the rate limit.
let resendChain = Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function resendHint(msg) {
  if (/domain is not verified|not verified/i.test(msg)) return ' — set MAIL_FROM=onboarding@resend.dev, or verify your own domain at resend.com/domains';
  if (/testing emails to your own email/i.test(msg)) return ' — with onboarding@resend.dev you can only email the address you signed up to Resend with. Verify a domain at resend.com/domains to email anyone else';
  if (/api key is invalid|invalid api key|missing api key/i.test(msg)) return ' — check RESEND_API_KEY in .env (it starts with re_)';
  return '';
}
// With Resend's test sender (onboarding@resend.dev) only the Resend account owner can receive mail.
// Sentinel learns that address from Resend's reply and sends to it instead of failing the whole alert.
const TEST_SENDER = /@resend\.dev$/i.test(config.MAIL_FROM);
function narrowToOwner(to) {
  const owner = state.meta.resendOwner;
  if (!TEST_SENDER || !owner) { status.email.note = null; return to; }
  const skipped = to.filter((x) => x.toLowerCase() !== owner.toLowerCase());
  status.email.note = skipped.length
    ? `Sent only to ${owner}. With onboarding@resend.dev Resend delivers only to your own account email — verify a domain at resend.com/domains to also reach ${skipped.join(', ')}.`
    : null;
  return [owner];
}
function sendViaResend({ to: wanted, subject, html, text }) {
  const job = resendChain.then(async () => {
    let to = narrowToOwner(wanted);
    for (let attempt = 0; attempt < 4; attempt++) {
      status.email.to = to;
      const r = await fetch(config.RESEND_API_URL + '/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to, subject, html, text }),
        signal: AbortSignal.timeout(15000),
      });
      if (r.ok) { await sleep(600); return true; }
      const body = await r.json().catch(() => ({}));
      if (r.status === 429 && attempt < 3) { await sleep(1500 * (attempt + 1)); continue; }
      const msg = body.message || body.error || `HTTP ${r.status}`;
      const own = r.status === 403 && msg.match(/own email address \(([^)\s]+)\)/i);
      if (own && TEST_SENDER && attempt < 3 && !(to.length === 1 && to[0].toLowerCase() === own[1].toLowerCase())) {
        state.meta.resendOwner = own[1];
        console.warn(`[email] Resend test sender can only reach ${own[1]} — sending alerts there`);
        to = narrowToOwner(wanted);
        continue;
      }
      throw new Error(`Resend ${r.status}: ${msg}${resendHint(msg)}`);
    }
    return false;
  });
  resendChain = job.catch(() => {});
  return job;
}

async function sendEmail({ subject, html, text }) {
  const to = recipients();
  if (!status.email.configured || !to.length) {
    status.email.lastError = !status.email.configured ? 'Email not configured' : 'No recipients configured';
    return false;
  }
  try {
    if (config.RESEND_API_KEY) await sendViaResend({ to, subject, html, text });
    else { status.email.to = to; await transporter.sendMail({ from: FROM, to: to.join(','), subject, html, text }); }
    status.email.lastSent = Date.now();
    status.email.lastError = null;
    return true;
  } catch (e) {
    status.email.lastError = e.message;
    console.error('[email] failed:', e.message);
    return false;
  }
}

// ---------- Web Push ----------
const vapidFile = path.join(config.DATA_DIR, 'vapid.json');
let vapid;
if (fs.existsSync(vapidFile)) vapid = JSON.parse(fs.readFileSync(vapidFile, 'utf8'));
else {
  vapid = webpush.generateVAPIDKeys();
  fs.writeFileSync(vapidFile, JSON.stringify(vapid), { mode: 0o600 });
}
webpush.setVapidDetails(config.VAPID_SUBJECT, vapid.publicKey, vapid.privateKey);

async function sendPush(payload) {
  const subs = state.pushSubs;
  if (!subs.length) return 0;
  let sent = 0;
  const dead = new Set();
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600, urgency: payload.urgency || 'normal' });
        sent++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) dead.add(sub.endpoint);
        else status.push.lastError = e.body || e.message;
      }
    })
  );
  if (dead.size) state.pushSubs = state.pushSubs.filter((s) => !dead.has(s.endpoint));
  if (sent) { status.push.lastSent = Date.now(); status.push.lastError = null; }
  return sent;
}

// ---------- ntfy (optional) ----------
async function sendNtfy({ title, message, severity, tags }) {
  if (!config.NTFY_URL) return false;
  try {
    const headers = {
      Title: title.replace(/[^\x20-\x7E]/g, ''),
      Priority: { critical: '5', high: '4', warning: '3', info: '2' }[severity] || '3',
      Tags: tags || (severity === 'critical' ? 'rotating_light' : severity === 'info' ? 'white_check_mark' : 'warning'),
    };
    if (config.NTFY_TOKEN) headers.Authorization = `Bearer ${config.NTFY_TOKEN}`;
    if (config.PUBLIC_URL) headers.Click = config.PUBLIC_URL;
    const r = await fetch(config.NTFY_URL, { method: 'POST', body: message, headers });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    status.ntfy.lastSent = Date.now();
    status.ntfy.lastError = null;
    return true;
  } catch (e) {
    status.ntfy.lastError = e.message;
    return false;
  }
}

// ---------- High-level helpers ----------
function alertEmail(alert) {
  const rows = Object.entries(alert.details || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `<tr><td style="padding:6px 10px;color:#64748b;font-size:13px;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 10px;font-size:13px;font-family:ui-monospace,Menlo,monospace;word-break:break-all">${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</td></tr>`)
    .join('');
  const accent = SEV_COLOR[alert.severity] || '#64748b';
  const html = emailShell(
    alert.title,
    accent,
    `<div style="display:inline-block;background:${accent};color:#fff;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:4px 9px;border-radius:999px">${esc(alert.resolved ? 'resolved' : alert.severity)}</div>
     <p style="font-size:15px;line-height:1.55;margin:14px 0">${esc(alert.message)}</p>
     ${alert.action ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;font-size:13px;margin-bottom:12px"><b>Suggested action:</b> ${esc(alert.action)}</div>` : ''}
     ${rows ? `<table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:10px">${rows}</table>` : ''}`
  );
  return { subject: `[${alert.resolved ? 'RESOLVED' : alert.severity.toUpperCase()}] ${alert.title}`, html, text: `${alert.title}\n\n${alert.message}\n\n${alert.action || ''}` };
}

async function deliverAlert(alert, { forceEmail = false } = {}) {
  const s = state.settings;
  const rank = SEV_RANK[alert.severity] ?? 1;
  const tasks = [];
  const channels = [];
  if (forceEmail || rank >= (SEV_RANK[s.emailMinSeverity] ?? 2)) {
    tasks.push(sendEmail(alertEmail(alert)).then((ok) => ok && channels.push('email')));
  }
  if (rank >= (SEV_RANK[s.pushMinSeverity] ?? 1) || alert.resolved) {
    const payload = {
      title: (alert.resolved ? '✅ ' : rank >= 3 ? '🚨 ' : rank >= 2 ? '⚠️ ' : '') + alert.title,
      body: alert.message,
      tag: alert.key,
      severity: alert.severity,
      url: alert.link || '/#/alerts',
      urgency: rank >= 2 ? 'high' : 'normal',
      renotify: rank >= 2,
    };
    tasks.push(sendPush(payload).then((n) => n && channels.push('push')));
    tasks.push(sendNtfy({ title: payload.title, message: alert.message, severity: alert.severity }).then((ok) => ok && channels.push('ntfy')));
  }
  await Promise.allSettled(tasks);
  return channels;
}

module.exports = { sendEmail, sendPush, sendNtfy, deliverAlert, emailShell, esc, status, vapidPublicKey: vapid.publicKey, SEV_RANK, SEV_COLOR, recipients };