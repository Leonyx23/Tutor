import { test } from 'node:test';
import assert from 'node:assert/strict';
import { W, H, normalizeElement, bboxOf, textLines, textWidth } from '../js/layout.js';
import { fitText, fitBox, obstacle, hits, placeTexty, planStep } from '../js/place.js';

let n = 0;
const N = (raw) => normalizeElement(raw, () => 'x' + (++n));
const inBoard = (b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= W && b.y + b.h <= H;
const TEXTY = new Set(['text', 'label', 'box', 'table']);
const textRect = (el) => bboxOf(el.k === 'label' ? { ...el, k: 'text' } : el);

// Prüft eine fertige Tafelseite: alles auf der Tafel, kein Text auf Text, kein Text auf Linien
function problems(els) {
  const out = [];
  els.forEach((a, i) => {
    if (!TEXTY.has(a.k)) return;
    const ra = textRect(a);
    if (!inBoard(ra)) out.push(`${a.id} ragt über den Rand ${JSON.stringify(ra)}`);
    els.forEach((b, j) => {
      if (i === j || b.k === 'mark') return;
      if (TEXTY.has(b.k) && j < i) {
        const rb = textRect(b);
        const w = Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x), h = Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y);
        if (w > 2 && h > 2) out.push(`${a.id} liegt auf ${b.id}`);
      } else if (!TEXTY.has(b.k) && hits(ra, obstacle(b), 0)) out.push(`${a.id} liegt auf Linie ${b.id} (${b.k})`);
    });
  });
  return out;
}

function runSteps(steps) {
  const pages = [[]];
  for (const raw of steps) {
    const els = raw.map(N).filter(Boolean);
    const r = planStep(els, pages[pages.length - 1]);
    if (r.newPage) pages.push([]);
    pages[pages.length - 1].push(...r.els);
  }
  return pages;
}

test('textWidth schätzt ohne Browser über die Zeichenzahl', () => {
  assert.ok(textWidth('abcd', 20) > 0);
  assert.ok(textWidth('abcdabcd', 20) > textWidth('abcd', 20));
});

test('fitText: langes Wort am rechten Rand bleibt auf der Tafel', () => {
  const el = fitText(N({ k: 'text', x: 660, y: 280, s: 'Riss im Anulus & Austritt von Nucleusmaterial', size: 28 }));
  const b = bboxOf(el);
  assert.ok(b.x + b.w <= W - 6, JSON.stringify(b));
  for (const l of textLines(el)) assert.ok(textWidth(l, el.size, el.bold) <= W - el.x);
});

test('fitText: Text am unteren Rand wird hochgeschoben', () => {
  const el = fitText(N({ k: 'text', x: 40, y: 590, s: 'eins zwei drei vier fünf sechs sieben acht neun zehn elf zwölf', size: 30, w: 200 }));
  const b = bboxOf(el);
  assert.ok(b.y + b.h <= H - 4, JSON.stringify(b));
});

test('fitBox: Text passt in den Kasten (Breite und Höhe)', () => {
  const el = fitBox(N({ k: 'box', x: 320, y: 500, w: 181, h: 64, s: 'Entlastung: Flüssigkeitsaufnahme', c: 'green' }));
  const lines = textLines({ k: 'text', s: el.s, size: el.size, w: el.w - 14, x: 0, a: 'start' });
  for (const l of lines) assert.ok(textWidth(l, el.size) <= el.w - 12, `${l} ${el.size}`);
  assert.ok(lines.length * el.size * 1.2 <= el.h - 4, `${lines.length} Zeilen bei ${el.size} in ${el.h}`);
});

test('hits: Kreislinie durch ein Rechteck, Rechteck ganz innen nicht', () => {
  const c = obstacle(N({ k: 'circle', x: 200, y: 380, rx: 120, ry: 80 }));
  assert.equal(hits({ x: 40, y: 280, w: 200, h: 34 }, c), true);
  assert.equal(hits({ x: 160, y: 365, w: 80, h: 30 }, c), false);
  assert.equal(hits({ x: 500, y: 100, w: 80, h: 30 }, c), false);
});

