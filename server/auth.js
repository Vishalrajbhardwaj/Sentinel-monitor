// Stateless signed tokens for the dashboard + shared token for agents.
const crypto = require('crypto');
const config = require('./config');

const TTL = 30 * 24 * 3600_000;

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', config.AUTH_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expect = crypto.createHmac('sha256', config.AUTH_SECRET).update(body).digest('base64url');
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function issue() { return sign({ sub: 'admin', exp: Date.now() + TTL }); }

function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : req.query.token;
  if (verify(token)) return next();
  res.status(401).json({ error: 'unauthorized' });
}

function requireAgent(req, res, next) {
  const t = req.headers['x-agent-token'] || '';
  if (t && safeEqual(t, config.AGENT_TOKEN)) return next();
  res.status(401).json({ error: 'bad agent token' });
}

// login attempt limiter
const attempts = new Map();
function loginAllowed(ip) {
  const now = Date.now();
  const a = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60_000);
  attempts.set(ip, a);
  return a.length < 10;
}
function loginFailed(ip) {
  const a = attempts.get(ip) || [];
  a.push(Date.now());
  attempts.set(ip, a);
  return a.length;
}

module.exports = { issue, verify, requireAuth, requireAgent, safeEqual, loginAllowed, loginFailed };
