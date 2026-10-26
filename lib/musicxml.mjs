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

// ---------------------------------------------------------------------------
// Opschonen van herkende muziek (uitvoer van Audiveris of homr).
// - geen koppen, tekstrommel of partijnaam ("Voice") uit de herkenning
// - posities weghalen zodat de weergave alles zelf netjes plaatst
// - dubbele akkoordtoevoegingen ("m7b5" + "b5") weghalen
// - valse sleutelwisselingen midden in een melodie herstellen
// Geeft { xml, report } terug; report telt wat er is aangepast.
const CLEF_REF = { G: 4 * 7 + 4, F: 3 * 7 + 3, C: 4 * 7 + 0 }; // G4, F3, C4 als stapnummer
const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const bottomLine = (sign, line) => (CLEF_REF[sign] ?? CLEF_REF.G) - 2 * ((parseInt(line, 10) || 2) - 1);

export function cleanRecognized(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const root = doc.documentElement;
  const report = { texts: 0, clefs: 0, notesMoved: 0, degrees: 0 };
  const remove = (el) => el && el.parentNode && el.parentNode.removeChild(el);

  // koppen en partijnamen
  for (const t of ['credit', 'work', 'movement-title', 'movement-number']) for (const el of Array.from(doc.getElementsByTagName(t))) remove(el);
  for (const pn of Array.from(doc.getElementsByTagName('part-name'))) { pn.textContent = ''; pn.setAttribute('print-object', 'no'); }
  for (const t of ['part-abbreviation', 'part-name-display', 'part-abbreviation-display']) for (const el of Array.from(doc.getElementsByTagName(t))) remove(el);

  // losse teksten (OCR) weg; tempo en oefenletters blijven.
  // Teksten die een akkoord zijn (met de typische leesfouten "Dmó", "E07") worden een echt akkoordsymbool.
  for (const dir of Array.from(doc.getElementsByTagName('direction'))) {
    const words = Array.from(dir.getElementsByTagName('words'));
    if (words.length === 1 && kids(dir, 'direction-type').length === 1) {
      const chords = chordsFromText(words[0].textContent);
      if (chords) {
        for (const c of chords) dir.parentNode.insertBefore(harmonyElement(doc, c), dir);
        remove(dir); report.chordsFromText = (report.chordsFromText || 0) + chords.length;
        continue;
      }
    }
    const types = kids(dir, 'direction-type');
    for (const dt of types) for (const w of kids(dt, 'words')) { remove(w); report.texts++; }
    for (const dt of types) if (!kids(dt).length) remove(dt);
    if (!kids(dir, 'direction-type').length) { remove(dir); continue; }
    if (kids(dir, 'direction-type').some(dt => kid(dt, 'metronome'))) dir.setAttribute('placement', 'above');
  }
  for (const el of Array.from(doc.getElementsByTagName('lyric'))) { remove(el); report.texts++; }

  // rusten op hun standaardplek
  for (const r of Array.from(doc.getElementsByTagName('rest'))) for (const t of ['display-step', 'display-octave']) for (const el of kids(r, t)) remove(el);

  // vaste posities uit de scan weghalen
  const all = doc.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) for (const a of ['default-x', 'default-y', 'relative-x', 'relative-y', 'font-size']) all[i].removeAttribute(a);

  // akkoorden: toevoeging die al in de naam staat niet nog eens noemen
  for (const h of Array.from(doc.getElementsByTagName('harmony'))) {
    const k = kid(h, 'kind');
    const ktext = (k?.getAttribute('text') || '').toLowerCase();
    for (const d of kids(h, 'degree')) {
      const v = txt(d, 'degree-value', '');
      const alt = parseInt(txt(d, 'degree-alter', '0'), 10);
      const sym = (alt < 0 ? 'b' : alt > 0 ? '#' : '') + v;
      if (ktext.includes(sym) || ktext.includes(sym.replace('b', '♭').replace('#', '♯')) || (k?.textContent === 'half-diminished' && v === '5')) { remove(d); report.degrees++; }
    }
  }

  // valse sleutelwisselingen (melodie op één notenbalk)
  for (const part of Array.from(doc.getElementsByTagName('part'))) {
    const staves = Math.max(1, ...Array.from(part.getElementsByTagName('staves')).map(s => parseInt(s.textContent, 10) || 1));
    if (staves > 1) continue;
    let first = null;      // eerste sleutel: blijft staan
    let shift = 0;         // aantal stappen dat noten moeten verschuiven
    let fifths = 0;
    for (const measure of kids(part, 'measure')) {
      for (const el of kids(measure)) {
        if (el.nodeName === 'attributes') {
          const key = kid(el, 'key'); if (key && kid(key, 'fifths')) fifths = parseInt(txt(key, 'fifths'), 10) || 0;
          for (const c of kids(el, 'clef')) {
            const sign = txt(c, 'sign', 'G'), line = txt(c, 'line', sign === 'F' ? '4' : '2');
            if (!first) { first = { sign, line }; continue; }
            shift = bottomLine(first.sign, first.line) - bottomLine(sign, line);
            remove(c); report.clefs++;
          }
          if (!kids(el).length) remove(el);
          continue;
        }
        if (el.nodeName !== 'note' || !shift) continue;
        const p = kid(el, 'pitch');
        if (!p) continue;
        const idx = (parseInt(txt(p, 'octave', '4'), 10)) * 7 + STEPS.indexOf(txt(p, 'step', 'C')) + shift;
        const step = STEPS[((idx % 7) + 7) % 7];
        const acc = txt(el, 'accidental');
        const accAlter = { sharp: 1, flat: -1, natural: 0, 'double-sharp': 2, 'flat-flat': -2 }[acc];
        const sharpsOrder = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
        const keyAlt = fifths > 0 && sharpsOrder.slice(0, fifths).includes(step) ? 1 : fifths < 0 && sharpsOrder.slice().reverse().slice(0, -fifths).includes(step) ? -1 : 0;
        const alter = accAlter ?? keyAlt;
        kid(p, 'step').textContent = step;
        kid(p, 'octave').textContent = String(Math.floor(idx / 7));
        let a = kid(p, 'alter');
        if (alter) { if (!a) { a = doc.createElement('alter'); p.insertBefore(a, kid(p, 'octave')); } a.textContent = String(alter); } else if (a) remove(a);
        report.notesMoved++;
      }
    }
  }
  // boogjes die over meer dan twee maten lopen zijn bijna altijd herkenningsfouten
  {
    const open = new Map(); const measuresOf = new Map();
    let mi = 0;
    for (const part of Array.from(doc.getElementsByTagName('part'))) for (const m of kids(part, 'measure')) {
      mi++;
      for (const n of kids(m, 'note')) for (const nots of kids(n, 'notations')) for (const sl of kids(nots, 'slur')) {
        const num = sl.getAttribute('number') || '1', type = sl.getAttribute('type');
        if (type === 'start') open.set(num, { el: sl, mi });
        else if (type === 'stop') {
          const st = open.get(num);
          if (!st || mi - st.mi > 2) { if (st) remove(st.el); remove(sl); report.slurs = (report.slurs || 0) + 1; }
          open.delete(num);
        }
      }
    }
    for (const { el } of open.values()) { remove(el); report.slurs = (report.slurs || 0) + 1; }
    for (const nots of Array.from(doc.getElementsByTagName('notations'))) if (!kids(nots).length) remove(nots);
  }

  // maatsoorten die even lang zijn maar anders geschreven (16/16, 8/8, 2/2 → 4/4)
  const times = Array.from(doc.getElementsByTagName('time'));
  const len = (t) => (parseFloat(txt(t, 'beats', '4')) || 4) * 4 / (parseFloat(txt(t, 'beat-type', '4')) || 4);
  if (times.length > 1 && times.every(t => Math.abs(len(t) - len(times[0])) < 1e-6)) {
    const q = len(times[0]);
    const [b, bt] = Number.isInteger(q) ? [q, 4] : [q * 2, 8];
    times.forEach((t, i) => {
      if (i === 0) { kid(t, 'beats').textContent = String(b); kid(t, 'beat-type').textContent = String(bt); t.removeAttribute('symbol'); if (b === 4 && bt === 4 && /common/.test(t.getAttribute('symbol') || '')) t.setAttribute('symbol', 'common'); }
      else { const a = t.parentNode; remove(t); if (!kids(a).length) remove(a); report.times = (report.times || 0) + 1; }
    });
  }

  report.beamed = autoBeam(doc);
  recomputeAccidentals(doc);
  return { xml: new XMLSerializer().serializeToString(doc), report };
}

