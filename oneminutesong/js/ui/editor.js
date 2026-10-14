// The track editor: a ruler, a chord lane (blocks you drop chords onto), and below it
// either a piano roll (chords, melody, bass) or a drum step grid.
//
// Mouse/pen: drag on empty grid to draw a note (drag right to set its length), drag a
// note to move it, drag its right edge to resize, double-click to delete.
// Touch: tap empty grid to add a note, drag empty grid to scroll, drag notes as above,
// double-tap a note to delete.
// Keyboard (grid focused): arrows move the selected note, Shift+arrows resize / octave,
// [ and ] pick the previous / next note, Delete removes it.

import {
  totalSteps, RANGES, DRUM_LANES, STEPS_PER_BAR, bassNotes, laneString, findNote, findBlock,
  addNote, moveNote, resizeNote, removeNote, moveBlock, resizeBlock, removeBlock, setBlockNotes,
  freezeBass, toggleDrum,
} from '../song.js';
import { expandBlock } from '../compile.js';
import { diatonicChords, chordName, pretty, MODES, keyName } from '../theory.js';
import { KITS } from '../audio/drums.js';

export const ZOOM_STEPS = [12, 16, 22, 30, 40];
const ROW = 14;
const LANE_H = 40;
const RULER_H = 22;
const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const BLACK = new Set([1, 3, 6, 8, 10]);
const DRUM_LABELS = { kick: 'Kick', snare: 'Snare', hat: 'Hat', open: 'Open hat', ride: 'Ride' };
const CELL_LABEL = { '.': 'off', o: 'hit', x: 'accent', g: 'ghost' };

const noteName = (p) => `${NOTE_NAMES[p % 12]}${Math.floor(p / 12) - 1}`;
const snapDown = (n, snap) => Math.floor(n / snap) * snap;
const snapRound = (n, snap) => Math.round(n / snap) * snap;

