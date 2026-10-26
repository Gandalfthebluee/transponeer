// MusicXML lezen, transponeren en voortekens opnieuw berekenen.
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import AdmZip from 'adm-zip';
import { transposePitch, transposePitchClass, keyToTonic, tonicToFifths } from './theory.mjs';

export function readScoreFile(filePath, buffer) {
  // .mxl is a zip with META-INF/container.xml
  if (/\.mxl$/i.test(filePath)) {
    const zip = new AdmZip(buffer);
    const container = zip.getEntry('META-INF/container.xml');
    let rootPath = null;
    if (container) {
      const m = container.getData().toString('utf8').match(/full-path="([^"]+)"/);
      if (m) rootPath = m[1];
    }
    const entry = rootPath ? zip.getEntry(rootPath)
      : zip.getEntries().find(e => /\.(xml|musicxml)$/i.test(e.entryName) && !e.entryName.startsWith('META-INF'));
    if (!entry) throw new Error('Geen MusicXML gevonden in .mxl-bestand');
    return entry.getData().toString('utf8');
  }
  return buffer.toString('utf8');
}

const kids = (el, name) => {
  const out = [];
  for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && (!name || c.nodeName === name)) out.push(c);
  return out;
};
const kid = (el, name) => kids(el, name)[0] || null;
const txt = (el, name, def = null) => { const k = kid(el, name); return k ? k.textContent.trim() : def; };

function setChildText(doc, el, name, value, before = null) {
  let k = kid(el, name);
  if (value === null) { if (k) el.removeChild(k); return; }
  if (!k) {
    k = doc.createElement(name);
    const ref = before ? kid(el, before) : null;
    if (ref) el.insertBefore(k, ref); else el.appendChild(k);
  }
  k.textContent = String(value);
}

export function scoreInfo(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const keys = doc.getElementsByTagName('key');
  let fifths = 0, mode = 'major';
  if (keys.length) {
    fifths = parseInt(txt(keys[0], 'fifths', '0'), 10) || 0;
    mode = txt(keys[0], 'mode', 'major') === 'minor' ? 'minor' : 'major';
  }
  const title = (doc.getElementsByTagName('work-title')[0] || doc.getElementsByTagName('movement-title')[0])?.textContent?.trim() || '';
  const creators = Array.from(doc.getElementsByTagName('creator'));
  const composer = (creators.find(c => c.getAttribute('type') === 'composer') || creators[0])?.textContent?.trim() || '';
  return { fifths, mode, title, composer, measures: doc.getElementsByTagName('measure').length / Math.max(1, doc.getElementsByTagName('part').length) };
}

const ACC_NAMES = { '-2': 'flat-flat', '-1': 'flat', '0': 'natural', '1': 'sharp', '2': 'double-sharp' };

export function transposeXml(xml, iv) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (iv.steps === 0 && iv.semis === 0) return xml;

  // 1. toonsoorten
  for (const key of Array.from(doc.getElementsByTagName('key'))) {
    const fifthsEl = kid(key, 'fifths');
    if (!fifthsEl) continue;
    const f = parseInt(fifthsEl.textContent, 10) || 0;
    const tonic = transposePitchClass(keyToTonic(f), iv);
    fifthsEl.textContent = String(tonicToFifths(tonic));
  }

  // 2. noten
  for (const pitch of Array.from(doc.getElementsByTagName('pitch'))) {
    const step = txt(pitch, 'step', 'C');
    const alter = parseFloat(txt(pitch, 'alter', '0')) || 0;
    const octave = parseInt(txt(pitch, 'octave', '4'), 10);
    const p = transposePitch(step, Math.round(alter), octave, iv);
    setChildText(doc, pitch, 'step', p.step);
    setChildText(doc, pitch, 'alter', p.alter === 0 ? null : p.alter, 'octave');
    setChildText(doc, pitch, 'octave', p.octave);
  }

  // 3. akkoordsymbolen
  const shiftRoot = (el, stepName, alterName) => {
    if (!el) return;
    const step = txt(el, stepName);
    if (!step) return;
    const alter = Math.round(parseFloat(txt(el, alterName, '0')) || 0);
    const t = transposePitchClass({ letter: step, alter }, iv);
    setChildText(doc, el, stepName, t.letter);
    setChildText(doc, el, alterName, t.alter === 0 ? null : t.alter);
  };
  for (const h of Array.from(doc.getElementsByTagName('harmony'))) {
    shiftRoot(kid(h, 'root'), 'root-step', 'root-alter');
    shiftRoot(kid(h, 'bass'), 'bass-step', 'bass-alter');
  }

  recomputeAccidentals(doc);
  return new XMLSerializer().serializeToString(doc);
}

