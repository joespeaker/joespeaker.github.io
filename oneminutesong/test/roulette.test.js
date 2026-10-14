import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePrompts, pickOther, promptSentence, titleFromTopic, FALLBACK_PROMPTS } from '../js/roulette.js';

test('prompts.json is valid and non-empty', () => {
  const raw = JSON.parse(readFileSync(new URL('../prompts.json', import.meta.url)));
  const p = validatePrompts(raw);
  for (const key of ['topics', 'styles', 'constraints']) {
    assert.ok(p[key].length >= 3, `${key} has entries`);
    assert.equal(new Set(p[key]).size, p[key].length, `${key} has no duplicates`);
  }
});

test('bad or missing lists fall back', () => {
  const p = validatePrompts({ topics: ['  x  ', 3, ''], styles: 'nope' });
  assert.deepEqual(p.topics, ['x']);
  assert.deepEqual(p.styles, FALLBACK_PROMPTS.styles);
  assert.deepEqual(p.constraints, FALLBACK_PROMPTS.constraints);
});

test('pickOther never repeats when it can avoid it', () => {
  const list = ['a', 'b'];
  for (let i = 0; i < 50; i++) assert.equal(pickOther(list, 'a'), 'b');
  assert.equal(pickOther(['only'], 'only'), 'only');
});

test('sentence and title', () => {
  assert.equal(promptSentence({ topic: 'moving out', style: '90s R&B' }),
    'Write a song about moving out in the style of 90s R&B.');
  assert.equal(titleFromTopic('a gas station at 2am'), 'Gas Station At 2am');
  assert.equal(titleFromTopic('moving out'), 'Moving Out');
});
