// Ordnet die Tafel-Elemente eines Schritts so an, dass nichts übereinander oder über den Rand geschrieben wird.
// Text, Kästen und Tabellen werden angepasst und notfalls verschoben; Skizzen bleiben, wo das Modell sie hinsetzt.
// Passt ein Schritt nicht mehr auf die Seite, kommt er auf eine neue Seite.
import { W, H, bboxOf, textBox, textWidth, textMaxWidth, wrapText, tableLayout } from './layout.js';

const MARGIN = 6;            // Abstand zum Tafelrand
const TEXTY = new Set(['text', 'label', 'box', 'table']);
const REFS = new Set(['ring', 'under', 'erase', 'mark']);
export const isTextK = (el) => TEXTY.has(el.k);
export const textRect = (el) => (el.k === 'label' ? textBox(el) : bboxOf(el));

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const inBoard = (b) => b.x >= MARGIN - 0.5 && b.y >= MARGIN - 0.5 && b.x + b.w <= W - MARGIN + 0.5 && b.y + b.h <= H - MARGIN + 0.5;
const grow = (r, m) => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });
const inside = (p, r) => p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h;

// ---------- Text an Platz anpassen ----------
export function fitText(el0) {
  if (el0.k !== 'text' && el0.k !== 'label') return el0;
  const el = { ...el0 };
  const words = () => el.s.split(/\s+/).filter(Boolean);
  const longest = () => Math.max(0, ...words().map((w) => textWidth(w, el.size, el.bold)));
  const natural = textWidth(el.s.replace(/\n/g, ' '), el.size, el.bold);
  if (!el.w) {
    const want = Math.max(longest(), Math.min(natural, 320));
    if (el.a === 'start' && W - MARGIN - el.x < want) el.x = Math.max(MARGIN, W - MARGIN - want);
    if (el.a === 'end' && el.x - MARGIN < want) el.x = Math.min(W - MARGIN, MARGIN + want);
    if (el.a === 'middle') { const half = Math.min(want, W - 2 * MARGIN) / 2; el.x = clamp(el.x, MARGIN + half, W - MARGIN - half); }
  } else {
    el.w = Math.min(el.w, W - 2 * MARGIN);
    if (el.a === 'start') el.x = Math.min(el.x, W - MARGIN - el.w);
  }
  const maxW = textMaxWidth(el);
  const lw = longest();
  if (lw > maxW) el.size = Math.max(16, Math.floor(el.size * maxW / lw));
  let b = textBox(el);
  if (b.y + b.h > H - MARGIN) el.y -= b.y + b.h - (H - MARGIN);
  b = textBox(el);
  if (b.y < MARGIN) el.y += MARGIN - b.y;
  return el;
}

export function fitBox(el0) {
  if (el0.k !== 'box') return el0;
  const el = { ...el0 };
  el.w = Math.min(el.w, W - 2 * MARGIN);
  el.x = clamp(el.x, MARGIN, W - MARGIN - el.w);
  const fits = (sz) => {
    const ls = wrapText(el.s || '', sz, el.w - 14);
    return ls.every((l) => textWidth(l, sz) <= el.w - 12) && ls.length * sz * 1.2 <= el.h - 6;
  };
  // erst bis 18 verkleinern, dann lieber den Kasten höher machen als die Schrift winzig
  while (el.size > 18 && !fits(el.size)) el.size -= 1;
  if (!fits(el.size)) {
    const n = wrapText(el.s || '', el.size, el.w - 14).length;
    el.h = Math.min(H - 2 * MARGIN, Math.ceil(n * el.size * 1.2 + 12));
  }
  el.y = clamp(el.y, MARGIN, H - MARGIN - el.h);
  return el;
}

