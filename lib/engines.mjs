// Tweede herkenningsprogramma (homr) en het kiezen/combineren van resultaten.
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const here = path.dirname(fileURLToPath(import.meta.url));
const kids = (el, name) => { const out = []; for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && (!name || c.nodeName === name)) out.push(c); return out; };
const kid = (el, name) => kids(el, name)[0] || null;
const txt = (el, name, def = null) => { const k = kid(el, name); return k ? k.textContent.trim() : def; };

export function findHomr() {
  const exe = process.platform === 'win32' ? 'homr.exe' : 'homr';
  const candidates = [
    process.resourcesPath && path.join(process.resourcesPath, 'homr', exe),
    path.join(here, '..', 'vendor', 'homr', exe),
    process.env.HOMR_EXE,
  ];
  return candidates.find(p => p && fs.existsSync(p)) || null;
}

// Eén afbeelding → MusicXML (homr schrijft het resultaat naast de afbeelding)
export function runHomrImage(exe, image, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, [image], { windowsHide: true, cwd: path.dirname(image) });
    let log = '';
    const onData = (d) => {
      const s = d.toString(); log += s;
      if (/Loading segmentation|segment/i.test(s)) onProgress?.('Notenbalken zoeken');
      else if (/staff|Staff/.test(s)) onProgress?.('Noten lezen');
    };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    const timer = setTimeout(() => child.kill(), 15 * 60 * 1000);
    child.on('error', (e) => { clearTimeout(timer); reject(new Error('homr kon niet starten: ' + e.message)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const out = image.replace(/\.[^.]+$/, '.musicxml');
      fs.writeFileSync(image.replace(/\.[^.]+$/, '-homr-log.txt'), log);
      if (fs.existsSync(out)) resolve(fs.readFileSync(out, 'utf8'));
      else reject(new Error(code === 0 ? 'homr vond geen noten.' : `homr stopte met foutcode ${code}.`));
    });
  });
}

// Meerdere pagina's achter elkaar zetten in één partij
export function mergePages(xmls, { breakType = 'new-page' } = {}) {
  if (xmls.length === 1) return xmls[0];
  const docs = xmls.map(x => new DOMParser().parseFromString(x, 'text/xml'));
  const first = docs[0];
  const target = first.getElementsByTagName('part')[0];
  let n = kids(target, 'measure').length;
  for (const d of docs.slice(1)) {
    const part = d.getElementsByTagName('part')[0];
    if (!part) continue;
    kids(part, 'measure').forEach((m, i) => {
      const imported = first.importNode(m, true);
      imported.setAttribute('number', String(++n));
      if (i === 0) {
        let pr = kid(imported, 'print');
        if (!pr) { pr = first.createElement('print'); imported.insertBefore(pr, imported.firstChild); }
        pr.setAttribute(breakType, 'yes');
      }
      target.appendChild(imported);
    });
  }
  return new XMLSerializer().serializeToString(first);
}

// Hoe geloofwaardig is een herkenning? Telt maten die precies vol zijn
// en straft rare wisselingen van maatsoort af.
export function quality(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const part = doc.getElementsByTagName('part')[0];
  if (!part) return { measures: 0, ok: 0, timeChanges: 0, score: -1e9 };
  let divisions = 1, beats = 4, beatType = 4, timeChanges = 0, lastTime = null, ok = 0;
  const measures = kids(part, 'measure');
  measures.forEach((m, mi) => {
    let pos = 0, max = 0;
    for (const el of kids(m)) {
      if (el.nodeName === 'attributes') {
        const d = txt(el, 'divisions'); if (d) divisions = parseFloat(d) || divisions;
        const t = kid(el, 'time');
        if (t) {
          beats = parseFloat(txt(t, 'beats', '4')) || 4; beatType = parseFloat(txt(t, 'beat-type', '4')) || 4;
          const sig = `${beats}/${beatType}`;
          if (lastTime && sig !== lastTime) timeChanges++;
          lastTime = sig;
        }
      } else if (el.nodeName === 'note') {
        if (kid(el, 'chord') || kid(el, 'grace')) continue;
        pos += parseFloat(txt(el, 'duration', '0')) || 0; max = Math.max(max, pos);
      } else if (el.nodeName === 'backup') pos -= parseFloat(txt(el, 'duration', '0')) || 0;
      else if (el.nodeName === 'forward') { pos += parseFloat(txt(el, 'duration', '0')) || 0; max = Math.max(max, pos); }
    }
    const expected = divisions * beats * 4 / beatType;
    const full = Math.abs(max - expected) <= expected * 0.01;
    const pickup = (mi === 0 || mi === measures.length - 1) && max > 0 && max < expected;
    if (full || pickup) ok++;
  });
  return { measures: measures.length, ok, timeChanges, score: ok - 3 * timeChanges };
}

