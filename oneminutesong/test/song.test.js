import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newSong, placeBlock, moveBlock, resizeBlock, removeBlock, setBlockNotes, addNote, moveNote,
  resizeNote, generateBass, freezeBass, fillDrums, toggleDrum, laneString, setBars, changeKey,
  audible, fromV1, totalSteps, normalizeSong,
} from '../js/song.js';
import { compile, expandBlock, blockVoicings } from '../js/compile.js';
import { encodeSongV2, decodeSongV2, encodeSong, decodeSong } from '../js/share.js';
import { KITS } from '../js/audio/drums.js';

const blocksOf = (song) => song.tracks.chords.blocks.map((b) => [b.s, b.l, b.d]);
const stripIds = (song) => JSON.parse(JSON.stringify(song, (k, v) => (k === 'id' ? undefined : v)));

test('placing a chord defaults to the rest of the bar and overwrites what is under it', () => {
  const song = newSong();
  placeBlock(song, { s: 0, d: 0, v: 'maj' });
  placeBlock(song, { s: 16, d: 4, v: 'maj' });
  assert.deepEqual(blocksOf(song), [[0, 16, 0], [16, 16, 4]]);
  placeBlock(song, { s: 8, d: 5, v: 'min' });          // second half of bar 1
  assert.deepEqual(blocksOf(song), [[0, 8, 0], [8, 8, 5], [16, 16, 4]]);
  placeBlock(song, { s: 4, l: 2, d: 3, v: 'maj' });    // splits the first block
  assert.deepEqual(blocksOf(song), [[0, 4, 0], [4, 2, 3], [6, 2, 0], [8, 8, 5], [16, 16, 4]]);
  placeBlock(song, { s: 60, d: 1, v: 'min' });         // clipped at the loop end
  assert.deepEqual(blocksOf(song).at(-1), [60, 4, 1]);
});

test('moving, stretching and removing blocks', () => {
  const song = newSong();
  const a = placeBlock(song, { s: 0, d: 0, v: 'maj' });
  const b = placeBlock(song, { s: 32, d: 4, v: 'maj' });
  resizeBlock(song, a.id, 40);                          // can't run into b
  assert.equal(a.l, 32);
  moveBlock(song, b.id, 24);                            // overwrites the tail of a
  assert.deepEqual(blocksOf(song), [[0, 24, 0], [24, 16, 4]]);
  moveBlock(song, b.id, 100);                           // clamped inside the loop
  assert.equal(b.s, 48);
  removeBlock(song, a.id);
  assert.deepEqual(blocksOf(song), [[48, 16, 4]]);
});

test('chord styles expand into the right hits', () => {
  const block = { s: 16, l: 16 };
  const notes = [60, 64, 67];
  assert.deepEqual(expandBlock(block, notes, 'hold').map((h) => [h.s, h.l]), [[16, 16]]);
  assert.deepEqual(expandBlock(block, notes, 'half').map((h) => [h.s, h.l]), [[16, 8], [24, 8]]);
  assert.equal(expandBlock(block, notes, 'pulse').length, 4);
  assert.deepEqual(expandBlock(block, notes, 'offbeat').map((h) => h.s), [18, 22, 26, 30]);
  assert.equal(expandBlock(block, notes, 'strum').length, 8);
  assert.deepEqual(expandBlock(block, notes, 'arp').map((h) => h.notes[0]), [60, 64, 67, 64, 60, 64, 67, 64]);
  assert.deepEqual(expandBlock({ s: 0, l: 3 }, notes, 'half').map((h) => h.l), [3]);
});

