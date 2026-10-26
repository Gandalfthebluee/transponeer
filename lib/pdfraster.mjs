// PDF → PNG per pagina, via een verborgen venster met pdf.js
import { BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function rasterizePdf(pdfFile, outDir, width = 2480) {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  try {
    await win.loadFile(path.join(here, '..', 'renderer', 'raster.html'));
    for (let i = 0; i < 100 && !(await win.webContents.executeJavaScript('!!window.__loaded')); i++) await new Promise(r => setTimeout(r, 50));
    const b64 = fs.readFileSync(pdfFile).toString('base64');
    const pages = await win.webContents.executeJavaScript(`window.rasterizePdf(${JSON.stringify(b64)}, ${width})`);
    fs.mkdirSync(outDir, { recursive: true });
    return pages.map((p, i) => {
      const f = path.join(outDir, `pagina-${String(i + 1).padStart(2, '0')}.png`);
      fs.writeFileSync(f, Buffer.from(p, 'base64'));
      return f;
    });
  } finally { win.destroy(); }
}
