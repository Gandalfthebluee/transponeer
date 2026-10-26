// Transponeer — hoofdprogramma (Electron main process)
import { app, BrowserWindow, ipcMain, dialog, shell, Menu, clipboard } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { randomUUID } from 'crypto';

import { readScoreFile, transposeXml, scoreInfo, withMeta, cleanRecognized, hasEncodedBreaks, midiNotes, editNote, tagEvents, splitLines } from './lib/musicxml.mjs';
import { INSTRUMENTS, instrumentInterval, fitOctave, byId } from './lib/instruments.mjs';
import { renderPages, renderLine } from './lib/render.mjs';
import { findAudiveris, bundledAudiveris, runOmr, pdfDpi } from './lib/omr.mjs';
import { prepareImage, IMAGE_EXT, cropStaffStrips, TARGET_INTERLINE } from './lib/image.mjs';
import { setupUpdates } from './lib/updates.mjs';
import { findHomr, runHomrImage, mergePages, quality, transferHarmonies, systemIndexPerMeasure, overlapMeasures, dropMeasures, measureCount } from './lib/engines.mjs';
import { rasterizePdf } from './lib/pdfraster.mjs';
import { parseCommand } from './lib/commands.mjs';
import { keyName, describeInterval, keyToTonic, transposePitchClass, tonicToFifths, intervalFromSemitones, intervalBetweenTonics, addIntervals, KEY_CHOICES } from './lib/theory.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let win;

// ---------- opslag ----------
const DATA = () => path.join(app.getPath('documents'), 'Transponeer');
const PROJ = () => path.join(DATA(), 'projecten');
const SETTINGS = () => path.join(DATA(), 'instellingen.json');
const pdir = (id) => path.join(PROJ(), id);
const pjson = (id) => path.join(pdir(id), 'project.json');

function ensureDirs() { fs.mkdirSync(PROJ(), { recursive: true }); }
function readJson(p, def) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return def; } }
function writeJson(p, v) { fs.writeFileSync(p, JSON.stringify(v, null, 2)); }
const getSettings = () => readJson(SETTINGS(), { audiverisPath: '', scale: 50, pref: 'auto' });
const loadProject = (id) => readJson(pjson(id), null);
function saveProject(p) { p.updatedAt = new Date().toISOString(); writeJson(pjson(p.id), p); return p; }

function send(channel, payload) { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); }

function currentKeyName(p, iv) {
  if (p.fifths === undefined) return '';
  const t = transposePitchClass(keyToTonic(p.fifths), iv || { steps: 0, semis: 0 });
  return keyName(tonicToFifths(t), p.mode);
}

function summary(p) {
  const thumb = path.join(pdir(p.id), 'voorbeeld.svg');
  return {
    id: p.id, title: p.title, composer: p.composer, status: p.status, statusText: p.statusText,
    createdAt: p.createdAt, updatedAt: p.updatedAt, sourceType: p.sourceType,
    keyName: p.fifths !== undefined ? keyName(p.fifths, p.mode) : '',
    currentKey: currentKeyName(p, p.current),
    versions: (p.versions || []).length,
    sources: (p.sources || []).length, busy: p.busy || '',
    thumb: fs.existsSync(thumb) ? fs.readFileSync(thumb, 'utf8') : null,
  };
}

// ---------- score verwerken ----------
async function finishScore(p, xml, { recognized = false, alreadyClean = false } = {}) {
  if (recognized && !alreadyClean) {
    // ruwe herkenning bewaren, opgeschoonde versie gebruiken
    fs.writeFileSync(path.join(pdir(p.id), 'herkend-ruw.musicxml'), xml);
    const c = cleanRecognized(xml);
    xml = c.xml;
  }
  fs.writeFileSync(path.join(pdir(p.id), 'herkend.musicxml'), xml);
  const info = scoreInfo(xml);
  p.fifths = info.fifths; p.mode = info.mode;
  p.encodedBreaks = hasEncodedBreaks(xml);
  // titel/componist alleen overnemen uit een echt MusicXML-bestand; tekstherkenning is te onbetrouwbaar
  if (!recognized) {
    if (!p.titleEdited && info.title) p.title = info.title;
    if (!p.composer && info.composer) p.composer = info.composer;
  }
  p.status = 'ready'; p.statusText = '';
  try {
    const { pages } = await renderPages(xml, { thumbnail: true, scale: 50, breaks: p.encodedBreaks ? 'encoded' : 'auto', meta: metaOf(p) });
    fs.writeFileSync(path.join(pdir(p.id), 'voorbeeld.svg'), pages[0]);
  } catch { /* voorbeeld is niet essentieel */ }
  saveProject(p);
  send('project-updated', summary(p));
}

