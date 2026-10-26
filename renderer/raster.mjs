// Verborgen hulpvenster: PDF-pagina's omzetten naar PNG (voor homr)
import * as pdfjs from '../node_modules/pdfjs-dist/build/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

window.rasterizePdf = async (b64, width = 2480, maxPages = 30) => {
  const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false,
    cMapUrl: new URL('../node_modules/pdfjs-dist/cmaps/', import.meta.url).href, cMapPacked: true,
    standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href }).promise;
  const out = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
    const page = await doc.getPage(i);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: width / vp1.width });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push(c.toDataURL('image/png').split(',')[1]);
  }
  window.__ready = true;
  return out;
};
window.__loaded = true;