export function fitTable(el0) {
  if (el0.k !== 'table') return el0;
  const el = { ...el0, cw: [...el0.cw] };
  let total = el.cw.reduce((a, b) => a + b, 0);
  if (el.x + total > W - MARGIN) {
    el.x = Math.max(MARGIN, W - MARGIN - total);
    total = el.cw.reduce((a, b) => a + b, 0);
    if (el.x + total > W - MARGIN) { const f = (W - MARGIN - el.x) / total; el.cw = el.cw.map((w) => Math.floor(w * f)); }
  }
  while (el.size > 14 && el.y + tableLayout(el).height > H - MARGIN) el.size -= 1;
  return el;
}

const fit = (el) => (el.k === 'box' ? fitBox(el) : el.k === 'table' ? fitTable(el) : fitText(el));

// ---------- Was ein Element auf der Tafel belegt ----------
function sampleSeg(a, b, out, step = 5) {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
  for (let i = 0; i <= n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
}
function sampleQuad(a, c, b, out) {
  const n = Math.max(4, Math.ceil((Math.hypot(c[0] - a[0], c[1] - a[1]) + Math.hypot(b[0] - c[0], b[1] - c[1])) / 5));
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
}
function bendCtrl(p, bend) {
  const [x1, y1, x2, y2] = p;
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  return [(x1 + x2) / 2 - ((y2 - y1) / len) * bend, (y1 + y2) / 2 + ((x2 - x1) / len) * bend];
}
function polyPts(pts, closed, out) {
  for (let i = 0; i + 1 < pts.length; i++) sampleSeg(pts[i], pts[i + 1], out);
  if (closed && pts.length > 2) sampleSeg(pts[pts.length - 1], pts[0], out);
}
function catmullPts(pts, closed, out) {
  const n = pts.length;
  if (n < 3) return polyPts(pts, closed, out);
  const P = (i) => (closed ? pts[(i + n) % n] : pts[clamp(i, 0, n - 1)]);
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const steps = Math.max(4, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 5));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((d) => 0.5 * ((2 * p1[d]) + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3)));
    }
  }
}
function labelLeader(el) {
  if (!el.to) return null;
  const b = textBox(el);
  const sx = el.to[0] < b.x ? b.x - 6 : el.to[0] > b.x + b.w ? b.x + b.w + 6 : clamp(el.to[0], b.x, b.x + b.w);
  const sy = el.to[1] < b.y ? b.y - 2 : el.to[1] > b.y + b.h ? b.y + b.h + 2 : b.y + b.h / 2;
  return [[sx, sy], el.to];
}

