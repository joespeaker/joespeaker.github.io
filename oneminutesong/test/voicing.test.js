import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeVoicings, voiceProgression, movement, LOW, HIGH } from '../js/voicing.js';
import { diatonicChords, chordIntervals, VARIANTS_BY_QUALITY } from '../js/theory.js';

const pcsOf = (rootPc, variant) => chordIntervals(variant).map((i) => (rootPc + i) % 12);
const pcSet = (notes) => [...new Set(notes.map((n) => n % 12))].sort((a, b) => a - b);

test('every chord in every key has a close voicing in range with the right notes', () => {
  for (const mode of ['major', 'minor']) {
    for (let k = 0; k < 12; k++) {
      for (const c of diatonicChords(k, mode)) {
        for (const v of VARIANTS_BY_QUALITY[c.quality]) {
          const pcs = pcsOf(c.rootPc, v);
          const options = closeVoicings(pcs);
          assert.ok(options.length > 0, `${c.root}${v} has a voicing`);
          for (const notes of options) {
            assert.ok(notes[0] >= LOW && notes[notes.length - 1] <= HIGH, `${c.root}${v} in range`);
            assert.deepEqual(pcSet(notes), pcSet(pcs), `${c.root}${v} keeps its notes`);
          }
        }
      }
    }
  }
});

test('I V vi IV in C moves smoothly', () => {
  const prog = [[0, 'maj'], [7, 'maj'], [9, 'min'], [5, 'maj']].map(([r, v]) => pcsOf(r, v));
  const voiced = voiceProgression(prog);
  for (let i = 0; i < voiced.length; i++) {
    const next = voiced[(i + 1) % voiced.length];
    const moves = voiced[i].map((n, j) => Math.abs(n - next[j]));
    assert.ok(Math.max(...moves) <= 5, `voice jump ${voiced[i]} -> ${next}`);
  }
});

test('empty bars stay empty and movement handles different sizes', () => {
  const v = voiceProgression([pcsOf(0, 'maj'), null, pcsOf(9, 'm9')]);
  assert.equal(v[1], null);
  assert.equal(v[2].length, 5);
  assert.ok(Number.isFinite(movement([60, 64, 67], [57, 60, 64, 67, 71])));
});
