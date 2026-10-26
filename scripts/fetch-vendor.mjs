// Haalt Audiveris (Windows) en de Tesseract-taalbestanden op naar vendor/.
// Wordt gebruikt door de bouwrobot op GitHub; lokaal kan het ook (Windows of Linux met msitools).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const AUDIVERIS_VERSION = '5.11.0';
const MSI_URL = `https://github.com/Audiveris/audiveris/releases/download/${AUDIVERIS_VERSION}/Audiveris-${AUDIVERIS_VERSION}-windowsConsole-x86_64.msi`;
const LICENSE_URL = `https://raw.githubusercontent.com/Audiveris/audiveris/${AUDIVERIS_VERSION}/LICENSE`;
const TESS_URL = (lang) => `https://raw.githubusercontent.com/tesseract-ocr/tessdata/main/${lang}.traineddata`;
const LANGS = ['eng', 'nld'];

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const vendor = path.join(root, 'vendor');
const audDir = path.join(vendor, 'audiveris');
const tessDir = path.join(vendor, 'tessdata');

async function download(url, file) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status} voor ${url}`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      console.log(`  ${path.basename(file)}: ${(fs.statSync(file).size / 1e6).toFixed(1)} MB`);
      return;
    } catch (e) {
      if (attempt === 3) throw e;
      console.log(`  opnieuw (${e.message})`);
      await new Promise(r => setTimeout(r, 3000 * attempt));
    }
  }
}

function findExe(dir) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) { const f = findExe(p); if (f) return f; }
    else if (n.toLowerCase() === 'audiveris.exe' && fs.existsSync(path.join(dir, 'runtime'))) return p;
  }
  return null;
}

async function audiveris() {
  if (fs.existsSync(path.join(audDir, 'Audiveris.exe'))) { console.log('Audiveris staat er al.'); return; }
  console.log(`Audiveris ${AUDIVERIS_VERSION} downloaden…`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aud'));
  const msi = path.join(tmp, 'audiveris.msi');
  await download(MSI_URL, msi);
  const out = path.join(tmp, 'x');
  fs.mkdirSync(out);
  console.log('Uitpakken…');
  if (process.platform === 'win32') execFileSync('msiexec', ['/a', msi, '/qn', `TARGETDIR=${out}`], { stdio: 'inherit' });
  else execFileSync('msiextract', ['-C', out, msi], { stdio: 'ignore' });
  const exe = findExe(out);
  if (!exe) throw new Error('Audiveris.exe niet gevonden na uitpakken');
  fs.rmSync(audDir, { recursive: true, force: true });
  fs.cpSync(path.dirname(exe), audDir, { recursive: true });
  await download(LICENSE_URL, path.join(audDir, 'LICENSE-Audiveris.txt')).catch(() => {});
  fs.writeFileSync(path.join(audDir, 'HERKOMST.txt'),
    `Audiveris ${AUDIVERIS_VERSION} (https://github.com/Audiveris/audiveris), AGPL-3.0.\r\nOngewijzigd meegeleverd; de broncode staat op GitHub.\r\n`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

async function tessdata() {
  fs.mkdirSync(tessDir, { recursive: true });
  for (const l of LANGS) {
    const f = path.join(tessDir, `${l}.traineddata`);
    if (fs.existsSync(f) && fs.statSync(f).size > 1e6) continue;
    console.log(`Taalbestand ${l} downloaden…`);
    await download(TESS_URL(l), f);
  }
}

await audiveris();
await tessdata();
console.log('Klaar: vendor/ is gevuld.');
