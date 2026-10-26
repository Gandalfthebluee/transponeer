// Begrijpt getypte opdrachten in het Nederlands (en een beetje Engels).
// Geeft een actie terug: { type: 'set'|'add'|'reset'|'error', interval?, message }
import { INTERVAL_NAMES, parseKeyName, keyToTonic, intervalBetweenTonics, intervalFromSemitones, dutchName, transposePitchClass, tonicToFifths } from './theory.mjs';

const NUMBERS = { een: 1, één: 1, twee: 2, drie: 3, vier: 4, vijf: 5, zes: 6, zeven: 7, acht: 8, negen: 9, tien: 10, elf: 11, twaalf: 12, half: 1 };

const UP = /\b(omhoog|hoger|op|up|higher|naar boven)\b/;
const DOWN = /\b(omlaag|lager|neer|down|lower|naar beneden)\b/;

const INSTRUMENTS = [
  [/\bbes[- ]?(klarinet|trompet|sax|instrument|tenor)|\bb[- ]?flat|\btenorsax|\bsopraansax|\bklarinet|\btrompet/, { steps: 1, semis: 2 }, 'Bes-instrument (grote secunde omhoog)'],
  [/\bes[- ]?(sax|altsax|instrument)|\baltsax|\balt sax|\bbaritonsax/, { steps: 5, semis: 9 }, 'Es-instrument (grote sext omhoog)'],
  [/\bf[- ]?(hoorn|instrument)|\bhoorn|\bengelse hoorn/, { steps: 4, semis: 7 }, 'F-instrument (reine kwint omhoog)'],
];

export function parseCommand(input, ctx) {
  // ctx: { fifths, mode, current: {steps, semis}, pref }
  const s = input.toLowerCase().trim().replace(/[.!?]+$/, '');
  if (!s) return { type: 'error', message: 'Typ een opdracht.' };

  if (/^(reset|origineel|terug|herstel|ongedaan)|terug naar (het )?origineel|naar origineel/.test(s))
    return { type: 'set', interval: { steps: 0, semis: 0 }, message: 'Terug naar het origineel' };

  for (const [re, iv, label] of INSTRUMENTS) {
    if (re.test(s) && /\b(voor|for|naar)\b/.test(s)) return { type: 'set', interval: iv, message: `Partij voor ${label}` };
  }

  const dir = DOWN.test(s) ? -1 : 1;
  const dirWord = DOWN.test(s) ? 'down' : UP.test(s) ? 'up' : 'nearest';

  // "+3", "-2"
  let m = s.match(/^([+-]\s*\d+)$/);
  if (m) {
    const n = parseInt(m[1].replace(/\s/g, ''), 10);
    return { type: 'add', interval: intervalFromSemitones(n, currentFifths(ctx), ctx.pref), message: `${Math.abs(n)} halve ${Math.abs(n) === 1 ? 'toon' : 'tonen'} ${n > 0 ? 'omhoog' : 'omlaag'}` };
  }

  // octaaf
  m = s.match(/(\d+|een|één|twee|drie)?\s*octa(af|ven)/);
  if (m && !/halve|hele|terts|kwint|kwart|sext|septiem|secunde/.test(s)) {
    const n = m[1] ? (NUMBERS[m[1]] || parseInt(m[1], 10)) : 1;
    return { type: 'add', interval: { steps: 7 * n * dir, semis: 12 * n * dir }, message: `${n} octaaf ${dir > 0 ? 'omhoog' : 'omlaag'}` };
  }

  // halve / hele tonen
  m = s.match(/(\d+|een|één|twee|drie|vier|vijf|zes|zeven|acht|negen|tien|elf|twaalf|half|halve)?\s*(halve|hele)?\s*(toon|tonen|semitones?|halftones?|steps?)\b/);
  if (m && (m[2] || /semitone|halftone|toon|tonen/.test(m[3])) && !/\bvan\b.*\bnaar\b/.test(s)) {
    let n = m[1] ? (NUMBERS[m[1]] ?? parseInt(m[1], 10)) : 1;
    if (m[1] === 'halve') n = 1;
    if (m[2] === 'hele' || (/\bwhole\b/.test(s))) n *= 2;
    if (!m[2] && !/semitone|halftone/.test(m[3]) && m[1] !== 'half' && m[1] !== 'halve') n *= 2; // "2 tonen" = hele tonen
    if (isNaN(n) || n === 0) return { type: 'error', message: 'Hoeveel halve tonen?' };
    const semis = n * dir;
    return { type: 'add', interval: intervalFromSemitones(semis, currentFifths(ctx), ctx.pref), message: `${n} halve ${n === 1 ? 'toon' : 'tonen'} ${dir > 0 ? 'omhoog' : 'omlaag'}` };
  }

  // intervalnamen: "kleine terts omhoog"
  for (const [steps, semis, name] of INTERVAL_NAMES.slice(1)) {
    const short = name.replace('reine ', '');
    if (s.includes(name) || s.includes(short)) {
      if (short === 'kwint' && /verminderde/.test(s) && name !== 'verminderde kwint') continue;
      if (short === 'kwart' && /overmatige/.test(s) && name !== 'overmatige kwart') continue;
      return { type: 'add', interval: { steps: steps * dir, semis: semis * dir }, message: `${name} ${dir > 0 ? 'omhoog' : 'omlaag'}` };
    }
  }

  // toonsoort: "van F naar G", "naar Bes", "in es", "to Eb"
  m = s.match(/(?:van|from)\s+([a-g][a-z#♯♭]*)\s*(?:groot|majeur|mineur|klein|major|minor)?\s*(?:naar|to|->)\s+([a-g][a-z#♯♭]*)/);
  let fromTonic = null, toTonic = null;
  if (m) {
    fromTonic = parseKeyName(m[1]);
    toTonic = parseKeyName(m[2]);
  } else {
    m = s.match(/(?:naar|to|in|toonsoort)\s+([a-g][a-z#♯♭]*)\b/);
    if (m) toTonic = parseKeyName(m[1]);
  }
  if (toTonic) {
    // bron = de oorspronkelijke toonsoort; doel ten opzichte van het origineel
    const original = keyToTonic(ctx.fifths, ctx.mode);
    const src = fromTonic || original;
    const iv = intervalBetweenTonics(src, toTonic, dirWord);
    const modeWord = ctx.mode === 'minor' ? ' mineur' : ' groot';
    if (fromTonic && (fromTonic.letter !== original.letter || fromTonic.alter !== original.alter)) {
      // gebruiker noemt zelf een begintoonsoort: interval relatief toepassen vanaf het origineel
      return { type: 'set', interval: iv, message: `Van ${dutchName(src.letter, src.alter)} naar ${dutchName(toTonic.letter, toTonic.alter)}${modeWord}` };
    }
    return { type: 'set', interval: iv, message: `Naar ${dutchName(toTonic.letter, toTonic.alter)}${modeWord}` };
  }
  if (fromTonic === null && /\b(naar|to)\b/.test(s)) return { type: 'error', message: 'Die toonsoort ken ik niet. Probeer bijvoorbeeld "naar Bes" of "naar fis".' };

  return { type: 'error', message: 'Niet begrepen. Voorbeelden: "3 halve tonen omhoog", "van F naar G", "naar Bes", "kleine terts omlaag", "octaaf omhoog", "voor Bes-klarinet", "origineel".' };
}

function currentFifths(ctx) {
  // toonsoort zoals hij nu (na de huidige transpositie) gespeld is
  const c = ctx.current || { steps: 0, semis: 0 };
  return tonicToFifths(transposePitchClass(keyToTonic(ctx.fifths), c));
}
