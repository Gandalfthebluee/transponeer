// Afbeeldingen klaarmaken voor de notenherkenning en notenbalken terugvinden.
// - doorzichtige achtergrond → wit, grijstinten
// - schalen op de afstand tussen de notenbalklijnen (niet op de breedte van het plaatje),
//   zodat een smal knipsel en een hele pagina dezelfde notengrootte krijgen
import { Jimp, ResizeStrategy } from 'jimp';

export const IMAGE_EXT = /\.(png|jpe?g|bmp|tiff?|gif)$/i;
export const TARGET_INTERLINE = 20;   // Audiveris werkt het best rond 20 pixels tussen de lijnen

async function loadFlat(input) {
  const img = await Jimp.read(input);
  const { width, height } = img.bitmap;
  const bg = new Jimp({ width, height, color: 0xffffffff });
  bg.composite(img, 0, 0);
  bg.greyscale();
  return bg;
}

// Notenbalken zoeken: rijen met veel donkere pixels zijn lijnen; vijf lijnen op
// gelijke afstand vormen een notenbalk.
export function findStaves(bitmap) {
  const { width, height, data } = bitmap;
  // donkere achtergrond (zwarte balken bij video's, donkere randen van een app) negeren:
  // kolommen die bijna overal donker zijn, tellen niet mee
  const colDark = new Float32Array(width);
  const step = Math.max(1, Math.floor(height / 400));
  let samples = 0;
  for (let y = 0; y < height; y += step) { samples++; for (let x = 0; x < width; x++) if (data[(y * width + x) * 4] < 205) colDark[x]++; }
  const light = new Uint8Array(width);
  for (let x = 0; x < width; x++) light[x] = colDark[x] / samples < 0.8 ? 1 : 0;
  let x0 = 0, x1 = width;
  while (x0 < width && !light[x0]) x0++;
  while (x1 > x0 && !light[x1 - 1]) x1--;
  const pad = Math.floor((x1 - x0) * 0.02);
  x0 += pad; x1 -= pad;
  const span = Math.max(1, x1 - x0);
  // donker = duidelijk lichter dan wit; dunne uitgevloeide lijnen zijn vaak grijs
  const T = 205;
  const ratio = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    let run = 0, best = 0, gap = 0;
    for (let x = x0; x < x1; x++) {
      if (!light[x]) { run = 0; gap = 0; continue; }
      const v = data[(y * width + x) * 4];
      if (v < T) { run += 1 + gap; gap = 0; if (run > best) best = run; }
      else if (run && gap < 3) gap++;               // kleine onderbreking toegestaan
      else { run = 0; gap = 0; }
    }
    ratio[y] = best / span;                          // lijnen zijn lang en doorlopend; tekst niet
  }
  let max = 0; for (const r of ratio) if (r > max) max = r;
  const thr = Math.max(0.25, max * 0.45);
  const lines = [];
  for (let y = 0; y < height; y++) {
    if (ratio[y] < thr) continue;
    const start = y;
    while (y + 1 < height && ratio[y + 1] >= thr) y++;
    lines.push({ y: (start + y) / 2, t: y - start + 1 });
  }
  const staves = [];
  for (let i = 0; i + 4 < lines.length; i++) {
    const g = lines.slice(i, i + 5);
    const gaps = g.slice(1).map((l, k) => l.y - g[k].y);
    const avg = gaps.reduce((a, b) => a + b, 0) / 4;
    if (avg < 3 || avg > 80) continue;
    if (gaps.every(d => Math.abs(d - avg) <= Math.max(1.5, avg * 0.22))) {
      staves.push({ top: g[0].y, bottom: g[4].y, interline: avg });
      i += 4;
    }
  }
  const sorted = staves.map(s => s.interline).sort((a, b) => a - b);
  const interline = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  return { staves, interline, width, height };
}

export async function analyzeImage(input) {
  const img = await loadFlat(input);
  return findStaves(img.bitmap);
}

// Klaarmaken voor herkenning. Zonder factor: schalen op lijnafstand.
export async function prepareImage(input, output, { factor = null, target = TARGET_INTERLINE } = {}) {
  const img = await loadFlat(input);
  const { width, height } = img.bitmap;
  let f = factor;
  let info = null;
  if (f == null) {
    info = findStaves(img.bitmap);
    if (info.interline) f = target / info.interline;
    else f = width < 2200 ? 2480 / width : 1;   // geen notenbalk gevonden: terugvallen op breedte
  }
  f = Math.max(0.4, Math.min(f, 6));
  // grote afbeeldingen niet onnodig groter dan nodig, maar ook niet boven ~40 miljoen pixels
  const maxF = Math.sqrt(38e6 / (width * height));
  f = Math.min(f, maxF);
  if (Math.abs(f - 1) > 0.05) img.resize({ w: Math.round(width * f), h: Math.round(height * f), mode: ResizeStrategy.BICUBIC });
  await img.write(output);
  return { width, height, factor: f, interline: info?.interline ?? null, staves: info?.staves?.length ?? null };
}

// Stroken uitsnijden rond elke notenbalk (voor regel-voor-regel vergelijken).
// Ruimte boven de balk voor akkoorden, onder voor lage noten; nooit over de buurbalk heen.
export async function cropStaffStrips(input, outPrefix) {
  const img = await loadFlat(input);
  const { staves, width, height } = findStaves(img.bitmap);
  const out = [];
  staves.forEach((s, i) => {
    const h = s.bottom - s.top;
    const prev = staves[i - 1], next = staves[i + 1];
    let top = s.top - h * 1.6;
    let bottom = s.bottom + h * 1.1;
    if (prev) top = Math.max(top, (prev.bottom + s.top) / 2);
    if (next) bottom = Math.min(bottom, (s.bottom + next.top) / 2);
    top = Math.max(0, Math.floor(top)); bottom = Math.min(height, Math.ceil(bottom));
    out.push({ i, top, bottom });
  });
  const files = [];
  for (const r of out) {
    const strip = img.clone().crop({ x: 0, y: r.top, w: width, h: r.bottom - r.top });
    const file = `${outPrefix}-${String(r.i + 1).padStart(2, '0')}.png`;
    await strip.write(file);
    files.push({ file, width, height: r.bottom - r.top });
  }
  return files;
}
