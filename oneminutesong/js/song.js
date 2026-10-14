// The song model and every edit you can make to it. Pure functions over plain objects,
// no DOM or audio, so it's shared by the editor, playback, sharing and tests.
//
// Time is measured in 16th-note steps (16 per bar). A song has four tracks:
//   chords  blocks: [{ id, s, l, d, v, n }]  start, length, scale degree, variant,
//                                            and n = custom notes (MIDI) or null for auto voicing
//   melody  notes:  [{ id, s, l, p, v }]     start, length, pitch (MIDI), velocity 0..1
//   bass    notes, plus auto: true while it's generated from the chords
//   drums   grid: { lane: 'x.o.…' }           one char per step: x accent, o hit, g ghost, . rest

import { diatonicChords, chordIntervals, MODES } from './theory.js';

export const STEPS_PER_BAR = 16;
export const BAR_OPTIONS = [4, 8, 16];
export const TRACK_IDS = ['chords', 'melody', 'bass', 'drums'];
export const DRUM_LANES = ['kick', 'snare', 'hat', 'open', 'ride'];

// How a chord block is played across its length.
export const CHORD_STYLES = {
  hold: 'Hold',
  half: 'Half notes',
  pulse: 'Quarters',
  offbeat: 'Offbeats',
  strum: 'Strum 8ths',
  arp: 'Arpeggio',
};

// Pitch range shown (and allowed) in each track's piano roll.
export const RANGES = {
  chords: [48, 84],  // C3-C6
  melody: [55, 91],  // G3-G6
  bass: [28, 52],    // E1-E3
};

let counter = 0;
export const newId = () => `i${(++counter).toString(36)}`;

export function newSong() {
  return {
    keyPc: 0,
    mode: 'major',
    bars: 4,
    tempo: 100,
    swing: 0.15,
    reverb: 0.25,
    tracks: {
      chords: { inst: 'piano', vol: 0.8, mute: false, solo: false, style: 'half', blocks: [] },
      melody: { inst: 'vibes', vol: 0.8, mute: false, solo: false, notes: [] },
      bass: { inst: 'bass', vol: 0.8, mute: false, solo: false, auto: true, notes: [] },
      drums: { kit: 'acoustic', vol: 0.8, mute: false, solo: false, pattern: 'basic', grid: {} },
    },
    topic: '',
    style: '',
    constraint: '',
    title: '',
  };
}

export const totalSteps = (song) => song.bars * STEPS_PER_BAR;
export const cloneSong = (song) => JSON.parse(JSON.stringify(song));
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const byStart = (a, b) => a.s - b.s;

/* ---------- Chord blocks ---------- */

// Remove whatever overlaps [s, e) from a block list, trimming or splitting blocks that
// stick out either side. `keep` is left alone (the block being placed or moved).
function clearRange(blocks, s, e, keep = null) {
  const out = [];
  for (const b of blocks) {
    if (b === keep) { out.push(b); continue; }
    const end = b.s + b.l;
    if (end <= s || b.s >= e) out.push(b);
    else if (b.s < s && end > e) out.push({ ...b, l: s - b.s }, { ...b, id: newId(), s: e, l: end - e });
    else if (b.s < s) out.push({ ...b, l: s - b.s });
    else if (end > e) out.push({ ...b, s: e, l: end - e });
  }
  return out.sort(byStart);
}

export function findBlock(song, id) {
  return song.tracks.chords.blocks.find((b) => b.id === id) || null;
}

// Drop a chord at step s. Default length runs to the next bar line (at least a beat),
// then it overwrites anything underneath.
export function placeBlock(song, { s, l = null, d, v }) {
  const total = totalSteps(song);
  s = clamp(s, 0, total - 1);
  if (l === null) l = Math.max(4, STEPS_PER_BAR - (s % STEPS_PER_BAR));
  l = clamp(l, 1, total - s);
  const block = { id: newId(), s, l, d, v, n: null };
  const chords = song.tracks.chords;
  chords.blocks = clearRange([...chords.blocks, block], s, s + l, block);
  return block;
}

export function moveBlock(song, id, s) {
  const chords = song.tracks.chords;
  const b = findBlock(song, id);
  if (!b) return null;
  b.s = clamp(s, 0, totalSteps(song) - b.l);
  chords.blocks = clearRange(chords.blocks, b.s, b.s + b.l, b);
  return b;
}

// Stretch a block. It can't run past the loop end or into the next block.
export function resizeBlock(song, id, l) {
  const b = findBlock(song, id);
  if (!b) return null;
  const next = song.tracks.chords.blocks.filter((x) => x.s > b.s).sort(byStart)[0];
  const limit = (next ? next.s : totalSteps(song)) - b.s;
  b.l = clamp(Math.round(l), 1, limit);
  return b;
}