// Voortekens (kruizen/mollen/herstellingstekens) opnieuw bepalen per maat.
function recomputeAccidentals(doc) {
  for (const part of Array.from(doc.getElementsByTagName('part'))) {
    let fifths = 0;
    const tiedIn = new Map(); // staff|step|octave -> alter of tied note continuing into next measure
    for (const measure of kids(part, 'measure')) {
      const attr = kid(measure, 'attributes');
      if (attr) {
        const key = kid(attr, 'key');
        if (key && kid(key, 'fifths')) fifths = parseInt(txt(key, 'fifths'), 10) || 0;
      }
      const keyAlter = (step) => {
        const sharps = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
        if (fifths > 0 && sharps.slice(0, fifths).includes(step)) return 1;
        if (fifths < 0 && sharps.slice().reverse().slice(0, -fifths).includes(step)) return -1;
        return 0;
      };
      const state = new Map(); // staff|step|octave -> current alter
      const nextTied = new Map();
      for (const el of kids(measure)) {
        if (el.nodeName === 'attributes') {
          const key = kid(el, 'key');
          if (key && kid(key, 'fifths')) fifths = parseInt(txt(key, 'fifths'), 10) || 0;
          continue;
        }
        if (el.nodeName !== 'note') continue;
        const pitch = kid(el, 'pitch');
        if (!pitch) continue;
        const staff = txt(el, 'staff', '1');
        const step = txt(pitch, 'step');
        const octave = txt(pitch, 'octave');
        const alter = Math.round(parseFloat(txt(pitch, 'alter', '0')) || 0);
        const k = `${staff}|${step}|${octave}`;
        const ties = kids(el, 'tie').map(t => t.getAttribute('type'));
        const isGrace = !!kid(el, 'grace');

        const current = state.has(k) ? state.get(k) : keyAlter(step);
        let needs = alter !== current;
        // doorgebonden noot uit vorige maat: geen nieuw voorteken
        if (ties.includes('stop') && tiedIn.get(k) === alter && !state.has(k)) needs = false;

        const old = kid(el, 'accidental');
        if (old) el.removeChild(old);
        if (needs) {
          const acc = doc.createElement('accidental');
          acc.textContent = ACC_NAMES[String(alter)] || 'natural';
          // MusicXML-volgorde: accidental komt na type/dot, vóór time-modification/stem/notehead...
          const after = ['time-modification', 'stem', 'notehead', 'notehead-text', 'staff', 'beam', 'notations', 'lyric', 'play', 'listen'];
          let ref = null;
          for (const c of kids(el)) if (after.includes(c.nodeName)) { ref = c; break; }
          if (ref) el.insertBefore(acc, ref); else el.appendChild(acc);
          if (!(ties.includes('stop') && tiedIn.get(k) === alter && !state.has(k))) state.set(k, alter);
        } else if (!state.has(k) && !isGrace) {
          state.set(k, alter);
        }
        if (ties.includes('start')) nextTied.set(k, alter);
      }
      tiedIn.clear();
      for (const [k, v] of nextTied) tiedIn.set(k, v);
    }
  }
}

// Titel en componist uit de app in de MusicXML zetten (voor de kop van de PDF)
export function withMeta(xml, { title, composer, subtitle } = {}) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const root = doc.documentElement;
  const first = (name) => doc.getElementsByTagName(name)[0] || null;
  const ensure = (parent, name, before) => {
    let el = kids(parent, name)[0];
    if (!el) { el = doc.createElement(name); const ref = before && kids(parent).find(c => before.includes(c.nodeName)); ref ? parent.insertBefore(el, ref) : parent.appendChild(el); }
    return el;
  };
  const order = ['work', 'movement-number', 'movement-title', 'identification', 'defaults', 'credit', 'part-list'];
  if (title) {
    const work = ensure(root, 'work', order.slice(1));
    ensure(work, 'work-title').textContent = title;
    const mt = first('movement-title'); if (mt) mt.parentNode.removeChild(mt);
  }
  if (composer) {
    const ident = ensure(root, 'identification', order.slice(4));
    let c = kids(ident, 'creator').find(e => e.getAttribute('type') === 'composer');
    if (!c) { c = doc.createElement('creator'); c.setAttribute('type', 'composer'); ident.insertBefore(c, ident.firstChild); }
    c.textContent = composer;
  }
  // losse kopteksten (credits) weghalen: de kop wordt bij het tekenen gemaakt uit titel/componist
  for (const cr of Array.from(doc.getElementsByTagName('credit'))) cr.parentNode.removeChild(cr);
  return new XMLSerializer().serializeToString(doc);
}
