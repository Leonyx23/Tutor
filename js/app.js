import { Board } from './board.js';
import { Router, TutorError, geminiUpload, needsUpload } from './providers.js';
import { ObjectStream } from './stream.js';
import { systemPrompt, toEvent, firstMessage, followUp, compose, LANGS } from './prompt.js';
import { settings, routerStore, lessons, blobs } from './store.js';
import { Speaker, Listener, voicesFor } from './speech.js';

const $ = (id) => document.getElementById(id);
function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const MODE_NAME = { topic: 'Thema', exam: 'Prüfung', homework: 'Hausaufgabe' };
const PLACEHOLDER = {
  topic: 'Was möchtest du verstehen?',
  exam: 'Welches Thema kommt dran? Häng gern dein Skript oder Fotos an.',
  homework: 'Schreib die Aufgabe ab oder fotografiere sie.',
};
const EXAMPLES = {
  topic: ['Wie funktioniert die Muskelpumpe?', 'Was macht die Rotatorenmanschette?', 'Wie läuft die Blutgerinnung ab?', 'Wie entsteht ein Aktionspotenzial?'],
  exam: ['Herzzyklus: Systole und Diastole', 'Plexus brachialis und seine Nerven', 'Niere: Filtration und Rückresorption', 'Kniegelenk: Bänder und Menisken'],
  homework: ['Berechne das Herzzeitvolumen bei einer Herzfrequenz von 70 pro Minute und 80 ml Schlagvolumen.', 'Welche Muskeln arbeiten bei der Kniebeuge exzentrisch?', 'Ordne die Hirnnerven I bis XII ihren Aufgaben zu.'],
};

const speaker = new Speaker();
const listener = new Listener();
const S = { mode: 'topic', files: [], session: null, view: 'home', pendingStart: false };

// ---------------- Einstellungen anwenden ----------------
function applySettings() {
  const s = settings.get();
  speaker.enabled = s.voice; speaker.rate = s.rate; speaker.voiceURI = s.voiceURI;
  speaker.lang = (LANGS[s.lang] || LANGS.de).tts;
  board.speed = s.speed;
  document.documentElement.dataset.theme = s.theme === 'auto' ? '' : s.theme;
  document.documentElement.lang = s.lang || 'de';
}

// ---------------- Tafel ----------------
const board = new Board($('board'), { onChange: updatePager });
function updatePager(cur, n) {
  $('pgInfo').textContent = n > 1 ? `Seite ${cur + 1} von ${n}` : 'Seite 1';
  $('pgPrev').disabled = cur <= 0;
  $('pgNext').disabled = cur >= n - 1;
}
$('pgPrev').onclick = () => board.showPage(board.cur - 1);
$('pgNext').onclick = () => board.showPage(board.cur + 1);
let zoom = 1;
function setZoom(z) {
  zoom = Math.max(1, Math.min(3, z));
  $('board').style.width = zoom === 1 ? '' : zoom * 100 + '%';
}
$('fullscreen').onclick = () => {
  const on = !$('boardWrap').classList.contains('fs');
  $('boardWrap').classList.toggle('fs', on);
  document.body.classList.toggle('noscroll', on);
  $('fullscreen').querySelector('use').setAttribute('href', on ? '#i-shrink' : '#i-expand');
  $('fullscreen').setAttribute('aria-label', on ? 'Tafel verkleinern' : 'Tafel groß anzeigen');
  if (!on) setZoom(1);
};
$('zoomIn').onclick = () => setZoom(zoom + 0.5);
$('zoomOut').onclick = () => setZoom(zoom - 0.5);

// ---------------- Kleinkram ----------------
let toastT;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2800);
}
function shortTitle(text) {
  const w = String(text).replace(/\s+/g, ' ').trim().split(' ');
  return w.slice(0, 7).join(' ') + (w.length > 7 ? ' …' : '');
}
function fmtDate(ts) {
  const d = new Date(ts), now = new Date();
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return 'heute, ' + time;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'gestern, ' + time;
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
}

// ---------------- Verlauf (Transkript) ----------------
const T = $('transcript');
function atBottom() { return T.scrollHeight - T.scrollTop - T.clientHeight < 80; }
function addItem(li) {
  const stick = atBottom();
  T.appendChild(li);
  if (stick || li.classList.contains('me')) li.scrollIntoView({ block: 'end', behavior: reduced ? 'auto' : 'smooth' });
  return li;
}
function addMe(text, files = []) {
  const li = h('li', 'msg me');
  if (text) li.appendChild(h('p', '', text));
  if (files.length) {
    const u = h('ul', 'fchips');
    for (const f of files) u.appendChild(h('li', '', f));
    li.appendChild(u);
  }
  return addItem(li);
}
function addTutor(text, page) {
  const li = h('li', 'msg tutor');
  const b = h('button', '', text);
  b.type = 'button';
  b.title = 'Zu dieser Tafelseite';
  b.onclick = () => board.showPage(page);
  li.appendChild(b);
  return addItem(li);
}
function addDivider(text) { return addItem(h('li', 'divider', text)); }
function addSys(text, actions = []) {
  const li = h('li', 'msg sys');
  li.appendChild(h('p', '', text));
  if (actions.length) {
    const row = h('div', 'actions');
    for (const [label, fn] of actions) {
      const b = h('button', 'secondary', label); b.type = 'button';
      b.onclick = () => { li.remove(); fn(); };
      row.appendChild(b);
    }
    li.appendChild(row);
  }
  return addItem(li);
}

