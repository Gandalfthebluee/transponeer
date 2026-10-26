import fs from 'fs';
import { withMeta, transposeXml } from '../lib/musicxml.mjs';
import { renderPages } from '../lib/render.mjs';
const xml = fs.readFileSync(new URL('../samples/lied.musicxml', import.meta.url), 'utf8').replace(/<work>.*?<\/work>/, '').replace(/<identification>.*?<\/identification>/, '');
const x = withMeta(transposeXml(xml, { steps: 1, semis: 2 }), { title: 'Altijd is Kortjakje ziek', composer: 'Traditioneel', subtitle: 'Zang in E' });
const { pages } = await renderPages(x);
fs.writeFileSync(process.argv[2], pages[0]);
