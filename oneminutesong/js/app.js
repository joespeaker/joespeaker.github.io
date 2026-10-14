import {
  KEY_NAMES, diatonicChords, chordName, chordNotes, pretty, VARIANTS, keyName,
} from './theory.js';
import { voiceChord } from './voicing.js';
import { ensureAudio, dryBus, setReverbMix, buildMaster } from './audio/engine.js';
import {
  INSTRUMENTS, CHORD_INSTRUMENTS, MELODY_INSTRUMENTS, BASS_INSTRUMENTS, loadInstrument, isLoaded,
} from './audio/instruments.js';
import { KITS, KIT_IDS, PATTERN_IDS, PATTERN_LABELS, loadDrums } from './audio/drums.js';
import { createMixer } from './audio/mixer.js';
import { Scheduler } from './audio/scheduler.js';
import {
  newSong, totalSteps, TRACK_IDS, CHORD_STYLES, placeBlock, findBlock,
  setBlockChord, removeBlock, removeNote, fillDrums, setBars, changeKey, freezeBass, fromV1,
} from './song.js';
import { compile } from './compile.js';
import { createEditor, ZOOM_STEPS } from './ui/editor.js';
import { REELS, loadPrompts, listFor, pickOther, promptSentence, titleFromTopic } from './roulette.js';
import { decodeSong, encodeSongV2, decodeSongV2 } from './share.js';
import { encodeWav } from './wav.js';

const $ = (sel) => document.querySelector(sel);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const announceEl = $('#announce');
const announce = (msg) => { announceEl.textContent = msg; };
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const coarse = window.matchMedia('(pointer: coarse)');

const TRACK_LABELS = { chords: 'Chords', melody: 'Melody', bass: 'Bass', drums: 'Drums' };
const TRACK_INSTRUMENTS = { chords: CHORD_INSTRUMENTS, melody: MELODY_INSTRUMENTS, bass: BASS_INSTRUMENTS };

function defaultSong() {
  const song = newSong();
  fillDrums(song, KITS.acoustic.patterns.basic);
  return song;
}

/* ---------- State, undo and autosave ---------- */

let song = defaultSong();
let compiled = compile(song);
let chords = diatonicChords(song.keyPc, song.mode);

const ui = {
  track: 'chords',
  selected: null,      // { type: 'block'|'note', id }
  paletteSel: null,    // palette degree waiting to be dropped with a tap
  paletteVariants: chords.map((c) => c.defaultVariant),
  snap: 2,
  zoom: coarse.matches ? 1 : 2,
  lastLen: 4,
};

const undoStack = [];
const redoStack = [];
const HISTORY = 100;

function begin() {
  undoStack.push(JSON.stringify(song));
  if (undoStack.length > HISTORY) undoStack.shift();
  redoStack.length = 0;
}

function changed() {
  compiled = compile(song);
  chords = diatonicChords(song.keyPc, song.mode);
  if (mixer) mixer.setLevels(song);
  renderStudio();
  scheduleSave();
}

function commit(label, fn) {
  begin();
  fn();
  changed();
}

function restore(json) {
  song = JSON.parse(json);
  ui.selected = null;
  changed();
  renderKeys();
  renderPalette();
  syncControls();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(song));
  restore(undoStack.pop());
  announce('Undone.');
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(song));
  restore(redoStack.pop());
  announce('Redone.');
}

const SAVE_KEY = 'oms-song';
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(song)); } catch { /* storage blocked */ }
  }, 400);
}

function savedSong() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && s.tracks && (s.tracks.chords.blocks.length || s.tracks.melody.notes.length)) return s;
  } catch { /* nothing saved */ }
  return null;
}

/* ---------- Audio ---------- */

let ctx = null;
let mixer = null;
let previewMixer = null;
let previewTake = null;
let scheduler = null;
let take = null;
let playing = false;
let onceTimer = null;

// Called from inside a tap/click/keypress so iOS lets audio start.
function audio() {
  if (!mixer) {
    ctx = ensureAudio();
    mixer = createMixer(ctx, dryBus());
    mixer.setLevels(song);
    // Previews skip mute/solo so you always hear what you tap.
    previewMixer = createMixer(ctx, dryBus());
    previewMixer.setLevels(newSong());
    previewTake = previewMixer.createTake();
    setReverbMix(song.reverb);
    scheduler = new Scheduler(ctx, {
      onStep,
      getTempo: () => song.tempo,
      getTotalSteps: () => compiled.total,
    });
  } else {
    ensureAudio();
  }
  loadSounds();
}

// Fetch the samples this song needs (each instrument once). Resolves when ready.
function loadSounds() {
  const t = song.tracks;
  return Promise.all([
    loadInstrument(ctx, t.chords.inst),
    t.melody.notes.length || ui.track === 'melody' ? loadInstrument(ctx, t.melody.inst) : null,
    loadInstrument(ctx, t.bass.inst),
    loadDrums(ctx),
  ]).catch(() => announce('Some sounds failed to load. Check your connection and try again.'));
}

function whenLoaded(inst, fn) {
  if (isLoaded(inst)) fn();
  else loadInstrument(ctx, inst).then(fn, () => {});
}

const preview = {
  note(track, midi) {
    audio();
    const inst = song.tracks[track].inst;
    whenLoaded(inst, () => previewTake.note(track, inst, midi, ctx.currentTime + 0.01, 0.6, 0.8));
  },
  chord(notes) {
    audio();
    const inst = song.tracks.chords.inst;
    whenLoaded(inst, () => previewTake.chord('chords', inst, notes, ctx.currentTime + 0.01, 1.1));
  },
  drum(lane, vel = 0.8) {
    audio();
    loadDrums(ctx).then(() => previewTake.drum(song.tracks.drums.kit, lane, ctx.currentTime + 0.01, vel), () => {});
  },
};