// Verbindingsbalken zetten in maten zonder balken: achtsten en kleiner per tel groeperen.
const FLAGS = { eighth: 1, '16th': 2, '32nd': 3, '64th': 4 };
function autoBeam(doc) {
  let count = 0;
  for (const part of Array.from(doc.getElementsByTagName('part'))) {
    let divisions = 1, beats = 4, beatType = 4;
    for (const m of kids(part, 'measure')) {
      for (const a of kids(m, 'attributes')) {
        const d = txt(a, 'divisions'); if (d) divisions = parseFloat(d) || divisions;
        const t = kid(a, 'time'); if (t) { beats = parseFloat(txt(t, 'beats', '4')) || 4; beatType = parseFloat(txt(t, 'beat-type', '4')) || 4; }
      }
      const notes = kids(m, 'note');
      if (notes.some(n => kid(n, 'beam'))) continue;     // heeft al balken
      if (kids(m, 'backup').length) continue;             // meerdere stemmen: niet aankomen
      const compound = beatType === 8 && beats % 3 === 0 && beats > 3;
      const beatLen = divisions * (compound ? 1.5 : 4 / beatType) * (beatType === 8 && !compound ? 2 : 1);
      // groepen bouwen
      const groups = []; let cur = []; let pos = 0; let curBeat = -1;
      const flush = () => { if (cur.length > 1) groups.push(cur); cur = []; };
      for (const n of notes) {
        if (kid(n, 'chord') || kid(n, 'grace')) { continue; }
        const dur = parseFloat(txt(n, 'duration', '0')) || 0;
        const flags = FLAGS[txt(n, 'type', '')] || 0;
        const beat = Math.floor((pos + 1e-6) / beatLen);
        if (!flags || kid(n, 'rest')) { flush(); }
        else { if (beat !== curBeat) flush(); cur.push({ n, flags }); }
        curBeat = flags && !kid(n, 'rest') ? beat : -1;
        pos += dur;
      }
      flush();
      for (const g of groups) {
        const maxLevel = Math.max(...g.map(x => x.flags));
        for (let level = 1; level <= maxLevel; level++) {
          g.forEach((x, i) => {
            if (x.flags < level) return;
            const prev = i > 0 && g[i - 1].flags >= level, next = i < g.length - 1 && g[i + 1].flags >= level;
            let v;
            if (level === 1) v = i === 0 ? 'begin' : i === g.length - 1 ? 'end' : 'continue';
            else if (prev && next) v = 'continue'; else if (next) v = 'begin'; else if (prev) v = 'end';
            else v = i === 0 ? 'forward hook' : 'backward hook';
            const b = doc.createElement('beam'); b.setAttribute('number', String(level)); b.textContent = v;
            // beam komt na stem/notehead/staff, vóór notations
            const ref = kids(x.n).find(c => ['notations', 'lyric', 'play', 'listen'].includes(c.nodeName));
            ref ? x.n.insertBefore(b, ref) : x.n.appendChild(b);
          });
        }
        count++;
      }
    }
  }
  return count;
}

