// Ransomware early-warning for protected folders:
//  • canary (honeypot) files — any touch = critical
//  • known ransomware extensions and ransom-note file names
//  • mass file modification bursts
//  • high-entropy (encrypted-looking) writes to normally-plain-text files
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RANSOM_EXT = new Set(`encrypted crypted crypt crypto locky zepto odin cerber cerber3 wncry wnry wcry wannacry ryk ryuk conti lockbit lockbit3 blackcat phobos djvu dharma wallet onion zzzzz micro vvv ecc ezz exx crab gdcb krab sage globe purge cry crinf r5a xrnt xtbl vault ctbl basta akira royal hive rhysida medusa 8base cactus babuk avaddon maze egregor nefilim ragnar clop ciop mallox fargo bianlian trigona blacksuit nokoyawa qilin locked encrypt enc0 pay2key darkside revil sodinokibi cuba lorenz quantum`.split(/\s+/));
const NOTE_RE = /(decrypt|restore[-_ ]?(my|your|all)?[-_ ]?files|recover[-_ ]?(your|my)?[-_ ]?files|unlock[-_ ]?files|how[-_ ]?to[-_ ]?(back|get|decrypt|restore|recover)|your[-_ ]?files|files[-_ ]?(are[-_ ]?)?encrypted|ransom|!!!.*read)/i;
const TEXTY = new Set(['.txt', '.csv', '.json', '.js', '.ts', '.html', '.htm', '.css', '.md', '.log', '.sql', '.xml', '.yml', '.yaml', '.ini', '.conf', '.env', '.php', '.py', '.rb', '.java', '.svg']);
// already-compressed/encrypted formats: high entropy is normal for these, so they are skipped
const PACKED = new Set(['.zip', '.gz', '.tgz', '.bz2', '.xz', '.zst', '.br', '.7z', '.rar', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.heic', '.mp3', '.mp4', '.m4a', '.mov', '.webm', '.mkv', '.pdf', '.docx', '.xlsx', '.pptx', '.odt', '.jar', '.apk', '.ipa', '.aab', '.woff', '.woff2', '.gpg', '.pgp', '.age', '.kdbx', '.p12', '.pfx', '.der', '.so', '.dylib', '.dll', '.exe', '.bin', '.dat', '.db', '.sqlite', '.pack', '.idx']);
const IGNORE = /(^|[\\/])(node_modules|\.git|\.cache|__pycache__)([\\/]|$)/;

const CANARY_NAMES = ['!000-sentinel-canary.txt', '~sentinel-canary-backup.docx.txt'];
const CANARY_BODY = (dir) =>
  `SENTINEL CANARY FILE — DO NOT EDIT, MOVE OR DELETE.\nThis file is a honeypot used to detect ransomware in:\n${dir}\nAny change to it triggers a critical security alert.\n` +
  'Lorem ipsum dolor sit amet consectetur adipiscing elit. '.repeat(40);

function entropy(buf) {
  if (!buf.length) return 0;
  const f = new Array(256).fill(0);
  for (const b of buf) f[b]++;
  let e = 0;
  for (const c of f) if (c) { const p = c / buf.length; e -= p * Math.log2(p); }
  return e;
}

function sha(file) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; }
}

/**
 * startRansomwareWatch({ dirs, emit, getSettings })
 * emit(event) where event = { type, severity, path, dir, count, desc }
 */
