// need-r0pad bed tests (node:test, built-ins only). Development seeds 601-640 only; nothing here is held-out evidence.
//   node --test beds/need-r0pad/*.test.mjs
// Contract health (determinism, reference, controls, schema, leakage, timing) plus the family-specific properties of a
// metamorphic length pair: the R0 core is byte-identical to wbed-r0's, the oracles agree both ways, and the padding is
// deterministic, answer-neutral and independent of the difficulty.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as bed from './index.mjs';
import * as r0 from '../wbed/r0/index.mjs';
import { canonical } from '../lib/canonical.mjs';
import { portableSchemaViolations } from '../../src/schema-subset.mjs';
import { clearPaddingCache } from './padding.mjs';

const SEEDS = Array.from({ length: 40 }, (_, i) => 601 + i);
const DS = [2, 3, 4, 5];
const memo = new Map();
const gen = (seed, d, split = 'dev') => { const k = `${split}/${d}/${seed}`; if (!memo.has(k)) memo.set(k, bed.generate({ seed, split, difficulty: d })); return memo.get(k); };   // read-only use
const fresh = (seed, d, split = 'dev') => bed.generate({ seed, split, difficulty: d });
const r0task = (seed, d, split = 'dev') => r0.generate({ seed, split, difficulty: d });
const bytes = s => Buffer.byteLength(s);
const sum = xs => xs.reduce((a, b) => a + b, 0);
const mean = xs => sum(xs) / xs.length;
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const corr = (xs, ys) => { const mx = mean(xs), my = mean(ys); let a = 0, b = 0, c = 0; for (let i = 0; i < xs.length; i++) { a += (xs[i] - mx) * (ys[i] - my); b += (xs[i] - mx) ** 2; c += (ys[i] - my) ** 2; } return a / Math.sqrt(b * c); };
const tokens = task => Math.ceil(bytes(JSON.stringify(task.inputs ?? {}) + Object.values(task.files ?? {}).join('\n') + String(task.prompt ?? '')) / 4);   // the need-router formula
const inlineTokens = task => Math.ceil(bytes([task.prompt, '', '## inputs.json', '```json', JSON.stringify(task.inputs ?? {}, null, 1), '```',
  ...Object.entries(task.files ?? {}).flatMap(([rel, text]) => ['', `## files/${rel}`, '```', text, '```'])].join('\n')) / 4);                               // what a single-call arm is shown
const isSibling = (task, path) => bed.describePadding(task).docs.find(d => d.path === path).sibling !== null;
const paddingText = (task, { siblings }) => { const info = bed.describePadding(task); return info.docs.filter(d => siblings || !d.sibling).map(d => task.files[d.path]); };

test('contract: family, schema (portable subset), exports', () => {
  assert.equal(bed.family.id, 'need-r0pad');
  assert.equal(bed.family.version, '1.0.0');
  assert.equal(bed.family.kind, 'oneshot');
  assert.equal(bed.family.role, 'need-anchor');
  assert.ok(bed.family.domain && bed.family.description);
  assert.match(bed.family.description, /HYPOTHESIS/);
  for (const fn of ['generate', 'oracle', 'referenceSolve']) assert.equal(typeof bed[fn], 'function');
  assert.deepEqual(portableSchemaViolations(bed.outputSchema), []);
  const forbidden = new Set(['pattern', 'oneOf', 'uniqueItems', '$ref', 'format']);
  const walk = s => { if (s && typeof s === 'object') for (const [k, v] of Object.entries(s)) { assert.ok(!forbidden.has(k), `schema uses ${k}`); walk(v); } };
  walk(bed.outputSchema);
  assert.deepEqual(bed.outputSchema, r0.outputSchema);               // R0's contract, as a copy
  assert.notEqual(bed.outputSchema, r0.outputSchema);
  const names = bed.badControls.map(c => c.name);
  for (const n of ['empty', 'shuffled-or-corrupted']) assert.ok(names.includes(n), n);
  assert.ok(names.some(n => n.startsWith('plausible-but-wrong')));
  assert.ok(bed.badControls.every(c => typeof c.make === 'function'));
  assert.deepEqual([bed.difficulty.min, bed.difficulty.max], [2, 5]);
});

