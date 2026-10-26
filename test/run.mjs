import fs from 'fs';
import { transposeXml, scoreInfo } from '../lib/musicxml.mjs';
import { parseCommand } from '../lib/commands.mjs';
import { intervalFromSemitones, describeInterval, keyName, addIntervals } from '../lib/theory.mjs';
const xml = fs.readFileSync(new URL('../samples/voorbeeld.musicxml', import.meta.url), 'utf8');
const info = scoreInfo(xml);
console.log('info', info, keyName(info.fifths, info.mode));
function notes(x) {
  return [...x.matchAll(/<pitch>(.*?)<\/pitch>/gs)].map(m => {
    const st = m[1].match(/<step>(\w)/)[1], al = (m[1].match(/<alter>(-?\d)/)||[0,'0'])[1], oc = m[1].match(/<octave>(\d)/)[1];
    return st + ({'-2':'bb','-1':'b','0':'','1':'#','2':'##'}[al]) + oc;
  }).join(' ') + ' | key ' + x.match(/<fifths>(-?\d+)/)[1] + ' | acc ' + [...x.matchAll(/<accidental>(\w[\w-]*)/g)].map(m=>m[1]).join(',') + ' | chords ' + [...x.matchAll(/<root-step>(\w)<\/root-step>(?:<root-alter>(-?\d)<\/root-alter>)?/g)].map(m=>m[1]+(m[2]==='-1'?'b':m[2]==='1'?'#':'')).join(',');
}
console.log('orig   ', notes(xml));
const ctx = { fifths: info.fifths, mode: info.mode, current: {steps:0,semis:0}, pref:'auto' };
for (const cmd of ['3 halve tonen omhoog','2 halve tonen omlaag','een hele toon omhoog','van F naar G','naar Bes','naar fis','naar Des','kleine terts omlaag','octaaf omhoog','voor Bes-klarinet','voor altsax','+5','-1','toonsoort naar E','origineel','blabla','naar x']) {
  const r = parseCommand(cmd, ctx);
  let line = `${cmd.padEnd(22)} → ${r.type} ${r.message}`;
  if (r.interval) {
    const iv = r.type === 'add' ? addIntervals(ctx.current, r.interval) : r.interval;
    const t = transposeXml(xml, iv);
    line += `\n    ${describeInterval(iv)} | nieuw: ${keyName(scoreInfo(t).fifths)}\n    ${notes(t)}`;
  }
  console.log(line);
}