// Akkoordsymbolen uit de ene herkenning overnemen in de andere (als de maten overeenkomen)
export function transferHarmonies(fromXml, toXml) {
  const a = new DOMParser().parseFromString(fromXml, 'text/xml');
  const b = new DOMParser().parseFromString(toXml, 'text/xml');
  const ma = kids(a.getElementsByTagName('part')[0] || a.documentElement, 'measure');
  const mb = kids(b.getElementsByTagName('part')[0] || b.documentElement, 'measure');
  if (!ma.length || !mb.length) return { xml: toXml, moved: 0 };
  const pairs = alignMeasures(ma, mb);
  const divOf = (doc) => parseFloat(doc.getElementsByTagName('divisions')[0]?.textContent || '1') || 1;
  const da = divOf(a), db = divOf(b);
  let moved = 0;
  for (const [i, j] of pairs) {
    const m = ma[i];
    // akkoorden met hun moment in de maat (in kwartnoten)
    const harms = []; let pos = 0;
    for (const el of kids(m)) {
      if (el.nodeName === 'harmony') harms.push({ el, at: pos / da });
      else if (el.nodeName === 'note' && !kid(el, 'chord') && !kid(el, 'grace')) pos += parseFloat(txt(el, 'duration', '0')) || 0;
      else if (el.nodeName === 'backup') pos -= parseFloat(txt(el, 'duration', '0')) || 0;
      else if (el.nodeName === 'forward') pos += parseFloat(txt(el, 'duration', '0')) || 0;
    }
    if (!harms.length) continue;
    const target = mb[j];
    for (const h of kids(target, 'harmony')) target.removeChild(h);
    const slots = []; let p2 = 0;
    for (const el of kids(target)) {
      if (el.nodeName === 'note' && !kid(el, 'chord') && !kid(el, 'grace')) { slots.push({ el, at: p2 / db }); p2 += parseFloat(txt(el, 'duration', '0')) || 0; }
      else if (el.nodeName === 'backup') break; // alleen eerste stem
    }
    for (const h of harms) {
      const slot = slots.find(s => s.at >= h.at - 1e-6) || null;
      const node = b.importNode(h.el, true);
      if (slot) target.insertBefore(node, slot.el); else target.appendChild(node);
      moved++;
    }
  }
  return { xml: new XMLSerializer().serializeToString(b), moved, matched: pairs.length };
}

