// Synthesized drum kits. No samples: every hit is oscillators and filtered noise.
//
// To add a kit: add an entry to KITS with
//   label, level,
//   voices: { kick, snare, hat, open, ride? }  each (ac, out, time, velocity) => void
//   patterns: { basic, driving, halftime, sparse }  each { lane: 16-char string }
//     'x' = accent, 'o' = normal, 'g' = ghost, '.' = rest
//   optional makeInsert(ac) => { input, output }  for kit-wide color (saturation, filtering)
//   optional feel: { swing, jitter, velocity }  extra looseness on top of the global swing

export const PATTERN_IDS = ['basic', 'driving', 'halftime', 'sparse'];
export const PATTERN_LABELS = { basic: 'Basic', driving: 'Driving', halftime: 'Half-time', sparse: 'Sparse' };
export const HIT_VELOCITY = { x: 1, o: 0.65, g: 0.32 };

const noiseCache = new WeakMap();
function noiseBuffer(ac) {
  if (!noiseCache.has(ac)) {
    const buf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ac, buf);
  }
  return noiseCache.get(ac);
}

function noise(ac, t, dur) {
  const s = ac.createBufferSource();
  s.buffer = noiseBuffer(ac);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.05);
  return s;
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

// Metallic cluster of detuned squares, the classic analog cymbal trick.
function metal(ac, t, dur, base = 40) {
  const sum = ac.createGain();
  sum.gain.value = 0.25;
  for (const r of [2, 3, 4.16, 5.43, 6.79, 8.21]) tone(ac, 'square', base * r, base * r, t, 0, dur).connect(sum);
  return sum;
}

export const KITS = {
  acoustic: {
    label: 'Acoustic',
    level: 0.95,
    voices: {
      kick(ac, out, t, v) {
        tone(ac, 'sine', 130, 48, t, 0.12, 0.5).connect(env(ac, t, v, 0.45)).connect(out);
        noise(ac, t, 0.02).connect(filter(ac, 'highpass', 3000)).connect(env(ac, t, 0.25 * v, 0.015)).connect(out);
      },
      snare(ac, out, t, v) {
        tone(ac, 'triangle', 200, 165, t, 0.06, 0.2).connect(env(ac, t, 0.55 * v, 0.14)).connect(out);
        noise(ac, t, 0.25).connect(filter(ac, 'highpass', 1300)).connect(env(ac, t, 0.55 * v, 0.22)).connect(out);
      },
      hat(ac, out, t, v) {
        noise(ac, t, 0.06).connect(filter(ac, 'highpass', 7000)).connect(filter(ac, 'bandpass', 10000, 1))
          .connect(env(ac, t, 0.45 * v, 0.05)).connect(out);
      },
      open(ac, out, t, v) {
        noise(ac, t, 0.4).connect(filter(ac, 'highpass', 7000)).connect(filter(ac, 'bandpass', 9500, 0.8))
          .connect(env(ac, t, 0.35 * v, 0.34)).connect(out);
      },
      ride(ac, out, t, v) {
        metal(ac, t, 1, 42).connect(filter(ac, 'bandpass', 7500, 1.2)).connect(env(ac, t, 0.18 * v, 0.9)).connect(out);
        noise(ac, t, 0.6).connect(filter(ac, 'highpass', 8500)).connect(env(ac, t, 0.06 * v, 0.55)).connect(out);
      },
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
    level: 0.85,
    makeInsert(ac) {
      const input = ac.createGain();
      const sat = softClip(ac, 1.6);
      input.connect(sat);
      return { input, output: sat };
    },
    voices: {
      kick(ac, out, t, v) {
        // 808: sine with a fast pitch drop and a long, round tail.
        tone(ac, 'sine', 165, 46, t, 0.09, 0.85).connect(env(ac, t, v, 0.8)).connect(out);
      },
      snare(ac, out, t, v) {
        // Clap: three quick noise bursts, then a short tail.
        const bp = filter(ac, 'bandpass', 1150, 1.3);
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        for (const off of [0, 0.011, 0.022]) {
          g.gain.setValueAtTime(0.7 * v, t + off);
          g.gain.exponentialRampToValueAtTime(0.08 * v, t + off + 0.009);
        }
        g.gain.setValueAtTime(0.6 * v, t + 0.031);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        noise(ac, t, 0.25).connect(bp).connect(g).connect(out);
      },
      hat(ac, out, t, v) {
        noise(ac, t, 0.05).connect(filter(ac, 'highpass', 9500)).connect(env(ac, t, 0.4 * v, 0.035)).connect(out);
      },
      open(ac, out, t, v) {
        noise(ac, t, 0.3).connect(filter(ac, 'highpass', 9000)).connect(env(ac, t, 0.3 * v, 0.22)).connect(out);
      },
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
    level: 0.95,
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
      kick(ac, out, t, v) {
        tone(ac, 'sine', 95, 45, t, 0.07, 0.4).connect(env(ac, t, v, 0.34)).connect(out);
        tone(ac, 'triangle', 60, 42, t, 0.05, 0.12).connect(env(ac, t, 0.3 * v, 0.1)).connect(out);
      },
      snare(ac, out, t, v) {
        noise(ac, t, 0.25).connect(filter(ac, 'lowpass', 5000)).connect(filter(ac, 'bandpass', 1700, 0.6))
          .connect(env(ac, t, 0.7 * v, 0.2)).connect(out);
        tone(ac, 'triangle', 215, 190, t, 0.05, 0.1).connect(env(ac, t, 0.3 * v, 0.08)).connect(out);
      },
      hat(ac, out, t, v) {
        noise(ac, t, 0.06).connect(filter(ac, 'highpass', 6000)).connect(env(ac, t, 0.3 * v, 0.045)).connect(out);
      },
      open(ac, out, t, v) {
        noise(ac, t, 0.3).connect(filter(ac, 'highpass', 5800)).connect(env(ac, t, 0.24 * v, 0.25)).connect(out);
      },
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
