// Controles die bij elke release draaien. Faalt er één, dan wordt er niets uitgebracht.
import fs from 'fs';
import assert from 'assert/strict';
import { transposeXml, scoreInfo, withMeta } from '../lib/musicxml.mjs';
import { parseCommand } from '../lib/commands.mjs';
import { addIntervals, keyName, describeInterval } from '../lib/theory.mjs';
import { renderPages } from '../lib/render.mjs';
import { friendlyError, lowInterline } from '../lib/omr.mjs';

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
await renderPages(withMeta(xml, { title: 'Test' }), { meta: { title: 'Test', composer: 'X', subtitle: 'Y' } }).then(r => {
  assert.ok(r.pages.length >= 1 && r.pages[0].includes('<svg')); n++; console.log('✓ partituur tekenen met kop');
});
console.log(`\n${n} controles geslaagd`);
