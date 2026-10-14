// Chord synths and bass. Each synth plays one note per call (polyphony = one call per
// chord tone) and may own an "insert" effect chain shared by all its notes.
//
// To add a synth: add an entry to SYNTHS with a label, a rhythm (which 16th steps of the
// bar it hits and for how long), a level, an optional makeInsert(ctx) returning
// { input, output }, and note(ctx, dest, freq, time, duration).

export const freq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

// Attack/decay/sustain/release on a gain param. Returns when the note is fully silent.
function adsr(param, t, dur, { a, d, s, r, peak = 1 }) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.setTargetAtTime(peak * s, t + a, d / 3);
  param.setTargetAtTime(0, t + Math.max(dur, a), r / 3);
  return t + Math.max(dur, a) + r * 2;
}

function osc(ac, type, f, t, end, detune = 0) {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.value = f;
  o.detune.value = detune;
  o.start(t);
  o.stop(end);
  return o;
}

export const SYNTHS = {
  pad: {
    label: 'Warm pad',
    rhythm: [[0, 16]],              // hold the whole bar
    level: 0.11,
    note(ac, dest, f, t, dur) {
      const amp = ac.createGain();
      const end = adsr(amp.gain, t, dur, { a: 0.35, d: 0.6, s: 0.8, r: 0.9 });
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 0.7;
      lp.frequency.setValueAtTime(700, t);
      lp.frequency.linearRampToValueAtTime(1700, t + 0.8);
      for (const cents of [-9, 0, 8]) osc(ac, 'sawtooth', f, t, end, cents).connect(lp);
      lp.connect(amp).connect(dest);
    },
  },

  ep: {
    label: 'Electric piano',
    rhythm: [[0, 7], [8, 7]],       // half notes
    level: 0.2,
    note(ac, dest, f, t, dur) {
      const amp = ac.createGain();
      const end = adsr(amp.gain, t, dur, { a: 0.004, d: 1.4, s: 0.18, r: 0.35 });
      const carrier = osc(ac, 'sine', f, t, end);
      // Body: 1:1 modulator whose index falls quickly, giving the "bark" then a soft tone.
      const mod = osc(ac, 'sine', f, t, end);
      const index = ac.createGain();
      index.gain.setValueAtTime(f * 2.6, t);
      index.gain.setTargetAtTime(f * 0.35, t, 0.25);
      mod.connect(index).connect(carrier.frequency);
      // Tine: a high, very short modulator for the bell attack.
      const tine = osc(ac, 'sine', f * 14, t, t + 0.3);
      const tineIdx = ac.createGain();
      tineIdx.gain.setValueAtTime(f * 0.9, t);
      tineIdx.gain.setTargetAtTime(0, t, 0.03);
      tine.connect(tineIdx).connect(carrier.frequency);
      carrier.connect(amp).connect(dest);
    },
  },

  pluck: {
    label: 'Pluck',
    rhythm: [[0, 2], [3, 2], [6, 2], [10, 2], [12, 2]], // syncopated 16ths
    level: 0.13,
    note(ac, dest, f, t, dur) {
      const amp = ac.createGain();
      const end = adsr(amp.gain, t, dur, { a: 0.002, d: 0.3, s: 0.05, r: 0.12 });
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 5;
      lp.frequency.setValueAtTime(5200, t);
      lp.frequency.setTargetAtTime(380, t, 0.07);
      osc(ac, 'sawtooth', f, t, end).connect(lp);
      const sq = ac.createGain();
      sq.gain.value = 0.35;
      osc(ac, 'square', f, t, end, 5).connect(sq).connect(lp);
      lp.connect(amp).connect(dest);
    },
  },

  organ: {
    label: 'Organ',
    rhythm: [[0, 16]],
    level: 0.09,
    makeInsert(ac) {
      // Slow rotary-ish tremolo.
      const input = ac.createGain();
      const output = ac.createGain();
      output.gain.value = 0.85;
      const lfo = ac.createOscillator();
      lfo.frequency.value = 5.6;
      const depth = ac.createGain();
      depth.gain.value = 0.15;
      lfo.connect(depth).connect(output.gain);
      lfo.start();
      input.connect(output);
      return { input, output };
    },
    note(ac, dest, f, t, dur) {
      // Drawbar-style additive sines: 8', 4', 2 2/3', 2', 1 3/5', 1'.
      const real = new Float32Array(9);
      const imag = new Float32Array([0, 1, 0.7, 0.45, 0.35, 0, 0.18, 0, 0.14]);
      const wave = ac.createPeriodicWave(real, imag);
      const o = ac.createOscillator();
      o.setPeriodicWave(wave);
      o.frequency.value = f;
      const amp = ac.createGain();
      const end = adsr(amp.gain, t, dur, { a: 0.012, d: 0.1, s: 1, r: 0.07 });
      o.start(t);
      o.stop(end);
      o.connect(amp).connect(dest);
    },
  },

  lofi: {
    label: 'Lo-fi keys',
    rhythm: [[0, 6], [6, 4], [10, 6]],
    level: 0.17,
    makeInsert(ac) {
      const input = ac.createGain();
      const output = ac.createGain();
      // Chorus: two short delays wobbled by slow LFOs, mixed with the dry signal.
      for (const [ms, rate] of [[13, 0.7], [19, 1.1]]) {
        const d = ac.createDelay(0.05);
        d.delayTime.value = ms / 1000;
        const lfo = ac.createOscillator();
        lfo.frequency.value = rate;
        const depth = ac.createGain();
        depth.gain.value = 0.0022;
        lfo.connect(depth).connect(d.delayTime);
        lfo.start();
        const g = ac.createGain();
        g.gain.value = 0.45;
        input.connect(d).connect(g).connect(output);
      }
      input.connect(output);
      // A touch of bitcrush blended in parallel, then a dull top end.
      const crush = ac.createWaveShaper();
      const steps = 20;
      const curve = new Float32Array(2048);
      for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = Math.round(x * steps) / steps;
      }
      crush.curve = curve;
      const crushMix = ac.createGain();
      crushMix.gain.value = 0.3;
      input.connect(crush).connect(crushMix).connect(output);
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 5200;
      const finalOut = ac.createGain();
      output.connect(lp).connect(finalOut);
      return { input, output: finalOut };
    },
    note(ac, dest, f, t, dur) {
      const amp = ac.createGain();
      const end = adsr(amp.gain, t, dur, { a: 0.004, d: 0.9, s: 0.28, r: 0.45 });
      osc(ac, 'triangle', f, t, end).connect(amp);
      const glass = ac.createGain();
      glass.gain.value = 0.18;
      osc(ac, 'sine', f * 2, t, end, 3).connect(glass).connect(amp);
      amp.connect(dest);
    },
  },
};