// ---------------------------------------------------------------------------
// Bronnen: een stuk kan bestaan uit één PDF/foto of uit meerdere schermafbeeldingen.
// Elke bron wordt apart herkend (op zijn eigen formaat) en daarna samengevoegd.
const ENGINE_NAME = { audiveris: 'Audiveris', homr: 'homr' };
const srcDir = (p, src) => path.join(pdir(p.id), `bron-${src.id}`);
const rel = (p, f) => path.relative(pdir(p.id), f).split(path.sep).join('/');

function sourcesOf(p) {
  if (!p.sources) p.sources = p.originalFile ? [{ id: 's1', file: p.originalFile }] : [];
  return p.sources;
}

// Herkenning van één bron met beide programma's
async function recognizeSource(p, src, label, report) {
  const aud = findAudiveris(getSettings().audiverisPath);
  const hom = findHomr();
  const dir = srcDir(p, src);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(pdir(p.id), src.file);
  const isPdf = /\.pdf$/i.test(src.file);
  const step = (t) => report(`${label}${t}`);

  // pagina's als afbeelding (voor homr en de stroken bij regel-voor-regel)
  let pages = [file];
  if (isPdf) { step('pagina\'s omzetten…'); pages = await rasterizePdf(file, path.join(dir, 'paginas')); }

  // stroken rond elke notenbalk in het origineel
  src.strips = [];
  for (let i = 0; i < pages.length; i++) {
    for (const s of await cropStaffStrips(pages[i], path.join(dir, `regel-p${i + 1}`))) src.strips.push(rel(p, s.file));
  }

  const results = {}, errors = {};
  let factor = null;
  if (aud) {
    try {
      const out = path.join(dir, 'audiveris');
      let input = file, dpi = null;
      if (!isPdf) { input = path.join(dir, 'voor-audiveris.png'); ({ factor } = await prepareImage(file, input)); }
      let r;
      try { r = await runOmr(aud, input, out, (t) => step(`Audiveris: ${t}`), { dpi }); }
      catch (e) {
        if (!e.interline) throw e;
        const boost = TARGET_INTERLINE / e.interline;
        step('Audiveris: opnieuw met hogere resolutie…');
        fs.rmSync(out, { recursive: true, force: true });
        if (!isPdf) ({ factor } = await prepareImage(file, input, { factor: (factor || 1) * boost }));
        else dpi = Math.min(600, Math.round((pdfDpi(file) || 300) * boost));
        r = await runOmr(aud, input, out, (t) => step(`Audiveris: ${t}`), { dpi });
      }
      const mxl = r.files.find(f => /\.mxl$/i.test(f)) || r.files[0];
      const raw = readScoreFile(mxl, fs.readFileSync(mxl));
      fs.writeFileSync(path.join(dir, 'ruw-audiveris.musicxml'), raw);
      results.audiveris = cleanRecognized(raw).xml;
    } catch (e) { errors.audiveris = e.message; }
  }
  if (hom) {
    try {
      const xmls = [];
      for (let i = 0; i < pages.length; i++) {
        step(pages.length > 1 ? `homr: pagina ${i + 1} van ${pages.length}` : 'homr: noten lezen');
        const img = path.join(dir, `homr-p${i + 1}.png`);
        await prepareImage(pages[i], img);       // zelfde notengrootte, ongeacht het formaat van het knipsel
        xmls.push(await runHomrImage(hom, img));
      }
      const raw = mergePages(xmls);
      fs.writeFileSync(path.join(dir, 'ruw-homr.musicxml'), raw);
      results.homr = cleanRecognized(raw).xml;
    } catch (e) { errors.homr = e.message; }
  }
  const names = Object.keys(results);
  if (!names.length) throw new Error(errors.audiveris || errors.homr || 'De herkenning is mislukt.');
  const q = Object.fromEntries(names.map(n => [n, quality(results[n])]));
  if (results.homr && results.audiveris) {
    const t = transferHarmonies(results.audiveris, results.homr);
    results.homr = t.xml; q.homr.chords = t.moved;
  }
  for (const n of names) fs.writeFileSync(path.join(dir, `herkend-${n}.musicxml`), results[n]);
  src.engines = Object.fromEntries(['audiveris', 'homr'].map(n => [n, results[n] ? { ok: q[n].ok, measures: q[n].measures, chords: q[n].chords } : errors[n] ? { error: errors[n] } : null]).filter(([, v]) => v));
  src.engine = names.reduce((a, b) => (q[b].score > q[a].score ? b : a));
  src.small = !!(factor && factor > 2.5);
  src.recognized = true;
}