export function obstacle(el) {
  const pts = [];
  const solid = [];
  switch (el.k) {
    case 'text': case 'box': case 'table': solid.push(textRect(el)); break;
    case 'label': {
      solid.push(textBox(el));
      const l = labelLeader(el);
      if (l) { const tmp = []; sampleSeg(l[0], l[1], tmp); pts.push(...tmp.slice(2)); }
      break;
    }
    case 'circle': {
      const n = Math.max(36, Math.ceil((el.rx + el.ry) * Math.PI / 5));
      for (let i = 0; i < n; i++) { const t = (2 * Math.PI * i) / n; pts.push([el.x + el.rx * Math.cos(t), el.y + el.ry * Math.sin(t)]); }
      break;
    }
    case 'rect': polyPts([[el.x, el.y], [el.x + el.w, el.y], [el.x + el.w, el.y + el.h], [el.x, el.y + el.h]], true, pts); break;
    case 'line': case 'arrow': {
      const [x1, y1, x2, y2] = el.p;
      if (el.bend) sampleQuad([x1, y1], bendCtrl(el.p, el.bend), [x2, y2], pts); else sampleSeg([x1, y1], [x2, y2], pts);
      break;
    }
    case 'curve': catmullPts(el.p, el.closed, pts); break;
    case 'poly': polyPts(el.p, el.closed, pts); break;
    case 'path': {
      const nums = (el.d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
      const pp = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pp.push([nums[i], nums[i + 1]]);
      polyPts(pp, false, pts);
      break;
    }
    case 'axes': {
      sampleSeg([el.x, el.y + el.h], [el.x + el.w, el.y + el.h], pts);
      sampleSeg([el.x, el.y + el.h], [el.x, el.y], pts);
      if (el.xl) solid.push({ x: el.x + el.w - textWidth(el.xl, 22), y: el.y + el.h + 10, w: textWidth(el.xl, 22), h: 26 });
      if (el.yl) solid.push({ x: el.x + 10, y: el.y - 16, w: textWidth(el.yl, 22), h: 26 });
      break;
    }
    case 'ring': if (Number.isFinite(el.w)) for (let i = 0; i < 40; i++) { const t = (2 * Math.PI * i) / 40; pts.push([el.x + el.w / 2 + (el.w / 2 + 12) * Math.cos(t), el.y + el.h / 2 + (el.h / 2 + 8) * Math.sin(t)]); } break;
    case 'under': if (Number.isFinite(el.w)) sampleSeg([el.x, el.y + el.h + 4], [el.x + el.w, el.y + el.h + 4], pts); break;
    default: break;
  }
  return { id: el.id, solid, pts };
}

export function hits(rect, obs, margin = 3) {
  if (!obs) return false;
  const r = grow(rect, margin);
  for (const s of obs.solid || []) {
    const w = Math.min(r.x + r.w, s.x + s.w) - Math.max(r.x, s.x);
    const h = Math.min(r.y + r.h, s.y + s.h) - Math.max(r.y, s.y);
    if (w > 1 && h > 1) return true;
  }
  for (const p of obs.pts || []) if (inside(p, r)) return true;
  return false;
}

// ---------- Freien Platz suchen ----------
const DIRS = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]];
function shift(el, dx, dy) { return { ...el, x: el.x + dx, y: el.y + dy }; }

function nearestFree(el, obstacles, maxR) {
  const ok = (e) => { const b = textRect(e); return inBoard(b) && !obstacles.some((o) => hits(b, o)); };
  if (ok(el)) return { el, r: 0 };
  for (let r = 8; r <= maxR; r += 8) {
    for (const [dx, dy] of DIRS) {
      const c = shift(el, dx * r, dy * r);
      if (ok(c)) return { el: c, r };
    }
  }
  return null;
}

export function placeTexty(el, obstacles, { maxR = 240 } = {}) {
  const tries = [{ el, cost: 0 }];
  if (el.k === 'text' || el.k === 'label') {
    for (const f of [0.85, 0.72]) {
      const size = Math.round(el.size * f);
      if (size >= 18) tries.push({ el: fitText({ ...el, size }), cost: (1 - f) * 300 });
    }
  }
  let best = null;
  for (const t of tries) {
    const found = nearestFree(t.el, obstacles, maxR);
    if (found && (!best || found.r + t.cost < best.score)) best = { el: found.el, score: found.r + t.cost };
    if (found && found.r === 0 && t.cost === 0) break;
  }
  return best ? best.el : null;
}

// Pfeile/Beschriftungen, die an einem verschobenen Element hingen, mitziehen
function remap(el, moves) {
  if (!moves.length) return el;
  const mv = (x, y) => { for (const m of moves) if (inside([x, y], m.rect)) return [x + m.dx, y + m.dy]; return [x, y]; };
  if (el.k === 'line' || el.k === 'arrow') {
    const a = mv(el.p[0], el.p[1]), b = mv(el.p[2], el.p[3]);
    return { ...el, p: [a[0], a[1], b[0], b[1]] };
  }
  if (el.k === 'label' && el.to) return { ...el, to: mv(el.to[0], el.to[1]) };
  return el;
}

function crossesOldText(el, oldRects) {
  if (!oldRects.length) return false;
  let pts = obstacle(el).pts;
  if (el.k === 'line' || el.k === 'arrow') pts = pts.slice(Math.floor(pts.length * 0.1), Math.ceil(pts.length * 0.9));
  return pts.some((p) => oldRects.some((r) => inside(p, r)));
}

