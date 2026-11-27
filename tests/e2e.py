"""Browser-Test mit nachgebauter Gemini-/Groq-API. Aufruf: python3 tests/e2e.py [ausgabeordner]"""
import json, sys, subprocess, time, os, socket
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/tutor-shots'
os.makedirs(OUT, exist_ok=True)

LESSON = [
 {"t":"meta","title":"Die Muskelpumpe"},
 {"t":"step","say":"Schau dir zuerst eine Beinvene an. Sie liegt zwischen zwei Muskeln.","draw":[{"k":"text","x":30,"y":55,"s":"Muskelpumpe","size":40,"id":"title"},{"k":"curve","p":[[300,110],[290,250],[300,400],[290,540]],"c":"blue","id":"w1"},{"k":"curve","p":[[360,110],[350,250],[360,400],[350,540]],"c":"blue","id":"w2"},{"k":"label","x":440,"y":140,"s":"Vene","to":[355,160],"c":"blue"}]},
 {"t":"step","say":"Links und rechts liegen Skelettmuskeln. Wenn sie sich anspannen, werden sie dicker und drücken auf die Vene.","draw":[{"k":"circle","x":200,"y":330,"rx":60,"ry":150,"c":"red","fill":True,"id":"m1"},{"k":"circle","x":460,"y":330,"rx":60,"ry":150,"c":"red","fill":True,"id":"m2"},{"k":"arrow","p":[250,330,290,330],"c":"red"},{"k":"arrow","p":[410,330,370,330],"c":"red"},{"k":"label","x":560,"y":260,"s":"Muskel spannt an","to":[500,300],"c":"red"}]},
 {"t":"step","say":"In der Vene sitzen Klappen. Sie lassen das Blut nur Richtung Herz durch.","draw":[{"k":"poly","p":[[300,260],[325,235],[350,260]],"id":"k1"},{"k":"poly","p":[[300,450],[325,425],[350,450]],"id":"k2"},{"k":"arrow","p":[325,520,325,140],"c":"green","lw":4},{"k":"label","x":560,"y":470,"s":"Venenklappen","to":[340,445]},{"k":"text","x":560,"y":120,"s":"zum Herzen","c":"green"}]},
 {"t":"step","page":"new","say":"Zusammengefasst: Muskelarbeit pumpt das Blut zurück zum Herzen.","draw":[{"k":"box","x":40,"y":80,"w":200,"h":80,"s":"Muskel spannt an","c":"red"},{"k":"arrow","p":[240,120,300,120]},{"k":"box","x":300,"y":80,"w":200,"h":80,"s":"Vene wird gedrückt","c":"blue"},{"k":"arrow","p":[500,120,560,120]},{"k":"box","x":560,"y":80,"w":200,"h":80,"s":"Blut fließt zum Herzen","c":"green","id":"b3"},{"k":"ring","of":"b3"},{"k":"table","x":40,"y":240,"cols":["Bewegung","Folge"],"rows":[["Gehen","guter Rückfluss"],["langes Stehen","Blut staut sich"]],"cw":[300,360]},{"k":"mark","x":40,"y":400,"w":250,"h":34},{"k":"text","x":46,"y":428,"s":"Beine bewegen!","size":30,"bold":True}]},
 {"t":"notes","points":["Venen haben Klappen, die einen Rückfluss verhindern.","Kontrahierende Muskeln drücken die tiefen Venen zusammen."],"terms":[{"term":"Muskelpumpe","def":"Rückfluss des venösen Blutes durch Muskelkontraktion"}]},
 {"t":"quiz","q":[{"q":"Was verhindert den Rückfluss in den Beinvenen?","o":["Venenklappen","Arterien","Lymphknoten","Sehnen"],"a":0,"why":"Die Klappen schließen, sobald das Blut zurückfließen will."},{"q":"Wann arbeitet die Muskelpumpe am wenigsten?","o":["Beim Gehen","Beim Radfahren","Beim langen Stehen","Beim Treppensteigen"],"a":2,"why":"Ohne Muskelarbeit fehlt der Druck auf die Venen."}]},
 {"t":"end"},
]
ANSWER = [
 {"t":"step","page":"new","say":"Gute Frage! Venen haben dünnere Wände als Arterien.","draw":[{"k":"text","x":40,"y":60,"s":"Arterie und Vene","size":36},{"k":"circle","x":200,"y":250,"r":80,"c":"red"},{"k":"circle","x":200,"y":250,"r":50,"c":"red"},{"k":"circle","x":500,"y":250,"r":80,"c":"blue"},{"k":"circle","x":500,"y":250,"r":70,"c":"blue"},{"k":"label","x":120,"y":400,"s":"dicke Wand","to":[200,320],"c":"red"},{"k":"label","x":440,"y":400,"s":"dünne Wand","to":[500,325],"c":"blue"}]},
 {"t":"end"},
]
HW_START = [
 {"t":"meta","title":"Herzzeitvolumen"},
 {"t":"step","say":"Gesucht ist das Herzzeitvolumen. Dafür brauchst du Herzfrequenz und Schlagvolumen.","draw":[{"k":"text","x":30,"y":60,"s":"HZV = HF × SV","size":36}]},
 {"t":"ask","say":"Was musst du mit den beiden Werten machen?","draw":[{"k":"text","x":30,"y":140,"s":"70/min ? 80 ml","size":30}]},
]
HW_NEXT = [
 {"t":"step","say":"Genau, multiplizieren! Das ergibt 5600 Milliliter pro Minute.","draw":[{"k":"text","x":30,"y":220,"s":"= 5,6 l/min","size":34,"c":"green"}]},
 {"t":"notes","points":["HZV = HF × SV"],"terms":[]},
 {"t":"quiz","q":[{"q":"HF 60, SV 70 ml. HZV?","o":["4,2 l/min","130 ml","7 l/min"],"a":0,"why":"60 × 70 ml"}]},
 {"t":"end"},
]
GEMINI_MODELS = {"models": [{"name": "models/" + n, "supportedGenerationMethods": ["generateContent"]} for n in ["gemini-3.7-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-image"]]}
GROQ_MODELS = {"data": [{"id": "openai/gpt-oss-120b"}, {"id": "whisper-large-v3"}]}

