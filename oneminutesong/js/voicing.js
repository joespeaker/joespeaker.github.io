// Close voicings between C3 and C5 with smooth voice leading. Pure, no audio.

export const LOW = 48;   // C3
export const HIGH = 72;  // C5
const CENTER = 60;

const mod12 = (n) => ((n % 12) + 12) % 12;
const mean = (a) => a.reduce((s, n) => s + n, 0) / a.length;

// Every close-position voicing of the given pitch classes (each inversion, each octave
// that fits in range). Extensions like add9 collapse into close position (C D E G).
export function closeVoicings(pcs, lo = LOW, hi = HIGH) {
  const uniq = [...new Set(pcs.map(mod12))];
  const out = [];
  for (let inv = 0; inv < uniq.length; inv++) {
    const order = uniq.slice(inv).concat(uniq.slice(0, inv));
    let base = lo;
    while (mod12(base) !== order[0]) base++;
    const stack = [base];
    for (const pc of order.slice(1)) {
      let n = stack[stack.length - 1] + 1;
      while (mod12(n) !== pc) n++;
      stack.push(n);
    }
    for (const shift of [0, 12, 24]) {
      const v = stack.map((n) => n + shift);
      if (v[0] >= lo && v[v.length - 1] <= hi) out.push(v);
    }
  }
  return out;
}

// How far the voices travel from one chord to the next.
export function movement(prev, next) {
  if (prev.length === next.length) {
    return prev.reduce((s, n, i) => s + Math.abs(n - next[i]), 0);
  }
  const near = (n, set) => Math.min(...set.map((m) => Math.abs(n - m)));
  return (next.reduce((s, n) => s + near(n, prev), 0) + prev.reduce((s, n) => s + near(n, next), 0)) / 2;
}

function pick(options, prev) {
  let best = null;
  let bestScore = Infinity;
  for (const v of options) {
    // Stay near the middle of the range so a long progression doesn't drift to an edge.
    let score = Math.abs(mean(v) - CENTER) * 0.35;
    if (prev) score += movement(prev, v);
    else if (mod12(v[0]) !== mod12(options[0][0])) score += 1; // first chord: prefer root position
    if (score < bestScore) { bestScore = score; best = v; }
  }
  return best;
}

export function voiceChord(pcs, prev = null) {
  return pick(closeVoicings(pcs), prev);
}

// Voice a whole looping progression. Two passes so the jump from the last chord back
// to the first is smooth too. `null` entries (empty bars) stay null.
export function voiceProgression(chordPcs) {
  const result = new Array(chordPcs.length).fill(null);
  let prev = null;
  for (let pass = 0; pass < 2; pass++) {
    chordPcs.forEach((pcs, i) => {
      if (!pcs) return;
      result[i] = voiceChord(pcs, prev);
      prev = result[i];
    });
  }
  return result;
}