let lastPreview = null;
function previewDegree(degree, variant) {
  const c = chords[degree];
  const pcs = VARIANTS[variant].tones.map(([semi]) => (c.rootPc + semi) % 12);
  lastPreview = voiceChord(pcs, lastPreview);
  preview.chord(lastPreview);
}

// Swing delays every off-beat 16th. 0 = straight, 1 = full shuffle.
const swingOffset = (s, stepDur) => (s % 2 === 1 ? song.swing * stepDur * 0.5 : 0);

function playStep(target, step, t, stepDur) {
  for (const ev of compiled.steps[step] || []) {
    let when = t + swingOffset(step, stepDur);
    let vel = ev.vel;
    if (ev.track === 'drums') {
      const feel = KITS[ev.kit] && KITS[ev.kit].feel;
      if (feel) {
        // Garage looseness: hats lean further behind the beat, everything drifts a little.
        if ((ev.lane === 'hat' || ev.lane === 'open') && step % 2 === 1) when += feel.swing * stepDur;
        when += (Math.random() * 2 - 1) * feel.jitter;
        vel *= 1 - Math.random() * feel.velocity;
      }
    }
    target.play(vel === ev.vel ? ev : { ...ev, vel }, when, stepDur);
  }
}

function onStep(step, t, stepDur) {
  playStep(take, step, t, stepDur);
}

const playBtn = $('#play');
const posEl = $('#pos');

function startTransport({ once = false, onEnd = null } = {}) {
  audio();
  if (playing) stopTransport();
  playing = true;
  playBtn.setAttribute('aria-pressed', 'true');
  playBtn.textContent = '■ Stop';
  take = mixer.createTake();
  const opts = {};
  if (once) {
    opts.maxSteps = compiled.total;
    opts.onDone = (endTime) => {
      // Let the last notes ring a moment before wrapping up.
      onceTimer = setTimeout(() => { stopTransport(); if (onEnd) onEnd(); }, (endTime - ctx.currentTime + 0.9) * 1000);
    };
  }
  loadSounds().then(() => {
    if (!playing) return;
    scheduler.start(0, opts);
    requestAnimationFrame(drawPlayhead);
  });
  updateReplayButtons();
}

function stopTransport() {
  clearTimeout(onceTimer);
  if (!playing) return;
  playing = false;
  playBtn.setAttribute('aria-pressed', 'false');
  playBtn.textContent = '▶ Play';
  scheduler.stop();
  take.stop();
  take = null;
  editor.setPlayhead(null);
  posEl.textContent = '1.1';
  updateReplayButtons();
}

function drawPlayhead() {
  if (!playing) return;
  const step = scheduler.currentStep();
  const v = scheduler.lastVisual;
  if (step !== null && v) {
    const frac = Math.min(1, Math.max(0, (ctx.currentTime - v.time) / scheduler.stepDuration()));
    const pos = step + frac;
    editor.setPlayhead(pos);
    posEl.textContent = `${Math.floor(pos / 16) + 1}.${Math.floor((pos % 16) / 4) + 1}`;
  }
  requestAnimationFrame(drawPlayhead);
}

playBtn.addEventListener('click', () => (playing ? stopTransport() : startTransport()));

/* ---------- Key picker ---------- */

const keysEl = $('#keys');
const modeEl = $('#mode');

function renderKeys() {
  keysEl.innerHTML = '';
  KEY_NAMES[song.mode].forEach((name, pc) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'key';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(pc === song.keyPc));
    b.tabIndex = pc === song.keyPc ? 0 : -1;
    b.textContent = pretty(name);
    b.dataset.pc = pc;
    keysEl.append(b);
  });
  for (const b of modeEl.querySelectorAll('button')) {
    const on = b.dataset.mode === song.mode;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  $('#key-label').textContent = `${pretty(keyName(song.keyPc, song.mode))} ${song.mode}`;
}

function setKey(keyPc, mode) {
  commit('Change key', () => changeKey(song, keyPc, mode));
  ui.paletteVariants = chords.map((c) => c.defaultVariant);
  renderKeys();
  renderPalette();
}

keysEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-pc]');
  if (!b) return;
  setKey(Number(b.dataset.pc), song.mode);
  keysEl.querySelector(`[data-pc="${b.dataset.pc}"]`).focus();
});
keysEl.addEventListener('keydown', (e) => {
  const step = { ArrowRight: 1, ArrowDown: 6, ArrowLeft: -1, ArrowUp: -6 }[e.key];
  if (step === undefined) return;
  e.preventDefault();
  const pc = (song.keyPc + step + 12) % 12;
  setKey(pc, song.mode);
  keysEl.querySelector(`[data-pc="${pc}"]`).focus();
});
modeEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (b && b.dataset.mode !== song.mode) setKey(song.keyPc, b.dataset.mode);
});
modeEl.addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  setKey(song.keyPc, song.mode === 'major' ? 'minor' : 'major');
  modeEl.querySelector(`[data-mode="${song.mode}"]`).focus();
});

/* ---------- Chord palette ---------- */

const paletteEl = $('#palette');