// Denkanzeige auf der Tafel
let thinkT = [];
function showThinking(on) {
  thinkT.forEach(clearTimeout); thinkT = [];
  $('thinking').hidden = !on;
  if (on) {
    $('thinkText').textContent = 'Ich überlege …';
    thinkT.push(setTimeout(() => { $('thinkText').textContent = 'Ich plane das Tafelbild …'; }, 6000));
    thinkT.push(setTimeout(() => { $('thinkText').textContent = 'Dauert etwas länger, gleich geht es los …'; }, 18000));
  }
}

function setPlayBtn(paused, label) {
  const b = $('playPause');
  b.querySelector('use').setAttribute('href', paused ? '#i-play' : '#i-pause');
  b.setAttribute('aria-label', label || (paused ? 'Weiter' : 'Anhalten'));
  b.title = b.getAttribute('aria-label');
}
function setWaitingUI(on) {
  $('r').placeholder = on ? 'Deine Antwort …' : 'Dazwischenfragen …';
  $('reply').classList.toggle('waiting', on);
}

// ---------------- Lektion (Ablauf) ----------------
class Session {
  constructor(lesson) {
    this.l = lesson;
    this.main = [...(lesson.pending || [])];
    this.ins = [];
    this.mainStreaming = false; this.insStreaming = false;
    this.paused = false; this.hiddenPause = false;
    this.waiting = !!lesson.waiting;
    this.running = false;
    this.mainPage = lesson.mainPage || 0;
    this.insPage = 0;
    this.lastSrc = 'main';
    this.lastSay = '';
    this.ctrls = new Set();
    this.wakeFn = null;
    this.afterShown = false;
    this.blobCache = new Map();
  }

  // Große Dateien zu Google hochladen (beim ersten Mal und wenn sie nach 48 Stunden abgelaufen sind)
  async prepareFiles(signal) {
    const s = settings.get();
    const files = this.l.first.files || [];
    const todo = files.filter((f) => !f.gone && needsUpload(f, s.geminiKey));
    if (!todo.length) return;
    if (!s.geminiKey) throw new TutorError('needs_gemini', 'Für Fotos und PDFs braucht es Gemini');
    for (const f of todo) {
      const blob = this.blobCache.get(f.id) || await blobs.get(f.id).catch(() => null);
      if (!blob) { f.gone = true; addSys(`${f.name} ist auf diesem Gerät nicht mehr gespeichert. Ich antworte ohne die Datei.`); continue; }
      const li = h('li', 'msg sys progress');
      const p = h('p', '', `Lade ${f.name} hoch …`);
      const bar = h('div', 'bar'); const fill = h('span'); bar.appendChild(fill);
      li.append(p, bar); addItem(li);
      try {
        const up = await geminiUpload({
          key: s.geminiKey, blob, mime: f.mime, name: f.name, signal,
          onProgress: (q) => { p.textContent = `Lade ${f.name} hoch … ${Math.round(q * 100)} %`; fill.style.width = (q * 100).toFixed(1) + '%'; },
        });
        delete f.data;
        Object.assign(f, up);
      } catch (e) {
        const inlineMax = (f.mime === 'application/pdf' ? 50 : 100) * 1024 * 1024 * 0.74;
        if ((e.code === 'upload_blocked' || e.code === 'upload_failed') && blob.size <= inlineMax) {
          f.data = await blobToB64(blob); // Plan B: direkt in der Anfrage mitschicken
        } else throw e;
      } finally { li.remove(); }
    }
    this.saveSoon();
  }

  wake() { const f = this.wakeFn; this.wakeFn = null; if (f) f(); }
  sleep() { return new Promise((r) => { this.wakeFn = r; }); }
  get streaming() { return this.mainStreaming || this.insStreaming; }

  saveSoon() {
    clearTimeout(this.saveT);
    this.saveT = setTimeout(() => this.saveNow(), 500);
  }
  saveNow() {
    clearTimeout(this.saveT);
    const l = this.l;
    l.pending = this.main.filter((e) => !e.replay);
    l.waiting = this.waiting;
    l.mainPage = this.mainPage;
    if (!this.replaying) l.pages = board.snapshot();
    return lessons.save(l).catch(() => toast('Speichern hat nicht geklappt'));
  }

