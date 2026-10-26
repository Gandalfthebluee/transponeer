// Test: noten verbeteren in de app
import { app, BrowserWindow } from 'electron';
import fs from 'fs'; import path from 'path';
const OUT = process.env.SHOT_DIR;
const tmpDocs = path.join(OUT, 'docs3'); fs.rmSync(tmpDocs, { recursive: true, force: true }); fs.mkdirSync(tmpDocs, { recursive: true });
app.setPath('documents', tmpDocs); app.setPath('userData', path.join(OUT, 'ud3'));
const sample = path.resolve(process.env.SAMPLE || 'samples/voorbeeld.musicxml');
await import('../main.mjs');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
app.on('browser-window-created', async (_e, win) => {
  if (BrowserWindow.getAllWindows().length > 1) return;
  win.setSize(1400, 900);
  win.webContents.on('console-message', (e) => e.level !== 'info' && console.log('CONSOLE', e.level, e.message));
  await new Promise(r => win.webContents.once('did-finish-load', r));
  const js = (c) => win.webContents.executeJavaScript(c);
  const shot = async (n, w = 700) => { await sleep(w); fs.writeFileSync(path.join(OUT, n + '.png'), (await win.webContents.capturePage()).toPNG()); };
  const key = (k, extra = {}) => js(`document.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({ key: k, ...extra })}))`);
  try {
    await js(`window.api.importFiles([${JSON.stringify(sample)}])`);
    await sleep(800);
    await js(`document.querySelector('.card[data-id]').click()`); await sleep(900);
    // van altsax naar trompet
    await js(`document.querySelector('#instr-from').value='altsax'; document.querySelector('#instr-to').value='trompet'; document.querySelector('#instr-to').dispatchEvent(new Event('change'))`);
    await sleep(900);
    await shot('e1-instrument');
    await js(`document.querySelector('#btn-edit').click()`); await sleep(800);
    const before = await js(`document.querySelector('#pane-score g[id="tp2"]').outerHTML.length`);
    await js(`document.querySelector('#pane-score g[id="tp2"] use, #pane-score g[id="tp2"] path').dispatchEvent(new MouseEvent('click', {bubbles:true}))`);
    await sleep(300);
    await shot('e2-selected', 300);
    await key('ArrowUp'); await sleep(800); await key('ArrowUp'); await sleep(800); await key('#'); await sleep(800);
    await shot('e3-edited');
    const xml = fs.readFileSync(path.join(tmpDocs, 'Transponeer', 'projecten', fs.readdirSync(path.join(tmpDocs, 'Transponeer', 'projecten'))[0], 'herkend.musicxml'), 'utf8');
    console.log('NOTE3', xml.match(/<pitch>[\s\S]*?<\/pitch>/g)[2].replace(/\s+/g, ''));
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', {key:'z', ctrlKey:true}))`); await sleep(800);
    const xml2 = fs.readFileSync(path.join(tmpDocs, 'Transponeer', 'projecten', fs.readdirSync(path.join(tmpDocs, 'Transponeer', 'projecten'))[0], 'herkend.musicxml'), 'utf8');
    console.log('NA UNDO', xml2.match(/<pitch>[\s\S]*?<\/pitch>/g)[2].replace(/\s+/g, ''));
  } catch (e) { console.error('FOUT', e); }
  app.quit();
});
