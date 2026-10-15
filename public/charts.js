// Tiny dependency-free SVG charts for Sentinel. 2px lines, 4px rounded bar ends, hairline grids,
// crosshair + tooltip on lines, per-mark tooltip on bars. Text never wears the data colour.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  let tipEl;
  function tip() {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; tipEl.setAttribute('role', 'status'); document.body.appendChild(tipEl); }
    return tipEl;
  }
  function showTip(x, y, head, rows) {
    const t = tip();
    t.replaceChildren();
    const h = document.createElement('div'); h.className = 't-head'; h.textContent = head; t.appendChild(h);
    for (const r of rows) {
      const row = document.createElement('div'); row.className = 't-row';
      if (r.color) { const k = document.createElement('i'); k.className = 'key'; k.style.background = r.color; row.appendChild(k); }
      const b = document.createElement('b'); b.textContent = r.value; row.appendChild(b);
      if (r.label) { const s = document.createElement('span'); s.className = 'muted'; s.textContent = r.label; row.appendChild(s); }
      t.appendChild(row);
    }
    t.classList.add('on');
    const w = t.offsetWidth, hgt = t.offsetHeight;
    let left = x + 14, top = y - hgt - 10;
    if (left + w > window.innerWidth - 8) left = x - w - 14;
    if (top < 8) top = y + 16;
    t.style.left = Math.max(8, left) + 'px';
    t.style.top = top + 'px';
  }
  function hideTip() { tip().classList.remove('on'); }

  function el(name, attrs = {}, parent) {
    const n = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }
  const compact = (v) => (Math.abs(v) >= 1e6 ? +(v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1000 ? +(v / 1000).toFixed(1) + 'K' : String(Math.round(v * 10) / 10));
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function timeLabel(t, span) {
    const d = new Date(t);
    if (span > 36 * 3600_000) return d.toLocaleDateString([], { day: '2-digit', month: 'short' });
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  /**
   * line(container, { series: [{ name, color, points: [{t, v}] }], yMax, yFormat, limits: [{v, label}], height, area })
   */
  function line(container, opts) {
    const W = Math.max(280, container.clientWidth || 600);
    const H = opts.height || 180;
    const m = { l: 36, r: 12, t: 10, b: 22 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const all = opts.series.flatMap((s) => s.points);
    container.replaceChildren();
    if (!all.length) { container.innerHTML = '<div class="empty" style="padding:30px 0">Waiting for data…</div>'; return; }
    const t0 = Math.min(...all.map((p) => p.t)), t1 = Math.max(...all.map((p) => p.t));
    const span = Math.max(1, t1 - t0);
    const rawMax = Math.max(...all.map((p) => p.v ?? 0), ...(opts.limits || []).map((l) => l.v));
    const yMax = opts.yMax ?? niceMax(rawMax * 1.08);
    const x = (t) => m.l + ((t - t0) / span) * iw;
    const y = (v) => m.t + ih - (Math.max(0, Math.min(yMax, v)) / yMax) * ih;
    const fmt = opts.yFormat || compact;

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.label || 'chart' });
    for (let i = 0; i <= 4; i++) {
      const v = (yMax / 4) * i, yy = y(v);
      el('line', { x1: m.l, x2: W - m.r, y1: yy, y2: yy, class: i ? 'grid-line' : 'baseline' }, svg);
      el('text', { x: m.l - 6, y: yy + 3.5, 'text-anchor': 'end', class: 'axis' }, svg).textContent = fmt(v);
    }
    const ticks = Math.min(6, Math.floor(iw / 80));
    for (let i = 0; i <= ticks; i++) {
      const t = t0 + (span / ticks) * i;
      el('text', { x: x(t), y: H - 5, 'text-anchor': i === 0 ? 'start' : i === ticks ? 'end' : 'middle', class: 'axis' }, svg).textContent = timeLabel(t, span);
    }
    for (const l of opts.limits || []) {
      el('line', { x1: m.l, x2: W - m.r, y1: y(l.v), y2: y(l.v), class: 'limit' }, svg);
      el('text', { x: W - m.r - 2, y: y(l.v) - 4, 'text-anchor': 'end', class: 'limit-label' }, svg).textContent = l.label;
    }
    for (const s of opts.series) {
      const pts = s.points.filter((p) => p.v !== null && p.v !== undefined);
      if (!pts.length) continue;
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
      if (opts.area !== false && opts.series.length === 1) {
        el('path', { d: `${d}L${x(pts[pts.length - 1].t).toFixed(1)},${y(0)}L${x(pts[0].t).toFixed(1)},${y(0)}Z`, fill: s.color, 'fill-opacity': 0.1, stroke: 'none' }, svg);
      }
      el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
      const last = pts[pts.length - 1];
      el('circle', { cx: x(last.t), cy: y(last.v), r: 4, fill: s.color, stroke: css('--panel'), 'stroke-width': 2 }, svg);
      for (const mk of s.markers || []) {
        el('circle', { cx: x(mk.t), cy: y(mk.v), r: 4, fill: mk.color, stroke: css('--panel'), 'stroke-width': 2 }, svg);
      }
    }
    const xh = el('line', { x1: 0, x2: 0, y1: m.t, y2: m.t + ih, class: 'xhair' }, svg);
    const dots = opts.series.map((s) => el('circle', { r: 4, fill: s.color, stroke: css('--panel'), 'stroke-width': 2, opacity: 0 }, svg));
    const hit = el('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent', tabindex: 0 }, svg);
    const times = [...new Set(all.map((p) => p.t))].sort((a, b) => a - b);
    let idx = times.length - 1;
    function at(i, cx, cy) {
      idx = Math.max(0, Math.min(times.length - 1, i));
      const t = times[idx];
      xh.setAttribute('x1', x(t)); xh.setAttribute('x2', x(t)); xh.style.opacity = 1;
      const rows = [];
      opts.series.forEach((s, k) => {
        const p = s.points.find((q) => q.t === t) || s.points.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
        if (p && p.v != null) {
          dots[k].setAttribute('cx', x(p.t)); dots[k].setAttribute('cy', y(p.v)); dots[k].setAttribute('opacity', 1);
          rows.push({ color: s.color, value: (opts.tipFormat || fmt)(p.v), label: opts.series.length > 1 ? s.name : s.name || '' });
          if (p.note) rows.push({ value: '', label: p.note });
        }
      });
      const r = svg.getBoundingClientRect();
      showTip(cx ?? r.left + (x(t) / W) * r.width, cy ?? r.top + 20, new Date(t).toLocaleString([], { hour: '2-digit', minute: '2-digit', second: span < 3600_000 ? '2-digit' : undefined, day: span > 20 * 3600_000 ? '2-digit' : undefined, month: span > 20 * 3600_000 ? 'short' : undefined, hour12: false }), rows);
    }
    hit.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const t = t0 + ((px - m.l) / iw) * span;
      let best = 0;
      for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - t) < Math.abs(times[best] - t)) best = i;
      at(best, e.clientX, e.clientY);
    });
    const off = () => { hideTip(); xh.style.opacity = 0; dots.forEach((d) => d.setAttribute('opacity', 0)); };
    hit.addEventListener('pointerleave', off);
    hit.addEventListener('blur', off);
    hit.addEventListener('focus', () => at(idx));
    hit.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') at(idx - 1); if (e.key === 'ArrowRight') at(idx + 1); });
    container.appendChild(svg);
    if (opts.series.length > 1) {
      const lg = document.createElement('div'); lg.className = 'legend';
      for (const s of opts.series) { const sp = document.createElement('span'); const i = document.createElement('i'); i.style.background = s.color; i.style.height = '3px'; sp.append(i, document.createTextNode(s.name)); lg.appendChild(sp); }
      container.appendChild(lg);
    }
  }

  /**
   * bars(container, { bars: [{ t?, label, v, color?, tip: [rows], head }], yMax, yFormat, limits, height, xLabels })
   */
  function bars(container, opts) {
    const W = Math.max(280, container.clientWidth || 600);
    const H = opts.height || 170;
    const m = { l: 36, r: 8, t: 10, b: 22 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    container.replaceChildren();
    const data = opts.bars;
    if (!data.length) { container.innerHTML = '<div class="empty" style="padding:30px 0">No data yet</div>'; return; }
    const yMax = opts.yMax ?? niceMax(Math.max(1, ...data.map((d) => d.v || 0), ...(opts.limits || []).map((l) => l.v)) * 1.05);
    const fmt = opts.yFormat || compact;
    const band = iw / data.length;
    const bw = Math.max(2, Math.min(24, band - 2));
    const y = (v) => m.t + ih - (Math.max(0, Math.min(yMax, v)) / yMax) * ih;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.label || 'bar chart' });
    for (let i = 0; i <= 4; i++) {
      const v = (yMax / 4) * i;
      el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: i ? 'grid-line' : 'baseline' }, svg);
      el('text', { x: m.l - 6, y: y(v) + 3.5, 'text-anchor': 'end', class: 'axis' }, svg).textContent = fmt(v);
    }
    const every = Math.ceil(data.length / Math.max(2, Math.floor(iw / 56)));
    data.forEach((d, i) => {
      const cx = m.l + band * i + band / 2;
      const h = Math.max(d.v > 0 ? 2 : 0, y(0) - y(d.v || 0));
      const x0 = cx - bw / 2, yTop = y(0) - h, r = Math.min(4, bw / 2, h);
      const path = h > 0
        ? `M${x0},${y(0)}V${yTop + r}Q${x0},${yTop} ${x0 + r},${yTop}H${x0 + bw - r}Q${x0 + bw},${yTop} ${x0 + bw},${yTop + r}V${y(0)}Z`
        : '';
      const g = el('g', { tabindex: 0, role: 'img', 'aria-label': `${d.head || d.label}: ${d.v}` }, svg);
      if (path) el('path', { d: path, fill: d.color || css('--data') }, g);
      el('rect', { x: cx - band / 2, y: m.t, width: band, height: ih, fill: 'transparent' }, g);
      const show = (e) => {
        g.firstChild && g.firstChild.setAttribute('opacity', 0.78);
        const r2 = svg.getBoundingClientRect();
        showTip(e?.clientX ?? r2.left + (cx / W) * r2.width, e?.clientY ?? r2.top + (yTop / H) * r2.height, d.head || d.label, d.tip || [{ value: fmt(d.v) }]);
      };
      const hide = () => { g.firstChild && g.firstChild.removeAttribute('opacity'); hideTip(); };
      g.addEventListener('pointermove', show); g.addEventListener('pointerleave', hide);
      g.addEventListener('focus', () => show()); g.addEventListener('blur', hide);
      if ((i % every === 0 || i === data.length - 1) && d.label && !(i === data.length - 1 && i % every !== 0 && i % every < every / 2)) {
        el('text', { x: cx, y: H - 5, 'text-anchor': 'middle', class: 'axis' }, svg).textContent = d.label;
      }
    });
    for (const l of opts.limits || []) {
      el('line', { x1: m.l, x2: W - m.r, y1: y(l.v), y2: y(l.v), class: 'limit' }, svg);
      el('text', { x: W - m.r - 2, y: y(l.v) - 4, 'text-anchor': 'end', class: 'limit-label' }, svg).textContent = l.label;
    }
    container.appendChild(svg);
    if (opts.legend) {
      const lg = document.createElement('div'); lg.className = 'legend';
      for (const it of opts.legend) { const sp = document.createElement('span'); const i = document.createElement('i'); i.style.background = it.color; sp.append(i, document.createTextNode(it.label)); lg.appendChild(sp); }
      container.appendChild(lg);
    }
  }

  // Route sparkline: latency line + red/amber markers for failed checks
  function spark(container, checks, { width = 150, height = 30, limit } = {}) {
    container.replaceChildren();
    const W = width, H = height;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    if (!checks.length) { container.appendChild(svg); return; }
    const vals = checks.map((c) => c.ms ?? 0);
    const max = Math.max(limit || 0, ...vals, 1) * 1.1;
    const x = (i) => (checks.length === 1 ? W / 2 : (i / (checks.length - 1)) * (W - 6) + 3);
    const y = (v) => H - 3 - (v / max) * (H - 6);
    if (limit) el('line', { x1: 0, x2: W, y1: y(limit), y2: y(limit), stroke: css('--set'), 'stroke-width': 1, 'stroke-dasharray': '3 3', 'vector-effect': 'non-scaling-stroke', opacity: 0.7 }, svg);
    const d = checks.map((c, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(c.ms ?? 0).toFixed(1)}`).join('');
    el('path', { d, fill: 'none', stroke: css('--data'), 'stroke-width': 1.6, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' }, svg);
    checks.forEach((c, i) => {
      if (c.r === 'down' || c.r === 'mismatch') el('rect', { x: x(i) - 1.5, y: 1, width: 3, height: H - 2, rx: 1, fill: css(c.r === 'down' ? '--critical' : '--serious') }, svg);
      else if (c.r === 'degraded') el('circle', { cx: x(i), cy: y(c.ms ?? 0), r: 2.2, fill: css('--caution') }, svg);
    });
    container.appendChild(svg);
  }

  window.Charts = { line, bars, spark, showTip, hideTip, compact, niceMax, css };
})();
