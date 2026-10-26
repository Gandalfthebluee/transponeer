// Transponeer — hoofdprogramma (Electron main process)
import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { randomUUID } from 'crypto';

import { readScoreFile, transposeXml, scoreInfo, withMeta } from './lib/musicxml.mjs';
import { renderPages } from './lib/render.mjs';
import { findAudiveris, bundledAudiveris, runOmr, pdfDpi } from './lib/omr.mjs';
import { prepareImage, IMAGE_EXT } from './lib/image.mjs';
import { setupUpdates } from './lib/updates.mjs';
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
    thumb: fs.existsSync(thumb) ? fs.readFileSync(thumb, 'utf8') : null,
  };
}

// ---------- score verwerken ----------
async function finishScore(p, xml) {
  fs.writeFileSync(path.join(pdir(p.id), 'herkend.musicxml'), xml);
  const info = scoreInfo(xml);
  p.fifths = info.fifths; p.mode = info.mode;
  if (!p.titleEdited && info.title) p.title = info.title;
  if (!p.composer && info.composer) p.composer = info.composer;
  p.status = 'ready'; p.statusText = '';
  try {
    const { pages } = await renderPages(withMeta(xml, { title: p.title, composer: p.composer }), { thumbnail: true, scale: 50, meta: { title: p.title, composer: p.composer } });
    fs.writeFileSync(path.join(pdir(p.id), 'voorbeeld.svg'), pages[0]);
  } catch { /* voorbeeld is niet essentieel */ }
  saveProject(p);
  send('project-updated', summary(p));
}

async function startOmr(p) {
  const exe = findAudiveris(getSettings().audiverisPath);
  if (!exe) {
    p.status = 'needs-omr'; p.statusText = 'Notenherkenning niet gevonden. Kies de locatie van Audiveris.exe via Instellingen.';
    saveProject(p); send('project-updated', summary(p)); return;
  }
  p.status = 'working'; p.statusText = 'Noten herkennen (±15 s per pagina)…'; saveProject(p); send('project-updated', summary(p));
  const outDir = path.join(pdir(p.id), 'herkenning');
  const original = path.join(pdir(p.id), p.originalFile);
  const progress = (step) => { p.statusText = step; send('project-updated', summary(p)); };
  try {
    fs.rmSync(outDir, { recursive: true, force: true });
    let input = original, factor = null, dpi = null;
    if (IMAGE_EXT.test(p.originalFile)) {
      progress('Afbeelding voorbereiden…');
      input = path.join(pdir(p.id), 'voor-herkenning.png');
      ({ factor } = await prepareImage(original, input));
    }
    let result;
    try {
      result = await runOmr(exe, input, outDir, progress, { dpi });
    } catch (e) {
      // te kleine noten: één keer opnieuw met een sterkere vergroting / hogere resolutie
      if (!e.interline) throw e;
      const boost = 20 / e.interline;
      progress('Opnieuw proberen met hogere resolutie…');
      fs.rmSync(outDir, { recursive: true, force: true });
      if (input !== original) ({ factor } = await prepareImage(original, input, { factor: (factor || 1) * boost }));
      else dpi = Math.min(600, Math.round((pdfDpi(original) || 300) * boost));
      result = await runOmr(exe, input, outDir, progress, { dpi });
    }
    const files = result.files;
    const mxl = files.find(f => /\.mxl$/i.test(f)) || files[0];
    const xml = readScoreFile(mxl, fs.readFileSync(mxl));
    p.warning = '';
    if (factor && factor > 2) p.warning = 'Deze afbeelding was klein en is vergroot om te kunnen lezen. Controleer de noten extra goed met "Naast elkaar"; met de originele PDF of een scherpere foto wordt het resultaat veel beter.';
    else if (files.length > 1) p.warning = `Audiveris vond ${files.length} delen; alleen het eerste deel is geladen.`;
    await finishScore(p, xml);
  } catch (e) {
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
  return withMeta(xml, { title: p?.title, composer: p?.composer, subtitle });
}
const metaOf = (id, subtitle = '') => { const p = loadProject(id); return { title: p?.title, composer: p?.composer, subtitle }; };

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

  ipcMain.handle('project:get', (_e, id) => {
    const p = loadProject(id);
    if (!p) return null;
    return { ...p, keyName: p.fifths !== undefined ? keyName(p.fifths, p.mode) : '', originalUrl: pathToFileURL(path.join(pdir(id), p.originalFile)).href };
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
    const xml = scoreXml(id, iv);
    const { pages } = await renderPages(xml, { scale: getSettings().scale || 50, meta: metaOf(id) });
    return { pages, keyName: currentKeyName(p, iv), description: describeInterval(iv || { steps: 0, semis: 0 }) };
  });

  ipcMain.handle('theory:keys', () => KEY_CHOICES);

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
    const { pages } = await renderPages(scoreXml(id, iv, label), { scale: getSettings().scale || 50, meta: metaOf(id, label) });
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      @page { size: A4; margin: 0 } html,body { margin:0; padding:0; background:#fff }
      .page { width:210mm; height:297mm; page-break-after: always; overflow:hidden }
      .page:last-child { page-break-after: auto } svg { width:210mm; height:297mm; display:block }
    </style></head><body>${pages.map(s => `<div class="page">${s}</div>`).join('')}</body></html>`;
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

  ipcMain.handle('original:bytes', (_e, id) => { const p = loadProject(id); return new Uint8Array(fs.readFileSync(path.join(pdir(id), p.originalFile))); });
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
