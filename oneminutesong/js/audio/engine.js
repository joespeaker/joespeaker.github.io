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
  glue.threshold.value = -18;
  glue.knee.value = 12;
  glue.ratio.value = 3;
  glue.attack.value = 0.01;
  glue.release.value = 0.2;

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

// Stereo noise with an exponential tail: a cheap, decent-sounding room.
function makeImpulse(ac, seconds, decay) {
  const len = Math.floor(ac.sampleRate * seconds);
  const ir = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < 40 ? i / 40 : 1);
    }
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
