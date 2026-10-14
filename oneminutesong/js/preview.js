// Stage 1 stand-in so palette taps make sound. Stage 2 replaces this with the real engine.
let ctx = null;
let out = null;

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    out = ctx.createDynamicsCompressor();
    out.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

const freq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

export function playChord(midiNotes, dur = 1.1) {
  const ac = ensure();
  const t = ac.currentTime + 0.01;
  const bus = ac.createGain();
  bus.gain.value = 0.5 / Math.sqrt(midiNotes.length);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2400;
  bus.connect(lp).connect(out);
  for (const m of midiNotes) {
    const osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq(m);
    const env = ac.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.015);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(env).connect(bus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
}
