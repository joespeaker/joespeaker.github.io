// Sampled instruments. Samples live in ../samples/<id>/<note>.mp3, recorded every minor
// third (C, Eb, Gb, A); each played note uses the nearest sample, repitched by at most
// a semitone and a half. Instruments load on demand, the first time they're used.
//
// To add an instrument: run tools/fetch_samples.py with a new PITCHED entry, then add
// an entry here. `gain` levels it against the piano (measured from the files), `release`
// is the fade after note-off, `sustain` loops the middle of the sample for long notes.

export const INSTRUMENTS = {
  piano:     { label: 'Piano',          octaves: [2, 6], gain: 1.0, release: 0.45, sustain: false },
  epiano:    { label: 'Electric piano', octaves: [2, 6], gain: 1.3, release: 0.35, sustain: false },
  pad:       { label: 'Warm pad',       octaves: [2, 6], gain: 1.75, release: 0.9, sustain: true },
  strings:   { label: 'Strings',        octaves: [2, 6], gain: 1.75, release: 0.6, sustain: true },
  organ:     { label: 'Organ',          octaves: [2, 6], gain: 1.85, release: 0.08, sustain: true },
  guitar:    { label: 'Nylon guitar',   octaves: [2, 6], gain: 1.05, release: 0.3, sustain: false },
  vibes:     { label: 'Vibraphone',     octaves: [3, 7], gain: 3.6, release: 0.6, sustain: false },
  lead:      { label: 'Synth lead',     octaves: [3, 7], gain: 1.1, release: 0.12, sustain: true },
  bass:      { label: 'Finger bass',    octaves: [1, 4], gain: 1.0, release: 0.1, sustain: false },
  synthbass: { label: 'Synth bass',     octaves: [1, 4], gain: 1.5, release: 0.08, sustain: false },
};

export const CHORD_INSTRUMENTS = ['piano', 'epiano', 'pad', 'strings', 'organ', 'guitar'];
export const BASS_INSTRUMENTS = ['bass', 'synthbass'];

const STEPS = [['C', 0], ['Eb', 3], ['Gb', 6], ['A', 9]];
export const BASE = new URL('../../samples/', import.meta.url);

export const freq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

// Every sample's note name and MIDI number for an instrument.
export function sampleNotes(id) {
  const [lo, hi] = INSTRUMENTS[id].octaves;
  const out = [];
  for (let oct = lo; oct <= hi; oct++) {
    for (const [name, pc] of STEPS) {
      if (oct === hi && pc !== 0) continue;
      out.push({ name: `${name}${oct}`, midi: 12 * (oct + 1) + pc });
    }
  }
  return out;
}

// Nearest sample for a MIDI note, and the playback rate that repitches it.
export function zoneFor(zones, midi) {
  let best = zones[0];
  for (const z of zones) if (Math.abs(z.midi - midi) < Math.abs(best.midi - midi)) best = z;
  return { zone: best, rate: Math.pow(2, (midi - best.midi) / 12) };
}

const loaded = new Map();   // id -> { zones } once decoded
const pending = new Map();  // id -> Promise

function decode(ctx, data) {
  // Older Safari only has the callback form.
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(data, resolve, reject);
    if (p && p.then) p.then(resolve, reject);
  });
}

export async function fetchBuffer(ctx, url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return decode(ctx, await res.arrayBuffer());
}

// Make the region [a, b] loop seamlessly: crossfade its tail into the audio just before
// `a`, so jumping from b back to a doesn't click. Done once, in place, after decoding.
export function bakeLoop(buffer, a, b, xf) {
  const sr = buffer.sampleRate;
  const aN = Math.floor(a * sr);
  const bN = Math.floor(b * sr);
  const xN = Math.min(Math.floor(xf * sr), aN, bN - aN);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < xN; i++) {
      const t = i / xN;
      const end = bN - xN + i;
      const pre = aN - xN + i;
      d[end] = d[end] * Math.cos(t * Math.PI / 2) + d[pre] * Math.sin(t * Math.PI / 2);
    }
  }
  return { loopStart: aN / sr, loopEnd: bN / sr };
}