test('placeTexty: Beschriftung auf der Kreislinie wird ein Stück verschoben', () => {
  const circle = N({ k: 'circle', x: 200, y: 380, rx: 121, ry: 82 });
  const label = N({ k: 'label', x: 41, y: 300, s: 'Anulus fibrosus', to: [120, 340] });
  const moved = placeTexty(label, [obstacle(circle)]);
  assert.ok(moved);
  assert.equal(hits(textRect(moved), obstacle(circle)), false);
  assert.ok(Math.hypot(moved.x - label.x, moved.y - label.y) < 80);
  assert.deepEqual(moved.to, label.to);
});

test('placeTexty: Text ganz innerhalb eines Kreises bleibt, wo er ist', () => {
  const circle = N({ k: 'circle', x: 400, y: 300, r: 120 });
  const t = N({ k: 'text', x: 360, y: 310, s: 'Kern', size: 28 });
  assert.equal(placeTexty(t, [obstacle(circle)]).y, 310);
});

test('planStep: verschobener Kasten nimmt Pfeile mit, die an ihm hängen', () => {
  const page = [N({ k: 'text', x: 40, y: 150, s: 'Hier steht schon etwas langes', size: 30 })];
  const step = [N({ k: 'box', x: 40, y: 120, w: 220, h: 70, s: 'Kasten' }), N({ k: 'arrow', p: [260, 155, 400, 155] })];
  const r = planStep(step, page);
  const box = r.els[0], arrow = r.els[1];
  assert.equal(r.newPage, false);
  const dy = box.y - 120;
  assert.ok(dy !== 0);
  assert.equal(arrow.p[1], 155 + dy);
});

test('planStep: volle Seite -> neue Tafelseite', () => {
  const page = [N({ k: 'table', x: 20, y: 20, cols: ['a', 'b'], rows: Array.from({ length: 8 }, () => ['x', 'y']), cw: [380, 380], size: 30 })];
  const r = planStep([N({ k: 'box', x: 100, y: 200, w: 300, h: 120, s: 'Neuer Kasten' })], page);
  assert.equal(r.newPage, true);
  assert.ok(r.els[0].y < 200, 'auf der neuen Seite nach oben gerückt');
});

test('planStep: Skizze quer über vorhandenem Text -> neue Seite', () => {
  const page = [N({ k: 'box', x: 38, y: 199, w: 322, h: 122, s: 'Lumbal-Tests' })];
  const r = planStep([N({ k: 'circle', x: 249, y: 249, rx: 133, ry: 92 })], page);
  assert.equal(r.newPage, true);
});

test('planStep: Pfeile zwischen Kästen gelten nicht als Überlappung', () => {
  const page = [N({ k: 'box', x: 40, y: 100, w: 200, h: 80, s: 'A' }), N({ k: 'box', x: 320, y: 100, w: 200, h: 80, s: 'B' })];
  const r = planStep([N({ k: 'arrow', p: [240, 140, 320, 140] })], page);
  assert.equal(r.newPage, false);
});

test('Screenshot 1 (Bandscheibenpathologien): nachher nichts mehr übereinander oder über dem Rand', () => {
  const pages = runSteps([
    [{ k: 'text', x: 41, y: 53, s: 'Bandscheibenpathologien', size: 40, c: 'blue' },
      { k: 'box', x: 59, y: 99, w: 322, h: 122, s: 'Protrusion:\nVorwölbung\nAnulus fibrosus intakt', c: 'orange' },
      { k: 'box', x: 418, y: 99, w: 323, h: 122, s: 'Prolaps (BSV):\nGewebeaustritt\nAnulus fibrosus zerrissen', c: 'red' }],
    [{ k: 'circle', x: 200, y: 379, rx: 121, ry: 82 },
      { k: 'circle', x: 200, y: 380, rx: 51, ry: 36, c: 'blue', fill: true },
      { k: 'label', x: 41, y: 300, s: 'Anulus fibrosus', to: [120, 341] },
      { k: 'label', x: 41, y: 441, s: 'Nucleus pulposus', to: [170, 375] }],
    [{ k: 'circle', x: 600, y: 379, rx: 120, ry: 80 },
      { k: 'curve', p: [[590, 390], [590, 349], [640, 337], [678, 342], [640, 385]], c: 'red', closed: true },
      { k: 'label', x: 660, y: 278, s: 'Riss im Anulus & Austritt von Nucleusmaterial', to: [650, 350] }],
    [{ k: 'box', x: 59, y: 500, w: 183, h: 64, s: 'Belastung: Auspressen', c: 'orange' },
      { k: 'arrow', p: [249, 531, 311, 531] },
      { k: 'box', x: 320, y: 500, w: 181, h: 64, s: 'Entlastung: Flüssigkeitsaufnahme', c: 'green' },
      { k: 'arrow', p: [510, 531, 572, 531] },
      { k: 'box', x: 579, y: 500, w: 163, h: 64, s: 'Diffusion / Ernährungszyklus', c: 'blue' }],
  ]);
  for (const p of pages) assert.deepEqual(problems(p), []);
});

