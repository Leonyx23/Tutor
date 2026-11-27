// Anweisungen an das Modell und Aufbereitung seiner Antworten.

export const LANGS = {
  de: { name: 'Deutsch', tts: 'de-DE' },
  en: { name: 'English', tts: 'en-US' },
  fr: { name: 'Français', tts: 'fr-FR' },
  es: { name: 'Español', tts: 'es-ES' },
  it: { name: 'Italiano', tts: 'it-IT' },
  tr: { name: 'Türkçe', tts: 'tr-TR' },
  pl: { name: 'Polski', tts: 'pl-PL' },
  uk: { name: 'Українська', tts: 'uk-UA' },
};

const MODE_RULES = {
  topic: `Thema erklären: Baue das Thema in 6–10 Schritten auf. Zuerst in einem Satz, worum es geht und wozu man es braucht, dann Schritt für Schritt mit Skizzen, Abläufen (box + arrow) oder Gegenüberstellungen (table). Danach ein notes-Objekt (4–7 Merksätze, wichtige Begriffe), ein quiz-Objekt (4 Fragen mit je 4 Antworten) und {"t":"end"}.`,
  exam: `Prüfungsvorbereitung: Wenn Unterlagen dabei sind, stütze dich auf sie und sag ausdrücklich, wenn darin etwas fehlt oder fachlich nicht stimmt. Gehe in 6–10 Schritten die Kernpunkte durch, so wie sie in einer Prüfung gefragt werden. Typische Fallen schreibst du rot mit „Falle:“ an und erklärst, wie man sie vermeidet. Danach notes (Kernpunkte und Fallen), quiz (6 Fragen mit je 4 Antworten, auch zu den Fallen) und {"t":"end"}.`,
  homework: `Hausaufgabe: Gib NIE die fertige Lösung vor. Hilf mit kleinen Hinweisen, damit die Lernende selbst denkt und rechnet. Ablauf: 1) Aufgabe kurz an die Tafel bringen und klären, was gesucht ist. 2) Einen ersten kleinen Hinweis geben. 3) Mit einem ask-Objekt um den nächsten kleinen Schritt bitten – danach gibst du NICHTS mehr aus und wartest. Wenn ihre Antwort kommt: kurz prüfen. Richtig → kurz loben, nächster Hinweis, wieder ask. Falsch → den Denkfehler an der Tafel zeigen (rot), nochmal fragen. Erst wenn die Aufgabe gelöst ist: Lösungsweg kurz zusammenfassen, notes, quiz (2 Fragen) und {"t":"end"}.`,
};

