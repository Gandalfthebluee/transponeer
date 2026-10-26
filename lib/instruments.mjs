// Transponerende instrumenten.
// written: hoeveel de geschreven noot hoger staat dan wat je hoort (stappen, halve tonen).
// range: comfortabel geschreven bereik (MIDI-nummers), voor de automatische octaafkeuze.
export const INSTRUMENTS = [
  { id: 'c',        name: 'Concert (C)',           label: '',                     written: { steps: 0, semis: 0 },  range: [55, 84] },
  { id: 'piano',    name: 'Piano / keyboard',      label: 'Piano',                written: { steps: 0, semis: 0 },  range: [48, 88] },
  { id: 'fluit',    name: 'Dwarsfluit',            label: 'Dwarsfluit',           written: { steps: 0, semis: 0 },  range: [60, 93] },
  { id: 'viool',    name: 'Viool',                 label: 'Viool',                written: { steps: 0, semis: 0 },  range: [55, 88] },
  { id: 'hobo',     name: 'Hobo',                  label: 'Hobo',                 written: { steps: 0, semis: 0 },  range: [58, 89] },
  { id: 'zang',     name: 'Zang',                  label: 'Zang',                 written: { steps: 0, semis: 0 },  range: [57, 79] },
  { id: 'trompet',  name: 'Trompet in B♭',         label: 'Trompet in B♭',        written: { steps: 1, semis: 2 },  range: [55, 82] },
  { id: 'klarinet', name: 'Klarinet in B♭',        label: 'Klarinet in B♭',       written: { steps: 1, semis: 2 },  range: [52, 89] },
  { id: 'sopsax',   name: 'Sopraansax in B♭',      label: 'Sopraansaxofoon in B♭', written: { steps: 1, semis: 2 },  range: [58, 89] },
  { id: 'tenorsax', name: 'Tenorsax in B♭',        label: 'Tenorsaxofoon in B♭',  written: { steps: 8, semis: 14 }, range: [58, 89] },
  { id: 'altsax',   name: 'Altsax in E♭',          label: 'Altsaxofoon in E♭',    written: { steps: 5, semis: 9 },  range: [58, 89] },
  { id: 'barisax',  name: 'Baritonsax in E♭',      label: 'Baritonsaxofoon in E♭', written: { steps: 12, semis: 21 }, range: [58, 89] },
  { id: 'hoorn',    name: 'Hoorn in F',            label: 'Hoorn in F',           written: { steps: 4, semis: 7 },  range: [52, 79] },
  { id: 'gitaar',   name: 'Gitaar',                label: 'Gitaar',               written: { steps: 7, semis: 12 }, range: [52, 88] },
  { id: 'bas',      name: 'Basgitaar / contrabas', label: 'Bas',                  written: { steps: 7, semis: 12 }, range: [40, 67] },
  { id: 'trombone', name: 'Trombone',              label: 'Trombone',             written: { steps: 0, semis: 0 },  range: [40, 72] },
];

export const byId = (id) => INSTRUMENTS.find(i => i.id === id) || INSTRUMENTS[0];

// Van instrument A naar B: verschil in schrijfwijze
export function instrumentInterval(fromId, toId) {
  const a = byId(fromId).written, b = byId(toId).written;
  return { steps: b.steps - a.steps, semis: b.semis - a.semis };
}

// Kies de octaaf die het best in het bereik van het doelinstrument past.
// midiNotes: de geschreven noten na transpositie (MIDI-nummers).
export function fitOctave(midiNotes, toId) {
  if (!midiNotes.length) return 0;
  const [lo, hi] = byId(toId).range;
  let best = 0, bestScore = Infinity;
  for (const k of [0, -1, 1, -2, 2]) {
    let out = 0;
    for (const m of midiNotes) { const x = m + 12 * k; if (x < lo) out += lo - x; else if (x > hi) out += x - hi; }
    const score = out + Math.abs(k) * 0.5; // bij gelijkspel liefst niet verschuiven
    if (score < bestScore) { bestScore = score; best = k; }
  }
  return best;
}
