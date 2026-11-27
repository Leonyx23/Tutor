import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankGeminiModels, rankGroqModels, nextReset, Router } from '../js/providers.js';

const GEMINI_LIST = {
  models: [
    'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-image',
    'gemini-3.1-flash-tts-preview', 'gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'text-embedding-004',
    'gemini-3.8-live-extended-thinking', 'gemini-3.5-flash',
  ].map((n) => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] })),
};
const GROQ_LIST = { data: ['whisper-large-v3', 'llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'meta-llama/llama-guard-4-12b', 'openai/gpt-oss-20b'].map((id) => ({ id })) };

test('rankGeminiModels: neueste Flash-Modelle zuerst, dann Vorschau, dann Lite; Bild/TTS/Live/Pro raus', () => {
  assert.deepEqual(rankGeminiModels(GEMINI_LIST.models), [
    'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash-lite',
  ]);
});

test('rankGroqModels: gpt-oss-120b vor Llama, Whisper und Guard raus', () => {
  const r = rankGroqModels(GROQ_LIST.data);
  assert.equal(r[0], 'openai/gpt-oss-120b');
  assert.ok(r.includes('llama-3.3-70b-versatile'));
  assert.ok(!r.some((m) => /whisper|guard/.test(m)));
});

test('nextReset: Mitternacht Pacific-Zeit (Winter 08:00 UTC, Sommer 07:00 UTC)', () => {
  assert.equal(nextReset(new Date('2026-11-27T11:00:00Z')).toISOString(), '2026-11-28T08:00:00.000Z');
  assert.equal(nextReset(new Date('2026-07-01T10:00:00Z')).toISOString(), '2026-07-02T07:00:00.000Z');
  assert.equal(nextReset(new Date('2026-11-27T07:30:00Z')).toISOString(), '2026-11-27T08:00:00.000Z');
});

// ---- Router mit nachgebauter API ----
function sse(lines) {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    start(c) { for (const l of lines) c.enqueue(enc.encode(l)); c.close(); },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
const gem = (t) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\n\n`;
const groqChunk = (t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function memStore() { const m = new Map(); return { get: (k) => m.get(k), set: (k, v) => m.set(k, v), m }; }

function mockFetch(handlers) {
  const calls = [];
  const f = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    for (const [re, h] of handlers) if (re.test(String(url))) return h(String(url), opts, calls);
    return json(404, { error: { message: 'nicht gefunden' } });
  };
  f.calls = calls;
  return f;
}

test('Router streamt Text von Gemini und meldet Anbieter und Modell', async () => {
  const fetch = mockFetch([
    [/\/v1beta\/models\?/, () => json(200, GEMINI_LIST)],
    [/streamGenerateContent/, () => sse([gem('{"t":"me'), gem('ta"}')])],
  ]);
  const r = new Router({ keys: { gemini: 'G', groq: '' }, fetch, store: memStore() });
  let text = '';
  const info = await r.stream({ system: 'S', messages: [{ role: 'user', text: 'Hallo' }] }, (d) => { text += d; });
  assert.equal(text, '{"t":"meta"}');
  assert.deepEqual(info, { provider: 'gemini', model: 'gemini-3.7-flash' });
  const post = fetch.calls.find((c) => /streamGenerateContent/.test(c.url));
  assert.equal(post.opts.headers['x-goog-api-key'], 'G');
  const body = JSON.parse(post.opts.body);
  assert.equal(body.systemInstruction.parts[0].text, 'S');
  assert.equal(body.contents[0].role, 'user');
});

test('Router wechselt bei 429 auf das nächste Modell und zuletzt auf Groq; erschöpfte Modelle werden gemerkt', async () => {
  const store = memStore();
  const fetch = mockFetch([
    [/\/v1beta\/models\?/, () => json(200, GEMINI_LIST)],
    [/streamGenerateContent/, () => json(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota' } })],
    [/groq\.com\/openai\/v1\/models/, () => json(200, GROQ_LIST)],
    [/groq\.com\/openai\/v1\/chat/, () => sse([groqChunk('{"t":"end"}'), 'data: [DONE]\n\n'])],
  ]);
  const r = new Router({ keys: { gemini: 'G', groq: 'Q' }, fetch, store, now: () => new Date('2026-11-27T11:00:00Z') });
  let text = '';
  const info = await r.stream({ system: 'S', messages: [{ role: 'user', text: 'x' }] }, (d) => { text += d; });
  assert.equal(info.provider, 'groq');
  assert.equal(info.model, 'openai/gpt-oss-120b');
  assert.equal(text, '{"t":"end"}');
  const tried = fetch.calls.filter((c) => /streamGenerateContent/.test(c.url)).length;
  assert.equal(tried, 5);
  const groqPost = fetch.calls.find((c) => /chat\/completions/.test(c.url));
  assert.equal(groqPost.opts.headers.Authorization, 'Bearer Q');
  // zweiter Aufruf: Gemini-Modelle sind bis zum Reset gesperrt
  await r.stream({ system: 'S', messages: [{ role: 'user', text: 'y' }] }, () => {});
  assert.equal(fetch.calls.filter((c) => /streamGenerateContent/.test(c.url)).length, 5);
});

test('Router versucht es ohne thinkingConfig, wenn das Modell sie ablehnt', async () => {
  let n = 0;
  const fetch = mockFetch([
    [/\/v1beta\/models\?/, () => json(200, GEMINI_LIST)],
    [/streamGenerateContent/, (u, o) => {
      n++;
      const b = JSON.parse(o.body);
      if (b.generationConfig.thinkingConfig) return json(400, { error: { status: 'INVALID_ARGUMENT', message: 'Unknown name "thinkingConfig"' } });
      return sse([gem('ok')]);
    }],
  ]);
  const r = new Router({ keys: { gemini: 'G' }, fetch, store: memStore() });
  let text = '';
  await r.stream({ system: 'S', messages: [{ role: 'user', text: 'x' }] }, (d) => { text += d; });
  assert.equal(text, 'ok'); assert.equal(n, 2);
});

test('Router ohne Schlüssel wirft einen Fehler mit code no_key', async () => {
  const r = new Router({ keys: {}, fetch: mockFetch([]), store: memStore() });
  await assert.rejects(r.stream({ system: 'S', messages: [{ role: 'user', text: 'x' }] }, () => {}), (e) => e.code === 'no_key');
});

test('Fotos und PDFs gehen nicht an Groq: Fehler needs_gemini, wenn Gemini nicht kann', async () => {
  const fetch = mockFetch([[/groq\.com\/openai\/v1\/models/, () => json(200, GROQ_LIST)]]);
  const r = new Router({ keys: { groq: 'Q' }, fetch, store: memStore() });
  const msg = { role: 'user', text: 'x', files: [{ mime: 'image/jpeg', data: 'AAAA', name: 'a.jpg' }] };
  await assert.rejects(r.stream({ system: 'S', messages: [msg] }, () => {}), (e) => e.code === 'needs_gemini');
});

test('Gemini bekommt Bilder als inlineData und Antworten als role model', async () => {
  const fetch = mockFetch([
    [/\/v1beta\/models\?/, () => json(200, GEMINI_LIST)],
    [/streamGenerateContent/, () => sse([gem('x')])],
  ]);
  const r = new Router({ keys: { gemini: 'G' }, fetch, store: memStore() });
  await r.stream({ system: 'S', messages: [
    { role: 'user', text: 'a', files: [{ mime: 'image/png', data: 'QUJD', name: 'b.png' }] },
    { role: 'assistant', text: 'b' },
    { role: 'user', text: 'c' },
  ] }, () => {});
  const body = JSON.parse(fetch.calls.find((c) => /streamGenerateContent/.test(c.url)).opts.body);
  assert.deepEqual(body.contents.map((c) => c.role), ['user', 'model', 'user']);
  assert.deepEqual(body.contents[0].parts[1], { inlineData: { mimeType: 'image/png', data: 'QUJD' } });
});

test('ungültiger Gemini-Schlüssel: weiter mit Groq; ohne Groq Fehler bad_key', async () => {
  const fetch = mockFetch([
    [/\/v1beta\/models\?/, () => json(400, { error: { status: 'INVALID_ARGUMENT', message: 'API key not valid' } })],
  ]);
  const r = new Router({ keys: { gemini: 'falsch' }, fetch, store: memStore() });
  await assert.rejects(r.stream({ system: 'S', messages: [{ role: 'user', text: 'x' }] }, () => {}), (e) => e.code === 'bad_key' && e.provider === 'gemini');
});

// ---- große Dateien über die Gemini-Files-API ----
import { geminiUpload, needsUpload } from '../js/providers.js';

test('geminiUpload: Start-Anfrage, Hochladen an die Upload-Adresse, Ergebnis mit uri und Ablaufzeit', async () => {
  const seen = [];
  const fetch = async (url, opts = {}) => {
    seen.push({ url: String(url), opts });
    if (/upload\/v1beta\/files/.test(url)) return new Response('{}', { status: 200, headers: { 'x-goog-upload-url': 'https://up.example/abc' } });
    return json(404, {});
  };
  let putCall;
  const put = async (url, blob, headers, onProgress) => {
    putCall = { url, headers, size: blob.size };
    onProgress(0.5); onProgress(1);
    return { status: 200, text: JSON.stringify({ file: { name: 'files/x1', uri: 'https://generativelanguage.googleapis.com/v1beta/files/x1', mimeType: 'application/pdf', state: 'ACTIVE', expirationTime: '2026-11-29T12:00:00Z' } }) };
  };
  const prog = [];
  const blob = new Blob([new Uint8Array(1000)], { type: 'application/pdf' });
  const f = await geminiUpload({ key: 'G', blob, mime: 'application/pdf', name: 'skript.pdf', fetch, put, onProgress: (p) => prog.push(p) });
  assert.equal(seen[0].opts.headers['X-Goog-Upload-Protocol'], 'resumable');
  assert.equal(seen[0].opts.headers['X-Goog-Upload-Command'], 'start');
  assert.equal(seen[0].opts.headers['X-Goog-Upload-Header-Content-Length'], '1000');
  assert.equal(seen[0].opts.headers['x-goog-api-key'], 'G');
  assert.equal(putCall.url, 'https://up.example/abc');
  assert.equal(putCall.headers['X-Goog-Upload-Command'], 'upload, finalize');
  assert.deepEqual(prog, [0.5, 1]);
  assert.equal(f.uri, 'https://generativelanguage.googleapis.com/v1beta/files/x1');
  assert.equal(f.expires, '2026-11-29T12:00:00Z');
  assert.equal(f.mime, 'application/pdf');
});

test('geminiUpload wartet, solange die Datei noch verarbeitet wird', async () => {
  let polls = 0;
  const fetch = async (url) => {
    if (/upload\/v1beta\/files/.test(url)) return new Response('{}', { status: 200, headers: { 'x-goog-upload-url': 'https://up.example/abc' } });
    if (/v1beta\/files\/x2/.test(url)) { polls++; return json(200, { name: 'files/x2', uri: 'u2', state: polls < 2 ? 'PROCESSING' : 'ACTIVE' }); }
    return json(404, {});
  };
  const put = async () => ({ status: 200, text: JSON.stringify({ file: { name: 'files/x2', uri: 'u2', state: 'PROCESSING' } }) });
  const f = await geminiUpload({ key: 'G', blob: new Blob(['x']), mime: 'application/pdf', name: 'a.pdf', fetch, put, wait: 0 });
  assert.equal(polls, 2); assert.equal(f.uri, 'u2');
});

test('geminiUpload: ohne Upload-Adresse Fehler upload_blocked', async () => {
  const fetch = async () => new Response('{}', { status: 200 });
  await assert.rejects(geminiUpload({ key: 'G', blob: new Blob(['x']), mime: 'application/pdf', name: 'a.pdf', fetch, put: async () => ({}) }), (e) => e.code === 'upload_blocked');
});

test('geminiUpload: abgelehnter Schlüssel ergibt bad_key', async () => {
  const fetch = async () => json(400, { error: { status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } });
  await assert.rejects(geminiUpload({ key: 'X', blob: new Blob(['x']), mime: 'application/pdf', name: 'a.pdf', fetch, put: async () => ({}) }), (e) => e.code === 'bad_key');
});

test('needsUpload: neu, abgelaufen oder anderer Schlüssel', () => {
  const now = new Date('2026-11-27T12:00:00Z');
  assert.equal(needsUpload({ id: 'a' }, 'G', now), true);
  assert.equal(needsUpload({ uri: 'u', expires: '2026-11-27T12:05:00Z', keyTag: needsUpload.tag('G') }, 'G', now), true);
  assert.equal(needsUpload({ uri: 'u', expires: '2026-11-28T12:00:00Z', keyTag: needsUpload.tag('G') }, 'G', now), false);
  assert.equal(needsUpload({ uri: 'u', expires: '2026-11-28T12:00:00Z', keyTag: needsUpload.tag('G') }, 'H', now), true);
  assert.equal(needsUpload({ data: 'QUJD', mime: 'image/jpeg' }, 'G', now), false);
});

test('Gemini bekommt hochgeladene Dateien als fileData; Groq lehnt sie ab', async () => {
  const fetch = mockFetch([
    [/\/v1beta\/models\?/, () => json(200, GEMINI_LIST)],
    [/streamGenerateContent/, () => sse([gem('x')])],
    [/groq\.com\/openai\/v1\/models/, () => json(200, GROQ_LIST)],
  ]);
  const msg = { role: 'user', text: 'a', files: [{ name: 's.pdf', mime: 'application/pdf', uri: 'https://g/files/1' }] };
  const r = new Router({ keys: { gemini: 'G' }, fetch, store: memStore() });
  await r.stream({ system: 'S', messages: [msg] }, () => {});
  const body = JSON.parse(fetch.calls.find((c) => /streamGenerateContent/.test(c.url)).opts.body);
  assert.deepEqual(body.contents[0].parts[1], { fileData: { mimeType: 'application/pdf', fileUri: 'https://g/files/1' } });
  const g = new Router({ keys: { groq: 'Q' }, fetch, store: memStore() });
  await assert.rejects(g.stream({ system: 'S', messages: [msg] }, () => {}), (e) => e.code === 'needs_gemini');
});

test('abgelaufene Datei: Fehler file_gone, ohne die anderen Modelle zu sperren', async () => {
  const store = memStore();
  const fetch = mockFetch([
    [/\/v1beta\/models\?/, () => json(200, GEMINI_LIST)],
    [/streamGenerateContent/, () => json(403, { error: { code: 403, status: 'PERMISSION_DENIED', message: 'You do not have permission to access the File abc123 or it may not exist.' } })],
  ]);
  const r = new Router({ keys: { gemini: 'G' }, fetch, store });
  const msg = { role: 'user', text: 'a', files: [{ name: 's.pdf', mime: 'application/pdf', uri: 'https://g/files/abc123' }] };
  await assert.rejects(r.stream({ system: 'S', messages: [msg] }, () => {}), (e) => e.code === 'file_gone');
  assert.equal(fetch.calls.filter((c) => /streamGenerateContent/.test(c.url)).length, 1);
  assert.deepEqual(store.get('block') || {}, {});
});
