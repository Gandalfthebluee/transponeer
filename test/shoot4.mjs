// Test: meerdere knipsels in één stuk + regel-voor-regel
import { app, BrowserWindow } from 'electron';
import fs from 'fs'; import path from 'path';
const OUT = process.env.SHOT_DIR;
const tmpDocs = path.join(OUT, 'docs4'); fs.rmSync(tmpDocs, { recursive: true, force: true }); fs.mkdirSync(tmpDocs, { recursive: true });
app.setPath('documents', tmpDocs); app.setPath('userData', path.join(OUT, 'ud4'));
await import('../main.mjs');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
app.on('browser-window-created', async (_e, win) => {
  if (BrowserWindow.getAllWindows().length > 1) return;
  win.setSize(1400, 950);
  win.webContents.on('console-message', (e) => e.level !== 'info' && console.log('CONSOLE', e.level, e.message));
  await new Promise(r => win.webContents.once('did-finish-load', r));
  const js = (c) => win.webContents.executeJavaScript(c);
  const shot = async (n, w = 900) => { await sleep(w); fs.writeFileSync(path.join(OUT, n + '.png'), (await win.webContents.capturePage()).toPNG()); };
  const proj = () => { const d = path.join(tmpDocs, 'Transponeer', 'projecten'); return JSON.parse(fs.readFileSync(path.join(d, fs.readdirSync(d)[0], 'project.json'), 'utf8')); };
  try {
    await js(`window.api.setSettings({ audiverisPath: ${JSON.stringify(process.env.FAKE_AUD)} })`);
    const [s1, s2] = process.env.SNIPS.split('|');
    await js(`window.api.importFiles([${JSON.stringify(s1)}])`);
    for (let i = 0; i < 240 && proj().status !== 'ready'; i++) await sleep(1000);
    console.log('na knipsel 1:', proj().status, proj().lines?.length, 'regels');
    await sleep(1500);
    const id = proj().id;
    await js(`window.api.addSource(${JSON.stringify(id)}, [${JSON.stringify(s2)}])`);
    await sleep(2500);
    await shot('m1-bezig', 200);
    for (let i = 0; i < 240 && (proj().busy || proj().sources.some(s => !s.recognized && !s.error)); i++) await sleep(1000);
    await sleep(2500);
    const p = proj();
    console.log('na knipsel 2:', p.status, 'regels', p.lines.length, JSON.stringify(p.lines), 'melding:', p.warning);
    console.log('bronnen', JSON.stringify(p.sources.map(s => ({ id: s.id, engine: s.engine, engines: s.engines, strips: s.strips?.length }))));
    await js(`document.querySelector('.card[data-id]').click()`);
    await sleep(1500);
    await js(`document.querySelector('[data-ptab=sources]').click()`);
    await js(`document.querySelector('[data-mode=lines]').click()`);
    await shot('m2-per-regel', 2500);
    await js(`document.querySelector('#pane-score').scrollTop = 900`);
    await shot('m3-per-regel-onder', 600);
    await js(`document.querySelector('[data-mode=split]').click()`);
    await shot('m4-naast-elkaar', 2500);
  } catch (e) { console.error('FOUT', e); }
  app.quit();
});