// Bronnen samenvoegen tot één stuk; dubbele maten op de overgangen eruit
function sourceXml(p, src) {
  const want = p.engineOverride && src.engines?.[p.engineOverride] && !src.engines[p.engineOverride].error ? p.engineOverride : src.engine;
  const f = path.join(srcDir(p, src), `herkend-${want}.musicxml`);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
}

function assemble(p, { appendId = null } = {}) {
  const srcs = sourcesOf(p).filter(s => s.recognized);
  let merged = null, lines = [], total = 0, dropped = 0;
  let list = srcs;
  if (appendId && p.lines && fs.existsSync(path.join(pdir(p.id), 'herkend.musicxml'))) {
    // alleen de nieuwe bron achter het bestaande (mogelijk verbeterde) stuk plakken
    merged = fs.readFileSync(path.join(pdir(p.id), 'herkend.musicxml'), 'utf8');
    total = measureCount(merged);
    lines = p.lines.slice();
    list = srcs.filter(s => s.id === appendId);
  }
  for (const src of list) {
    let xml = sourceXml(p, src);
    if (!xml) continue;
    const sys = systemIndexPerMeasure(xml);
    let k = 0;
    if (merged) { k = overlapMeasures(merged, xml); xml = dropMeasures(xml, k); dropped += k; }
    const n = measureCount(xml);
    // regels: waar begint elke regel van deze bron in het samengevoegde stuk?
    let lastSys = null;
    for (let i = 0; i < n; i++) {
      const s = sys[i + k];
      if (s !== lastSys) { lines.push({ start: total + i, source: src.id, strip: src.strips?.[s] || null }); lastSys = s; }
    }
    merged = merged ? mergePages([merged, xml], { breakType: 'new-system' }) : xml;
    total += n;
  }
  return { xml: merged, lines, dropped };
}

function summarizeEngines(p) {
  // totalen over alle bronnen, voor de melding bovenaan
  const tot = {};
  for (const s of sourcesOf(p)) for (const [n, e] of Object.entries(s.engines || {})) {
    if (!e || e.error) continue;
    tot[n] = tot[n] || { ok: 0, measures: 0, chords: 0 };
    tot[n].ok += e.ok; tot[n].measures += e.measures; tot[n].chords += e.chords || 0;
  }
  p.engines = tot;
  const used = new Set(sourcesOf(p).filter(s => s.recognized).map(s => (p.engineOverride && s.engines?.[p.engineOverride] && !s.engines[p.engineOverride].error) ? p.engineOverride : s.engine));
  p.engine = used.size === 1 ? [...used][0] : 'mix';
}

