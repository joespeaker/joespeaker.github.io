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
  synths: ['pad', 'ep', 'pluck', 'organ', 'lofi'],
  kits: ['none', 'acoustic', 'electro', 'garage'],
  patterns: ['basic', 'driving', 'halftime', 'sparse'],
};

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
    synth: V1.synths[p[4]] || 'ep',
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
