# Transponeer

Windows-app om bladmuziek uit een PDF of foto in te lezen, te transponeren en weer als PDF te downloaden.

**Downloaden:** kies bij [Releases](https://github.com/Gandalfthebluee/transponeer/releases/latest) het bestand `Transponeer-Setup-….exe`.
Na de installatie werkt de app zichzelf bij.

## Wat het doet
- Startscherm met al je stukken, importeren door een PDF, foto of MusicXML erop te slepen
- Notenherkenning met [Audiveris](https://github.com/Audiveris/audiveris), ingebouwd
- Transponeren met knoppen of getypte opdrachten: `3 halve tonen omhoog`, `van F naar G`, `naar Bes`, `voor altsax`
- Origineel en herkende versie naast elkaar, versies, notities
- Downloaden als PDF of MusicXML

## Hoe een nieuwe versie wordt uitgebracht
1. Versienummer in `package.json` ophogen en een kopje toevoegen in `CHANGELOG.md`.
2. Pushen naar `main`.
3. De workflow *Release* ziet het nieuwe versienummer, bouwt op Windows de installer en zet hem als release online (met tag `vX.Y.Z`).
4. Geïnstalleerde apps vinden de update vanzelf.

## Zelf bouwen
```
npm install
npm run vendor   # haalt Audiveris en de taalbestanden op (Windows)
npm start
npm test
```

## Onderdelen en licenties
Electron, Verovio (LGPL-3.0), pdf.js (Apache-2.0), Jimp (MIT), electron-updater (MIT).
Meegeleverd in de installer, ongewijzigd: Audiveris 5.11.0 (AGPL-3.0, broncode op GitHub) en
Tesseract-taalbestanden (Apache-2.0).