export const hasEncodedBreaks = (xml) => /new-system="yes"|new-page="yes"/.test(xml);

// Alle noten als MIDI-nummers (voor de octaafkeuze)
export function midiNotes(xml) {
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  return [...xml.matchAll(/<pitch>([\s\S]*?)<\/pitch>/g)].map(m => {
    const st = (m[1].match(/<step>\s*([A-G])/) || [])[1];
    const al = parseFloat((m[1].match(/<alter>\s*(-?[\d.]+)/) || [])[1] || '0');
    const oc = parseInt((m[1].match(/<octave>\s*(\d+)/) || [])[1] || '4', 10);
    return st ? (oc + 1) * 12 + base[st] + Math.round(al) : null;
  }).filter(n => n !== null);
}

// ---------------------------------------------------------------------------
// Noten verbeteren. index = volgnummer van de noot (noten én rusten, in leesvolgorde,
// zoals ze ook in de weergave staan). iv = de transpositie die je op dat moment ziet:
// de wijziging wordt teruggerekend naar het origineel.
const ACC_ALTER = { sharp: 1, flat: -1, natural: 0, 'double-sharp': 2, 'flat-flat': -2 };

function keyAlterFor(step, fifths) {
  const order = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  if (fifths > 0 && order.slice(0, fifths).includes(step)) return 1;
  if (fifths < 0 && order.slice().reverse().slice(0, -fifths).includes(step)) return -1;
  return 0;
}