// Herkennen: alle bronnen (opnieuw) of alleen de nog niet herkende
async function startOmr(p, { only = null, append = false } = {}) {
  const aud = findAudiveris(getSettings().audiverisPath);
  const hom = findHomr();
  if (!aud && !hom) {
    p.status = 'needs-omr'; p.statusText = 'Notenherkenning niet gevonden. Kies de locatie van Audiveris.exe via Instellingen.';
    saveProject(p); send('project-updated', summary(p)); return;
  }
  const srcs = sourcesOf(p);
  const todo = only ? srcs.filter(s => s.id === only) : srcs;
  // bij het toevoegen aan een bestaand stuk blijft het stuk zichtbaar; alleen een melding
  const inBackground = !!only && p.status === 'ready' && fs.existsSync(path.join(pdir(p.id), 'herkend.musicxml'));
  const report = (t) => { if (inBackground) p.busy = t; else p.statusText = t; send('project-updated', summary(p)); };
  if (inBackground) { p.busy = 'Nieuwe afbeelding lezen…'; } else { p.status = 'working'; p.statusText = 'Noten herkennen…'; }
  saveProject(p); send('project-updated', summary(p));
  try {
    for (const [i, src] of todo.entries()) {
      const label = srcs.length > 1 ? `Afbeelding ${srcs.indexOf(src) + 1} van ${srcs.length} · ` : '';
      try { await recognizeSource(p, src, label, report); }
      catch (e) { src.recognized = false; src.error = e.message; if (todo.length === 1 && srcs.length === 1) throw e; }
      saveProject(p);
    }
    if (!srcs.some(s => s.recognized)) throw new Error(srcs.find(s => s.error)?.error || 'De herkenning is mislukt.');
    if (inBackground && !todo[0].recognized) {
      p.busy = ''; p.warning = 'De nieuwe afbeelding kon niet gelezen worden: ' + (todo[0].error || 'onbekende fout');
      saveProject(p); send('project-updated', summary(p)); return;
    }
    // achteraan toevoegen (verbeteringen blijven staan) als het de laatste bron is; anders opnieuw samenstellen
    const isLast = only && srcs[srcs.length - 1].id === only;
    const { xml, lines, dropped } = assemble(p, { appendId: append && p.edited && isLast ? only : null });
    p.lines = lines;
    summarizeEngines(p);
    const failed = srcs.filter(s => !s.recognized).length;
    p.warning = [
      srcs.some(s => s.small && s.engine === 'audiveris') ? 'Een afbeelding was klein en is vergroot; controleer de noten extra goed.' : '',
      dropped ? `${dropped} dubbele ${dropped === 1 ? 'maat' : 'maten'} op de overgang tussen afbeeldingen weggelaten.` : '',
      failed ? `${failed} afbeelding${failed > 1 ? 'en' : ''} kon${failed > 1 ? 'den' : ''} niet gelezen worden (zie Bronnen).` : '',
    ].filter(Boolean).join(' ');
    if (!append) p.edited = false;
    p.checked = false;
    p.busy = '';
    await finishScore(p, xml, { recognized: true, alreadyClean: true });
  } catch (e) {
    p.busy = '';
    if (inBackground) { p.warning = 'De nieuwe afbeelding kon niet gelezen worden: ' + e.message; saveProject(p); send('project-updated', summary(p)); return; }
    p.status = 'error'; p.statusText = e.message; saveProject(p); send('project-updated', summary(p));
  }
}

async function createFromFile(file) {
  const id = randomUUID();
  fs.mkdirSync(pdir(id), { recursive: true });
  const ext = path.extname(file).toLowerCase();
  const isScore = ['.mxl', '.musicxml', '.xml'].includes(ext);
  const originalFile = 'origineel' + ext;
  fs.copyFileSync(file, path.join(pdir(id), originalFile));
  const p = {
    id, title: path.basename(file, ext).replace(/[_-]+/g, ' '), composer: '', notes: '',
    createdAt: new Date().toISOString(), originalFile, sourceType: isScore ? 'musicxml' : 'pdf',
    status: 'working', statusText: 'Bestand importeren…', current: { steps: 0, semis: 0 }, versions: [],
    sources: isScore ? [] : [{ id: 's1', file: originalFile, addedAt: new Date().toISOString() }],
  };
  saveProject(p);
  send('project-updated', summary(p));
  if (isScore) {
    try { await finishScore(p, readScoreFile(file, fs.readFileSync(file))); }
    catch (e) { p.status = 'error'; p.statusText = e.message; saveProject(p); send('project-updated', summary(p)); }
  } else {
    startOmr(p); // loopt op de achtergrond
  }
  return summary(p);
}

function scoreXml(id, iv, subtitle = '') {
  const f = path.join(pdir(id), 'herkend.musicxml');
  if (!fs.existsSync(f)) throw new Error('Deze partituur is nog niet herkend.');
  const p = loadProject(id);
  const xml = transposeXml(fs.readFileSync(f, 'utf8'), iv || { steps: 0, semis: 0 });
  return withMeta(xml, { title: p?.title, composer: p?.composer, subtitle: p?.subtitle });
}
// Opnieuw samenvoegen zonder opnieuw te herkennen (na ordenen/verwijderen/wisselen)
async function reassemble(p) {
  const { xml, lines, dropped } = assemble(p);
  if (!xml) { p.status = 'error'; p.statusText = 'Er zijn geen herkende afbeeldingen meer.'; saveProject(p); send('project-updated', summary(p)); return; }
  p.lines = lines; summarizeEngines(p); p.edited = false;
  p.warning = dropped ? `${dropped} dubbele ${dropped === 1 ? 'maat' : 'maten'} op de overgang tussen afbeeldingen weggelaten.` : '';
  await finishScore(p, xml, { recognized: true, alreadyClean: true });
}

async function confirmLoseEdits(p, what) {
  if (!p.edited) return true;
  const r = await dialog.showMessageBox(win, { type: 'question', buttons: [what, 'Annuleren'], defaultId: 1, cancelId: 1,
    message: 'Je verbeteringen aan de noten gaan dan verloren.', detail: 'Het stuk wordt opnieuw samengesteld uit de herkende afbeeldingen.' });
  return r.response === 0;
}