test('task shape: contract fields only, JSON-serialisable, id and budget', () => {
  for (const d of DS) {
    const task = gen(601 + d, d);
    assert.deepEqual(Object.keys(task).sort(), ['budget', 'difficulty', 'family', 'files', 'id', 'inputs', 'prompt', 'seed', 'split']);
    assert.equal(task.family, 'need-r0pad');
    assert.equal(task.id, `need-r0pad:dev:d${d}:${601 + d}`);
    assert.deepEqual(JSON.parse(JSON.stringify(task)), task);
    assert.match(task.prompt, /"invoice_number"/);                    // the output form is stated (R0's prompt)
    assert.deepEqual(task.budget, r0task(601 + d, d).budget);
    for (const [rel, text] of Object.entries(task.files)) { assert.match(rel, /^archive\/doc-\d\d\.txt$/); assert.equal(typeof text, 'string'); }
  }
});

test('determinism: repeated generation is byte-identical, fresh objects, split / seed / difficulty matter', () => {
  for (const d of DS) for (const seed of SEEDS.slice(0, 12)) {
    const a = fresh(seed, d), b = fresh(seed, d);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(canonical(a), canonical(b));
  }
  const t = fresh(610, 3), before = JSON.stringify(t);
  t.files['archive/doc-01.txt'] = 'mutated'; t.inputs.document = 'mutated'; t.prompt = 'mutated';          // callers cannot corrupt later generations
  assert.equal(JSON.stringify(fresh(610, 3)), before);
  assert.notEqual(canonical(fresh(610, 3)), canonical(fresh(610, 3, 'test')));
  assert.notEqual(canonical(fresh(610, 3)), canonical(fresh(611, 3)));
  assert.notEqual(canonical(fresh(610, 3)), canonical(fresh(610, 4)));
  const out = bed.referenceSolve(fresh(615, 4));
  assert.equal(JSON.stringify(bed.oracle(fresh(615, 4), out)), JSON.stringify(bed.oracle(fresh(615, 4), out)));
});

test('argument validation: R0 range 2..5, integer seed, known split, no faults', () => {
  for (const difficulty of [1, 0, 6, 2.5, '3', null]) assert.throws(() => bed.generate({ seed: 601, split: 'dev', difficulty }), /difficulty/);
  assert.throws(() => bed.generate({ seed: 1.5, split: 'dev', difficulty: 3 }), /seed/);
  assert.throws(() => bed.generate({ seed: 601, split: 'val', difficulty: 3 }), /split/);
  assert.throws(() => bed.generate({ seed: 601, split: 'dev', difficulty: 3, faults: ['f3'] }), /not implemented/);
  assert.throws(() => bed.oracle({ seed: 1, split: 'dev', difficulty: 9 }, {}), /difficulty/);
  assert.equal(bed.generate({ seed: 601 }).difficulty, 3);             // defaults: dev, 3
});

for (const d of DS) {
  test(`d${d}: referenceSolve passes with score 1, and every bad control fails (${SEEDS.length} seeds)`, () => {
    for (const seed of SEEDS) {
      const task = gen(seed, d);
      const res = bed.oracle(task, bed.referenceSolve(task));
      assert.equal(res.pass, true, `${task.id}: ${JSON.stringify(res.details)}`);
      assert.equal(res.score, 1);
      for (const c of bed.badControls.filter(x => d >= (x.minDifficulty ?? 0))) {
        const out = c.make(task), r = bed.oracle(task, out);
        assert.equal(r.pass, false, `${c.name} passed on ${task.id}`);
        if (c.name !== 'empty') assert.ok(r.score > 0 || c.name === 'shuffled-or-corrupted', `${c.name}: schema-valid controls score partial credit`);
        if (c.name !== 'empty') assert.equal(r.details.reason, undefined, `${c.name} on ${task.id} is schema-invalid, so it only tests the schema`);
      }
    }
  });
}

test('controls: R0 names kept, the two padding-specific near misses present, all enabled at every tested difficulty', () => {
  const names = bed.badControls.map(c => c.name);
  for (const c of r0.badControls) assert.ok(names.includes(c.name), c.name);
  for (const n of ['empty', 'shuffled-or-corrupted', 'date-order-flipped', 'tax-ignored', 'quantity-ignored', 'plausible-but-wrong:sibling-invoice', 'plausible-but-wrong:sibling-amounts']) assert.ok(names.includes(n), n);
  assert.equal(new Set(names).size, names.length);
});