export function listEvents(doc) {
  // alle note-elementen behalve doorgebonden "verborgen" tweede helft
  return Array.from(doc.getElementsByTagName('note')).filter(n => n.getAttribute('print-object') !== 'no');
}

export function editNote(xml, index, action, iv = { steps: 0, semis: 0 }) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const notes = listEvents(doc);
  const note = notes[index];
  if (!note) throw new Error('Noot niet gevonden');
  // toonsoort op die plek
  let fifths = 0;
  const measure = note.parentNode;
  const part = measure.parentNode;
  for (const m of kids(part, 'measure')) {
    for (const a of kids(m, 'attributes')) { const k = kid(a, 'key'); if (k && kid(k, 'fifths')) fifths = parseInt(txt(k, 'fifths'), 10) || 0; }
    if (m === measure) break;
  }
  const shownFifths = tonicToFifthsSafe(fifths, iv);
  const remove = (el) => el && el.parentNode && el.parentNode.removeChild(el);
  let pitch = kid(note, 'pitch');

  if (action === 'rest') {
    if (pitch) { note.replaceChild(doc.createElement('rest'), pitch); }
    for (const t of ['accidental', 'tie', 'stem']) for (const el of kids(note, t)) remove(el);
    const nots = kid(note, 'notations'); if (nots) for (const t of kids(nots, 'tied')) remove(t);
    recomputeAccidentals(doc);
    return new XMLSerializer().serializeToString(doc);
  }
  if (!pitch) {
    // rust → noot (op de middelste lijn van de solsleutel, in de getoonde toonsoort)
    const r = kid(note, 'rest');
    pitch = doc.createElement('pitch');
    const st = doc.createElement('step'); st.textContent = 'B';
    const oc = doc.createElement('octave'); oc.textContent = '4';
    pitch.appendChild(st); pitch.appendChild(oc);
    note.replaceChild(pitch, r);
    // terugrekenen naar origineel
    const back = transposePitch('B', keyAlterFor('B', shownFifths), 4, { steps: -iv.steps, semis: -iv.semis });
    setPitch(doc, pitch, back);
    recomputeAccidentals(doc);
    return new XMLSerializer().serializeToString(doc);
  }

  // huidige noot zoals je hem ziet
  const cur = transposePitch(txt(pitch, 'step'), Math.round(parseFloat(txt(pitch, 'alter', '0')) || 0), parseInt(txt(pitch, 'octave'), 10), iv);
  let next = { ...cur };
  const stepBy = (d) => {
    const idx = cur.octave * 7 + STEPS.indexOf(cur.step) + d;
    const step = STEPS[((idx % 7) + 7) % 7];
    return { step, octave: Math.floor(idx / 7), alter: keyAlterFor(step, shownFifths) };
  };
  if (action === 'up') next = stepBy(1);
  else if (action === 'down') next = stepBy(-1);
  else if (action === 'octUp') next = { ...cur, octave: cur.octave + 1 };
  else if (action === 'octDown') next = { ...cur, octave: cur.octave - 1 };
  else if (action in ACC_ALTER) next = { ...cur, alter: ACC_ALTER[action] };
  else throw new Error('Onbekende bewerking');
  const back = transposePitch(next.step, next.alter, next.octave, { steps: -iv.steps, semis: -iv.semis });
  setPitch(doc, pitch, back);
  recomputeAccidentals(doc);
  return new XMLSerializer().serializeToString(doc);
}

