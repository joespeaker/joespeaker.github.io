import {
  KEY_NAMES, diatonicChords, chordName, chordNotes, chordIntervals, pretty, VARIANTS, keyName,
} from './theory.js';
import { voiceChord, voiceProgression } from './voicing.js';
import { ensureAudio, dryBus, setReverbMix } from './audio/engine.js';
import { SYNTHS, SYNTH_IDS, BASS, bassMidi, createSynthRack } from './audio/synths.js';
import { Scheduler } from './audio/scheduler.js';
import { KITS, KIT_IDS, PATTERN_IDS, PATTERN_LABELS, hitsAt, createDrumRack } from './audio/drums.js';

const state = {
  keyPc: 0,
  mode: 'major',
  variants: [],   // chosen variant id per scale degree
  selected: null, // selected degree (used for tap-to-place in stage 4)
  synth: 'ep',
  tempo: 100,
  reverb: 0.3,
  bass: true,
  kit: 'acoustic',    // or 'none'
  pattern: 'basic',
  swing: 0.15,
  loop: [0, 4, 5, 3], // stage 2 test loop: last 4 tapped degrees (starts as I V vi IV)
};

const $ = (sel) => document.querySelector(sel);
const keysEl = $('#keys');
const modeEl = $('#mode');
const paletteEl = $('#palette');
const keyLabel = $('#key-label');
const sheet = $('#variant-sheet');
const sheetTitle = $('#sheet-title');
const variantsEl = $('#variants');

let chords = [];

function resetVariants() {
  chords = diatonicChords(state.keyPc, state.mode);
  state.variants = chords.map((c) => c.defaultVariant);
  state.selected = null;
}

function pcsFor(degree) {
  const c = chords[degree];
  return chordIntervals(state.variants[degree]).map((i) => (c.rootPc + i) % 12);
}

/* ---------- Audio ---------- */

let ctx = null;
let rack = null;
let previewTake = null;
let lastPreview = null;
let scheduler = null;
let take = null;
let drumRack = null;
let drumTake = null;
let previewDrums = null;

// Called from inside a tap/click/keypress so iOS lets audio start.
function audio() {
  if (!rack) {
    ctx = ensureAudio();
    rack = createSynthRack(ctx, dryBus());
    previewTake = rack.createTake();
    drumRack = createDrumRack(ctx, dryBus());
    previewDrums = drumRack.createTake();
    setReverbMix(state.reverb);
    scheduler = new Scheduler(ctx, {
      onStep,
      getTempo: () => state.tempo,
      getTotalSteps: () => state.loop.length * 16,
    });
  } else {
    ensureAudio();
  }
}

function preview(degree) {
  audio();
  const notes = voiceChord(pcsFor(degree), lastPreview);
  lastPreview = notes;
  previewTake.chord(state.synth, notes, ctx.currentTime + 0.01, 0.9);
}

/* ---------- Key picker ---------- */

function renderKeys() {
  keysEl.innerHTML = '';
  KEY_NAMES[state.mode].forEach((name, pc) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'key';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(pc === state.keyPc));
    b.tabIndex = pc === state.keyPc ? 0 : -1;
    b.textContent = pretty(name);
    b.dataset.pc = pc;
    keysEl.append(b);
  });
  for (const b of modeEl.querySelectorAll('button')) {
    const on = b.dataset.mode === state.mode;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  keyLabel.textContent = `${pretty(keyName(state.keyPc, state.mode))} ${state.mode}`;
}

function setKey(pc) {
  state.keyPc = pc;
  resetVariants();
  renderKeys();
  renderPalette();
  renderLoop();
  keysEl.querySelector(`[data-pc="${pc}"]`).focus();
}

function setMode(mode) {
  state.mode = mode;
  resetVariants();
  renderKeys();
  renderPalette();
  renderLoop();
}

keysEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-pc]');
  if (b) setKey(Number(b.dataset.pc));
});
keysEl.addEventListener('keydown', (e) => {
  const step = { ArrowRight: 1, ArrowDown: 6, ArrowLeft: -1, ArrowUp: -6 }[e.key];
  if (step === undefined) return;
  e.preventDefault();
  setKey((state.keyPc + step + 12) % 12);
});

modeEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (b) setMode(b.dataset.mode);
});
modeEl.addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  setMode(state.mode === 'major' ? 'minor' : 'major');
  modeEl.querySelector(`[data-mode="${state.mode}"]`).focus();
});

/* ---------- Palette ---------- */

function chordLabel(degree) {
  return chordName(chords[degree].root, state.variants[degree]);
}

function renderPalette() {
  paletteEl.innerHTML = '';
  chords.forEach((c, i) => {
    const v = state.variants[i];
    const name = chordLabel(i);
    const notes = chordNotes(c.root, v).map(pretty).join(' ');
    const cell = document.createElement('div');
    cell.style.position = 'relative';

    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'key chord';
    b.classList.toggle('selected', state.selected === i);
    b.classList.toggle('changed', v !== c.defaultVariant);
    b.dataset.degree = i;
    b.tabIndex = (state.selected ?? 0) === i ? 0 : -1;
    b.setAttribute('aria-pressed', String(state.selected === i));
    b.setAttribute('aria-label', `${c.roman}, ${pretty(name)}: ${notes}. Hold for variants.`);
    b.innerHTML = `<span class="roman">${c.roman}</span><span class="name">${pretty(name)}</span><span class="notes">${notes}</span>`;

    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'more';
    more.dataset.more = i;
    more.tabIndex = -1;
    more.setAttribute('aria-label', `Variants for ${pretty(name)}`);
    more.textContent = '⋯';

    cell.append(b, more);
    paletteEl.append(cell);
  });
}

function selectChord(degree) {
  state.selected = degree;
  state.loop = [...state.loop.slice(1), degree];
  renderLoop();
  renderPalette();
  paletteEl.querySelector(`[data-degree="${degree}"]`).focus();
  preview(degree);
}

// Tap = select + preview. Long-press (450ms) = variant sheet. Pointer events cover mouse,
// touch and pen; the long-press timer is cancelled if the finger moves or lifts early.
let pressTimer = null;
let longPressed = false;
let pressStart = null;

paletteEl.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('[data-degree]');
  if (!b) return;
  longPressed = false;
  pressStart = { x: e.clientX, y: e.clientY };
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => {
    longPressed = true;
    openVariants(Number(b.dataset.degree));
  }, 450);
});
paletteEl.addEventListener('pointermove', (e) => {
  if (pressStart && Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 10) {
    clearTimeout(pressTimer);
  }
});
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
  paletteEl.addEventListener(ev, () => { clearTimeout(pressTimer); pressStart = null; });
}
paletteEl.addEventListener('contextmenu', (e) => e.preventDefault());

paletteEl.addEventListener('click', (e) => {
  const more = e.target.closest('[data-more]');
  if (more) { openVariants(Number(more.dataset.more)); return; }
  const b = e.target.closest('[data-degree]');
  if (!b) return;
  if (longPressed) { longPressed = false; return; }
  selectChord(Number(b.dataset.degree));
});

paletteEl.addEventListener('keydown', (e) => {
  const b = e.target.closest('[data-degree]');
  if (!b) return;
  const d = Number(b.dataset.degree);
  const cols = getComputedStyle(paletteEl).gridTemplateColumns.split(' ').length;
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
  if (step !== undefined) {
    e.preventDefault();
    const next = Math.min(6, Math.max(0, d + step));
    for (const el of paletteEl.querySelectorAll('[data-degree]')) el.tabIndex = -1;
    const target = paletteEl.querySelector(`[data-degree="${next}"]`);
    target.tabIndex = 0;
    target.focus();
  } else if (e.key === 'v' || e.key === 'V' || (e.key === 'Enter' && e.shiftKey)) {
    e.preventDefault();
    openVariants(d);
  }
});

/* ---------- Variant sheet ---------- */

let sheetDegree = null;

function openVariants(degree) {
  sheetDegree = degree;
  const c = chords[degree];
  sheetTitle.textContent = `${c.roman} · ${pretty(c.root)} variants`;
  renderVariants();
  if (!sheet.open) sheet.showModal();
}