function startRansomwareWatch({ dirs, emit, getSettings = () => ({}) }) {
  const canaries = new Map(); // file -> {hash, dir}
  const changes = [];         // timestamps of file events
  const entropyHits = [];
  const recent = new Map();   // path -> last handled ts (debounce)
  let lastMassAlert = 0;

  function plantCanaries(dir) {
    for (const name of CANARY_NAMES) {
      const f = path.join(dir, name);
      try {
        const body = CANARY_BODY(dir);
        if (!fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== body) fs.writeFileSync(f, body);
        canaries.set(f, { hash: sha(f), dir });
      } catch (e) {
        console.warn('[ransomware] cannot plant canary in', dir, e.message);
      }
    }
  }

  function checkCanary(f) {
    const c = canaries.get(f);
    if (!c) return;
    const h = fs.existsSync(f) ? sha(f) : null;
    if (h === c.hash) return;
    emit({
      type: 'RANSOMWARE_CANARY', severity: 'critical', path: f, dir: c.dir,
      desc: h ? 'Honeypot canary file was modified/encrypted' : 'Honeypot canary file was deleted or renamed',
    });
    // re-arm after a minute so detection keeps working
    setTimeout(() => plantCanaries(c.dir), 60_000).unref?.();
    c.hash = '__tripped__';
  }

  function onEvent(dir, filename) {
    if (!filename) return;
    const full = path.join(dir, filename.toString());
    if (IGNORE.test(full)) return;
    const now = Date.now();
    if (now - (recent.get(full) || 0) < 1000) return;
    recent.set(full, now);
    if (recent.size > 20000) recent.clear();

    if (canaries.has(full)) return checkCanary(full);

    changes.push(now);
    while (changes.length && now - changes[0] > 30_000) changes.shift();

    const base = path.basename(full);
    const ext = path.extname(base).slice(1).toLowerCase();
    if (ext && RANSOM_EXT.has(ext) && fs.existsSync(full)) {
      emit({ type: 'RANSOMWARE_EXT', severity: 'critical', path: full, dir, desc: `File renamed with ransomware extension “.${ext}”` });
    }
    if (NOTE_RE.test(base) && /\.(txt|html?|hta|rtf|url|png|jpg)$/i.test(base) && fs.existsSync(full)) {
      emit({ type: 'RANSOM_NOTE', severity: 'critical', path: full, dir, desc: `Possible ransom note created: ${base}` });
    }

    const threshold = getSettings().massFileChangeThreshold || 100;
    if (changes.length >= threshold && now - lastMassAlert > 60_000) {
      lastMassAlert = now;
      emit({
        type: 'MASS_FILE_CHANGE', severity: changes.length >= threshold * 5 ? 'critical' : 'high', path: dir, dir,
        count: changes.length, desc: `${changes.length} files changed in 30 seconds`,
      });
    }

    const lext = path.extname(base).toLowerCase();
    const known = ext && RANSOM_EXT.has(ext);
    if (!known && !PACKED.has(lext)) {
      setTimeout(() => {
        try {
          const st = fs.statSync(full);
          if (!st.isFile() || st.size < 512) return;
          const fd = fs.openSync(full, 'r');
          const b = Buffer.alloc(Math.min(4096, st.size));
          fs.readSync(fd, b, 0, b.length, 0);
          fs.closeSync(fd);
          const e = entropy(b);
          // plain-text files should never look random; other files only count when it happens in bursts
          if (e > (TEXTY.has(lext) ? 7.2 : 7.6)) {
            entropyHits.push(Date.now());
            while (entropyHits.length && Date.now() - entropyHits[0] > 60_000) entropyHits.shift();
            if (TEXTY.has(lext) || entropyHits.length >= 3) {
              emit({
                type: 'HIGH_ENTROPY', severity: entropyHits.length >= 5 ? 'critical' : 'high', path: full, dir,
                desc: `${entropyHits.length} file(s) now look encrypted (entropy ${e.toFixed(2)}/8), e.g. ${base}`,
              });
            }
          }
        } catch {}
      }, 300).unref?.();
    }
  }

  const watchers = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) { console.warn('[ransomware] folder not found:', dir); continue; }
    plantCanaries(dir);
    try {
      watchers.push(fs.watch(dir, { recursive: true }, (_, f) => onEvent(dir, f)));
    } catch {
      watchers.push(fs.watch(dir, (_, f) => onEvent(dir, f)));
    }
    console.log('[ransomware] protecting', dir);
  }
  const timer = setInterval(() => { for (const f of canaries.keys()) checkCanary(f); }, 30_000);
  timer.unref?.();

  return { stop() { clearInterval(timer); watchers.forEach((w) => w.close()); }, canaryCount: () => canaries.size };
}

module.exports = { startRansomwareWatch, entropy };
