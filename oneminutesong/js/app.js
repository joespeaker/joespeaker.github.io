import {
  KEY_NAMES, diatonicChords, chordName, chordNotes, chordIntervals, pretty, VARIANTS, keyName,
} from './theory.js';
import { voiceChord, voiceProgression } from './voicing.js';
import { ensureAudio, dryBus, setReverbMix } from './audio/engine.js';
import { SYNTHS, SYNTH_IDS, BASS, bassMidi, createSynthRack } from './audio/synths.js';
import { Scheduler } from './audio/scheduler.js';
import { KITS, KIT_IDS, PATTERN_IDS, PATTERN_LABELS, hitsAt, createDrumRack } from './audio/drums.js';
import { REELS, loadPrompts, listFor, pickOther, promptSentence, titleFromTopic } from './roulette.js';

const state = {
  keyPc: 0,
  mode: 'major',
  variants: [],   // chosen variant id per scale degree
  selected: null, // palette degree waiting to be placed with a tap
  synth: 'ep',
  tempo: 100,
  reverb: 0.3,
  bass: true,
  kit: 'acoustic',    // or 'none'
  pattern: 'basic',
  swing: 0.15,
  barCount: 4,
  bars: Array(8).fill(null), // each bar: { degree, variant } or null. Bars 5-8 kept when switching to 4.
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

function pcsFor(degree, variant = state.variants[degree]) {
  const c = chords[degree];
  return chordIntervals(variant).map((i) => (c.rootPc + i) % 12);
}

// Placed bars keep their scale degree when the key changes, so the progression transposes.
// A variant that doesn't fit the new chord quality (e.g. maj7 on a now-minor chord) resets.
function fitBarsToKey() {
  state.bars = state.bars.map((b) => {
    if (!b) return null;
    const c = chords[b.degree];
    return { degree: b.degree, variant: c.variants.includes(b.variant) ? b.variant : c.defaultVariant };
  });
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
      getTotalSteps: () => state.barCount * 16,
    });
  } else {
    ensureAudio();
  }
}

function preview(degree, variant) {
  audio();
  const notes = voiceChord(pcsFor(degree, variant), lastPreview);
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
  fitBarsToKey();
  renderKeys();
  renderPalette();
  renderTimeline();
  keysEl.querySelector(`[data-pc="${pc}"]`).focus();
}

function setMode(mode) {
  state.mode = mode;
  resetVariants();
  fitBarsToKey();
  renderKeys();
  renderPalette();
  renderTimeline();
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
  state.selected = state.selected === degree ? null : degree;
  picked = null;
  renderTimeline();
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
  const degree = Number(b.dataset.degree);
  beginPress(e, { from: 'palette', degree, label: pretty(chordLabel(degree)) });
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
  if (justDragged()) return;
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
  state.selected = sheetDegree;
  renderVariants();
  renderPalette();
  preview(sheetDegree);
  variantsEl.querySelector(`[data-variant="${b.dataset.variant}"]`).focus();
});

$('#sheet-done').addEventListener('click', () => sheet.close());
// Backdrop tap closes the sheet, but only when the press also started on the backdrop.
// Otherwise lifting the finger after a long-press would land on the backdrop and close it.
let backdropPress = false;
sheet.addEventListener('pointerdown', (e) => { backdropPress = e.target === sheet; });
sheet.addEventListener('click', (e) => {
  if (e.target === sheet && backdropPress) sheet.close();
  backdropPress = false;
});
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

/* ---------- Timeline ---------- */

const timelineEl = $('#timeline');
const hintEl = $('#timeline-hint');
const announceEl = $('#announce');
const playBtn = $('#play');
let playing = false;
let picked = null;       // bar index picked up by a tap, waiting for a second tap to swap
let focusBar = 0;
let timelineVoicings = null;
let timelineSignature = '';

function slotName(b) {
  return pretty(chordName(chords[b.degree].root, b.variant));
}

function announce(msg) {
  announceEl.textContent = msg;
}

