import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrapText, normalizeElement, bboxOf, avoidOverlap, describeBoard, W, H } from '../js/layout.js';

test('Tafel ist 800 × 600 Einheiten groß', () => {
  assert.equal(W, 800); assert.equal(H, 600);
});

test('wrapText bricht an Wortgrenzen, wenn die Zeile zu breit wird', () => {
  const lines = wrapText('Musculus biceps brachii beugt den Ellenbogen', 28, 300);
  assert.ok(lines.length >= 2);
  for (const l of lines) assert.ok(l.length * 28 * 0.55 <= 300 || !l.includes(' '));
  assert.equal(lines.join(' '), 'Musculus biceps brachii beugt den Ellenbogen');
});

test('wrapText hält Zeilenumbrüche aus dem Text ein', () => {
  assert.deepEqual(wrapText('a\nb', 28, 500), ['a', 'b']);
});

test('normalizeElement verwirft unbekannte Arten und Elemente ohne Koordinaten', () => {
  let n = 0; const id = () => 'e' + (++n);
  assert.equal(normalizeElement({ k: 'rakete', x: 1, y: 2 }, id), null);
  assert.equal(normalizeElement({ k: 'text', s: 'ohne Ort' }, id), null);
  assert.equal(normalizeElement(null, id), null);
});

test('normalizeElement ergänzt id, setzt Standardfarbe und begrenzt Werte', () => {
  let n = 0; const id = () => 'e' + (++n);
  const el = normalizeElement({ k: 'text', x: '100', y: 9999, s: 'Herz', size: 300, c: 'türkis' }, id);
  assert.equal(el.id, 'e1');
  assert.equal(el.x, 100);
  assert.ok(el.y <= H);
  assert.ok(el.size <= 60);
  assert.equal(el.c, 'ink');
});

test('normalizeElement akzeptiert type statt k und text statt s', () => {
  const el = normalizeElement({ type: 'text', x: 10, y: 40, text: 'A' }, () => 'z');
  assert.equal(el.k, 'text'); assert.equal(el.s, 'A');
});

test('normalizeElement nimmt Punktlisten für curve an und verwirft sie mit weniger als 2 Punkten', () => {
  const ok = normalizeElement({ k: 'curve', p: [[0, 0], [10, 10], [20, 0]] }, () => 'c');
  assert.equal(ok.p.length, 3);
  assert.equal(normalizeElement({ k: 'curve', p: [[0, 0]] }, () => 'c'), null);
});

test('normalizeElement akzeptiert Pfeile mit p als flacher Liste', () => {
  const a = normalizeElement({ k: 'arrow', p: [10, 20, 300, 40], c: 'red' }, () => 'a');
  assert.deepEqual(a.p, [10, 20, 300, 40]); assert.equal(a.c, 'red');
});

test('bboxOf schätzt die Fläche eines mittig gesetzten Textes', () => {
  const b = bboxOf({ k: 'text', x: 400, y: 100, s: 'abcd', size: 40, a: 'middle' });
  assert.ok(b.x < 400 && b.x + b.w > 400);
  assert.ok(b.y < 100 && b.y + b.h >= 100);
});

test('bboxOf eines Kreises', () => {
  assert.deepEqual(bboxOf({ k: 'circle', x: 100, y: 100, r: 20 }), { x: 80, y: 80, w: 40, h: 40 });
});

test('avoidOverlap schiebt Text nach unten, wenn er auf anderem Text liegt', () => {
  const old = [{ x: 40, y: 60, w: 300, h: 40 }];
  const el = { k: 'text', x: 40, y: 90, s: 'Überlappt', size: 28 };
  const moved = avoidOverlap(el, old);
  assert.ok(moved.y > 90);
  const b = bboxOf(moved);
  assert.ok(b.y >= 100 - 1);
});

test('avoidOverlap lässt Text in Ruhe, der frei steht', () => {
  const el = { k: 'text', x: 40, y: 300, s: 'frei', size: 28 };
  assert.equal(avoidOverlap(el, [{ x: 40, y: 60, w: 300, h: 40 }]).y, 300);
});

test('describeBoard nennt ids, Art, Text und Fläche', () => {
  const d = describeBoard([{ id: 'e1', k: 'text', x: 40, y: 60, s: 'Herz', size: 28 }]);
  assert.match(d, /e1/); assert.match(d, /text/); assert.match(d, /Herz/);
});
