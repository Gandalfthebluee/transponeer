// Muziektheorie: toonhoogtes, intervallen, toonsoorten.
// Een interval is { steps, semis }: aantal diatonische stappen (letters) en halve tonen.

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_SEMIS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const LETTER_FIFTHS = { F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5 };

export function mod(n, m) { return ((n % m) + m) % m; }

// Nederlandse namen: Cis, Des, Es, As, Bes, ...
export function dutchName(letter, alter) {
  if (alter === 0) return letter;
  if (alter > 0) return letter + 'is'.repeat(alter);
  const flat = 'es'.repeat(-alter);
  if (letter === 'E') return 'E' + flat.slice(1) || 'Es';   // Es, Eses
  if (letter === 'A') return 'A' + flat.slice(1);            // As, Ases
  return letter + flat;                                        // Bes, Des, Ges, Ces
}

export function keyToTonic(fifths, mode = 'major') {
  // tonic of the major key with this signature
  const order = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  const idx = mod(fifths + 1, 7);
  const letter = order[idx];
  const alter = Math.floor((fifths + 1) / 7);
  const major = { letter, alter };
  if (mode !== 'minor') return major;
  // relative minor: a major sixth up = 5 steps, 9 semis
  return transposePitchClass(major, { steps: 5, semis: 9 });
}

export function tonicToFifths(tonic, mode = 'major') {
  let t = tonic;
  if (mode === 'minor') t = transposePitchClass(tonic, { steps: 2, semis: 3 }); // relative major
  return LETTER_FIFTHS[t.letter] + 7 * t.alter;
}

export function keyName(fifths, mode = 'major') {
  const t = keyToTonic(fifths, mode);
  return mode === 'minor' ? dutchName(t.letter, t.alter).toLowerCase() + ' mineur' : dutchName(t.letter, t.alter) + ' groot';
}

export function pitchClass(p) { return mod(LETTER_SEMIS[p.letter] + p.alter, 12); }

export function transposePitchClass(p, iv) {
  const li = LETTERS.indexOf(p.letter);
  const newLi = mod(li + iv.steps, 7);
  const letter = LETTERS[newLi];
  const wanted = mod(pitchClass(p) + iv.semis, 12);
  let alter = wanted - LETTER_SEMIS[letter];
  if (alter > 6) alter -= 12;
  if (alter < -6) alter += 12;
  return { letter, alter };
}

// Absolute pitch with octave (MusicXML step/alter/octave)
export function transposePitch(step, alter, octave, iv) {
  const li = LETTERS.indexOf(step);
  const absSteps = octave * 7 + li + iv.steps;
  const newOct = Math.floor(absSteps / 7);
  const newStep = LETTERS[mod(absSteps, 7)];
  const absSemis = octave * 12 + LETTER_SEMIS[step] + alter + iv.semis;
  const naturalSemis = newOct * 12 + LETTER_SEMIS[newStep];
  return { step: newStep, alter: absSemis - naturalSemis, octave: newOct };
}

// Interval from a number of semitones, spelled so the new key has few accidentals.
// pref: 'auto' | 'sharps' | 'flats'
export function intervalFromSemitones(n, fifths = 0, pref = 'auto') {
  if (n === 0) return { steps: 0, semis: 0 };
  let nf = fifths + 7 * n;
  nf = mod(nf + 6, 12) - 6;               // -6 .. 5
  if (nf === -6 && pref === 'sharps') nf = 6;
  if (pref === 'sharps' && nf < -4) nf += 12;   // Des→Cis etc. only when asked
  if (pref === 'flats' && nf > 4) nf -= 12;
  const oldT = keyToTonic(fifths);
  const newT = keyToTonic(nf);
  const base = mod(LETTERS.indexOf(newT.letter) - LETTERS.indexOf(oldT.letter), 7);
  const k = Math.round((n * 7 / 12 - base) / 7);
  return { steps: base + 7 * k, semis: n };
}

