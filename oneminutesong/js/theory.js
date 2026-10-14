// Chord theory: scales, diatonic chords, variants, and spelled note names.
// Pure functions, no DOM or audio, so it runs in the browser and in Node tests.

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];

export const MODES = {
  major: { steps: [0, 2, 4, 5, 7, 9, 11], label: 'Major' },
  minor: { steps: [0, 2, 3, 5, 7, 8, 10], label: 'Minor' }, // natural minor
};

// How each tonic is spelled. Picks the conventional key signature per mode.
export const KEY_NAMES = {
  major: ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'],
  minor: ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'],
};

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

// Each tone is [semitones above root, letter steps above root] so notes spell correctly
// (C7 gets Bb, not A#; Bdim7 gets Ab, not G#).
export const VARIANTS = {
  maj:   { suffix: '',      label: 'Triad', tones: [[0, 0], [4, 2], [7, 4]] },
  '7':   { suffix: '7',     label: '7',     tones: [[0, 0], [4, 2], [7, 4], [10, 6]] },
  maj7:  { suffix: 'maj7',  label: 'maj7',  tones: [[0, 0], [4, 2], [7, 4], [11, 6]] },
  '6':   { suffix: '6',     label: '6',     tones: [[0, 0], [4, 2], [7, 4], [9, 5]] },
  add9:  { suffix: 'add9',  label: 'add9',  tones: [[0, 0], [4, 2], [7, 4], [14, 1]] },
  sus2:  { suffix: 'sus2',  label: 'sus2',  tones: [[0, 0], [2, 1], [7, 4]] },
  sus4:  { suffix: 'sus4',  label: 'sus4',  tones: [[0, 0], [5, 3], [7, 4]] },
  min:   { suffix: 'm',     label: 'Triad', tones: [[0, 0], [3, 2], [7, 4]] },
  m7:    { suffix: 'm7',    label: 'm7',    tones: [[0, 0], [3, 2], [7, 4], [10, 6]] },
  m9:    { suffix: 'm9',    label: 'm9',    tones: [[0, 0], [3, 2], [7, 4], [10, 6], [14, 1]] },
  madd9: { suffix: 'madd9', label: 'madd9', tones: [[0, 0], [3, 2], [7, 4], [14, 1]] },
  dim:   { suffix: 'dim',   label: 'Triad', tones: [[0, 0], [3, 2], [6, 4]] },
  m7b5:  { suffix: 'm7b5',  label: 'm7b5',  tones: [[0, 0], [3, 2], [6, 4], [10, 6]] },
  dim7:  { suffix: 'dim7',  label: 'dim7',  tones: [[0, 0], [3, 2], [6, 4], [9, 6]] },
};

// Only variants that make sense for each triad quality. Dominant 7 is allowed on any
// major-quality chord, so C7 works in C major.
export const VARIANTS_BY_QUALITY = {
  major: ['maj', '7', 'maj7', '6', 'add9', 'sus2', 'sus4'],
  minor: ['min', 'm7', 'm9', 'madd9', 'sus2', 'sus4'],
  dim:   ['dim', 'm7b5', 'dim7'],
};

export const DEFAULT_VARIANT = { major: 'maj', minor: 'min', dim: 'dim' };

const mod12 = (n) => ((n % 12) + 12) % 12;

export function parseNote(name) {
  const letterIdx = LETTERS.indexOf(name[0]);
  if (letterIdx < 0) throw new Error(`Bad note name: ${name}`);
  let acc = 0;
  for (const ch of name.slice(1)) acc += ch === '#' ? 1 : ch === 'b' ? -1 : 0;
  return { letterIdx, pc: mod12(LETTER_PC[letterIdx] + acc) };
}

// Name the pitch class `pc` using letter `letterIdx`, adding sharps or flats as needed.
export function spell(letterIdx, pc) {
  let diff = mod12(pc - LETTER_PC[letterIdx]);
  if (diff > 6) diff -= 12;
  return LETTERS[letterIdx] + (diff > 0 ? '#'.repeat(diff) : 'b'.repeat(-diff));
}

export function keyName(tonicPc, mode) {
  return KEY_NAMES[mode][mod12(tonicPc)];
}

export function scale(tonicPc, mode) {
  const tonic = parseNote(keyName(tonicPc, mode));
  return MODES[mode].steps.map((step, i) => {
    const letterIdx = (tonic.letterIdx + i) % 7;
    const pc = mod12(tonic.pc + step);
    return { name: spell(letterIdx, pc), pc, letterIdx };
  });
}

function qualityOf(root, third, fifth) {
  const t = mod12(third.pc - root.pc);
  const f = mod12(fifth.pc - root.pc);
  if (t === 4 && f === 7) return 'major';
  if (t === 3 && f === 7) return 'minor';
  if (t === 3 && f === 6) return 'dim';
  return 'aug';
}

export function romanFor(degree, quality) {
  const r = ROMAN[degree];
  if (quality === 'major') return r;
  if (quality === 'minor') return r.toLowerCase();
  if (quality === 'dim') return r.toLowerCase() + '°';
  return r + '+';
}

// The 7 diatonic chords of a key, each with its triad quality and allowed variants.
export function diatonicChords(tonicPc, mode) {
  const sc = scale(tonicPc, mode);
  return sc.map((root, i) => {
    const quality = qualityOf(root, sc[(i + 2) % 7], sc[(i + 4) % 7]);
    return {
      degree: i,
      root: root.name,
      rootPc: root.pc,
      quality,
      roman: romanFor(i, quality),
      variants: VARIANTS_BY_QUALITY[quality],
      defaultVariant: DEFAULT_VARIANT[quality],
    };
  });
}

export function chordName(root, variantId) {
  return root + VARIANTS[variantId].suffix;
}

// Spelled note names, root first, e.g. chordNotes('C', '7') -> ['C', 'E', 'G', 'Bb'].
export function chordNotes(root, variantId) {
  const r = parseNote(root);
  return VARIANTS[variantId].tones.map(([semi, steps]) =>
    spell((r.letterIdx + steps) % 7, r.pc + semi));
}

// Semitone offsets from the root, e.g. '7' -> [0, 4, 7, 10].
export function chordIntervals(variantId) {
  return VARIANTS[variantId].tones.map(([semi]) => semi);
}

// Swap ASCII accidentals for proper symbols in display text: "Bb" -> "B♭", "F#m" -> "F♯m".
export function pretty(text) {
  return text.replace(/^([A-G])(#{1,2}|b{1,2})/, (_, l, acc) =>
    l + acc.replace(/#/g, '♯').replace(/b/g, '♭'));
}