function setPitch(doc, pitch, p) {
  const set = (name, val, before) => {
    let el = kid(pitch, name);
    if (val === null) { if (el) pitch.removeChild(el); return; }
    if (!el) { el = doc.createElement(name); const ref = before ? kid(pitch, before) : null; ref ? pitch.insertBefore(el, ref) : pitch.appendChild(el); }
    el.textContent = String(val);
  };
  set('step', p.step);
  set('alter', p.alter ? p.alter : null, 'octave');
  set('octave', p.octave);
}

function tonicToFifthsSafe(fifths, iv) {
  if (!iv.steps && !iv.semis) return fifths;
  return tonicToFifths(transposePitchClass(keyToTonic(fifths), iv));
}

// Alleen de voortekens opnieuw zetten (na een bewerking)
export function normalizeAccidentals(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  recomputeAccidentals(doc);
  return new XMLSerializer().serializeToString(doc);
}

// Elke noot/rust een vast nummer geven, zodat een klik in de weergave de juiste noot vindt
export function tagEvents(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  listEvents(doc).forEach((n, i) => n.setAttribute('id', 'tp' + i));
  return new XMLSerializer().serializeToString(doc);
}

// Een stuk opdelen in losse regels (voor regel-voor-regel vergelijken).
// starts = maatnummers (0-gebaseerd) waar een nieuwe regel begint.
// Elke regel krijgt de geldende sleutel, toonsoort en maatsoort mee; noot-id's blijven staan.
export function splitLines(xml, starts) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const part = doc.getElementsByTagName('part')[0];
  if (!part) return [xml];
  const measures = kids(part, 'measure');
  const bounds = [...new Set([0, ...starts.filter(s => s > 0 && s < measures.length)])].sort((a, b) => a - b);
  const state = { divisions: null, key: null, time: null, clef: null, staves: null };
  const out = [];
  let mi = 0;
  bounds.forEach((start, bi) => {
    const end = bi + 1 < bounds.length ? bounds[bi + 1] : measures.length;
    // stand van zaken tot aan deze regel bijwerken
    for (; mi < start; mi++) for (const a of kids(measures[mi], 'attributes')) for (const name of Object.keys(state)) { const c = kid(a, name); if (c) state[name] = c; }
    const lineDoc = new DOMParser().parseFromString(xml, 'text/xml');
    const lpart = lineDoc.getElementsByTagName('part')[0];
    const lms = kids(lpart, 'measure');
    lms.forEach((m, i) => { if (i < start || i >= end) lpart.removeChild(m); });
    const first = kids(lpart, 'measure')[0];
    if (first) {
      for (const p of kids(first, 'print')) first.removeChild(p);
      let attr = kids(first, 'attributes')[0];
      if (!attr) { attr = lineDoc.createElement('attributes'); first.insertBefore(attr, first.firstChild); }
      const order = ['divisions', 'key', 'time', 'staves', 'clef'];
      for (const name of order) {
        if (kid(attr, name) || !state[name]) continue;
        const node = lineDoc.importNode(state[name], true);
        const after = order.slice(order.indexOf(name) + 1).map(n => kid(attr, n)).find(Boolean);
        after ? attr.insertBefore(node, after) : attr.appendChild(node);
      }
    }
    // koppen weg: alleen de muziek
    for (const t of ['credit', 'work', 'movement-title']) for (const el of Array.from(lineDoc.getElementsByTagName(t))) el.parentNode.removeChild(el);
    out.push(new XMLSerializer().serializeToString(lineDoc));
  });
  return out;
}