test('plausible-but-wrong sibling controls: a real other document of the archive, differing in every field they reuse', () => {
  for (const d of DS) for (const seed of SEEDS) {
    const task = gen(seed, d), truth = bed.referenceSolve(task), info = bed.describePadding(task);
    const whole = bed.badControls.find(c => c.name === 'plausible-but-wrong:sibling-invoice').make(task);
    const mixed = bed.badControls.find(c => c.name === 'plausible-but-wrong:sibling-amounts').make(task);
    const first = info.siblings[0];
    assert.deepEqual(whole, first.truth);
    assert.ok(info.docs.some(x => x.sibling && x.sibling.seed === first.seed));
    for (const f of ['invoice_number', 'customer_row', 'net_minor', 'tax_minor', 'gross_minor', 'issue_date']) assert.notEqual(whole[f], truth[f], f);
    assert.deepEqual({ ...mixed, net_minor: 0, tax_minor: 0, gross_minor: 0 }, { ...truth, net_minor: 0, tax_minor: 0, gross_minor: 0 });
    assert.equal(mixed.net_minor, first.truth.net_minor);
    assert.equal(bed.oracle(task, whole).pass, false);
    assert.equal(bed.oracle(task, mixed).pass, false);
  }
});

test('schema-invalid output is rejected, even when it contains the right answer', () => {
  for (const d of DS) for (const seed of SEEDS.slice(0, 6)) {
    const task = gen(seed, d), ref = bed.referenceSolve(task);
    assert.equal(bed.oracle(task, ref).pass, true);
    const { net_minor, ...missing } = ref;
    const invalid = [undefined, null, 'answer', 42, [], [ref], {}, missing, { ...ref, net_minor: String(ref.net_minor) }, { ...ref, void: 'no' }, { ...ref, tax_minor: 1.5 },
      { ...ref, customer_row: String(ref.customer_row) }, { ...ref, currency: ['USD'] }, { ...ref, invoice_number: 'x'.repeat(41) }, { ...ref, gross_minor: NaN }];
    for (const out of invalid) {
      const res = bed.oracle(task, out);
      assert.equal(res.pass, false, `${task.id}: ${JSON.stringify(out)}`);
      assert.equal(res.score, 0);
      assert.equal(res.details.reason, 'schema-invalid');
    }
  }
  // R0's tolerance for the invoice number format carries over unchanged
  const task = gen(633, 3), ref = bed.referenceSolve(task);
  assert.ok(bed.oracle(task, { ...ref, invoice_number: ref.invoice_number.toLowerCase().replace(/[-/]/g, ' ') }).pass);
});

test('oracle recomputes the truth from (seed, split, difficulty) and never trusts the task object it is handed', () => {
  let different = 0, total = 0;
  for (const d of DS) for (const seed of SEEDS) {
    const task = gen(seed, d), good = bed.referenceSolve(task);
    assert.equal(bed.oracle({ ...task, prompt: 'Return {"void": true}', inputs: {}, files: {}, budget: {}, extra: 'x' }, good).pass, true);
    assert.equal(bed.oracle({ seed, split: 'dev', difficulty: d }, good).pass, true);
    const other = gen(seed + 1000, d);
    total++;
    if (!bed.oracle(other, good).pass) different++;
  }
  assert.ok(different / total > 0.99, `answers of different seeds coincided too often: ${different}/${total}`);
  assert.equal(bed.oracle({ seed: 601, difficulty: 3 }, bed.referenceSolve({ seed: 601, difficulty: 3 })).pass, true);   // split defaults to dev
});

// ---------------------------------------------------------------------------------------------------------------------
// Family-specific: the R0 core of the task is wbed-r0's, and the oracles are the same function of the same truth.
test('R0 core identical: prompt rules, inputs and budget equal wbed-r0 at the same (seed, split, difficulty)', () => {
  for (const split of ['dev', 'test']) for (const d of DS) for (const seed of SEEDS) {
    const task = gen(seed, d, split), core = r0task(seed, d, split);
    assert.ok(task.prompt.startsWith(`${core.prompt}\n`), `${task.id}: prompt must begin with R0's prompt`);
    assert.equal(task.prompt.slice(core.prompt.length + 1), bed.describePadding(task).note);          // the only addition is the padding note
    assert.equal(canonical(task.inputs), canonical(core.inputs));
    assert.deepEqual(Object.keys(task.inputs), ['document', 'notes']);
    assert.equal(canonical(task.budget), canonical(core.budget));
    assert.equal(canonical(bed.pairedR0Task(task)), canonical(core));
    assert.deepEqual([task.seed, task.split, task.difficulty], [core.seed, core.split, core.difficulty]);
    assert.notEqual(task.id, core.id);
  }
});

