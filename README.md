# Tutor

Ein persönlicher KI-Tutor, der Schritt für Schritt erklärt und dabei an eine Tafel zeichnet.
Läuft komplett im Browser (auch als App auf dem Handy installierbar) und nutzt die kostenlosen
Stufen von **Google Gemini** und, als Reserve, **Groq**.

## Was er kann
- **Thema**: erklärt ein Thema mit Skizzen, Abläufen und Gegenüberstellungen.
- **Prüfung**: geht deine Unterlagen (Fotos, PDF, Text) durch, warnt vor typischen Fallen, Quiz am Ende.
  Dateien bis 2 GB: große PDFs werden über die Gemini-Files-API hochgeladen (dort 48 Stunden gespeichert);
  das Original bleibt auf dem Gerät und wird bei Bedarf automatisch neu hochgeladen.
- **Hausaufgabe**: gibt Hinweise statt der fertigen Lösung und wartet auf deine Antwort.
- Jederzeit dazwischenfragen (Text oder Sprache), „Anders erklären“, „Beispiel aus der Praxis“.
- Vorlesen und Diktieren über die Sprachfunktionen des Browsers.
- Notizen und Quiz am Ende, falsche Antworten werden an der Tafel erklärt.
- Alle Lektionen werden auf dem Gerät gespeichert und lassen sich wieder abspielen.
- Hell als Karopapier, dunkel als Schiefertafel.

## Einrichten
1. Kostenlosen Gemini-Schlüssel holen: <https://aistudio.google.com/apikey>
2. Optional einen Groq-Schlüssel als Reserve: <https://console.groq.com/keys>
3. In der App unter Einstellungen eintragen. Die Schlüssel bleiben im Browser des Geräts.

Hinweis: In der kostenlosen Gemini-Stufe darf Google Eingaben zur Verbesserung seiner Dienste nutzen.
Der Tutor kann sich irren – Wichtiges mit Skript oder Atlas prüfen.

## Aufbau
- `index.html`, `css/app.css` – Oberfläche
- `js/app.js` – Ablauf der Lektionen
- `js/board.js` – Tafel mit Zeichen-Animation (SVG 800 × 600)
- `js/layout.js` – Prüfen und Anordnen der Tafel-Elemente
- `js/prompt.js` – Anweisungen an das Modell
- `js/providers.js` – Gemini/Groq, Modellwahl und automatischer Wechsel bei Tageslimit
- `js/stream.js` – liest die Antwort Stück für Stück
- `sw.js`, `manifest.webmanifest`, `icons/` – installierbare Web-App, offline nutzbar

## Tests
```
node --test tests/*.test.mjs   # Kernlogik
python3 tests/e2e.py           # Browser-Test mit nachgebauter API (Playwright)
```