function addSourceFile(p, file) {
  const n = Math.max(0, ...sourcesOf(p).map(s => parseInt(String(s.id).slice(1), 10) || 0)) + 1;
  const ext = path.extname(file).toLowerCase() || '.png';
  const name = `bron-${String(n).padStart(2, '0')}${ext}`;
  fs.copyFileSync(file, path.join(pdir(p.id), name));
  const src = { id: 's' + n, file: name, addedAt: new Date().toISOString() };
  sourcesOf(p).push(src);
  if (p.sourceType === 'musicxml') p.sourceType = 'pdf';
  return src;
}

// achter elkaar herkennen (bij meerdere toevoegingen tegelijk)
const queues = new Map();
function queueRecognition(p, srcId) {
  const prev = queues.get(p.id) || Promise.resolve();
  const next = prev.then(async () => { const fresh = loadProject(p.id); if (fresh) await startOmr(fresh, { only: srcId, append: true }); });
  queues.set(p.id, next.catch(() => {}));
  return next;
}

const metaOf = (pOrId) => { const p = typeof pOrId === 'string' ? loadProject(pOrId) : pOrId; return { title: p?.title, composer: p?.composer, subtitle: p?.subtitle }; };
// tekst linksboven: het instrument waarvoor de partij nu geschreven is (leeg als niets gekozen)
const labelOf = (id) => { const p = loadProject(id); return p?.toInstrument ? byId(p.toInstrument).label : ''; };
const breaksOf = (id) => (loadProject(id)?.encodedBreaks ? 'encoded' : 'auto');