function renderPalette() {
  paletteEl.innerHTML = '';
  chords.forEach((c, i) => {
    const v = ui.paletteVariants[i] || c.defaultVariant;
    const name = pretty(chordName(c.root, v));
    const notes = chordNotes(c.root, v).map(pretty).join(' ');
    const cell = document.createElement('div');
    cell.style.position = 'relative';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'key chord';
    b.classList.toggle('selected', ui.paletteSel === i);
    b.classList.toggle('changed', v !== c.defaultVariant);
    b.dataset.degree = i;
    b.tabIndex = (ui.paletteSel ?? 0) === i ? 0 : -1;
    b.setAttribute('aria-pressed', String(ui.paletteSel === i));
    b.setAttribute('aria-label', `${c.roman}, ${name}: ${notes}. Hold for variants, A to add.`);
    b.innerHTML = `<span class="roman">${c.roman}</span><span class="name">${name}</span><span class="notes">${notes}</span>`;
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'more';
    more.dataset.more = i;
    more.tabIndex = -1;
    more.setAttribute('aria-label', `Variants for ${name}`);
    more.textContent = '⋯';
    cell.append(b, more);
    paletteEl.append(cell);
  });
}

function selectPaletteChord(degree) {
  ui.paletteSel = ui.paletteSel === degree ? null : degree;
  renderPalette();
  renderHint();
  paletteEl.querySelector(`[data-degree="${degree}"]`).focus();
  previewDegree(degree, ui.paletteVariants[degree]);
}

// Drop a palette chord at a step. Returns false if no chord is selected.
function placePaletteChord(step, degree = ui.paletteSel) {
  if (degree === null || degree === undefined) return false;
  let block = null;
  commit('Add chord', () => { block = placeBlock(song, { s: step, d: degree, v: ui.paletteVariants[degree] }); });
  ui.selected = { type: 'block', id: block.id };
  changed();
  const v = compiled.voicings.get(block.id);
  if (v) preview.chord(v);
  announce(`Placed ${pretty(chordName(chords[degree].root, block.v))} at bar ${Math.floor(step / 16) + 1}, beat ${Math.floor((step % 16) / 4) + 1}.`);
  return true;
}

// Tap = select + preview, long-press = variants, drag = carry the chord to the lane.
let pressTimer = null;
let longPressed = false;
let press = null;
let ghost = null;
let suppressClickUntil = 0;