// Maten van twee herkenningen aan elkaar koppelen op basis van de noten
// (zoals een spellingcontrole twee teksten naast elkaar legt).
function measurePitches(m) {
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const out = [];
  for (const n of kids(m, 'note')) {
    const p = kid(n, 'pitch');
    if (!p) continue;
    out.push((parseInt(txt(p, 'octave', '4'), 10) + 1) * 12 + base[txt(p, 'step', 'C')] + Math.round(parseFloat(txt(p, 'alter', '0')) || 0));
  }
  return out;
}
function similarity(x, y) {
  if (!x.length && !y.length) return 0.6;          // twee lege maten (rust)
  if (!x.length || !y.length) return 0;
  // langste gemeenschappelijke reeks
  const dp = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++)
    dp[i][j] = x[i - 1] === y[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return (2 * dp[x.length][y.length]) / (x.length + y.length);
}
export function alignMeasures(ma, mb) {
  const A = ma.map(measurePitches), B = mb.map(measurePitches);
  const n = A.length, m = B.length, GAP = -0.2;
  const S = Array.from({ length: n + 1 }, (_, i) => new Array(m + 1).fill(0).map((_, j) => (i + j) * GAP));
  const T = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const sim = similarity(A[i - 1], B[j - 1]);
    const opts = [S[i - 1][j - 1] + (sim - 0.3), S[i - 1][j] + GAP, S[i][j - 1] + GAP];
    const k = opts.indexOf(Math.max(...opts));
    S[i][j] = opts[k]; T[i][j] = k;
  }
  const pairs = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (T[i][j] === 0) { if (similarity(A[i - 1], B[j - 1]) >= 0.5) pairs.push([i - 1, j - 1]); i--; j--; }
    else if (T[i][j] === 1) i--; else j--;
  }
  return pairs.reverse();
}

// ---------------------------------------------------------------------------
// Bouwstenen voor stukken uit meerdere bronnen (bijv. losse schermafbeeldingen)

const partOf = (doc) => doc.getElementsByTagName('part')[0];

// Bij elke maat: op welke regel (systeem) van de bron hij stond
export function systemIndexPerMeasure(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const part = partOf(doc);
  if (!part) return [];
  let sys = -1;
  return kids(part, 'measure').map((m, i) => {
    const pr = kid(m, 'print');
    if (i === 0 || (pr && (pr.getAttribute('new-system') === 'yes' || pr.getAttribute('new-page') === 'yes'))) sys++;
    return sys;
  });
}

// Hoeveel maten aan het begin van b staan ook al aan het eind van a? (overlap tussen screenshots)
export function overlapMeasures(aXml, bXml, maxK = 12) {
  const a = kids(partOf(new DOMParser().parseFromString(aXml, 'text/xml')) || {}, 'measure').map(measurePitches);
  const b = kids(partOf(new DOMParser().parseFromString(bXml, 'text/xml')) || {}, 'measure').map(measurePitches);
  for (let k = Math.min(maxK, a.length, b.length); k >= 1; k--) {
    const ta = a.slice(a.length - k), hb = b.slice(0, k);
    if (!ta.some(x => x.length) || !hb.some(x => x.length)) continue;   // alleen rusten: geen bewijs
    const sims = ta.map((x, i) => similarity(x, hb[i]));
    const avg = sims.reduce((s, v) => s + v, 0) / k;
    if (avg >= 0.75 && sims.every(v => v >= 0.45)) return k;
  }
  return 0;
}

// De eerste k maten weghalen; maatinstellingen (sleutel, toonsoort, maatsoort) blijven bewaard
export function dropMeasures(xml, k) {
  if (!k) return xml;
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const part = partOf(doc);
  const ms = kids(part, 'measure');
  const carry = [];
  for (const m of ms.slice(0, k)) for (const a of kids(m, 'attributes')) carry.push(a.cloneNode(true));
  for (const m of ms.slice(0, k)) part.removeChild(m);
  const first = kids(part, 'measure')[0];
  if (first) {
    // samengevoegde attributen vooraan zetten (later gezette waarden winnen)
    const merged = doc.createElement('attributes');
    const order = ['divisions', 'key', 'time', 'staves', 'clef'];
    for (const name of order) {
      let last = null;
      for (const a of carry) for (const c of kids(a, name)) last = c;
      for (const a of kids(first, 'attributes')) for (const c of kids(a, name)) last = c;
      if (last) merged.appendChild(last.cloneNode(true));
    }
    for (const a of kids(first, 'attributes')) first.removeChild(a);
    const pr = kid(first, 'print');
    pr ? first.insertBefore(merged, pr.nextSibling) : first.insertBefore(merged, first.firstChild);
  }
  return new XMLSerializer().serializeToString(doc);
}

export const measureCount = (xml) => kids(partOf(new DOMParser().parseFromString(xml, 'text/xml')) || {}, 'measure').length;