test('voicings: auto chords lead smoothly, pinned notes are kept', () => {
  const song = newSong();
  for (const [s, d] of [[0, 0], [16, 4], [32, 5], [48, 3]]) placeBlock(song, { s, d, v: d === 5 ? 'min' : 'maj' });
  const v = blockVoicings(song);
  const list = song.tracks.chords.blocks.map((b) => v.get(b.id));
  for (let i = 0; i < 4; i++) {
    const a = list[i], b = list[(i + 1) % 4];
    assert.ok(Math.max(...a.map((n, j) => Math.abs(n - b[j]))) <= 5, `${a} -> ${b}`);
  }
  const pinned = song.tracks.chords.blocks[1];
  setBlockNotes(song, pinned.id, [67, 55, 71]);
  assert.deepEqual(blockVoicings(song).get(pinned.id), [55, 67, 71]);
});

test('notes: add, overwrite same pitch, move, resize, clamp', () => {
  const song = newSong();
  const a = addNote(song, 'melody', { s: 0, l: 8, p: 72 });
  addNote(song, 'melody', { s: 4, l: 4, p: 72 });        // trims a
  assert.equal(a.l, 4);
  const c = addNote(song, 'melody', { s: 0, l: 4, p: 120 });
  assert.equal(c.p, 91, 'clamped to the melody range');
  moveNote(song, 'melody', a.id, 70, 60);
  assert.deepEqual([a.s, a.p], [60, 60]);
  resizeNote(song, 'melody', a.id, 99);
  assert.equal(a.l, 4, 'cannot run past the loop end');
});

test('auto bass follows the chords and freezes on first edit', () => {
  const song = newSong();
  placeBlock(song, { s: 0, d: 0, v: 'maj' });      // C
  placeBlock(song, { s: 16, l: 4, d: 4, v: 'maj' }); // G, one beat
  const bass = generateBass(song);
  assert.deepEqual(bass.map((n) => [n.s, n.l, n.p]), [[0, 6, 36], [8, 6, 36], [14, 2, 48], [16, 4, 31]]);
  freezeBass(song);
  assert.equal(song.tracks.bass.auto, false);
  assert.equal(song.tracks.bass.notes.length, 4);
});

test('drums: presets repeat per bar, cells cycle, bars grow the pattern', () => {
  const song = newSong();
  fillDrums(song, KITS.acoustic.patterns.basic);
  assert.equal(laneString(song, 'snare'), '....x.......x...'.repeat(4));
  assert.equal(toggleDrum(song, 'kick', 1), 'o');
  assert.equal(toggleDrum(song, 'kick', 1), 'x');
  assert.equal(toggleDrum(song, 'kick', 1), '.');
  setBars(song, 8);
  assert.equal(laneString(song, 'snare').length, 128);
  assert.equal(laneString(song, 'snare').slice(64, 80), '....x.......x...');
});

test('changing key transposes everything; changing mode keeps scale degrees', () => {
  const song = newSong();
  const b = placeBlock(song, { s: 0, d: 0, v: 'maj7' });
  const n = addNote(song, 'melody', { s: 0, l: 4, p: 64 });  // E, the 3rd of C
  changeKey(song, 2, 'major');                               // to D
  assert.equal(n.p, 66);                                     // F#
  assert.equal(b.v, 'maj7');
  changeKey(song, 2, 'minor');                               // D minor
  assert.equal(n.p, 65, 'the 3rd becomes minor');
  assert.equal(b.v, 'min', 'maj7 does not fit a minor i chord');
});

test('single notes in the chord roll play with the chord instrument and follow the key', () => {
  const song = newSong();
  placeBlock(song, { s: 0, d: 0, v: 'maj' });
  const n = addNote(song, 'chords', { s: 4, l: 2, p: 76 });  // E5 in C major
  const hits = compile(song).steps[4].filter((e) => e.track === 'chords' && e.notes.length === 1);
  assert.deepEqual(hits.map((e) => [e.inst, e.notes[0], e.l]), [['piano', 76, 2]]);
  changeKey(song, 0, 'minor');                                // the 3rd drops a semitone
  assert.equal(n.p, 75);
  assert.deepEqual(normalizeSong({ tracks: { chords: { blocks: [] } } }).tracks.chords.notes, []);
});

