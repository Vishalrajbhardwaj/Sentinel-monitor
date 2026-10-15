// Alert manager: de-duplicates, applies cooldown, escalates, resolves and fans out notifications.
const { state, bus, pushBounded, uid, LIMITS } = require('./store');
const { deliverAlert, SEV_RANK } = require('./notify');

// key -> open alert
const open = new Map();
function rebuildIndex() {
  open.clear();
  for (const a of state.alerts) if (a.status === 'open') open.set(a.key, a);
}

/**
 * raise({ key, severity, title, message, category, action, details, routeId, serverId, link })
 * Returns the alert record. Notifies only when new, escalated, or cooldown elapsed.
 */
function raise(input) {
  const now = Date.now();
  const cooldown = (state.settings.alertCooldownMin || 15) * 60_000;
  const existing = open.get(input.key);

  if (existing) {
    existing.count++;
    existing.lastT = now;
    existing.message = input.message || existing.message;
    existing.details = { ...existing.details, ...input.details };
    const escalated = SEV_RANK[input.severity] > SEV_RANK[existing.severity];
    if (escalated) existing.severity = input.severity;
    if (escalated || now - existing.notifiedAt > cooldown) {
      existing.notifiedAt = now;
      existing.ack = false;
      notify(existing);
    }
    bus.emit('alert', existing);
    return existing;
  }

  const alert = {
    id: uid('al_'),
    t: now,
    lastT: now,
    notifiedAt: now,
    key: input.key,
    severity: input.severity || 'warning',
    category: input.category || 'health',
    title: input.title,
    message: input.message || '',
    action: input.action || '',
    details: input.details || {},
    routeId: input.routeId,
    serverId: input.serverId,
    link: input.link,
    status: 'open',
    ack: false,
    count: 1,
    channels: [],
  };
  pushBounded(state.alerts, alert, LIMITS.alerts);
  open.set(alert.key, alert);
  notify(alert);
  bus.emit('alert', alert);
  return alert;
}

function resolve(key, message) {
  const a = open.get(key);
  if (!a) return null;
  a.status = 'resolved';
  a.resolvedAt = Date.now();
  open.delete(key);
  const mins = Math.max(1, Math.round((a.resolvedAt - a.t) / 60000));
  const rec = {
    ...a,
    title: a.title.replace(/^(.*?)( —.*)?$/, '$1') + ' — recovered',
    message: message || `Back to normal after ${mins} min.`,
    severity: 'info',
    resolved: true,
  };
  // Only tell people about recoveries for things that were worth notifying in the first place
  if (SEV_RANK[a.severity] >= SEV_RANK[state.settings.pushMinSeverity] || SEV_RANK[a.severity] >= SEV_RANK[state.settings.emailMinSeverity]) {
    deliverAlert(rec, { forceEmail: SEV_RANK[a.severity] >= SEV_RANK[state.settings.emailMinSeverity] }).catch(() => {});
  }
  bus.emit('alert', a);
  return a;
}

function notify(alert) {
  deliverAlert(alert)
    .then((ch) => { alert.channels = Array.from(new Set([...(alert.channels || []), ...ch])); bus.emit('alert', alert); })
    .catch(() => {});
}

function ack(id) {
  const a = state.alerts.find((x) => x.id === id);
  if (a) { a.ack = true; bus.emit('alert', a); }
  return a;
}
function ackAll() {
  for (const a of state.alerts) if (a.status === 'open') a.ack = true;
}
function isOpen(key) { return open.has(key); }
function openAlerts() { return [...open.values()]; }

module.exports = { raise, resolve, ack, ackAll, isOpen, openAlerts, rebuildIndex };
