// The ledger's mechanical checks ($0): verbatim quotes, coverage list, duplicates, ids, context, the user's edits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { indexText, buildLedger, applyEdits, isNormative, contextQuotes, quoteHashOf, KIND_NAMES } from '../ledger.mjs';
import { frozenSpecE } from '../eval-e8.mjs';

// The frozen SPEC-E (git 48535bb): the line numbers and sha256 below are that text's (the working-tree file has moved).
const SPEC = frozenSpecE();
const L162 = 'If a batch comes back `partial`, resubmit only the failed items, with their original keys, inside the same window.';

test('quotes locate verbatim (whitespace-normalised), or without markdown marks (flagged), or not at all', () => {
  const ix = indexText(SPEC);
  assert.equal(ix.sha256, 'c013c04c80636682f46fd9bdbc2bf436712ed53233b03a06ba74bd88824f8cf1');
  const a = ix.locate(L162);
  assert.deepEqual([a.line, a.lineEnd, a.match], [161, 162, 'exact']);
  assert.equal(ix.locate(L162.replace(' resubmit', '\n   resubmit')).line, 161, 'line breaks and indentation do not matter');
  const m = ix.locate('Within 60 min of p: read inventory.allocate and record the order with orders.create');
  assert.deepEqual([m.line, m.match], [104, 'markup'], 'bold and code marks may be dropped, and the entry says so');
  assert.equal(ix.locate('If a batch comes back partial, release every item.'), null, 'a paraphrase does not locate');
  assert.equal(ix.locate('the').line, 3, 'the first occurrence wins');
});

test('sentences and normative cues', () => {
  const ix = indexText('# Title\n\nIntro text here. You must ship within 2 days.\n\n- Never refund twice.\n  It costs money.\n\n| a | b |\n|---|---|\n| x | only when paid |\n');
  const s = ix.sentences().map(x => [x.line, x.text]);
  assert.deepEqual(s, [[3, 'Intro text here.'], [3, 'You must ship within 2 days.'], [5, '- Never refund twice.'], [6, 'It costs money.'], [8, '| a | b |'], [10, '| x | only when paid |']]);
  assert.deepEqual(s.filter(([, t]) => isNormative(t)).map(([l]) => l), [3, 5, 10]);
});

test('buildLedger: invented quotes and unknown kinds are dropped and counted, duplicates merged, ids by position, context resolved', () => {
  const entries = [
    { quote: L162, kind: 'when-then', summary: 'partial -> resubmit failed items', context: ['**Reserve** every item of the fulfilment at its location (`inventory.reserve`), within **120 min** of t.', 'R1.1 Within **60 min** of `p`'] },
    { quote: 'R1.1 Within **60 min** of `p`: read `inventory.allocate` and record the order with `orders.create`', kind: 'deadline', summary: 'create within 60 min', context: [] },
    { quote: 'If a batch comes back partial, release every item and refund.', kind: 'when-then', summary: 'invented', context: [] },
    { quote: 'R2.1 Read `fraud.check` for every new order.', kind: 'sometimes', summary: 'bad kind', context: [] },
    { quote: `  ${L162}  `, kind: 'when-then', summary: 'do not release instead', context: [] },
  ];
  const l = buildLedger({ text: SPEC, source: { file: 'beds/ebed/e8/spec/SPEC-E.md' }, entries, extractor: { model: 'scripted' } });
  assert.equal(l.source.sha256, 'c013c04c80636682f46fd9bdbc2bf436712ed53233b03a06ba74bd88824f8cf1');
  assert.deepEqual(l.requirements.map(r => [r.id, r.span.line]), [['Q-001', 104], ['Q-002', 161]], 'ids follow the text');
  assert.deepEqual(l.dropped.map(d => d.why), ['not a verbatim span of the text', 'unknown kind "sometimes"']);
  const q2 = l.requirements[1];
  assert.equal(q2.merged, 1);
  assert.match(q2.summary, /partial -> resubmit failed items; also: do not release instead/);
  assert.deepEqual(q2.context, ['Q-001'], 'a context quote inside another entry becomes its id');
  assert.equal(q2.contextText.length, 1);
  assert.equal(q2.contextText[0].span.line, 161, 'step 1 of R4.2 starts on line 161');
  assert.deepEqual(contextQuotes(l, q2).length, 2);
  assert.equal(q2.confirmed, false);
  assert.ok(l.uncovered.some(u => u.line === 122 && /fraud\.check/.test(u.text)), 'a missed rule shows up as uncovered');
  assert.ok(!l.uncovered.some(u => /comes back `partial`/.test(u.text)), 'a quoted sentence is covered');
  assert.ok(l.uncovered.some(u => u.line === 161 && /\*\*Reserve\*\*/.test(u.text)), 'a context quote is not coverage: the sentence before it on line 161 is still listed');
  assert.ok(KIND_NAMES.includes(q2.kind));
});

test('the user edits: confirm, edit (version bump, property dropped), add a selected span, delete; each logged', () => {
  const base = buildLedger({ text: SPEC, entries: [{ quote: L162, kind: 'when-then', summary: 's', context: [] }] });
  base.requirements[0].check = { version: 1, fn: '(t, h) => []', contrastOk: true, quoteHash: quoteHashOf(L162) };
  let i = 0;
  const now = () => `2026-10-14T00:00:0${i++}Z`;
  const l = applyEdits(base, SPEC, [
    { op: 'confirm', id: 'Q-001' },
    { op: 'edit', id: 'Q-001', summary: 'resubmit, never release first', reason: 'clarify' },
    { op: 'add', quote: 'R2.1 Read `fraud.check` for every new order.', kind: 'must', summary: 'fraud check for each order' },
  ], { now });
  const q = l.requirements.find(r => r.id === 'Q-001');
  assert.equal(q.confirmed, true);
  assert.deepEqual(q.check, { version: 2, fn: null, rewrite: true }, 'the property is rewritten from the edited entry');
  const u = l.requirements.find(r => r.source === 'user-added');
  assert.equal(u.id, 'U-002');
  assert.equal(u.span.line, 122);
  assert.ok(!l.uncovered.some(x => x.line === 122), 'coverage is recomputed');
  assert.deepEqual(l.log.map(x => [x.op, x.id]), [['confirm', 'Q-001'], ['edit', 'Q-001'], ['add', 'U-002']]);
  assert.equal(l.log[1].reason, 'clarify');
  assert.throws(() => applyEdits(l, SPEC, [{ op: 'add', quote: 'ship everything at once', kind: 'must', summary: 'x' }]), /not a verbatim span/);
  assert.throws(() => applyEdits(l, `${SPEC}\nmore`, [{ op: 'confirm', id: 'Q-001' }]), /sha256 differs/);
  const d = applyEdits(l, SPEC, [{ op: 'delete', id: 'U-002', reason: 'dup' }]);
  assert.equal(d.requirements.length, 1);
  assert.equal(base.requirements[0].check.version, 1, 'edits never mutate the input ledger');
});
