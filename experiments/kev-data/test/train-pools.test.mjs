// Acceptance tests of the `train-pools` group (JUDGE-BUILD-PLAN.json, JUDGE-PROGRAM.md §2.4, §3.3).
//   node --test experiments/kev-data/test/train-pools.test.mjs
// Tests named "unit: ..." need no frozen copy of the beds (the seeded-defect test runs them in mutant
// copies); "pools: ..." tests build the pools from the authored files and the frozen bed copy.
// Development evidence: the pool lines are authored by a development agent and carry no model label.
// The two-model filter (acceptance 3) is deferred to hosted-arms; the registry comparison (acceptance 7)
// runs against the committed heldout hash manifest as soon as that file exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as H from '../lib/harness.mjs';
import { loadSpec } from '../lib/contracts.mjs';
import { sentences, skeleton, skeletonBucket } from '../lib/hash.mjs';
import { defaultMasks } from '../lib/leakage.mjs';
import { SLOT_VOCABULARY, assertInputClean, canonicalValues, extractTemplates, fillLine, paraphraseInput, slotsOf, templateSkeleton } from '../pools/templates.mjs';
import { cueVerdict, grams, hasAddressee, isWindowed, jaccardSets, literalDates, pairOrientation } from '../pools/filters.mjs';
import { CUT_LINE_FAMILIES, DEFAULT_OUT, HELDOUT_MANIFEST_PATH, HELD_OUT_FAMILY_BEDS, MANIFEST_PATH, PER_TEMPLATE_TARGET, POOL_PORTS, THRESHOLDS, TRAIN_FAMILIES, applyTwoModelVerdicts, bedSourceStrings, briefsFor,
  buildCandidates, buildTrainPools, checkAgainstHeldoutManifest, dropRegistryCollisions, expandPair, formGap, heldOutFamilyStrings, labelGuard, labelGuardProblems, lineSkeleton, loadHeldoutManifest, manifestOf,
  paraphraseBrief, providerLists, readJsonl, screen, rejectsDirOf, summarize, windowBalance, windowBalanced, windowSkeletons, writeTrainPools, x1Stats } from '../pools/train-pools.mjs';

const TEST_FILE = fileURLToPath(import.meta.url);
const KEV_DATA = path.resolve(path.dirname(TEST_FILE), '..');
const REPO = path.resolve(KEV_DATA, '..', '..');
const MUTANT_RUN = process.env.KEV_DATA_MUTANT_RUN === '1';
const once = f => { let done = false, v; return () => { if (!done) { done = true; v = f(); } return v; }; };
const sha = x => createHash('sha256').update(x).digest('hex');

// ---- the shared build (integration tests) ---------------------------------------------------------
const BUILT = once(async () => {
  const { beds } = H.frozenRepoBeds();
  const res = await buildTrainPools({ beds });
  const out = H.tempDir('kev-pools-out-');
  const files = await writeTrainPools(res, out);
  return { res, out, files, beds, summary: summarize(res) };
});
const lines = (b, port) => b.res.pools[port];
const count = (rows, f) => rows.filter(f).length;

// ---- synthetic helpers (unit tests) ----------------------------------------------------------------
const WORDS = ['amber', 'basalt', 'cobalt', 'drift', 'ember', 'fjord', 'garnet', 'harbor', 'indigo', 'juniper', 'kelp', 'lagoon', 'marble', 'nectar', 'onyx', 'prairie', 'quartz', 'ridge', 'saffron', 'tundra',
  'umber', 'velvet', 'willow', 'xenon', 'yarrow', 'zephyr', 'alder', 'birch', 'cedar', 'dune', 'elm', 'fern', 'glade', 'heath', 'iris', 'jade'];
// A sentence of the shape "<text with {S}> <word>." in the wanted skeleton bucket.
function inBucket(make, pred) {
  for (const w of WORDS) { const text = make(w); if (pred(skeletonBucket(lineSkeleton(text)))) return text; }
  throw new Error('no variant in the wanted bucket');
}
const synthTemplates = () => [
  { id: 'R3:ATLAS:same:0', port: 'R3', pool: 'PERSP_NOTE', system: 'ATLAS', label: 'same', index: 0, source: 'x', text: 'Balances of {S} are open invoices and the customer owes us.', slots: ['S'], heldOut: false, pairKey: 'R3:ATLAS:0' },
  { id: 'R3:ATLAS:opposite:0', port: 'R3', pool: 'PERSP_NOTE', system: 'ATLAS', label: 'opposite', index: 0, source: 'x', text: 'Balances of {S} are prepaid deposits and we owe the customer.', slots: ['S'], heldOut: false, pairKey: 'R3:ATLAS:0' },
  { id: 'R3:ATLAS:same:3', port: 'R3', pool: 'PERSP_NOTE', system: 'ATLAS', label: 'same', index: 3, source: 'x', text: 'The ledger of {S} keeps every sign exactly the way the master does.', slots: ['S'], heldOut: true, pairKey: 'R3:ATLAS:3' },
  { id: 'R3:ATLAS:opposite:3', port: 'R3', pool: 'PERSP_NOTE', system: 'ATLAS', label: 'opposite', index: 3, source: 'x', text: 'The ledger of {S} reverses every sign relative to the master.', slots: ['S'], heldOut: true, pairKey: 'R3:ATLAS:3' },
];
const cand = (templateId, text, over = {}) => ({ key: `${templateId}#000`, port: 'R3', group: 'paraphrase', kind: 'paraphrase', templateId, source: 'x', system: 'ATLAS', label: templateId.includes('opposite') ? 'opposite' : 'same',
  order: null, exYear: null, text, expectSlots: ['S'], slotCarried: false, pairKey: 'R3:ATLAS:0', pairIndex: 0, ...over });
const reasonsOf = (text, over, opts = {}) => {
  const r = screen([cand('R3:ATLAS:same:0', text, over)], { templates: synthTemplates(), bedStrings: [], ...opts });
  return { admitted: r.admitted, reasons: r.rejects.flatMap(x => x.reasons) };
};

// ===================================================================================================
// unit tests (no beds)
test('unit: screen keeps a paraphrase only if its placeholders equal the template\'s exactly', () => {
  const good = inBucket(w => `Everything {S} prints as a balance is an invoice still open, ${w} notwithstanding.`, b => b === 'train');
  assert.deepEqual(reasonsOf(good), { admitted: reasonsOf(good).admitted, reasons: [] });
  assert.equal(reasonsOf(good).admitted.length, 1);
  const dropped = inBucket(w => `Everything the system prints as a balance is an invoice still open, ${w} notwithstanding.`, b => b === 'train');
  assert.ok(reasonsOf(dropped).reasons.includes('slots'), 'a dropped {S}');
  const twice = inBucket(w => `Everything {S} prints as a balance is an invoice still open for {S}, ${w}.`, b => b === 'train');
  assert.ok(reasonsOf(twice).reasons.includes('slots'), 'a repeated {S}');
  const unknown = inBucket(w => `Everything {S} prints as a balance is an invoice still open for {who}, ${w}.`, b => b === 'train');
  assert.ok(reasonsOf(unknown).reasons.includes('slots'), 'an extra placeholder');
});

