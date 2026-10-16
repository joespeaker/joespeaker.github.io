import { newSong, newId, DRUM_LANES, RANGES, BAR_OPTIONS } from './song.js';

// Song <-> URL hash. Format: #v1=<base64url(JSON array)>.
//
// v1 payload (positional, so links stay short):
//   [keyPc, mode, barCount, bars, synth, kit, pattern, tempo, swing, reverb, bass,
//    topic, style, constraint, title]
//   mode: 0 major, 1 minor. bars: 2 chars per bar, "<degree><variant code>" or "--".
//   synth/kit/pattern/variant: indexes into the frozen lists below.
//   swing, reverb: integer percent. bass: 0/1. constraint: "" when off.
//
// These lists are part of the v1 format. Never reorder or remove entries; only append.
// A breaking change gets a new version (v2) and a new decoder, keeping v1 working.

export const V1 = {
  variants: ['maj', '7', 'maj7', '6', 'add9', 'sus2', 'sus4', 'min', 'm7', 'm9', 'madd9', 'dim', 'm7b5', 'dim7'],
  // The first five were synthesized voices; the sampled instruments were appended after.
  synths: ['pad', 'ep', 'pluck', 'organ', 'lofi', 'piano', 'epiano', 'strings', 'guitar'],
  kits: ['none', 'acoustic', 'electro', 'garage'],
  patterns: ['basic', 'driving', 'halftime', 'sparse'],
};

// Old synth voices that no longer exist, and the sampled instrument that replaces each.
const RETIRED_SYNTHS = { ep: 'epiano', pluck: 'guitar', lofi: 'epiano' };

const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code) {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeSong(song) {
  const bars = song.bars.slice(0, song.barCount)
    .map((b) => (b ? `${b.degree}${B36[V1.variants.indexOf(b.variant)]}` : '--'))
    .join('');
  const payload = [
    song.keyPc,
    song.mode === 'minor' ? 1 : 0,
    song.barCount,
    bars,
    V1.synths.indexOf(song.synth),
    V1.kits.indexOf(song.kit),
    V1.patterns.indexOf(song.pattern),
    song.tempo,
    Math.round(song.swing * 100),
    Math.round(song.reverb * 100),
    song.bass ? 1 : 0,
    song.topic || '',
    song.style || '',
    song.constraint || '',
    song.title || '',
  ];
  return `v1=${toBase64Url(JSON.stringify(payload))}`;
}

const clampInt = (n, lo, hi, dflt) => (Number.isInteger(n) && n >= lo && n <= hi ? n : dflt);
const str = (s, max) => (typeof s === 'string' ? s.slice(0, max) : '');

// Returns a song object, or null if the hash isn't a readable v1 link.
export function decodeSong(hash) {
  const m = /^#?v1=([A-Za-z0-9_-]+)$/.exec(hash || '');
  if (!m) return null;
  let p;
  try { p = JSON.parse(fromBase64Url(m[1])); } catch { return null; }
  if (!Array.isArray(p) || p.length < 15) return null;

  const barCount = p[2] === 8 ? 8 : 4;
  const bars = Array(8).fill(null);
  const barStr = typeof p[3] === 'string' ? p[3] : '';
  for (let i = 0; i < barCount; i++) {
    const chunk = barStr.slice(i * 2, i * 2 + 2);
    const degree = Number(chunk[0]);
    const variant = V1.variants[B36.indexOf(chunk[1])];
    if (chunk.length === 2 && degree >= 0 && degree <= 6 && variant) bars[i] = { degree, variant };
  }

  return {
    keyPc: clampInt(p[0], 0, 11, 0),
    mode: p[1] === 1 ? 'minor' : 'major',
    barCount,
    bars,
    synth: RETIRED_SYNTHS[V1.synths[p[4]]] || V1.synths[p[4]] || 'piano',
    kit: V1.kits[p[5]] || 'acoustic',
    pattern: V1.patterns[p[6]] || 'basic',
    tempo: clampInt(p[7], 70, 160, 100),
    swing: clampInt(p[8], 0, 100, 15) / 100,
    reverb: clampInt(p[9], 0, 100, 30) / 100,
    bass: p[10] !== 0,
    topic: str(p[11], 200),
    style: str(p[12], 200),
    constraint: str(p[13], 200),
    title: str(p[14], 60),
  };
}

/* ---------- v2: multi-track songs ----------
 *
 * #v2=<z|j><base64url>. "z" = deflate-raw compressed JSON (CompressionStream), "j" = plain
 * JSON for browsers without it. The JSON is a positional array:
 *   [2, keyPc, mode(0/1), bars, tempo, swing%, reverb%,
 *    chords: [inst, vol%, flags, style, [[s, l, degree, variant#, notes|0], …], [[s, l, pitch, vel%], …]],
 *    melody: [inst, vol%, flags, [[s, l, pitch, vel%], …]],
 *    bass:   [inst, vol%, flags, auto(1/0), [[s, l, pitch, vel%], …]],
 *    drums:  [kit, vol%, flags, pattern, kick, snare, hat, open, ride],  (grid rows as strings)
 *    [topic, style, constraint, title]]
 *   flags: bit 0 = mute, bit 1 = solo. Instrument and kit ids are stored by name.
 */


const pct = (x) => Math.round(x * 100);
const flags = (t) => (t.mute ? 1 : 0) | (t.solo ? 2 : 0);
const notesOut = (notes) => notes.map((n) => [n.s, n.l, n.p, pct(n.v)]);

function compact(song) {
  const t = song.tracks;
  return [
    2, song.keyPc, song.mode === 'minor' ? 1 : 0, song.bars, song.tempo, pct(song.swing), pct(song.reverb),
    [t.chords.inst, pct(t.chords.vol), flags(t.chords), t.chords.style,
      t.chords.blocks.map((b) => [b.s, b.l, b.d, V1.variants.indexOf(b.v), b.n || 0]), notesOut(t.chords.notes)],
    [t.melody.inst, pct(t.melody.vol), flags(t.melody), notesOut(t.melody.notes)],
    [t.bass.inst, pct(t.bass.vol), flags(t.bass), t.bass.auto ? 1 : 0, t.bass.auto ? [] : notesOut(t.bass.notes)],
    [t.drums.kit, pct(t.drums.vol), flags(t.drums), t.drums.pattern, ...DRUM_LANES.map((l) => t.drums.grid[l] || '')],
    [song.topic || '', song.style || '', song.constraint || '', song.title || ''],
  ];
}

const num = (n, lo, hi, dflt) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt);
const text = (s, max) => (typeof s === 'string' ? s.slice(0, max) : '');
const arr = (a) => (Array.isArray(a) ? a : []);

