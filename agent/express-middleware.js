// Drop-in Express middleware for Node APIs without nginx access logs.
// Streams every request (ip, method, path, status, time) to the Sentinel hub so attacks on your
// API routes are detected even when the app is behind a load balancer.
//
//   const sentinel = require('./express-middleware');
//   app.use(sentinel({ hubUrl: process.env.SENTINEL_URL, token: process.env.SENTINEL_AGENT_TOKEN, serverId: 'orders-api' }));
module.exports = function sentinel({ hubUrl, token, serverId = require('os').hostname(), flushMs = 5000 } = {}) {
  if (!hubUrl || !token) return (req, res, next) => next();
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    const requests = batch.splice(0, 5000);
    try {
      await fetch(hubUrl.replace(/\/$/, '') + '/api/agent/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Agent-Token': token },
        body: JSON.stringify({ serverId, requests }),
        signal: AbortSignal.timeout(10000),
      });
    } catch { /* monitoring must never break the app */ }
  };
  setInterval(flush, flushMs).unref();

  return function sentinelMiddleware(req, res, next) {
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      if (batch.length > 20000) return;
      batch.push({
        t: Date.now(),
        ip: req.ip || req.socket.remoteAddress,
        method: req.method,
        path: req.originalUrl || req.url,
        status: res.statusCode,
        ua: req.get('user-agent') || '',
        ms: Number(process.hrtime.bigint() - t0) / 1e6,
      });
    });
    next();
  };
};
