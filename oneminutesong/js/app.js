import {
  KEY_NAMES, diatonicChords, chordName, chordNotes, chordIntervals, pretty, VARIANTS, keyName,
} from './theory.js';
import { playChord } from './preview.js';

const state = {
  keyPc: 0,
  mode: 'major',
  variants: [],   // chosen variant id per scale degree
  selected: null, // selected degree (used for tap-to-place in stage 4)
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

// Close voicing with the root in octave 3 (C3 = MIDI 48). Stage 2 adds voice leading.
function midiFor(degree) {
  const c = chords[degree];
  const root = 48 + c.rootPc;
  return chordIntervals(state.variants[degree]).map((i) => root + i);
}

function preview(degree) {
  playChord(midiFor(degree));
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
  keysEl.querySelector(`[data-pc="${pc}"]`).focus();
}

function setMode(mode) {
  state.mode = mode;
  resetVariants();
  renderKeys();
  renderPalette();
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

/* ---------- Boot ---------- */

resetVariants();
renderKeys();
renderPalette();