  async request(follow, target, retryOf) {
    const s = settings.get();
    const router = new Router({ keys: { gemini: s.geminiKey, groq: s.groqKey }, store: routerStore });
    const ctrl = new AbortController();
    this.ctrls.add(ctrl);
    const flag = target === 'main' ? 'mainStreaming' : 'insStreaming';
    this[flag] = true;
    try { await this.prepareFiles(ctrl.signal); } catch (e) {
      this[flag] = false; this.ctrls.delete(ctrl);
      if (e.code !== 'aborted') this.fail(e, follow, target);
      this.wake(); this.run();
      return;
    }
    const messages = compose(this.l.first, this.l.turns, follow);
    showThinking(true);
    const parser = new ObjectStream();
    let count = 0, raw = '';
    try {
      const info = await router.stream({ system: systemPrompt({ mode: this.l.mode, lang: s.lang, about: s.about }), messages }, (txt) => {
        raw += txt;
        for (const obj of parser.push(txt)) {
          const ev = toEvent(obj);
          if (!ev) continue;
          count++;
          this.accept(ev, target);
        }
      }, ctrl.signal);
      this.l.model = (info.provider === 'gemini' ? 'Gemini' : 'Groq') + ` (${info.model})`;
      if (!count) {
        // Antwort ohne Tafel-Format: wenigstens als gesprochenen Text zeigen
        const plain = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```\w*/g, '').trim();
        if (plain.length > 15) this.accept({ type: 'step', say: plain.slice(0, 1500), draw: [] }, target);
        else this.fail({ code: 'format' }, follow, target);
      }
    } catch (e) {
      if (e.code !== 'aborted' && e.name !== 'AbortError') this.fail(e, follow, target, count);
    } finally {
      this[flag] = false;
      this.ctrls.delete(ctrl);
      if (!this.streaming && !this.main.length && !this.ins.length) showThinking(false);
      this.wake();
      this.run();
      this.saveSoon();
    }
  }

  accept(ev, target) {
    if (ev.type === 'meta') {
      if (ev.title && !this.l.titled) { this.l.title = ev.title; this.l.titled = true; $('lTitle').textContent = ev.title; }
      return;
    }
    if (ev.type === 'notes') { if (target === 'main') this.l.notes = ev; return; }
    if (ev.type === 'quiz') { if (target === 'main' && ev.q.length) this.l.quiz = ev; return; }
    if (ev.type === 'end') return;
    ev.src = target;
    (target === 'main' ? this.main : this.ins).push(ev);
    this.wake();
    this.run();
  }

  async run() {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        if (this.paused || this.waiting || S.session !== this) break;
        let ev = this.ins.shift();
        if (!ev && this.insStreaming) { await this.sleep(); continue; }
        if (!ev) ev = this.main.shift();
        if (!ev) {
          if (this.mainStreaming) { await this.sleep(); continue; }
          this.finish();
          break;
        }
        await this.play(ev);
        if (ev.type === 'ask' && !ev.replay) { this.waiting = true; setWaitingUI(true); setPlayBtn(true, 'Antworte unten im Feld'); this.saveSoon(); break; }
        if (!settings.get().auto && !this.paused && (this.main.length || this.ins.length || this.streaming)) {
          this.paused = true; setPlayBtn(true, 'Nächster Schritt');
        }
      }
    } finally {
      this.running = false;
    }
  }

  async play(ev) {
    showThinking(false);
    // Nach einer Zwischenfrage zurück zur Lektion
    if (ev.src === 'main' && this.lastSrc === 'ins') addDivider('Weiter mit der Lektion');
    let target = ev.replay ? board.cur : ev.src === 'main' ? this.mainPage : this.insPage;
    if (target >= board.pages.length) target = board.pages.length - 1;
    if (ev.newPage && !board.isEmpty(target)) { board.newPage(); target = board.cur; }
    else if (board.cur !== target) board.showPage(target);
    if (ev.src === 'main') this.mainPage = board.cur; else this.insPage = board.cur;
    this.lastSrc = ev.src;
    this.lastSay = ev.say || this.lastSay;
    const li = ev.say ? addTutor(ev.say, board.cur) : null;
    if (li) li.classList.add('now');
    const [, els] = await Promise.all([speaker.speak(ev.say), board.draw(ev.draw, { animate: !reduced })]);
    if (li) li.classList.remove('now');
    if (!ev.replay) {
      this.l.script.push({ type: ev.type, say: ev.say, page: board.cur, els, src: ev.src });
      if (ev.say) this.l.turns.push({ who: 'tutor', text: ev.say, page: board.cur });
      this.saveSoon();
    }
    if (!this.paused) await delay(320);
  }

  pause(auto = false) {
    if (this.paused) return;
    this.paused = true; this.autoPaused = auto;
    speaker.stop(); board.skip();
    setPlayBtn(true);
  }
  resume() {
    this.autoPaused = false;
    if (!this.paused) { this.run(); return; }
    this.paused = false;
    setPlayBtn(false);
    speaker.unlock();
    this.run();
  }

  ask(kind, text, shown) {
    addMe(shown ?? text);
    this.l.turns.push({ who: 'me', text: shown ?? text });
    if (this.waiting) {
      this.waiting = false; setWaitingUI(false);
      this.paused = false; setPlayBtn(false);
      this.request(followUp({ kind: 'answer', text, board: board.describe() }), 'main');
      this.run();
      return;
    }
    speaker.stop(); board.skip();
    this.insPage = board.cur;
    this.request(followUp({ kind, text, last: this.lastSay, board: board.describe() }), 'ins');
    this.paused = false; this.autoPaused = false; setPlayBtn(false);
    this.run();
  }

  askQuiz(i) {
    const q = this.l.quiz.q[i];
    const chosen = this.l.quizState[i];
    const shown = `Erklär mir bitte Frage ${i + 1} nochmal.`;
    addMe(shown);
    this.l.turns.push({ who: 'me', text: shown });
    speaker.stop(); board.skip();
    this.insPage = board.cur;
    this.ended = false;
    this.request(followUp({ kind: 'quiz', text: q.q, chosen: q.o[chosen], right: q.o[q.a] }), 'ins');
    this.paused = false; setPlayBtn(false);
    this.run();
  }

  finish() {
    showThinking(false);
    this.replaying = false;
    setPlayBtn(true, 'Von vorn abspielen');
    this.ended = true;
    if (!this.l.done) this.l.done = true;
    if (!this.afterShown && (this.l.notes || this.l.quiz)) { this.afterShown = true; renderAfter(this); }
    this.saveSoon();
  }

  fail(e, follow, target, count = 0) {
    showThinking(false);
    const retry = () => this.request(follow, target);
    const s = settings.get();
    if (e.partial || (count > 0 && e.code !== 'quota')) {
      addSys('Die Antwort ist mittendrin abgebrochen.', [['Weitermachen', () => this.request(followUp({ kind: 'continue', board: board.describe() }), target)]]);
      return;
    }
    switch (e.code) {
      case 'file_gone':
        for (const f of this.l.first.files || []) if (f.uri) { delete f.uri; delete f.expires; }
        if (!this.fileRetry) { this.fileRetry = true; this.request(follow, target).finally(() => { this.fileRetry = false; }); return; }
        addSys('Google findet die hochgeladene Datei nicht mehr.', [['Nochmal hochladen', retry]]);
        break;
      case 'too_big': addSys('Die Datei ist für Google zu groß.'); break;
      case 'upload_failed': case 'upload_blocked': addSys(`Das Hochladen hat nicht geklappt${e.message ? ': ' + e.message : '.'}`, [['Nochmal versuchen', retry]]); break;
      case 'no_key': addSys('Es ist noch kein Schlüssel eingetragen.', [['Einrichten', () => openSetup()]]); break;
      case 'bad_key': addSys(`Der ${e.provider === 'groq' ? 'Groq' : 'Gemini'}-Schlüssel wird abgelehnt. Prüf ihn in den Einstellungen.`, [['Einstellungen', () => openSettings()], ['Nochmal versuchen', retry]]); break;
      case 'needs_gemini': addSys('Fotos und PDFs kann nur Gemini lesen, und Gemini antwortet gerade nicht. Versuch es später nochmal oder schreib die Aufgabe ab.', [['Nochmal versuchen', retry]]); break;
      case 'quota': {
        const at = e.resetAt ? new Date(e.resetAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : null;
        addSys(`Die kostenlosen Anfragen sind für heute aufgebraucht.${at ? ` Ab ${at} Uhr geht es wieder.` : ''}${s.groqKey ? '' : ' Mit einem Groq-Schlüssel als Reserve geht es meist weiter.'}`,
          s.groqKey ? [['Nochmal versuchen', retry]] : [['Groq eintragen', () => openSettings()], ['Nochmal versuchen', retry]]);
        break;
      }
      case 'format': addSys('Die Antwort kam in einem Format, das ich nicht zeichnen kann.', [['Nochmal versuchen', retry]]); break;
      default: {
        const offline = e instanceof TypeError || !navigator.onLine;
        addSys(offline ? 'Keine Verbindung zum Internet.' : `Das hat nicht geklappt${e.message ? ': ' + e.message : '.'}`, [['Nochmal versuchen', retry]]);
      }
    }
  }

  replay() {
    this.pause();
    for (const c of this.ctrls) c.abort();
    board.reset();
    T.replaceChildren();
    renderPrompt(this.l);
    const evs = this.l.script.map((it, i, arr) => ({ type: 'step', say: it.say, draw: it.els, newPage: i > 0 && it.page !== arr[i - 1].page, src: 'main', replay: true }));
    this.mainPage = 0; this.lastSrc = 'main';
    this.replaying = true;
    this.main = [...evs, ...this.main.filter((e) => !e.replay)];
    this.afterShown = false;
    this.paused = false; setPlayBtn(false);
    speaker.unlock();
    this.run();
  }

  stop() {
    for (const c of this.ctrls) c.abort();
    speaker.stop(); board.skip();
  }
}

// ---------------- Notizen und Quiz ----------------
function renderAfter(sess) {
  const l = sess.l;
  if (l.notes && (l.notes.points.length || l.notes.terms.length)) {
    const li = h('li', 'card notes');
    li.appendChild(h('h3', '', 'Notizen'));
    if (l.notes.points.length) {
      const ul = h('ul', 'points');
      for (const p of l.notes.points) ul.appendChild(h('li', '', p));
      li.appendChild(ul);
    }
    if (l.notes.terms.length) {
      const dl = h('dl', 'terms');
      for (const t of l.notes.terms) { dl.appendChild(h('dt', '', t.term)); dl.appendChild(h('dd', '', t.def)); }
      li.appendChild(dl);
    }
    const b = h('button', 'secondary', 'Notizen kopieren'); b.type = 'button';
    b.onclick = () => copyNotes(l);
    li.appendChild(b);
    addItem(li);
  }
  if (l.quiz && l.quiz.q.length) {
    l.quizState = l.quizState || {};
    const li = h('li', 'card quiz');
    li.appendChild(h('h3', '', 'Kurzes Quiz'));
    const score = h('p', 'score muted');
    const upd = () => {
      const answered = Object.keys(l.quizState).length;
      const right = l.quiz.q.filter((q, i) => l.quizState[i] === q.a).length;
      score.textContent = answered < l.quiz.q.length ? `${answered} von ${l.quiz.q.length} beantwortet` : `${right} von ${l.quiz.q.length} richtig`;
    };
    l.quiz.q.forEach((q, qi) => {
      const box = h('div', 'qitem');
      box.appendChild(h('p', 'qq', `${qi + 1}. ${q.q}`));
      const opts = h('div', 'opts');
      const why = h('div', 'why');
      const show = (chosen) => {
        opts.querySelectorAll('button').forEach((b, bi) => {
          b.disabled = true;
          b.classList.toggle('right', bi === q.a);
          b.classList.toggle('wrong', bi === chosen && chosen !== q.a);
        });
        why.replaceChildren();
        why.appendChild(h('p', chosen === q.a ? 'ok' : 'no', chosen === q.a ? 'Richtig.' : `Nicht ganz. Richtig ist: ${q.o[q.a]}`));
        if (q.why) why.appendChild(h('p', '', q.why));
        if (chosen !== q.a) {
          const b = h('button', 'secondary', 'An der Tafel erklären'); b.type = 'button';
          b.onclick = () => { b.disabled = true; sess.askQuiz(qi); };
          why.appendChild(b);
        }
      };
      q.o.forEach((o, oi) => {
        const b = h('button', 'opt', o); b.type = 'button';
        b.onclick = () => { l.quizState[qi] = oi; show(oi); upd(); sess.saveSoon(); };
        opts.appendChild(b);
      });
      box.appendChild(opts); box.appendChild(why);
      if (l.quizState[qi] != null) show(l.quizState[qi]);
      li.appendChild(box);
    });
    li.appendChild(score); upd();
    const reset = h('button', 'link', 'Quiz nochmal machen'); reset.type = 'button';
    reset.onclick = () => { l.quizState = {}; li.remove(); sess.afterShown = false; renderQuizOnly(sess); sess.saveSoon(); };
    li.appendChild(reset);
    addItem(li);
  }
}
function renderQuizOnly(sess) { const n = sess.l.notes; sess.l.notes = null; renderAfter(sess); sess.l.notes = n; sess.afterShown = true; }

function notesText(l) {
  const lines = [l.title || 'Lektion', ''];
  for (const p of l.notes?.points || []) lines.push('• ' + p);
  if (l.notes?.terms?.length) { lines.push(''); for (const t of l.notes.terms) lines.push(`${t.term}: ${t.def}`); }
  return lines.join('\n');
}
async function copyNotes(l) {
  if (!l.notes) { toast('Notizen gibt es am Ende der Lektion.'); return; }
  try { await navigator.clipboard.writeText(notesText(l)); toast('Notizen kopiert'); }
  catch { toast('Kopieren geht hier nicht'); }
}

// ---------------- Ansichten ----------------
function show(view) {
  S.view = view;
  for (const v of ['home', 'lesson', 'list']) $(v).hidden = v !== view;
  document.body.dataset.view = view;
  if (view !== 'lesson' && S.session) {
    if (!S.session.paused) { S.session.pause(true); S.session.hiddenPause = true; }
    speaker.stop();
    if ($('boardWrap').classList.contains('fs')) $('fullscreen').click();
  }
  window.scrollTo(0, 0);
}

function renderPrompt(l) {
  const files = l.fileNames || [];
  addMe(l.prompt || (files.length ? '' : '…'), files);
}

function openLesson(sess, { fresh = false } = {}) {
  const l = sess.l;
  $('lTitle').textContent = l.title || 'Lektion';
  show('lesson');
  if (fresh || S.session !== sess || !sess.rendered) {
    T.replaceChildren();
    if (fresh) board.reset();
    else board.load(l.pages);
    renderPrompt(l);
    for (const t of l.turns) {
      if (t.who === 'me') addMe(t.text);
      else addTutor(t.text, t.page ?? 0);
    }
    S.session = sess;
    sess.rendered = true;
    setWaitingUI(sess.waiting);
    if (!fresh) {
      if (sess.main.length) { setPlayBtn(true, 'Weiter abspielen'); sess.paused = true; addSys('Die Lektion war unterbrochen.', [['Weiter abspielen', () => sess.resume()]]); }
      else if (sess.waiting) setPlayBtn(true);
      else { sess.ended = true; setPlayBtn(true, 'Von vorn abspielen'); if (l.notes || l.quiz) { sess.afterShown = true; renderAfter(sess); } }
    } else setPlayBtn(false);
    T.scrollTop = T.scrollHeight;
  } else if (sess.hiddenPause) {
    sess.hiddenPause = false;
    sess.resume();
  }
}

async function route() {
  const hash = location.hash;
  const m = /^#\/l\/([\w-]+)/.exec(hash);
  if (m) {
    if (S.session && S.session.l.id === m[1]) { openLesson(S.session); return; }
    const l = await lessons.get(m[1]).catch(() => null);
    if (!l) { location.hash = '#/'; return; }
    if (S.session) S.session.stop();
    const sess = new Session(l);
    S.session = sess;
    openLesson(sess);
    return;
  }
  if (hash === '#/lektionen') { show('list'); renderList(); return; }
  show('home');
  renderRecent();
}
addEventListener('hashchange', route);

// ---------------- Start ----------------
function setMode(mode) {
  S.mode = mode;
  document.querySelectorAll('.mode').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
  $('q').placeholder = PLACEHOLDER[mode];
  const ex = $('examples'); ex.replaceChildren();
  for (const t of EXAMPLES[mode]) {
    const b = h('button', 'chip', t); b.type = 'button';
    b.onclick = () => { $('q').value = t; $('q').focus(); };
    ex.appendChild(b);
  }
}
document.querySelectorAll('.mode').forEach((b) => { b.onclick = () => setMode(b.dataset.mode); });

function renderFiles() {
  const u = $('files'); u.replaceChildren();
  S.files.forEach((f, i) => {
    const li = h('li', '', f.size ? `${f.name}, ${fmtSize(f.size)}` : f.name);
    const x = h('button', 'x'); x.type = 'button'; x.setAttribute('aria-label', f.name + ' entfernen');
    x.innerHTML = '<svg class="ic"><use href="#i-x"/></svg>';
    x.onclick = () => { S.files.splice(i, 1); renderFiles(); };
    li.appendChild(x); u.appendChild(li);
  });
}
const blobToB64 = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
async function imageToB64(file) {
  try {
    const bmp = await createImageBitmap(file);
    const sc = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    return { mime: 'image/jpeg', data: await blobToB64(blob) };
  } catch {
    return { mime: file.type || 'image/jpeg', data: await blobToB64(file) };
  }
}
const MAX_FILE = 2 * 1024 * 1024 * 1024; // Grenze der Gemini-Files-API
const fmtSize = (n) => (n >= 1024 * 1024 * 1024 ? (n / 1024 / 1024 / 1024).toFixed(1).replace('.', ',') + ' GB' : n >= 1024 * 1024 ? Math.round(n / 1024 / 1024) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
$('file').onchange = async (e) => {
  for (const file of [...e.target.files]) {
    const name = file.name || 'Foto';
    try {
      if (file.size > MAX_FILE) { toast(`${name} ist zu groß (höchstens 2 GB)`); continue; }
      const isImg = /^image\//.test(file.type) || /\.(heic|heif|jpe?g|png|webp)$/i.test(name);
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(name);
      if (isImg && file.size <= 25 * 1024 * 1024) S.files.push({ name, ...(await imageToB64(file)) });
      else if (isImg || isPdf) S.files.push({ name, mime: isPdf ? 'application/pdf' : (file.type || 'image/jpeg'), blob: file, size: file.size, id: uid() });
      else if (/^text\//.test(file.type) || /\.(txt|md|csv)$/i.test(name)) S.files.push({ name, text: await file.text() });
      else if (/\.(pptx?|key|docx?)$/i.test(name)) toast(`${name}: bitte vorher als PDF speichern`);
      else toast(`${name}: bitte als PDF, Foto oder Textdatei anhängen`);
    } catch { toast(`${name} ließ sich nicht lesen`); }
  }
  e.target.value = '';
  renderFiles();
};

$('ask').onsubmit = (e) => { e.preventDefault(); startLesson(); };
$('q').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); startLesson(); } });

async function startLesson() {
  const text = $('q').value.trim();
  if (!text && !S.files.length) { toast('Schreib eine Frage oder häng eine Datei an.'); $('q').focus(); return; }
  const st = settings.get();
  if (!st.geminiKey && !st.groqKey) { S.pendingStart = true; openSetup(); return; }
  if (!st.geminiKey && S.files.some((f) => f.data || f.blob)) { toast('Für Fotos und PDFs brauchst du einen Gemini-Schlüssel.'); openSettings(); return; }
  speaker.unlock();
  const big = S.files.filter((f) => f.blob);
  const bin = S.files.filter((f) => f.data || f.blob);
  const texts = S.files.filter((f) => f.text != null);
  const first = firstMessage({ mode: S.mode, text, texts, files: bin.map(({ name, mime, data, id, size }) => (data ? { name, mime, data } : { name, mime, id, size })) });
  const cache = new Map(big.map((f) => [f.id, f.blob]));
  for (const f of big) {
    try { await blobs.put(f.id, f.blob); }
    catch { toast(`${f.name} passt nicht in den Gerätespeicher. Nach 2 Tagen müsstest du sie neu anhängen.`); }
  }
  const lesson = {
    id: uid(), created: Date.now(), mode: S.mode,
    title: text ? shortTitle(text) : 'Lektion zu ' + S.files[0].name,
    prompt: text, fileNames: S.files.map((f) => f.name), first,
    turns: [], script: [], pages: [], notes: null, quiz: null, quizState: {}, done: false, model: '',
  };
  await lessons.save(lesson).catch(() => {});
  $('q').value = ''; S.files = []; renderFiles();
  if (S.session) S.session.stop();
  const sess = new Session(lesson);
  sess.blobCache = cache;
  S.session = sess;
  openLesson(sess, { fresh: true });
  history.pushState(null, '', '#/l/' + lesson.id);
  sess.request(null, 'main');
  sess.run();
}

// ---------------- Lektion: Bedienung ----------------
$('back').onclick = () => { if (history.length > 1 && /^#\/l\//.test(location.hash)) history.back(); else location.hash = '#/'; };
$('playPause').onclick = () => {
  const s = S.session; if (!s) return;
  if (s.ended && !s.main.length && !s.ins.length && !s.streaming) { s.ended = false; s.replay(); return; }
  if (s.waiting) { $('r').focus(); return; }
  if (s.paused) s.resume(); else s.pause();
};
$('reply').onsubmit = (e) => {
  e.preventDefault();
  const v = $('r').value.trim();
  if (!v || !S.session) return;
  $('r').value = '';
  S.session.ended = false;
  S.session.ask('question', v);
};
$('r').addEventListener('input', () => {
  const s = S.session;
  if (s && $('r').value && !s.paused && !s.waiting) s.pause(true);
});
$('r').addEventListener('blur', () => {
  const s = S.session;
  if (s && s.autoPaused && !$('r').value.trim() && !listener.active) setTimeout(() => { if (s.autoPaused && document.activeElement !== $('r')) s.resume(); }, 250);
});
$('quick').onclick = (e) => {
  const b = e.target.closest('[data-quick]'); const s = S.session;
  if (!b || !s) return;
  const k = b.dataset.quick;
  if (k === 'slower') {
    const st = settings.get();
    const rate = Math.max(0.7, +(st.rate - 0.1).toFixed(2)), speed = Math.max(0.6, +(st.speed - 0.2).toFixed(1));
    settings.set({ rate, speed }); applySettings();
    toast('Etwas langsamer');
    return;
  }
  if (!s.lastSay) { toast('Warte kurz, bis der erste Schritt da ist.'); return; }
  s.ended = false;
  s.ask(k, s.lastSay, k === 'retry' ? 'Erklär das bitte anders.' : 'Gib mir ein Beispiel aus der Praxis.');
};

// Mikrofon
function dictate(btn, onText, onEnd) {
  if (!listener.available) { toast('Diktieren geht in diesem Browser nicht. Nutze die Diktierfunktion der Tastatur.'); return; }
  if (listener.active) { listener.stop(); return; }
  const ok = listener.start((LANGS[settings.get().lang] || LANGS.de).tts, {
    onText,
    onEnd: (t) => { btn.classList.remove('rec'); onEnd && onEnd(t); },
    onError: (err) => { btn.classList.remove('rec'); if (err === 'not-allowed') toast('Bitte erlaube den Zugriff aufs Mikrofon.'); },
  });
  if (ok) btn.classList.add('rec');
}
$('micHome').onclick = () => {
  const base = $('q').value ? $('q').value.replace(/\s*$/, ' ') : '';
  dictate($('micHome'), (t) => { $('q').value = base + t; });
};
$('micLesson').onclick = () => {
  const s = S.session;
  if (s && !s.paused && !s.waiting) s.pause(true);
  speaker.stop();
  dictate($('micLesson'), (t) => { $('r').value = t; }, (t) => {
    if (t && S.session) { $('r').value = ''; S.session.ended = false; S.session.ask('question', t); }
    else if (s && s.autoPaused) s.resume();
  });
};

// Lektionsmenü
$('lMenuBtn').onclick = () => {
  const l = S.session?.l;
  $('lInfo').textContent = l ? `${MODE_NAME[l.mode]}, begonnen ${fmtDate(l.created)}${l.model ? `. Erklärt mit ${l.model}.` : '.'}` : '';
  $('lMenu').showModal();
};
$('lMenu').addEventListener('close', async () => {
  const v = $('lMenu').returnValue; const s = S.session;
  $('lMenu').returnValue = '';
  if (!s) return;
  if (v === 'replay') { s.ended = false; s.replay(); }
  else if (v === 'notes') copyNotes(s.l);
  else if (v === 'settings') openSettings();
  else if (v === 'delete') {
    if (!confirm('Diese Lektion löschen?')) return;
    s.stop(); await removeLesson(s.l); S.session = null; location.hash = '#/'; toast('Lektion gelöscht');
  }
});

async function removeLesson(l) {
  const ids = (l.first?.files || []).map((f) => f.id).filter(Boolean);
  if (ids.length) await blobs.remove(ids).catch(() => {});
  await lessons.remove(l.id);
}

// ---------------- Listen ----------------
function lessonItem(l, { del = false } = {}) {
  const li = h('li');
  const b = h('button', 'lesson-item'); b.type = 'button';
  b.appendChild(h('span', 'lt', l.title || 'Lektion'));
  b.appendChild(h('span', 'lm', `${MODE_NAME[l.mode] || ''}, ${fmtDate(l.updated)}${l.done ? '' : ', nicht fertig'}`));
  b.onclick = () => { location.hash = '#/l/' + l.id; };
  li.appendChild(b);
  if (del) {
    const x = h('button', 'icon-btn sm'); x.type = 'button'; x.setAttribute('aria-label', `„${l.title}“ löschen`);
    x.innerHTML = '<svg class="ic"><use href="#i-x"/></svg>';
    x.onclick = async () => {
      if (!confirm(`„${l.title}“ löschen?`)) return;
      await removeLesson(await lessons.get(l.id).catch(() => l) || l);
      if (S.session?.l.id === l.id) { S.session.stop(); S.session = null; }
      renderList();
    };
    li.appendChild(x);
  }
  return li;
}
async function renderRecent() {
  const all = await lessons.list().catch(() => []);
  $('recentWrap').hidden = !all.length;
  const u = $('recent'); u.replaceChildren();
  all.slice(0, 3).forEach((l) => u.appendChild(lessonItem(l)));
}
async function renderList() {
  const all = await lessons.list().catch(() => []);
  const u = $('allList'); u.replaceChildren();
  all.forEach((l) => u.appendChild(lessonItem(l, { del: true })));
  $('listEmpty').hidden = all.length > 0;
}
$('toLessons').onclick = () => { location.hash = '#/lektionen'; };
$('allLessons').onclick = () => { location.hash = '#/lektionen'; };
$('listBack').onclick = () => { location.hash = '#/'; };
$('listNew').onclick = () => { location.hash = '#/'; setTimeout(() => $('q').focus(), 50); };

// ---------------- Einstellungen ----------------
function fillVoices() {
  const s = settings.get();
  const sel = $('sVoiceURI');
  const vs = voicesFor((LANGS[s.lang] || LANGS.de).tts);
  sel.replaceChildren(new Option('Automatisch', ''));
  for (const v of vs) sel.appendChild(new Option(v.name, v.voiceURI));
  sel.value = vs.some((v) => v.voiceURI === s.voiceURI) ? s.voiceURI : '';
}
if (window.speechSynthesis) speechSynthesis.addEventListener?.('voiceschanged', fillVoices);
function openSettings() {
  const s = settings.get();
  $('sGemini').value = s.geminiKey; $('sGroq').value = s.groqKey;
  $('sVoice').checked = s.voice; $('sAuto').checked = s.auto;
  $('sRate').value = s.rate; $('sSpeed').value = s.speed;
  const lang = $('sLang'); lang.replaceChildren();
  for (const [k, v] of Object.entries(LANGS)) lang.appendChild(new Option(v.name, k));
  lang.value = s.lang;
  $('sAbout').value = s.about;
  document.querySelectorAll('input[name=theme]').forEach((r) => { r.checked = r.value === s.theme; });
  $('keyResult').textContent = '';
  fillVoices();
  $('settings').showModal();
}
$('toSettings').onclick = openSettings;
const bindSetting = (id, key, conv = (v) => v, prop = 'value') => {
  $(id).addEventListener('change', () => { settings.set({ [key]: conv($(id)[prop]) }); applySettings(); if (key === 'lang') fillVoices(); });
};
bindSetting('sGemini', 'geminiKey', (v) => v.trim());
bindSetting('sGroq', 'groqKey', (v) => v.trim());
bindSetting('sVoice', 'voice', Boolean, 'checked');
bindSetting('sAuto', 'auto', Boolean, 'checked');
bindSetting('sRate', 'rate', Number);
bindSetting('sSpeed', 'speed', Number);
bindSetting('sVoiceURI', 'voiceURI');
bindSetting('sLang', 'lang');
bindSetting('sAbout', 'about', (v) => v.trim());
document.querySelectorAll('input[name=theme]').forEach((r) => r.addEventListener('change', () => { settings.set({ theme: r.value }); applySettings(); }));
document.querySelectorAll('.eye').forEach((b) => {
  b.onclick = () => { const i = $(b.dataset.eye); const v = i.type === 'password'; i.type = v ? 'text' : 'password'; b.textContent = v ? 'Verbergen' : 'Zeigen'; };
});
$('testKeys').onclick = async () => {
  settings.set({ geminiKey: $('sGemini').value.trim(), groqKey: $('sGroq').value.trim() });
  const s = settings.get();
  const out = $('keyResult');
  out.textContent = 'Prüfe …';
  const r = new Router({ keys: { gemini: s.geminiKey, groq: s.groqKey }, store: routerStore });
  routerStore.clear();
  const lines = [];
  for (const [p, name] of [['gemini', 'Gemini'], ['groq', 'Groq']]) {
    if (!s[p + 'Key']) { lines.push(`${name}: kein Schlüssel`); continue; }
    try {
      const list = await r.models(p);
      lines.push(list.length ? `${name}: funktioniert, nutzt ${list[0]}` : `${name}: Schlüssel gültig, aber kein passendes Modell gefunden`);
    } catch (e) {
      lines.push(`${name}: ${e.code === 'bad_key' ? 'Schlüssel wird abgelehnt' : e instanceof TypeError ? 'keine Verbindung' : 'Fehler, ' + e.message}`);
    }
  }
  out.textContent = lines.join('. ') + '.';
};
$('wipe').onclick = async () => {
  if (!confirm('Wirklich alle Lektionen löschen? Das lässt sich nicht rückgängig machen.')) return;
  if (S.session) { S.session.stop(); S.session = null; }
  await lessons.clear(); await blobs.clear().catch(() => {}); toast('Alle Lektionen gelöscht'); renderRecent();
};

// Ersteinrichtung
function openSetup() { $('setupErr').textContent = ''; $('setupKey').value = settings.get().geminiKey; $('setup').showModal(); }
$('setupClose').onclick = () => { S.pendingStart = false; $('setup').close(); };
$('setupForm').onsubmit = async (e) => {
  e.preventDefault();
  const key = $('setupKey').value.trim();
  if (!key) return;
  $('setupSave').disabled = true; $('setupErr').textContent = '';
  try {
    const r = new Router({ keys: { gemini: key }, store: routerStore });
    routerStore.clear();
    await r.models('gemini');
    settings.set({ geminiKey: key });
    $('setup').close();
    toast('Schlüssel gespeichert');
    if (S.pendingStart) { S.pendingStart = false; startLesson(); }
  } catch (err) {
    $('setupErr').textContent = err.code === 'bad_key' ? 'Google lehnt diesen Schlüssel ab. Prüf, ob er vollständig kopiert ist.' : err instanceof TypeError ? 'Keine Verbindung. Prüf dein Internet.' : 'Das hat nicht geklappt: ' + err.message;
  } finally { $('setupSave').disabled = false; }
};

// ---------------- Überschrift, die sich selbst schreibt ----------------
function heroInk() {
  const svg = $('heroInk'); const NS = 'http://www.w3.org/2000/svg';
  svg.replaceChildren();
  const t = document.createElementNS(NS, 'text');
  t.setAttribute('x', 2); t.setAttribute('y', 92); t.setAttribute('class', 'hero-t');
  t.textContent = 'Wo hängst du fest?';
  svg.appendChild(t);
  const u = document.createElementNS(NS, 'path');
  u.setAttribute('class', 'hero-u');
  svg.appendChild(u);
  const bb = t.getBBox();
  const x1 = bb.x + 4, x2 = bb.x + bb.width * 0.98, y = bb.y + bb.height + 6;
  u.setAttribute('d', `M${x1} ${y + 3} Q${(x1 + x2) / 2} ${y - 5} ${x2} ${y + 1}`);
  if (reduced) return;
  const cp = document.createElementNS(NS, 'clipPath'); cp.id = 'heroClip';
  const cr = document.createElementNS(NS, 'rect');
  cr.setAttribute('x', bb.x - 4); cr.setAttribute('y', bb.y - 10); cr.setAttribute('height', bb.height + 20); cr.setAttribute('width', 0);
  cp.appendChild(cr); svg.appendChild(cp);
  t.setAttribute('clip-path', 'url(#heroClip)');
  const len = u.getTotalLength();
  u.style.strokeDasharray = len; u.style.strokeDashoffset = len;
  const t0 = performance.now(), D1 = 1300, D2 = 450;
  const step = (now) => {
    const k = Math.max(0, Math.min(1, (now - t0) / D1));
    cr.setAttribute('width', (bb.width + 10) * k);
    const k2 = Math.max(0, Math.min(1, (now - t0 - D1) / D2));
    u.style.strokeDashoffset = len * (1 - k2);
    if (k2 < 1) requestAnimationFrame(step); else t.removeAttribute('clip-path');
  };
  requestAnimationFrame(step);
}

// ---------------- Los ----------------
applySettings();
setMode('topic');
(document.fonts ? document.fonts.ready : Promise.resolve()).then(heroInk);
if (!location.hash) history.replaceState(null, '', '#/');
route();
addEventListener('pagehide', () => { if (S.session) S.session.saveNow(); });
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__tutorSession = () => S.session; // nur für Tests
document.addEventListener('visibilitychange', () => { if (document.hidden && S.session) S.session.saveNow(); });