// Interval between two tonics. dir: 'nearest' | 'up' | 'down'
export function intervalBetweenTonics(from, to, dir = 'nearest') {
  const stepsBase = mod(LETTERS.indexOf(to.letter) - LETTERS.indexOf(from.letter), 7);
  const semisBase = mod(pitchClass(to) - pitchClass(from), 12);
  if (stepsBase === 0 && semisBase === 0) return { steps: 0, semis: 0 };
  const up = { steps: stepsBase, semis: semisBase };
  const down = { steps: stepsBase - 7, semis: semisBase - 12 };
  if (dir === 'up') return up.semis === 0 ? { steps: 7, semis: 12 } : up;
  if (dir === 'down') return down;
  return semisBase <= 6 ? up : down;
}

export function addIntervals(a, b) { return { steps: a.steps + b.steps, semis: a.semis + b.semis }; }

export const INTERVAL_NAMES = [
  [0, 0, 'reine prime'], [0, 1, 'overmatige prime'], [1, 1, 'kleine secunde'], [1, 2, 'grote secunde'],
  [2, 3, 'kleine terts'], [2, 4, 'grote terts'], [3, 5, 'reine kwart'],
  [3, 6, 'overmatige kwart'], [4, 6, 'verminderde kwint'], [4, 7, 'reine kwint'],
  [5, 8, 'kleine sext'], [5, 9, 'grote sext'], [6, 10, 'kleine septiem'],
  [6, 11, 'grote septiem'], [7, 12, 'octaaf'],
];

export function describeInterval(iv) {
  if (iv.semis === 0 && iv.steps === 0) return 'Origineel';
  const dir = iv.semis > 0 || (iv.semis === 0 && iv.steps > 0) ? 'omhoog' : 'omlaag';
  const s = Math.abs(iv.semis), st = Math.abs(iv.steps);
  const oct = Math.floor(st / 7);
  const rest = [st - 7 * oct, s - 12 * oct];
  const found = INTERVAL_NAMES.find(([a, b]) => a === rest[0] && b === rest[1]);
  let name = found ? found[2] : `${s} halve ${s === 1 ? 'toon' : 'tonen'}`;
  if (oct > 0 && found) name = (rest[0] === 0 && rest[1] === 0) ? (oct === 1 ? 'octaaf' : `${oct} octaven`) : `${oct} octaaf + ${name}`;
  return `${name} ${dir} (${s} halve ${s === 1 ? 'toon' : 'tonen'})`;
}

// Parse a Dutch or English key name: "Bes", "fis", "Eb", "F#", "b", "es"
export function parseKeyName(str) {
  const s = str.trim().toLowerCase().replace('♯', '#').replace('♭', 'b');
  const map = {
    c: ['C', 0], cis: ['C', 1], des: ['D', -1], d: ['D', 0], dis: ['D', 1], es: ['E', -1], ees: ['E', -1],
    e: ['E', 0], eis: ['E', 1], fes: ['F', -1], f: ['F', 0], fis: ['F', 1], ges: ['G', -1], g: ['G', 0],
    gis: ['G', 1], as: ['A', -1], aes: ['A', -1], a: ['A', 0], ais: ['A', 1], bes: ['B', -1], b: ['B', 0],
    bis: ['B', 1], ces: ['C', -1],
  };
  if (map[s]) return { letter: map[s][0], alter: map[s][1] };
  const m = s.match(/^([a-g])(#{1,2}|b{1,2})$/);
  if (m) return { letter: m[1].toUpperCase(), alter: m[2][0] === '#' ? m[2].length : -m[2].length };
  return null;
}

export const KEY_CHOICES = [
  // tonic options shown in the dropdown (major)
  ['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['F', 1], ['G', -1], ['G', 0],
  ['A', -1], ['A', 0], ['B', -1], ['B', 0], ['C', 1],
].map(([letter, alter]) => ({ letter, alter, name: dutchName(letter, alter) }));
