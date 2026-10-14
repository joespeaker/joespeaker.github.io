import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSong, decodeSong, V1 } from '../js/share.js';
import { encodeWav } from '../js/wav.js';
import { VARIANTS } from '../js/theory.js';
import { SYNTH_IDS } from '../js/audio/synths.js';
import { KIT_IDS, PATTERN_IDS } from '../js/audio/drums.js';

const base = {
  keyPc: 9, mode: 'minor', barCount: 4,
  bars: [{ degree: 0, variant: 'm7' }, null, { degree: 5, variant: 'maj7' }, { degree: 4, variant: 'min' }, null, null, null, null],
  synth: 'lofi', kit: 'garage', pattern: 'halftime',
  tempo: 87, swing: 0.42, reverb: 0.55, bass: false,
  topic: 'a gas station at 2am', style: '90s R&B', constraint: 'only 3 chords', title: 'Gas Station At 2am',
};

test('share link round-trips exactly', () => {
  const code = encodeSong(base);
  assert.match(code, /^v1=[A-Za-z0-9_-]+$/, 'URL-safe');
  assert.deepEqual(decodeSong(`#${code}`), base);
});

test('round-trips 8 bars, every variant, unicode text, and no constraint', () => {
  const variants = V1.variants;
  const bars = Array.from({ length: 8 }, (_, i) => ({ degree: i % 7, variant: variants[i % variants.length] }));
  const song = {
    ...base, keyPc: 6, mode: 'major', barCount: 8, bars, synth: 'pad', kit: 'none', pattern: 'basic',
    tempo: 160, swing: 0, reverb: 1, bass: true,
    topic: 'café crème at 3am 🌙', style: 'Beyoncé', constraint: '', title: 'Ünïcødé “quotes” & <tags>',
  };
  assert.deepEqual(decodeSong(encodeSong(song)), song);
  for (const v of variants) {
    const one = { ...base, bars: [{ degree: 0, variant: v }, null, null, null, null, null, null, null] };
    assert.deepEqual(decodeSong(encodeSong(one)).bars[0], { degree: 0, variant: v }, v);
  }
});

test('frozen v1 lists cover everything the app can produce', () => {
  assert.deepEqual([...V1.variants].sort(), Object.keys(VARIANTS).sort());
  assert.deepEqual([...V1.synths].sort(), [...SYNTH_IDS].sort());
  assert.deepEqual([...V1.kits].sort(), ['none', ...KIT_IDS].sort());
  assert.deepEqual([...V1.patterns].sort(), [...PATTERN_IDS].sort());
});

test('bad links decode to null or safe defaults', () => {
  assert.equal(decodeSong(''), null);
  assert.equal(decodeSong('#v2=abc'), null);
  assert.equal(decodeSong('#v1=!!!'), null);
  assert.equal(decodeSong('#v1=bm90anNvbg'), null); // "notjson"
  const weird = decodeSong(`#${encodeSong({ ...base, tempo: 999 })}`);
  assert.equal(weird.tempo, 100);
});

test('link stays short', () => {
  const song = { ...base, barCount: 8, bars: Array(8).fill({ degree: 3, variant: 'add9' }) };
  assert.ok(encodeSong(song).length < 260, `length ${encodeSong(song).length}`);
});

test('WAV header and samples', () => {
  const left = new Float32Array([0, 0.5, -1, 1]);
  const right = new Float32Array([0, -0.5, 1, 2]); // 2 clips to 1
  const buf = encodeWav([left, right], 44100);
  const v = new DataView(buf);
  const str = (o, n) => String.fromCharCode(...new Uint8Array(buf, o, n));
  assert.equal(str(0, 4), 'RIFF');
  assert.equal(str(8, 4), 'WAVE');
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getUint32(24, true), 44100);
  assert.equal(v.getUint32(40, true), 4 * 2 * 2);
  assert.equal(buf.byteLength, 44 + 16);
  assert.equal(v.getInt16(44 + 4 * 3 + 2, true), 32767); // last right sample clipped
  assert.equal(v.getInt16(44 + 4 * 2, true), -32768);    // -1
});