export function removeBlock(song, id) {
  const chords = song.tracks.chords;
  chords.blocks = chords.blocks.filter((b) => b.id !== id);
}

export function setBlockChord(song, id, d, v) {
  const b = findBlock(song, id);
  if (b) Object.assign(b, { d, v, n: null });
  return b;
}

// Pin a block's notes (after moving one in the piano roll). null goes back to auto voicing.
export function setBlockNotes(song, id, notes) {
  const b = findBlock(song, id);
  if (b) b.n = notes ? [...notes].sort((a, c) => a - c) : null;
  return b;
}

/* ---------- Melody and bass notes ---------- */

export function findNote(song, track, id) {
  return song.tracks[track].notes.find((n) => n.id === id) || null;
}

// Add a note; a note already on the same pitch that it overlaps gets trimmed or removed.
export function addNote(song, track, { s, l, p, v = 0.8 }) {
  const total = totalSteps(song);
  const [lo, hi] = RANGES[track];
  const note = { id: newId(), s: clamp(s, 0, total - 1), l: 1, p: clamp(p, lo, hi), v };
  note.l = clamp(l, 1, total - note.s);
  const t = song.tracks[track];
  // Trim in place (not copy) so anything holding the note, like the selection, stays valid.
  t.notes = t.notes.filter((n) => {
    if (n.p !== note.p || n.s + n.l <= note.s || n.s >= note.s + note.l) return true;
    if (n.s < note.s) { n.l = note.s - n.s; return true; }
    return false;
  });
  t.notes.push(note);
  t.notes.sort(byStart);
  return note;
}

export function moveNote(song, track, id, s, p) {
  const n = findNote(song, track, id);
  if (!n) return null;
  const [lo, hi] = RANGES[track];
  n.s = clamp(s, 0, totalSteps(song) - n.l);
  n.p = clamp(p, lo, hi);
  song.tracks[track].notes.sort(byStart);
  return n;
}

export function resizeNote(song, track, id, l) {
  const n = findNote(song, track, id);
  if (n) n.l = clamp(Math.round(l), 1, totalSteps(song) - n.s);
  return n;
}

export function removeNote(song, track, id) {
  const t = song.tracks[track];
  t.notes = t.notes.filter((n) => n.id !== id);
}

/* ---------- Bass ---------- */

// Bass root between E1 (28) and D#2 (39), so every key sits under the chords.
export const bassRoot = (rootPc) => 28 + ((rootPc - 4 + 12) % 12);

// A simple bass line from the chords: root on each block's downbeat and every half bar
// after it, plus a short pickup into the next chord when there's room. Ids come from the
// start step, so a note keeps its id when the line is frozen for editing.
export function generateBass(song) {
  const chords = diatonicChords(song.keyPc, song.mode);
  const notes = [];
  for (const b of [...song.tracks.chords.blocks].sort(byStart)) {
    const root = bassRoot(chords[b.d].rootPc);
    const end = b.s + b.l;
    for (let s = b.s; s < end; s += 8) {
      const room = end - s;
      notes.push({ id: `auto${s}`, s, l: Math.min(room >= 8 ? 6 : room, room), p: root, v: s === b.s ? 0.85 : 0.75 });
    }
    if (b.l >= 8) {
      const last = notes[notes.length - 1];
      const pickup = end - 2;
      if (last.s + last.l <= pickup) notes.push({ id: `auto${pickup}`, s: pickup, l: 2, p: root + 12 <= RANGES.bass[1] ? root + 12 : root, v: 0.6 });
    }
  }
  return notes;
}

export function bassNotes(song) {
  const bass = song.tracks.bass;
  return bass.auto ? generateBass(song) : bass.notes;
}

// The first manual edit freezes the generated line into real, editable notes.
export function freezeBass(song) {
  const bass = song.tracks.bass;
  if (bass.auto) {
    bass.notes = generateBass(song);
    bass.auto = false;
  }
}

/* ---------- Drums ---------- */

export function laneString(song, lane) {
  const total = totalSteps(song);
  const row = song.tracks.drums.grid[lane] || '';
  return (row + '.'.repeat(total)).slice(0, total);
}

// Fill the grid from a 16-step preset, repeated across every bar.
export function fillDrums(song, preset) {
  const total = totalSteps(song);
  const grid = {};
  for (const lane of DRUM_LANES) {
    const bar = preset[lane] || '................';
    grid[lane] = bar.repeat(Math.ceil(total / 16)).slice(0, total);
  }
  song.tracks.drums.grid = grid;
}

