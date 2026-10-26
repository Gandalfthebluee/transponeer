// Notenherkenning met Audiveris (PDF/afbeelding → MusicXML).
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import zlib from 'zlib';

export const DEFAULT_PATHS = [
  'C:\\Program Files\\Audiveris\\Audiveris.exe',
  'C:\\Program Files (x86)\\Audiveris\\Audiveris.exe',
  'C:\\Program Files\\Audiveris\\bin\\Audiveris.bat',
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Audiveris', 'Audiveris.exe'),
  path.join(process.env.USERPROFILE || '', 'scoop', 'apps', 'audiveris', 'current', 'Audiveris.exe'),
  '/usr/bin/audiveris', '/opt/audiveris/bin/Audiveris',
  '/Applications/Audiveris.app/Contents/MacOS/Audiveris',
];

// Meegeleverde Audiveris (in de app-map) heeft voorrang
export function bundledAudiveris() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.resourcesPath && path.join(process.resourcesPath, 'audiveris', 'Audiveris.exe'),
    path.join(here, '..', 'vendor', 'audiveris', 'Audiveris.exe'),
  ];
  if (process.platform !== 'win32') return null; // het meegeleverde pakket is voor Windows
  return candidates.find(p => p && fs.existsSync(p)) || null;
}

// Taalbestanden voor tekstherkenning (titel, akkoordsymbolen, liedtekst)
export function bundledTessdata() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.resourcesPath && path.join(process.resourcesPath, 'tessdata'),
    path.join(here, '..', 'vendor', 'tessdata'),
  ];
  return candidates.find(p => p && fs.existsSync(path.join(p, 'eng.traineddata'))) || null;
}

export function findAudiveris(configured) {
  if (configured && fs.existsSync(configured)) return configured;
  return bundledAudiveris() || DEFAULT_PATHS.find(p => p && fs.existsSync(p)) || null;
}

// onProgress(text) krijgt de huidige stap ("Pagina 1: HEADS")
export function runOmr(exe, inputFile, outDir, onProgress, opts = {}) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(outDir, { recursive: true });
    const args = ['-batch', '-export', '-output', outDir, ...omrConstants(inputFile, opts.dpi), '--', inputFile];
    const isBat = /\.(bat|cmd)$/i.test(exe);
    const tess = bundledTessdata();
    const env = tess ? { ...process.env, TESSDATA_PREFIX: tess } : process.env;
    if (tess) args.splice(args.indexOf('--'), 0, '-constant', 'org.audiveris.omr.text.Language.defaultSpecification=eng+nld');
    const child = isBat
      ? spawn(`"${exe}" ${args.map(a => `"${a}"`).join(' ')}`, { shell: true, windowsHide: true, env })
      : spawn(exe, args, { windowsHide: true, env });

    let log = '';
    const onData = (d) => {
      const s = d.toString();
      log += s;
      const steps = [...s.matchAll(/\b(LOAD|BINARY|SCALE|GRID|HEADERS|STEM_SEEDS|BEAMS|LEDGERS|HEADS|STEMS|REDUCTION|CUE_BEAMS|TEXTS|MEASURES|CHORDS|CURVES|SYMBOLS|LINKS|RHYTHMS|PAGE)\b/g)];
      if (steps.length) onProgress?.(STEP_NL[steps[steps.length - 1][1]] || steps[steps.length - 1][1]);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => { child.kill(); }, 20 * 60 * 1000); // na 20 minuten stoppen
    child.on('exit', () => clearTimeout(timer));
    child.on('error', (e) => reject(new Error('Audiveris kon niet starten: ' + e.message)));
    child.on('close', (code) => {
      fs.writeFileSync(path.join(outDir, 'audiveris-log.txt'), log);
      const found = listMxl(outDir);
      if (found.length) resolve({ files: found, log });
      else { const err = new Error(friendlyError(log, code)); err.log = log; err.interline = lowInterline(log); reject(err); }
    });
  });
}

