// Holt vollständige JSON-Objekte aus einem Text-Stream (Modellantwort Stück für Stück).
// Alles außerhalb von {...} wird ignoriert (Markdown, Erklärtext, Array-Klammern),
// ebenso Denk-Blöcke <think>…</think>.

export class ObjectStream {
  constructor() {
    this.buf = '';      // Text des Objekts, das gerade gesammelt wird
    this.depth = 0;     // Tiefe der geschweiften Klammern
    this.inStr = false; // gerade innerhalb eines Strings?
    this.esc = false;   // letztes Zeichen war ein Backslash
    this.think = false; // innerhalb <think>…</think>
    this.tail = '';     // Rest für die Erkennung von <think>-Tags über Chunk-Grenzen
  }

  push(chunk) {
    const out = [];
    let text = this.tail + chunk;
    this.tail = '';
    let i = 0;
    while (i < text.length) {
      if (this.depth === 0) {
        if (this.think) {
          const end = text.indexOf('</think>', i);
          if (end < 0) { this.tail = keepTail(text, '</think>'); return out; }
          this.think = false; i = end + 8; continue;
        }
        const ch = text[i];
        if (ch === '<') {
          const rest = text.slice(i, i + 7);
          if (rest === '<think>') { this.think = true; i += 7; continue; }
          if ('<think>'.startsWith(rest) && i + rest.length === text.length) { this.tail = rest; return out; }
          i++; continue;
        }
        if (ch === '{') { this.depth = 1; this.buf = '{'; this.inStr = false; this.esc = false; }
        i++; continue;
      }
      const ch = text[i];
      this.buf += ch;
      if (this.inStr) {
        if (this.esc) this.esc = false;
        else if (ch === '\\') this.esc = true;
        else if (ch === '"') this.inStr = false;
      } else if (ch === '"') this.inStr = true;
      else if (ch === '{') this.depth++;
      else if (ch === '}') {
        this.depth--;
        if (this.depth === 0) {
          const obj = parseLoose(this.buf);
          if (obj && typeof obj === 'object' && !Array.isArray(obj)) out.push(obj);
          this.buf = '';
        }
      }
      i++;
    }
    return out;
  }

  end() {
    this.buf = ''; this.depth = 0; this.tail = '';
    return [];
  }
}

function keepTail(text, tag) {
  for (let n = Math.min(tag.length - 1, text.length); n > 0; n--) {
    if (tag.startsWith(text.slice(text.length - n))) return text.slice(text.length - n);
  }
  return '';
}

// JSON.parse mit kleiner Reparatur: Kommas vor ] oder } (außerhalb von Strings) entfernen.
export function parseLoose(s) {
  try { return JSON.parse(s); } catch { /* weiter */ }
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      out += ch;
      if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; out += ch; continue; }
    if (ch === ',') {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] === '}' || s[j] === ']') continue;
    }
    out += ch;
  }
  try { return JSON.parse(out); } catch { return null; }
}
