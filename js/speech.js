// Vorlesen (Sprachausgabe des Browsers) und Diktieren (Spracherkennung des Browsers).

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

export function voicesFor(lang) {
  if (!synth) return [];
  const base = lang.split('-')[0];
  return synth.getVoices().filter((v) => v.lang && v.lang.replace('_', '-').toLowerCase().startsWith(base));
}

function bestVoice(lang, uri) {
  const vs = voicesFor(lang);
  if (uri) { const v = vs.find((x) => x.voiceURI === uri); if (v) return v; }
  const score = (v) => (/(premium|enhanced|neural|natural)/i.test(v.name) ? 4 : 0) + (/google/i.test(v.name) ? 3 : 0)
    + (/(anna|petra|helena|katja|marlene|vicki)/i.test(v.name) ? 2 : 0) + (v.lang.replace('_', '-') === lang ? 1 : 0) + (v.localService ? 0.5 : 0);
  return vs.sort((a, b) => score(b) - score(a))[0] || null;
}

// Sätze in Stücke ≤ 220 Zeichen (Chrome bricht lange Äußerungen sonst ab)
function chunks(text) {
  const parts = String(text).replace(/\s+/g, ' ').match(/[^.!?…]+[.!?…]*\s*/g) || [text];
  const out = [];
  let cur = '';
  for (const p of parts) {
    if ((cur + p).length > 220 && cur) { out.push(cur.trim()); cur = ''; }
    cur += p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export class Speaker {
  constructor() { this.gen = 0; this.enabled = true; this.lang = 'de-DE'; this.rate = 1; this.voiceURI = ''; }
  get available() { return !!synth && typeof SpeechSynthesisUtterance !== 'undefined'; }

  // Auf iOS muss das erste Sprechen aus einem Tippen heraus starten.
  unlock() {
    if (!this.available || this.unlocked) return;
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; synth.speak(u); this.unlocked = true; } catch { /* egal */ }
  }

  // Liefert ein Versprechen, das endet, wenn fertig gesprochen (oder gelesen) wurde.
  speak(text, { onWord } = {}) {
    const my = ++this.gen;
    const readMs = Math.max(900, String(text).length * 55 / this.rate);
    if (!text) return Promise.resolve();
    if (!this.enabled || !this.available) return this.wait(readMs, my);
    try { synth.cancel(); } catch { /* egal */ }
    const voice = bestVoice(this.lang, this.voiceURI);
    const list = chunks(text);
    return new Promise((resolve) => {
      let i = 0, settled = false;
      const done = () => { if (!settled) { settled = true; clearTimeout(guard); resolve(); } };
      // Sicherheitsnetz, falls onend nie kommt
      const guard = setTimeout(done, readMs * 2.2 + 4000);
      const next = () => {
        if (my !== this.gen) return done();
        if (i >= list.length) return done();
        const u = new SpeechSynthesisUtterance(list[i++]);
        u.lang = this.lang; u.rate = this.rate;
        if (voice) u.voice = voice;
        u.onend = next;
        u.onerror = (e) => { if (e.error === 'interrupted' || e.error === 'canceled') done(); else next(); };
        if (onWord) u.onboundary = onWord;
        synth.speak(u);
      };
      next();
    });
  }

  wait(ms, my) {
    return new Promise((res) => {
      const t0 = Date.now();
      const finish = () => { if (this.waitRes === finish) this.waitRes = null; clearTimeout(this.timer); res(); };
      this.waitRes = finish;
      const tick = () => { if (my !== this.gen || Date.now() - t0 >= ms) finish(); else this.timer = setTimeout(tick, 120); };
      tick();
    });
  }

  stop() {
    this.gen++;
    if (this.waitRes) this.waitRes();
    try { synth && synth.cancel(); } catch { /* egal */ }
  }
}

export class Listener {
  constructor() {
    const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    this.SR = SR || null;
    this.rec = null;
  }
  get available() { return !!this.SR; }
  get active() { return !!this.rec; }

  start(lang, { onText, onEnd, onError }) {
    if (!this.SR) return false;
    this.stop();
    const rec = new this.SR();
    rec.lang = lang; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    let finalText = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
      }
      onText && onText((finalText + interim).trim(), !interim);
    };
    rec.onerror = (e) => { onError && onError(e.error); };
    rec.onend = () => { this.rec = null; onEnd && onEnd(finalText.trim()); };
    try { rec.start(); this.rec = rec; return true; } catch (e) { onError && onError(String(e)); return false; }
  }
  stop() { if (this.rec) { try { this.rec.stop(); } catch { /* egal */ } } }
}
