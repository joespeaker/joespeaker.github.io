# One Minute Song

Spin a prompt, then build a song loop in 60 seconds. Lives at
[joebieker.com/oneminutesong](https://joebieker.com/oneminutesong/).

Plain HTML, CSS and JavaScript modules. No build step, no dependencies, no audio files:
every sound is synthesized with the Web Audio API.

## Run it locally

ES modules and `fetch('prompts.json')` need a real web server (opening `index.html` from
disk won't work). From the repo root:

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

- **Chord theory:** every key and mode gives the right diatonic chords, and every variant
  gives the right notes (C7 = C E G B♭, Cadd9 = C E G D, Cmaj7 = C E G B, and more).
- **Voicing:** every chord fits between C3 and C5 and moves smoothly to the next one.
- **Drum patterns:** every pattern is 16 steps and only uses sounds its kit has.
- **Prompts:** `prompts.json` is valid.
- **Share links:** every song round-trips through a link exactly.
- **WAV export:** the file header and samples are correct.

## Edit the prompts

Open `prompts.json` and add, remove or change lines. There are three lists:

```json
{
  "topics": ["a gas station at 2am", "moving out"],
  "styles": ["90s R&B", "Stevie Wonder"],
  "constraints": ["only 3 chords", "use a sus chord"]
}
```

- **Topics** read after "Write a song about…".
- **Styles** read after "…in the style of", so genres, eras and artist names all work.
- **Constraints** are optional challenges shown under the prompt. The app doesn't enforce them.

If the file is missing or has a typo, the app falls back to a small built-in list instead
of breaking. Run `npm test` after editing to catch mistakes.

## Add a synth

Synths live in `js/audio/synths.js`. Add an entry to `SYNTHS`:

```js
bells: {
  label: 'Bells',                 // shown on the button
  rhythm: [[0, 4], [8, 4]],       // [16th step it starts on, length in 16ths]
  level: 0.15,                    // output level (other synths sit at about 0.1 to 0.2)
  makeInsert(ac) { ... },         // optional: shared effects, return { input, output }
  note(ac, dest, freq, time, duration) {
    // build oscillators/filters for ONE note, connect to dest
  },
},
```

Then add the new id to the **end** of `V1.synths` in `js/share.js`, or share links can't
store it. The tests will remind you if you forget.

## Add a drum kit

Kits live in `js/audio/drums.js`. Add an entry to `KITS` with:

- **`voices`:** a function for each sound (`kick`, `snare`, `hat`, `open`, optionally
  `ride`), each `(ac, out, time, velocity) => void`.
- **`patterns`:** `basic`, `driving`, `halftime` and `sparse`. Each lane is a 16-character
  string: `x` accent, `o` normal, `g` ghost, `.` rest.
- **Optional `makeInsert(ac)`:** kit-wide color such as saturation or filtering.
- **Optional `feel`:** extra swing, timing jitter and velocity variation.

Then append the kit id to the **end** of `V1.kits` in `js/share.js`.

## Share links

The whole song is stored in the URL after `#v1=`, so links work without a server. The
lists in `js/share.js` (`V1.variants`, `V1.synths`, `V1.kits`, `V1.patterns`) are part of
the link format:

- **Only append.** Never reorder or remove entries, or old links will decode to the wrong
  song.
- **Breaking changes** go in a new `v2` format with its own decoder, keeping `v1` working.

Every shared link shows the same preview card (`og-image.png`). The song data sits after
the `#`, which never reaches a server, so per-song preview images would need a backend.

## Audio download

"Download audio" renders the loop twice through on an `OfflineAudioContext`, using the
same master chain as live playback, and saves it as a 16-bit WAV.

This replaced a `MediaRecorder` capture for three reasons:

- It doesn't depend on which codecs the browser has. Safari's support is patchy.
- It doesn't make you wait in real time.
- Every audio app can open a WAV file.

## Files

| Path | What it does |
| --- | --- |
| `index.html` | All four screens: spin, studio, result, listen |
| `css/app.css` | Styles, light and dark |
| `js/app.js` | UI, flow, timer, sharing and export wiring |
| `js/theory.js` | Scales, diatonic chords, variants, note spelling |
| `js/voicing.js` | Close voicings and voice leading |
| `js/roulette.js` | Loads prompts and picks reels |
| `js/share.js` | Song ↔ URL encoding |
| `js/wav.js` | WAV encoder |
| `js/audio/engine.js` | AudioContext, master chain (compressor, limiter, reverb) |
| `js/audio/scheduler.js` | Lookahead scheduler (25ms timer, 100ms ahead) |
| `js/audio/synths.js` | The 5 chord synths and the bass |
| `js/audio/drums.js` | The 3 drum kits and their patterns |
| `prompts.json` | Topic, style and constraint lists |
| `test/` | Node unit tests |