function plan(els, pageEls) {
  const page = pageEls.filter((e) => e.k !== 'mark');
  const oldRects = page.filter(isTextK).map((e) => grow(textRect(e), -6)).filter((r) => r.w > 0 && r.h > 0);
  const out = [];
  const moves = [];
  let failed = false;
  for (let el of els) {
    if (REFS.has(el.k)) { out.push(el); continue; }
    el = remap(el, moves);
    if (isTextK(el)) {
      const fitted = fit(el);
      const obs = [...page, ...out.filter((e) => e.k !== 'mark')].map(obstacle);
      const placed = placeTexty(fitted, obs);
      if (!placed) { failed = true; out.push(fitted); continue; }
      if (placed.x !== el.x || placed.y !== el.y) moves.push({ rect: grow(textRect(el), 14), dx: placed.x - el.x, dy: placed.y - el.y });
      out.push(placed);
    } else {
      if (crossesOldText(el, oldRects)) failed = true;
      out.push(el);
    }
  }
  // Zweiter Durchgang: Text dieses Schritts, auf den danach noch eine Skizze gezeichnet wurde, nochmal umsetzen
  for (let i = 0; i < out.length; i++) {
    const el = out[i];
    if (!isTextK(el)) continue;
    const obs = [...page, ...out.filter((e, j) => j !== i && e.k !== 'mark')].map(obstacle);
    if (!obs.some((o) => hits(textRect(el), o))) continue;
    const placed = placeTexty(el, obs);
    if (placed) out[i] = placed; else failed = true;
  }
  return { els: out, failed };
}

// Element verschieben (alle Arten)
export function translate(el, dx, dy) {
  const e = { ...el };
  if (Number.isFinite(e.x)) { e.x += dx; e.y += dy; }
  if (e.k === 'line' || e.k === 'arrow') e.p = [e.p[0] + dx, e.p[1] + dy, e.p[2] + dx, e.p[3] + dy];
  else if (Array.isArray(e.p)) e.p = e.p.map(([x, y]) => [x + dx, y + dy]);
  if (e.to) e.to = [e.to[0] + dx, e.to[1] + dy];
  if (e.k === 'path') {
    // nur absolute Befehle sicher verschiebbar; relative Pfade bleiben, wie sie sind
    if (!/[mlhvcsqtaz]/.test(e.d.replace(/e[-+]?\d/gi, ''))) {
      let i = 0;
      e.d = e.d.replace(/([A-Z])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/g, (m, cmd, num) => {
        if (cmd) { e._cmd = cmd; i = 0; return cmd; }
        const c = e._cmd; const v = parseFloat(num);
        let out = v;
        if (c === 'H') out = v + dx; else if (c === 'V') out = v + dy;
        else if (c === 'A') { const k = i % 7; out = k === 5 ? v + dx : k === 6 ? v + dy : v; }
        else out = i % 2 === 0 ? v + dx : v + dy;
        i++;
        return String(Math.round(out * 10) / 10);
      });
      delete e._cmd;
    }
  }
  return e;
}

function topOf(els) {
  let top = Infinity;
  for (const el of els) { const o = obstacle(el); for (const r of o.solid) top = Math.min(top, r.y); for (const p of o.pts) top = Math.min(top, p[1]); }
  return top;
}

export function planStep(els, pageEls) {
  const hasRefs = els.some((e) => REFS.has(e.k));
  const a = plan(els, pageEls);
  if (!a.failed || hasRefs || !pageEls.length) return { newPage: false, els: a.els };
  // Auf neuer Seite: Inhalt nach oben rücken, damit die Seite nicht oben leer bleibt
  const top = topOf(els);
  const dy = Number.isFinite(top) && top > 60 ? 30 - top : 0;
  const moved = dy ? els.map((e) => translate(e, 0, dy)) : els;
  return { newPage: true, els: plan(moved, []).els };
}
