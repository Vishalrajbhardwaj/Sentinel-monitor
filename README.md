# Sentinel — server health & security monitor

A self-hosted monitor you install like an app on your phone and computer. It:

- **Calls your API routes on a schedule** and checks the response against what you expect (status code, text in the body, a JSON field's value, response time). If it doesn't match, it tells you **which route**, **what kind of failure** (timeout, refused, 5xx, 404, wrong body, slow, SSL…) and **what to do**.
- **Detects attacks** from your nginx/apache logs, SSH logins and the app itself: SQL injection, XSS, path traversal, command injection, Log4Shell, scanners, `.env`/`.git` probing, brute-force logins, SSH brute-force, request floods and DDoS spikes, 5xx error spikes.
- **Watches for ransomware** in folders you choose: honeypot "canary" files, known ransomware extensions, ransom notes, mass file changes and encrypted-looking writes.
- **Tracks server capacity** live (CPU, memory, disk, load, network, busiest processes) and says each hour whether a server is *Free / Moderate / Busy / Overloaded* and how much is free.
- **Alerts you** by **email** and **phone/desktop push notification** (plus optional ntfy), with de-duplication, escalation and "recovered" messages.
- **Writes an hourly report automatically** (uptime per route, attacks, capacity) — emailed, pushed to your phone, and kept for 14 days in the app.

```
 ┌───────────── your phone / laptop (installed PWA) ─────────────┐
 │  Overview · Routes · Security · Servers · Reports · Alerts    │
 └───────────────▲──────────────────────────▲────────────────────┘
                 │ live (SSE) + API          │ push notifications / email
        ┌────────┴──────── Sentinel hub (Node) ─────────┐
        │ route checker · threat engine · ransomware    │
        │ watch · metrics · alerting · hourly reports   │
        └──────▲───────────────▲──────────────▲─────────┘
               │ HTTP checks   │ agent push   │ agent push
          your APIs        server 2        server 3 …
```

## 1. Try it in 1 minute (demo mode)

Needs Node 20+ (`node -v`).

```bash
cd sentinel
npm install
npm run demo          # fake API, simulated attacks, 2 simulated servers, 24h of history
```

Works the same in Windows PowerShell/CMD, macOS and Linux. Open http://localhost:8080 — password `admin123`. Go to **Settings → Try it** and press *Ransomware*, *SQL injection*, *Orders API outage*… to watch detection and alerts happen live. This demo uses simulated APIs, servers, traffic and attacks.

Any setting can be given as a flag on any OS, e.g. `node server/index.js --demo --port=9000`, or put in the `.env` file. (In PowerShell, environment variables are set as `$env:PORT="9000"` — the `PORT=9000 node …` form only works in Mac/Linux shells.)

For live monitoring, start with `npm start` (or `node server/index.js`) and keep `DEMO=false` in `.env`. The local server's CPU, memory and disk are sampled continuously; add your own API routes, actual access/auth log paths and remote-server agents to monitor those real sources. Log paths and protected folders are OS-specific. Use `npm run demo` only when you explicitly want simulated data.

## 2. Run it for real

On the server that will host the dashboard (a small VPS is fine):

```bash
sudo mkdir -p /opt/sentinel && sudo cp -r . /opt/sentinel && cd /opt/sentinel
npm install --omit=dev
cp .env.example .env && nano .env      # password, SMTP, log files, folders to protect, TIMEZONE
sudo useradd -r -s /usr/sbin/nologin sentinel && sudo chown -R sentinel /opt/sentinel
sudo cp deploy/sentinel.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now sentinel
```

**HTTPS is required** for installing the app and push notifications. Easiest options:
- nginx + certbot: use `deploy/nginx-sentinel.conf`, then `sudo certbot --nginx -d monitor.yourdomain.com`
- or Caddy: `monitor.yourdomain.com { reverse_proxy 127.0.0.1:8080 }` (automatic HTTPS)
- or Cloudflare Tunnel if the box has no public IP.

(pm2 users: `pm2 start server/index.js --name sentinel && pm2 save`.)

## 3. Install on your phone and turn on notifications

| Device | Steps |
|---|---|
| **Android** (Chrome) | Open your dashboard URL → menu ⋮ → **Install app**. Open it → Settings → **Turn on** notifications. |
| **iPhone / iPad** (iOS 16.4+) | Open in **Safari** → Share → **Add to Home Screen**. Open Sentinel *from the home screen* → Settings → **Turn on**. |
| **Mac / Windows** | Chrome/Edge: install icon in the address bar. Safari (Mac): File → **Add to Dock**. Then Settings → **Turn on**. |

Press **Send test notification** to confirm. Critical alerts stay on screen until you tap them.

Want notifications without installing? Install the free **ntfy** app, subscribe to a secret topic, and set `NTFY_URL=https://ntfy.sh/<your-topic>` in `.env`.

## 4. Email alerts

**Resend (easiest):** create a key at https://resend.com/api-keys and put it in `.env`:

```dotenv
RESEND_API_KEY=re_your_key
MAIL_FROM=onboarding@resend.dev
ALERT_EMAIL_TO=the-email-you-signed-up-to-resend-with@gmail.com
```

`onboarding@resend.dev` can only email your own Resend account address. To email other people, verify your domain at https://resend.com/domains and set `MAIL_FROM=alerts@yourdomain.com`. Emails go over HTTPS, so it works even where SMTP ports are blocked.

**Or SMTP (Gmail example):**

1. Turn on 2-Step Verification for your Google account.
2. Create an App Password at https://myaccount.google.com/apppasswords.
3. In `.env`: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER=you@gmail.com`, `SMTP_PASS=<app password>`, `ALERT_EMAIL_TO=you@gmail.com`.
4. Restart, then Settings → **Send test email**.

Choose which severities email you and push you in Settings (defaults: email for *High+*, push for *Warning+*). Recipients can be changed in the app.

## 5. Add your routes

**Routes → Add route.** For each API endpoint set:

| Field | Example | Meaning |
|---|---|---|
| URL + method | `GET https://api.myapp.com/v1/health` | What to call (headers/body supported, e.g. auth tokens) |
| Expected status | `200`, `2xx`, `200,204` | Status codes that count as OK |
| Must contain / must not contain | `"ok"` / `error` | Text checks on the body |
| JSON field = value | `data.status` = `ok` | Checks a field in a JSON response |
| Slow if over | `1500` ms | Slower responses are flagged "Slow" |
| Check every | `30` s | Interval (min 10 s) |

Use **Test now** before saving. TCP checks (database, Redis, any port) are also supported.

A route must fail **2 checks in a row** (configurable) before it alerts, so one blip doesn't wake you up. When it recovers you get a "recovered" message.

## 6. Watch other servers (agent)

Copy this folder to the other server (no `npm install` needed — the agent has no dependencies) and run:

```bash
AGENT_HUB_URL=https://monitor.yourdomain.com \
AGENT_TOKEN=<from Settings → Connect another server> \
AGENT_NAME=api-server-2 \
AGENT_LOG_FILES=/var/log/nginx/access.log \
AGENT_AUTH_LOG=/var/log/auth.log \
AGENT_WATCH_DIRS=/var/www,/home/app/uploads \
node agent/agent.js
```

On Windows, put the same `AGENT_…=value` lines in `agent/.env` and just run `node agent/agent.js`. On Linux, put those lines in `agent/.env` and use `deploy/sentinel-agent.service` to run it on boot. If an agent stops reporting for 60 s you get a **"server not responding"** critical alert.

**Node/Express apps without nginx logs:** add `agent/express-middleware.js`:

```js
const sentinel = require('./express-middleware');
app.use(sentinel({ hubUrl: process.env.SENTINEL_URL, token: process.env.SENTINEL_AGENT_TOKEN, serverId: 'orders-api' }));
```

## 7. What gets detected

| Type | How | Default severity |
|---|---|---|
| SQL injection, XSS, path traversal, command injection, Log4Shell | Signatures on decoded URLs/user agents | High / Warning / Critical |
| Sensitive file probes (`.env`, `.git`, backups, wp-admin…) and scanners (sqlmap, nikto, nuclei…) | Paths + user agents | Warning (High after 50) |
| Brute-force login | ≥10 failed 401/403 on login routes per IP in 5 min | High → Critical |
| Directory enumeration | ≥40 404s per IP in 5 min | Warning |
| Request flood (DoS) | ≥600 requests per IP per minute | High |
| DDoS spike | Traffic > 6× normal and > 1500 req/min | Critical |
| 5xx error spike | ≥10% server errors in a minute (names worst route) | High → Critical |
| SSH brute-force / root login | auth.log | High / Warning |
| Ransomware | Canary file touched, ransomware extension, ransom note, ≥100 file changes in 30 s, encrypted-looking writes | Critical |
| Resources | CPU/memory/disk over thresholds (sustained ~30 s) | Warning → Critical |
| Dashboard login guessing | ≥5 wrong passwords per IP | High |

Each attack alert includes the source IP, the routes it hit, a sample request and a ready-to-copy block command (`sudo ufw deny from …`). All thresholds are editable in Settings.

> Sentinel **detects and alerts** — it doesn't block traffic by itself. Pair it with `ufw`/`fail2ban`/Cloudflare for blocking. Canary files are named `!000-sentinel-canary.txt` and `~sentinel-canary-backup.docx.txt`; leave them in place.

## 8. Hourly reports

At the top of every hour (in `TIMEZONE`) Sentinel builds a report: status (healthy / issues / critical), uptime and average speed per route with the issue types, attacks by type and top IPs, and each server's average/peak CPU, memory, disk and **% free**. It's emailed, pushed as a short summary, and listed under **Reports**. *Email current hour now* sends a report on demand.

## Files

```
server/index.js        API, live stream, startup
server/checker.js      route checks + result matching + issue classification
server/threats.js      attack detection engine
server/metrics.js      server capacity, thresholds, offline detection
server/alerts.js       de-dup / escalation / recovery
server/notify.js       email, web push, ntfy
server/reports.js      hourly reports
server/collectors/     system sampler, log tailer, ransomware watcher (shared with agent)
server/demo.js         demo mode
agent/agent.js         remote server agent
public/                the installable app (PWA)
data/                  state.json, VAPID keys, secrets (created on first run — back it up, keep private)
```

## Troubleshooting

- **No push "Turn on" button on iPhone** → open Sentinel from the home-screen icon, not Safari.
- **Push test says 0 devices** → turn notifications on in Settings on that device first; the site must be HTTPS.
- **Email error "Invalid login"** → use a Gmail *App Password*, not your normal password.
- **No attacks ever show** → set `LOG_FILES` to your real access log and make sure the service user can read it (`adm` group on Ubuntu).
- **Hourly reports at :30** → set `TIMEZONE=Asia/Kolkata` (or your zone) in `.env`.
- **`'DEMO' is not recognized…` on Windows** → use `npm run demo` or `node server/index.js --demo` (not `DEMO=true node …`).
- **Windows: "Busiest processes" empty for the first minute** → it's read through PowerShell once a minute; load average and network speed aren't available on Windows.
- **Windows Defender reacts to the demo's Ransomware button** → expected: the simulation really writes encrypted-looking files into `data/demo-protected`. They're deleted 10 seconds later.
