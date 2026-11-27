import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObjectStream } from '../js/stream.js';

function feed(chunks) {
  const s = new ObjectStream();
  const out = [];
  for (const c of chunks) out.push(...s.push(c));
  out.push(...s.end());
  return out;
}

test('liefert ein Objekt, sobald es vollständig ist, auch über Chunk-Grenzen', () => {
  const s = new ObjectStream();
  assert.deepEqual(s.push('{"t":"me'), []);
  assert.deepEqual(s.push('ta","title":"Herz"}\n{"t":'), [{ t: 'meta', title: 'Herz' }]);
  assert.deepEqual(s.push('"end"}'), [{ t: 'end' }]);
});

test('ignoriert Markdown-Zäune und Text zwischen den Objekten', () => {
  const out = feed(['Hier ist die Lektion:\n```json\n{"t":"step","say":"Hallo"}\n```\nFertig.']);
  assert.deepEqual(out, [{ t: 'step', say: 'Hallo' }]);
});

test('Klammern und Anführungszeichen in Strings stören nicht', () => {
  const out = feed(['{"t":"step","say":"Er sagt \\"{ja}\\" und }","draw":[{"k":"text","s":"a{b"}]}']);
  assert.equal(out.length, 1);
  assert.equal(out[0].say, 'Er sagt "{ja}" und }');
  assert.equal(out[0].draw[0].s, 'a{b');
});

test('überspringt Denk-Blöcke <think>…</think>', () => {
  const out = feed(['<think>Ich plane {"t":"falsch"} erst', ' mal</think>{"t":"end"}']);
  assert.deepEqual(out, [{ t: 'end' }]);
});

test('ein kaputtes Objekt wird übersprungen, die nächsten kommen trotzdem', () => {
  const out = feed(['{"t":"step" "say":"x"}\n{"t":"end"}']);
  assert.deepEqual(out, [{ t: 'end' }]);
});

test('repariert ein Komma vor der schließenden Klammer', () => {
  const out = feed(['{"t":"step","draw":[{"k":"line"},],}']);
  assert.deepEqual(out, [{ t: 'step', draw: [{ k: 'line' }] }]);
});

test('Objekte in einem umschließenden Array werden einzeln geliefert', () => {
  const out = feed(['[{"t":"meta"},\n{"t":"end"}]']);
  assert.deepEqual(out, [{ t: 'meta' }, { t: 'end' }]);
});