export const SYNTH_IDS = Object.keys(SYNTHS);

export const BASS = {
  rhythm: [[0, 6], [8, 5], [14, 2]],
  level: 0.32,
  note(ac, dest, f, t, dur) {
    const amp = ac.createGain();
    const end = adsr(amp.gain, t, dur, { a: 0.006, d: 0.25, s: 0.75, r: 0.08 });
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.setTargetAtTime(320, t, 0.08);
    osc(ac, 'sine', f, t, end).connect(amp);
    const grit = ac.createGain();
    grit.gain.value = 0.3;
    osc(ac, 'sawtooth', f, t, end).connect(grit).connect(lp).connect(amp);
    amp.connect(dest);
  },
};

// Bass sits in octave 1-2: E1 (28) up to D#2 (39), so every key stays under the chords.
export function bassMidi(rootPc) {
  return 28 + ((rootPc - 4 + 12) % 12);
}

// Builds each synth's level + insert chain once. Notes are played through a "take":
// a set of gains feeding those chains. Stopping fades and drops the take, which silences
// every scheduled note (even a pad held for the whole bar) without touching the inserts.
export function createSynthRack(ac, dest) {
  const inputs = {};
  for (const id of SYNTH_IDS) {
    const def = SYNTHS[id];
    const level = ac.createGain();
    level.gain.value = def.level;
    if (def.makeInsert) {
      const ins = def.makeInsert(ac);
      level.connect(ins.input);
      ins.output.connect(dest);
    } else {
      level.connect(dest);
    }
    inputs[id] = level;
  }
  const bassLevel = ac.createGain();
  bassLevel.gain.value = BASS.level;
  bassLevel.connect(dest);

  function createTake() {
    const gains = {};
    const gainFor = (id) => {
      if (!gains[id]) {
        gains[id] = ac.createGain();
        gains[id].connect(id === 'bass' ? bassLevel : inputs[id]);
      }
      return gains[id];
    };
    return {
      chord(id, midiNotes, t, dur) {
        const g = gainFor(id);
        for (const m of midiNotes) SYNTHS[id].note(ac, g, freq(m), t, dur);
      },
      bass(midi, t, dur) {
        BASS.note(ac, gainFor('bass'), freq(midi), t, dur);
      },
      stop(fade = 0.06) {
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