def sse_gemini(objs, split=40):
    text = "\n".join(json.dumps(o, ensure_ascii=False) for o in objs)
    parts = [text[i:i+split] for i in range(0, len(text), split)]
    return "".join("data: " + json.dumps({"candidates": [{"content": {"parts": [{"text": p}]}}]}) + "\n\n" for p in parts)

def sse_groq(objs):
    text = "\n".join(json.dumps(o, ensure_ascii=False) for o in objs)
    return "".join("data: " + json.dumps({"choices": [{"delta": {"content": text[i:i+50]}}]}) + "\n\n" for i in range(0, len(text), 50)) + "data: [DONE]\n\n"

def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

PORT = free_port()
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '-d', ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
BASE = f'http://127.0.0.1:{PORT}/'
problems, log = [], []
def check(cond, msg):
    (log if cond else problems).append(('OK ' if cond else 'FEHLER ') + msg)

calls = {"gemini_stream": 0, "groq_stream": 0}
mode = {"quota": False}

def handle_gemini(route):
    req = route.request
    if req.method == 'GET':
        return route.fulfill(status=200, content_type='application/json', body=json.dumps(GEMINI_MODELS))
    calls["gemini_stream"] += 1
    if mode["quota"]:
        return route.fulfill(status=429, content_type='application/json', body=json.dumps({"error": {"code": 429, "status": "RESOURCE_EXHAUSTED", "message": "Quota exceeded"}}))
    body = req.post_data or ''
    calls.setdefault("bodies", []).append(body)
    if 'PROSA' in body:
        return route.fulfill(status=200, headers={'content-type': 'text/event-stream'}, body="data: " + json.dumps({"candidates": [{"content": {"parts": [{"text": "Das ist eine Antwort ganz ohne Tafelformat."}]}}]}) + "\n\n")
    if 'Meine Antwort' in body: objs = HW_NEXT
    elif 'Zwischenfrage' in body or 'Im Quiz habe ich' in body: objs = ANSWER
    elif 'bei dieser Aufgabe' in body: objs = HW_START
    else: objs = LESSON
    route.fulfill(status=200, headers={'content-type': 'text/event-stream', 'access-control-allow-origin': '*'}, body=sse_gemini(objs))