export function createEditor(root, ctx) {
  // ctx: song(), compiled(), track(), ui, begin(label), changed(), commit(label, fn),
  //      preview: { note(track, midi), chord(notes), drum(lane) }, announce(msg),
  //      placePaletteChord(step) -> bool, openBlockVariants(id), selectBlock(id)
  const scroller = root;
  let inner = null;
  let gridEl = null;
  let laneEl = null;
  let playheadEl = null;
  let drag = null;
  let lastTap = { id: null, time: 0 };

  const stepW = () => ZOOM_STEPS[ctx.ui.zoom];
  const keysW = () => (ctx.track() === 'drums' ? 74 : 46);
  const range = () => RANGES[ctx.track()] || RANGES.melody;
  const editable = () => ctx.track() !== 'drums';

  /* ---------- Rendering ---------- */

  function render() {
    // Re-rendering replaces the grid; keep keyboard focus on it if it had it.
    const hadFocus = gridEl && document.activeElement === gridEl;
    const song = ctx.song();
    const track = ctx.track();
    const total = totalSteps(song);
    const sw = stepW();
    root.style.setProperty('--step', `${sw}px`);
    root.style.setProperty('--row', `${ROW}px`);
    root.style.setProperty('--keys', `${keysW()}px`);
    root.style.setProperty('--lane', `${LANE_H}px`);
    root.style.setProperty('--ruler', `${RULER_H}px`);
    root.dataset.track = track;

    const html = [];
    html.push(`<div class="roll-inner" style="width:${keysW() + total * sw}px">`);
    // Ruler
    html.push('<div class="corner" aria-hidden="true"></div><div class="ruler" aria-hidden="true">');
    for (let b = 0; b < song.bars; b++) html.push(`<span style="left:${b * 16 * sw}px">${b + 1}</span>`);
    html.push('</div>');
    // Chord lane
    html.push('<div class="lane-label">Chords</div>');
    html.push(`<div class="chord-lane" role="group" aria-label="Chord lane">${laneHTML(song)}</div>`);
    // Body
    if (track === 'drums') html.push(drumHTML(song));
    else html.push(rollHTML(song, track));
    html.push('<div class="playhead" aria-hidden="true"></div></div>');
    scroller.innerHTML = html.join('');
    inner = scroller.firstElementChild;
    gridEl = inner.querySelector('.grid');
    laneEl = inner.querySelector('.chord-lane');
    playheadEl = inner.querySelector('.playhead');
    if (hadFocus && gridEl) gridEl.focus({ preventScroll: true });
  }

  // While dragging near the left/right edge of the visible roll, scroll it so you can
  // reach bars that are off screen.
  let autoScrollRaf = 0;
  let autoScrollX = null;
  function autoScroll(clientX) {
    autoScrollX = clientX;
    if (autoScrollRaf) return;
    const tickScroll = () => {
      autoScrollRaf = 0;
      if (autoScrollX === null) return;
      const rect = scroller.getBoundingClientRect();
      const left = rect.left + keysW();
      const zone = 48;
      let dx = 0;
      if (autoScrollX < left + zone) dx = -Math.ceil((left + zone - autoScrollX) / 4);
      else if (autoScrollX > rect.right - zone) dx = Math.ceil((autoScrollX - (rect.right - zone)) / 4);
      if (dx) {
        scroller.scrollLeft += dx;
        autoScrollRaf = requestAnimationFrame(tickScroll);
      }
    };
    autoScrollRaf = requestAnimationFrame(tickScroll);
  }
  function stopAutoScroll() {
    autoScrollX = null;
    cancelAnimationFrame(autoScrollRaf);
    autoScrollRaf = 0;
  }

  function laneHTML(song) {
    const chords = diatonicChords(song.keyPc, song.mode);
    const sw = stepW();
    return song.tracks.chords.blocks.map((b) => {
      const c = chords[b.d];
      const name = pretty(chordName(c.root, b.v));
      const sel = ctx.ui.selected && ctx.ui.selected.type === 'block' && ctx.ui.selected.id === b.id;
      // The × and ⋯ buttons sit beside the block (not inside it) so buttons don't nest.
      const tools = sel ? `<div class="block-tools" style="left:${(b.s + b.l) * sw - 2}px">
          <button type="button" class="b-more" data-block-more="${b.id}" aria-label="Options for ${name}">⋯</button>
          <button type="button" class="b-x" data-remove-block="${b.id}" aria-label="Remove ${name}">×</button></div>` : '';
      return `<div class="block${sel ? ' selected' : ''}${b.n ? ' pinned' : ''}" data-block="${b.id}" tabindex="-1"
        style="left:${b.s * sw}px;width:${b.l * sw - 2}px" role="button"
        aria-label="${name} (${c.roman}), bar ${Math.floor(b.s / 16) + 1} beat ${Math.floor((b.s % 16) / 4) + 1}, ${b.l} sixteenths">
        <span class="b-name">${name}</span><span class="b-roman">${c.roman}</span>
        <span class="b-edge" aria-hidden="true"></span>
      </div>${tools}`;
    }).join('');
  }

  function scaleSet(song) {
    const tonic = song.keyPc;
    return new Set(MODES[song.mode].steps.map((s) => (tonic + s) % 12));
  }

  function rollHTML(song, track) {
    const [lo, hi] = range();
    const sw = stepW();
    const inScale = scaleSet(song);
    const keys = [];
    const rows = [];
    for (let p = hi; p >= lo; p--) {
      const y = (hi - p) * ROW;
      const pc = p % 12;
      const cls = [BLACK.has(pc) ? 'black' : 'white', inScale.has(pc) ? 'in' : 'out', pc === song.keyPc ? 'tonic' : '', pc === 0 ? 'c' : ''].join(' ');
      keys.push(`<div class="pkey ${cls}" style="top:${y}px" data-pitch="${p}">${pc === 0 || pc === song.keyPc ? noteName(p) : ''}</div>`);
      rows.push(`<div class="prow ${cls}" style="top:${y}px"></div>`);
    }
    const notes = noteRects(song, track).map((n) => {
      const sel = ctx.ui.selected && ctx.ui.selected.type === 'note' && ctx.ui.selected.id === n.id;
      return `<div class="note ${n.cls}${sel ? ' selected' : ''}" data-note="${n.id}"${n.block ? ` data-block-note="${n.block}" data-idx="${n.idx}"` : ''}
        style="left:${n.s * sw}px;top:${(hi - n.p) * ROW}px;width:${Math.max(4, n.l * sw - 1)}px"
        aria-hidden="true"><span class="n-edge"></span></div>`;
    }).join('');
    const height = (hi - lo + 1) * ROW;
    return `<div class="keys" style="height:${height}px" aria-hidden="true">${keys.join('')}</div>
      <div class="grid" style="height:${height}px" tabindex="0" role="application"
        aria-label="${track} piano roll. ${editable() ? 'Arrow keys move the selected note, Shift+arrows resize or move by an octave, brackets pick notes, Delete removes.' : ''}">
        <div class="rows">${rows.join('')}</div><div class="lines"></div>${notes}</div>`;
  }

  // What to draw for a track: [{ id, s, l, p, cls, block?, idx? }]
  function noteRects(song, track) {
    if (track === 'chords') {
      const voicings = ctx.compiled().voicings;
      const style = song.tracks.chords.style;
      const out = [];
      for (const b of song.tracks.chords.blocks) {
        const v = voicings.get(b.id) || [];
        expandBlock(b, v, style).forEach((h, k) => {
          for (const p of h.notes) {
            const idx = v.indexOf(p);
            out.push({ id: `${b.id}-${k}-${idx}`, s: h.s, l: h.l, p, cls: 'chord-note', block: b.id, idx });
          }
        });
      }
      return out;
    }
    if (track === 'bass') {
      const auto = song.tracks.bass.auto;
      return bassNotes(song).map((n) => ({ ...n, cls: auto ? 'auto' : '' }));
    }
    return song.tracks.melody.notes.map((n) => ({ ...n, cls: '' }));
  }

  function drumHTML(song) {
    const kit = KITS[song.tracks.drums.kit];
    const lanes = DRUM_LANES.filter((l) => kit && kit.voices[l]);
    const total = totalSteps(song);
    const rows = lanes.map((lane, r) => {
      const row = laneString(song, lane);
      const cells = [];
      for (let s = 0; s < total; s++) {
        const ch = row[s];
        cells.push(`<button type="button" class="cell c-${ch === '.' ? 'off' : ch}${s % 4 === 0 ? ' beat' : ''}${s % 16 === 0 ? ' bar' : ''}"
          data-lane="${lane}" data-step="${s}" tabindex="${r === 0 && s === 0 ? 0 : -1}"
          aria-label="${DRUM_LABELS[lane]}, bar ${Math.floor(s / 16) + 1} step ${(s % 16) + 1}: ${CELL_LABEL[ch]}"></button>`);
      }
      return `<div class="drum-label" id="lane-${lane}">${DRUM_LABELS[lane]}</div><div class="drum-row" role="group" aria-labelledby="lane-${lane}">${cells.join('')}</div>`;
    }).join('');
    return `<div class="drum-grid" role="group" aria-label="Drum steps. Tap a step: off, hit, accent. Arrow keys move between steps.">${rows}</div>`;
  }

  /* ---------- Playhead ---------- */

  function setPlayhead(pos, follow = true) {
    if (!playheadEl) return;
    if (pos === null) { playheadEl.style.opacity = '0'; return; }
    const x = keysW() + pos * stepW();
    playheadEl.style.opacity = '1';
    playheadEl.style.transform = `translateX(${x}px)`;
    if (follow && !drag) {
      const left = scroller.scrollLeft + keysW();
      const right = scroller.scrollLeft + scroller.clientWidth - 24;
      if (x < left || x > right) scroller.scrollLeft = Math.max(0, x - keysW() - 16);
    }
  }

  /* ---------- Geometry ---------- */

  function stepAt(clientX, el = gridEl || laneEl) {
    const rect = el.getBoundingClientRect();
    return (clientX - rect.left) / stepW();
  }

  function pitchAt(clientY) {
    const rect = gridEl.getBoundingClientRect();
    return range()[1] - Math.floor((clientY - rect.top) / ROW);
  }

  // Where a chord dragged from the palette would land, or null if not over the editor.
  function dropStep(clientX, clientY) {
    if (!laneEl) return null;
    const el = document.elementFromPoint(clientX, clientY);
    if (!el || !(el.closest('.chord-lane') || (ctx.track() === 'chords' && el.closest('.grid')))) return null;
    const total = totalSteps(ctx.song());
    return Math.max(0, Math.min(total - 1, snapDown(stepAt(clientX, laneEl), Math.max(ctx.ui.snap, 2))));
  }

  /* ---------- Pointer editing ---------- */

  const isTouch = (e) => e.pointerType === 'touch';

  scroller.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const removeBtn = e.target.closest('[data-remove-block], [data-block-more]');
    if (removeBtn) return; // handled on click
    const block = e.target.closest('.chord-lane [data-block]');
    const note = e.target.closest('.grid [data-note]');
    const song = ctx.song();
    const track = ctx.track();

    if (block) {
      const b = findBlock(song, block.dataset.block);
      const edge = e.target.closest('.b-edge') || (e.clientX > block.getBoundingClientRect().right - 10);
      drag = { kind: edge ? 'block-resize' : 'block-move', id: b.id, x: e.clientX, y: e.clientY, s: b.s, l: b.l, moved: false, began: false };
      e.preventDefault();
      return;
    }
    if (note && track !== 'drums') {
      const sel = note.dataset.blockNote
        ? { type: 'block-note', block: note.dataset.blockNote, idx: Number(note.dataset.idx) }
        : { type: 'note', id: note.dataset.note };
      const rect = note.getBoundingClientRect();
      const edge = !note.dataset.blockNote && e.clientX > rect.right - Math.min(10, rect.width / 3);
      if (sel.type === 'note') {
        const n = track === 'bass' ? bassNotes(song).find((x) => x.id === sel.id) : findNote(song, track, sel.id);
        drag = { kind: edge ? 'note-resize' : 'note-move', id: sel.id, x: e.clientX, y: e.clientY, s: n.s, l: n.l, p: n.p, moved: false, began: false };
      } else {
        const v = ctx.compiled().voicings.get(sel.block) || [];
        drag = { kind: 'chord-note', block: sel.block, idx: sel.idx, x: e.clientX, y: e.clientY, p: v[sel.idx], moved: false, began: false };
      }
      e.preventDefault();
      return;
    }
    const inGrid = e.target.closest('.grid');
    const inLane = e.target.closest('.chord-lane');
    if (inGrid || inLane) {
      drag = {
        kind: isTouch(e) ? 'pan' : (inGrid && (track === 'melody' || track === 'bass') ? 'draw' : 'tap'),
        x: e.clientX, y: e.clientY, sl: scroller.scrollLeft, st: scroller.scrollTop, moved: false, began: false, inLane: Boolean(inLane),
      };
      if (drag.kind === 'draw') {
        e.preventDefault();
        startDraw(e);
      }
    }
  });

  function startDraw(e) {
    const song = ctx.song();
    const track = ctx.track();
    const s = snapDown(stepAt(e.clientX), ctx.ui.snap);
    const p = pitchAt(e.clientY);
    ctx.begin('Add note');
    if (track === 'bass') freezeBass(song);
    const n = addNote(song, track, { s, l: ctx.ui.lastLen, p });
    drag.kind = 'note-draw';
    drag.id = n.id;
    drag.s = n.s;
    drag.began = true;
    ctx.ui.selected = { type: 'note', id: n.id };
    ctx.preview.note(track, n.p);
    ctx.changed();
  }

  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    if (drag.kind !== 'pan') autoScroll(e.clientX);
    const song = ctx.song();
    const track = ctx.track();
    const sw = stepW();
    const snap = ctx.ui.snap;
    switch (drag.kind) {
      case 'pan':
        scroller.scrollLeft = drag.sl - dx;
        scroller.scrollTop = drag.st - dy;
        break;
      case 'note-draw': {
        const end = Math.max(snap, Math.ceil((stepAt(e.clientX) - drag.s) / snap) * snap);
        resizeNote(song, track, drag.id, end);
        ctx.ui.lastLen = findNote(song, track, drag.id).l;
        ctx.changed();
        break;
      }
      case 'note-move': {
        if (!drag.began) { ctx.begin('Move note'); if (track === 'bass') freezeBass(song); drag.began = true; }
        const s = drag.s + snapRound(dx / sw, snap);
        const p = drag.p - Math.round(dy / ROW);
        const n = findNote(song, track, drag.id);
        if (!n) break;
        const pitchChanged = n.p !== Math.max(range()[0], Math.min(range()[1], p));
        moveNote(song, track, drag.id, s, p);
        if (pitchChanged) ctx.preview.note(track, n.p);
        ctx.ui.selected = { type: 'note', id: drag.id };
        ctx.changed();
        break;
      }
      case 'note-resize': {
        if (!drag.began) { ctx.begin('Resize note'); if (track === 'bass') freezeBass(song); drag.began = true; }
        resizeNote(song, track, drag.id, Math.max(1, drag.l + snapRound(dx / sw, snap)));
        ctx.ui.lastLen = findNote(song, track, drag.id).l;
        ctx.changed();
        break;
      }
      case 'chord-note': {
        const p = Math.max(RANGES.chords[0], Math.min(RANGES.chords[1], drag.p - Math.round(dy / ROW)));
        const v = [...(ctx.compiled().voicings.get(drag.block) || [])];
        if (v[drag.idx] === p) break;
        if (!drag.began) { ctx.begin('Change chord note'); drag.began = true; }
        v[drag.idx] = p;
        setBlockNotes(song, drag.block, v);
        drag.idx = [...v].sort((a, b) => a - b).indexOf(p);
        ctx.preview.note('chords', p);
        ctx.changed();
        break;
      }
      case 'block-move': {
        if (!drag.began) { ctx.begin('Move chord'); drag.began = true; }
        moveBlock(song, drag.id, drag.s + snapRound(dx / sw, Math.max(snap, 2)));
        ctx.ui.selected = { type: 'block', id: drag.id };
        // Dragged well above or below the lane: show it'll be removed.
        const rect = laneEl.getBoundingClientRect();
        drag.off = e.clientY < rect.top - 70 || e.clientY > rect.bottom + 120;
        ctx.changed();
        const el = laneEl && laneEl.querySelector(`[data-block="${drag.id}"]`);
        if (el) el.classList.toggle('leaving', drag.off);
        break;
      }
      case 'block-resize': {
        if (!drag.began) { ctx.begin('Stretch chord'); drag.began = true; }
        resizeBlock(song, drag.id, Math.max(1, drag.l + snapRound(dx / sw, Math.max(snap, 2))));
        ctx.changed();
        break;
      }
      default:
        if (drag.kind === 'tap' && Math.hypot(dx, dy) > 8) drag = null;
    }
  });

  document.addEventListener('pointerup', (e) => {
    stopAutoScroll();
    if (!drag) return;
    const d = drag;
    drag = null;
    const song = ctx.song();
    const track = ctx.track();
    if (d.kind === 'block-move' && d.off) {
      removeBlock(song, d.id);
      ctx.ui.selected = null;
      ctx.changed();
      ctx.announce('Removed the chord.');
      return;
    }
    if (d.moved) {
      if (d.kind.startsWith('block')) ctx.selectBlock(d.id, false);
      return;
    }
    // Clicks and taps.
    switch (d.kind) {
      case 'block-move':
      case 'block-resize': {
        // With a palette chord picked, tapping an existing block places the new chord there.
        if (ctx.ui.paletteSel !== null) {
          ctx.placePaletteChord(snapDown(stepAt(e.clientX, laneEl), Math.max(ctx.ui.snap, 2)));
          break;
        }
        const already = ctx.ui.selected && ctx.ui.selected.type === 'block' && ctx.ui.selected.id === d.id;
        if (already && ctx.ui.paletteSel === null) ctx.openBlockVariants(d.id);
        else ctx.selectBlock(d.id, true);
        break;
      }
      case 'note-move':
      case 'note-resize': {
        const now = performance.now();
        if (lastTap.id === d.id && now - lastTap.time < 350) {
          ctx.commit('Delete note', () => {
            if (track === 'bass') freezeBass(song);
            removeNote(song, track, d.id);
          });
          ctx.ui.selected = null;
          ctx.changed();
          lastTap = { id: null, time: 0 };
          return;
        }
        lastTap = { id: d.id, time: now };
        ctx.ui.selected = { type: 'note', id: d.id };
        ctx.preview.note(track, d.p);
        ctx.changed();
        break;
      }
      case 'chord-note':
        ctx.selectBlock(d.block, true);
        break;
      case 'pan':
      case 'tap': {
        if (d.kind === 'pan' && d.moved) break;
        const step = snapDown(stepAt(e.clientX, d.inLane ? laneEl : gridEl), Math.max(ctx.ui.snap, d.inLane ? 2 : 1));
        if ((d.inLane || track === 'chords') && ctx.placePaletteChord(step)) break;
        if (!d.inLane && (track === 'melody' || track === 'bass')) {
          // Touch tap on empty grid adds a note.
          ctx.commit('Add note', () => {
            if (track === 'bass') freezeBass(song);
            const n = addNote(song, track, { s: snapDown(stepAt(e.clientX), ctx.ui.snap), l: ctx.ui.lastLen, p: pitchAt(e.clientY) });
            ctx.ui.selected = { type: 'note', id: n.id };
            ctx.preview.note(track, n.p);
          });
          break;
        }
        if (ctx.ui.selected) { ctx.ui.selected = null; ctx.changed(); }
        break;
      }
      default:
    }
  });

  document.addEventListener('pointercancel', () => { drag = null; stopAutoScroll(); });

  scroller.addEventListener('dblclick', (e) => {
    const note = e.target.closest('.grid [data-note]');
    if (!note || note.dataset.blockNote) return;
    const song = ctx.song();
    const track = ctx.track();
    ctx.commit('Delete note', () => {
      if (track === 'bass') freezeBass(song);
      removeNote(song, track, note.dataset.note);
    });
    ctx.ui.selected = null;
    ctx.changed();
  });

  scroller.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove-block]');
    if (rm) {
      ctx.commit('Remove chord', () => removeBlock(ctx.song(), rm.dataset.removeBlock));
      ctx.ui.selected = null;
      ctx.changed();
      ctx.announce('Removed the chord.');
      return;
    }
    const more = e.target.closest('[data-block-more]');
    if (more) { ctx.openBlockVariants(more.dataset.blockMore); return; }
    const cell = e.target.closest('.cell');
    if (cell) {
      const lane = cell.dataset.lane;
      const step = Number(cell.dataset.step);
      let value = '.';
      ctx.commit('Edit drums', () => { value = toggleDrum(ctx.song(), lane, step); });
      if (value !== '.') ctx.preview.drum(lane, value === 'x' ? 1 : 0.7);
      ctx.changed();
      const again = scroller.querySelector(`.cell[data-lane="${lane}"][data-step="${step}"]`);
      if (again) { again.tabIndex = 0; again.focus({ preventScroll: true }); }
    }
  });
  scroller.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.grid, .chord-lane')) e.preventDefault();
  });

  /* ---------- Keyboard ---------- */

  scroller.addEventListener('keydown', (e) => {
    const cell = e.target.closest('.cell');
    if (cell) { drumKeys(e, cell); return; }
    if (!e.target.closest('.grid')) return;
    const song = ctx.song();
    const track = ctx.track();
    if (track === 'chords') return;
    const notes = track === 'bass' ? bassNotes(song) : song.tracks.melody.notes;
    const sel = ctx.ui.selected && ctx.ui.selected.type === 'note' ? notes.find((n) => n.id === ctx.ui.selected.id) : null;
    if (e.key === '[' || e.key === ']') {
      e.preventDefault();
      if (!notes.length) return;
      const i = sel ? notes.indexOf(sel) : -1;
      const next = notes[(i + (e.key === ']' ? 1 : -1) + notes.length) % notes.length];
      ctx.ui.selected = { type: 'note', id: next.id };
      ctx.preview.note(track, next.p);
      ctx.changed();
      ctx.announce(`${noteName(next.p)}, bar ${Math.floor(next.s / 16) + 1}, step ${(next.s % 16) + 1}, ${next.l} sixteenths`);
      return;
    }
    if (!sel) return;
    const snap = ctx.ui.snap;
    const act = {
      ArrowLeft: () => (e.shiftKey ? resizeNote(song, track, sel.id, sel.l - snap) : moveNote(song, track, sel.id, sel.s - snap, sel.p)),
      ArrowRight: () => (e.shiftKey ? resizeNote(song, track, sel.id, sel.l + snap) : moveNote(song, track, sel.id, sel.s + snap, sel.p)),
      ArrowUp: () => moveNote(song, track, sel.id, sel.s, sel.p + (e.shiftKey ? 12 : 1)),
      ArrowDown: () => moveNote(song, track, sel.id, sel.s, sel.p - (e.shiftKey ? 12 : 1)),
      Delete: () => removeNote(song, track, sel.id),
      Backspace: () => removeNote(song, track, sel.id),
    }[e.key];
    if (!act) return;
    e.preventDefault();
    ctx.commit('Edit note', () => {
      if (track === 'bass') freezeBass(song);
      act();
    });
    const n = findNote(song, track, sel.id);
    if (n) ctx.preview.note(track, n.p);
    else ctx.ui.selected = null;
    ctx.changed();
  });

  function drumKeys(e, cell) {
    const lane = cell.dataset.lane;
    const step = Number(cell.dataset.step);
    const lanes = [...new Set([...scroller.querySelectorAll('.cell')].map((c) => c.dataset.lane))];
    const total = totalSteps(ctx.song());
    let li = lanes.indexOf(lane);
    let s = step;
    if (e.key === 'ArrowRight') s = Math.min(total - 1, s + 1);
    else if (e.key === 'ArrowLeft') s = Math.max(0, s - 1);
    else if (e.key === 'ArrowDown') li = Math.min(lanes.length - 1, li + 1);
    else if (e.key === 'ArrowUp') li = Math.max(0, li - 1);
    else return;
    e.preventDefault();
    const next = scroller.querySelector(`.cell[data-lane="${lanes[li]}"][data-step="${s}"]`);
    cell.tabIndex = -1;
    next.tabIndex = 0;
    next.focus();
  }

  return {
    render,
    setPlayhead,
    dropStep,
    autoScroll(clientX, clientY) {
      const rect = scroller.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) autoScroll(clientX);
      else stopAutoScroll();
    },
    stopAutoScroll,
    scrollToStart() { scroller.scrollLeft = 0; },
    // Scroll so the middle of the pitch range (or the existing notes) is visible.
    centerPitch() {
      if (!gridEl) return;
      const song = ctx.song();
      const track = ctx.track();
      const [lo, hi] = range();
      const ps = track === 'chords' ? [...ctx.compiled().voicings.values()].flat() : noteRects(song, track).map((n) => n.p);
      const mid = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : (lo + hi) / 2;
      scroller.scrollTop = Math.max(0, (hi - mid) * ROW - scroller.clientHeight / 2 + RULER_H + LANE_H);
    },
    keyLabel: () => `${pretty(keyName(ctx.song().keyPc, ctx.song().mode))} ${ctx.song().mode}`,
    STEPS_PER_BAR,
  };
}