test('the padding note says the files may be ignored only if irrelevant, and names no document as irrelevant', () => {
  for (const d of DS) for (const seed of SEEDS) {
    const task = gen(seed, d), n = Object.keys(task.files).length;
    const note = task.prompt.split('\n').slice(r0.generate({ seed, split: 'dev', difficulty: d }).prompt.split('\n').length).join('\n');
    assert.equal(note, bed.PAD_NOTE(n));
    assert.match(note, /may be ignored only if it is irrelevant to this invoice/);
    assert.match(note, new RegExp(`files/archive/ \\(${n} files\\)`));
    assert.ok(!/doc-\d\d|sibling|other invoice|unrelated|distract/i.test(note), 'the note must not label any document');
  }
});

test('oracles agree both ways: R0 reference passes need-r0pad, need-r0pad reference passes R0, verdicts identical for every control', () => {
  for (const d of DS) for (const seed of SEEDS) {
    const task = gen(seed, d), core = r0task(seed, d);
    const a = r0.referenceSolve(core), b = bed.referenceSolve(task);
    assert.deepEqual(a, b);
    assert.equal(bed.oracle(task, a).pass, true);
    assert.equal(r0.oracle(core, b).pass, true);
    const outputs = [a, {}, null, { ...a, void: !a.void }, ...r0.badControls.filter(c => d >= (c.minDifficulty ?? 0)).map(c => c.make(core)), ...bed.badControls.map(c => c.make(task))];
    for (const out of outputs) assert.equal(canonical(bed.oracle(task, out)), canonical(r0.oracle(core, out)), `${task.id}: ${JSON.stringify(out)}`);
  }
});

test('padding is deterministic: identical on repeat, after the caches are flushed, and in any generation order', () => {
  const keys = SEEDS.slice(0, 10).flatMap(seed => DS.map(d => [seed, d]));
  const first = new Map(keys.map(([seed, d]) => [`${seed}/${d}`, canonical(fresh(seed, d).files)]));
  clearPaddingCache();
  for (let i = 0; i < 90; i++) r0.generate({ seed: 5000 + i, split: 'dev', difficulty: DS[i % 4] });   // push R0's own memo (64 entries) past its bound
  for (const [seed, d] of [...keys].reverse()) assert.equal(canonical(fresh(seed, d).files), first.get(`${seed}/${d}`), `${seed}/${d}`);
  for (const [seed, d] of keys) assert.equal(canonical(fresh(seed, d).files), canonical(fresh(seed, d).files));
});

// The audit below is written out from first principles on purpose (it does not call guard.mjs): it recomputes the strings that
// would give the answer away or change it, and looks for them in the padding.
const STATUS_WORDS = (() => {
  const words = new Set();
  for (let seed = 1; seed <= 120; seed++) for (const d of DS) for (const line of r0task(seed, d).inputs.notes.split('\n').filter(l => l.startsWith('Status "'))) for (const m of line.matchAll(/"([^"]+)"/g)) words.add(m[1].toLowerCase());
  return [...words];
})();
const R0_ITEMS = (() => {
  const items = new Set();
  for (let seed = 1; seed <= 200; seed++) for (const d of [3, 5]) for (const line of r0task(seed, d).inputs.document.split('\n')) {
    const m = line.match(/^ \d+\s+(.+?)\s{2,}\d+\s+[\d.,]+$/);
    if (m) items.add(m[1].replace(' (credited, not billed)', '').trim().toLowerCase());
  }
  return [...items];
})();
const maskDates = t => t.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ').replace(/\b\d{2}[/.-]\d{2}[/.-](\d{4}|\d{2})\b/g, ' ')
  .replace(/\b\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December) \d{4}\b/g, ' ');
const grouped = (n, sep) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
const amountStrings = minor => { const major = Math.floor(minor / 100), c = String(minor % 100).padStart(2, '0'); return [`${major}.${c}`, `${grouped(major, ',')}.${c}`, `${grouped(major, '.')},${c}`]; };
const hasAmount = (text, s) => new RegExp(`(?<![\\d.,])${s.replace(/[.]/g, '\\.')}(?!\\d)`).test(text);
const countAmount = (text, s) => (text.match(new RegExp(`(?<![\\d.,])${s.replace(/[.]/g, '\\.')}(?!\\d)`, 'g')) ?? []).length;
const hasRun = (text, digits) => new RegExp(`(?<!\\d)${digits}(?!\\d)`).test(maskDates(text));