function renderTimeline() {
  timelineEl.innerHTML = '';
  timelineEl.classList.toggle('eight', state.barCount === 8);
  for (let i = 0; i < state.barCount; i++) {
    const b = state.bars[i];
    const wrap = document.createElement('div');
    wrap.className = 'bar-wrap';

    const slot = document.createElement('button');
    slot.type = 'button';
    slot.className = 'key bar';
    slot.dataset.slot = i;
    slot.tabIndex = i === focusBar ? 0 : -1;
    slot.classList.toggle('empty', !b);
    slot.classList.toggle('picked', picked === i);
    slot.classList.toggle('target', state.selected !== null);
    const label = b ? slotName(b) : 'empty';
    slot.setAttribute('aria-label', `Bar ${i + 1}: ${label}`);
    slot.innerHTML = `<span class="num">${i + 1}</span>`
      + (b ? `<span class="name">${label}</span><span class="roman">${chords[b.degree].roman}</span>` : '<span class="plus" aria-hidden="true">+</span>')
      + '<span class="prog" aria-hidden="true"></span>';
    wrap.append(slot);

    if (b) {
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'x';
      x.dataset.remove = i;
      x.tabIndex = -1;
      x.setAttribute('aria-label', `Remove ${label} from bar ${i + 1}`);
      x.textContent = '×';
      wrap.append(x);
    }
    timelineEl.append(wrap);
  }

  if (state.selected !== null) {
    hintEl.textContent = `Tap a bar to place ${pretty(chordLabel(state.selected))}.`;
  } else if (picked !== null) {
    hintEl.textContent = 'Tap another bar to swap, or drag it off the timeline to remove.';
  } else {
    hintEl.textContent = 'Tap a chord, then tap a bar. Or drag it in.';
  }
  for (const b of barsToggle.querySelectorAll('button')) {
    b.setAttribute('aria-checked', String(Number(b.dataset.bars) === state.barCount));
  }
}

function focusSlot(i) {
  focusBar = i;
  const el = timelineEl.querySelector(`[data-slot="${i}"]`);
  if (el) { timelineEl.querySelectorAll('[data-slot]').forEach((s) => { s.tabIndex = -1; }); el.tabIndex = 0; el.focus(); }
}

function place(i, degree) {
  const variant = state.variants[degree];
  state.bars[i] = { degree, variant };
  state.selected = null;
  picked = null;
  renderPalette();
  renderTimeline();
  preview(degree, variant);
  announce(`Placed ${slotName(state.bars[i])} in bar ${i + 1}.`);
}

function swap(i, j) {
  [state.bars[i], state.bars[j]] = [state.bars[j], state.bars[i]];
  picked = null;
  renderTimeline();
  announce(`Swapped bars ${i + 1} and ${j + 1}.`);
}

function removeBar(i) {
  const b = state.bars[i];
  if (!b) return;
  state.bars[i] = null;
  if (picked === i) picked = null;
  renderTimeline();
  announce(`Removed ${slotName(b)} from bar ${i + 1}.`);
}

function tapSlot(i) {
  const b = state.bars[i];
  if (state.selected !== null) { place(i, state.selected); return; }
  if (picked === null) {
    if (b) { picked = i; preview(b.degree, b.variant); announce(`Picked up ${slotName(b)} from bar ${i + 1}.`); }
    else { hintEl.classList.remove('nudge'); void hintEl.offsetWidth; hintEl.classList.add('nudge'); }
  } else if (picked === i) {
    picked = null;
  } else {
    swap(picked, i);
    return;
  }
  renderTimeline();
}

timelineEl.addEventListener('click', (e) => {
  const x = e.target.closest('[data-remove]');
  if (x) { removeBar(Number(x.dataset.remove)); return; }
  const slot = e.target.closest('[data-slot]');
  if (!slot || justDragged()) return;
  focusBar = Number(slot.dataset.slot);
  tapSlot(focusBar);
  focusSlot(focusBar);
});

timelineEl.addEventListener('pointerdown', (e) => {
  const slot = e.target.closest('[data-slot]');
  if (!slot) return;
  const i = Number(slot.dataset.slot);
  if (state.bars[i]) beginPress(e, { from: 'slot', index: i, label: slotName(state.bars[i]) });
});

timelineEl.addEventListener('keydown', (e) => {
  const slot = e.target.closest('[data-slot]');
  if (!slot) return;
  const i = Number(slot.dataset.slot);
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 4, ArrowUp: -4 }[e.key];
  if (step !== undefined) {
    e.preventDefault();
    focusSlot(Math.min(state.barCount - 1, Math.max(0, i + step)));
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    removeBar(i);
    focusSlot(i);
  } else if (e.key === 'Escape') {
    picked = null;
    state.selected = null;
    renderPalette();
    renderTimeline();
    focusSlot(i);
  }
});

