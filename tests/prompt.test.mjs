import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemPrompt, toEvent, firstMessage, followUp, condense, compose } from '../js/prompt.js';

test('systemPrompt beschreibt Format, Tafel und den gewählten Modus', () => {
  const p = systemPrompt({ mode: 'homework', lang: 'de', about: 'Physio-Ausbildung' });
  assert.match(p, /800/);
  assert.match(p, /"t":"step"/);
  assert.match(p, /NIE die fertige Lösung/);
  assert.match(p, /Physio-Ausbildung/);
  assert.match(p, /Deutsch/);
  assert.doesNotMatch(systemPrompt({ mode: 'topic', lang: 'en', about: '' }), /NIE die fertige Lösung/);
  assert.match(systemPrompt({ mode: 'topic', lang: 'en', about: '' }), /English/);
});

test('toEvent erkennt Schritte, auch ohne t', () => {
  assert.deepEqual(toEvent({ t: 'step', say: 'Hallo', draw: [{ k: 'text' }] }), { type: 'step', say: 'Hallo', draw: [{ k: 'text' }], newPage: false });
  assert.equal(toEvent({ say: 'x' }).type, 'step');
  assert.equal(toEvent({ t: 'step', page: 'new', say: 'x' }).newPage, true);
  assert.equal(toEvent({ type: 'ask', say: 'Was ist x?' }).type, 'ask');
});

test('toEvent: done und finish gelten als end, unbekanntes wird null', () => {
  assert.equal(toEvent({ t: 'done' }).type, 'end');
  assert.equal(toEvent({ t: 'finish' }).type, 'end');
  assert.equal(toEvent({ t: 'quatsch' }), null);
  assert.equal(toEvent('x'), null);
});

test('toEvent: Quizfragen werden geprüft, Buchstaben als Antwort gehen auch', () => {
  const e = toEvent({ t: 'quiz', q: [
    { q: 'Welcher?', o: ['A', 'B', 'C'], a: 'B', why: 'weil' },
    { q: 'kaputt', o: ['nur eine'], a: 0 },
    { q: 'Index zu groß', o: ['a', 'b'], a: 5 },
    { question: 'Lang', options: ['x', 'y'], answer: 1 },
  ] });
  assert.equal(e.type, 'quiz');
  assert.equal(e.q.length, 2);
  assert.deepEqual(e.q[0], { q: 'Welcher?', o: ['A', 'B', 'C'], a: 1, why: 'weil' });
  assert.equal(e.q[1].a, 1);
});

test('toEvent: Notizen mit Punkten und Begriffen', () => {
  const e = toEvent({ t: 'notes', points: ['eins', 2], terms: [{ term: 'Systole', def: 'Anspannung' }, { x: 1 }] });
  assert.deepEqual(e, { type: 'notes', points: ['eins', '2'], terms: [{ term: 'Systole', def: 'Anspannung' }] });
});

test('firstMessage nimmt Frage, Textdateien und Dateinamen auf', () => {
  const m = firstMessage({ mode: 'exam', text: 'Herzzyklus', texts: [{ name: 'skript.txt', text: 'Systole …' }], files: [{ name: 'a.pdf', mime: 'application/pdf', data: 'x' }] });
  assert.equal(m.role, 'user');
  assert.match(m.text, /Herzzyklus/);
  assert.match(m.text, /skript\.txt/);
  assert.match(m.text, /Systole/);
  assert.match(m.text, /a\.pdf/);
  assert.equal(m.files.length, 1);
});

test('followUp für eine Zwischenfrage enthält die Frage und die Tafel', () => {
  const m = followUp({ kind: 'question', text: 'Was ist ein Sarkomer?', board: 'e1 text "Muskel"' });
  assert.match(m.text, /Sarkomer/);
  assert.match(m.text, /e1 text/);
  assert.match(m.text, /"t":"end"/);
});

test('condense fasst eine Tutor-Antwort auf das Gesagte zusammen', () => {
  const c = condense([{ type: 'meta', title: 'Herz' }, { type: 'step', say: 'Das Herz pumpt.', draw: [] }, { type: 'ask', say: 'Wie viel?' }]);
  assert.equal(typeof c, 'string');
  assert.match(c, /Das Herz pumpt\./);
  assert.match(c, /Wie viel\?/);
});

test('compose packt Anfrage, bisherigen Verlauf und Folgefrage in EINE Nachricht der Lernenden', () => {
  const first = firstMessage({ mode: 'topic', text: 'Herz', files: [{ name: 'a.png', mime: 'image/png', data: 'x' }] });
  const msgs = compose(first, [{ who: 'tutor', text: 'Das Herz pumpt.' }, { who: 'me', text: 'Warum?' }], followUp({ kind: 'question', text: 'Wie schnell?' }));
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].role, 'user');
  assert.equal(msgs[0].files.length, 1);
  const t = msgs[0].text;
  assert.ok(t.indexOf('Herz') < t.indexOf('Das Herz pumpt.'));
  assert.ok(t.indexOf('Das Herz pumpt.') < t.indexOf('Wie schnell?'));
  assert.match(t, /Tutor: Das Herz pumpt\./);
  assert.match(t, /Ich: Warum\?/);
});

test('compose ohne Folgefrage gibt die erste Nachricht unverändert zurück', () => {
  const first = firstMessage({ mode: 'topic', text: 'Herz' });
  assert.deepEqual(compose(first, [], null), [first]);
});
