// Partituur tekenen met Verovio (MusicXML → SVG per pagina).
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';

let tkPromise = null;
function toolkit() {
  if (!tkPromise) tkPromise = createVerovioModule().then(m => new VerovioToolkit(m));
  return tkPromise;
}

export const A4 = { pageWidth: 2100, pageHeight: 2970 };

export async function renderPages(xml, opts = {}) {
  const { scale = 45, thumbnail = false, meta = null } = opts;
  const tk = await toolkit();
  tk.setOptions({
    ...A4,
    scale,
    svgViewBox: true,
    adjustPageHeight: opts.line ? true : false,
    pageMarginTop: opts.line ? 20 : 80, pageMarginBottom: opts.line ? 20 : 80, pageMarginLeft: 100, pageMarginRight: 100,
    footer: 'none',
    header: opts.line ? 'none' : 'auto',
    breaks: opts.breaks || 'auto',
    font: 'Leland',            // het lettertype van MuseScore 4
    svgAdditionalAttribute: ['measure@n'],
  });
  if (!tk.loadData(xml)) throw new Error('Kon de partituur niet lezen (ongeldige MusicXML).');
  if (!opts.line && meta && (meta.title || meta.composer || meta.subtitle)) {
    // kop (titel groot, ondertitel klein, componist rechts) via de MEI-titelgegevens
    const x = (t) => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const stmt = '<titleStmt>' + (meta.title ? `<title>${x(meta.title)}</title>` : '<title/>')
      + (meta.subtitle ? `<title type="subordinate">${x(meta.subtitle)}</title>` : '')
      + (meta.composer ? `<composer>${x(meta.composer)}</composer>` : '') + '</titleStmt>';
    const mei = tk.getMEI().replace(/<titleStmt[^>]*>[\s\S]*?<\/titleStmt>/, stmt).replace(/<pgHead[\s\S]*?<\/pgHead>/g, '');
    tk.loadData(mei);
  }
  const count = tk.getPageCount();
  const pages = [];
  const last = thumbnail ? 1 : count;
  for (let i = 1; i <= last; i++) pages.push(cleanSvg(tk.renderToSVG(i)));
  return { pages, pageCount: count };
}

function cleanSvg(svg) {
  // vaste breedte/hoogte weghalen zodat CSS de grootte bepaalt
  return svg.replace(/<svg([^>]*?)\swidth="[^"]*"\sheight="[^"]*"/, '<svg$1');
}

// Eén regel tekenen, zo breed als de pagina en precies zo hoog als nodig
export async function renderLine(xml, { scale = 50 } = {}) {
  const { pages } = await renderPages(xml, { scale, line: true, breaks: 'none' });
  return pages[0] || '';
}