const safeName = (s) => (s || 'partituur').replace(/[\\/:*?"<>|]+/g, '').trim() || 'partituur';

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('projects:list', () => {
    ensureDirs();
    return fs.readdirSync(PROJ())
      .map(loadProject).filter(Boolean)
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .map(summary);
  });

  ipcMain.handle('projects:import', async (_e, files) => {
    ensureDirs();
    if (!files || !files.length) {
      const r = await dialog.showOpenDialog(win, {
        title: 'Bladmuziek importeren', properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Bladmuziek', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'mxl', 'musicxml', 'xml'] },
        ],
      });
      if (r.canceled) return [];
      files = r.filePaths;
    }
    const out = [];
    for (const f of files) out.push(await createFromFile(f));
    return out;
  });

  // schermafbeelding uit het klembord plakken (bijvoorbeeld van YouTube)
  ipcMain.handle('projects:paste', async () => {
    ensureDirs();
    const img = clipboard.readImage();
    if (img.isEmpty()) {
      const files = clipboard.readBuffer('FileNameW').toString('ucs2').replace(/\0/g, '').trim();
      if (files && fs.existsSync(files)) return [await createFromFile(files)];
      return null;
    }
    const d = new Date();
    const name = `Geplakt ${d.toLocaleDateString('nl-NL')} ${d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }).replace(':', '.')}.png`;
    const tmp = path.join(os.tmpdir(), name.replace(/[\\/:*?"<>|]/g, '-'));
    fs.writeFileSync(tmp, img.toPNG());
    try { return [await createFromFile(tmp)]; } finally { fs.rmSync(tmp, { force: true }); }
  });

  ipcMain.handle('project:get', (_e, id) => {
    const p = loadProject(id);
    if (!p) return null;
    const sources = (p.sources || []).map((s, i) => ({ ...s, n: i + 1, url: pathToFileURL(path.join(pdir(id), s.file)).href, isPdf: /\.pdf$/i.test(s.file) }));
    return { ...p, sources, keyName: p.fifths !== undefined ? keyName(p.fifths, p.mode) : '', originalUrl: p.originalFile ? pathToFileURL(path.join(pdir(id), p.originalFile)).href : '' };
  });

  ipcMain.handle('project:update', (_e, id, patch) => {
    const p = loadProject(id);
    if (!p) return null;
    if (patch.title !== undefined && patch.title !== p.title) p.titleEdited = true;
    Object.assign(p, patch);
    saveProject(p);
    const s = summary(p);
    send('project-updated', s);
    return s;
  });

  ipcMain.handle('project:delete', async (_e, id) => {
    const p = loadProject(id);
    const r = await dialog.showMessageBox(win, {
      type: 'warning', buttons: ['Verwijderen', 'Annuleren'], defaultId: 1, cancelId: 1,
      message: `"${p?.title || 'Project'}" verwijderen?`, detail: 'De map gaat naar de prullenbak, dus je kunt hem nog terughalen.',
    });
    if (r.response !== 0) return false;
    try { await shell.trashItem(pdir(id)); } catch { fs.rmSync(pdir(id), { recursive: true, force: true }); }
    return true;
  });

  ipcMain.handle('project:useEngine', async (_e, id, engine) => {
    const p = loadProject(id);
    if (!(await confirmLoseEdits(p, `Naar ${ENGINE_NAME[engine]}`))) return false;
    p.engineOverride = engine;
    await reassemble(p);
    return true;
  });

  // ---- bronnen (meerdere afbeeldingen in één stuk) ----
  ipcMain.handle('source:add', async (_e, id, files) => {
    const p = loadProject(id);
    if (!files || !files.length) {
      const r = await dialog.showOpenDialog(win, { title: 'Afbeelding of PDF toevoegen aan dit stuk', properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Bladmuziek', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp', 'gif'] }] });
      if (r.canceled) return null;
      files = r.filePaths;
    }
    const added = files.map(f => addSourceFile(p, f));
    saveProject(p);
    for (const s of added) queueRecognition(p, s.id);
    return added.length;
  });
  ipcMain.handle('source:paste', async (_e, id) => {
    const img = clipboard.readImage();
    if (img.isEmpty()) return null;
    const p = loadProject(id);
    const tmp = path.join(os.tmpdir(), `transponeer-plak-${Date.now()}.png`);
    fs.writeFileSync(tmp, img.toPNG());
    const src = addSourceFile(p, tmp);
    fs.rmSync(tmp, { force: true });
    saveProject(p);
    queueRecognition(p, src.id);
    return 1;
  });
  ipcMain.handle('source:move', async (_e, id, srcId, dir) => {
    const p = loadProject(id);
    const list = sourcesOf(p); const i = list.findIndex(s => s.id === srcId); const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return false;
    if (!(await confirmLoseEdits(p, 'Verplaatsen'))) return false;
    [list[i], list[j]] = [list[j], list[i]];
    await reassemble(p);
    return true;
  });
  ipcMain.handle('source:remove', async (_e, id, srcId) => {
    const p = loadProject(id);
    const list = sourcesOf(p);
    if (list.length <= 1) { await dialog.showMessageBox(win, { type: 'info', message: 'Een stuk heeft minstens één afbeelding nodig.', detail: 'Verwijder anders het hele stuk via het menu.' }); return false; }
    const src = list.find(s => s.id === srcId);
    const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Verwijderen', 'Annuleren'], defaultId: 1, cancelId: 1,
      message: 'Deze afbeelding uit het stuk halen?', detail: p.edited ? 'Je verbeteringen aan de noten gaan daarbij verloren.' : '' });
    if (r.response !== 0) return false;
    p.sources = list.filter(s => s.id !== srcId);
    fs.rmSync(path.join(pdir(id), src.file), { force: true });
    fs.rmSync(srcDir(p, src), { recursive: true, force: true });
    await reassemble(p);
    return true;
  });
  ipcMain.handle('source:retry', (_e, id, srcId) => { const p = loadProject(id); queueRecognition(p, srcId); return true; });

  // regel voor regel: stukje origineel + herkende (getransponeerde) regel
  ipcMain.handle('score:lines', async (_e, id, iv) => {
    const p = loadProject(id);
    const xml = tagEvents(scoreXml(id, iv));
    let lines = p.lines;
    if (!lines || !lines.length) {
      let last = null; lines = [];
      systemIndexPerMeasure(xml).forEach((sIdx, i) => { if (sIdx !== last) { lines.push({ start: i, strip: null }); last = sIdx; } });
    }
    const parts = splitLines(xml, lines.map(l => l.start));
    const scale = getSettings().scale || 50;
    const out = [];
    for (let i = 0; i < parts.length; i++) {
      let svg = '';
      try { svg = await renderLine(parts[i], { scale }); } catch { svg = ''; }
      const strip = lines[i]?.strip ? path.join(pdir(id), lines[i].strip) : null;
      out.push({ svg, strip: strip && fs.existsSync(strip) ? pathToFileURL(strip).href : null, measure: (lines[i]?.start ?? 0) + 1 });
    }
    return { lines: out, label: labelOf(id) };
  });

  ipcMain.handle('project:retryOmr', (_e, id) => { const p = loadProject(id); if (p) startOmr(p); return true; });

  ipcMain.handle('project:replaceScore', async (_e, id) => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Gecorrigeerde MusicXML inladen', properties: ['openFile'],
      filters: [{ name: 'MusicXML', extensions: ['mxl', 'musicxml', 'xml'] }],
    });
    if (r.canceled) return null;
    const p = loadProject(id);
    const xml = readScoreFile(r.filePaths[0], fs.readFileSync(r.filePaths[0]));
    p.warning = ''; p.checked = true;
    await finishScore(p, xml);
    return true;
  });

  ipcMain.handle('score:render', async (_e, id, iv) => {
    const p = loadProject(id);
    const xml = tagEvents(scoreXml(id, iv));
    const { pages } = await renderPages(xml, { scale: getSettings().scale || 50, meta: metaOf(id), breaks: breaksOf(id) });
    return { pages, label: labelOf(id), keyName: currentKeyName(p, iv), description: describeInterval(iv || { steps: 0, semis: 0 }) };
  });

  // noten verbeteren, met ongedaan maken
  const history = new Map();
  ipcMain.handle('score:edit', (_e, id, iv, index, action) => {
    const f = path.join(pdir(id), 'herkend.musicxml');
    const before = fs.readFileSync(f, 'utf8');
    const after = editNote(before, index, action, iv || { steps: 0, semis: 0 });
    const h = history.get(id) || []; h.push(before); if (h.length > 100) h.shift(); history.set(id, h);
    fs.writeFileSync(f, after);
    const p = loadProject(id); p.edited = true; saveProject(p);
    return { undo: h.length };
  });
  ipcMain.handle('score:undo', (_e, id) => {
    const h = history.get(id) || [];
    if (!h.length) return { undo: 0, done: false };
    fs.writeFileSync(path.join(pdir(id), 'herkend.musicxml'), h.pop());
    return { undo: h.length, done: true };
  });
  ipcMain.handle('score:thumb', async (_e, id) => {
    const p = loadProject(id);
    const xml = fs.readFileSync(path.join(pdir(id), 'herkend.musicxml'), 'utf8');
    const { pages } = await renderPages(xml, { thumbnail: true, scale: 50, breaks: breaksOf(id), meta: metaOf(p) });
    fs.writeFileSync(path.join(pdir(id), 'voorbeeld.svg'), pages[0]);
    send('project-updated', summary(p));
  });

  ipcMain.handle('theory:keys', () => KEY_CHOICES);
  ipcMain.handle('instruments:list', () => INSTRUMENTS.map(({ id, name }) => ({ id, name })));
  // van instrument → naar instrument, met octaaf passend bij het bereik
  ipcMain.handle('instruments:interval', (_e, id, fromId, toId, fit = true) => {
    let iv = instrumentInterval(fromId, toId);
    let octave = 0;
    if (fit) {
      const f = path.join(pdir(id), 'herkend.musicxml');
      if (fs.existsSync(f)) octave = fitOctave(midiNotes(transposeXml(fs.readFileSync(f, 'utf8'), iv)), toId);
      iv = { steps: iv.steps + 7 * octave, semis: iv.semis + 12 * octave };
    }
    return { interval: iv, octave };
  });

  ipcMain.handle('theory:interval', (_e, kind, id, arg) => {
    const p = loadProject(id);
    const pref = arg?.pref || getSettings().pref || 'auto';
    if (kind === 'semitones') {
      // totaal aantal halve tonen t.o.v. origineel
      return intervalFromSemitones(arg.semis, p.fifths || 0, pref);
    }
    if (kind === 'key') {
      // arg: gekozen tonica (in mineur is dit de mineur-tonica)
      const from = keyToTonic(p.fifths || 0, p.mode);
      return intervalBetweenTonics(from, { letter: arg.letter, alter: arg.alter }, arg.dir || 'nearest');
    }
    if (kind === 'add') return addIntervals(arg.a, arg.b);
    return { steps: 0, semis: 0 };
  });

  ipcMain.handle('command:parse', (_e, id, text) => {
    const p = loadProject(id);
    return parseCommand(text, { fifths: p.fifths || 0, mode: p.mode || 'major', current: p.current || { steps: 0, semis: 0 }, pref: getSettings().pref || 'auto' });
  });

  ipcMain.handle('export:pdf', async (_e, id, iv, label) => {
    const p = loadProject(id);
    const suggested = `${safeName(p.title)}${label ? ' - ' + safeName(label) : ''}.pdf`;
    const r = await dialog.showSaveDialog(win, { title: 'PDF opslaan', defaultPath: path.join(app.getPath('documents'), suggested), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled) return null;
    const { pages } = await renderPages(scoreXml(id, iv), { scale: getSettings().scale || 50, meta: metaOf(id), breaks: breaksOf(id) });
    const lbl = labelOf(id);
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      @page { size: A4; margin: 0 } html,body { margin:0; padding:0; background:#fff }
      .page { width:210mm; height:297mm; page-break-after: always; overflow:hidden }
      .page:last-child { page-break-after: auto } svg { width:210mm; height:297mm; display:block }
      .page { position: relative } .label { position:absolute; left:12mm; top:9mm; font: 11pt 'Times New Roman', serif; }
    </style></head><body>${pages.map((s, i) => `<div class="page">${i === 0 && lbl ? `<div class="label">${lbl.replace(/[&<>]/g, '')}</div>` : ''}${s}</div>`).join('')}</body></html>`;
    const tmp = path.join(os.tmpdir(), `transponeer-${Date.now()}.html`);
    fs.writeFileSync(tmp, html);
    const pw = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    try {
      await pw.loadFile(tmp);
      const pdf = await pw.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'none' } });
      fs.writeFileSync(r.filePath, pdf);
    } finally { pw.destroy(); fs.rmSync(tmp, { force: true }); }
    return r.filePath;
  });

  ipcMain.handle('export:musicxml', async (_e, id, iv, label) => {
    const p = loadProject(id);
    const suggested = `${safeName(p.title)}${label ? ' - ' + safeName(label) : ''}.musicxml`;
    const r = await dialog.showSaveDialog(win, { title: 'MusicXML opslaan', defaultPath: path.join(app.getPath('documents'), suggested), filters: [{ name: 'MusicXML', extensions: ['musicxml'] }] });
    if (r.canceled) return null;
    fs.writeFileSync(r.filePath, scoreXml(id, iv, label));
    return r.filePath;
  });

  ipcMain.handle('open:musescore', async (_e, id, iv) => {
    // schrijft de huidige versie weg en opent hem in het standaardprogramma (meestal MuseScore)
    const f = path.join(pdir(id), 'openen-in-musescore.musicxml');
    fs.writeFileSync(f, scoreXml(id, iv));
    const err = await shell.openPath(f);
    return err || true;
  });

  ipcMain.handle('original:bytes', (_e, id, file) => { const p = loadProject(id); return new Uint8Array(fs.readFileSync(path.join(pdir(id), file || p.originalFile))); });
  ipcMain.handle('open:original', (_e, id) => { const p = loadProject(id); return shell.openPath(path.join(pdir(id), p.originalFile)); });
  ipcMain.handle('open:folder', (_e, id) => shell.openPath(id ? pdir(id) : PROJ()));
  ipcMain.handle('open:url', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });

  const settingsOut = (s) => { const d = findAudiveris(s.audiverisPath); return { ...s, detected: d, bundled: !!d && d === bundledAudiveris(), version: app.getVersion(), dataDir: DATA() }; };
  ipcMain.handle('settings:get', () => settingsOut(getSettings()));
  ipcMain.handle('settings:set', (_e, patch) => { const s = { ...getSettings(), ...patch }; writeJson(SETTINGS(), s); return settingsOut(s); });
  ipcMain.handle('settings:pickAudiveris', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Waar staat Audiveris?', properties: ['openFile'], filters: [{ name: 'Programma', extensions: ['exe', 'bat', 'cmd', '*'] }] });
    if (r.canceled) return null;
    const s = { ...getSettings(), audiverisPath: r.filePaths[0] };
    writeJson(SETTINGS(), s);
    return settingsOut(s);
  });
}

// ---------- venster ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 980, minHeight: 640,
    backgroundColor: '#1f2228', title: 'Transponeer',
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, plugins: true },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(() => {
  ensureDirs();
  // projecten die bij het afsluiten nog bezig waren opnieuw starten
  for (const id of fs.readdirSync(PROJ())) {
    const p = loadProject(id);
    if (p && p.status === 'working') { p.status = 'error'; p.statusText = 'Herkenning onderbroken. Klik op "Opnieuw herkennen".'; saveProject(p); }
  }
  registerIpc();
  setupUpdates({ send, dataDir: DATA(), readSettings: getSettings, writeSettings: (s) => writeJson(SETTINGS(), s) });
  createWindow();
});
app.on('window-all-closed', () => app.quit());