export function loadInstrument(ctx, id) {
  if (loaded.has(id)) return Promise.resolve(loaded.get(id));
  if (pending.has(id)) return pending.get(id);
  const def = INSTRUMENTS[id];
  const p = Promise.all(sampleNotes(id).map(async ({ name, midi }) => {
    const buffer = await fetchBuffer(ctx, new URL(`${id}/${name}.mp3`, BASE));
    const zone = { midi, buffer };
    if (def.sustain) Object.assign(zone, bakeLoop(buffer, 0.6, buffer.duration - 0.3, 0.25));
    return zone;
  })).then((zones) => {
    const inst = { zones };
    loaded.set(id, inst);
    pending.delete(id);
    return inst;
  }, (err) => {
    pending.delete(id);
    throw err;
  });
  pending.set(id, p);
  return p;
}

export function isLoaded(id) {
  return loaded.has(id);
}

// Play one note. Returns nothing; silently skips if the instrument isn't loaded yet.
export function playNote(ac, dest, id, midi, t, dur, velocity = 0.8) {
  const inst = loaded.get(id);
  if (!inst) return;
  const def = INSTRUMENTS[id];
  const { zone, rate } = zoneFor(inst.zones, midi);
  const src = ac.createBufferSource();
  src.buffer = zone.buffer;
  src.playbackRate.value = rate;
  if (def.sustain) {
    src.loop = true;
    src.loopStart = zone.loopStart;
    src.loopEnd = zone.loopEnd;
  }
  const amp = ac.createGain();
  const level = def.gain * velocity * velocity;
  const start = Math.max(t, ac.currentTime);
  const off = start + Math.max(dur, 0.05);
  amp.gain.setValueAtTime(level, start);
  amp.gain.setValueAtTime(level, off);
  amp.gain.setTargetAtTime(0, off, def.release / 3);
  src.connect(amp).connect(dest);
  src.start(start);
  src.stop(off + def.release * 2.5);
}

// Chord and bass buses feeding `dest`, plus "takes" (one run of the transport) that can be
// faded out and dropped to silence everything scheduled in them at once.
export function createInstrumentRack(ac, dest) {
  // Thin out the low end of the chords so they don't fight the bass.
  const chordBus = ac.createBiquadFilter();
  chordBus.type = 'highpass';
  chordBus.frequency.value = 110;
  chordBus.Q.value = 0.5;
  const chordLevel = ac.createGain();
  chordLevel.gain.value = 2.1;
  chordBus.connect(chordLevel).connect(dest);
  const bassBus = ac.createGain();
  bassBus.gain.value = 2.0;
  bassBus.connect(dest);

  function createTake() {
    const chords = ac.createGain();
    const bass = ac.createGain();
    chords.connect(chordBus);
    bass.connect(bassBus);
    return {
      chord(id, midiNotes, t, dur, velocity = 0.75) {
        // Fewer notes play a little louder so 3-note and 5-note chords sit at similar levels.
        const v = velocity * Math.min(1, 1.6 / Math.sqrt(midiNotes.length));
        for (const m of midiNotes) playNote(ac, chords, id, m, t, dur, v);
      },
      note(id, midi, t, dur, velocity = 0.8) {
        playNote(ac, chords, id, midi, t, dur, velocity);
      },
      bass(id, midi, t, dur, velocity = 0.85) {
        playNote(ac, bass, id, midi, t, dur, velocity);
      },
      stop(fade = 0.06) {
        const now = ac.currentTime;
        for (const g of [chords, bass]) {
          g.gain.setValueAtTime(g.gain.value, now);
          g.gain.linearRampToValueAtTime(0, now + fade);
          setTimeout(() => g.disconnect(), (fade + 0.1) * 1000);
        }
      },
    };
  }

  return { createTake };
}
