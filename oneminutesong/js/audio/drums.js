// Drum kits. Acoustic and Garage play recorded hits (VCSL, CC0) from samples/drums;
// Electro mixes a synthesized 808 kick with sampled clap and hats.
//
// To add a kit: add an entry to KITS with
//   label, level,
//   voices: { kick, snare, hat, open, ride? }  each (ac, out, time, velocity) => void
//     (use hit(ac, out, t, v, 'sample-name', opts) for a sampled hit)
//   patterns: { basic, driving, halftime, sparse }  each { lane: 16-char string }
//     'x' = accent, 'o' = normal, 'g' = ghost, '.' = rest
//   optional makeInsert(ac) => { input, output }  for kit-wide color (saturation, filtering)
//   optional feel: { swing, jitter, velocity }  extra looseness on top of the global swing

export const PATTERN_IDS = ['basic', 'driving', 'halftime', 'sparse'];
export const PATTERN_LABELS = { basic: 'Basic', driving: 'Driving', halftime: 'Half-time', sparse: 'Sparse' };
export const HIT_VELOCITY = { x: 1, o: 0.65, g: 0.32 };

import { fetchBuffer, BASE } from './instruments.js';

export const DRUM_SAMPLES = ['kick', 'kick-soft', 'snare', 'snare-ghost', 'rim', 'hat', 'hat-soft', 'open', 'clap', 'ride', 'shaker'];
const bank = new Map();
let bankPromise = null;

export function loadDrums(ctx) {
  if (!bankPromise) {
    bankPromise = Promise.all(DRUM_SAMPLES.map(async (name) => {
      bank.set(name, await fetchBuffer(ctx, new URL(`drums/${name}.mp3`, BASE)));
    })).catch((err) => { bankPromise = null; throw err; });
  }
  return bankPromise;
}

export function drumsLoaded() {
  return bank.size === DRUM_SAMPLES.length;
}

// One sampled hit. rate repitches (and shortens/lengthens) it; cut chokes it after N seconds.
function hit(ac, out, t, v, name, { rate = 1, cut = null, gain = 1 } = {}) {
  const buf = bank.get(name);
  if (!buf) return;
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain * v, t);
  if (cut) g.gain.setTargetAtTime(0, t + cut, cut / 4);
  src.connect(g).connect(out);
  src.start(t);
  src.stop(t + (cut ? cut * 2 : buf.duration / rate + 0.05));
}

function env(ac, t, peak, decay, attack = 0.001) {
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  return g;
}

function filter(ac, type, f, q = 0.7) {
  const b = ac.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  return b;
}

function tone(ac, type, f0, f1, t, sweep, dur) {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + sweep);
  o.start(t);
  o.stop(t + dur + 0.05);
  return o;
}

function softClip(ac, drive) {
  const ws = ac.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  ws.curve = curve;
  return ws;
}