const barsToggle = $('#bars-toggle');
barsToggle.addEventListener('click', (e) => {
  const b = e.target.closest('[data-bars]');
  if (!b) return;
  state.barCount = Number(b.dataset.bars);
  focusBar = Math.min(focusBar, state.barCount - 1);
  if (picked !== null && picked >= state.barCount) picked = null;
  renderTimeline();
});
$('#clear').addEventListener('click', () => {
  state.bars = Array(8).fill(null);
  picked = null;
  renderTimeline();
  announce('Cleared the timeline.');
});

/* ---------- Drag and drop (pointer events, works for mouse, touch and pen) ---------- */

let press = null;
let dragGhost = null;
let suppressClickUntil = 0;
const DRAG_THRESHOLD = 8;

function justDragged() {
  return performance.now() < suppressClickUntil;
}

function beginPress(e, payload) {
  press = { ...payload, pointerId: e.pointerId, x: e.clientX, y: e.clientY, active: false };
}

function slotUnder(x, y) {
  const el = document.elementFromPoint(x, y);
  return el ? el.closest('[data-slot]') : null;
}

function endDrag() {
  if (dragGhost) dragGhost.remove();
  dragGhost = null;
  document.body.classList.remove('dragging');
  timelineEl.querySelectorAll('.over').forEach((el) => el.classList.remove('over'));
  press = null;
}