paletteEl.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('[data-degree]');
  if (!b) return;
  const degree = Number(b.dataset.degree);
  press = { degree, pointerId: e.pointerId, x: e.clientX, y: e.clientY, active: false };
  longPressed = false;
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => { longPressed = true; press = null; openVariants({ degree }); }, 450);
});
paletteEl.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('pointermove', (e) => {
  if (!press || e.pointerId !== press.pointerId) return;
  if (!press.active) {
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < 8) return;
    press.active = true;
    clearTimeout(pressTimer);
    ghost = document.createElement('div');
    ghost.className = 'ghost';
    ghost.textContent = pretty(chordName(chords[press.degree].root, ui.paletteVariants[press.degree]));
    ghost.setAttribute('aria-hidden', 'true');
    document.body.append(ghost);
    document.body.classList.add('dragging');
  }
  e.preventDefault();
  ghost.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -120%)`;
  ghost.classList.toggle('over', editor.dropStep(e.clientX, e.clientY) !== null);
  editor.autoScroll(e.clientX, e.clientY);
}, { passive: false });

document.addEventListener('pointerup', (e) => {
  clearTimeout(pressTimer);
  if (!press || e.pointerId !== press.pointerId) { press = null; return; }
  const p = press;
  press = null;
  if (!p.active) return;
  editor.stopAutoScroll();
  suppressClickUntil = performance.now() + 400;
  if (ghost) ghost.remove();
  ghost = null;
  document.body.classList.remove('dragging');
  const step = editor.dropStep(e.clientX, e.clientY);
  if (step !== null) placePaletteChord(step, p.degree);
});
document.addEventListener('pointercancel', () => {
  press = null;
  if (ghost) ghost.remove();
  ghost = null;
  document.body.classList.remove('dragging');
});

paletteEl.addEventListener('click', (e) => {
  const more = e.target.closest('[data-more]');
  if (more) { openVariants({ degree: Number(more.dataset.more) }); return; }
  const b = e.target.closest('[data-degree]');
  if (!b || performance.now() < suppressClickUntil) return;
  if (longPressed) { longPressed = false; return; }
  selectPaletteChord(Number(b.dataset.degree));
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
  } else if (e.key === 'v' || e.key === 'V') {
    e.preventDefault();
    openVariants({ degree: d });
  } else if (e.key === 'a' || e.key === 'A') {
    // Keyboard drop: add this chord right after the last one on the lane.
    e.preventDefault();
    const blocks = song.tracks.chords.blocks;
    const end = blocks.length ? Math.max(...blocks.map((x) => x.s + x.l)) : 0;
    if (end < totalSteps(song)) placePaletteChord(end, d);
    else announce('The lane is full. Lengthen the loop or remove a chord first.');
  }
});

/* ---------- Variant sheet (palette chords and placed blocks) ---------- */

const sheet = $('#variant-sheet');
const sheetTitle = $('#sheet-title');
const variantsEl = $('#variants');
let sheetTarget = null; // { degree } for the palette, { blockId } for a placed chord

function openVariants(target) {
  sheetTarget = target;
  renderVariants();
  if (!sheet.open) sheet.showModal();
}

function renderVariants() {
  const block = sheetTarget.blockId ? findBlock(song, sheetTarget.blockId) : null;
  const degree = block ? block.d : sheetTarget.degree;
  const current = block ? block.v : ui.paletteVariants[degree];
  const c = chords[degree];
  sheetTitle.textContent = block ? `Chord in bar ${Math.floor(block.s / 16) + 1}` : `${c.roman} · ${pretty(c.root)} variants`;
  const parts = [];
  if (block) {
    parts.push('<div class="degree-row" role="radiogroup" aria-label="Chord">');
    chords.forEach((cc, i) => {
      parts.push(`<button type="button" class="key opt" role="radio" aria-checked="${i === degree}" data-degree-pick="${i}">${cc.roman}<small>${pretty(chordName(cc.root, cc.defaultVariant))}</small></button>`);
    });
    parts.push('</div>');
  }
  parts.push('<div class="variants-grid">');
  for (const v of c.variants) {
    const notes = chordNotes(c.root, v).map(pretty).join(' ');
    const name = pretty(chordName(c.root, v));
    parts.push(`<button type="button" class="key variant" role="radio" aria-checked="${v === current}" data-variant="${v}"
      aria-label="${name}, ${VARIANTS[v].label}: ${notes}"><span class="name">${name}</span><span class="notes">${notes}</span></button>`);
  }
  parts.push('</div>');
  if (block && block.n) parts.push('<button type="button" class="text-btn" data-unpin>Reset to automatic voicing</button>');
  variantsEl.innerHTML = parts.join('');
}

variantsEl.addEventListener('click', (e) => {
  const block = sheetTarget.blockId ? findBlock(song, sheetTarget.blockId) : null;
  const pick = e.target.closest('[data-degree-pick]');
  const varBtn = e.target.closest('[data-variant]');
  const unpin = e.target.closest('[data-unpin]');
  if (block && pick) {
    const d = Number(pick.dataset.degreePick);
    commit('Change chord', () => setBlockChord(song, block.id, d, chords[d].defaultVariant));
  } else if (varBtn) {
    if (block) commit('Change chord', () => setBlockChord(song, block.id, block.d, varBtn.dataset.variant));
    else {
      ui.paletteVariants[sheetTarget.degree] = varBtn.dataset.variant;
      ui.paletteSel = sheetTarget.degree;
      renderPalette();
      renderHint();
    }
  } else if (block && unpin) {
    commit('Reset voicing', () => { block.n = null; });
  } else return;
  renderVariants();
  if (block) {
    const v = compiled.voicings.get(block.id);
    if (v) preview.chord(v);
  } else {
    previewDegree(sheetTarget.degree, ui.paletteVariants[sheetTarget.degree]);
  }
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

/* ---------- Tracks (mixer) ---------- */

const tracksEl = $('#tracks');

function renderTracks() {
  const t = song.tracks;
  tracksEl.innerHTML = TRACK_IDS.map((id) => {
    const tr = t[id];
    const options = id === 'drums'
      ? KIT_IDS.map((k) => `<option value="${k}"${k === tr.kit ? ' selected' : ''}>${KITS[k].label}</option>`).join('')
      : TRACK_INSTRUMENTS[id].map((k) => `<option value="${k}"${k === tr.inst ? ' selected' : ''}>${INSTRUMENTS[k].label}</option>`).join('');
    const label = TRACK_LABELS[id];
    const loading = ctx && id !== 'drums' && !isLoaded(tr.inst) && (id !== 'melody' || tr.notes.length || ui.track === 'melody');
    return `<div class="track-row t-${id}${ui.track === id ? ' current' : ''}" data-track="${id}">
      <button type="button" class="track-name" data-pick-track="${id}" aria-pressed="${ui.track === id}">${label}</button>
      <select class="inst${loading ? ' loading' : ''}" data-inst="${id}" aria-label="${label} ${id === 'drums' ? 'kit' : 'instrument'}">${options}</select>
      <button type="button" class="ms" data-mute="${id}" aria-pressed="${tr.mute}" aria-label="Mute ${label}">M</button>
      <button type="button" class="ms solo" data-solo="${id}" aria-pressed="${tr.solo}" aria-label="Solo ${label}">S</button>
      <input type="range" class="vol" data-vol="${id}" min="0" max="100" value="${Math.round(tr.vol * 100)}" aria-label="${label} volume">
    </div>`;
  }).join('');
}

function pickTrack(id) {
  ui.track = id;
  ui.selected = null;
  renderStudio();
  editor.centerPitch();
  if (id === 'melody' && ctx) loadSounds().then(renderTracks);
}

tracksEl.addEventListener('click', (e) => {
  const pick = e.target.closest('[data-pick-track]');
  const mute = e.target.closest('[data-mute]');
  const solo = e.target.closest('[data-solo]');
  if (pick) pickTrack(pick.dataset.pickTrack);
  else if (mute) commit('Mute', () => { song.tracks[mute.dataset.mute].mute = !song.tracks[mute.dataset.mute].mute; });
  else if (solo) commit('Solo', () => { song.tracks[solo.dataset.solo].solo = !song.tracks[solo.dataset.solo].solo; });
});
tracksEl.addEventListener('change', (e) => {
  const sel = e.target.closest('[data-inst]');
  if (!sel) return;
  const id = sel.dataset.inst;
  commit('Change sound', () => {
    if (id === 'drums') song.tracks.drums.kit = sel.value;
    else song.tracks[id].inst = sel.value;
  });
  audio();
  if (id === 'drums') preview.drum('kick');
  else {
    loadInstrument(ctx, sel.value).then(() => renderTracks(), () => {});
    if (id === 'chords') previewDegree(0, chords[0].defaultVariant);
    else preview.note(id, id === 'bass' ? 36 : 72);
  }
});
let volBegun = false;
tracksEl.addEventListener('input', (e) => {
  const vol = e.target.closest('[data-vol]');
  if (!vol) return;
  if (!volBegun) { begin(); volBegun = true; }
  song.tracks[vol.dataset.vol].vol = Number(vol.value) / 100;
  if (mixer) mixer.setLevels(song);
  scheduleSave();
});
tracksEl.addEventListener('change', (e) => { if (e.target.closest('[data-vol]')) volBegun = false; });

/* ---------- Editor ---------- */

const editorHead = $('#editor-h');
const toolsEl = $('#tools');
const hintEl = $('#editor-hint');

const editor = createEditor($('#roll'), {
  song: () => song,
  compiled: () => compiled,
  track: () => ui.track,
  ui,
  begin,
  changed,
  commit,
  preview,
  announce,
  placePaletteChord: (step) => placePaletteChord(step),
  openBlockVariants: (id) => openVariants({ blockId: id }),
  selectBlock(id, sound) {
    ui.selected = { type: 'block', id };
    changed();
    if (sound) {
      const v = compiled.voicings.get(id);
      if (v) preview.chord(v);
    }
  },
});

function renderTools() {
  const t = song.tracks;
  editorHead.textContent = TRACK_LABELS[ui.track];
  const parts = [];
  if (ui.track === 'chords') {
    parts.push(`<label class="mini-field" for="style">Play as <select id="style">${Object.entries(CHORD_STYLES)
      .map(([k, v]) => `<option value="${k}"${k === t.chords.style ? ' selected' : ''}>${v}</option>`).join('')}</select></label>`);
  } else if (ui.track === 'bass') {
    parts.push(t.bass.auto
      ? '<span class="chip">Following the chords</span>'
      : '<button type="button" class="key small" id="bass-follow">Follow chords again</button>');
  } else if (ui.track === 'drums') {
    parts.push(`<div class="presets" role="group" aria-label="Fill with a pattern">${PATTERN_IDS
      .map((id) => `<button type="button" class="key small${id === t.drums.pattern ? ' current' : ''}" data-preset="${id}">${PATTERN_LABELS[id]}</button>`).join('')}</div>`);
  }
  parts.push('<button type="button" class="text-btn" id="clear-track">Clear</button>');
  toolsEl.innerHTML = parts.join('');
}

function renderHint() {
  const draw = coarse.matches
    ? 'Tap to add a note. Drag a note to move it, its right edge to resize it. Double-tap to delete. Drag empty space to scroll.'
    : 'Click and drag to draw notes. Drag a note to move it, its right edge to resize it. Double-click to delete.';
  const selName = ui.paletteSel !== null ? pretty(chordName(chords[ui.paletteSel].root, ui.paletteVariants[ui.paletteSel])) : null;
  hintEl.textContent = {
    chords: selName
      ? `Tap the chord lane to place ${selName}.`
      : 'Drag chords from the palette onto the lane. Drag a block to move it, its right edge to stretch it, or off the lane to remove it. Tap a block twice for its options. Drag a note up or down to change the voicing.',
    melody: draw,
    bass: song.tracks.bass.auto ? `The bass follows your chords. ${draw} Editing any note takes it over.` : draw,
    drums: 'Tap a step to cycle it: hit, accent, off. Pick a pattern above to start from.',
  }[ui.track];
}

toolsEl.addEventListener('change', (e) => {
  if (e.target.id === 'style') commit('Chord style', () => { song.tracks.chords.style = e.target.value; });
});
toolsEl.addEventListener('click', (e) => {
  const presetBtn = e.target.closest('[data-preset]');
  if (presetBtn) {
    commit('Drum pattern', () => {
      song.tracks.drums.pattern = presetBtn.dataset.preset;
      fillDrums(song, KITS[song.tracks.drums.kit].patterns[presetBtn.dataset.preset]);
    });
    if (!playing) auditionBar();
    return;
  }
  if (e.target.id === 'bass-follow') {
    commit('Bass follows chords', () => { song.tracks.bass.auto = true; song.tracks.bass.notes = []; });
    return;
  }
  if (e.target.id === 'clear-track') {
    const label = TRACK_LABELS[ui.track];
    commit(`Clear ${label}`, () => {
      const t = song.tracks[ui.track];
      if (ui.track === 'chords') t.blocks = [];
      else if (ui.track === 'drums') t.grid = {};
      else if (ui.track === 'bass') { t.auto = false; t.notes = []; }
      else t.notes = [];
    });
    ui.selected = null;
    changed();
    announce(`Cleared ${label.toLowerCase()}. Undo brings it back.`);
  }
});

// One bar of the drum track, so pattern picks are audible while stopped.
function auditionBar() {
  audio();
  loadDrums(ctx).then(() => {
    const stepDur = 60 / song.tempo / 4;
    const t0 = ctx.currentTime + 0.05;
    for (let s = 0; s < 16; s++) {
      for (const ev of compiled.steps[s] || []) {
        if (ev.track === 'drums') previewTake.play(ev, t0 + s * stepDur + swingOffset(s, stepDur), stepDur);
      }
    }
  }, () => {});
}

$('#snap').addEventListener('change', (e) => { ui.snap = Number(e.target.value); });
$('#zoom-in').addEventListener('click', () => { ui.zoom = Math.min(ZOOM_STEPS.length - 1, ui.zoom + 1); renderStudio(); });
$('#zoom-out').addEventListener('click', () => { ui.zoom = Math.max(0, ui.zoom - 1); renderStudio(); });

function deleteSelection() {
  const sel = ui.selected;
  if (!sel) return false;
  if (sel.type === 'block') commit('Remove chord', () => removeBlock(song, sel.id));
  else if (sel.type === 'note' && (ui.track === 'melody' || ui.track === 'bass')) {
    commit('Delete note', () => {
      if (ui.track === 'bass') freezeBass(song);
      removeNote(song, ui.track, sel.id);
    });
  } else return false;
  ui.selected = null;
  changed();
  return true;
}
$('#delete-sel').addEventListener('click', deleteSelection);

/* ---------- Transport controls ---------- */

const barsToggle = $('#bars-toggle');
barsToggle.addEventListener('click', (e) => {
  const b = e.target.closest('[data-bars]');
  if (!b || Number(b.dataset.bars) === song.bars) return;
  commit('Loop length', () => setBars(song, Number(b.dataset.bars)));
});

let sliderBegun = false;
function slider(id, apply, fmt) {
  const el = $(`#${id}`);
  el.addEventListener('input', () => {
    if (!sliderBegun) { begin(); sliderBegun = true; }
    apply(Number(el.value));
    $(`#${id}-out`).textContent = fmt(Number(el.value));
    scheduleSave();
  });
  el.addEventListener('change', () => { sliderBegun = false; });
}
slider('tempo', (v) => { song.tempo = v; }, (v) => String(v));
slider('swing', (v) => { song.swing = v / 100; }, (v) => `${v}%`);
slider('reverb', (v) => { song.reverb = v / 100; setReverbMix(song.reverb); }, (v) => `${v}%`);

