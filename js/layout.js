// Reine Hilfsfunktionen für die Tafel: Elemente prüfen, Flächen schätzen, Text umbrechen.
// Keine DOM-Abhängigkeit, damit alles in Node getestet werden kann.

export const W = 800;
export const H = 600;
export const CHAR = 0.55; // geschätzte Zeichenbreite relativ zur Schriftgröße

export const COLORS = ['ink', 'black', 'blue', 'red', 'green', 'orange', 'purple', 'gray', 'yellow', 'pink'];
const COLOR_ALIAS = {
  schwarz: 'black', blau: 'blue', rot: 'red', grün: 'green', gruen: 'green', orange: 'orange',
  lila: 'purple', violett: 'purple', violet: 'purple', grau: 'gray', grey: 'gray', gelb: 'yellow',
  rosa: 'pink', pen: 'ink', default: 'ink', dark: 'black', navy: 'ink',
};

const KINDS = new Set(['text', 'line', 'arrow', 'rect', 'box', 'circle', 'curve', 'poly', 'path', 'label',
  'mark', 'axes', 'table', 'ring', 'under', 'erase']);
const KIND_ALIAS = { ellipse: 'circle', polygon: 'poly', polyline: 'poly', note: 'text', highlight: 'mark',
  underline: 'under', circleit: 'ring', spline: 'curve', node: 'box', rectangle: 'rect', graph: 'axes' };

