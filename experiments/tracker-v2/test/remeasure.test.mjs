// PREREG-TRACKER-H2 runner (experiments/tracker-v2/remeasure.mjs), $0 parts: the product's input is the conversation a build actually
// had (review M1), and the $0 literal baseline T-lit (review M4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ownWordsOf, conversationOf, literalsOf, tlitFlags } from '../remeasure.mjs';
import { wordsFor } from '../builder1.mjs';

const caseDef = { id: 'HX1', template: 't', request: 'remind clients at 30 days. send the summary to me',
  questions: [{ id: 'summaryTo', answer: 'maria@pixel.example' }, { id: 'cc', answer: 'cc ops@pixel.example' }] };

test('a build that asked nothing gets the request only, never the answer key', () => {
  const rec = { questions: [] };
  const conv = conversationOf(caseDef, rec);
  assert.equal(conv.same, false);
  assert.deepEqual(wordsFor(conv.synth), [{ turn: 0, kind: 'request', text: caseDef.request }]);
  assert.ok(!JSON.stringify(wordsFor(conv.synth)).includes('maria@'), 'the key answer the build never received is not in its words');
  assert.deepEqual(ownWordsOf(caseDef, rec), wordsFor(conv.synth));
});

test('answers equal to the key (in any order) reuse the key; a fallback or a merged answer is its own conversation', () => {
  const asked = (...answers) => ({ questions: answers.map((a, i) => ({ id: `x${i}`, answer: a })) });
  assert.deepEqual(conversationOf(caseDef, asked('cc ops@pixel.example', 'maria@pixel.example')), { same: true, id: 'HX1' });
  const fb = conversationOf(caseDef, asked('maria@pixel.example', 'cc ops@pixel.example', "I don't mind - use whatever you think is sensible."));
  assert.equal(fb.same, false); assert.match(fb.id, /^HX1~[0-9a-f]{8}$/);
  assert.equal(wordsFor(fb.synth).length, 4, 'request + the three answers, in the order asked');
  const merged = conversationOf(caseDef, asked('maria@pixel.example cc ops@pixel.example'));
  assert.equal(merged.same, false);
  assert.notEqual(merged.id, fb.id, 'distinct conversations get distinct ids');
  assert.equal(conversationOf(caseDef, asked('maria@pixel.example', 'cc ops@pixel.example', "I don't mind - use whatever you think is sensible.")).id, fb.id, 'and the same conversation the same id');
});

test('T-lit flags a build that drops an address, a #channel or a 2+ digit number from the words; one digit and a longer number are not matches', () => {
  const words = [{ turn: 0, kind: 'request', text: 'remind at 30 and 60 days, post in #billing, email maria@pixel.example. Do it 1 time.' }];
  assert.deepEqual(literalsOf(words).sort(), ['#billing', '30', '60', 'maria@pixel.example']);
  const ok = { nodes: [{ to: 'maria@pixel.example', channel: '#billing', days: [30, 60] }] };
  assert.deepEqual(tlitFlags(words, ok), { flagged: false, missing: 0 });
  assert.deepEqual(tlitFlags(words, { nodes: [{ to: 'Maria@Pixel.example', channel: '#billing', days: [30, 600] }] }), { flagged: true, missing: 1 }, '600 does not carry 60');
  assert.equal(tlitFlags(words, { nodes: [{ to: 'other@x.example', channel: '#billing', days: [30, 60] }] }).flagged, true);
});

test('T-lit± (post hoc) accepts the usual threshold encodings of a number, and still flags a dropped one', async () => {
  const { tlitTolerantFlags } = await import('../remeasure.mjs');
  const words = [{ turn: 0, kind: 'request', text: 'approve claims under $50, send to dana@x.example' }];
  assert.equal(tlitTolerantFlags(words, { max: 49.99, to: 'dana@x.example' }).flagged, false);
  assert.equal(tlitTolerantFlags(words, { max: 51, to: 'dana@x.example' }).flagged, false);
  assert.equal(tlitTolerantFlags(words, { max: 500, to: 'dana@x.example' }).flagged, true, '500 is not 50');
  assert.equal(tlitTolerantFlags(words, { max: 49.99, to: 'raj@x.example' }).flagged, true);
});