function renderVariants() {
  const c = chords[sheetDegree];
  variantsEl.innerHTML = '';
  for (const v of c.variants) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'key variant';
    b.setAttribute('role', 'radio');
    const on = state.variants[sheetDegree] === v;
    b.setAttribute('aria-checked', String(on));
    b.dataset.variant = v;
    const notes = chordNotes(c.root, v).map(pretty).join(' ');
    b.innerHTML = `<span class="name">${pretty(chordName(c.root, v))}</span><span class="notes">${notes}</span>`;
    b.setAttribute('aria-label', `${pretty(chordName(c.root, v))}, ${VARIANTS[v].label}: ${notes}`);
    variantsEl.append(b);
  }
}

variantsEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-variant]');
  if (!b) return;
  state.variants[sheetDegree] = b.dataset.variant;
  renderLoop();
  state.selected = sheetDegree;
  renderVariants();
  renderPalette();
  preview(sheetDegree);
  variantsEl.querySelector(`[data-variant="${b.dataset.variant}"]`).focus();
});

$('#sheet-done').addEventListener('click', () => sheet.close());
sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); }); // backdrop tap
sheet.addEventListener('close', () => {
  const b = paletteEl.querySelector(`[data-degree="${sheetDegree}"]`);
  if (b) b.focus();
});

/* ---------- Sound controls ---------- */

const synthsEl = $('#synths');

function renderSynths() {
  synthsEl.innerHTML = '';
  for (const id of SYNTH_IDS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'key synth';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(id === state.synth));
    b.tabIndex = id === state.synth ? 0 : -1;
    b.dataset.synth = id;
    b.textContent = SYNTHS[id].label;
    synthsEl.append(b);
  }
}

function setSynth(id) {
  state.synth = id;
  renderSynths();
  synthsEl.querySelector(`[data-synth="${id}"]`).focus();
  if (!playing) preview(state.selected ?? 0);
}

synthsEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-synth]');
  if (b) setSynth(b.dataset.synth);
});
synthsEl.addEventListener('keydown', (e) => {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (step === undefined) return;
  e.preventDefault();
  const i = SYNTH_IDS.indexOf(state.synth);
  setSynth(SYNTH_IDS[(i + step + SYNTH_IDS.length) % SYNTH_IDS.length]);
});

$('#tempo').addEventListener('input', (e) => {
  state.tempo = Number(e.target.value);
  $('#tempo-out').textContent = state.tempo;
});
$('#reverb').addEventListener('input', (e) => {
  state.reverb = Number(e.target.value) / 100;
  $('#reverb-out').textContent = `${e.target.value}%`;
  setReverbMix(state.reverb);
});
$('#bass').addEventListener('change', (e) => { state.bass = e.target.checked; });

/* ---------- Drums ---------- */

// Small helper for a row of radio-style tactile buttons with arrow-key support.
function radioRow(el, items, getValue, onPick) {
  function render() {
    el.innerHTML = '';
    for (const { id, label } of items()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'key opt';
      b.setAttribute('role', 'radio');
      const on = id === getValue();
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      b.dataset.id = id;
      b.textContent = label;
      el.append(b);
    }
  }
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (b) { onPick(b.dataset.id); render(); el.querySelector(`[data-id="${b.dataset.id}"]`).focus(); }
  });
  el.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const ids = items().map((i) => i.id);
    const next = ids[(ids.indexOf(getValue()) + step + ids.length) % ids.length];
    onPick(next);
    render();
    el.querySelector(`[data-id="${next}"]`).focus();
  });
  render();
  return render;
}

// Play one bar of the current pattern when nothing is running, so picks are audible.
function auditionDrums() {
  audio();
  if (playing || state.kit === 'none') return;
  const stepDur = 60 / state.tempo / 4;
  const t0 = ctx.currentTime + 0.03;
  for (let s = 0; s < 16; s++) scheduleDrums(previewDrums, s, t0 + s * stepDur, stepDur);
}

const patternsEl = $('#patterns');
radioRow($('#kits'),
  () => [{ id: 'none', label: 'None' }, ...KIT_IDS.map((id) => ({ id, label: KITS[id].label }))],
  () => state.kit,
  (id) => {
    state.kit = id;
    patternsEl.classList.toggle('off', id === 'none');
    patternsEl.querySelectorAll('button').forEach((b) => { b.disabled = id === 'none'; });
    auditionDrums();
  });
