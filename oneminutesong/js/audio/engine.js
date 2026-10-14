// Audio graph. Everything is synthesized; nothing is loaded from files.
//
//   synths ─┐            ┌─> reverb send ─> convolver ─┐
//   bass ───┼─> dry bus ─┤                             ├─> glue comp ─> limiter ─> out ─> speakers
//   drums ──┘            └─────────────────────────────┘                                └─> (WAV export rebuilds this chain offline)
//

let ctx = null;
let nodes = null;

export function getContext() {
  return ctx;
}

// Must be called from a user gesture (tap/click/keypress) the first time, for iOS Safari.
export function ensureAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });
    nodes = buildMaster(ctx);
    // iOS unlock: play one silent sample inside the gesture.
    const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  }
  if (ctx.state !== 'running') ctx.resume();
  return ctx;
}

// The master chain. Exported so the WAV export can build an identical one on an
// OfflineAudioContext, so downloads sound the same as playback.
export function buildMaster(ac, reverbMix = 0.3) {
  const dry = ac.createGain();
  const send = ac.createGain();
  send.gain.value = sendLevel(reverbMix);
  const reverb = ac.createConvolver();
  reverb.buffer = makeImpulse(ac, 2.6, 3.2);
  const wet = ac.createGain();
  wet.gain.value = 0.9;

  const glue = ac.createDynamicsCompressor();
  // Gentle glue: catches peaks without squashing the samples' dynamics.
  glue.threshold.value = -12;
  glue.knee.value = 10;
  glue.ratio.value = 2;
  glue.attack.value = 0.02;
  glue.release.value = 0.25;

  const limiter = ac.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.08;

  const out = ac.createGain();
  out.gain.value = 0.9;

  dry.connect(glue);
  dry.connect(send);
  send.connect(reverb).connect(wet).connect(glue);
  glue.connect(limiter).connect(out).connect(ac.destination);

  return { dry, send, out };
}

// Stereo noise with an exponential tail that gets darker as it decays (high frequencies
// die faster in real rooms), plus a short pre-delay. Cheap, but much less "hissy".
function makeImpulse(ac, seconds, decay) {
  const len = Math.floor(ac.sampleRate * seconds);
  const pre = Math.floor(ac.sampleRate * 0.012);
  const ir = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / (len - pre);
      const coeff = 0.15 + 0.8 * t;           // one-pole lowpass, closing over time
      lp += (1 - coeff) * ((Math.random() * 2 - 1) - lp);
      data[i] = lp * Math.pow(1 - t, decay) * Math.min(1, (i - pre) / 200);
    }
    // The lowpass lowers the energy; scale back to what plain white noise would give so
    // the reverb knob means the same amount of room as before.
    let actual = 0;
    let target = 0;
    for (let i = pre; i < len; i++) {
      actual += data[i] * data[i];
      target += Math.pow(1 - (i - pre) / (len - pre), 2 * decay) / 3;
    }
    const k = Math.sqrt(target / actual) * 0.8;
    for (let i = pre; i < len; i++) data[i] *= k;
  }
  return ir;
}

// 0..1 knob -> send level. Above ~0.6 send it starts to wash out, so cap there.
function sendLevel(mix) {
  return mix * 0.6;
}

export function setReverbMix(amount) {
  if (nodes) nodes.send.gain.setTargetAtTime(sendLevel(amount), ctx.currentTime, 0.05);
}

export function dryBus() {
  return nodes.dry;
}

export function masterOut() {
  return nodes.out;
}
