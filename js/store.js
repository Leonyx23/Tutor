// Einstellungen (localStorage) und Lektionen (IndexedDB) – alles bleibt auf diesem Gerät.

const P = 'tutor.';

export const DEFAULTS = {
  geminiKey: '', groqKey: '',
  voice: true, voiceURI: '', rate: 1, speed: 1, auto: true,
  lang: 'de', theme: 'auto',
  about: 'Ich mache eine Ausbildung zur Physiotherapeutin, Schwerpunkt Anatomie und Physiologie.',
};

function read(k, d) { try { const v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch { return d; } }
function write(k, v) { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch { /* voll oder gesperrt */ } }

export const settings = {
  get() { return { ...DEFAULTS, ...read('settings', {}) }; },
  set(patch) { const s = { ...this.get(), ...patch }; write('settings', s); return s; },
};

// Kleiner Speicher für den Router (Modelllisten, gesperrte Modelle)
export const routerStore = {
  get(k) { return read('router', {})[k]; },
  set(k, v) { const all = read('router', {}); all[k] = v; write('router', all); },
  clear() { write('router', {}); },
};

// ---------- IndexedDB ----------
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open('tutor', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('lessons')) d.createObjectStore('lessons', { keyPath: 'id' }).createIndex('updated', 'updated');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
function tx(mode, fn) {
  return db().then((d) => new Promise((res, rej) => {
    const t = d.transaction('lessons', mode);
    const st = t.objectStore('lessons');
    let out;
    Promise.resolve(fn(st)).then((v) => { out = v; });
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const lessons = {
  save(l) { l.updated = Date.now(); return tx('readwrite', (st) => req(st.put(structuredClone(l)))); },
  get(id) { return tx('readonly', (st) => req(st.get(id))); },
  async list() {
    const all = await tx('readonly', (st) => req(st.getAll()));
    return (all || []).map((l) => ({ id: l.id, title: l.title, mode: l.mode, updated: l.updated, created: l.created, done: l.done, prompt: l.prompt }))
      .sort((a, b) => b.updated - a.updated);
  },
  remove(id) { return tx('readwrite', (st) => req(st.delete(id))); },
  clear() { return tx('readwrite', (st) => req(st.clear())); },
};