function syncControls() {
  $('#tempo').value = String(song.tempo);
  $('#tempo-out').textContent = String(song.tempo);
  $('#swing').value = String(Math.round(song.swing * 100));
  $('#swing-out').textContent = `${Math.round(song.swing * 100)}%`;
  $('#reverb').value = String(Math.round(song.reverb * 100));
  $('#reverb-out').textContent = `${Math.round(song.reverb * 100)}%`;
  if (ctx) setReverbMix(song.reverb);
}

$('#undo').addEventListener('click', undo);
$('#redo').addEventListener('click', redo);

function renderStudio() {
  renderTracks();
  renderTools();
  renderHint();
  editor.render();
  for (const b of barsToggle.querySelectorAll('button')) b.setAttribute('aria-checked', String(Number(b.dataset.bars) === song.bars));
  $('#undo').disabled = !undoStack.length;
  $('#redo').disabled = !redoStack.length;
  $('#delete-sel').disabled = !ui.selected;
}

document.addEventListener('keydown', (e) => {
  if (screens.studio.hidden || studioEl.inert || sheet.open) return;
  const typing = e.target.closest('input, select, textarea');
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
    if (typing && e.target.type === 'text') return;
    e.preventDefault();
    if (e.key === 'y' || e.shiftKey) redo(); else undo();
    return;
  }
  if (typing) return;
  if (e.code === 'Space' && (e.target === document.body || e.target.closest('.grid'))) {
    e.preventDefault();
    if (playing) stopTransport(); else startTransport();
  } else if (e.key === 'Escape') {
    ui.paletteSel = null;
    ui.selected = null;
    renderPalette();
    changed();
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && !e.target.closest('.grid') && ui.selected && ui.selected.type === 'block') {
    e.preventDefault();
    deleteSelection();
  }
});