function trackCommon(target, [inst, vol, fl]) {
  if (typeof inst === 'string' && inst) target.inst = inst;
  target.vol = num(vol, 0, 100, 80) / 100;
  target.mute = Boolean(num(fl, 0, 3, 0) & 1);
  target.solo = Boolean(num(fl, 0, 3, 0) & 2);
}

function notesIn(list, [lo, hi], total) {
  return arr(list).filter(Array.isArray).map(([s, l, p, v]) => ({
    id: newId(), s: num(s, 0, total - 1, 0), l: num(l, 1, total, 1), p: num(p, lo, hi, lo), v: num(v, 1, 100, 80) / 100,
  }));
}

function expand(p) {
  if (!Array.isArray(p) || p[0] !== 2) return null;
  const song = newSong();
  song.keyPc = num(p[1], 0, 11, 0);
  song.mode = p[2] === 1 ? 'minor' : 'major';
  song.bars = BAR_OPTIONS.includes(p[3]) ? p[3] : 4;
  song.tempo = num(p[4], 70, 160, 100);
  song.swing = num(p[5], 0, 100, 15) / 100;
  song.reverb = num(p[6], 0, 100, 25) / 100;
  const total = song.bars * 16;
  const t = song.tracks;

  const c = arr(p[7]);
  trackCommon(t.chords, c);
  if (typeof c[3] === 'string') t.chords.style = c[3];
  t.chords.blocks = arr(c[4]).filter(Array.isArray).map(([s, l, d, v, n]) => ({
    id: newId(), s: num(s, 0, total - 1, 0), l: num(l, 1, total, 16), d: num(d, 0, 6, 0),
    v: V1.variants[v] || 'maj', n: Array.isArray(n) && n.length ? n.map((x) => num(x, RANGES.chords[0], RANGES.chords[1], 60)) : null,
  }));

  t.chords.notes = notesIn(c[5], RANGES.chords, total);

  const m = arr(p[8]);
  trackCommon(t.melody, m);
  t.melody.notes = notesIn(m[3], RANGES.melody, total);

  const b = arr(p[9]);
  trackCommon(t.bass, b);
  t.bass.auto = b[3] !== 0;
  t.bass.notes = t.bass.auto ? [] : notesIn(b[4], RANGES.bass, total);

  const d = arr(p[10]);
  t.drums.kit = typeof d[0] === 'string' && d[0] ? d[0] : 'acoustic';
  t.drums.vol = num(d[1], 0, 100, 80) / 100;
  t.drums.mute = Boolean(num(d[2], 0, 3, 0) & 1);
  t.drums.solo = Boolean(num(d[2], 0, 3, 0) & 2);
  if (typeof d[3] === 'string') t.drums.pattern = d[3];
  DRUM_LANES.forEach((lane, i) => {
    const row = d[4 + i];
    if (typeof row === 'string' && /^[xog.]*$/.test(row)) t.drums.grid[lane] = row.slice(0, 256);
  });

  const words = arr(p[11]);
  song.topic = text(words[0], 200);
  song.style = text(words[1], 200);
  song.constraint = text(words[2], 200);
  song.title = text(words[3], 60);
  return song;
}

async function pipeBytes(bytes, stream) {
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(out);
}

function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(code) {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function encodeSongV2(song) {
  const json = JSON.stringify(compact(song));
  const bytes = new TextEncoder().encode(json);
  if (typeof CompressionStream === 'function') {
    try { return `v2=z${bytesToB64url(await pipeBytes(bytes, new CompressionStream('deflate-raw')))}`; } catch { /* fall through */ }
  }
  return `v2=j${bytesToB64url(bytes)}`;
}

export async function decodeSongV2(hash) {
  const m = /^#?v2=([zj])([A-Za-z0-9_-]+)$/.exec(hash || '');
  if (!m) return null;
  try {
    let bytes = b64urlToBytes(m[2]);
    if (m[1] === 'z') {
      if (typeof DecompressionStream !== 'function') return null;
      bytes = await pipeBytes(bytes, new DecompressionStream('deflate-raw'));
    }
    return expand(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}