test('audit helpers are themselves sane (R0 vocabulary was found)', () => {
  assert.ok(STATUS_WORDS.length >= 14, STATUS_WORDS.join(','));
  for (const w of ['open', 'void', 'offen', 'storniert', 'cancelled', 'active', 'voided', 'query', 'held', 'paused']) assert.ok(STATUS_WORDS.includes(w), w);
  assert.equal(R0_ITEMS.length, 16, R0_ITEMS.join('|'));
  assert.ok(hasAmount('total 1,234.56 due', '1,234.56') && !hasAmount('total 11,234.56 due', '1,234.56') && !hasAmount('total 234.567', '234.56'));
  assert.ok(hasRun('row 2025 x', '2025') && !hasRun('on 2025-03-04', '2025') && !hasRun('x 12025', '2025'));
});

test('padding is answer-neutral: none of the target\'s identifiers, dates or amounts occurs in any archive file (320 tasks)', () => {
  let redraws = 0;
  for (const d of DS) for (const seed of SEEDS) {
    const task = gen(seed, d), truth = bed.referenceSolve(task);
    const all = Object.values(task.files);
    const text = all.join('\n');
    assert.ok(!text.toLowerCase().includes(truth.invoice_number.toLowerCase()), `${task.id}: invoice number in the archive`);
    assert.ok(!hasRun(text, String(truth.invoice_number).match(/(\d+)\D*$/)[1]), `${task.id}: invoice digits in the archive`);
    assert.ok(!hasRun(text, String(truth.customer_row)), `${task.id}: customer row in the archive`);
    const [y, m, day] = truth.issue_date.split('-');
    assert.ok(!text.includes(truth.issue_date) && !text.includes(`${y}-${day}-${m}`), `${task.id}: issue date (either reading) in the archive`);
    for (const f of ['net_minor', 'tax_minor', 'gross_minor']) {
      for (const s of amountStrings(truth[f])) assert.ok(!hasAmount(text, s), `${task.id}: ${f} printed as ${s} in the archive`);
      if (String(truth[f]).length >= 5) assert.ok(!hasRun(text, String(truth[f])), `${task.id}: ${f} as raw minor units in the archive`);
    }
    redraws += bed.describePadding(task).docs.filter(x => x.attempts > 1).length;
  }
  assert.ok(redraws <= 40, `redraws should be rare coincidences, saw ${redraws}`);
});

test('padding is answer-neutral: no status word, tax / discount / rounding / format / date-order statement or reader instruction outside sibling invoices', () => {
  const rules = [/\b(tax|taxes|vat|ust|mwst|discount|rebate|surcharge)\b/i, /\b(rounded|rounding|half away|minor unit|decimal|thousands|separator|grouping)\b/i,
    /\b(day\/month|month\/day|dd\/mm|mm\/dd|date order|date format|prints? (invoice )?dates?)\b/i, /\b(gross|net amount|line total|credited|credit note|customer row|invoice date)\b/i,
    /\b(ignore|disregard|instructions?|system prompt|previous|assistant|json|return only|you must|override|prompt)\b/i];
  const statusRe = new RegExp(`(?<![\\p{L}-])(?:${STATUS_WORDS.map(w => w.replace(/[^\p{L}\d]/gu, '')).filter(Boolean).join('|')}|status)(?![\\p{L}-])`, 'iu');
  let docs = 0;
  for (const d of DS) for (const seed of SEEDS) {
    const task = gen(seed, d);
    for (const text of paddingText(task, { siblings: false })) {
      docs++;
      assert.ok(!statusRe.test(text), `${task.id}: status vocabulary ${text.match(statusRe)?.[0]}`);
      for (const re of rules) assert.ok(!re.test(text), `${task.id}: ${re} matched "${text.match(re)?.[0]}"`);
    }
  }
  assert.ok(docs > 2000, `only ${docs} documents audited`);
});

test('padding is answer-neutral: no non-sibling document names an R0 invoice item or looks like an invoice', () => {
  for (const d of DS) for (const seed of SEEDS) {
    const task = gen(seed, d);
    for (const text of paddingText(task, { siblings: false })) {
      const low = text.toLowerCase();
      for (const item of R0_ITEMS) assert.ok(!low.includes(item), `${task.id}: contains the invoice item "${item}"`);
      assert.ok(!/invoice no\.|unit price|printed from/i.test(text), `${task.id}: invoice markers outside the sibling invoices`);
    }
  }
});

