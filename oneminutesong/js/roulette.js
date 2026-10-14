// Prompt roulette: loads prompts.json and picks topic / style / constraint. Pure apart from fetch.

export const REELS = ['topic', 'style', 'constraint'];

const LIST_FOR = { topic: 'topics', style: 'styles', constraint: 'constraints' };

// Used if prompts.json can't be fetched (e.g. the page was opened straight from disk).
export const FALLBACK_PROMPTS = {
  topics: ['a gas station at 2am', 'moving out', 'your first car'],
  styles: ['90s R&B', 'bedroom indie', 'Stevie Wonder'],
  constraints: ['only 3 chords', 'no drums for the first 2 bars', 'use a sus chord'],
};

export async function loadPrompts(url = 'prompts.json') {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.statusText);
    return validatePrompts(await res.json());
  } catch {
    return FALLBACK_PROMPTS;
  }
}

export function validatePrompts(data) {
  const out = {};
  for (const key of Object.values(LIST_FOR)) {
    const list = Array.isArray(data?.[key]) ? data[key].filter((s) => typeof s === 'string' && s.trim()) : [];
    out[key] = list.length ? list.map((s) => s.trim()) : FALLBACK_PROMPTS[key];
  }
  return out;
}

export function listFor(prompts, reel) {
  return prompts[LIST_FOR[reel]];
}

// Random entry, avoiding the current one when there's a choice.
export function pickOther(list, current, rand = Math.random) {
  if (list.length <= 1) return list[0];
  let next = current;
  while (next === current) next = list[Math.floor(rand() * list.length)];
  return next;
}

export function promptSentence({ topic, style }) {
  return `Write a song about ${topic} in the style of ${style}.`;
}

// Default song title from the topic: drop a leading article, capitalize each word.
// "a gas station at 2am" -> "Gas Station At 2am"
export function titleFromTopic(topic) {
  const t = topic.replace(/^(a|an|the|your|my)\s+/i, '');
  return t.replace(/(^|\s)(\S)/g, (_, sp, ch) => sp + ch.toUpperCase());
}
