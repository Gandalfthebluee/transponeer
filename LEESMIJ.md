# Transponeer

Bladmuziek uit een PDF (of foto) inlezen, transponeren en weer als PDF downloaden.

## Installeren (Windows)

1. Download `Transponeer-Setup-….exe` via https://github.com/Gandalfthebluee/transponeer/releases/latest
2. Dubbelklik erop. Windows kan de eerste keer waarschuwen ("Windows heeft uw pc beschermd"):
   kies *Meer informatie → Toch uitvoeren*. Dat komt doordat de app niet digitaal ondertekend is.
3. Transponeer staat daarna in het Startmenu en op het bureaublad.

Updates gaan vanzelf: de app downloadt nieuwe versies op de achtergrond en vraagt dan
of hij mag herstarten. Voor elke update wordt een reservekopie van je stukken gemaakt.

De notenherkenning (Audiveris 5.11) en de taalbestanden voor tekst en akkoordsymbolen
(Engels en Nederlands) zitten ingebouwd. Je hoeft niets anders te installeren.

Je projecten staan in `Documenten\Transponeer\projecten` (één map per stuk, met het
origineel, de herkende noten en je notities).

## Gebruik

- **Importeren**: knop *Importeren*, of sleep een PDF, foto of MusicXML-bestand naar het startscherm.
- **Controleren**: kies *Naast elkaar* om het origineel naast de herkende noten te zien.
  Herkenning is nooit 100% foutloos, vooral bij scans van slechte kwaliteit.
  Fout gevonden? Menu `•••` → *Openen in MuseScore*, verbeter, sla op als MusicXML,
  en kies *Gecorrigeerde versie inladen…*.
- **Plakken**: maak een schermafbeelding (Windows-toets + Shift + S, bijvoorbeeld van YouTube) en druk in het startscherm op Ctrl+V.
- **Twee herkenningsprogramma's**: Audiveris (sterk in nette PDF's, leest akkoorden) en homr (AI, sterk in foto's).
  De app kiest het beste resultaat; bovenaan kun je de andere versie bekijken.
- **Noten verbeteren**: knop *Verbeteren* (of toets E). Klik een noot aan; ↑/↓ toonhoogte, Shift+↑/↓ octaaf,
  # ♯, B ♭, N ♮, Delete = rust, ←/→ volgende noot, Ctrl+Z ongedaan maken, Esc klaar.
- **Instrument**: kies *Van* (waarvoor het blad geschreven is) en *Naar* (waarvoor je het wilt). Het instrument komt linksboven op het blad.
- **Transponeren**: met de knoppen links, of typ in de balk bovenin, bijvoorbeeld:
  `3 halve tonen omhoog` · `2 halve tonen omlaag` · `een hele toon omhoog` ·
  `van F naar G` · `naar Bes` · `kleine terts omlaag` · `octaaf omhoog` ·
  `voor Bes-klarinet` · `voor altsax` · `+5` · `-2` · `origineel`
- **Versies**: bewaar een transpositie onder een naam ("Zang in G").
- **Notities**: per stuk, worden automatisch opgeslagen.
- **Downloaden**: knop *PDF* (A4). Via `•••` kan ook MusicXML.

Sneltoetsen: `Ctrl+K` typbalk · `↑`/`↓` halve toon · `Ctrl +`/`Ctrl -` zoom · `Ctrl+P` PDF.

## Zelf aanpassen of bouwen (voor wie wil)

Nodig: Node.js 20 of nieuwer.

```
npm install
npm start          # app starten vanuit de broncode
npm test           # transponeer-tests
npm run dist       # installer bouwen (op Windows)
```

Opbouw:
- `lib/theory.mjs`: toonsoorten, intervallen, juiste spelling (Bes vs Ais)
- `lib/musicxml.mjs`: transponeren van noten, voortekening, akkoordsymbolen en voortekens
- `lib/commands.mjs`: begrijpt de getypte opdrachten
- `lib/omr.mjs`: roept Audiveris aan
- `lib/render.mjs`: tekent de partituur met Verovio (lettertype Leland, net als MuseScore 4)
- `main.mjs`: projecten opslaan, PDF-export
- `renderer/`: de interface

Meegeleverde onderdelen: `vendor/audiveris` (Audiveris 5.11.0, AGPL-3.0, ongewijzigd, broncode op
https://github.com/Audiveris/audiveris) en `vendor/tessdata` (Tesseract-taalbestanden, Apache-2.0).
Die map staat niet in de broncode-zip (te groot); hij zit wel in de Windows-app.
Verder: Electron, Verovio (LGPL), pdf.js (Apache-2.0).
