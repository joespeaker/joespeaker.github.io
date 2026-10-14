import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KITS, KIT_IDS, PATTERN_IDS, HIT_VELOCITY, hitsAt } from '../js/audio/drums.js';

test('every kit has all four patterns with valid 16-step lanes and voices', () => {
  for (const id of KIT_IDS) {
    const kit = KITS[id];
    assert.deepEqual(Object.keys(kit.patterns).sort(), [...PATTERN_IDS].sort(), `${id} patterns`);
    for (const [pid, lanes] of Object.entries(kit.patterns)) {
      for (const [lane, row] of Object.entries(lanes)) {
        assert.equal(row.length, 16, `${id}/${pid}/${lane} is 16 steps`);
        assert.match(row, /^[xog.]+$/, `${id}/${pid}/${lane} uses x o g .`);
        assert.equal(typeof kit.voices[lane], 'function', `${id} has a ${lane} voice`);
      }
      assert.ok(hitsAt(id, pid, 0).some((h) => h.lane === 'kick'), `${id}/${pid} starts on a kick`);
    }
  }
});

test('hitsAt reads velocities', () => {
  const hits = hitsAt('acoustic', 'basic', 4);
  assert.deepEqual(hits.find((h) => h.lane === 'snare'), { lane: 'snare', velocity: HIT_VELOCITY.x });
});