test('mute and solo', () => {
  const song = newSong();
  assert.ok(audible(song, 'melody'));
  song.tracks.drums.solo = true;
  assert.ok(!audible(song, 'melody'));
  assert.ok(audible(song, 'drums'));
  song.tracks.drums.mute = true;
  assert.ok(!audible(song, 'drums'));
});

test('compile places every track on the right steps', () => {
  const song = newSong();
  placeBlock(song, { s: 0, d: 0, v: 'maj' });
  song.tracks.chords.style = 'hold';
  addNote(song, 'melody', { s: 2, l: 2, p: 72 });
  fillDrums(song, KITS.acoustic.patterns.basic);
  const { total, steps } = compile(song);
  assert.equal(total, 64);
  const at = (s, track) => steps[s].filter((e) => e.track === track);
  assert.equal(at(0, 'chords').length, 1);
  assert.deepEqual(at(2, 'melody')[0].notes, [72]);
  assert.equal(at(0, 'bass')[0].notes[0], 36);
  assert.ok(at(4, 'drums').some((e) => e.lane === 'snare'));
});

test('v2 share links round-trip a full song', async () => {
  const song = newSong();
  Object.assign(song, { keyPc: 7, mode: 'minor', bars: 8, tempo: 132, swing: 0.4, reverb: 0.1,
    topic: 'café 🌙', style: 'Prince', constraint: '', title: 'Late “Shift”' });
  placeBlock(song, { s: 0, d: 0, v: 'm9' });
  const pin = placeBlock(song, { s: 16, l: 24, d: 5, v: 'maj7' });
  setBlockNotes(song, pin.id, [55, 62, 66, 71]);
  song.tracks.chords.style = 'arp';
  song.tracks.chords.inst = 'strings';
  addNote(song, 'chords', { s: 6, l: 3, p: 74, v: 0.7 });
  addNote(song, 'melody', { s: 3, l: 5, p: 79, v: 0.6 });
  addNote(song, 'melody', { s: 100, l: 12, p: 74 });
  song.tracks.melody.inst = 'lead';
  freezeBass(song);
  addNote(song, 'bass', { s: 64, l: 2, p: 40 });
  fillDrums(song, KITS.garage.patterns.driving);
  toggleDrum(song, 'ride', 5);
  Object.assign(song.tracks.drums, { kit: 'garage', pattern: 'driving', vol: 0.55, solo: true });
  song.tracks.melody.mute = true;

  const code = await encodeSongV2(song);
  assert.match(code, /^v2=z[A-Za-z0-9_-]+$/);
  assert.ok(code.length < 700, `length ${code.length}`);
  const back = await decodeSongV2(`#${code}`);
  assert.deepEqual(stripIds(back), stripIds(song));
});

test('bad v2 links return null', async () => {
  assert.equal(await decodeSongV2('#v2=zAAAA'), null);
  assert.equal(await decodeSongV2('#v2=j' + Buffer.from('[1,2]').toString('base64url')), null);
  assert.equal(await decodeSongV2('#v3=zabc'), null);
});

test('v1 links convert to the track model', () => {
  const old = decodeSong(encodeSong({
    keyPc: 9, mode: 'minor', barCount: 4,
    bars: [{ degree: 0, variant: 'm7' }, null, { degree: 5, variant: 'maj' }, { degree: 4, variant: 'min' }, null, null, null, null],
    synth: 'pad', kit: 'garage', pattern: 'halftime', tempo: 87, swing: 0.42, reverb: 0.55, bass: false,
    topic: 't', style: 's', constraint: '', title: 'T',
  }));
  const song = fromV1(old, KITS.garage.patterns.halftime);
  assert.deepEqual(blocksOf(song), [[0, 16, 0], [32, 16, 5], [48, 16, 4]]);
  assert.equal(song.tracks.chords.style, 'hold');
  assert.equal(song.tracks.bass.mute, true);
  assert.equal(song.tracks.drums.kit, 'garage');
  assert.equal(laneString(song, 'snare').slice(0, 16), KITS.garage.patterns.halftime.snare);
  assert.equal(totalSteps(song), 64);
});