document.addEventListener('pointermove', (e) => {
  if (!press || e.pointerId !== press.pointerId) return;
  if (!press.active) {
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_THRESHOLD) return;
    press.active = true;
    clearTimeout(pressTimer); // a drag is not a long-press
    dragGhost = document.createElement('div');
    dragGhost.className = 'ghost';
    dragGhost.textContent = press.label;
    dragGhost.setAttribute('aria-hidden', 'true');
    document.body.append(dragGhost);
    document.body.classList.add('dragging');
  }
  e.preventDefault();
  dragGhost.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -120%)`;
  const over = slotUnder(e.clientX, e.clientY);
  timelineEl.querySelectorAll('.over').forEach((el) => { if (el !== over) el.classList.remove('over'); });
  if (over) over.classList.add('over');
}, { passive: false });

document.addEventListener('pointerup', (e) => {
  if (!press || e.pointerId !== press.pointerId) return;
  if (press.active) {
    suppressClickUntil = performance.now() + 400;
    const target = slotUnder(e.clientX, e.clientY);
    const j = target ? Number(target.dataset.slot) : null;
    if (press.from === 'palette' && j !== null) {
      place(j, press.degree);
    } else if (press.from === 'slot') {
      const overTimeline = document.elementFromPoint(e.clientX, e.clientY)?.closest('#timeline');
      if (j !== null && j !== press.index) {
        // Drop on an empty bar = move; on a full bar = swap.
        swap(press.index, j);
      } else if (!overTimeline) {
        removeBar(press.index);
      }
    }
  }
  endDrag();
});
document.addEventListener('pointercancel', endDrag);

/* ---------- Playback ---------- */

function voicingsForTimeline() {
  const bars = state.bars.slice(0, state.barCount);
  const sig = `${state.keyPc}${state.mode}|` + bars.map((b) => (b ? `${b.degree}${b.variant}` : '-')).join('|');
  if (sig !== timelineSignature) {
    timelineSignature = sig;
    timelineVoicings = voiceProgression(bars.map((b) => (b ? pcsFor(b.degree, b.variant) : null)));
  }
  return timelineVoicings;
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
  const bar = Math.floor(step / 16) % state.barCount;
  const s = step % 16;
  const b = state.bars[bar];
  const ts = t + swingOffset(s, stepDur);
  if (b) {
    const notes = voicingsForTimeline()[bar];
    for (const [at, len] of SYNTHS[state.synth].rhythm) {
      if (at === s) take.chord(state.synth, notes, ts, len * stepDur);
    }
    if (state.bass) {
      for (const [at, len] of BASS.rhythm) {
        if (at === s) take.bass(bassMidi(chords[b.degree].rootPc), ts, len * stepDur);
      }
    }
  }
  scheduleDrums(drumTake, s, t, stepDur);
}

function clearPlayhead() {
  timelineEl.querySelectorAll('.on').forEach((el) => el.classList.remove('on'));
}

function drawPlayhead() {
  if (!playing) return;
  const step = scheduler.currentStep();
  if (step !== null) {
    const bar = Math.floor(step / 16) % state.barCount;
    timelineEl.querySelectorAll('[data-slot]').forEach((el) => {
      const on = Number(el.dataset.slot) === bar;
      el.classList.toggle('on', on);
      if (on) el.style.setProperty('--p', String((step % 16) / 16));
    });
  }
  requestAnimationFrame(drawPlayhead);
}

// Start the transport. With once: true it plays the timeline a single time, then calls onEnd.
function startTransport({ once = false, onEnd = null } = {}) {
  audio();
  if (playing) stopTransport();
  playing = true;
  playBtn.setAttribute('aria-pressed', 'true');
  playBtn.textContent = '■ Stop';
  take = rack.createTake();
  drumTake = drumRack.createTake();
  const opts = {};
  if (once) {
    opts.maxSteps = state.barCount * 16;
    opts.onDone = (endTime) => {
      // Let the last notes ring a moment before wrapping up.
      onceTimer = setTimeout(() => { stopTransport(); if (onEnd) onEnd(); }, (endTime - ctx.currentTime + 0.9) * 1000);
    };
  }
  scheduler.start(0, opts);
  requestAnimationFrame(drawPlayhead);
  updateReplayButton();
}

let onceTimer = null;

function stopTransport() {
  clearTimeout(onceTimer);
  if (!playing) return;
  playing = false;
  playBtn.setAttribute('aria-pressed', 'false');
  playBtn.textContent = '▶ Play';
  scheduler.stop();
  take.stop();
  drumTake.stop();
  take = null;
  drumTake = null;
  clearPlayhead();
  updateReplayButton();
}

function setPlaying(on) {
  if (on) startTransport(); else stopTransport();
}

playBtn.addEventListener('click', () => setPlaying(!playing));
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target === document.body && !screens.studio.hidden && !studioEl.inert) {
    e.preventDefault();
    setPlaying(!playing);
  }
});

/* ---------- Flow: spin -> studio (60s clock) -> result ---------- */

// ?clock=5 shortens the countdown for testing.
const CLOCK_SECONDS = Math.max(1, Number(new URLSearchParams(location.search).get('clock')) || 60);
const CLOCK_CIRC = 2 * Math.PI * 19;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const flow = {
  prompts: null,
  values: { topic: null, style: null, constraint: null },
  locked: { topic: false, style: false, constraint: false },
  constraintOn: true,
  spinning: 0,
  untimed: false,
  timerEnd: 0,
  timerRaf: 0,
  lastAnnounced: null,
  titleEdited: false,
  fresh: true,     // on the spin screen waiting for a Spin (first visit or after "Spin again")
};

try { flow.untimed = localStorage.getItem('oms-untimed') === '1'; } catch { /* storage blocked */ }

const screens = { spin: $('#screen-spin'), studio: $('#screen-studio'), result: $('#screen-result') };
const studioEl = $('#studio');
const clockEl = $('#clock');
const clockFill = $('#clock-fill');
const clockText = $('#clock-text');
const timeUpEl = $('#time-up');
const untimedEl = $('#untimed');
untimedEl.checked = flow.untimed;

function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
  window.scrollTo(0, 0);
}

const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function promptHTML() {
  const { topic, style } = flow.values;
  return `Write a song about <b>${esc(topic)}</b> in the style of <b>${esc(style)}</b>.`;
}

function constraintText() {
  return flow.constraintOn && flow.values.constraint ? `Constraint: ${flow.values.constraint}.` : '';
}

function renderPrompt() {
  const ready = flow.values.topic && flow.values.style;
  $('#prompt-card').hidden = !ready;
  if (ready) {
    $('#prompt-line').innerHTML = promptHTML();
    $('#constraint-line').textContent = constraintText();
  }
  const spun = ready && flow.spinning === 0 && !flow.fresh;
  $('#spin').disabled = flow.spinning > 0 || !flow.prompts;
  $('#spin').hidden = spun;
  $('#start').hidden = !spun;
  $('#respin').hidden = !spun;
  $('#start').textContent = flow.untimed ? 'Start making' : 'Start the clock';
  for (const r of REELS) {
    const reel = document.querySelector(`[data-reel="${r}"]`);
    reel.classList.toggle('locked', flow.locked[r]);
    const lock = reel.querySelector('[data-lock]');
    lock.setAttribute('aria-pressed', String(flow.locked[r]));
    lock.setAttribute('aria-label', `${flow.locked[r] ? 'Unlock' : 'Lock'} ${r}`);
  }
  const cReel = document.querySelector('[data-reel="constraint"]');
  cReel.classList.toggle('off', !flow.constraintOn);
  if (!flow.constraintOn) $('#constraint-text').textContent = 'No constraint';
  else if (flow.values.constraint && !cReel.classList.contains('spinning')) $('#constraint-text').textContent = flow.values.constraint;
}

function tick() {
  // A tiny closed-hat click per reel step, like a mechanical counter.
  if (previewDrums && ctx) previewDrums.hit('electro', 'hat', ctx.currentTime + 0.005, 0.18);
}

// Spin one reel: flick through entries, slowing down, then land on a fresh pick.
function spinReel(r, duration) {
  const list = listFor(flow.prompts, r);
  const textEl = $(`#${r}-text`);
  const reel = document.querySelector(`[data-reel="${r}"]`);
  const final = pickOther(list, flow.values[r]);
  flow.spinning++;
  renderPrompt();
  return new Promise((resolve) => {
    const finish = () => {
      flow.values[r] = final;
      textEl.textContent = final;
      reel.classList.remove('spinning');
      reel.classList.remove('landed');
      void reel.offsetWidth;
      reel.classList.add('landed');
      flow.spinning--;
      renderPrompt();
      resolve();
    };
    if (reduceMotion.matches) { finish(); return; }
    reel.classList.add('spinning');
    const start = performance.now();
    let delay = 45;
    const step = () => {
      if (performance.now() - start >= duration) { finish(); return; }
      textEl.textContent = list[Math.floor(Math.random() * list.length)];
      tick();
      delay *= 1.13;
      setTimeout(step, delay);
    };
    step();
  });
}