def handle_groq(route):
    req = route.request
    if req.method == 'GET':
        return route.fulfill(status=200, content_type='application/json', body=json.dumps(GROQ_MODELS))
    calls["groq_stream"] += 1
    route.fulfill(status=200, headers={'content-type': 'text/event-stream'}, body=sse_groq(LESSON))

try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        for scheme in ['light', 'dark']:
            ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, color_scheme=scheme, has_touch=True, is_mobile=True)
            page = ctx.new_page()
            errs = []
            page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
            page.on('pageerror', lambda e: errs.append(str(e)))
            page.route('**/generativelanguage.googleapis.com/**', handle_gemini)
            page.route('**/api.groq.com/**', handle_groq)
            page.goto(BASE)
            page.wait_for_timeout(1800)
            page.screenshot(path=f'{OUT}/{scheme}-1-start.png')
            # Ohne Schlüssel: Einrichtung erscheint
            page.fill('#q', 'Wie funktioniert die Muskelpumpe?')
            page.click('#start')
            page.wait_for_selector('#setup[open]', timeout=3000)
            check(True, f'{scheme}: Einrichtung erscheint ohne Schlüssel')
            page.screenshot(path=f'{OUT}/{scheme}-2-setup.png')
            page.fill('#setupKey', 'TESTKEY')
            # schnell abspielen
            page.evaluate("localStorage.setItem('tutor.settings', JSON.stringify({voice:false, rate:1.5, speed:2}))")
            page.click('#setupSave')
            page.wait_for_selector('#lesson:not([hidden])', timeout=5000)
            page.wait_for_selector('.msg.tutor', timeout=8000)
            page.wait_for_timeout(1200)
            page.screenshot(path=f'{OUT}/{scheme}-3-lesson-step.png')
            page.wait_for_selector('.card.quiz', timeout=40000)
            n = page.locator('.msg.tutor').count()
            check(n == 4, f'{scheme}: 4 Erklärschritte im Verlauf (gefunden {n})')
            check(page.locator('#lTitle').inner_text() == 'Die Muskelpumpe', f'{scheme}: Titel aus meta')
            check(page.inner_text('#pgInfo') == 'Seite 2 von 2', f'{scheme}: zwei Tafelseiten ({page.inner_text("#pgInfo")})')
            texts = page.locator('.page:not([hidden]) text').count()
            check(texts >= 8, f'{scheme}: Text auf Seite 2 ({texts})')
            page.screenshot(path=f'{OUT}/{scheme}-4-end.png')
            page.click('#pgPrev'); page.wait_for_timeout(300)
            page.locator('#board').screenshot(path=f'{OUT}/{scheme}-5-board-p1.png')
            page.click('#pgNext'); page.wait_for_timeout(300)
            page.locator('#board').screenshot(path=f'{OUT}/{scheme}-6-board-p2.png')
            # Quiz: falsche Antwort, dann an der Tafel erklären lassen
            page.locator('.qitem').nth(0).locator('.opt').nth(1).click()
            check(page.locator('.qitem').nth(0).locator('.opt.wrong').count() == 1, f'{scheme}: falsche Antwort markiert')
            page.locator('.qitem').nth(0).locator('text=An der Tafel erklären').click()
            page.wait_for_function("document.getElementById('pgInfo').textContent === 'Seite 3 von 3'", timeout=15000)
            check(True, f'{scheme}: Quiz-Erklärung auf neuer Tafelseite')
            page.wait_for_timeout(2500)
            # Zwischenfrage
            page.fill('#r', 'Warum sind Venen anders gebaut?')
            page.press('#r', 'Enter')
            page.wait_for_function("document.getElementById('pgInfo').textContent === 'Seite 4 von 4'", timeout=15000)
            check(True, f'{scheme}: Zwischenfrage beantwortet')
            page.wait_for_timeout(3500)
            page.screenshot(path=f'{OUT}/{scheme}-7-question.png')
            # Neu laden: Lektion ist gespeichert
            page.wait_for_timeout(800)
            page.goto(BASE + '#/lektionen'); page.wait_for_timeout(800)
            check(page.locator('#allList .lesson-item').count() == 1, f'{scheme}: Lektion in der Liste')
            page.screenshot(path=f'{OUT}/{scheme}-8-list.png')
            page.locator('#allList .lesson-item').first.click()
            page.wait_for_selector('#lesson:not([hidden])')
            page.wait_for_timeout(600)
            check(page.inner_text('#pgInfo') == 'Seite 4 von 4', f'{scheme}: Tafel nach Neuladen ({page.inner_text("#pgInfo")})')
            check(page.locator('.card.quiz .opt.wrong').count() == 1, f'{scheme}: Quiz-Stand gespeichert')
            # Einstellungen
            page.click('#lMenuBtn'); page.wait_for_timeout(200)
            page.screenshot(path=f'{OUT}/{scheme}-9-menu.png')
            page.keyboard.press('Escape')
            page.goto(BASE + '#/'); page.wait_for_timeout(500)
            page.click('#toSettings'); page.wait_for_timeout(300)
            page.screenshot(path=f'{OUT}/{scheme}-10-settings.png')
            page.keyboard.press('Escape')
            check(not errs, f'{scheme}: keine Konsolenfehler {errs[:3]}')
            ctx.close()

        # Zwischenfrage mitten in der Lektion, danach geht es weiter
        ctx = b.new_context(viewport={'width': 390, 'height': 844})
        page = ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.route('**/generativelanguage.googleapis.com/**', handle_gemini)
        page.goto(BASE)
        page.evaluate("localStorage.setItem('tutor.settings', JSON.stringify({geminiKey:'G', voice:false, rate:1.5, speed:2}))")
        page.reload(); page.wait_for_timeout(600)
        page.fill('#q', 'Muskelpumpe'); page.click('#start')
        page.wait_for_selector('.msg.tutor', timeout=8000)
        page.fill('#r', 'Was ist eine Vene?'); page.press('#r', 'Enter')
        page.wait_for_selector('.divider', timeout=20000)
        page.wait_for_selector('.card.quiz', timeout=40000)
        steps = page.locator('.msg.tutor').count()
        check(steps == 5, f'Unterbrechung: 4 Lektionsschritte + 1 Antwort ({steps})')
        check(page.inner_text('#pgInfo') == 'Seite 3 von 3', f'Unterbrechung: Antwort auf eigener Seite, Lektion danach weiter ({page.inner_text("#pgInfo")})')
        page.screenshot(path=f'{OUT}/interrupt.png')
        # Hausaufgabe: Tutor wartet auf meine Antwort
        page.goto(BASE + '#/'); page.wait_for_timeout(400)
        page.click('.mode[data-mode=homework]')
        page.fill('#q', 'Berechne das HZV bei HF 70 und SV 80 ml'); page.click('#start')
        page.wait_for_function("document.getElementById('r').placeholder === 'Deine Antwort …'", timeout=20000)
        check(page.locator('.msg.tutor').count() == 2, 'Hausaufgabe: wartet nach der Frage')
        page.screenshot(path=f'{OUT}/homework-ask.png')
        page.fill('#r', 'multiplizieren'); page.press('#r', 'Enter')
        page.wait_for_selector('.card.quiz', timeout=20000)
        check('Meine Antwort: „multiplizieren“' in calls["bodies"][-1], 'Hausaufgabe: Antwort geht mit Verlauf an das Modell')
        check('Tutor: Gesucht ist das Herzzeitvolumen' in calls["bodies"][-1], 'Hausaufgabe: Verlauf enthält das Gesagte')
        page.fill('#r', 'PROSA bitte'); page.press('#r', 'Enter')
        page.wait_for_selector('text=Das ist eine Antwort ganz ohne Tafelformat.', timeout=10000)
        check(True, 'Antwort ohne Tafelformat wird als Text gezeigt')
        check(not errs, f'Unterbrechung/Hausaufgabe: keine Seitenfehler {errs[:3]}')
        ctx.close()

        # Große PDF (20 MB) über die Files-API, kleine PDF ohne lesbare Upload-Adresse direkt mitgeschickt
        up = {"start": 0, "bytes": 0, "expose": True}
        def handle_upload_start(route):
            if route.request.method != 'POST': return route.fulfill(status=204)
            up["start"] += 1
            h = {'access-control-allow-origin': '*', 'content-type': 'application/json'}
            if up["expose"]:
                h['x-goog-upload-url'] = 'https://upload.mock/u1'
                h['access-control-expose-headers'] = 'x-goog-upload-url'
            route.fulfill(status=200, headers=h, body='{}')
        def handle_upload_bytes(route):
            if route.request.method != 'POST': return route.fulfill(status=204, headers={'access-control-allow-origin': '*', 'access-control-allow-headers': '*'})
            up["bytes"] = len(route.request.post_data_buffer or b'')
            route.fulfill(status=200, headers={'access-control-allow-origin': '*', 'content-type': 'application/json'},
                          body=json.dumps({"file": {"name": "files/f1", "uri": "https://generativelanguage.googleapis.com/v1beta/files/f1", "mimeType": "application/pdf", "state": "ACTIVE", "expirationTime": "2099-01-01T00:00:00Z"}}))
        ctx = b.new_context(viewport={'width': 390, 'height': 844})
        page = ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.route('**/upload/v1beta/files**', handle_upload_start)
        page.route('https://upload.mock/**', handle_upload_bytes)
        page.route('**/generativelanguage.googleapis.com/v1beta/**', handle_gemini)
        page.goto(BASE)
        page.evaluate("localStorage.setItem('tutor.settings', JSON.stringify({geminiKey:'G', voice:false, rate:1.5, speed:2}))")
        page.reload(); page.wait_for_timeout(600)
        page.click('.mode[data-mode=exam]')
        big = b'%PDF-1.4\n' + b'0' * (20 * 1024 * 1024)
        page.set_input_files('#file', files=[{"name": "skript.pdf", "mimeType": "application/pdf", "buffer": big}])
        page.wait_for_selector('#files li', timeout=5000)
        check('20 MB' in page.inner_text('#files'), f'Große PDF wird angenommen ({page.inner_text("#files")})')
        page.fill('#q', 'Herzzyklus'); page.click('#start')
        page.wait_for_selector('.msg.tutor', timeout=30000)
        last = calls["bodies"][-1]
        check(up["start"] == 1 and up["bytes"] == len(big), f'PDF zu Google hochgeladen ({up["start"]}, {up["bytes"]} Bytes)')
        check('"fileData":{"mimeType":"application/pdf","fileUri":"https://generativelanguage.googleapis.com/v1beta/files/f1"}' in last, 'Anfrage verweist auf die hochgeladene Datei')
        check('inlineData' not in last, 'große PDF nicht direkt in der Anfrage')
        page.wait_for_selector('.card.quiz', timeout=40000)
        page.fill('#r', 'Was ist die Systole?'); page.press('#r', 'Enter')
        page.wait_for_function("document.querySelectorAll('.msg.tutor').length >= 5", timeout=20000)
        check(up["start"] == 1, 'Folgefrage lädt die Datei nicht nochmal hoch')
        n_blobs = page.evaluate("""new Promise(r => { const q = indexedDB.open('tutor'); q.onsuccess = () => { const t = q.result.transaction('blobs').objectStore('blobs').count(); t.onsuccess = () => r(t.result); }; })""")
        check(n_blobs == 1, f'Original-PDF auf dem Gerät gespeichert ({n_blobs})')
        # nach 48 Stunden: Datei abgelaufen -> wird aus dem Gerätespeicher neu hochgeladen
        page.evaluate("""(() => { const f = window.__tutorSession().l.first.files[0]; f.expires = '2000-01-01T00:00:00Z'; window.__tutorSession().blobCache.clear(); })()""")
        page.fill('#r', 'Und die Diastole?'); page.press('#r', 'Enter')
        page.wait_for_function("document.querySelectorAll('.msg.tutor').length >= 6", timeout=20000)
        check(up["start"] == 2, f'Abgelaufene Datei aus dem Gerätespeicher neu hochgeladen ({up["start"]})')
        # Plan B: Upload-Adresse nicht lesbar -> kleine PDF direkt mitschicken
        up["expose"] = False
        page.goto(BASE + '#/'); page.wait_for_timeout(400)
        small = b'%PDF-1.4\n' + b'1' * (1024 * 1024)
        page.set_input_files('#file', files=[{"name": "klein.pdf", "mimeType": "application/pdf", "buffer": small}])
        page.fill('#q', 'Kurz'); page.click('#start')
        page.wait_for_selector('.msg.tutor', timeout=30000)
        check('"inlineData":{"mimeType":"application/pdf"' in calls["bodies"][-1], 'Plan B: kleine PDF direkt in der Anfrage')
        check(not errs, f'Dateien: keine Seitenfehler {errs[:3]}')
        ctx.close()

        # Fallback: Gemini erschöpft -> Groq
        mode["quota"] = True
        calls["gemini_stream"] = 0
        ctx = b.new_context(viewport={'width': 1280, 'height': 800})
        page = ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.route('**/generativelanguage.googleapis.com/**', handle_gemini)
        page.route('**/api.groq.com/**', handle_groq)
        page.goto(BASE)
        page.evaluate("localStorage.setItem('tutor.settings', JSON.stringify({geminiKey:'G', groqKey:'Q', voice:false, rate:1.5, speed:2}))")
        page.reload(); page.wait_for_timeout(800)
        page.click('.mode[data-mode=exam]')
        page.fill('#q', 'Muskelpumpe')
        page.click('#start')
        page.wait_for_selector('.card.quiz', timeout=40000)
        check(calls["gemini_stream"] == 2 and calls["groq_stream"] == 1, f'Fallback: Gemini 2x 429, dann Groq ({calls["gemini_stream"]}, {calls["groq_stream"]})')
        page.screenshot(path=f'{OUT}/desktop-lesson.png')
        # Alles erschöpft: verständliche Meldung
        page.evaluate("localStorage.setItem('tutor.settings', JSON.stringify({geminiKey:'G', groqKey:'', voice:false}))")
        page.goto(BASE + '#/'); page.wait_for_timeout(500)
        page.fill('#q', 'Noch eine Frage'); page.click('#start')
        page.wait_for_selector('.msg.sys', timeout=8000)
        t = page.inner_text('.msg.sys')
        check('aufgebraucht' in t, f'Meldung bei erschöpftem Kontingent: {t[:90]}')
        page.screenshot(path=f'{OUT}/desktop-quota.png')
        check(not errs, f'Desktop: keine Seitenfehler {errs[:3]}')
        ctx.close()
        b.close()
finally:
    srv.terminate()

print('\n'.join(log))
print('\n'.join(problems) if problems else 'ALLES OK')
sys.exit(1 if problems else 0)