/* ---------- Flow: spin -> studio (60s clock) -> result ---------- */

// ?clock=5 shortens the countdown for testing.
const CLOCK_SECONDS = Math.max(1, Number(new URLSearchParams(location.search).get('clock')) || 60);
const CLOCK_CIRC = 2 * Math.PI * 19;

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
  fresh: true,
};

try { flow.untimed = localStorage.getItem('oms-untimed') === '1'; } catch { /* storage blocked */ }

const screens = {
  spin: $('#screen-spin'), studio: $('#screen-studio'), result: $('#screen-result'), listen: $('#screen-listen'),
};
const studioEl = $('#studio');
const appEl = $('.app');
const clockEl = $('#clock');
const clockFill = $('#clock-fill');
const clockText = $('#clock-text');
const timeUpEl = $('#time-up');
const untimedEl = $('#untimed');
untimedEl.checked = flow.untimed;

function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
  appEl.classList.toggle('wide', name === 'studio');
  window.scrollTo(0, 0);
  if (name === 'studio') { renderStudio(); editor.centerPitch(); }
  if (name === 'spin') $('#resume').hidden = !savedSong();
}

function promptHTML() {
  const { topic, style } = flow.values;
  if (!topic || !style) return 'Make whatever you want.';
  return `Write a song about <b>${esc(topic)}</b> in the style of <b>${esc(style)}</b>.`;
}

function constraintText() {
  return flow.constraintOn && flow.values.constraint ? `Constraint: ${flow.values.constraint}.` : '';
}

function promptPlainText() {
  if (!flow.values.topic || !flow.values.style) return '';
  return `${promptSentence(flow.values)} ${constraintText()}`.trim();
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
  if (previewTake && ctx) previewTake.drum('electro', 'hat', ctx.currentTime + 0.005, 0.15);
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
      reel.classList.remove('spinning', 'landed');
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
    flow.locked[lock.dataset.lock] = !flow.locked[lock.dataset.lock];
    renderPrompt();
    return;
  }
  const win = e.target.closest('[data-reroll]');
  if (!win || flow.spinning || !flow.prompts) return;
  const r = win.dataset.reroll;
  if (flow.locked[r] || (r === 'constraint' && !flow.constraintOn)) return;
  audio();
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

function loadSong(next) {
  stopTransport();
  song = next;
  undoStack.length = 0;
  redoStack.length = 0;
  ui.selected = null;
  ui.paletteSel = null;
  compiled = compile(song);
  chords = diatonicChords(song.keyPc, song.mode);
  ui.paletteVariants = chords.map((c) => c.defaultVariant);
  if (mixer) mixer.setLevels(song);
  renderKeys();
  renderPalette();
  syncControls();
  if (!screens.studio.hidden) renderStudio();
}

