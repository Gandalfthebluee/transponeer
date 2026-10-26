// Automatische updates via GitHub Releases, plus een back-up van de projecten
// en een "Wat is nieuw"-melding na een update.
import { app, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import updaterPkg from 'electron-updater';

const { autoUpdater } = updaterPkg;
let state = { state: 'idle' };

export function setupUpdates({ send, dataDir, readSettings, writeSettings }) {
  const setState = (s) => { state = s; send('update-status', s); };

  ipcMain.handle('update:status', () => state);
  ipcMain.handle('update:check', () => check());
  ipcMain.handle('update:install', () => { autoUpdater.quitAndInstall(false, true); });
  ipcMain.handle('update:whatsNew', () => whatsNew(readSettings, writeSettings, dataDir));

  if (!app.isPackaged) { setState({ state: 'dev' }); return; }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;     // ook installeren als je de app gewoon afsluit
  autoUpdater.on('checking-for-update', () => setState({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => setState({ state: 'latest', version: app.getVersion() }));
  autoUpdater.on('update-available', (i) => setState({ state: 'downloading', version: i.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => setState({ state: 'downloading', version: state.version, percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => setState({ state: 'ready', version: i.version }));
  autoUpdater.on('error', (e) => setState({ state: 'error', message: friendly(e) }));

  async function check() {
    try { await autoUpdater.checkForUpdates(); } catch (e) { setState({ state: 'error', message: friendly(e) }); }
    return state;
  }
  setTimeout(check, 4000);                       // kort na het opstarten
  setInterval(check, 4 * 60 * 60 * 1000);       // en daarna elke 4 uur
}

function friendly(e) {
  const m = String(e?.message || e);
  if (/ENOTFOUND|ETIMEDOUT|ECONNRE|net::/i.test(m)) return 'Geen internetverbinding; later opnieuw.';
  if (/404|No published versions/i.test(m)) return 'Nog geen versie gevonden op GitHub.';
  return 'Controleren op updates lukte niet.';
}

// Eerste start van een nieuwe versie: back-up maken en de nieuwigheden tonen.
function whatsNew(readSettings, writeSettings, dataDir) {
  const s = readSettings();
  const now = app.getVersion();
  const prev = s.lastVersion;
  if (prev === now) return null;
  writeSettings({ ...s, lastVersion: now });
  if (!prev) return null;                        // allereerste start: niets te melden
  try { backupProjects(dataDir, prev); } catch { /* back-up is extra zekerheid, niet essentieel */ }
  const changelog = readChangelog();
  const section = changelog.find(c => c.version === now);
  return { from: prev, to: now, items: section ? section.items : [] };
}

function backupProjects(dataDir, version) {
  const src = path.join(dataDir, 'projecten');
  if (!fs.existsSync(src)) return;
  const root = path.join(dataDir, 'reservekopieën');
  const dest = path.join(root, `voor-update-van-${version}-${new Date().toISOString().slice(0, 10)}`);
  fs.mkdirSync(root, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  // alleen de laatste 3 bewaren
  const all = fs.readdirSync(root).map(n => path.join(root, n)).sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
  for (const old of all.slice(0, Math.max(0, all.length - 3))) fs.rmSync(old, { recursive: true, force: true });
}

// CHANGELOG.md: "## 1.2.0" gevolgd door regels "- ..."
export function readChangelog() {
  const file = path.join(app.getAppPath(), 'CHANGELOG.md');
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const h = line.match(/^##\s+v?(\d+\.\d+\.\d+)/);
    if (h) { out.push({ version: h[1], items: [] }); continue; }
    const li = line.match(/^\s*[-*]\s+(.*)/);
    if (li && out.length) out[out.length - 1].items.push(li[1].replace(/\*\*/g, ''));
  }
  return out;
}