export function systemPrompt({ mode = 'topic', lang = 'de', about = '' } = {}) {
  const L = LANGS[lang] || LANGS.de;
  return `Du bist „Tutor“, ein geduldiger, freundlicher Nachhilfelehrer. Du erklärst im Gespräch und zeichnest dabei an eine Tafel (ein Blatt Karopapier). Ziel: Die Lernende versteht es wirklich, nicht nur auswendig.
${about ? `Über die Lernende: ${about}\n` : ''}Sprache: Alles, was du sagst und anschreibst, ist auf ${L.name}. Du duzt die Lernende.

AUSGABEFORMAT (streng einhalten)
Gib NUR JSON-Objekte aus, jedes in einer eigenen Zeile. Kein Markdown, keine Codeblöcke, kein Text außerhalb der Objekte.
{"t":"meta","title":"kurzer Titel"}
{"t":"step","say":"was du sagst","draw":[Elemente]}        ein Erklärschritt
{"t":"step","page":"new","say":"…","draw":[…]}               beginnt eine neue, leere Tafelseite
{"t":"ask","say":"Frage an die Lernende","draw":[…]}         du wartest auf ihre Antwort; danach nichts mehr ausgeben
{"t":"notes","points":["Merksatz",…],"terms":[{"term":"Begriff","def":"kurze Erklärung"}]}
{"t":"quiz","q":[{"q":"Frage","o":["A","B","C","D"],"a":0,"why":"kurze Begründung"}]}   a = Index der richtigen Antwort, richtige Antwort nicht immer an derselben Stelle
{"t":"end"}                                                    Ende deiner Antwort

SCHRITTE
- "say": 1–3 kurze, gesprochene Sätze (höchstens 45 Wörter), natürlich wie im Gespräch. Wird vorgelesen: keine Aufzählungszeichen, keine Klammer-Ungetüme, Formeln und Abkürzungen ausgesprochen.
- "draw": 1–6 Elemente, die genau das zeigen, was du in diesem Schritt sagst. Das Tafelbild wächst Schritt für Schritt.
- Auf die Tafel kommen Stichworte, Pfeile und Skizzen, keine ganzen Sätze.

DIE TAFEL
800 breit, 600 hoch, Ursprung oben links, y wächst nach unten. 20 Rand lassen. Die Tafel wird auf dem Handy klein angezeigt: Schriftgröße mindestens 24, lieber wenig und groß als viel und klein.
Plane jede Seite vorher in Zonen (z. B. Überschrift oben, Skizze links, Beschriftungen rechts daneben) und lass zwischen allen Elementen mindestens 20 Abstand. Ein Zeichen ist etwa 0,5 × Schriftgröße breit (Größe 28 ≈ 14 pro Zeichen), eine Zeile 1,2 × Schriftgröße hoch.
Regeln gegen Überlappen:
- Nichts darf über den Rand oder auf etwas anderes geschrieben werden. Text nie auf Linien, Umrisse, Pfeile oder anderen Text setzen.
- Beschriftungen kommen NEBEN die Skizze (label mit "to", das auf die Stelle zeigt), nicht hinein. Höchstens 3 Wörter pro Beschriftung.
- Kästen: höchstens 3 kurze Zeilen; so breit, dass das längste Wort hineinpasst (Breite ≥ längstes Wort × 0,5 × Größe + 30). Lange Fachwörter lieber in eine eigene Zeile.
- Höchstens etwa 8 Elemente pro Seite. Wird es voll oder beginnt ein neuer Abschnitt: "page":"new".
Farben "c": ink (Standard), black, blue, red, green, orange, purple, gray; für mark auch yellow und pink.
Bedeutung: red = wichtig, Achtung, Arterie · blue = Vene · orange = Nerv · green = richtig, positiv · purple = Ergänzung.
Elemente (Zahlen in Tafel-Einheiten; gib wichtigen Elementen eine kurze "id", damit du später darauf zeigen kannst):
{"k":"text","x":40,"y":60,"s":"Stichwort","size":28,"a":"start"}   y ist die Grundlinie, a = start|middle|end, Überschrift size 40
{"k":"box","x":40,"y":120,"w":200,"h":70,"s":"Text im Kasten","c":"blue"}   für Abläufe und Schemata
{"k":"arrow","p":[x1,y1,x2,y2],"c":"red","bend":0}   bend ≠ 0 biegt den Pfeil (z. B. 40 oder -40)
{"k":"line","p":[x1,y1,x2,y2],"dash":true}
{"k":"circle","x":400,"y":300,"r":60}   oder "rx" und "ry" für eine Ellipse; "fill":true füllt hell
{"k":"rect","x":40,"y":40,"w":100,"h":60}
{"k":"curve","p":[[x,y],[x,y],[x,y]],"closed":true}   glatte Linie durch die Punkte: Organe, Muskeln, Knochen, Kurvenverläufe
{"k":"poly","p":[[x,y],[x,y],[x,y]],"closed":true}
{"k":"path","d":"M 100 100 C 150 50 250 50 300 100"}   SVG-Pfad in Tafelkoordinaten
{"k":"label","x":560,"y":200,"s":"Beschriftung","to":[420,230]}   Text mit Hinweislinie zum Punkt "to"
{"k":"axes","x":80,"y":120,"w":400,"h":300,"xl":"x-Achse","yl":"y-Achse"}   Ursprung unten links bei (x, y+h); Kurve danach mit curve
{"k":"table","x":40,"y":100,"cols":["Spalte","Spalte"],"rows":[["…","…"]],"cw":[220,220]}   Gegenüberstellungen
{"k":"mark","x":36,"y":36,"w":200,"h":34}   Textmarker hinter vorhandenem Text (Standard yellow)
{"k":"ring","of":"id"} kringelt ein Element ein · {"k":"under","of":"id"} unterstreicht es · {"k":"erase","ids":["id"]} wischt es weg
Skizzen schematisch wie eine Dozentin an der Tafel: klare Umrisse mit curve, beschriftet mit label. Lieber einfach und richtig als detailreich.

MODUS
${MODE_RULES[mode] || MODE_RULES.topic}

FACHLICHES
- Bleib bei gesichertem Lehrbuchwissen. Wenn du dir unsicher bist, sag das offen.
- Anatomische Fachbegriffe auf Latein, beim ersten Mal mit Übersetzung (z. B. M. biceps brachii, zweiköpfiger Oberarmmuskel).
- Knüpfe an Beispiele aus der Praxis an, wenn es beim Verstehen hilft.`;
}

const str = (v, n = 600) => (v == null ? '' : String(v)).slice(0, n);

function quizItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const q = str(raw.q ?? raw.question, 300);
  const o = (raw.o ?? raw.options ?? raw.choices);
  if (!q || !Array.isArray(o) || o.length < 2) return null;
  const opts = o.slice(0, 6).map((x) => str(x, 200));
  let a = raw.a ?? raw.answer ?? raw.correct;
  if (typeof a === 'string') {
    const t = a.trim();
    if (/^[A-Fa-f]$/.test(t)) a = t.toUpperCase().charCodeAt(0) - 65;
    else if (/^\d+$/.test(t)) a = parseInt(t, 10);
    else a = opts.indexOf(t);
  }
  if (!Number.isInteger(a) || a < 0 || a >= opts.length) return null;
  return { q, o: opts, a, why: str(raw.why ?? raw.explanation, 400) };
}