async function spinAll() {
  if (flow.spinning || !flow.prompts) return;
  audio();
  flow.fresh = false;
  const jobs = [];
  let i = 0;
  for (const r of REELS) {
    if (flow.locked[r] && flow.values[r]) continue;
    if (r === 'constraint' && !flow.constraintOn) continue;
    jobs.push(spinReel(r, 700 + i * 350));
    i++;
  }
  await Promise.all(jobs);
  announce(`${promptSentence(flow.values)} ${constraintText()}`);
  $('#start').focus();
}

$('#spin').addEventListener('click', spinAll);
$('#respin').addEventListener('click', spinAll);

$('#screen-spin').addEventListener('click', async (e) => {
  const lock = e.target.closest('[data-lock]');
  if (lock) {
    const r = lock.dataset.lock;
    flow.locked[r] = !flow.locked[r];
    renderPrompt();
    return;
  }
  const win = e.target.closest('[data-reroll]');
  if (!win || flow.spinning || !flow.prompts) return;
  const r = win.dataset.reroll;
  if (flow.locked[r] || (r === 'constraint' && !flow.constraintOn)) return;
  audio();
  if (flow.values.topic && flow.values.style) flow.fresh = false;
  await spinReel(r, 650);
  if (flow.values.topic && flow.values.style) { flow.fresh = false; renderPrompt(); }
  announce(r === 'constraint' ? constraintText() : promptSentence(flow.values));
});

$('#constraint-on').addEventListener('change', (e) => {
  flow.constraintOn = e.target.checked;
  if (flow.constraintOn && !flow.values.constraint && flow.prompts) {
    flow.values.constraint = pickOther(listFor(flow.prompts, 'constraint'), null);
  }
  renderPrompt();
});

/* Studio + clock */

function resetSong() {
  stopTransport();
  state.bars = Array(8).fill(null);
  state.selected = null;
  picked = null;
  renderPalette();
  renderTimeline();
  flow.titleEdited = false;
}

function lockStudio(on) {
  studioEl.inert = on;
  studioEl.classList.toggle('locked', on);
  $('#finish').disabled = on;
}

function startStudio() {
  audio();
  resetSong();
  lockStudio(false);
  $('#studio-prompt').innerHTML = promptHTML() + (constraintText() ? `<br>${esc(constraintText())}` : '');
  showScreen('studio');
  if (flow.untimed) showUntimedClock();
  else startClock();
}

function showUntimedClock() {
  stopClock();
  clockEl.classList.remove('urgent');
  clockEl.classList.add('untimed');
  clockEl.setAttribute('aria-label', 'Untimed');
  clockFill.style.strokeDashoffset = '0';
  clockText.textContent = '∞';
}

