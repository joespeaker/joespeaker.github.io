# One Minute Song

Spin a prompt, then make a song in 60 seconds in a small in-browser DAW. Lives at
[joebieker.com/oneminutesong](https://joebieker.com/oneminutesong/).

Plain HTML, CSS and JavaScript modules. No build step and no dependencies. Instruments
are real recordings (see [Sound credits](credits.html)) played through the Web Audio API.

## Run it locally

ES modules and `fetch()` need a real web server (opening `index.html` from disk won't
work). From the repo root:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/oneminutesong/
```

Add `?clock=10` to the URL for a 10-second clock while testing.

## Run the tests

Needs Node 18 or newer. Nothing to install.

```sh
cd oneminutesong
npm test
```

The tests cover:

- **Chord theory:** every key, mode and variant.
- **Voicing:** range and voice leading.
- **The song model:** placing, moving and stretching chords; adding, moving and resizing
  notes; the auto bass; drums; key and mode changes; mute and solo.
- **The compiler:** what plays on each step.
- **Share links:** v2 round-trips and old v1 links still convert.
- **Drum patterns, `prompts.json` and the WAV encoder.**

## Using the studio

There are four tracks: **Chords**, **Melody**, **Bass** and **Drums**. Pick one in the Tracks
panel to edit it. Each track row is also its mixer strip, with an instrument, mute (M),
solo (S) and volume.

- **Chords:**
  - Drag chords from the palette onto the chord lane, or tap a chord and then tap the
    lane. With a palette chord picked, tapping an existing chord replaces that part of it.
  - Drag a chord block to move it, drag its right edge to stretch it, or drag it well off
    the lane to remove it.
  - Tap a block twice for its options: change the chord, pick a variant, or reset its
    voicing.
  - In the piano roll, drag a chord note up or down to change the voicing.
  - Draw single notes in the chord roll's empty space (click and drag, or tap on touch).
    They play on the chords instrument, exactly as drawn, on top of the chord blocks.
  - "Play as" sets the rhythm: hold, half notes, quarters, offbeats, strummed 8ths or
    arpeggio.
- **Melody and bass:**
  - With a mouse, click and drag to draw a note.
  - On touch, tap to add a note and drag empty space to scroll.
  - Drag a note to move it, drag its right edge to resize it, and double-click or
    double-tap to delete it.
  - The bass follows your chords until you edit a note. "Follow chords again" switches
    it back.
- **Drums:** tap a step to cycle it through hit, accent and off. The pattern buttons fill
  the whole loop.
- **Transport:**
  - Play/stop, loop length (4, 8 or 16 bars), tempo, swing and reverb.
  - Undo and redo cover every edit.
  - Your song autosaves in the browser, and "Continue your last song" brings it back.

Keyboard:

- Space plays and stops. Ctrl/Cmd+Z undoes, and Ctrl/Cmd+Shift+Z redoes.
- In the palette: arrow keys move between chords, A adds the chord after the last one,
  and V opens its variants.
- In the piano roll (melody and bass): `[` and `]` pick the previous or next note, and
  arrow keys move it. Shift+←/→ resizes it and Shift+↑/↓ moves it by an octave. Delete
  removes it.
- In the drum grid: arrow keys move between steps, and Enter or Space toggles a step.
- Escape clears the current selection.

## Edit the prompts

Open `prompts.json` and add, remove or change lines in `topics`, `styles` or
`constraints`. If the file is missing or broken, the app falls back to a small built-in
list. Run `npm test` after editing to catch typos.

## How it's built

| Path | What it does |
| --- | --- |
| `js/song.js` | The song model and every edit (pure functions, fully tested) |
| `js/compile.js` | Turns a song into what plays on each 16th step; used by playback, export and the piano roll |
| `js/ui/editor.js` | Piano roll, chord lane and drum grid (pointer and keyboard editing) |
| `js/app.js` | Screens, palette, mixer panel, transport, undo, autosave, sharing, export |
| `js/theory.js`, `js/voicing.js` | Scales, chords, variants, voice leading |
| `js/audio/engine.js` | AudioContext and master chain (compressor, limiter, reverb) |
| `js/audio/mixer.js` | Per-track buses, levels, mute/solo |
| `js/audio/instruments.js` | Sampler: lazy loading, repitching, sustain loops |
| `js/audio/drums.js` | Drum kits and pattern presets |
| `js/audio/scheduler.js` | Lookahead scheduler (25ms timer, 100ms ahead) |
| `js/share.js`, `js/wav.js` | Share links and WAV export |
| `samples/` | Instrument samples (MP3) |
| `tools/fetch_samples.py` | Downloads, trims and encodes the samples |

The song is stored in 16th-note steps. Chords are blocks with a start, length, scale degree,
variant and optional pinned notes. Melody, bass and the chord roll's single notes are notes. Drums are one string per
lane (`x` accent, `o` hit, `g` ghost, `.` rest). Because chords store scale degrees,
changing the key transposes the whole song.

## Add an instrument

1. Add it to `PITCHED` in `tools/fetch_samples.py` (any FluidR3 GM instrument name works)
   and run `python3 oneminutesong/tools/fetch_samples.py`. It needs ffmpeg.
2. Add an entry to `INSTRUMENTS` in `js/audio/instruments.js` with its label, octaves,
   `gain`, `release` and `sustain`.
3. Add its id to `CHORD_INSTRUMENTS`, `MELODY_INSTRUMENTS` or `BASS_INSTRUMENTS`.
4. If it's offered for melody, add a `MELODY_TRIM` entry in `js/audio/mixer.js`.
5. Credit the source in `credits.html` if its license asks for it.

Instrument ids are stored by name in share links, so no format change is needed.

## Add a drum kit

Add an entry to `KITS` in `js/audio/drums.js`:

- **`voices`:** `kick`, `snare`, `hat`, `open` and optionally `ride`. Each is
  `(ac, out, time, velocity) => void`. Use `hit(…)` to play a sample from
  `samples/drums`, or synthesize the sound.
- **`patterns`:** `basic`, `driving`, `halftime` and `sparse`. Each lane is a 16-character
  string.
- **Optional `makeInsert` and `feel`.**

## Share links

The whole song is stored after `#` in the URL, so links need no server.

- **v2** (current): `#v2=z…` is compressed JSON (`CompressionStream`, deflate-raw),
  base64url. Browsers without compression write `#v2=j…`, which is plain JSON. The
  layout is documented in `js/share.js`. Ids are stored by name, but the `V1.variants`
  list is still used by index, so only append to it.
- **v1** (the first version, one chord per bar): still decodes, and is converted to the
  track model on open.

Every link shows the same preview card (`og-image.png`). The song sits after the `#`,
which never reaches a server, so per-song previews would need a backend.

## Audio download

"Download audio" renders the song twice through on an `OfflineAudioContext` with the same
master chain and mixer as live playback, then saves a 16-bit WAV. The decoded samples are
shared with the offline context, so nothing reloads.
