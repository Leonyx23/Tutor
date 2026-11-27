// KI-Anbieter: Google Gemini (kostenlose Stufe) und Groq als Reserve.
// Wählt das beste verfügbare Modell, merkt sich erschöpfte Modelle und wechselt automatisch.

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const GROQ = 'https://api.groq.com/openai/v1';
const DAY = 24 * 3600 * 1000;

export class TutorError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}

// ---------- Modellwahl ----------
export function rankGeminiModels(list) {
  const re = /^gemini-(\d+(?:\.\d+)?)-flash(-lite)?(-preview(?:-[\w-]+)?)?$/;
  const out = [];
  for (const m of list || []) {
    const id = String(m.name || m.id || '').replace(/^models\//, '');
    if (m.supportedGenerationMethods && !m.supportedGenerationMethods.includes('generateContent')) continue;
    const r = re.exec(id);
    if (!r) continue;
    out.push({ id, v: parseFloat(r[1]), lite: r[2] ? 1 : 0, prev: r[3] ? 1 : 0 });
  }
  out.sort((a, b) => a.lite - b.lite || a.prev - b.prev || b.v - a.v);
  return out.map((m) => m.id);
}

const GROQ_SKIP = /whisper|guard|tts|orpheus|playai|compound|safeguard|prompt|distil|allam/i;
const GROQ_PREF = [/gpt-oss-120b/i, /llama-4-maverick/i, /kimi-k2/i, /qwen3[\w.]*-(235|32|27)b/i, /llama-3\.3-70b/i, /qwen/i, /gpt-oss-20b/i, /llama-4/i, /llama/i];
export function rankGroqModels(list) {
  const ids = (list || []).map((m) => String(m.id || m)).filter((id) => id && !GROQ_SKIP.test(id));
  const score = (id) => { const i = GROQ_PREF.findIndex((re) => re.test(id)); return i < 0 ? 99 : i; };
  return ids.map((id, i) => ({ id, s: score(id), i })).sort((a, b) => a.s - b.s || a.i - b.i).map((m) => m.id);
}

// Nächste Mitternacht in Pacific-Zeit (dann setzt Google die Tageskontingente zurück).
function laOffsetMin(date) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'shortOffset' })
    .formatToParts(date).find((p) => p.type === 'timeZoneName')?.value || 'GMT-8';
  const m = /GMT([+-]\d+)(?::(\d+))?/.exec(part);
  if (!m) return -480;
  const h = parseInt(m[1], 10);
  return h * 60 + Math.sign(h) * (m[2] ? parseInt(m[2], 10) : 0);
}
export function nextReset(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(now).filter((x) => x.type !== 'literal').map((x) => [x.type, parseInt(x.value, 10)]));
  const guess = Date.UTC(p.year, p.month - 1, p.day + 1, 8);
  const off = laOffsetMin(new Date(guess));
  return new Date(Date.UTC(p.year, p.month - 1, p.day + 1) - off * 60000);
}

// ---------- Fehler einordnen ----------
async function readError(res) {
  let body = {};
  try { body = await res.json(); } catch { /* leer */ }
  const e = body.error || body;
  const msg = String(e.message || e.status || res.statusText || '');
  return { status: res.status, apiStatus: String(e.status || e.code || ''), msg };
}
function classify({ status, apiStatus, msg }) {
  if (status === 429 || /RESOURCE_EXHAUSTED|rate.?limit|quota/i.test(apiStatus + ' ' + msg)) return 'quota';
  if (status === 401 || /api.?key|invalid.?key|unauthor/i.test(msg) || (status === 403 && /PERMISSION_DENIED/.test(apiStatus) && /key/i.test(msg))) return 'bad_key';
  if (status === 404 || /not found|not supported|is not available|does not exist|decommissioned|no longer/i.test(msg)) return 'unavailable';
  if (status >= 500) return 'overloaded';
  if (status === 403) return 'unavailable';
  return 'api_error';
}

// ---------- Server-Sent Events lesen ----------
async function readSSE(res, onData, signal) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    if (signal?.aborted) { try { reader.cancel(); } catch { /* egal */ } throw new TutorError('aborted', 'Abgebrochen'); }
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let obj; try { obj = JSON.parse(data); } catch { continue; }
      onData(obj);
    }
  }
}

function keyTag(k) { let h = 0; for (const c of String(k)) h = (h * 31 + c.charCodeAt(0)) | 0; return String(h); }

// ---------- Router ----------
export class Router {
  constructor({ keys = {}, fetch, store, now } = {}) {
    this.keys = keys;
    this.fetch = fetch || ((...a) => globalThis.fetch(...a));
    this.store = store || { get() {}, set() {} };
    this.now = now || (() => new Date());
  }

  blocked(model) {
    const b = this.store.get('block') || {};
    return b[model] && new Date(b[model]) > this.now();
  }
  block(model, until) {
    const b = { ...(this.store.get('block') || {}) };
    b[model] = until.toISOString();
    this.store.set('block', b);
  }
  unblockAll() { this.store.set('block', {}); }

  async models(provider) {
    const key = this.keys[provider];
    const cacheKey = provider + '.models';
    const c = this.store.get(cacheKey);
    if (c && c.tag === keyTag(key) && this.now() - new Date(c.at) < DAY && c.list.length) return c.list;
    const res = provider === 'gemini'
      ? await this.fetch(`${GEMINI}/models?pageSize=1000`, { headers: { 'x-goog-api-key': key } })
      : await this.fetch(`${GROQ}/models`, { headers: { Authorization: 'Bearer ' + key } });
    if (!res.ok) {
      const info = await readError(res);
      const code = classify(info);
      throw new TutorError(code === 'unavailable' && res.status === 400 ? 'bad_key' : code, info.msg, { provider });
    }
    const body = await res.json();
    const list = provider === 'gemini' ? rankGeminiModels(body.models) : rankGroqModels(body.data);
    this.store.set(cacheKey, { at: this.now().toISOString(), tag: keyTag(key), list });
    return list;
  }