// Audiveris weigert pagina's boven 20 miljoen pixels. Kies de PDF-resolutie zo
// dat een pagina daar ruim onder blijft (300 dpi bij gewoon A4).
export function pdfDpi(file) {
  if (!/\.pdf$/i.test(file)) return null;
  try {
    const buf = fs.readFileSync(file);
    const re = /\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/g;
    const find = (text) => [...text.matchAll(re)].map(m => [Math.abs(m[3] - m[1]) / 72, Math.abs(m[4] - m[2]) / 72]);
    let boxes = find(buf.toString('latin1'));
    if (!boxes.length) {
      // paginagegevens kunnen in gecomprimeerde objectstromen zitten
      let pos = 0, tries = 0;
      while (!boxes.length && tries++ < 400) {
        const start = buf.indexOf('stream', pos, 'latin1');
        if (start < 0) break;
        let dataStart = start + 6;
        if (buf[dataStart] === 0x0d) dataStart++;
        if (buf[dataStart] === 0x0a) dataStart++;
        const end = buf.indexOf('endstream', dataStart, 'latin1');
        if (end < 0) break;
        if (end - dataStart < 2_000_000) {
          try { boxes = find(zlib.inflateSync(buf.subarray(dataStart, end)).toString('latin1')); } catch { /* geen zlib-stroom */ }
        }
        pos = end + 9;
      }
    }
    if (!boxes.length) return 300;
    const area = Math.max(...boxes.map(([w, h]) => w * h)); // vierkante inch
    return Math.max(72, Math.min(300, Math.floor(Math.sqrt(16e6 / area))));
  } catch { return 300; }
}

// "too low interline value of 5 pixels" → 5
export function lowInterline(log) {
  const m = /too low interline value of (\d+)/i.exec(log || '');
  return m ? parseInt(m[1], 10) : null;
}

// Foutmeldingen van Audiveris vertalen naar gewone taal
export function friendlyError(log = '', code = 1) {
  if (lowInterline(log)) return 'De noten zijn te klein om te lezen: de resolutie is te laag. Gebruik de originele PDF, een scan van 300 dpi of een scherpe foto van de hele pagina.';
  if (/Too large image/i.test(log)) return 'De afbeelding is te groot om te verwerken. Probeer een kleinere scan (300 dpi is genoeg).';
  if (/no staff|no system|flagged as invalid|Sheet ignored/i.test(log)) return 'Er zijn geen notenbalken gevonden. Staat er bladmuziek op, recht en goed belicht?';
  if (/OutOfMemory/i.test(log)) return 'Het werkgeheugen raakte vol. Probeer het stuk per pagina te importeren.';
  return code === 0
    ? 'Audiveris vond geen noten in dit bestand. Is het een duidelijke scan met notenbalken?'
    : `De herkenning is mislukt (foutcode ${code}). Details staan in audiveris-log.txt in de projectmap.`;
}

function omrConstants(file, dpiOverride) {
  const out = ['-constant', 'org.audiveris.omr.step.LoadStep.maxPixelCount=40000000'];
  const dpi = dpiOverride || pdfDpi(file);
  if (dpi) out.push('-constant', `org.audiveris.omr.image.ImageLoading.pdfResolution=${dpi}`);
  return out;
}

function listMxl(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) out.push(...listMxl(p));
    else if (/\.(mxl|musicxml|xml)$/i.test(f) && !/log/i.test(f)) out.push(p);
  }
  return out.sort();
}

const STEP_NL = {
  LOAD: 'Afbeelding laden', BINARY: 'Zwart-wit maken', SCALE: 'Lijndikte meten', GRID: 'Notenbalken zoeken',
  HEADERS: 'Sleutels en voortekening', STEM_SEEDS: 'Stokken zoeken', BEAMS: 'Waardestrepen', LEDGERS: 'Hulplijnen',
  HEADS: 'Nootkoppen', STEMS: 'Stokken koppelen', REDUCTION: 'Conflicten oplossen', CUE_BEAMS: 'Kleine noten',
  TEXTS: 'Tekst lezen', MEASURES: 'Maten', CHORDS: 'Akkoorden', CURVES: 'Bogen', SYMBOLS: 'Symbolen',
  LINKS: 'Symbolen koppelen', RHYTHMS: 'Ritme', PAGE: 'Pagina afronden',
};