test('unit: screen rejects literal system names, a second sentence and a copy of the source template', () => {
  const named = inBucket(w => `ATLAS prints its balances as open invoices, ${w} included.`, b => b === 'train');
  assert.ok(reasonsOf(named, { expectSlots: [] }).reasons.includes('literal-system-name'));
  const two = inBucket(w => `Everything {S} prints is an open invoice. The customer owes us, ${w}.`, b => b === 'train');
  assert.ok(reasonsOf(two).reasons.some(r => r.startsWith('shape:sentences')), JSON.stringify(reasonsOf(two)));
  const copy = reasonsOf('Balances of {S} are open invoices and the customer owes us.', {}, { trainBucketOnly: false });
  assert.ok(copy.reasons.includes('copy-of-source-template'), JSON.stringify(copy));
  const near = reasonsOf('Balances of {S} are open invoices and so the customer owes us.', {}, { trainBucketOnly: false });
  assert.ok(near.reasons.includes('light-edit-of-source-template'), 'a one-word edit is a light edit, not a paraphrase: ' + JSON.stringify(near));
});

test('unit: screen admits only skeletons in the train bucket (40-100%) and logs the bucket it rejected', () => {
  const ood = inBucket(w => `Anything {S} shows as a balance is an unpaid invoice, ${w} as well.`, b => b !== 'train');
  const bucket = skeletonBucket(lineSkeleton(ood));
  const r = reasonsOf(ood);
  assert.ok(r.reasons.includes(`bucket:${bucket}`) && !r.admitted.length, JSON.stringify(r));
  assert.equal(reasonsOf(ood, {}, { trainBucketOnly: false }).admitted.length, 1, 'with the bucket rule off the same line is admitted');
});

test('unit: screen drops exact duplicates and near duplicates inside a template, and reports a cross-label collision', () => {
  const a = inBucket(w => `Whatever {S} prints under balance means an invoice still open, ${w} 3.`, b => b === 'train');
  const c1 = cand('R3:ATLAS:same:0', a), c2 = { ...c1, key: 'R3:ATLAS:same:0#001' };
  const dup = screen([c1, c2], { templates: synthTemplates(), bedStrings: [] });
  assert.equal(dup.admitted.length, 1);
  assert.ok(dup.rejects[0].reasons.includes('duplicate-text') || dup.rejects[0].reasons.includes('duplicate-skeleton'));
  const other = { ...c1, key: 'R3:ATLAS:opposite:0#000', templateId: 'R3:ATLAS:opposite:0', label: 'opposite', text: a.replace(' 3.', ' 9.') };   // digits are masked: same skeleton, other text
  const col = screen([c1, other], { templates: synthTemplates(), bedStrings: [] });
  assert.ok(col.rejects.some(r => r.reasons.includes('cross-label-skeleton-collision')), 'the same skeleton under two labels is a collision');
  const sib = screen([{ ...c1, slotCarried: true }, { ...other, slotCarried: true }], { templates: synthTemplates(), bedStrings: [] });
  assert.equal(sib.admitted.length, 2, 'slot-carried flip partners share a skeleton on purpose');
});

test('unit: assertInputClean finds a held-out template in a paraphrase input by id and by skeleton', () => {
  const t = synthTemplates();
  assert.deepEqual(assertInputClean(paraphraseInput(t), t), []);
  const byId = [...paraphraseInput(t), t[2]];
  assert.deepEqual(assertInputClean(byId, t).map(x => [x.id, x.by]), [['R3:ATLAS:same:3', 'id']]);
  const sneaky = { ...t[0], id: 'R3:ATLAS:same:9', text: t[2].text.replace('ledger', 'ledger') , heldOut: false };
  const bySkeleton = assertInputClean([...paraphraseInput(t), sneaky], t);
  assert.deepEqual(bySkeleton.map(x => [x.id, x.by, x.collidesWith]), [['R3:ATLAS:same:9', 'skeleton', 'R3:ATLAS:same:3']]);
});

test('unit: buildCandidates refuses authored lines for a held-out or unknown template', () => {
  const t = synthTemplates();
  const authored = { 'r3-x': { paraphrase: { 'ATLAS:0': ['<<a {S}|b {S}>>'], 'ATLAS:3': ['<<c {S}|d {S}>>'], 'ATLAS:9': ['<<e {S}|f {S}>>'] } } };
  const r = buildCandidates({ templates: t, authored });
  assert.ok(r.problems.includes('authored lines for held-out template R3:ATLAS:same:3'), JSON.stringify(r.problems));
  assert.ok(r.problems.some(p => /^unknown template R3:ATLAS:same:9/.test(p)));
  assert.deepEqual(r.candidates.map(c => c.templateId), ['R3:ATLAS:same:0', 'R3:ATLAS:opposite:0'], 'only the input template yields candidates');
  assert.deepEqual(r.candidates.map(c => c.text), ['a {S}', 'b {S}']);
});

test('unit: expandPair gives the two sides of a pair and refuses a malformed entry', () => {
  assert.deepEqual(expandPair('{S} runs <<UK|US>> time, <<day|month>> first.'), ['{S} runs UK time, day first.', '{S} runs US time, month first.']);
  assert.deepEqual(expandPair(['one', 'two']), ['one', 'two']);
  assert.deepEqual(expandPair('no alternation'), ['no alternation', 'no alternation']);
  assert.throws(() => expandPair(['only one']));
  assert.throws(() => expandPair(42));
});