const num = (v, d) => { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? n : d; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const cx = (v) => clamp(num(v, NaN), 0, W);
const cy = (v) => clamp(num(v, NaN), 0, H);
const str = (v, max = 160) => (v == null ? '' : String(v)).slice(0, max);

function color(v, d = 'ink') {
  if (typeof v !== 'string') return d;
  const c = v.toLowerCase().trim();
  if (COLORS.includes(c)) return c;
  return COLOR_ALIAS[c] || d;
}

function fillOf(v, c) {
  if (v === true) return c;
  if (typeof v === 'string' && v.toLowerCase() !== 'none' && v !== '') return color(v, c);
  return null;
}

function points(p) {
  if (!Array.isArray(p)) return null;
  let pts = p;
  if (p.length && typeof p[0] === 'number') {
    pts = [];
    for (let i = 0; i + 1 < p.length; i += 2) pts.push([p[i], p[i + 1]]);
  }
  const out = [];
  for (const q of pts) {
    const x = Array.isArray(q) ? q[0] : q && q.x;
    const y = Array.isArray(q) ? q[1] : q && q.y;
    if (Number.isFinite(num(x, NaN)) && Number.isFinite(num(y, NaN))) out.push([cx(x), cy(y)]);
    if (out.length >= 80) break;
  }
  return out;
}

function seg(el) {
  // Linie/Pfeil: p = [x1,y1,x2,y2] oder x1,y1,x2,y2 oder from/to
  let p = el.p;
  if (!p && el.from && el.to) p = [...[].concat(el.from), ...[].concat(el.to)];
  if (!p && el.x1 != null) p = [el.x1, el.y1, el.x2, el.y2];
  const pts = points(p);
  if (!pts || pts.length < 2) return null;
  return [pts[0][0], pts[0][1], pts[pts.length - 1][0], pts[pts.length - 1][1]];
}

function lineWidth(el) {
  let lw = num(el.lw, NaN);
  if (!Number.isFinite(lw) && Number.isFinite(num(el.w, NaN)) && num(el.w, 0) <= 12) lw = num(el.w, 3);
  return clamp(Number.isFinite(lw) ? lw : 3, 1, 12);
}

export function normalizeElement(raw, nextId) {
  if (!raw || typeof raw !== 'object') return null;
  let k = String(raw.k || raw.kind || raw.type || '').toLowerCase();
  k = KIND_ALIAS[k] || k;
  if (!KINDS.has(k)) return null;
  const id = raw.id ? str(raw.id, 24).replace(/[^\w-]/g, '') || nextId() : nextId();
  const c = color(raw.c ?? raw.color, k === 'mark' ? 'yellow' : (k === 'ring' || k === 'under') ? 'red' : 'ink');
  const s = str(raw.s ?? raw.text ?? raw.label ?? '', 200);
  const el = { k, id, c };

  switch (k) {
    case 'text': case 'label': {
      const x = cx(raw.x), y = cy(raw.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !s) return null;
      Object.assign(el, { x, y, s, size: clamp(num(raw.size, 28), 16, 60) });
      const a = String(raw.a || raw.anchor || raw.align || 'start').toLowerCase();
      el.a = a === 'middle' || a === 'center' ? 'middle' : a === 'end' || a === 'right' ? 'end' : 'start';
      if (num(raw.w, 0) > 40) el.w = clamp(num(raw.w, 0), 40, W);
      if (raw.bold) el.bold = true;
      if (k === 'label') {
        const to = points([raw.to || raw.target || [raw.tx, raw.ty]]);
        if (to && to.length) el.to = to[0];
      }
      return el;
    }
    case 'line': case 'arrow': {
      const p = seg(raw);
      if (!p) return null;
      Object.assign(el, { p, lw: lineWidth(raw) });
      if (raw.dash) el.dash = true;
      const bend = num(raw.bend, 0);
      if (bend) el.bend = clamp(bend, -300, 300);
      if (k === 'arrow' && (raw.both || raw.two)) el.both = true;
      return el;
    }
    case 'rect': case 'mark': case 'box': case 'axes': {
      const x = cx(raw.x), y = cy(raw.y), w = clamp(num(raw.w ?? raw.width, NaN), 2, W), h = clamp(num(raw.h ?? raw.height, NaN), 2, H);
      if (![x, y, w, h].every(Number.isFinite)) return null;
      Object.assign(el, { x, y, w, h });
      if (k === 'rect' || k === 'box') { const f = fillOf(raw.fill, c); if (f) el.fill = f; }
      if (k === 'box') { el.s = s; el.size = clamp(num(raw.size, 26), 14, 48); }
      if (k === 'rect' && raw.dash) el.dash = true;
      if (k === 'axes') { el.xl = str(raw.xl ?? raw.xlabel, 40); el.yl = str(raw.yl ?? raw.ylabel, 40); }
      return el;
    }
    case 'circle': {
      const x = cx(raw.x ?? raw.cx), y = cy(raw.y ?? raw.cy);
      const r = num(raw.r, NaN);
      const rx = clamp(num(raw.rx, r), 2, W), ry = clamp(num(raw.ry, r), 2, H);
      if (![x, y, rx, ry].every(Number.isFinite)) return null;
      Object.assign(el, { x, y, rx, ry });
      const f = fillOf(raw.fill, c); if (f) el.fill = f;
      if (raw.dash) el.dash = true;
      return el;
    }
    case 'curve': case 'poly': {
      const p = points(raw.p ?? raw.points ?? raw.pts);
      if (!p || p.length < 2) return null;
      Object.assign(el, { p, lw: lineWidth(raw) });
      if (raw.closed || raw.close) el.closed = true;
      const f = fillOf(raw.fill, c); if (f) { el.fill = f; el.closed = true; }
      if (raw.dash) el.dash = true;
      if (k === 'curve' && raw.arrow) el.arrow = true;
      return el;
    }
    case 'path': {
      const d = String(raw.d || '').slice(0, 4000);
      if (!/^[MmLlHhVvCcSsQqTtAaZz0-9\s.,eE+-]+$/.test(d) || !/^\s*[Mm]/.test(d)) return null;
      Object.assign(el, { d, lw: lineWidth(raw) });
      const f = fillOf(raw.fill, c); if (f) el.fill = f;
      if (raw.dash) el.dash = true;
      return el;
    }
    case 'table': {
      const x = cx(raw.x), y = cy(raw.y);
      const cols = Array.isArray(raw.cols) ? raw.cols.slice(0, 5).map((v) => str(v, 40)) : [];
      const rows = Array.isArray(raw.rows) ? raw.rows.slice(0, 8).map((r) => (Array.isArray(r) ? r : [r]).slice(0, 5).map((v) => str(v, 60))) : [];
      if (!Number.isFinite(x) || !Number.isFinite(y) || (!cols.length && !rows.length)) return null;
      const n = Math.max(cols.length, ...rows.map((r) => r.length));
      const size = clamp(num(raw.size, 23), 14, 36);
      let cw = Array.isArray(raw.cw) ? raw.cw.slice(0, n).map((v) => clamp(num(v, 150), 40, W)) : [];
      while (cw.length < n) cw.push(Math.min(220, Math.max(90, (W - 20 - x) / n)));
      Object.assign(el, { x, y, cols, rows, cw, size });
      return el;
    }
    case 'ring': case 'under': {
      if (raw.of) { el.of = str(raw.of, 24).replace(/[^\w-]/g, ''); return el; }
      const x = cx(raw.x), y = cy(raw.y), w = num(raw.w, NaN), h = num(raw.h, NaN);
      if (![x, y, w, h].every(Number.isFinite)) return null;
      Object.assign(el, { x, y, w: clamp(w, 4, W), h: clamp(h, 4, H) });
      return el;
    }
    case 'erase': {
      const ids = [].concat(raw.ids ?? raw.of ?? []).map((v) => str(v, 24)).filter(Boolean);
      if (!ids.length) return null;
      el.ids = ids;
      return el;
    }
  }
  return null;
}

// Textbreite: im Browser echt gemessen (setMeasure), sonst über die Zeichenzahl geschätzt
let measureFn = null;
export function setMeasure(fn) { measureFn = fn; }
export function textWidth(s, size, bold = false) {
  if (!s) return 0;
  if (measureFn) { const w = measureFn(s, size, bold); if (Number.isFinite(w) && w > 0) return w; }
  return s.length * size * CHAR * (bold ? 1.06 : 1);
}

// Zu lange Wörter trennen (bevorzugt nach Fugen-s oder vor einem Bindestrich)
function breakWord(word, size, maxW, bold) {
  const parts = [];
  let rest = word;
  while (rest && textWidth(rest, size, bold) > maxW && rest.length > 3) {
    let k = rest.length - 1;
    while (k > 2 && textWidth(rest.slice(0, k) + '-', size, bold) > maxW) k--;
    let cut = k;
    // Fuge suchen: nach Bindestrich oder Fugen-s, aber nicht zu weit vorn (mind. 40 % der möglichen Länge)
    for (let j = k; j >= Math.max(3, Math.floor(k * 0.4)); j--) {
      if (rest[j - 1] === '-' || (rest[j - 1] === 's' && j < rest.length - 2 && /[a-zäöüß]/.test(rest[j] || ''))) { cut = j; break; }
    }
    const head = rest.slice(0, cut);
    parts.push(head.endsWith('-') ? head : head + '-');
    rest = rest.slice(cut);
  }
  if (rest) parts.push(rest);
  return parts;
}

export function wrapText(s, size, maxW, bold = false) {
  const out = [];
  for (const para of String(s).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean).flatMap((w) => (textWidth(w, size, bold) > maxW ? breakWord(w, size, maxW, bold) : [w]));
    let line = '';
    for (const w of words) {
      if (!line) line = w;
      else if (textWidth(line + ' ' + w, size, bold) <= maxW) line += ' ' + w;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}

export const boxLines = (el) => wrapText(el.s || '', el.size, el.w - 14, false);

// Tabelle: Zeilenumbruch je Zelle und Zeilenhöhen (gleich für Zeichnen und Platzberechnung)
export function tableLayout(el) {
  const pad = 8, lh = el.size * 1.2;
  const rows = [...(el.cols.length ? [el.cols] : []), ...el.rows];
  const cells = rows.map((row, ri) => el.cw.map((w, ci) => wrapText(row[ci] || '', el.size, w - 2 * pad, ri === 0 && el.cols.length > 0)));
  const heights = cells.map((r) => Math.max(1, ...r.map((c) => c.length)) * lh + el.size * 0.7);
  return { rows, cells, heights, pad, lh, height: heights.reduce((a, b) => a + b, 0), width: el.cw.reduce((a, b) => a + b, 0) };
}

export function textMaxWidth(el) {
  if (el.w) return el.w;
  const room = el.a === 'middle' ? 2 * Math.min(el.x, W - el.x) : el.a === 'end' ? el.x : W - el.x;
  return Math.max(120, room - 14);
}

export function textLines(el) {
  return wrapText(el.s, el.size, textMaxWidth(el), el.bold);
}

export function textBox(el) {
  const lines = textLines(el);
  const w = Math.max(...lines.map((l) => textWidth(l, el.size, el.bold)));
  const h = lines.length * el.size * 1.2;
  const x = el.a === 'middle' ? el.x - w / 2 : el.a === 'end' ? el.x - w : el.x;
  return { x, y: el.y - el.size * 0.85, w, h };
}

function ptsBox(pts) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function bboxOf(el) {
  switch (el.k) {
    case 'text': return textBox(el);
    case 'label': {
      const b = textBox(el);
      return el.to ? ptsBox([[b.x, b.y], [b.x + b.w, b.y + b.h], el.to]) : b;
    }
    case 'circle': {
      const rx = el.rx ?? el.r, ry = el.ry ?? el.r;
      return { x: el.x - rx, y: el.y - ry, w: 2 * rx, h: 2 * ry };
    }
    case 'line': case 'arrow': {
      const b = ptsBox([[el.p[0], el.p[1]], [el.p[2], el.p[3]]]);
      if (el.bend) { const e = Math.abs(el.bend) / 2; return { x: b.x - e, y: b.y - e, w: b.w + 2 * e, h: b.h + 2 * e }; }
      return b;
    }
    case 'curve': case 'poly': return ptsBox(el.p);
    case 'path': {
      const nums = (el.d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
      const pts = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
      return pts.length ? ptsBox(pts) : { x: 0, y: 0, w: 0, h: 0 };
    }
    case 'table': {
      const t = tableLayout(el);
      return { x: el.x, y: el.y, w: t.width, h: t.height };
    }
    default:
      if (Number.isFinite(el.x) && Number.isFinite(el.w)) return { x: el.x, y: el.y, w: el.w, h: el.h };
      return null;
  }
}

export function describeBoard(elements) {
  const lines = [];
  let bottom = 0;
  for (const el of elements) {
    const b = bboxOf(el);
    if (b) bottom = Math.max(bottom, b.y + b.h);
    const t = el.s ? ` "${el.s.slice(0, 50)}"` : el.cols ? ` Tabelle ${el.cols.join('/')}` : '';
    const box = b ? ` @[${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}]` : '';
    lines.push(`${el.id} ${el.k}${t}${box}`);
  }
  if (!lines.length) return 'Die Tafelseite ist leer.';
  const free = bottom < H - 60 ? ` Frei ist etwa der Bereich unterhalb von y=${Math.ceil(bottom + 10)}.` : ' Die Seite ist ziemlich voll.';
  return lines.join('\n') + '\n' + free.trim();
}
