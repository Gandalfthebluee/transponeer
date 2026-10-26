// Origineel PDF tonen met pdf.js (werkt overal, ook zonder PDF-plugin)
import * as pdfjs from '../node_modules/pdfjs-dist/build/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

let current = 0;
window.renderPdfInto = async (source, container) => {
  const token = ++current;
  container.innerHTML = '<div class="loading"><span class="spinner"></span>Origineel laden…</div>';
  try {
    const data = typeof source === 'string' ? undefined : source;
    const doc = await pdfjs.getDocument({ ...(data ? { data } : { url: source }), isEvalSupported: false,
      cMapUrl: new URL('../node_modules/pdfjs-dist/cmaps/', import.meta.url).href, cMapPacked: true,
      standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href }).promise;
    if (token !== current) return;
    container.innerHTML = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      if (token !== current) return;
      const vp = page.getViewport({ scale: 2 });          // scherp genoeg om in te zoomen
      const canvas = document.createElement('canvas');
      canvas.width = vp.width; canvas.height = vp.height;
      canvas.className = 'pdfpage';
      container.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    }
  } catch (e) {
    if (token === current) container.innerHTML = `<div class="state"><p>Kon het origineel niet tonen (${String(e.message || e)}).</p></div>`;
  }
};
