// Controles die bij elke release draaien. Faalt er één, dan wordt er niets uitgebracht.
import fs from 'fs';
import assert from 'assert/strict';
import { transposeXml, scoreInfo, withMeta } from '../lib/musicxml.mjs';
import { parseCommand } from '../lib/commands.mjs';
import { addIntervals, keyName, describeInterval } from '../lib/theory.mjs';
import { renderPages } from '../lib/render.mjs';
import { friendlyError, lowInterline } from '../lib/omr.mjs';
import { cleanRecognized, editNote, listEvents, tagEvents } from '../lib/musicxml.mjs';
import { instrumentInterval, fitOctave } from '../lib/instruments.mjs';
import { quality, transferHarmonies, mergePages } from '../lib/engines.mjs';
import { DOMParser } from '@xmldom/xmldom';

const xml = fs.readFileSync(new URL('../samples/voorbeeld.musicxml', import.meta.url), 'utf8');
const info = scoreInfo(xml);
const notes = (x) => [...x.matchAll(/<pitch>(.*?)<\/pitch>/gs)].map(m => m[1].match(/<step>(\w)/)[1]
  + ({ '-1': 'b', '1': '#', '-2': 'bb', '2': '##' }[(m[1].match(/<alter>(-?\d)/) || [])[1]] || '') + m[1].match(/<octave>(\d)/)[1]).join(' ');
const accs = (x) => [...x.matchAll(/<accidental>([\w-]+)/g)].map(m => m[1]).join(',');
const chords = (x) => [...x.matchAll(/<root-step>(\w)<\/root-step>(?:<root-alter>(-?\d)<\/root-alter>)?/g)].map(m => m[1] + (m[2] === '-1' ? 'b' : m[2] === '1' ? '#' : '')).join(',');
const ctx = { fifths: info.fifths, mode: info.mode, current: { steps: 0, semis: 0 }, pref: 'auto' };
const run = (cmd) => { const r = parseCommand(cmd, ctx); return r.type === 'add' ? addIntervals(ctx.current, r.interval) : r.interval; };
let n = 0;
const check = (name, fn) => { fn(); n++; console.log('✓', name); };

check('origineel in F groot', () => assert.equal(keyName(info.fifths, info.mode), 'F groot'));
check('van F naar G', () => {
  const t = transposeXml(xml, run('van F naar G'));
  assert.equal(notes(t), 'G4 B4 C5 C#5 D5 F#4 F#4 A4 G4');
  assert.equal(keyName(scoreInfo(t).fifths), 'G groot');
  assert.equal(accs(t), 'sharp');
  assert.equal(chords(t), 'G,D,G');
});
check('3 halve tonen omhoog naar As', () => {
  const t = transposeXml(xml, run('3 halve tonen omhoog'));
  assert.equal(notes(t), 'Ab4 C5 Db5 D5 Eb5 G4 G4 Bb4 Ab4');
  assert.equal(accs(t), 'natural');
});
check('naar Des (herstellingsteken)', () => assert.equal(accs(transposeXml(xml, run('naar Des'))), 'natural'));
check('naar fis (eis zonder voorteken)', () => assert.equal(notes(transposeXml(xml, run('naar fis'))), 'F#4 A#4 B4 B#4 C#5 E#4 E#4 G#4 F#4'));
check('octaaf omhoog', () => assert.equal(notes(transposeXml(xml, run('octaaf omhoog'))), 'F5 A5 Bb5 B5 C6 E5 E5 G5 F5'));
check('altsax', () => assert.equal(keyName(scoreInfo(transposeXml(xml, run('voor altsax'))).fifths), 'D groot'));
check('onbekende opdracht', () => assert.equal(parseCommand('blabla', ctx).type, 'error'));
check('omschrijving interval', () => assert.equal(describeInterval({ steps: 1, semis: 2 }), 'grote secunde omhoog (2 halve tonen)'));
check('foutmelding lage resolutie', () => {
  const log = 'With a too low interline value of 5 pixels';
  assert.equal(lowInterline(log), 5);
  assert.match(friendlyError(log), /resolutie is te laag/);
});
// valse bassleutel in een melodie: noten blijven op dezelfde plek, maar in de solsleutel
const fakeClef = xml.replace('<measure number="2">', '<measure number="2"><attributes><clef><sign>F</sign><line>4</line></clef></attributes>')
  .replace('<note><pitch><step>C</step><octave>5</octave></pitch>', '<note><pitch><step>E</step><octave>3</octave></pitch>');
check('valse sleutel herstellen', () => {
  const c = cleanRecognized(fakeClef);
  assert.equal(c.report.clefs, 1);
  assert.equal(notes(c.xml).split(' ')[4], 'C5');
});
check('16/16 wordt 4/4', () => {
  const x = xml.replace('<beats>4</beats><beat-type>4</beat-type>', '<beats>16</beats><beat-type>16</beat-type>')
    .replace('<measure number="3">', '<measure number="3"><attributes><time><beats>8</beats><beat-type>8</beat-type></time></attributes>');
  const c = cleanRecognized(x);
  assert.match(c.xml, /<beats>4<\/beats><beat-type>4<\/beat-type>/);
  assert.equal((c.xml.match(/<time/g) || []).length, 1);
});
check('geen partijnaam of koptekst uit de herkenning', () => {
  const c = cleanRecognized(xml);
  assert.doesNotMatch(c.xml, /<work-title>|Zang<\/part-name>/);
});
check('noot verbeteren in getransponeerde weergave', () => {
  const iv = { steps: 1, semis: 2 };          // weergave in G
  const up = editNote(xml, 0, 'up', iv);        // G → A in weergave = F → G in origineel
  assert.equal(notes(up).split(' ')[0], 'G4');
  const sh = editNote(xml, 0, 'sharp', iv);     // G♯ in weergave = F♯ in origineel
  assert.equal(notes(sh).split(' ')[0], 'F#4');
  const r = editNote(xml, 0, 'rest');
  assert.equal(listEvents(new DOMParser().parseFromString(r, 'text/xml'))[0].getElementsByTagName('rest').length, 1);
  assert.equal((tagEvents(xml).match(/id="tp\d+"/g) || []).length, 10);
});
check('van tenorsax naar altsax', () => assert.deepEqual(instrumentInterval('tenorsax', 'altsax'), { steps: -3, semis: -5 }));
check('octaaf passend bij bereik', () => assert.equal(fitOctave([40, 43, 45], 'altsax'), 2));
check('kwaliteit en akkoorden overnemen', () => {
  assert.equal(quality(xml).ok, 4);
  const bare = xml.replace(/<harmony>[\s\S]*?<\/harmony>/g, '');
  const t = transferHarmonies(xml, bare);
  assert.equal(t.moved, 3);
  assert.equal((mergePages([xml, xml]).match(/<measure /g) || []).length, 8);
});
await renderPages(withMeta(xml, { title: 'Test' }), { meta: { title: 'Test', composer: 'X', subtitle: 'Y' } }).then(r => {
  assert.ok(r.pages.length >= 1 && r.pages[0].includes('<svg')); n++; console.log('✓ partituur tekenen met kop');
});
console.log(`\n${n} controles geslaagd`);