export const KITS = {
  acoustic: {
    label: 'Acoustic',
    level: 0.9,
    voices: {
      kick(ac, out, t, v) { hit(ac, out, t, v, v < 0.5 ? 'kick-soft' : 'kick', { gain: 1.1 }); },
      snare(ac, out, t, v) { hit(ac, out, t, v, v < 0.5 ? 'snare-ghost' : 'snare', { gain: v < 0.5 ? 0.9 : 0.85 }); },
      hat(ac, out, t, v) { hit(ac, out, t, v, v < 0.8 ? 'hat-soft' : 'hat', { gain: 0.55 }); },
      open(ac, out, t, v) { hit(ac, out, t, v, 'open', { gain: 0.45 }); },
      ride(ac, out, t, v) { hit(ac, out, t, v, 'ride', { gain: 0.4 }); },
    },
    patterns: {
      basic:    { kick: 'x.......x.......', snare: '....x.......x...', hat: 'x.o.x.o.x.o.x.o.' },
      driving:  { kick: 'x.....x.x.x.....', snare: '....x.......x..g', hat: 'xoxoxoxoxoxoxo.o', open: '..............x.' },
      halftime: { kick: 'x.........x.....', snare: '........x.......', hat: 'x.o.x.o.x.o.x.o.' },
      sparse:   { kick: 'x.......o.......', snare: '............o...', ride: 'x...o...x...o...' },
    },
  },

  electro: {
    label: 'Electro',
    level: 0.55,
    makeInsert(ac) {
      const input = ac.createGain();
      const sat = softClip(ac, 1.4);
      input.connect(sat);
      return { input, output: sat };
    },
    voices: {
      kick(ac, out, t, v) {
        // 808: sine with a fast pitch drop and a long, round tail.
        tone(ac, 'sine', 160, 45, t, 0.09, 0.85).connect(env(ac, t, v, 0.8)).connect(out);
        tone(ac, 'triangle', 900, 120, t, 0.012, 0.03).connect(env(ac, t, 0.25 * v, 0.02)).connect(out);
      },
      snare(ac, out, t, v) { hit(ac, out, t, v, 'clap', { gain: 0.9 }); },
      hat(ac, out, t, v) { hit(ac, out, t, v, 'hat', { rate: 1.35, cut: 0.06, gain: 0.5 }); },
      open(ac, out, t, v) { hit(ac, out, t, v, 'open', { rate: 1.25, cut: 0.22, gain: 0.4 }); },
    },
    patterns: {
      basic:    { kick: 'x.......x.......', snare: '....x.......x...', hat: '..x...x...x...x.' },
      driving:  { kick: 'x..x..x...x..x..', snare: '....x.......x...', hat: 'xoxoxoxoxoxoxoxo' },
      halftime: { kick: 'x......x..x.....', snare: '........x.......', hat: 'x.oox.o.x.oox.oo' },
      sparse:   { kick: 'x...............', snare: '........x.......', hat: 'x...x...x...x...', open: '..............o.' },
    },
  },

  garage: {
    label: 'Garage',
    level: 0.45,
    feel: { swing: 0.12, jitter: 0.008, velocity: 0.25 },
    makeInsert(ac) {
      // Lo-fi: crunch, then roll off the top like a worn tape.
      const input = ac.createGain();
      const hp = filter(ac, 'highpass', 45);
      const sat = softClip(ac, 2.6);
      const lp = filter(ac, 'lowpass', 6200);
      const out = ac.createGain();
      out.gain.value = 0.8;
      input.connect(hp).connect(sat).connect(lp).connect(out);
      return { input, output: out };
    },
    voices: {
      kick(ac, out, t, v) { hit(ac, out, t, v, 'kick', { rate: 0.88, gain: 1.15 }); },
      snare(ac, out, t, v) {
        hit(ac, out, t, v, v < 0.5 ? 'snare-ghost' : 'snare', { rate: 0.9, gain: 0.85 });
        if (v >= 0.5) hit(ac, out, t, v, 'rim', { rate: 0.9, gain: 0.25 });
      },
      hat(ac, out, t, v) { hit(ac, out, t, v, 'hat-soft', { rate: 0.95, gain: 0.5 }); },
      open(ac, out, t, v) { hit(ac, out, t, v, 'open', { rate: 0.9, cut: 0.3, gain: 0.4 }); },
    },
    patterns: {
      basic:    { kick: 'x.........x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
      driving:  { kick: 'x.....x...x.....', snare: '....x..g....x.g.', hat: 'xoxoxoxoxoxo.oxo', open: '............x...' },
      halftime: { kick: 'x..x......x.....', snare: '........x.......', hat: 'x.x.x.x.x.x.x.x.' },
      sparse:   { kick: 'x.......x.......', snare: '....g.......x...', hat: '..x...x...x...x.' },
    },
  },
};

export const KIT_IDS = Object.keys(KITS);

// Hits that land on a given 16th step of the bar: [{ lane, velocity }].
export function hitsAt(kitId, patternId, step) {
  const lanes = KITS[kitId].patterns[patternId];
  const hits = [];
  for (const [lane, row] of Object.entries(lanes)) {
    const v = HIT_VELOCITY[row[step]];
    if (v) hits.push({ lane, velocity: v });
  }
  return hits;
}

export function createDrumRack(ac, dest) {
  const inputs = {};
  for (const id of KIT_IDS) {
    const kit = KITS[id];
    const level = ac.createGain();
    level.gain.value = kit.level;
    if (kit.makeInsert) {
      const ins = kit.makeInsert(ac);
      level.connect(ins.input);
      ins.output.connect(dest);
    } else {
      level.connect(dest);
    }
    inputs[id] = level;
  }

  function createTake() {
    const gains = {};
    return {
      hit(kitId, lane, t, velocity) {
        if (!gains[kitId]) {
          gains[kitId] = ac.createGain();
          gains[kitId].connect(inputs[kitId]);
        }
        KITS[kitId].voices[lane](ac, gains[kitId], Math.max(t, ac.currentTime), velocity);
      },
      stop(fade = 0.05) {
        const t = ac.currentTime;
        for (const g of Object.values(gains)) {
          g.gain.setValueAtTime(g.gain.value, t);
          g.gain.linearRampToValueAtTime(0, t + fade);
          setTimeout(() => g.disconnect(), (fade + 0.1) * 1000);
        }
      },
    };
  }

  return { createTake };
}