test('sibling invoices: 2-4 other invoices with exactly the target\'s conventions, so they can neither contradict the notes nor be mistaken for the target', () => {
  const seenStatus = new Set();
  for (const d of DS) for (const seed of SEEDS) {
    const task = gen(seed, d), info = bed.describePadding(task), truth = bed.referenceSolve(task);
    assert.ok(info.siblings.length >= 2 && info.siblings.length <= 4, `${task.id}: ${info.siblings.length} siblings`);
    const conv = task.inputs.notes.split('\n').slice(0, 3).join('\n');
    const ordinary = [...task.inputs.notes.split('\n')[2].matchAll(/"([^"]+)"/g)].slice(0, 2).map(m => m[1]);
    const docs = info.docs.filter(x => x.sibling);
    assert.equal(docs.length, info.siblings.length);
    assert.equal(new Set(docs.map(x => x.sibling.seed)).size, docs.length);
    for (const x of docs) {
      const t = r0.generate({ seed: x.sibling.seed, split: 'dev', difficulty: x.sibling.difficulty });
      assert.equal(task.files[x.path], t.inputs.document, 'a sibling is the document of an R0 task of another seed');
      assert.notEqual(canonical([x.sibling.seed, x.sibling.difficulty]), canonical([seed, d]));
      assert.ok([2, 3].includes(x.sibling.difficulty));
      assert.equal(t.inputs.notes.split('\n').slice(0, 3).join('\n'), conv, `${task.id}: sibling conventions differ from the target's notes`);
      assert.equal(t.inputs.notes.split('\n').length, 5, 'no per-task status word on a sibling');
      const sref = r0.referenceSolve(t);
      assert.equal(sref.currency, truth.currency);
      assert.notEqual(sref.invoice_number, truth.invoice_number);
      assert.notEqual(sref.customer_row, truth.customer_row);
      const status = task.files[x.path].match(/^Status: (.+)$/m)[1];
      assert.ok(ordinary.includes(status), `${task.id}: sibling status "${status}" is not one of the notes' words ${ordinary}`);
      seenStatus.add(status);
    }
    // only sibling invoices carry invoice markers; every other file is another kind of document
    const withMarkers = Object.entries(task.files).filter(([, text]) => /Invoice no\.:/.test(text)).map(([p]) => p);
    assert.deepEqual(withMarkers.sort(), docs.map(x => x.path).sort());
  }
  assert.ok(seenStatus.size >= 8, `sibling statuses: ${[...seenStatus]}`);
});

