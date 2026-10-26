import { app, dialog, BrowserWindow } from 'electron';
import fs from 'fs'; import path from 'path';
const OUT = process.env.SHOT_DIR;
const tmpDocs = path.join(OUT, 'docs2'); fs.rmSync(tmpDocs, { recursive: true, force: true }); fs.mkdirSync(tmpDocs, { recursive: true });
app.setPath('documents', tmpDocs); app.setPath('userData', path.join(OUT, 'ud2'));
const pdf = process.env.PDF || path.join(OUT, 'Kortjakje scan.pdf');
await import('../main.mjs');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
app.on('browser-window-created', async (_e, win) => {
  if (BrowserWindow.getAllWindows().length > 1) return;
  win.setSize(1400, 900);
  win.webContents.on('console-message', (e) => e.level !== 'info' && console.log('CONSOLE', e.level, e.message));
  await new Promise(r => win.webContents.once('did-finish-load', r));
  const js = (c) => win.webContents.executeJavaScript(c);
  const shot = async (n, w = 600) => { await sleep(w); fs.writeFileSync(path.join(OUT, n + '.png'), (await win.webContents.capturePage()).toPNG()); };
  try {
    await js(`window.api.setSettings({ audiverisPath: ${JSON.stringify(process.env.FAKE_AUD)} })`);
    await js(`window.api.importFiles([${JSON.stringify(pdf)}])`);
    await shot('6-herkennen', 1500);
    for (let i = 0; i < 180; i++) { const ps = await js('window.api.listProjects()'); if (ps[0].status !== 'working') { console.log('status', ps[0].status, ps[0].statusText); break; } await sleep(1000); }
    await js(`document.querySelector('.card[data-id]').click()`);
    await sleep(500); await js(`(()=>{const c=document.querySelector('#composer-input'); c.value='Testcomponist'; c.dispatchEvent(new Event('change'));})()`);
    await shot('7-herkend', 1200);
    await js(`(()=>{const c=document.querySelector('#command'); c.value='3 halve tonen omlaag'; c.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));})()`);
    await js(`document.querySelector('[data-mode=split]').click()`);
    await shot('8-split-pdf', 1500);
    await js(`document.querySelector('#btn-back').click()`);
    await shot('9-start');
  } catch (e) { console.error('FOUT', e); }
  app.quit();
});