  // opts: { system, messages:[{role:'user'|'assistant', text, files?}], maxTokens }
  async stream(opts, onText, signal) {
    const { messages } = opts;
    const binary = messages.some((m) => (m.files || []).length);
    const order = ['gemini', 'groq'].filter((p) => this.keys[p]);
    if (!order.length) throw new TutorError('no_key', 'Kein Schlüssel eingetragen');
    const errors = [];
    for (const provider of order) {
      if (provider === 'groq' && binary) { errors.push(new TutorError('needs_gemini', 'Fotos und PDFs kann nur Gemini lesen')); continue; }
      let list;
      try { list = await this.models(provider); } catch (e) {
        if (e.code === 'aborted' || e.name === 'AbortError') throw e;
        errors.push(e); continue;
      }
      for (const model of list) {
        if (this.blocked(model)) { errors.push(new TutorError('quota', 'Tageslimit erreicht', { provider, model })); continue; }
        try {
          await (provider === 'gemini' ? this.gemini(model, opts, onText, signal) : this.groq(model, opts, onText, signal));
          return { provider, model };
        } catch (e) {
          if (e.code === 'aborted' || e.name === 'AbortError' || e.partial) throw e;
          e.provider = provider; e.model = model;
          errors.push(e);
          if (e.code === 'quota') this.block(model, provider === 'gemini' ? nextReset(this.now()) : new Date(+this.now() + (e.retryAfter || 60) * 1000));
          else if (e.code === 'unavailable') this.block(model, new Date(+this.now() + DAY));
          else if (e.code === 'bad_key') break;
        }
      }
    }
    const pick = (c) => errors.find((e) => e.code === c);
    throw pick('bad_key') || pick('needs_gemini') || (errors.every((e) => e.code === 'quota') && errors.length
      ? new TutorError('quota', 'Alle kostenlosen Kontingente sind für heute verbraucht', { resetAt: nextReset(this.now()) })
      : errors[errors.length - 1] || new TutorError('api_error', 'Kein Modell verfügbar'));
  }

  async gemini(model, { system, messages, maxTokens = 16384, temperature = 0.7 }, onText, signal) {
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.text || ' ' }, ...(m.files || []).map((f) => ({ inlineData: { mimeType: f.mime, data: f.data } }))],
    }));
    const noThink = this.store.get('nothink.' + model);
    const gen = { temperature, maxOutputTokens: maxTokens };
    if (!noThink) gen.thinkingConfig = { thinkingLevel: 'low' };
    const body = { systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: gen };
    const res = await this.fetch(`${GEMINI}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': this.keys.gemini }, body: JSON.stringify(body), signal,
    });
    if (!res.ok) {
      const info = await readError(res);
      if (!noThink && res.status === 400 && /think/i.test(info.msg)) {
        this.store.set('nothink.' + model, true);
        return this.gemini(model, { system, messages, maxTokens, temperature }, onText, signal);
      }
      throw new TutorError(classify(info), info.msg);
    }
    let got = false;
    await readSSE(res, (obj) => {
      if (obj.error) throw new TutorError(classify({ status: obj.error.code, apiStatus: obj.error.status, msg: obj.error.message }), obj.error.message, { partial: got });
      const cand = obj.candidates && obj.candidates[0];
      if (obj.promptFeedback?.blockReason && !cand) throw new TutorError('blocked', 'Die Anfrage wurde abgelehnt', { partial: got });
      for (const p of cand?.content?.parts || []) {
        if (p.thought || typeof p.text !== 'string' || !p.text) continue;
        got = true; onText(p.text);
      }
    }, signal).catch((e) => { if (got && !e.partial && e.code !== 'aborted') e.partial = true; throw e; });
    if (!got) throw new TutorError('empty', 'Leere Antwort');
  }

  async groq(model, { system, messages, maxTokens = 8192, temperature = 0.7 }, onText, signal) {
    const noReason = this.store.get('noreason.' + model);
    const body = {
      model, stream: true, temperature, max_completion_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, ...messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.text || ' ' }))],
    };
    if (/gpt-oss/.test(model) && !noReason) body.reasoning_effort = 'low';
    const res = await this.fetch(`${GROQ}/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + this.keys.groq }, body: JSON.stringify(body), signal,
    });
    if (!res.ok) {
      const info = await readError(res);
      if (body.reasoning_effort && res.status === 400 && /reason/i.test(info.msg)) {
        this.store.set('noreason.' + model, true);
        return this.groq(model, { system, messages, maxTokens, temperature }, onText, signal);
      }
      const ra = parseInt(res.headers.get('retry-after') || '', 10);
      throw new TutorError(classify(info), info.msg, { retryAfter: Number.isFinite(ra) ? ra : undefined });
    }
    let got = false;
    await readSSE(res, (obj) => {
      if (obj.error) throw new TutorError(classify({ status: 0, apiStatus: obj.error.type, msg: obj.error.message }), obj.error.message, { partial: got });
      const t = obj.choices && obj.choices[0]?.delta?.content;
      if (t) { got = true; onText(t); }
    }, signal).catch((e) => { if (got && !e.partial && e.code !== 'aborted') e.partial = true; throw e; });
    if (!got) throw new TutorError('empty', 'Leere Antwort');
  }
}