function startClock() {
  clockEl.classList.remove('untimed', 'urgent');
  flow.timerEnd = performance.now() + CLOCK_SECONDS * 1000;
  flow.lastAnnounced = null;
  announce(`Clock started. ${CLOCK_SECONDS} seconds.`);
  const frame = () => {
    const left = Math.max(0, (flow.timerEnd - performance.now()) / 1000);
    const secs = Math.ceil(left);
    clockText.textContent = String(secs);
    clockFill.style.strokeDashoffset = String(CLOCK_CIRC * (1 - left / CLOCK_SECONDS));
    clockEl.classList.toggle('urgent', left <= 10);
    clockEl.setAttribute('aria-label', `${secs} seconds left`);
    if ([30, 10, 5].includes(secs) && flow.lastAnnounced !== secs) {
      flow.lastAnnounced = secs;
      announce(`${secs} seconds left.`);
    }
    if (left <= 0) { timeUp(); return; }
    flow.timerRaf = requestAnimationFrame(frame);
  };
  flow.timerRaf = requestAnimationFrame(frame);
}

function stopClock() {
  cancelAnimationFrame(flow.timerRaf);
  flow.timerRaf = 0;
}

function songIsEmpty() {
  return state.bars.slice(0, state.barCount).every((b) => !b) && state.kit === 'none';
}

// 0:00 (or Finish): lock the studio, play the loop once through, then show the result.
function timeUp() {
  stopClock();
  clockEl.classList.remove('urgent');
  clockText.textContent = '0';
  stopTransport();
  lockStudio(true);
  if (sheet.open) sheet.close();
  if (songIsEmpty()) { goResult(); return; }
  announce("Time's up. Playing your song.");
  timeUpEl.hidden = false;
  timelineEl.scrollIntoView({ block: 'center', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  startTransport({ once: true, onEnd: goResult });
}

$('#skip').addEventListener('click', () => { stopTransport(); goResult(); });
$('#finish').addEventListener('click', timeUp);

/* Result */

const titleEl = $('#title');
const replayBtn = $('#replay');

function updateReplayButton() {
  if (screens.result.hidden) return;
  replayBtn.textContent = playing ? '■ Stop' : '▶ Play it';
}

function goResult() {
  timeUpEl.hidden = true;
  lockStudio(false);
  if (!flow.titleEdited) titleEl.value = titleFromTopic(flow.values.topic || 'untitled');
  $('#result-prompt').textContent = `${promptSentence(flow.values)} ${constraintText()}`.trim();
  const bars = state.bars.slice(0, state.barCount).map((b) => (b ? slotName(b) : '–')).join('  ');
  const specs = [
    ['Key', `${pretty(keyName(state.keyPc, state.mode))} ${state.mode}`],
    ['Chords', bars],
    ['Tempo', `${state.tempo} BPM`],
    ['Sound', SYNTHS[state.synth].label],
    ['Drums', state.kit === 'none' ? 'None' : `${KITS[state.kit].label}, ${PATTERN_LABELS[state.pattern].toLowerCase()}`],
  ];
  $('#result-specs').innerHTML = specs.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
  showScreen('result');
  updateReplayButton();
  titleEl.focus({ preventScroll: true });
}

titleEl.addEventListener('input', () => { flow.titleEdited = true; });
replayBtn.addEventListener('click', () => {
  if (playing) stopTransport();
  else startTransport({ once: true });
});
$('#tinker').addEventListener('click', () => {
  stopTransport();
  showScreen('studio');
  showUntimedClock();
});
$('#again').addEventListener('click', () => {
  stopTransport();
  showScreen('spin');
  flow.fresh = true;
  renderPrompt();
  $('#spin').focus();
});

$('#start').addEventListener('click', startStudio);

untimedEl.addEventListener('change', () => {
  flow.untimed = untimedEl.checked;
  try { localStorage.setItem('oms-untimed', flow.untimed ? '1' : '0'); } catch { /* storage blocked */ }
  // Switching on mid-run stops the clock; switching off applies to the next run.
  if (flow.untimed && flow.timerRaf) showUntimedClock();
  renderPrompt();
});

/* ---------- Boot ---------- */

resetVariants();
renderKeys();
renderPalette();
renderSynths();
renderTimeline();
renderPrompt();
loadPrompts().then((p) => {
  flow.prompts = p;
  renderPrompt();
});