test('the reference answer is unchanged by padding: it equals wbed-r0\'s, and a reader of inputs alone gets the same identifiers', () => {
  for (const d of DS) for (const seed of SEEDS) {
    const task = gen(seed, d), core = r0task(seed, d), truth = bed.referenceSolve(task);
    assert.deepEqual(truth, r0.referenceSolve(core));
    // an independent reader of the printed document finds the same number and row, in inputs.document and nowhere in the archive
    assert.equal(task.inputs.document.match(/Invoice no\.: (\S+)/)[1], truth.invoice_number);
    assert.equal(Number(task.inputs.document.match(/Customer row: (\d+)/)[1]), truth.customer_row);
    assert.equal(task.inputs.document.match(/Currency: (\w+)/)[1], truth.currency);
    for (const text of Object.values(task.files)) { assert.ok(!text.includes(`Invoice no.: ${truth.invoice_number}`)); assert.ok(!text.includes(`Customer row: ${truth.customer_row}`)); }
    // the padded task and the bare task differ in id, family, prompt tail and files only
    const strip = ({ id, family, prompt, files, ...rest }) => rest;
    assert.equal(canonical(strip(task)), canonical(strip(core)));
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Size, shape and the length / structure axes.
test('size: 10-20 documents, 15-25K tokens in all, the padding is the bulk, the R0 core stays small', () => {
  const totals = [];
  for (const d of DS) for (const seed of SEEDS) {
    const task = gen(seed, d), info = bed.describePadding(task);
    assert.ok(info.docs.length >= 10 && info.docs.length <= 20, `${task.id}: ${info.docs.length} documents`);
    assert.equal(Object.keys(task.files).length, info.docs.length);
    const t = tokens(task), core = tokens(r0task(seed, d));
    totals.push(t);
    assert.ok(t >= 15000 && t <= 25000, `${task.id}: ${t} tokens`);
    assert.ok(inlineTokens(task) >= 15000 && inlineTokens(task) <= 26000, `${task.id}: inline ${inlineTokens(task)}`);
    assert.ok(core < 2000, `${task.id}: R0 core ${core}`);
    assert.ok(info.paddingTokens / t > 0.93, `${task.id}: padding share ${info.paddingTokens / t}`);
    assert.equal(bed.taskTokens(task), t);
    for (const x of info.docs) assert.equal(x.tokens, Math.ceil(bytes(task.files[x.path]) / 4));
  }
  assert.ok(Math.min(...totals) < 18500 && Math.max(...totals) > 21500, `sizes should spread over the band: ${Math.min(...totals)}..${Math.max(...totals)}`);
  assert.ok(new Set(SEEDS.map(s => bed.describePadding(gen(s, 3)).docs.length)).size >= 7, 'the document count should vary across 10..20');
});

test('documents: varied kinds, neutral names, shuffled positions, fictional addresses only', () => {
  const positions = new Set();
  for (const d of DS) for (const seed of SEEDS) {
    const task = gen(seed, d), info = bed.describePadding(task);
    const kinds = info.docs.filter(x => !x.sibling).map(x => x.kind);
    assert.equal(new Set(kinds).size, kinds.length, `${task.id}: a non-sibling kind repeated`);
    assert.ok(kinds.length >= 6);
    assert.deepEqual(info.docs.map(x => x.path), info.docs.map((_, i) => `archive/doc-${String(i + 1).padStart(2, '0')}.txt`));
    info.docs.forEach((x, i) => { if (x.sibling) positions.add(i); });
    for (const [rel, text] of Object.entries(task.files)) {
      assert.ok(text.length > 150 && text.length < 60000, `${rel}: ${text.length} chars`);
      assert.ok(!/\u0000/.test(text) && text.split('\n').every(l => l.length <= 700), `${rel}: a line is too long`);
      assert.ok(text.startsWith('HOLLIN GROUP — '), `${rel}: banner`);
      for (const e of text.match(/[\w.-]+@[\w.-]+/g) ?? []) assert.match(e, /\.example$/, `${rel}: ${e}`);
      for (const p of text.match(/\b555-\d{4}\b/g) ?? []) assert.match(p, /^555-01\d\d$/);
    }
  }
  assert.ok(positions.size >= 12, `siblings should land at many positions, saw ${[...positions]}`);
  const allKinds = new Set(SEEDS.flatMap(s => bed.describePadding(gen(s, 3)).docs.map(x => x.kind)));
  assert.equal(allKinds.size, 21, [...allKinds].join(','));          // 20 padding kinds + sibling-invoice
});

test('length and structure are separate axes: the shape of the padding is constant across difficulty, only the R0 core grows', () => {
  const lines = d => SEEDS.map(s => (gen(s, d).inputs.document.match(/^ \d+ /gm) ?? []).length);
  for (let d = 2; d < 5; d++) assert.ok(mean(lines(d + 1)) > mean(lines(d)), `lines grow with difficulty: d${d} -> d${d + 1}`);
  let sameLines = 0, totalLines = 0, identicalDocs = 0, totalDocs = 0, redrawn = 0;
  const spread = [];
  for (const seed of SEEDS) {
    const tasks = DS.map(d => gen(seed, d)), infos = tasks.map(t => bed.describePadding(t));
    const shape = i => canonical({ n: i.docs.length, kinds: i.docs.map(x => x.kind) });
    assert.equal(new Set(infos.map(shape)).size, 1, `seed ${seed}: shape changes with difficulty`);
    infos[0].docs.forEach(x => {
      if (x.sibling) return;
      const base = tasks[0].files[x.path].split('\n');
      for (let j = 1; j < DS.length; j++) {
        const other = tasks[j].files[x.path].split('\n');
        totalDocs++; if (other.join('\n') === base.join('\n')) identicalDocs++;
        if (other.length !== base.length) { redrawn++; continue; }          // a number collision redrew this document at one difficulty
        base.forEach((line, n) => { totalLines++; if (line === other[n]) sameLines++; });
      }
    });
    const t = tasks.map(tokens);
    spread.push(Math.max(...t) / Math.min(...t));
  }
  // the target's truth reaches the padding only through the rare filters: a colliding ISO date is moved to 2026 (one cell) and a
  // colliding number redraws one document, so documents agree line for line except for those cells
  assert.ok(sameLines / totalLines > 0.995, `documents should not depend on the difficulty: ${sameLines}/${totalLines} lines equal`);
  assert.ok(redrawn / totalDocs < 0.02, `${redrawn}/${totalDocs} documents were redrawn`);
  assert.ok(identicalDocs / totalDocs > 0.55, `${identicalDocs}/${totalDocs} documents byte-identical across difficulties`);
  assert.ok(Math.max(...spread) < 1.02, `same seed, different structure should be near-equal length: ${Math.max(...spread)}`);
  // across the whole 160-task grid, length is (almost) unrelated to difficulty while the R0 core's own length follows it
  const grid = SEEDS.flatMap(s => DS.map(d => ({ d, total: tokens(gen(s, d)), core: tokens(r0task(s, d)) })));
  assert.ok(Math.abs(corr(grid.map(g => g.d), grid.map(g => g.total))) < 0.1, `corr(difficulty, total) = ${corr(grid.map(g => g.d), grid.map(g => g.total))}`);
  assert.ok(corr(grid.map(g => g.d), grid.map(g => g.core)) > 0.5);
});

test('metamorphic pair with wbed-r0: same structure, a few tens of times the input', () => {
  const ratios = [];
  for (const d of DS) for (const seed of SEEDS) {
    const task = gen(seed, d), core = r0task(seed, d);
    ratios.push(tokens(task) / tokens(core));
    assert.equal(canonical(task.inputs), canonical(core.inputs));
  }
  assert.ok(Math.min(...ratios) > 25 && Math.max(...ratios) < 90, `ratio ${Math.min(...ratios).toFixed(1)}..${Math.max(...ratios).toFixed(1)}`);
});

test('hidden truth does not leak: no derived value appears in the task beyond what the R0 core already shows', () => {
  const forbiddenKey = /^(answer|truth|solution|expected|reference|oracle|near|alternatives?|sibling)$/i;
  const keysOf = v => (v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : []);
  for (const d of DS) for (const seed of SEEDS) {
    const task = gen(seed, d), core = r0task(seed, d), truth = bed.referenceSolve(task);
    assert.ok(![...keysOf(task.inputs), ...keysOf(task.budget), ...Object.keys(task)].some(k => forbiddenKey.test(k)));
    const visible = `${task.prompt}\n${JSON.stringify(task.inputs)}\n${Object.values(task.files).join('\n')}`;
    const bare = `${core.prompt}\n${JSON.stringify(core.inputs)}`;
    const count = (text, s) => text.split(s).length - 1;
    // the ISO date and the three derived amounts are never printed by the core; the archive must not add them
    assert.equal(count(visible, truth.issue_date), count(bare, truth.issue_date));
    for (const f of ['net_minor', 'tax_minor', 'gross_minor']) for (const s of amountStrings(truth[f])) assert.equal(countAmount(visible, s), countAmount(bare, s), `${task.id}: ${f} ${s}`);
    // the only place the target's identifiers occur is inputs.document
    assert.equal(count(visible, truth.invoice_number), count(bare, truth.invoice_number));
    assert.equal(count(visible, `Customer row: ${truth.customer_row}`), 1);
  }
});

test('no adversarial text: the only prompt addition is the templated note; the archive holds no instructions (README marks this)', () => {
  for (const d of DS) for (const seed of SEEDS.slice(0, 20)) {
    const task = gen(seed, d);
    assert.equal(task.prompt.split('\n').length, r0task(seed, d).prompt.split('\n').length + 1);
    for (const text of Object.values(task.files)) assert.ok(!/ignore (all|the|any|previous)|disregard|as an ai|system prompt|you are an? |respond with|reply with|output the/i.test(text));
  }
});

test('performance: generate and oracle stay well under 2 s at difficulty 5 (cold caches)', () => {
  let worstGenerate = 0, worstOracle = 0;
  for (let i = 0; i < 20; i++) {
    const seed = 80000 + i * 7;
    const t0 = performance.now();
    const task = fresh(seed, 5);
    const t1 = performance.now();
    for (const c of bed.badControls) bed.oracle(task, c.make(task));
    bed.oracle(task, bed.referenceSolve(task));
    const t2 = performance.now();
    worstGenerate = Math.max(worstGenerate, t1 - t0);
    worstOracle = Math.max(worstOracle, (t2 - t1) / (bed.badControls.length + 1));
  }
  assert.ok(worstGenerate < 2000 && worstOracle < 2000, `generate ${worstGenerate.toFixed(0)} ms, oracle ${worstOracle.toFixed(0)} ms`);
});

test('robustness: a wide seed sweep yields a valid padded task at every difficulty (sibling search, redraws, size band)', () => {
  for (const d of DS) for (let seed = 1; seed <= 60; seed++) {
    const task = fresh(seed, d, seed % 2 ? 'dev' : 'test');
    assert.ok(tokens(task) >= 15000 && tokens(task) <= 25000, `${task.id}: ${tokens(task)}`);
    assert.equal(bed.oracle(task, bed.referenceSolve(task)).pass, true);
  }
});
