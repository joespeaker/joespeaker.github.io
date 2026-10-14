import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scale, diatonicChords, chordNotes, chordName, chordIntervals, parseNote,
  VARIANTS, VARIANTS_BY_QUALITY, LETTERS,
} from '../js/theory.js';

const names = (tonic, mode) =>
  diatonicChords(tonic, mode).map((c) => chordName(c.root, c.defaultVariant));

test('C major diatonic chords', () => {
  assert.deepEqual(names(0, 'major'), ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);
  assert.deepEqual(diatonicChords(0, 'major').map((c) => c.roman),
    ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
});

test('A minor diatonic chords', () => {
  assert.deepEqual(names(9, 'minor'), ['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G']);
  assert.deepEqual(diatonicChords(9, 'minor').map((c) => c.roman),
    ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII']);
});

test('spelled keys with lots of accidentals', () => {
  assert.deepEqual(scale(6, 'major').map((n) => n.name), ['F#', 'G#', 'A#', 'B', 'C#', 'D#', 'E#']);
  assert.deepEqual(scale(3, 'minor').map((n) => n.name), ['Eb', 'F', 'Gb', 'Ab', 'Bb', 'Cb', 'Db']);
  assert.deepEqual(names(1, 'major'), ['Db', 'Ebm', 'Fm', 'Gb', 'Ab', 'Bbm', 'Cdim']);
  assert.deepEqual(names(8, 'minor'), ['G#m', 'A#dim', 'B', 'C#m', 'D#m', 'E', 'F#']);
});

test('every key and mode: right qualities, scale tones, one letter each', () => {
  const expected = {
    major: ['major', 'minor', 'minor', 'major', 'major', 'minor', 'dim'],
    minor: ['minor', 'dim', 'major', 'minor', 'minor', 'major', 'major'],
  };
  for (const mode of ['major', 'minor']) {
    for (let tonic = 0; tonic < 12; tonic++) {
      const sc = scale(tonic, mode);
      assert.equal(sc[0].pc, tonic, `${mode} ${tonic} tonic`);
      assert.deepEqual([...new Set(sc.map((n) => n.name[0]))].sort(), [...LETTERS].sort(),
        `${mode} ${tonic} uses each letter once`);
      const scalePcs = new Set(sc.map((n) => n.pc));
      const chords = diatonicChords(tonic, mode);
      assert.deepEqual(chords.map((c) => c.quality), expected[mode], `${mode} ${tonic} qualities`);
      for (const c of chords) {
        for (const v of c.variants) assert.ok(VARIANTS[v], `variant ${v} exists`);
        // Default triads must stay inside the key.
        for (const n of chordNotes(c.root, c.defaultVariant)) {
          assert.ok(scalePcs.has(parseNote(n).pc), `${mode} ${tonic}: ${c.root} has out-of-key ${n}`);
        }
      }
    }
  }
});

test('variant notes', () => {
  const cases = {
    'C maj': ['C', 'E', 'G'],
    'C 7': ['C', 'E', 'G', 'Bb'],
    'C maj7': ['C', 'E', 'G', 'B'],
    'C 6': ['C', 'E', 'G', 'A'],
    'C add9': ['C', 'E', 'G', 'D'],
    'C sus2': ['C', 'D', 'G'],
    'C sus4': ['C', 'F', 'G'],
    'A min': ['A', 'C', 'E'],
    'A m7': ['A', 'C', 'E', 'G'],
    'A m9': ['A', 'C', 'E', 'G', 'B'],
    'A madd9': ['A', 'C', 'E', 'B'],
    'B dim': ['B', 'D', 'F'],
    'B m7b5': ['B', 'D', 'F', 'A'],
    'B dim7': ['B', 'D', 'F', 'Ab'],
    'Eb 7': ['Eb', 'G', 'Bb', 'Db'],
    'F# maj7': ['F#', 'A#', 'C#', 'E#'],
  };
  for (const [key, notes] of Object.entries(cases)) {
    const [root, v] = key.split(' ');
    assert.deepEqual(chordNotes(root, v), notes, key);
  }
});

test('chord names and intervals', () => {
  assert.equal(chordName('C', '7'), 'C7');
  assert.equal(chordName('D', 'm9'), 'Dm9');
  assert.equal(chordName('B', 'dim'), 'Bdim');
  assert.deepEqual(chordIntervals('add9'), [0, 4, 7, 14]);
});

test('quality-appropriate variant lists', () => {
  assert.ok(VARIANTS_BY_QUALITY.major.includes('7'), 'dominant 7 allowed on major chords');
  assert.ok(!VARIANTS_BY_QUALITY.minor.includes('maj7'));
  assert.ok(VARIANTS_BY_QUALITY.minor.includes('m9'));
  assert.deepEqual(VARIANTS_BY_QUALITY.dim, ['dim', 'm7b5', 'dim7']);
  // Every variant's root/third/fifth matches its quality family.
  for (const [quality, list] of Object.entries(VARIANTS_BY_QUALITY)) {
    for (const v of list) {
      const iv = chordIntervals(v);
      assert.equal(iv[0], 0);
      if (v.startsWith('sus')) continue;
      assert.ok(iv.includes(quality === 'major' ? 4 : 3), `${v} third fits ${quality}`);
    }
  }
});
