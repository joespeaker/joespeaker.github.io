// Turns a song into what to play on each 16th step. Pure: the same events drive live
// playback, the WAV export, and what the piano roll draws for the chords track.

import { voiceChord } from './voicing.js';
import { totalSteps, chordPcs, bassNotes, laneString, DRUM_LANES } from './song.js';

const VEL = { x: 1, o: 0.7, g: 0.35 };

// Voice every chord block with smooth voice leading, looping around so the last chord
// leads back into the first. Pinned notes (block.n) are used as-is and still guide the
// chords around them.
export function blockVoicings(song) {
  const blocks = [...song.tracks.chords.blocks].sort((a, b) => a.s - b.s);
  const out = new Map();
  let prev = null;
  for (let pass = 0; pass < 2; pass++) {
    for (const b of blocks) {
      const v = b.n ? [...b.n] : voiceChord(chordPcs(song, b), prev);
      out.set(b.id, v);
      prev = v;
    }
  }
  return out;
}

// The hits a block plays in a given style: [{ s, l, notes, vel, strum }].
export function expandBlock(block, notes, style) {
  const end = block.s + block.l;
  const hits = [];
  const every = (step, len, vel = 0.75, pick = null) => {
    for (let s = block.s, i = 0; s < end; s += step, i++) {
      hits.push({ s, l: Math.min(len, end - s), notes: pick ? [pick(i)] : notes, vel: typeof vel === 'function' ? vel(s) : vel });
    }
  };
  switch (style) {
    case 'half': every(8, 8); break;
    case 'pulse': every(4, 4, (s) => (s % 16 === 0 ? 0.8 : 0.65)); break;
    case 'strum':
      every(2, 2, (s) => (s % 4 === 0 ? 0.75 : 0.5));
      for (const h of hits) h.strum = true;
      break;
    case 'arp': {
      const up = [...notes, ...notes.slice(1, -1).reverse()];
      every(2, 3, 0.7, (i) => up[i % up.length]);
      break;
    }
    case 'offbeat':
      for (let s = block.s; s < end; s++) {
        if (s % 4 === 2) hits.push({ s, l: Math.min(2, end - s), notes, vel: 0.7 });
      }
      if (!hits.length) hits.push({ s: block.s, l: block.l, notes, vel: 0.7 });
      break;
    default: hits.push({ s: block.s, l: block.l, notes, vel: 0.75 });
  }
  return hits;
}

// Everything that sounds, step by step. Muting is applied in the mixer, not here, so
// mute/solo respond instantly while playing.
export function compile(song) {
  const total = totalSteps(song);
  const steps = Array.from({ length: total }, () => []);
  const t = song.tracks;
  const push = (s, ev) => { if (s >= 0 && s < total) steps[s].push(ev); };

  const voicings = blockVoicings(song);
  for (const b of t.chords.blocks) {
    for (const h of expandBlock(b, voicings.get(b.id), t.chords.style)) {
      push(h.s, { track: 'chords', inst: t.chords.inst, notes: h.notes, l: Math.min(h.l, total - h.s), vel: h.vel, strum: h.strum });
    }
  }
  for (const n of t.melody.notes) {
    push(n.s, { track: 'melody', inst: t.melody.inst, notes: [n.p], l: Math.min(n.l, total - n.s), vel: n.v });
  }
  for (const n of bassNotes(song)) {
    push(n.s, { track: 'bass', inst: t.bass.inst, notes: [n.p], l: Math.min(n.l, total - n.s), vel: n.v });
  }
  for (const lane of DRUM_LANES) {
    const row = laneString(song, lane);
    for (let s = 0; s < total; s++) {
      if (VEL[row[s]]) push(s, { track: 'drums', kit: t.drums.kit, lane, vel: VEL[row[s]] });
    }
  }
  return { total, steps, voicings };
}