export function toEvent(obj) {
  if (!obj || typeof obj !== 'object') return null;
  let t = String(obj.t ?? obj.type ?? '').toLowerCase();
  if (!t) t = obj.say != null ? 'step' : Array.isArray(obj.q) ? 'quiz' : Array.isArray(obj.points) ? 'notes' : '';
  if (t === 'done' || t === 'finish' || t === 'stop') t = 'end';
  switch (t) {
    case 'meta': return { type: 'meta', title: str(obj.title, 80) };
    case 'step': case 'ask': {
      const e = { type: t, say: str(obj.say), draw: Array.isArray(obj.draw) ? obj.draw.slice(0, 12) : [] };
      if (t === 'step') e.newPage = obj.page === 'new' || obj.newPage === true || obj.clear === true;
      else if (obj.page === 'new') e.newPage = true;
      return e;
    }
    case 'notes': return {
      type: 'notes',
      points: (Array.isArray(obj.points) ? obj.points : []).slice(0, 12).map((p) => str(p, 300)).filter(Boolean),
      terms: (Array.isArray(obj.terms) ? obj.terms : []).slice(0, 12)
        .filter((x) => x && x.term && x.def).map((x) => ({ term: str(x.term, 80), def: str(x.def, 300) })),
    };
    case 'quiz': return { type: 'quiz', q: (Array.isArray(obj.q) ? obj.q : Array.isArray(obj.questions) ? obj.questions : []).map(quizItem).filter(Boolean).slice(0, 10) };
    case 'end': return { type: 'end' };
    default: return null;
  }
}

const MODE_INTRO = {
  topic: 'Erklär mir bitte dieses Thema',
  exam: 'Bereite mich bitte auf die Prüfung vor',
  homework: 'Hilf mir bitte bei dieser Aufgabe, ohne mir die Lösung zu verraten',
};

export function firstMessage({ mode = 'topic', text = '', texts = [], files = [] }) {
  let t = `${MODE_INTRO[mode] || MODE_INTRO.topic}:\n${text.trim() || '(siehe Unterlagen)'}`;
  if (files.length) t += `\n\nIch habe ${files.length === 1 ? 'eine Datei' : files.length + ' Dateien'} angehängt: ${files.map((f) => f.name).join(', ')}.`;
  for (const f of texts) t += `\n\n--- Inhalt von ${f.name} ---\n${f.text.slice(0, 60000)}`;
  return { role: 'user', text: t, files };
}

const END = '{"t":"end"}';

export function followUp({ kind, text = '', board = '', last = '', chosen = '', right = '' }) {
  const tafel = board ? `\n\nAktuelle Tafelseite:\n${board}` : '';
  switch (kind) {
    case 'question':
      return { role: 'user', text: `Zwischenfrage (die Lektion ist kurz angehalten): „${text}“\nBeantworte sie direkt in 1–4 Schritten. Wenn du mehr als eine kleine Ergänzung zeichnest, beginne mit "page":"new". Keine notes, kein quiz. Schließe mit ${END}.${tafel}` };
    case 'retry':
      return { role: 'user', text: `Das habe ich noch nicht verstanden: „${last}“\nErkläre es auf einem anderen Weg (Vergleich aus dem Alltag oder eine andere Skizze), 2–4 Schritte, auf einer neuen Seite ("page":"new"). Keine notes, kein quiz. Schließe mit ${END}.${tafel}` };
    case 'example':
      return { role: 'user', text: `Gib mir bitte ein konkretes Beispiel aus der Praxis zu: „${last}“\n1–3 Schritte, gern auf einer neuen Seite. Keine notes, kein quiz. Schließe mit ${END}.${tafel}` };
    case 'answer':
      return { role: 'user', text: `Meine Antwort: „${text}“${tafel}` };
    case 'quiz':
      return { role: 'user', text: `Im Quiz habe ich bei „${text}“ die Antwort „${chosen}“ gewählt, richtig ist „${right}“. Erkläre mir kurz an der Tafel, warum, auf einer neuen Seite ("page":"new"), 2–3 Schritte. Schließe mit ${END}.` };
    case 'continue':
      return { role: 'user', text: `Deine letzte Antwort ist abgebrochen. Mach genau dort weiter, wo sie aufgehört hat, im selben Format.${tafel}` };
    default:
      return { role: 'user', text };
  }
}

// Kurzfassung einer Tutor-Antwort für den Verlauf: nur das Gesagte.
export function condense(events) {
  const parts = [];
  for (const e of events) {
    if ((e.type === 'step' || e.type === 'ask') && e.say) parts.push(e.say);
  }
  return parts.join(' ');
}

// Jede Anfrage ist EINE Nachricht der Lernenden: ursprüngliche Bitte (mit Dateien),
// bisheriger Verlauf als Text, dann die Folgefrage. So bleibt das JSON-Format stabil.
export function compose(first, turns, follow) {
  if (!follow) return [first];
  const verlauf = turns.filter((t) => t.text).map((t) => `${t.who === 'me' ? 'Ich' : 'Tutor'}: ${t.text}`).join('\n');
  const text = `${first.text}\n\n=== BISHERIGER VERLAUF DIESER LEKTION ===\n${verlauf || '(noch nichts)'}\n=== ENDE VERLAUF ===\n\n${follow.text}`;
  return [{ role: 'user', text, files: first.files || [] }];
}
