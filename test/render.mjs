import fs from 'fs';
import { renderPages } from '../lib/render.mjs';
import { transposeXml } from '../lib/musicxml.mjs';
const xml = fs.readFileSync(new URL('../samples/voorbeeld.musicxml', import.meta.url), 'utf8');
const t = transposeXml(xml, { steps: 1, semis: 2 });
const r = await renderPages(t);
console.log(r.pageCount, r.pages[0].slice(0, 300));
fs.writeFileSync('/tmp/claude-0/-home-claude/f505defb-8d55-5d21-ae74-34f050d38f65/scratchpad/p1.svg', r.pages[0]);
