// Die Tafel: SVG 800 × 600, mehrere Seiten, Elemente werden "von Hand" gezeichnet.
import { W, H, normalizeElement, avoidOverlap, bboxOf, isTexty, textLines, describeBoard, CHAR } from './layout.js';

const NS = 'http://www.w3.org/2000/svg';
const mk = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};
const r1 = (n) => Math.round(n * 10) / 10;

// ---------- kleine Animations-Maschine (rAF), jederzeit vorspulbar ----------
const active = new Set();
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
function tween(ms, fn) {
  return new Promise((res) => {
    const item = { fn, res, done: false };
    active.add(item);
    const t0 = performance.now();
    const step = (now) => {
      if (item.done) return;
      const t = Math.max(0, Math.min(1, (now - t0) / ms));
      fn(ease(t));
      if (t >= 1) { item.done = true; active.delete(item); res(); } else requestAnimationFrame(step);
    };
    fn(0);
    requestAnimationFrame(step);
  });
}
function finishAll() {
  for (const it of active) { it.done = true; try { it.fn(1); } catch { /* egal */ } it.res(); }
  active.clear();
}

// ---------- Handschrift-Geometrie ----------
function rng(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
function wobble(x1, y1, x2, y2, rnd, amt = 1) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const off = (rnd() - 0.5) * 2.4 * Math.min(1.6, len / 90) * amt;
  const mx = (x1 + x2) / 2 - ((y2 - y1) / len) * off, my = (y1 + y2) / 2 + ((x2 - x1) / len) * off;
  return `M${r1(x1)} ${r1(y1)} Q${r1(mx)} ${r1(my)} ${r1(x2)} ${r1(y2)}`;
}
function bentPath(x1, y1, x2, y2, bend) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const cx = (x1 + x2) / 2 - ((y2 - y1) / len) * bend, cy = (y1 + y2) / 2 + ((x2 - x1) / len) * bend;
  return { d: `M${r1(x1)} ${r1(y1)} Q${r1(cx)} ${r1(cy)} ${r1(x2)} ${r1(y2)}`, cx, cy };
}
function head(x2, y2, fromX, fromY, lw) {
  const a = Math.atan2(y2 - fromY, x2 - fromX), L = 11 + lw * 1.6, s = 0.5;
  const p1 = [x2 - L * Math.cos(a - s), y2 - L * Math.sin(a - s)], p2 = [x2 - L * Math.cos(a + s), y2 - L * Math.sin(a + s)];
  return `M${r1(p1[0])} ${r1(p1[1])} L${r1(x2)} ${r1(y2)} L${r1(p2[0])} ${r1(p2[1])}`;
}
function rectPath(x, y, w, h, rnd) {
  const o = 2.2;
  return [wobble(x - o, y, x + w + o, y, rnd), wobble(x + w, y - o, x + w, y + h + o, rnd),
    wobble(x + w + o, y + h, x - o, y + h, rnd), wobble(x, y + h + o, x, y - o, rnd)].join(' ');
}
function ellipsePath(cx, cy, rx, ry, rnd, over = 0.08) {
  // Stützpunkte mit leichter Unregelmäßigkeit, dann glatt verbunden (wie von Hand gezogen)
  const start = rnd() * Math.PI * 2, n = 14, end = Math.PI * 2 * (1 + over);
  const pts = [];
  const steps = over ? n + Math.ceil(n * over) : n;
  for (let i = 0; i < steps + (over ? 1 : 0); i++) {
    const t = start + (over ? (end * i) / (steps) : (Math.PI * 2 * i) / n);
    const k = 1 + (rnd() - 0.5) * 0.035 + (over ? 0.015 * (i / steps) : 0);
    pts.push([cx + rx * k * Math.cos(t), cy + ry * k * Math.sin(t)]);
  }
  return catmull(pts, !over);
}
function catmull(pts, closed) {
  const n = pts.length;
  if (n === 2) return `M${pts[0][0]} ${pts[0][1]} L${pts[1][0]} ${pts[1][1]}`;
  const P = (i) => closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))];
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${r1(c1[0])} ${r1(c1[1])} ${r1(c2[0])} ${r1(c2[1])} ${r1(p2[0])} ${r1(p2[1])}`;
  }
  return closed ? d + ' Z' : d;
}

export class Board {
  constructor(host, { onChange } = {}) {
    this.host = host;
    this.onChange = onChange || (() => {});
    this.speed = 1;
    this.svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, class: 'board-svg', role: 'img', 'aria-label': 'Tafel' }, host);
    const defs = mk('defs', {}, this.svg);
    const pat = mk('pattern', { id: 'kaestchen', width: 25, height: 25, patternUnits: 'userSpaceOnUse' }, defs);
    mk('path', { d: 'M25 0 L0 0 0 25', class: 'grid-line' }, pat);
    mk('rect', { x: 0, y: 0, width: W, height: H, class: 'paper' }, this.svg);
    mk('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#kaestchen)', class: 'grid' }, this.svg);
    this.layer = mk('g', {}, this.svg);
    this.clipN = 0;
    this.n = 0;
    this.reset();
  }

  reset() {
    finishAll();
    this.layer.replaceChildren();
    this.pages = [];
    this.cur = -1;
    this.newPage();
  }

  newPage() {
    const g = mk('g', { class: 'page' }, this.layer);
    const marks = mk('g', { class: 'marks' }, g);
    const ink = mk('g', { class: 'ink' }, g);
    this.pages.push({ g, marks, ink, els: [], nodes: new Map() });
    this.showPage(this.pages.length - 1);
    return this.cur;
  }

  showPage(i) {
    if (i < 0 || i >= this.pages.length) return;
    this.cur = i;
    this.pages.forEach((p, j) => p.g.toggleAttribute('hidden', j !== i));
    this.onChange(this.cur, this.pages.length);
  }

  get page() { return this.pages[this.cur]; }
  isEmpty(i = this.cur) { return !this.pages[i] || this.pages[i].els.length === 0; }
  describe() { return describeBoard(this.page.els); }
  snapshot() { return this.pages.map((p) => p.els.map((e) => ({ ...e }))); }
  skip() { this.skipping = true; finishAll(); }

  load(pages) {
    this.reset();
    (pages || []).forEach((els, i) => {
      if (i > 0) this.newPage();
      for (const el of els) this.render(el, false);
    });
    this.showPage(Math.max(0, this.pages.length - 1));
  }

  nextId() { return 'e' + (++this.n); }

  // Zeichnet rohe Elemente (vom Modell) nacheinander. Gibt die geprüften Elemente zurück.
  async draw(raw, { animate = true } = {}) {
    this.skipping = false;
    const out = [];
    for (const r of raw || []) {
      const el0 = normalizeElement(r, () => this.nextId());
      if (!el0) continue;
      const pg = this.page;
      if (el0.k === 'erase') { this.erase(el0.ids); continue; }
      // gleiche id auf dieser Seite: das alte Element bekommt eine neue id
      if (pg.nodes.has(el0.id)) {
        const old = pg.els.find((e) => e.id === el0.id);
        const nid = this.nextId();
        if (old) old.id = nid;
        pg.nodes.set(nid, pg.nodes.get(el0.id));
        pg.nodes.delete(el0.id);
      }
      const boxes = pg.els.filter(isTexty).map(bboxOf).filter(Boolean);
      let el = avoidOverlap(el0, boxes);
      if (el.k === 'ring' || el.k === 'under') {
        el = this.resolveRef(el);
        if (!el) continue;
      }
      out.push(el);
      await this.render(el, animate && !this.skipping);
    }
    return out;
  }

  resolveRef(el) {
    if (el.of) {
      const t = this.page.els.find((e) => e.id === el.of);
      const b = t && bboxOf(t);
      if (!b) return null;
      const { of, ...rest } = el;
      return { ...rest, x: b.x, y: b.y, w: b.w, h: b.h };
    }
    return el;
  }

  erase(ids) {
    const pg = this.page;
    for (const id of ids) {
      const node = pg.nodes.get(id);
      if (node) {
        node.style.transition = 'opacity .35s';
        node.style.opacity = '0';
        setTimeout(() => node.remove(), 380);
        pg.nodes.delete(id);
      }
      pg.els = pg.els.filter((e) => e.id !== id);
    }
  }

  // ---------- Rendern ----------
  async render(el, animate) {
    const pg = this.page;
    const g = mk('g', { class: `el k-${el.k} c-${el.c}`, 'data-id': el.id }, el.k === 'mark' ? pg.marks : pg.ink);
    pg.nodes.set(el.id, g);
    pg.els.push(el);
    const rnd = rng(el.id + el.k);
    const strokes = []; // [{node, len}]
    const texts = [];   // <text> nodes
    const fills = [];
    const stroke = (d, lw = el.lw || 3, extra = {}) => {
      const p = mk('path', { d, class: 's', 'stroke-width': lw, ...extra }, g);
      if (el.dash) p.setAttribute('stroke-dasharray', `${lw * 3} ${lw * 2.6}`);
      strokes.push(p);
      return p;
    };
    const fill = (d) => { const p = mk('path', { d, class: 'f' }, g); fills.push(p); return p; };
    const text = (x, y, s, size, anchor = 'start', cls = '') => {
      const t = mk('text', { x: r1(x), y: r1(y), 'font-size': size, 'text-anchor': anchor, class: 't ' + cls }, g);
      t.textContent = s;
      texts.push(t);
      return t;
    };

    switch (el.k) {
      case 'text': {
        textLines(el).forEach((line, i) => text(el.x, el.y + i * el.size * 1.2, line, el.size, el.a, el.bold ? 'b' : ''));
        break;
      }
      case 'label': {
        const lines = textLines(el);
        lines.forEach((line, i) => text(el.x, el.y + i * el.size * 1.2, line, el.size, el.a));
        if (el.to) {
          const b = bboxOf({ ...el, k: 'text' });
          const sx = Math.max(b.x, Math.min(el.to[0], b.x + b.w)), sy = el.to[1] < b.y ? b.y - 2 : el.to[1] > b.y + b.h ? b.y + b.h + 2 : b.y + b.h / 2;
          const sx2 = el.to[0] < b.x ? b.x - 6 : el.to[0] > b.x + b.w ? b.x + b.w + 6 : sx;
          stroke(wobble(sx2, sy, el.to[0], el.to[1], rnd, 0.6), 2);
          stroke(ellipsePath(el.to[0], el.to[1], 2.6, 2.6, rnd, 0), 2.6);
        }
        break;
      }
      case 'line': {
        const [x1, y1, x2, y2] = el.p;
        stroke(el.bend ? bentPath(x1, y1, x2, y2, el.bend).d : wobble(x1, y1, x2, y2, rnd));
        break;
      }
      case 'arrow': {
        const [x1, y1, x2, y2] = el.p;
        let fx = x1, fy = y1, bx = x2, by = y2;
        if (el.bend) { const b = bentPath(x1, y1, x2, y2, el.bend); stroke(b.d); fx = b.cx; fy = b.cy; bx = b.cx; by = b.cy; }
        else stroke(wobble(x1, y1, x2, y2, rnd));
        stroke(head(x2, y2, fx, fy, el.lw));
        if (el.both) stroke(head(x1, y1, bx, by, el.lw));
        break;
      }
      case 'rect': {
        if (el.fill) fill(`M${el.x} ${el.y}h${el.w}v${el.h}h${-el.w}Z`);
        stroke(rectPath(el.x, el.y, el.w, el.h, rnd));
        break;
      }
      case 'box': {
        if (el.fill) fill(`M${el.x} ${el.y}h${el.w}v${el.h}h${-el.w}Z`);
        stroke(rectPath(el.x, el.y, el.w, el.h, rnd), 2.6);
        if (el.s) {
          let size = el.size;
          let lines = textLines({ k: 'text', s: el.s, size, w: el.w - 14, x: 0, a: 'start' });
          while (size > 14 && lines.length * size * 1.2 > el.h - 8) { size -= 2; lines = textLines({ k: 'text', s: el.s, size, w: el.w - 14, x: 0, a: 'start' }); }
          const top = el.y + el.h / 2 - (lines.length * size * 1.2) / 2 + size * 0.88;
          lines.forEach((line, i) => text(el.x + el.w / 2, top + i * size * 1.2, line, size, 'middle'));
        }
        break;
      }
      case 'circle': {
        if (el.fill) fill(ellipsePath(el.x, el.y, el.rx, el.ry, rng(el.id), 0));
        stroke(ellipsePath(el.x, el.y, el.rx, el.ry, rnd, 0.04));
        break;
      }
      case 'curve': case 'poly': {
        const d = el.k === 'curve' ? catmull(el.p, el.closed) : 'M' + el.p.map((p) => p.join(' ')).join(' L') + (el.closed ? ' Z' : '');
        if (el.fill) fill(d);
        stroke(d);
        if (el.arrow && el.p.length >= 2) {
          const a = el.p[el.p.length - 2], b = el.p[el.p.length - 1];
          stroke(head(b[0], b[1], a[0], a[1], el.lw));
        }
        break;
      }
      case 'path': {
        if (el.fill) fill(el.d);
        stroke(el.d);
        break;
      }
      case 'axes': {
        const ox = el.x, oy = el.y + el.h;
        stroke(wobble(ox, oy, el.x + el.w, oy, rnd, 0.5), 2.6); stroke(head(el.x + el.w, oy, ox, oy, 2.6), 2.6);
        stroke(wobble(ox, oy, ox, el.y, rnd, 0.5), 2.6); stroke(head(ox, el.y, ox, oy, 2.6), 2.6);
        if (el.xl) text(el.x + el.w, oy + 30, el.xl, 22, 'end');
        if (el.yl) text(ox + 10, el.y + 4, el.yl, 22, 'start');
        break;
      }
      case 'table': {
        const size = el.size, pad = 8, lh = size * 1.2;
        const rows = [...(el.cols.length ? [el.cols] : []), ...el.rows];
        let y = el.y;
        const total = el.cw.reduce((a, b) => a + b, 0);
        const rowYs = [y];
        rows.forEach((row, ri) => {
          const cells = el.cw.map((w, ci) => textLines({ k: 'text', s: row[ci] || '', size, w: w - 2 * pad, x: 0, a: 'start' }));
          const rh = Math.max(1, ...cells.map((c) => c.length)) * lh + size * 0.7;
          let x = el.x;
          cells.forEach((lines, ci) => {
            lines.forEach((line, li) => line && text(x + pad, y + size * 0.95 + pad * 0.5 + li * lh, line, size, 'start', ri === 0 && el.cols.length ? 'b' : ''));
            x += el.cw[ci];
          });
          y += rh; rowYs.push(y);
        });
        rowYs.forEach((yy, i) => stroke(wobble(el.x, yy, el.x + total, yy, rnd, 0.4), i === 1 && el.cols.length ? 2.6 : 1.6));
        let x = el.x;
        for (let i = 0; i <= el.cw.length; i++) { stroke(wobble(x, el.y, x, y, rnd, 0.4), 1.6); x += el.cw[i] || 0; }
        el.h = y - el.y;
        break;
      }
      case 'mark': {
        const p = mk('rect', { x: el.x - 3, y: el.y, width: el.w + 6, height: el.h, rx: 6, class: 'hl' }, g);
        fills.push(p);
        if (animate) {
          const id = 'clip' + (++this.clipN);
          const cp = mk('clipPath', { id }, g);
          const cr = mk('rect', { x: el.x - 4, y: el.y - 2, width: 0, height: el.h + 4 }, cp);
          p.setAttribute('clip-path', `url(#${id})`);
          await tween(Math.min(900, 200 + el.w * 1.2) / this.speed, (t) => cr.setAttribute('width', (el.w + 8) * t));
          p.removeAttribute('clip-path'); cp.remove();
        }
        return;
      }
      case 'ring': {
        const pad = 8;
        stroke(ellipsePath(el.x + el.w / 2, el.y + el.h / 2, el.w / 2 + pad + 4, el.h / 2 + pad, rnd, 0.12), 2.6);
        break;
      }
      case 'under': {
        stroke(wobble(el.x - 4, el.y + el.h + 5, el.x + el.w + 4, el.y + el.h + 3, rnd, 1.4), 3);
        break;
      }
    }
    if (!animate) return;
    await this.animate(strokes, texts, fills);
  }

  async animate(strokes, texts, fills) {
    for (const f of fills) f.style.opacity = '0';
    const seq = [];
    // Reihenfolge: Linien zuerst, dann Text (wie an der Tafel: Kasten, dann Beschriftung)
    for (const p of strokes) {
      let len = 0;
      try { len = p.getTotalLength(); } catch { len = 0; }
      if (!len) continue;
      const dashed = p.getAttribute('stroke-dasharray');
      p.style.strokeDasharray = `${len} ${len}`;
      p.style.strokeDashoffset = len;
      seq.push(async () => {
        if (this.skipping) { p.style.strokeDashoffset = 0; return; }
        await tween(Math.max(140, Math.min(1300, len * 1.5)) / this.speed, (t) => { p.style.strokeDashoffset = len * (1 - t); });
        if (dashed) { p.style.strokeDasharray = ''; p.style.strokeDashoffset = ''; }
        else p.style.strokeDasharray = 'none';
      });
    }
    for (const t of texts) {
      t.style.visibility = 'hidden';
      seq.push(async () => {
        t.style.visibility = '';
        if (this.skipping) return;
        let bb; try { bb = t.getBBox(); } catch { bb = null; }
        if (!bb || !bb.width) return;
        const id = 'clip' + (++this.clipN);
        const cp = mk('clipPath', { id }, t.parentNode);
        const cr = mk('rect', { x: bb.x - 2, y: bb.y - 4, width: 0, height: bb.height + 8 }, cp);
        t.setAttribute('clip-path', `url(#${id})`);
        const chars = (t.textContent || '').length;
        await tween(Math.max(180, Math.min(1700, chars * 42)) / this.speed, (k) => cr.setAttribute('width', (bb.width + 4) * k));
        t.removeAttribute('clip-path'); cp.remove();
      });
    }
    for (const fn of seq) await fn();
    for (const f of fills) { f.style.transition = 'opacity .4s'; f.style.opacity = ''; }
  }
}

export { finishAll, CHAR };
