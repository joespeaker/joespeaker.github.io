// Per-track buses (EQ + level) feeding the master chain, and "takes": one run of the
// transport whose notes can all be faded out and dropped at once.
//
//   take ─> chords: highpass 110Hz ─> level ─┐
//   take ─> melody: highpass 160Hz ─> level ─┤
//   take ─> bass:                     level ─┼─> dest (master dry bus)
//   take ─> drums:  kit inserts ─>    level ─┘

import { playNote } from './instruments.js';
import { createDrumRack, KITS } from './drums.js';
import { TRACK_IDS, audible } from '../song.js';

// Base level of each track at volume 100%, set by measuring the output so the default
// mix is balanced.
const TRACK_GAIN = { chords: 2.1, melody: 3.4, bass: 2.6, drums: 1.0 };
// Single-note lines sit higher than chords, where some samples are much quieter; these
// even the melody instruments out (measured with the same line on each).
const MELODY_TRIM = { vibes: 1.4, piano: 2.2, epiano: 0.67, lead: 1.35, strings: 0.96, guitar: 2.8, organ: 1.35 };
const STRUM_GAP = 0.014; // seconds between strings on a strummed chord

export function createMixer(ac, dest) {
  const buses = {};
  for (const id of TRACK_IDS) {
    const level = ac.createGain();
    level.gain.value = 0;
    level.connect(dest);
    let input = level;
    if (id === 'chords' || id === 'melody') {
      input = ac.createBiquadFilter();
      input.type = 'highpass';
      input.frequency.value = id === 'chords' ? 110 : 160;
      input.Q.value = 0.5;
      input.connect(level);
    }
    buses[id] = { input, level };
  }
  const drumRack = createDrumRack(ac, buses.drums.input);

  // Apply volume, mute and solo. Smoothed live; exact when rendering offline.
  function setLevels(song, smooth = true) {
    for (const id of TRACK_IDS) {
      const target = audible(song, id) ? song.tracks[id].vol * TRACK_GAIN[id] : 0;
      const g = buses[id].level.gain;
      if (smooth) g.setTargetAtTime(target, ac.currentTime, 0.02);
      else g.setValueAtTime(target, 0);
    }
  }

  function createTake() {
    const gains = {};
    const gainFor = (id) => {
      if (!gains[id]) {
        gains[id] = ac.createGain();
        gains[id].connect(buses[id].input);
      }
      return gains[id];
    };
    const drums = drumRack.createTake();
    return {
      // One compiled event (see compile.js) at audio time t.
      play(ev, t, stepDur) {
        if (ev.track === 'drums') {
          if (KITS[ev.kit] && KITS[ev.kit].voices[ev.lane]) drums.hit(ev.kit, ev.lane, t, ev.vel);
          return;
        }
        const dur = ev.l * stepDur;
        // Bigger chords play each note a little softer so 3- and 5-note chords match.
        let v = ev.notes.length > 1 ? ev.vel * Math.min(1, 1.6 / Math.sqrt(ev.notes.length)) : ev.vel;
        if (ev.track === 'melody') v *= Math.sqrt(MELODY_TRIM[ev.inst] || 1); // velocity is squared in playNote
        ev.notes.forEach((m, i) => {
          playNote(ac, gainFor(ev.track), ev.inst, m, t + (ev.strum ? i * STRUM_GAP : 0), dur - (ev.strum ? i * STRUM_GAP : 0), v);
        });
      },
      note(track, inst, midi, t, dur, vel = 0.8) {
        this.play({ track, inst, notes: [midi], l: dur, vel }, t, 1);
      },
      chord(track, inst, notes, t, dur, vel = 0.75) {
        this.play({ track, inst, notes, l: dur, vel }, t, 1);
      },
      drum(kit, lane, t, vel) {
        if (KITS[kit] && KITS[kit].voices[lane]) drums.hit(kit, lane, t, vel);
      },
      stop(fade = 0.06) {
        const now = ac.currentTime;
        for (const g of Object.values(gains)) {
          g.gain.setValueAtTime(g.gain.value, now);
          g.gain.linearRampToValueAtTime(0, now + fade);
          setTimeout(() => g.disconnect(), (fade + 0.1) * 1000);
        }
        drums.stop(fade);
      },
    };
  }

  return { buses, setLevels, createTake };
}