// Cycle one cell: rest -> hit -> accent -> rest.
export function toggleDrum(song, lane, step) {
  const row = laneString(song, lane).split('');
  row[step] = { '.': 'o', o: 'x', x: '.', g: 'o' }[row[step]] || 'o';
  song.tracks.drums.grid[lane] = row.join('');
  return row[step];
}

/* ---------- Song-wide changes ---------- */

// Change loop length. Growing repeats the drum pattern; shrinking keeps notes past the
// end in the data (they come back if you grow again) but they don't play.
export function setBars(song, bars) {
  const before = totalSteps(song);
  song.bars = bars;
  const after = totalSteps(song);
  if (after > before) {
    const grid = song.tracks.drums.grid;
    for (const lane of Object.keys(grid)) {
      const row = (grid[lane] || '').slice(0, before).padEnd(before, '.');
      grid[lane] = row.repeat(Math.ceil(after / before)).slice(0, after);
    }
  }
}

function fitRange(p, [lo, hi]) {
  while (p < lo) p += 12;
  while (p > hi) p -= 12;
  return p;
}

// Map a pitch to the same scale degree in another mode (major <-> natural minor moves
// the 3rd, 6th and 7th). Notes outside the old scale stay put.
function remapMode(p, tonic, fromMode, toMode) {
  const rel = ((p - tonic) % 12 + 12) % 12;
  const i = MODES[fromMode].steps.indexOf(rel);
  return i < 0 ? p : p + MODES[toMode].steps[i] - rel;
}

// Change key and/or mode. Chord blocks keep their scale degrees, so the progression
// moves with the key; pinned chord notes, melody and manual bass are transposed by the
// smallest interval and kept on the same scale degrees when the mode changes.
export function changeKey(song, keyPc, mode) {
  const delta = ((keyPc - song.keyPc + 18) % 12) - 6; // -6..+5
  const fromMode = song.mode;
  const shift = (p, range) => fitRange(remapMode(p, song.keyPc, fromMode, mode) + delta, range);
  for (const b of song.tracks.chords.blocks) {
    b.n = mode === fromMode && b.n ? b.n.map((p) => fitRange(p + delta, RANGES.chords)) : null;
  }
  for (const n of song.tracks.melody.notes) n.p = shift(n.p, RANGES.melody);
  if (!song.tracks.bass.auto) for (const n of song.tracks.bass.notes) n.p = shift(n.p, RANGES.bass);
  song.keyPc = keyPc;
  song.mode = mode;
  // Variants that don't fit a chord's new quality (maj7 on a now-minor chord) reset.
  const chords = diatonicChords(keyPc, mode);
  for (const b of song.tracks.chords.blocks) {
    if (!chords[b.d].variants.includes(b.v)) b.v = chords[b.d].defaultVariant;
  }
}

export function chordPcs(song, block) {
  const root = diatonicChords(song.keyPc, song.mode)[block.d].rootPc;
  return chordIntervals(block.v).map((i) => (root + i) % 12);
}

// Mute and solo: a track sounds if it isn't muted and either nothing is soloed or it is.
export function audible(song, track) {
  const t = song.tracks;
  const anySolo = TRACK_IDS.some((id) => t[id].solo);
  return !t[track].mute && (!anySolo || t[track].solo);
}

/* ---------- Old (v1) songs ---------- */

const V1_STYLE = { pad: 'hold', strings: 'hold', organ: 'hold', piano: 'half', epiano: 'offbeat', guitar: 'strum' };

// Turn a v1 share-link song (one chord per bar, preset drums) into the track model.
export function fromV1(old, drumPreset) {
  const song = newSong();
  Object.assign(song, {
    keyPc: old.keyPc, mode: old.mode, bars: old.barCount, tempo: old.tempo, swing: old.swing, reverb: old.reverb,
    topic: old.topic, style: old.style, constraint: old.constraint, title: old.title,
  });
  const chords = song.tracks.chords;
  chords.inst = old.synth;
  chords.style = V1_STYLE[old.synth] || 'half';
  chords.blocks = old.bars.slice(0, old.barCount).flatMap((b, i) => (b ? [{ id: newId(), s: i * 16, l: 16, d: b.degree, v: b.variant, n: null }] : []));
  song.tracks.bass.mute = !old.bass;
  const drums = song.tracks.drums;
  if (old.kit === 'none') drums.mute = true;
  else drums.kit = old.kit;
  drums.pattern = old.pattern;
  if (drumPreset) fillDrums(song, drumPreset);
  return song;
}