function lockStudio(on) {
  studioEl.inert = on;
  studioEl.classList.toggle('locked', on);
  $('#finish').disabled = on;
}

function syncStudioPrompt() {
  $('#studio-prompt').innerHTML = promptHTML() + (constraintText() ? `<br>${esc(constraintText())}` : '');
}

function startStudio() {
  audio();
  const fresh = defaultSong();
  Object.assign(fresh, {
    topic: flow.values.topic || '', style: flow.values.style || '', constraint: flow.constraintOn ? flow.values.constraint || '' : '',
  });
  loadSong(fresh);
  flow.titleEdited = false;
  titleEl.value = '';
  lockStudio(false);
  syncStudioPrompt();
  ui.track = 'chords';
  showScreen('studio');
  editor.scrollToStart();
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
  return compiled.steps.every((evs) => !evs.length);
}

// 0:00 (or Finish): lock the studio, play the song once through, then show the result.
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
  editor.scrollToStart();
  startTransport({ once: true, onEnd: goResult });
}

$('#skip').addEventListener('click', () => { stopTransport(); goResult(); });
$('#finish').addEventListener('click', timeUp);

/* Result */

const titleEl = $('#title');
const replayBtn = $('#replay');

function updateReplayButtons() {
  const label = playing ? '■ Stop' : '▶ Play it';
  replayBtn.textContent = label;
  $('#listen-play').textContent = label;
}

function specsHTML() {
  const t = song.tracks;
  const blockNames = [...t.chords.blocks].sort((a, b) => a.s - b.s)
    .map((b) => pretty(chordName(chords[b.d].root, b.v)));
  const sounds = [
    `${INSTRUMENTS[t.chords.inst].label} chords`,
    t.melody.notes.length && !t.melody.mute ? `${INSTRUMENTS[t.melody.inst].label} melody` : null,
    !t.bass.mute ? INSTRUMENTS[t.bass.inst].label : null,
  ].filter(Boolean).join(' · ');
  const specs = [
    ['Key', `${pretty(keyName(song.keyPc, song.mode))} ${song.mode}`],
    ['Chords', blockNames.length ? blockNames.join('  ') : '–'],
    ['Length', `${song.bars} bars at ${song.tempo} BPM`],
    ['Sounds', sounds],
    ['Drums', t.drums.mute ? 'None' : KITS[t.drums.kit].label],
  ];
  return specs.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
}

// The title is a textarea so long names wrap instead of being cut off. Grow it to fit,
// and treat Enter as "done" since titles are one line.
function fitTitle() {
  titleEl.style.height = 'auto';
  titleEl.style.height = `${titleEl.scrollHeight}px`;
}

function goResult() {
  timeUpEl.hidden = true;
  lockStudio(false);
  if (!flow.titleEdited) titleEl.value = song.title || titleFromTopic(flow.values.topic || 'untitled');
  song.title = titleEl.value;
  scheduleSave();
  $('#result-prompt').textContent = promptPlainText();
  $('#result-specs').innerHTML = specsHTML();
  $('#result-status').textContent = '';
  buildShareLink();
  showScreen('result');
  fitTitle();
  updateReplayButtons();
  titleEl.focus({ preventScroll: true });
}

let linkTimer = null;
titleEl.addEventListener('input', () => {
  flow.titleEdited = true;
  titleEl.value = titleEl.value.replace(/\s*\n\s*/g, ' ');
  song.title = titleEl.value.trim();
  scheduleSave();
  fitTitle();
  clearTimeout(linkTimer);
  linkTimer = setTimeout(buildShareLink, 150);
});
titleEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
});
replayBtn.addEventListener('click', () => (playing ? stopTransport() : startTransport({ once: true })));
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
$('#resume').addEventListener('click', () => {
  const saved = savedSong();
  if (!saved) return;
  audio();
  flow.values = { topic: saved.topic || null, style: saved.style || null, constraint: saved.constraint || null };
  flow.constraintOn = Boolean(saved.constraint);
  loadSong(saved);
  flow.titleEdited = Boolean(saved.title);
  titleEl.value = saved.title || '';
  lockStudio(false);
  syncStudioPrompt();
  showScreen('studio');
  showUntimedClock();
});

untimedEl.addEventListener('change', () => {
  flow.untimed = untimedEl.checked;
  try { localStorage.setItem('oms-untimed', flow.untimed ? '1' : '0'); } catch { /* storage blocked */ }
  // Switching on mid-run stops the clock; switching off applies to the next run.
  if (flow.untimed && flow.timerRaf) showUntimedClock();
  renderPrompt();
});

/* ---------- Share links ---------- */

function currentTitle() {
  return titleEl.value.trim() || titleFromTopic(flow.values.topic || 'untitled');
}

// Links are compressed asynchronously, but copying and the share sheet must run straight
// from the tap (Safari drops the permission after an await). So keep a link ready,
// rebuilt whenever the result screen opens or the title changes.
let readyLink = { key: '', url: '' };

async function buildShareLink() {
  song.title = currentTitle();
  const key = JSON.stringify(song);
  if (readyLink.key === key) return readyLink.url;
  const url = `${location.origin}${location.pathname}#${await encodeSongV2(song)}`;
  readyLink = { key, url };
  return url;
}

function shareUrl() {
  song.title = currentTitle();
  return readyLink.key === JSON.stringify(song) ? readyLink.url : null;
}