radioRow(patternsEl,
  () => PATTERN_IDS.map((id) => ({ id, label: PATTERN_LABELS[id] })),
  () => state.pattern,
  (id) => { state.pattern = id; auditionDrums(); });
$('#swing').addEventListener('input', (e) => {
  state.swing = Number(e.target.value) / 100;
  $('#swing-out').textContent = `${e.target.value}%`;
});

/* ---------- Test loop transport ---------- */

const stripEl = $('#strip');
const playBtn = $('#play');
let playing = false;
let loopVoicings = null;
let loopSignature = '';

function renderLoop() {
  stripEl.querySelectorAll('.slot').forEach((el) => el.remove());
  state.loop.forEach((d, i) => {
    const el = document.createElement('div');
    el.className = 'slot';
    el.dataset.bar = i;
    el.textContent = pretty(chordLabel(d));
    stripEl.append(el);
  });
}

function voicingsForLoop() {
  const sig = state.loop.map((d) => `${state.keyPc}${state.mode}${d}${state.variants[d]}`).join('|');
  if (sig !== loopSignature) {
    loopSignature = sig;
    loopVoicings = voiceProgression(state.loop.map(pcsFor));
  }
  return loopVoicings;
}

// Swing delays every off-beat 16th. 0 = straight, 1 = full triplet-ish shuffle.
function swingOffset(s, stepDur) {
  return s % 2 === 1 ? state.swing * stepDur * 0.5 : 0;
}

function scheduleDrums(target, s, t, stepDur) {
  if (state.kit === 'none') return;
  const kit = KITS[state.kit];
  for (const { lane, velocity } of hitsAt(state.kit, state.pattern, s)) {
    let when = t + swingOffset(s, stepDur);
    let vel = velocity;
    if (kit.feel) {
      // Garage looseness: hats lean further behind the beat, everything drifts a little.
      if ((lane === 'hat' || lane === 'open') && s % 2 === 1) when += kit.feel.swing * stepDur;
      when += (Math.random() * 2 - 1) * kit.feel.jitter;
      vel *= 1 - Math.random() * kit.feel.velocity;
    }
    target.hit(state.kit, lane, when, vel);
  }
}

function onStep(step, t, stepDur) {
  const bar = Math.floor(step / 16) % state.loop.length;
  const s = step % 16;
  const degree = state.loop[bar];
  const notes = voicingsForLoop()[bar];
  const ts = t + swingOffset(s, stepDur);
  for (const [at, len] of SYNTHS[state.synth].rhythm) {
    if (at === s) take.chord(state.synth, notes, ts, len * stepDur);
  }
  if (state.bass) {
    for (const [at, len] of BASS.rhythm) {
      if (at === s) take.bass(bassMidi(chords[degree].rootPc), ts, len * stepDur);
    }
  }
  scheduleDrums(drumTake, s, t, stepDur);
}

function drawPlayhead() {
  if (!playing) return;
  const step = scheduler.currentStep();
  if (step !== null) {
    const total = state.loop.length * 16;
    stripEl.style.setProperty('--pos', String(step / total));
    const bar = Math.floor(step / 16);
    stripEl.querySelectorAll('.slot').forEach((el) => el.classList.toggle('on', Number(el.dataset.bar) === bar));
  }
  requestAnimationFrame(drawPlayhead);
}

function setPlaying(on) {
  audio();
  if (on === playing) return;
  playing = on;
  playBtn.setAttribute('aria-pressed', String(on));
  playBtn.textContent = on ? '■ Stop' : '▶ Play';
  stripEl.classList.toggle('playing', on);
  if (on) {
    take = rack.createTake();
    drumTake = drumRack.createTake();
    scheduler.start(0);
    requestAnimationFrame(drawPlayhead);
  } else {
    scheduler.stop();
    take.stop();
    drumTake.stop();
    take = null;
    drumTake = null;
    stripEl.querySelectorAll('.slot').forEach((el) => el.classList.remove('on'));
  }
}

playBtn.addEventListener('click', () => setPlaying(!playing));
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target === document.body) {
    e.preventDefault();
    setPlaying(!playing);
  }
});

/* ---------- Boot ---------- */

resetVariants();
renderKeys();
renderPalette();
renderSynths();
renderLoop();