// ---------------------------------------------------------------------------
// Akkoordnamen uit tekst halen, met correctie van veelvoorkomende leesfouten.
const KINDS = [
  // [kwaliteit, getal, MusicXML-kind]
  ['', '', 'major'], ['', '6', 'major-sixth'], ['', '7', 'dominant'], ['', '9', 'dominant-ninth'], ['', '11', 'dominant-11th'], ['', '13', 'dominant-13th'],
  ['m', '', 'minor'], ['m', '6', 'minor-sixth'], ['m', '7', 'minor-seventh'], ['m', '9', 'minor-ninth'], ['m', '11', 'minor-11th'], ['m', '13', 'minor-13th'],
  ['maj', '', 'major'], ['maj', '7', 'major-seventh'], ['maj', '9', 'major-ninth'], ['maj', '13', 'major-13th'],
  ['ø', '', 'half-diminished'], ['ø', '7', 'half-diminished'],
  ['dim', '', 'diminished'], ['dim', '7', 'diminished-seventh'],
  ['aug', '', 'augmented'], ['aug', '7', 'augmented-seventh'],
  ['sus4', '', 'suspended-fourth'], ['sus4', '7', 'suspended-fourth'], ['sus2', '', 'suspended-second'],
];
export function chordFromText(raw) {
  let t = String(raw).trim().replace(/[.,‚'"`´_:;]+$/g, '').replace(/^[.,‚'"`´_]+/, '');
  t = t.replace(/♭/g, 'b').replace(/♯/g, '#').replace(/Δ/g, 'maj');
  // leesfouten: ó/ò/ö → 6, ¢/Ø/0 direct na de grondtoon → ø, l → 1
  t = t.replace(/^([A-G][b#]?m?)[óòöô]/, '$1' + '6').replace(/^([A-G][b#]?)(?:[¢Ø0]|o(?=7))/, '$1ø');
  const m = t.match(/^([A-G])([b#]?)(maj|ma|M|mi|min|m|ø|dim|°|o|aug|\+|sus4|sus2|sus)?(\d{1,2})?((?:\(?[b#]\d{1,2}\)?)*)(?:\/([A-G])([b#]?))?$/);
  if (!m) return null;
  let [, root, acc, q = '', num = '', alts = '', bass, bassAcc] = m;
  q = { ma: 'maj', M: 'maj', mi: 'm', min: 'm', '°': 'dim', o: 'dim', '+': 'aug', sus: 'sus4' }[q] ?? q;
  // m7b5 = halfverminderd
  let written = null;
  if (q === 'm' && num === '7' && /b5/.test(alts)) { q = 'ø'; alts = alts.replace(/\(?b5\)?/, ''); written = 'm7b5'; }
  if (q === 'maj' && num === '') num = '7';  // "Cmaj" wordt meestal als maj7 bedoeld
  const k = KINDS.find(([a, b]) => a === q && b === num);
  if (!k) return null;
  const degrees = [...alts.matchAll(/([b#])(\d{1,2})/g)].map(([, s2, v]) => ({ value: parseInt(v, 10), alter: s2 === 'b' ? -1 : 1 }));
  const text = written || ((q === 'ø' ? 'ø' : q === 'dim' ? 'o' : q === 'aug' ? '+' : q === 'maj' ? 'maj' : q) + num);
  return { step: root, alter: acc === 'b' ? -1 : acc === '#' ? 1 : 0, kind: k[2], text, degrees,
    bass: bass ? { step: bass, alter: bassAcc === 'b' ? -1 : bassAcc === '#' ? 1 : 0 } : null };
}
export function chordsFromText(raw) {
  const tokens = String(raw).split(/[\s_‚,]+/).filter(t => /[A-Za-z0-9]/.test(t));
  if (!tokens.length || tokens.length > 4) return null;
  const out = tokens.map(chordFromText);
  return out.every(Boolean) ? out : null;
}
function harmonyElement(doc, c) {
  const h = doc.createElement('harmony'); h.setAttribute('placement', 'above');
  const root = doc.createElement('root');
  const rs = doc.createElement('root-step'); rs.textContent = c.step; root.appendChild(rs);
  if (c.alter) { const ra = doc.createElement('root-alter'); ra.textContent = String(c.alter); root.appendChild(ra); }
  h.appendChild(root);
  const k = doc.createElement('kind'); k.setAttribute('text', c.text); k.textContent = c.kind; h.appendChild(k);
  if (c.bass) {
    const b = doc.createElement('bass');
    const bs = doc.createElement('bass-step'); bs.textContent = c.bass.step; b.appendChild(bs);
    if (c.bass.alter) { const ba = doc.createElement('bass-alter'); ba.textContent = String(c.bass.alter); b.appendChild(ba); }
    h.appendChild(b);
  }
  for (const d of c.degrees) {
    const de = doc.createElement('degree');
    for (const [n, v] of [['degree-value', d.value], ['degree-alter', d.alter], ['degree-type', 'alter']]) { const e = doc.createElement(n); e.textContent = String(v); de.appendChild(e); }
    h.appendChild(de);
  }
  return h;
}