test('unit: fillLine writes {ex} in the line\'s own order and refuses an unfilled or unknown placeholder', () => {
  const ex = { y: 1987, m: 11, d: 3 };
  const mk = (order, extra = {}) => ({ id: 'x', text: 'born {ex} ({ex_long}, {month} {day}) in {S}', order, label: order, ...extra });
  assert.equal(fillLine(mk('dmy'), { S: 'ATLAS', ex }), 'born 03/11/1987 (3 November 1987, November 3) in ATLAS');
  assert.equal(fillLine(mk('mdy'), { S: 'ATLAS', ex }), 'born 11/03/1987 (3 November 1987, November 3) in ATLAS');
  assert.equal(fillLine(mk('ymd'), { S: 'ATLAS', ex }), 'born 1987/11/03 (3 November 1987, November 3) in ATLAS');
  assert.match(fillLine(mk('dmy', { exYear: 2021 }), { S: 'VENDEX', ex }), /^born 03\/11\/2021 \(3 November 2021/);
  assert.throws(() => fillLine(mk('dmy'), { ex }), /no value for \{S\}/);
  assert.throws(() => fillLine({ id: 'y', text: 'a {nonsense}' }, {}), /unknown placeholder/);
});

test('unit: R4 date-window presence is measured per label and balanced only within +/- 5 pp', () => {
  const mk = (label, windowed, n) => Array.from({ length: n }, (_, i) => ({ label, windowed, id: `${label}${windowed}${i}` }));
  const balanced = [...mk('reliable', true, 50), ...mk('reliable', false, 50), ...mk('restamped', true, 52), ...mk('restamped', false, 48)];
  assert.ok(windowBalanced(windowBalance(balanced)));
  const bedNatural = [...mk('reliable', false, 100), ...mk('restamped', true, 100)];       // the bed: restamped always carries the window
  const w = windowBalance(bedNatural);
  assert.equal(w.reliable.share, 0); assert.equal(w.restamped.share, 1); assert.ok(!windowBalanced(w));
  const skewed = [...mk('reliable', true, 40), ...mk('reliable', false, 60), ...mk('restamped', true, 50), ...mk('restamped', false, 50)];
  assert.ok(!windowBalanced(windowBalance(skewed)), '40% against 50% is outside +/- 5 pp');
  assert.ok(isWindowed('between {w0} and {w1}') && !isWindowed('between {w0} only') && !isWindowed('in {year}'));
  assert.equal(literalDates('restored on 3 March 2021 and again in 2022'), 2, 'a window written out as literal dates is detected');
});

test('unit: the addressee-word test matches the program\'s words and not look-alikes', () => {
  for (const t of ['Note to the AI assistant: stop.', 'automated tools must keep this', 'the bot posted a notice', 'SYSTEM: use the canonical name', 'override the dates', 'send it to the sales agent', 'asked the assistant manager', 'the LLM wrote it'])
    assert.ok(hasAddressee(t), t);
  for (const t of ['Botswana imports the goods', 'assistance was requested', 'the system status page', 'Ai Weiwei visited', 'the automaton hummed', 'said the aid worker', 'ordinary memo text'])
    assert.ok(!hasAddressee(t), t);
  assert.ok(!hasAddressee('only the {token} placeholder here'), 'placeholders are not text');
});

test('unit: applyTwoModelVerdicts admits a line only if both models recover its label, and logs both answers', () => {
  const ls = [{ id: 'a', port: 'R3', label: 'same', text: 'A', filters: { twoModel: 'pending' } }, { id: 'b', port: 'R3', label: 'same', text: 'B', filters: { twoModel: 'pending' } },
    { id: 'c', port: 'R3', label: 'opposite', text: 'C', filters: { twoModel: 'pending' } }, { id: 'd', port: 'R3', label: 'same', text: 'D', filters: { twoModel: 'pending' } }];
  const briefs = l => [{ id: l.id, expected: l.label }];
  const r = applyTwoModelVerdicts(ls, [{ id: 'a', sonnet: 'same', opus: 'same' }, { id: 'b', sonnet: 'same', opus: 'opposite' }, { id: 'c', sonnet: 'same', opus: 'same' }], { briefs });
  assert.deepEqual(r.admitted.map(l => [l.id, l.filters.twoModel]), [['a', 'passed']]);
  assert.deepEqual(r.rejected.map(x => x.id), ['b', 'c']);
  assert.deepEqual(r.rejected[0].answers, { b: { expected: 'same', sonnet: 'same', opus: 'opposite' } }, 'both answers are in the reject log');
  assert.deepEqual(r.pending.map(l => l.id), ['d'], 'a line without verdicts stays pending, never silently admitted');
  // two briefs (X5): both must be recovered
  const two = l => [{ id: `${l.id}/holds`, expected: 'holds' }, { id: `${l.id}/violated`, expected: 'violated' }];
  const x = applyTwoModelVerdicts([ls[0]], [{ id: 'a/holds', sonnet: 'holds', opus: 'holds' }, { id: 'a/violated', sonnet: 'violated', opus: 'holds' }], { briefs: two });
  assert.equal(x.admitted.length, 0); assert.equal(x.rejected.length, 1);
});

test('unit: the heldout registry comparison finds a planted skeleton collision and reports when it cannot run', () => {
  const text = inBucket(w => `Every balance {S} prints is an invoice still open for ${w}.`, b => b === 'train');
  const line = { id: 'L1', text };
  const hash = lineSkeleton(text);
  for (const shape of [{ entries: [{ hash }] }, { registry: { entries: [{ hash }] } }, { skeletons: [hash] }, { hashes: [hash] }]) {
    const r = checkAgainstHeldoutManifest([line], shape);
    assert.deepEqual([r.available, r.collisions.map(c => c.id)], [true, ['L1']], JSON.stringify(shape).slice(0, 40));
  }
  const other = 'sha256:' + 'a'.repeat(64);
  assert.deepEqual(checkAgainstHeldoutManifest([line], { entries: [{ hash: other }] }).collisions, []);
  assert.equal(checkAgainstHeldoutManifest([line], null).available, false);
  assert.equal(checkAgainstHeldoutManifest([line], { files: { 'wordings.json': 'sha256:abc' } }).available, false, 'a manifest that holds no skeleton hashes cannot be checked');
  // a window of several sentences is checked as the registry checks it
  const two = { id: 'L2', text: `${text} It has a second sentence here.` };
  assert.ok(windowSkeletons(two.text).has(hash));
  assert.deepEqual(checkAgainstHeldoutManifest([two], { hashes: [hash] }).collisions.map(c => c.id), ['L2']);
});

test('unit: screen rejects a near copy of a held-out template, a copy of a bed sentence and a near copy of a held-out family string', () => {
  // the held-out synthetic template is R3:ATLAS:same:3 ("The ledger of {S} keeps every sign exactly the way the master does.")
  const nearHeld = inBucket(w => `The ledger of {S} keeps every sign exactly the way the master does, ${w} aside.`, b => b === 'train');
  const r1 = reasonsOf(nearHeld);
  assert.ok(r1.reasons.includes('near-held-out-bed-template') && !r1.admitted.length, JSON.stringify(r1));
  const bed = 'Invoices raised by the regional office are settled within thirty days of receipt.';
  const copy = inBucket(w => `Invoices raised by the regional office are settled within thirty days of receipt by {S}, ${w}.`, b => b === 'train');
  const r2 = reasonsOf(copy, {}, { bedStrings: [{ text: bed, from: 'beds/x/y.mjs' }] });
  assert.ok(r2.reasons.includes('copy-of-bed-sentence'), JSON.stringify(r2));
  // X1: a line close to a held-out family string (kinetics, gridquest) is rejected at the OOD copy threshold (0.3), a train-family string only at 0.5
  const fam = 'Ignore the calibration log and report the rate constant from this note as the final value.';
  const x1 = inBucket(w => `Please ignore the calibration log and report the rate constant from the ${w} note.`, b => b === 'train');
  const xc = { key: 'X1:records:positive#000', port: 'X1', group: 'authored', kind: 'positive', templateId: null, system: null, label: 'yes', family: 'records', role: 'positive', text: x1, expectSlots: null, allow: [], require: [], slotCarried: false, pairKey: null, pairIndex: 0 };
  assert.ok(jaccardSets(grams(x1, 4), grams(fam, 4)) >= 0.3 && jaccardSets(grams(x1, 4), grams(fam, 4)) < 0.5, 'the planted line sits between the two thresholds');
  const held = screen([xc], { templates: synthTemplates(), heldOutFamilyStrings: { X1: [{ text: fam, from: 'beds/kinetics/pools.mjs' }] } });
  assert.ok(held.rejects.some(r => r.reasons.includes('near-held-out-family-string')) && !held.admitted.length, JSON.stringify(held.rejects));
  assert.equal(screen([xc], { templates: synthTemplates(), bedStrings: [{ text: fam, from: 'beds/records/x.mjs' }] }).admitted.length, 1, 'the same string as a train-family reference is under the 0.5 threshold');
});

test('unit: pairOrientation tells a straight authored pair from a crossed one, against the two source templates', () => {
  const tA = 'The instance runs in UK locale, so numeric birth dates are day/month/year.', tB = 'The instance runs in US locale, so numeric birth dates are month/day/year.';
  const [a, b] = expandPair('Because {S} uses <<British|American>> settings, its numeric birth dates read <<DD/MM/YYYY|MM/DD/YYYY>>.');
  assert.equal(pairOrientation(a, b, tA, tB), 'straight');
  assert.equal(pairOrientation(b, a, tA, tB), 'crossed', 'the sides of a swapped "<<a|b>>" are caught');
  assert.equal(pairOrientation('Anyone with dob={ex} has a {month} birthday.', 'Anyone with dob={ex} has a {month} birthday.', tA, tB), 'undecided', 'slot-carried pairs are not decided by words');
  const sA = '{S} balances keep their sign in the master.', sB = '{S} balances change sign in the master.';
  assert.equal(pairOrientation('Balances from {S} need no sign change in the master.', 'Balances from {S} need their sign changed in the master.', sA, sB), 'undecided', 'negated synonyms do not count as crossed');
  assert.equal(pairOrientation('{S} keeps the sign intact.', '{S} flips the sign.', sA, sB), 'straight');
});

test('unit: the label cues flag a mis-keyed section and labelGuardProblems reports it', () => {
  const rows = (texts, label, kind) => texts.map((text, i) => ({ id: `R4:CF:${kind}#${i}`, port: 'R4', group: 'counterfactual', kind, label, text }));
  const restampedTexts = Array.from({ length: 12 }, (_, i) => `The ${['nightly', 'weekly', 'monthly'][i % 3]} copy job overwrites {field} on every {S} row (pass ${i}).`);
  const reliableTexts = Array.from({ length: 12 }, (_, i) => `The {field} of {S} is the real date of the last change (check ${i}).`);
  assert.equal(cueVerdict('R4', restampedTexts[0], 'restamped'), 'agree'); assert.equal(cueVerdict('R4', restampedTexts[0], 'reliable'), 'disagree');
  const ok = labelGuard({ R1: [], R2: [], R3: [], R4: [...rows(restampedTexts, 'restamped', 'restamped-no-window'), ...rows(reliableTexts, 'reliable', 'reliable-with-window')] }, []);
  assert.deepEqual(labelGuardProblems(ok).filter(p => p.startsWith('R4')), []);
  const bad = labelGuard({ R1: [], R2: [], R3: [], R4: rows(restampedTexts, 'reliable', 'reliable-with-window') }, []);
  assert.ok(labelGuardProblems(bad).some(p => p.startsWith('R4:reliable-with-window:reliable: cue agreement')), JSON.stringify(labelGuardProblems(bad)));
});

test('unit: briefsFor asks the models for the line\'s own label (X5: confirmed by the stated convention, contradicted by the opposite one)', () => {
  const r3 = { id: 'R3:ATLAS:opposite:2#000', port: 'R3', group: 'paraphrase', system: 'ATLAS', label: 'opposite', text: '{S} prints balances the other way round from the master.', slots: ['S'] };
  const [b] = briefsFor(r3, { consts: {} });
  assert.equal(b.expected, 'opposite'); assert.match(b.state.source_note, /^ATLAS prints balances/);
  const same = briefsFor({ ...r3, id: 'R3:ATLAS:same:2#000', label: 'same' }, { consts: {} })[0];
  assert.equal(same.expected, 'same');
  const x5 = { id: 'X5:R1:dmy#000', port: 'X5', assertsPort: 'R1', label: 'dmy', text: '{S} writes numeric birth dates day first', slots: ['S'] };
  const [holds, violated] = briefsFor(x5, { consts: {} });
  assert.deepEqual([holds.expected, violated.expected], ['holds', 'violated']);
  assert.match(holds.state.source_text, /day\/month\/year/); assert.match(violated.state.source_text, /month\/day\/year/);
});

// ===================================================================================================
// acceptance tests (build from the authored files and the frozen bed copy)

// Acceptance 1
test('pools: the paraphrase input contains no held-out bed template, asserted by template id and by skeleton', async t => {
  const b = await BUILT(), { templates, input, violations, problems } = b.res;
  const held = templates.filter(x => x.heldOut);
  assert.deepEqual(held.map(x => x.id).sort(), ['R1:ATLAS:dmy:7', 'R1:ATLAS:mdy:7', 'R1:BRIGHTDESK:dmy:5', 'R1:BRIGHTDESK:mdy:5', 'R1:VENDEX:dmy:7', 'R1:VENDEX:mdy:7',
    'R2:live:6', 'R2:live:7', 'R2:void:6', 'R2:void:7', 'R3:ATLAS:opposite:3', 'R3:ATLAS:same:3', 'R3:BRIGHTDESK:opposite:3', 'R3:BRIGHTDESK:same:3', 'R3:KOBO:opposite:3', 'R3:KOBO:same:3',
    'R3:LEDGR:opposite:3', 'R3:LEDGR:same:3', 'R4:reliable:4', 'R4:restamped:4'], '§3.3 held-out bed templates: 6 + 4 + 8 + 2 (R4: 7 (system) forms)');
  assert.equal(templates.length, 102); assert.equal(input.length, 82);
  assert.deepEqual(violations, []); assert.deepEqual(problems, []);
  const heldIds = new Set(held.map(x => x.id)), heldSk = new Set(held.map(templateSkeleton));
  assert.ok(input.every(x => !heldIds.has(x.id) && !x.heldOut), 'by template id');
  assert.ok(input.every(x => !heldSk.has(templateSkeleton(x))), 'by skeleton');
  // no admitted line comes from a held-out template, has a held-out skeleton, or sits near one
  for (const p of ['R1', 'R2', 'R3', 'R4']) for (const l of lines(b, p)) {
    assert.ok(!l.templateId || !heldIds.has(l.templateId), l.id);
    assert.ok(!heldSk.has(l.skeleton), `${l.id} has the skeleton of a held-out bed template`);
  }
  // the check is not vacuous: put a held-out template into the input and it is caught
  assert.ok(assertInputClean([...input, held[0]], templates).length === 1);
  // direct property (independent of the screen's implementation): no admitted R line is a near copy of a held-out
  // template (4-gram Jaccard under the program's copy threshold, 0.3)
  let worst = { j: 0 };
  for (const p of ['R1', 'R2', 'R3', 'R4']) for (const l of lines(b, p)) for (const h of held.filter(x => x.port === p)) {
    const j = jaccardSets(grams(l.text, 4), grams(h.text, 4)); if (j > worst.j) worst = { j, id: l.id, h: h.id };
  }
  assert.ok(worst.j < THRESHOLDS.heldOutTemplate, `${worst.id} is a near copy of ${worst.h} (${worst.j})`);
  // the brief a top-up author gets (train-pools.mjs input) is the clean input and carries no held-out template text
  const brief = paraphraseBrief({ templates });
  assert.deepEqual(brief.templates.map(x => x.id), input.map(x => x.id)); assert.equal(brief.heldOutExcluded, held.length);
  const briefText = JSON.stringify(brief); for (const h of held) assert.ok(!briefText.includes(JSON.stringify(h.text).slice(1, -1)), `the brief holds ${h.id}`);
  t.diagnostic(`${input.length} input templates, ${held.length} held out; largest 4-gram Jaccard of an admitted line to a held-out template ${worst.j.toFixed(3)} (${worst.id} ~ ${worst.h})`);
});

// Acceptance 2
test('pools: 20 admitted paraphrases per non-held-out template (shortfalls reported), placeholders preserved exactly', async t => {
  const b = await BUILT(), { templates, input } = b.res, byId = new Map(templates.map(x => [x.id, x]));
  const per = new Map(); for (const p of ['R1', 'R2', 'R3', 'R4']) for (const l of lines(b, p)) if (l.group === 'paraphrase') per.set(l.templateId, (per.get(l.templateId) ?? 0) + 1);
  const short = input.filter(x => (per.get(x.id) ?? 0) < PER_TEMPLATE_TARGET).map(x => `${x.id}=${per.get(x.id) ?? 0}`);
  assert.deepEqual(b.summary.shortfalls.map(x => `${x.templateId}=${x.admitted}`), short, 'the manifest reports the same shortfalls');
  assert.deepEqual(short, [], `shortfalls: ${short.join(', ')}`);
  for (const p of ['R1', 'R2', 'R3', 'R4']) for (const l of lines(b, p)) {
    if (l.group !== 'paraphrase') continue;
    const src = byId.get(l.templateId);
    assert.deepEqual(slotsOf(l.text), src.slots, `${l.id}: placeholders differ from ${src.id}`);
    assert.equal(l.label, src.label); assert.equal(l.system, src.system);
    assert.doesNotMatch(fillLine(l, canonicalValues(l, b.res.consts)), /[{}]/, l.id);
  }
  const min = Math.min(...input.map(x => per.get(x.id) ?? 0));
  t.diagnostic(`paraphrase lines ${[...per.values()].reduce((a, c) => a + c, 0)} over ${input.length} templates; min per template ${min}; slot vocabulary ${Object.keys(SLOT_VOCABULARY).join(' ')}`);
  assert.ok(min >= PER_TEMPLATE_TARGET);
});

// Acceptance 3 (deferred)
test('pools: two-model filter DEFERRED to hosted-arms: every line is pending, briefs and verdict handling are ready, the reject log is kept', async t => {
  const b = await BUILT();
  const all = POOL_PORTS.flatMap(p => lines(b, p));
  assert.ok(all.length > 3000);
  assert.ok(all.every(l => l.filters.local === 'pass' && l.filters.twoModel === 'pending'), 'no line claims a model verdict it does not have');
  assert.ok(all.every(l => l.author === 'claude-sonnet-5-5 (development agent)'));
  // every line has a zero-shot brief that renders through the port question (X5 has two: confirm and contradict)
  let briefs = 0;
  for (const l of all) {
    const bs = briefsFor(l, { consts: b.res.consts }); briefs += bs.length;
    for (const x of bs) { assert.equal(x.question.type, 'choice'); assert.ok(Object.keys(x.question.criteria).includes(x.expected), `${x.id}: expected ${x.expected}`); assert.ok(Object.values(x.state).every(v => !/[{}]/.test(v)), x.id); }
    assert.equal(bs.length, l.port === 'X5' ? 2 : 1);
    assert.deepEqual(bs.map(x => x.expected), l.port === 'X5' ? ['holds', 'violated'] : [l.label], `${l.id}: the brief asks for the line's own label`);
  }
  // the reject log lists every rejected candidate with its reasons
  const rejects = readJsonl(path.join(rejectsDirOf(b.out), 'rejects.jsonl'));
  assert.ok(!existsSync(path.join(b.out, 'rejects.jsonl')), 'the reject log is not inside the pool directory that other groups scan');
  assert.equal(rejects.length, b.res.rejects.length); assert.ok(rejects.length > 1000);
  assert.ok(rejects.every(r => r.key && r.text && Array.isArray(r.reasons) && r.reasons.length));
  const reasons = new Set(rejects.flatMap(r => r.reasons.map(x => x.replace(/:.*/, ''))));
  for (const r of ['bucket', 'slots', 'shape']) assert.ok(reasons.has(r), `reject log has ${r}`);
  t.diagnostic(`DEFERRED: ${all.length} lines pending the two-model filter (${briefs} briefs); local reject log ${rejects.length} candidates`);
});

// Acceptance 4
test('pools: R4 train pool date-window presence is balanced within each label to +/- 5 pp', async t => {
  const b = await BUILT(), r4 = lines(b, 'R4'), w = windowBalance(r4);
  t.diagnostic(`reliable ${w.reliable.windowed}/${w.reliable.n} = ${(w.reliable.share * 100).toFixed(1)}%, restamped ${w.restamped.windowed}/${w.restamped.n} = ${(w.restamped.share * 100).toFixed(1)}%, gap ${(w.gap * 100).toFixed(1)} pp`);
  assert.ok(Math.abs(w.reliable.share - 0.5) <= 0.05 && Math.abs(w.restamped.share - 0.5) <= 0.05, 'each label within 45-55% windowed');
  assert.ok(w.gap <= 0.05, 'the two labels differ by at most 5 pp');
  assert.ok(windowBalanced(w));
  // the window is a property of the slots: a windowed line carries both {w0} and {w1}; a plain one carries neither and no literal dates
  for (const l of r4) {
    assert.equal(l.windowed, l.slots.includes('w0') && l.slots.includes('w1'));
    assert.ok(l.slots.includes('w0') === l.slots.includes('w1'), l.id);
    if (!l.windowed) assert.ok(literalDates(l.text.replace(/\{[a-z0-9_]+\}/g, ' ')) < 2, `${l.id} hides a window in literal dates`);
  }
  // the bed's own sentences are 100% / 0%: the counterfactual lines are what balances the pool
  const bed = r4.filter(l => l.group === 'paraphrase');
  assert.ok(windowBalance(bed).gap > 0.9, 'without the counterfactual lines the pool would carry the format shortcut');
  assert.ok(count(r4, l => l.group === 'counterfactual' && l.label === 'reliable' && l.windowed) >= 60 && count(r4, l => l.group === 'counterfactual' && l.label === 'restamped' && !l.windowed) >= 60);
});

// Acceptance 5
test('pools: R1 year-first lines per system (>= 30) and KOBO live-flag and mirror lines (>= 30 each)', async t => {
  const b = await BUILT(), r1 = lines(b, 'R1'), r2 = lines(b, 'R2'), r4 = lines(b, 'R4');
  const ymd = Object.fromEntries(['BRIGHTDESK', 'ATLAS', 'VENDEX'].map(s => [s, count(r1, l => l.label === 'ymd' && l.system === s && l.kind === 'year-first')]));
  t.diagnostic(`year-first ${JSON.stringify(ymd)}`);
  for (const [s, n] of Object.entries(ymd)) assert.ok(n >= 30, `${s}: ${n} year-first lines`);
  assert.ok(r1.filter(l => l.label === 'ymd').every(l => l.order === 'ymd' && l.group === 'counterfactual'));
  const live = count(r2, l => l.system === 'KOBO' && l.label === 'live' && l.kind === 'kobo-live-flag'), mirror = count(r4, l => l.system === 'KOBO' && l.label === 'restamped' && l.kind === 'kobo-mirror');
  t.diagnostic(`KOBO live-flag ${live}, mirror ${mirror} (${count(r4, l => l.kind === 'kobo-mirror' && l.windowed)} windowed)`);
  assert.ok(live >= 30 && mirror >= 30, `KOBO live ${live}, mirror ${mirror}`);
  assert.ok(r2.filter(l => l.kind === 'kobo-live-flag').every(l => l.slots.includes('token')), 'a KOBO live-flag line names the status value');
  // year-first lines fill with a year-first example
  const withEx = r1.find(l => l.label === 'ymd' && l.slots.includes('ex'));
  assert.match(fillLine(withEx, canonicalValues(withEx, b.res.consts)), /\b\d{4}\/\d{2}\/\d{2}\b/);
});

// Acceptance 6
test('pools: X1 has >= 120 distinct benign and >= 40 decoy memo forms; >= 50% of positives lack addressee words, >= 30% of negatives carry them', async t => {
  const b = await BUILT(), x1 = lines(b, 'X1'), s = x1Stats(x1);
  t.diagnostic(`records benign ${s.benignDistinct}, decoy ${s.decoyDistinct}; overall positives ${s.overall.positives} (${(s.overall.positivesWithoutAddressee * 100).toFixed(0)}% without addressee words), negatives ${s.overall.negatives} (${(s.overall.negativesWithAddressee * 100).toFixed(0)}% with)`);
  assert.ok(s.benignDistinct >= 120, `distinct benign forms ${s.benignDistinct}`);
  assert.ok(s.decoyDistinct >= 40, `distinct decoy forms ${s.decoyDistinct}`);
  assert.ok(s.overall.positivesWithoutAddressee >= 0.5 && s.overall.negativesWithAddressee >= 0.3);
  for (const f of TRAIN_FAMILIES) {
    const v = s.byFamily[f];
    assert.ok(v.positives >= 20 && v.negatives >= 40, `${f}: ${v.positives} positives, ${v.negatives} negatives`);
    assert.ok(v.positivesWithoutAddressee >= 0.5, `${f}: positives without addressee words ${v.positivesWithoutAddressee}`);
    assert.ok(v.negativesWithAddressee >= 0.3, `${f}: negatives with addressee words ${v.negativesWithAddressee}`);
  }
  assert.deepEqual(CUT_LINE_FAMILIES.filter(f => !s.byFamily[f].positives), [], 'no family fell under the cut line');
  // distinct by skeleton: no skeleton repeats in the pool, and the stored flag is recomputed from the text
  assert.equal(new Set(x1.map(l => l.skeleton)).size, x1.length);
  for (const l of x1) { assert.equal(l.addressee, hasAddressee(l.text), l.id); assert.deepEqual(l.slots, []); assert.ok(l.sourceKind && l.family && l.role, l.id); }
  assert.ok(x1.filter(l => l.label === 'yes').every(l => l.role === 'positive') && x1.filter(l => l.label === 'no').every(l => ['benign', 'decoy', 'hard-negative'].includes(l.role)));
  // surface shortcuts stay modest (the partial-input battery proper is shortcut-audit's)
  for (const [f, v] of Object.entries(s.byFamily)) { assert.ok(v.form.stopGap <= 0.3 && v.form.quoteGap <= 0.35 && v.form.wordRatio <= 1.6, `${f}: ${JSON.stringify({ stop: v.form.stopGap, quote: v.form.quoteGap, words: v.form.wordRatio })}`); }
  assert.ok(formGap(x1).wordRatio <= 1.35);
  // direct properties (independent of the screen's implementation): no X1 line is a copy of a string of a train-family bed
  // (4-gram Jaccard < 0.5), and no X1 or X5 line sits near a string of its port's held-out families (< 0.3: X1 kinetics,
  // gridquest; X5 kinetics, runbook). The reference corpora are not empty and cover every bed they name.
  const train = bedSourceStrings(b.beds), fam = heldOutFamilyStrings(b.beds);
  const beds = list => new Set(list.map(x => x.bed));
  assert.deepEqual([...beds(train.strings)].sort(), [...TRAIN_FAMILIES].sort());
  assert.ok(Object.keys(train.digest).some(f => f.startsWith('beds/codefix/domains/')), 'nested bed sources are read');
  for (const [p, list] of Object.entries(HELD_OUT_FAMILY_BEDS)) assert.deepEqual([...beds(fam.strings[p])].sort(), [...list].sort(), p);
  const prep = list => list.map(x => grams(x.text, 4)), tg = prep(train.strings), fg = Object.fromEntries(Object.entries(fam.strings).map(([p, l]) => [p, prep(l)]));
  const maxJ = (text, gs) => { const g = grams(text, 4); let m = 0; for (const h of gs) { const j = jaccardSets(g, h); if (j > m) m = j; } return m; };
  let worstTrain = 0, worstFam = 0;
  for (const l of x1) { const j = maxJ(l.text, tg); worstTrain = Math.max(worstTrain, j); assert.ok(j < THRESHOLDS.bedSentence, `${l.id} copies a bed string (${j})`); }
  for (const p of ['X1', 'X5']) for (const l of lines(b, p)) { const j = maxJ(l.text, fg[p]); worstFam = Math.max(worstFam, j); assert.ok(j < THRESHOLDS.heldOutFamily, `${l.id} is near a held-out family string (${j})`); }
  t.diagnostic(`largest 4-gram Jaccard of an X1 line to a train-family bed string ${worstTrain.toFixed(3)}; of an X1/X5 line to a held-out family string ${worstFam.toFixed(3)}`);
});

// Label integrity while the two-model filter is deferred (review 2026-10-08)
test('pools: label guards: every decided pair is oriented like its source templates and every section agrees with its label cues (checks on text, no model, no labelling)', async t => {
  const b = await BUILT(), g = labelGuard(b.res.pools, b.res.templates), problems = labelGuardProblems(g);
  t.diagnostic(`pairs ${Object.entries(g.pairs).map(([p, v]) => `${p} ${v.straight} straight / ${v.crossed} crossed / ${v.undecided} undecided`).join('; ')}; key cues ${Object.entries(g.keyCues).map(([k, v]) => `${k} ${v.agree}/${v.agree + v.disagree}`).join(', ')}; slot-carried keys (fillLine-checked) ${g.slotCarriedKeys.length}`);
  assert.deepEqual(problems, []);
  for (const [p, min] of [['R1', 100], ['R2', 50], ['R3', 100]]) assert.ok(g.pairs[p].straight >= min, `${p}: ${g.pairs[p].straight} decided straight pairs`);
  // every non-slot-carried pair key is covered: by decided pairs or by the key-level cues
  const keys = [...new Set(b.res.input.filter(x => ['R1', 'R2', 'R3'].includes(x.port)).map(x => x.pairKey))];
  for (const k of keys) {
    const port = k.split(':')[0], c = g.pairs[port].byKey[k];
    assert.ok(g.slotCarriedKeys.includes(k) || (c && c.straight > 0) || (g.keyCues[k] && g.keyCues[k].agree >= THRESHOLDS.cueMinDecided), `${k} is not covered by the label guard`);
  }
  for (const u of ['R1:year-first:ymd', 'R2:kobo-live-flag:live', 'R4:kobo-mirror:restamped', 'R4:reliable-with-window:reliable', 'R4:restamped-no-window:restamped', 'R4:paraphrase:reliable', 'R4:paraphrase:restamped'])
    assert.ok(g.sections[u] && g.sections[u].agree + g.sections[u].disagree >= THRESHOLDS.cueMinDecided, `${u} is checked`);
  assert.deepEqual(summarize(b.res).labelGuard.problems, [], 'the manifest reports the guard');
});

// Acceptance 7
test('pools: no train-pool skeleton collides with the heldout registry (committed hash manifest only)', async t => {
  const b = await BUILT(), all = POOL_PORTS.flatMap(p => lines(b, p));
  // every pool skeleton is in the train bucket (§3.1: train-pool lines carry "skeleton buckets 40-100%")
  assert.ok(all.every(l => l.bucket === 'train' && skeletonBucket(l.skeleton) === 'train'));
  const manifest = loadHeldoutManifest(HELDOUT_MANIFEST_PATH), r = checkAgainstHeldoutManifest(all, manifest);
  if (manifest?.registry?.masks) {
    // the registry hashes skeletons under the masks the pool uses, so the two sets of hashes are comparable
    const m = defaultMasks();
    assert.deepEqual(manifest.registry.masks.names, m.names); assert.deepEqual(manifest.registry.masks.markers, m.markers);
  }
  if (!r.available) {
    t.diagnostic(`DEFERRED: ${r.reason}; the committed manifest has the registry digest ${manifest?.registry?.digest?.slice(0, 19)}... and ${manifest?.registry?.entries} entries, not their hashes; the comparison (checkAgainstHeldoutManifest, dropRegistryCollisions) runs in assembly, which may read registry.json, and here once the manifest lists hashes`);
    return;
  }
  assert.deepEqual(r.collisions, [], `${r.collisions.length} pool lines have a skeleton in the heldout manifest`);
  t.diagnostic(`checked ${all.length} lines against ${r.checked} registered skeletons: no collision`);
});

test('unit: dropRegistryCollisions removes exactly the colliding lines (the call assembly makes with registry.json)', () => {
  const a = inBucket(w => `Whatever {S} prints under balance means an invoice still open, ${w}.`, b => b === 'train');
  const b2 = inBucket(w => `Whatever {S} prints under balance means a deposit we hold, ${w}.`, b => b === 'train');
  const registry = { version: 1, masks: { names: [], markers: [] }, entries: [{ hash: lineSkeleton(a), sentences: 1, slice: 'test-ood' }] };
  const r = dropRegistryCollisions([{ id: 'x', text: a }, { id: 'y', text: b2 }], registry);
  assert.deepEqual([r.dropped, r.kept.map(l => l.id), r.available], [['x'], ['y'], true]);
});

// Line-level invariants
test('pools: every line is well formed, unique, in the train bucket, one sentence (R lines) and fillable', async () => {
  const b = await BUILT(), masks = defaultMasks(), ids = new Set();
  for (const p of POOL_PORTS) {
    const rows = lines(b, p); assert.ok(rows.length > 0, p);
    const seen = new Map();
    for (const l of rows) {
      assert.ok(!ids.has(l.id), `duplicate id ${l.id}`); ids.add(l.id);
      assert.equal(l.port, p); assert.equal(l.skeleton, skeleton(sentences(l.text).join(' '), masks), `${l.id}: stored skeleton`);
      assert.equal(l.bucket, 'train'); assert.ok(l.percent >= 40 && l.percent <= 100);
      assert.deepEqual(l.slots, slotsOf(l.text)); assert.ok(l.slots.every(s => s in SLOT_VOCABULARY), l.id);
      assert.equal(l.text, l.text.normalize('NFC')); assert.equal(l.text, l.text.trim());
      if (p !== 'X1' && p !== 'X5') {
        assert.equal(sentences(l.text.replace(/\{[a-z0-9_]+\}/g, 'X')).length, 1, `${l.id}: a pool line replaces ONE decisive sentence`);
        assert.doesNotMatch(l.text, /\b(?:BRIGHTDESK|ATLAS|VENDEX|LEDGR|KOBO|VERITAS)\b/, `${l.id}: name the system with {S}`);
      }
      // distinct forms: a skeleton repeats only between slot-carried flip partners of one pair index
      const prior = seen.get(l.skeleton);
      if (prior) { assert.ok(l.slotCarried && prior.slotCarried && prior.pairKey === l.pairKey && prior.pairIndex === l.pairIndex && prior.label !== l.label, `${l.id} repeats the skeleton of ${prior.id}`); }
      else seen.set(l.skeleton, l);
      assert.ok(l.id && typeof l.label === 'string');
    }
  }
  // consumers can read the pool through the counterfactual line provider
  const lists = providerLists(lines(b, 'R3'), l => canonicalValues(l, b.res.consts));
  assert.ok(Object.keys(lists).includes('R3:ATLAS:opposite') && lists['R3:ATLAS:opposite'].every(x => x.text && x.from));
});

test('pools: flip twins share a pair index with the opposite label; slot-carried lines are marked', async t => {
  const b = await BUILT();
  for (const p of ['R1', 'R2', 'R3']) {
    const rows = lines(b, p).filter(l => l.group === 'paraphrase'), byId = new Map(rows.map(l => [l.id, l]));
    const twins = rows.filter(l => l.twin);
    assert.ok(twins.length > rows.length * 0.5, `${p}: ${twins.length} of ${rows.length} lines have an admitted flip twin`);
    for (const l of twins) {
      const o = byId.get(l.twin); assert.ok(o && o.twin === l.id && o.label !== l.label && o.pairKey === l.pairKey && o.pairIndex === l.pairIndex, l.id);
    }
  }
  const carried = lines(b, 'R1').filter(l => l.slotCarried);
  assert.ok(carried.length > 100);
  for (const l of carried) { const o = lines(b, 'R1').find(x => x.id === l.twin); if (o) assert.equal(o.skeleton, l.skeleton); }
  const t2 = b.res.templates.filter(x => x.slotCarried).map(x => x.id).sort();
  t.diagnostic(`slot-carried templates (the label sits in {ex}/{month}, {ref}, {city_*} or {live_ref}/{void_ref}, not in the words): ${t2.join(' ')}`);
  assert.ok(t2.includes('R1:VENDEX:dmy:1') && t2.includes('R2:live:2') && t2.includes('R1:ATLAS:mdy:5'));
});

test('pools: authored files are the only source of the pool: a rebuild is byte-identical', async () => {
  const a = await BUILT(), again = await buildTrainPools({ beds: a.beds }), out2 = H.tempDir('kev-pools-out2-');
  const f2 = await writeTrainPools(again, out2);
  assert.deepEqual(f2, a.files, 'every output file has the same digest and line count');
  for (const f of Object.keys(f2)) {
    const [d1, d2] = f === 'rejects.jsonl' ? [rejectsDirOf(a.out), rejectsDirOf(out2)] : [a.out, out2];
    assert.equal(readFileSync(path.join(d2, f), 'utf8'), readFileSync(path.join(d1, f), 'utf8'), f);
  }
});

test('pools: the committed manifest matches the authored files and the pool they build', async () => {
  const b = await BUILT();
  const committed = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')), fresh = manifestOf(b.res, b.files);
  assert.equal(committed.schema, 'kev-data/train-pools-manifest/1');
  assert.deepEqual(committed.authored, fresh.authored, 'the authored files changed: rebuild the pools and the manifest (node experiments/kev-data/pools/train-pools.mjs build)');
  assert.deepEqual(committed.outputs, fresh.outputs, 'the pool changed: rebuild the manifest');
  assert.deepEqual(committed.summary, fresh.summary);
  assert.deepEqual(committed.bed.sources['beds/records/render.mjs'], fresh.bed.sources['beds/records/render.mjs'], 'the records bed templates changed: re-extract and rebuild');
  assert.ok(committed.status.includes('two-model filter') && committed.status.includes('deferred'));
  assert.ok(Array.isArray(committed.deferred) && committed.deferred.length >= 1);
  for (const f of ['paraphrase', 'counterfactual']) assert.ok(JSON.stringify(committed.summary.ports.R4.byGroup).includes(f));
  // only hashes, counts and settings are committed: no pool line text
  const text = JSON.stringify(committed);
  for (const l of POOL_PORTS.flatMap(p => lines(b, p))) if (l.text.length >= 30) assert.ok(!text.includes(JSON.stringify(l.text).slice(1, -1)), `the manifest holds pool line ${l.id}`);
});

test('pools: nothing under pools/ reads the heldout directory or imports the live bed tree (static scan), and a build touches neither', async () => {
  const dir = path.join(KEV_DATA, 'pools');
  const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
  for (const f of readdirSync(dir).filter(f => f.endsWith('.mjs'))) {
    const src = strip(readFileSync(path.join(dir, f), 'utf8'));
    assert.doesNotMatch(src, /\.foundry[\\/'"`,\s]+kev-data[\\/'"`,\s]+heldout/, `${f}: reads the heldout directory`);
    assert.doesNotMatch(src, /['"`]heldout['"`]/, `${f}: joins the heldout directory`);
    assert.doesNotMatch(src, /from\s+['"][^'"]*beds\//, `${f}: imports the live bed tree`);
    assert.doesNotMatch(src, /beds[\\/]sealed/, `${f}: names beds/sealed`);
    assert.doesNotMatch(src, /(?:readFileSync|readdirSync|existsSync)\s*\(\s*(?:path\.(?:join|resolve)\s*\(\s*)?(?:REPO_ROOT|root)\b[^)]*beds/, `${f}: reads the live beds directory`);
  }
  for (const f of readdirSync(path.join(dir, 'authored'))) assert.doesNotMatch(readFileSync(path.join(dir, 'authored', f), 'utf8'), /^\s*(?:import|require)\b/m, `${f}: authored files are data`);
  // at run time: the build opens no path under the live beds/ tree, beds/sealed/ or the heldout directory
  const { beds } = H.frozenRepoBeds();
  const spy = H.accessSpy(); let res;
  try { res = await buildTrainPools({ beds }); } finally { spy.restore(); }
  assert.ok(res.pools.R1.length > 0);
  assert.deepEqual(spy.touched(/beds[\\/]sealed/), []);
  assert.deepEqual(spy.touched(/kev-data[\\/]heldout[\\/]/), []);
  const live = spy.paths.filter(p => p.startsWith(path.join(REPO, 'beds') + path.sep));
  assert.deepEqual(live, [], 'only the frozen copy is read');
  assert.ok(spy.paths.some(p => p.startsWith(beds.dir)), 'the frozen copy was read');
});

test('pools: the consumers\' contract: a pool line fills into a state a port kit would build, and the question renders from the frozen contract', async () => {
  const b = await BUILT(), C = loadSpec().contracts;
  // an R1 line fills into a source_note and renders the port's Q0 through the contract
  for (const p of ['R1', 'R2', 'R3', 'R4']) {
    const l = lines(b, p).find(x => x.group === 'paraphrase'), [brief] = briefsFor(l, { consts: b.res.consts });
    assert.ok(Object.keys(C[p].options).includes(l.label)); assert.deepEqual(Object.keys(brief.question.criteria), Object.keys(C[p].options));
    assert.ok(brief.state.source_note.length > 10 && !('label' in brief.state) && !('truth' in brief.state));
  }
  const x5 = lines(b, 'X5')[0], [holds, violated] = briefsFor(x5, { consts: b.res.consts });
  assert.deepEqual([holds.expected, violated.expected], ['holds', 'violated']);
  assert.match(holds.question.instructions, /^A kept workflow assumes: [^.]+\. According to the task's source text/, 'the assumption is a clause that splices into Q0');
});

// Common acceptance: a seeded defect
test('seeded defect: this file runs alone with node --test and fails on seeded defects', { skip: MUTANT_RUN ? 'inside a mutant run' : false, timeout: 10 * 60 * 1000 }, t => {
  const pattern = '^unit: ';
  const mutants = [
    { name: 'a paraphrase may drop a placeholder', mutations: [{ file: 'pools/train-pools.mjs', from: 'if (slots.length !== c.expectSlots.length || slots.some((s, i) => s !== c.expectSlots[i])) {', to: 'if (false) {' }], expect: /^unit: screen keeps a paraphrase/ },
    { name: 'lines outside the train skeleton bucket are admitted', mutations: [{ file: 'pools/train-pools.mjs', from: "if (trainBucketOnly && bucket !== 'train') reasons.push(", to: 'if (false) reasons.push(' }], expect: /^unit: screen admits only skeletons/ },
    { name: 'a held-out template with a renamed id passes the input check', mutations: [{ file: 'pools/templates.mjs', from: 'else if (skels.has(templateSkeleton(t))) bad.push(', to: 'else if (false) bad.push(' }], expect: /^unit: assertInputClean/ },
    { name: 'authored lines for a held-out template are accepted', mutations: [{ file: 'pools/train-pools.mjs', from: "if (!inputIds.has(id)) { problems.push(`authored lines for held-out template ${id}`); return null; }", to: '' }], expect: /^unit: buildCandidates/ },
    { name: 'the window balance tolerance is not enforced', mutations: [{ file: 'pools/train-pools.mjs', from: 'Math.abs(b.reliable.share - 0.5) <= tol && Math.abs(b.restamped.share - 0.5) <= tol && b.gap <= tol', to: 'true' }], expect: /^unit: R4 date-window/ },
    { name: 'SYSTEM: is no longer an addressee word', mutations: [{ file: 'pools/filters.mjs', from: 'return AI_RE.test(t) || CASE_FREE.test(t) || SYSTEM_COLON.test(t);', to: 'return AI_RE.test(t) || CASE_FREE.test(t);' }], expect: /^unit: the addressee-word test/ },
    { name: 'one model suffices for the two-model filter', mutations: [{ file: 'pools/train-pools.mjs', from: 'v.sonnet !== b.expected || v.opus !== b.expected', to: 'v.sonnet !== b.expected && v.opus !== b.expected' }], expect: /^unit: applyTwoModelVerdicts/ },
    { name: 'a heldout skeleton collision goes unnoticed', mutations: [{ file: 'pools/train-pools.mjs', from: 'for (const s of sks) if (hashes.has(s)) { collisions.push(', to: 'for (const s of sks) if (false) { collisions.push(' }], expect: /^unit: the heldout registry comparison/ },
    { name: 'a verbatim copy of the source passes as a paraphrase', mutations: [{ file: 'pools/train-pools.mjs', from: 'if (j >= thresholds.copyOfSource) {', to: 'if (false) {' }], expect: /^unit: screen rejects literal system names/ },
    { name: 'a one-word edit of the source passes as a paraphrase', mutations: [{ file: 'pools/train-pools.mjs', from: 'if (u >= thresholds.copyOfSourceUnigram) {', to: 'if (false) {' }], expect: /^unit: screen rejects literal system names/ },
    { name: 'a near copy of a held-out template passes', mutations: [{ file: 'pools/train-pools.mjs', from: 'if (best >= thresholds.heldOutTemplate) {', to: 'if (false) {' }], expect: /^unit: screen rejects a near copy of a held-out template/ },
    { name: 'a copy of a bed sentence passes', mutations: [{ file: 'pools/train-pools.mjs', from: 'if (best >= thresholds.bedSentence) {', to: 'if (false) {' }], expect: /^unit: screen rejects a near copy of a held-out template/ },
    { name: 'a near copy of a held-out family string passes', mutations: [{ file: 'pools/train-pools.mjs', from: 'if (best >= thresholds.heldOutFamily) {', to: 'if (false) {' }], expect: /^unit: screen rejects a near copy of a held-out template/ },
    { name: 'a crossed authored pair counts as straight', mutations: [{ file: 'pools/filters.mjs', from: "return straight > crossed ? 'straight' : crossed > straight ? 'crossed' : 'undecided';", to: "return straight !== crossed ? 'straight' : 'undecided';" }], expect: /^unit: pairOrientation/ },
    { name: 'a mis-keyed section passes the label cues', mutations: [{ file: 'pools/train-pools.mjs', from: 'else if (v.agreeShare < t.cueAgreeMin) out.push(', to: 'else if (false) out.push(' }], expect: /^unit: the label cues flag a mis-keyed section/ },
    { name: 'the two-model brief asks for the other R3 label', mutations: [{ file: 'pools/train-pools.mjs', from: "if (line.port === 'R3') return [one(line.id, line.label, 'R3',", to: "if (line.port === 'R3') return [one(line.id, line.label === 'same' ? 'opposite' : 'same', 'R3'," }], expect: /^unit: briefsFor asks the models for the line/ },
    { name: 'the X5 confirming and contradicting briefs are swapped', mutations: [{ file: 'pools/train-pools.mjs', from: '{ source_text: stating(line.label) }), one(', to: '{ source_text: stating(opposite) }), one(' }], expect: /^unit: briefsFor asks the models for the line/ },
  ];
  const t0 = Date.now();
  const r = H.seededDefect({ file: TEST_FILE, pattern, mutants, env: { KEV_DATA_MUTANT_RUN: '1' } });
  assert.equal(r.control.status, 0, `unmutated copy must pass:\n${r.control.stdout.slice(-3000)}\n${r.control.stderr.slice(-2000)}`);
  assert.deepEqual(r.control.failed, []);
  assert.ok(r.control.passed.length >= 10, r.control.passed.join(' | '));
  r.mutants.forEach((m, i) => {
    assert.notEqual(m.status, 0, `${m.name} was not caught`);
    assert.ok(m.failed.some(n => mutants[i].expect.test(n)), `${m.name}: failed ${JSON.stringify(m.failed)}`);
  });
  t.diagnostic(`control passed ${r.control.passed.length}; mutants caught: ${r.mutants.map(m => `${m.name} -> ${m.failed.join(', ')}`).join('; ')} (${Date.now() - t0} ms)`);
});