// Phones get the native share sheet; everyone else gets the link copied, with a
// selectable fallback if the clipboard is blocked.
async function shareSong(statusEl) {
  const url = shareUrl() || await buildShareLink();
  const title = currentTitle();
  if (navigator.share && coarse.matches) {
    try {
      await navigator.share({ title: `${title} · One Minute Song`, text: `I wrote "${title}" in 60 seconds.`, url });
      statusEl.textContent = 'Shared.';
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    statusEl.textContent = 'Link copied. Paste it anywhere.';
  } catch {
    statusEl.innerHTML = '<label class="copy-field">Copy this link<input type="text" readonly></label>';
    const input = statusEl.querySelector('input');
    input.value = url;
    input.focus();
    input.select();
  }
}

/* ---------- Audio export (offline render to WAV) ---------- */

// Renders the song twice through on an OfflineAudioContext with the same master chain
// and mixer as live playback, and saves a WAV every app can open. More reliable than
// MediaRecorder: no codec differences (Safari) and no realtime wait.
async function renderWav(passes = 2) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) throw new Error('OfflineAudioContext unsupported');
  audio();
  await loadSounds(); // decoded sample buffers are shared with the offline context
  const sampleRate = 44100;
  const stepDur = 60 / song.tempo / 4;
  const steps = compiled.total * passes;
  const start = 0.05;
  const tail = 2.5;
  const seconds = start + steps * stepDur + tail;
  const off = new OAC(2, Math.ceil(sampleRate * seconds), sampleRate);
  const master = buildMaster(off, song.reverb);
  const offMixer = createMixer(off, master.dry);
  offMixer.setLevels(song, false);
  const offTake = offMixer.createTake();
  for (let i = 0; i < steps; i++) playStep(offTake, i % compiled.total, start + i * stepDur, stepDur);
  // Fade the reverb tail out cleanly.
  master.out.gain.setValueAtTime(master.out.gain.value, seconds - 1.2);
  master.out.gain.linearRampToValueAtTime(0, seconds);
  const buf = await off.startRendering();
  const channels = Array.from({ length: buf.numberOfChannels }, (_, ch) => buf.getChannelData(ch));
  return encodeWav(channels, sampleRate);
}

function fileSlug(title) {
  // Fold accents to plain letters (Café -> cafe) before dropping everything else.
  return (title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'one-minute-song').slice(0, 50);
}

async function downloadAudio(btn, statusEl) {
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Rendering…';
  statusEl.textContent = '';
  try {
    const wav = await renderWav();
    const name = `${fileSlug(currentTitle())}.wav`;
    const blobUrl = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    statusEl.textContent = `Saved ${name}.`;
  } catch {
    statusEl.textContent = "This browser couldn't render the audio. Try Chrome, Safari or Firefox.";
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

$('#share').addEventListener('click', () => shareSong($('#result-status')));
$('#download').addEventListener('click', (e) => downloadAudio(e.currentTarget, $('#result-status')));

/* ---------- Listen view (opened from a share link) ---------- */

async function songFromHash(hash) {
  if (/^#?v2=/.test(hash)) return decodeSongV2(hash);
  const old = decodeSong(hash);
  if (!old) return null;
  const preset = old.kit !== 'none' && KITS[old.kit] ? KITS[old.kit].patterns[old.pattern] : KITS.acoustic.patterns.basic;
  return fromV1(old, preset);
}

function showListen(next) {
  loadSong(next);
  flow.values = { topic: next.topic || null, style: next.style || null, constraint: next.constraint || null };
  flow.constraintOn = Boolean(next.constraint);
  $('#constraint-on').checked = flow.constraintOn;
  titleEl.value = next.title || '';
  flow.titleEdited = Boolean(next.title);
  for (const r of REELS) $(`#${r}-text`).textContent = flow.values[r] || '???';
  renderPrompt();
  $('#listen-title').textContent = next.title || 'Untitled';
  $('#listen-prompt').textContent = promptPlainText();
  $('#listen-specs').innerHTML = specsHTML();
  $('#listen-status').textContent = '';
  document.title = `${next.title || 'Untitled'} · One Minute Song`;
  showScreen('listen');
  updateReplayButtons();
}

function clearShareHash() {
  history.replaceState(null, '', location.pathname + location.search);
  document.title = 'One Minute Song';
}

$('#listen-play').addEventListener('click', () => (playing ? stopTransport() : startTransport({ once: true })));
$('#listen-download').addEventListener('click', (e) => downloadAudio(e.currentTarget, $('#listen-status')));
$('#make-own').addEventListener('click', () => {
  clearShareHash();
  stopTransport();
  loadSong(defaultSong());
  flow.values = { topic: null, style: null, constraint: null };
  flow.constraintOn = true;
  $('#constraint-on').checked = true;
  for (const r of REELS) $(`#${r}-text`).textContent = '???';
  flow.fresh = true;
  renderPrompt();
  showScreen('spin');
  $('#spin').focus();
});
$('#remix').addEventListener('click', () => {
  clearShareHash();
  stopTransport();
  flow.fresh = false;
  lockStudio(false);
  syncStudioPrompt();
  showScreen('studio');
  showUntimedClock();
});

window.addEventListener('hashchange', async () => {
  const next = await songFromHash(location.hash);
  if (next) showListen(next);
});

/* ---------- Boot ---------- */

renderKeys();
renderPalette();
syncControls();
renderPrompt();
showScreen('spin');
loadPrompts().then((p) => {
  flow.prompts = p;
  renderPrompt();
});
if (location.hash) songFromHash(location.hash).then((s) => { if (s) showListen(s); });