test('Screenshot 2 (Lokalisierung): nachher nichts mehr übereinander oder über dem Rand', () => {
  const pages = runSteps([
    [{ k: 'text', x: 40, y: 49, s: 'Lokalisierung & Nervenreizung', size: 40, c: 'blue' }],
    [{ k: 'circle', x: 249, y: 249, rx: 133, ry: 92 },
      { k: 'curve', p: [[239, 200], [300, 191], [356, 195], [320, 240], [239, 253]], c: 'red', closed: true },
      { k: 'label', x: 440, y: 120, s: 'Spinalnervenkompression (radikulärer Schmerz)', to: [330, 170], c: 'orange' }],
    [{ k: 'box', x: 38, y: 199, w: 322, h: 122, s: 'Lumbal-Tests:\n- Straight Leg Raise (Lasègue)\n- Slump-Test\n- PNF / Bragard', c: 'purple' },
      { k: 'box', x: 418, y: 199, w: 322, h: 122, s: 'Zervikal-Tests:\n- Spurling-Test\n- ULNT (Upper Limb Neurodynamic Test)', c: 'purple' }],
    [{ k: 'table', x: 40, y: 380, cols: ['Segment', 'Kennmuskel', 'Funktion'], rows: [['L4 / L5', 'M. tibialis anterior', 'Fußhebung (Fersengang)'], ['L5 / S1', 'M. triceps surae', 'Fußsenkung (Zehengang)'], ['C5 / C6', 'M. biceps brachii', 'Ellenbogenflexion']], cw: [140, 240, 320] }],
  ]);
  for (const p of pages) assert.deepEqual(problems(p), []);
});

test('Silbentrennung bevorzugt die Fuge: Flüssigkeits-aufnahme', () => {
  assert.deepEqual(textLines({ k: 'text', s: 'Flüssigkeitsaufnahme', size: 28, w: 230, x: 0, a: 'start' }), ['Flüssigkeits-', 'aufnahme']);
  assert.deepEqual(textLines({ k: 'text', s: 'Flüssigkeitsaufnahme', size: 28, w: 290, x: 0, a: 'start' }), ['Flüssigkeits-', 'aufnahme']);
});

test('fitBox: Schrift nicht unter 18, stattdessen wird der Kasten höher', () => {
  const el = fitBox(N({ k: 'box', x: 320, y: 300, w: 181, h: 64, s: 'Entlastung: Flüssigkeitsaufnahme', size: 26 }));
  assert.ok(el.size >= 18, String(el.size));
  assert.ok(el.h > 64);
});

test('planStep: Schritt auf neuer Seite rückt nach oben', () => {
  const page = [N({ k: 'table', x: 20, y: 20, cols: ['a', 'b'], rows: Array.from({ length: 8 }, () => ['x', 'y']), cw: [380, 380], size: 30 })];
  const r = planStep([N({ k: 'table', x: 40, y: 380, cols: ['A', 'B'], rows: [['1', '2']], cw: [200, 200] }), N({ k: 'arrow', p: [100, 520, 300, 520] })], page);
  assert.equal(r.newPage, true);
  assert.ok(r.els[0].y <= 60, String(r.els[0].y));
  assert.equal(r.els[1].p[1], 520 - (380 - r.els[0].y));
});
