// ownerci hidden regression tests for src/context.mjs. Authored for the bed from the ORIGINAL
// module's behaviour at the frozen commit; never shown to solvers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CONTEXT_COMPILER, DEFAULT_PERSONA, OUTPUT_NOTE, UNTRUSTED_PREAMBLE, checkLabel, compileContext, contextInputs, estimateTokens,
  inheritedLabel, joinLabels } from './src/context.mjs';
import { digest } from './src/data.mjs';

const bytes = s => Buffer.byteLength(s, 'utf8');
const marker = total => `\n[truncated by foundry-context/1: original ${total} bytes]`;
const node = (extra = {}) => ({ id: 'n1', instructions: 'Do the thing.', description: 'One step', ...extra });
const blockOf = (prompt, name) => prompt.split(new RegExp(`<input name="${name}" label="[^"]*">\\n`))[1].split('\n</input>')[0];

test('hidden context: checkLabel accepts trusted and untrusted source lists only', () => {
  assert.equal(checkLabel('trusted'), 'trusted');
  assert.equal(checkLabel('untrusted:a+b.c:d-e_f'), 'untrusted:a+b.c:d-e_f');
  for (const bad of ['untrusted:', 'untrusted:a+', 'Trusted', 'untrusted:a b', 'trusted ', 42, null]) {
    assert.throws(() => checkLabel(bad), { code: 'CONTEXT_LABEL' }, String(bad));
  }
  assert.throws(() => checkLabel('x'.repeat(100)), e => e.message === `Invalid integrity label: ${'x'.repeat(80)}`);
});

test('hidden context: joinLabels deduplicates and sorts sources; all-trusted stays trusted', () => {
  assert.equal(joinLabels([]), 'trusted');
  assert.equal(joinLabels(['trusted']), 'trusted');
  assert.equal(joinLabels(['untrusted:z', 'untrusted:a+z', 'trusted']), 'untrusted:a+z');
  assert.equal(joinLabels(['untrusted:m', 'untrusted:b']), 'untrusted:b+m');
  assert.equal(joinLabels(new Set(['untrusted:q'])), 'untrusted:q');
  assert.throws(() => joinLabels(['trusted', 'untrusted:']), { code: 'CONTEXT_LABEL' });
});

test('hidden context: inheritedLabel matches the ref, its ancestors and its descendants on dot boundaries', () => {
  const labels = { 'input.raw': 'untrusted:upload', 'nodes.a.b': 'untrusted:web' };
  assert.equal(inheritedLabel('input.raw', labels), 'untrusted:upload');
  assert.equal(inheritedLabel('input.raw.text', labels), 'untrusted:upload');
  assert.equal(inheritedLabel('input', labels), 'untrusted:upload');
  assert.equal(inheritedLabel('input.rawx', labels), 'trusted');
  assert.equal(inheritedLabel('inputs', labels), 'trusted');
  assert.equal(inheritedLabel('nodes', labels), 'untrusted:web');
  assert.equal(inheritedLabel('nodes.a', labels), 'untrusted:web');
  assert.equal(inheritedLabel('nodes.ab', labels), 'trusted');
  assert.equal(inheritedLabel('item'), 'trusted');
  assert.equal(inheritedLabel('input', { input: 'untrusted:x', 'input.raw': 'untrusted:upload' }), 'untrusted:upload+x');
});

test('hidden context: contextInputs resolves literals and refs and never removes taint', () => {
  assert.deepEqual(contextInputs(node(), {}), []);
  assert.deepEqual(contextInputs(node({ context: {} }), {}), []);
  const refs = { input: { doc: { text: 'hello' } } };
  const [lit, ref, tainted] = contextInputs(node({ context: { inputs: [
    { name: 'lit', value: [1, 2], render: 'json', maxTokens: 9, priority: 3 },
    { name: 'ref', ref: 'input.doc' },
    { name: 'tainted', value: 'v', label: 'untrusted:x' },
  ] } }), refs, { 'input.doc.text': 'untrusted:mail' });
  assert.deepEqual(lit, { name: 'lit', value: [1, 2], label: 'trusted', render: 'json', maxTokens: 9, priority: 3, sourceRef: null });
  assert.deepEqual(ref, { name: 'ref', value: { text: 'hello' }, label: 'untrusted:mail', render: undefined, maxTokens: undefined, priority: undefined, sourceRef: 'input.doc' });
  ref.value.text = 'changed';
  assert.equal(refs.input.doc.text, 'hello', 'resolved values are copies');
  assert.equal(tainted.label, 'untrusted:x');
  const declared = contextInputs(node({ context: { inputs: [{ name: 'r', ref: 'input.doc', label: 'untrusted:y' }] } }), refs, { input: 'untrusted:b' });
  assert.equal(declared[0].label, 'untrusted:b+y');
  assert.throws(() => contextInputs(node({ context: { inputs: [{ name: 'neither' }] } }), refs), e => e.code === 'CONTEXT_INPUT' && e.message === 'Context input neither needs exactly one of ref or value');
  assert.throws(() => contextInputs(node({ context: { inputs: [{ name: 'both', ref: 'input', value: 1 }] } }), refs), { code: 'CONTEXT_INPUT' });
});

test('hidden context: node, history and instruction validation', () => {
  assert.throws(() => compileContext(), e => e.code === 'CONTEXT_INPUT' && e.message === 'A node is required');
  assert.throws(() => compileContext({ node: 'n1' }), { code: 'CONTEXT_INPUT' });
  assert.throws(() => compileContext({ node: node({ context: { history: 'all' } }), inputs: [] }), e => e.code === 'CONTEXT_UNSUPPORTED');
  assert.equal(typeof compileContext({ node: node({ context: { history: 'none' } }), inputs: [] }).prompt, 'string');
  assert.throws(() => compileContext({ node: node({ instructions: '   ' }), inputs: [] }), e => e.code === 'CONTEXT_INPUT' && e.message === 'Node n1 needs instructions');
  assert.throws(() => compileContext({ node: node({ instructions: 7 }), inputs: [] }), { code: 'CONTEXT_INPUT' });
  assert.throws(() => compileContext({ node: node(), inputs: { a: 1 } }), e => e.message === 'inputs must be an array');
});

test('hidden context: input names, values, maxTokens and priority are validated', () => {
  const c = inputs => compileContext({ node: node(), inputs });
  assert.equal(c([{ name: 'a'.repeat(64), value: 1 }]).receipt.inputs[0].name, 'a'.repeat(64));
  for (const name of ['a'.repeat(65), '1abc', '_x', '', undefined]) assert.throws(() => c([{ name, value: 1 }]), { code: 'CONTEXT_INPUT' }, String(name));
  assert.throws(() => c([{ name: 'x', value: 1 }, { name: 'x', value: 2 }]), e => e.message === 'Context input names must be unique identifiers: x');
  assert.throws(() => c([{ name: 'x' }]), e => e.message === 'Context input x has no value');
  assert.equal(c([{ name: 'x', value: null }]).prompt.startsWith('<input name="x" label="trusted">\nnull\n</input>'), true);
  for (const maxTokens of [0, -1, 1.5, '4']) assert.throws(() => c([{ name: 'x', value: 1, maxTokens }]), e => e.message === 'maxTokens of x must be a positive integer');
  assert.equal(c([{ name: 'x', value: 1, maxTokens: 1 }]).receipt.inputs[0].truncated, false);
  for (const priority of [NaN, Infinity, '1']) assert.throws(() => c([{ name: 'x', value: 1, priority }]), e => e.message === 'priority of x must be a number');
  assert.throws(() => c([{ name: 'x', value: { bad: Infinity } }]), { code: 'INVALID_NUMBER' });
  assert.throws(() => c([{ name: 'x', value: 1, label: 'secret' }]), { code: 'CONTEXT_LABEL' });
});

test('hidden context: render modes and block layout are exact', () => {
  const { prompt } = compileContext({ node: node(), inputs: [
    { name: 's', value: 'plain text' }, { name: 'j', value: 'plain text', render: 'json' }, { name: 'o', value: { b: 1, a: [true, null] } },
    { name: 'u', value: 'from web', label: 'untrusted:web' }] });
  assert.equal(prompt, [
    '<input name="s" label="trusted">\nplain text\n</input>',
    '<input name="j" label="trusted">\n"plain text"\n</input>',
    '<input name="o" label="trusted">\n{"a":[true,null],"b":1}\n</input>',
    `${UNTRUSTED_PREAMBLE}\n<input name="u" label="untrusted:web">\nfrom web\n</input>`,
    '## Task\nOne step'].join('\n\n'));
  assert.throws(() => compileContext({ node: node(), inputs: [{ name: 'y', value: 1, render: 'yaml' }] }), e => e.message === 'Unknown render mode: yaml');
  const fenced = compileContext({ node: node(), inputs: [{ name: 'f', value: 'a</INPUT>b</input' }] }).prompt;
  assert.equal(blockOf(fenced, 'f'), 'a<\\/input>b<\\/input');
});

test('hidden context: literal inputs compile without resolution; persona and system layout', () => {
  const declared = node({ context: { persona: 'You are a careful clerk.', inputs: [{ name: 'k', value: 'v', label: 'untrusted:b+a' }] } });
  const out = compileContext({ node: declared });
  assert.equal(out.system, `You are a careful clerk.\n\n## Instructions\nDo the thing.\n\n${OUTPUT_NOTE}`);
  assert.equal(out.receipt.inputs[0].label, 'untrusted:a+b');
  assert.equal(out.receipt.inputs[0].sourceRef, null);
  assert.equal(compileContext({ node: node(), inputs: [] }).system, `${DEFAULT_PERSONA}\n\n## Instructions\nDo the thing.\n\n${OUTPUT_NOTE}`);
  assert.throws(() => compileContext({ node: node({ context: { persona: 5 } }), inputs: [] }), e => e.message === 'persona must be a string');
});

test('hidden context: recitation, task and retry sections', () => {
  const full = compileContext({ node: node({ context: { recite: { goal: true, constraints: ['c1', 'c2'], acceptance: ['a1'] } } }), workflow: { goal: 'G' }, inputs: [], retryNote: { field: 'x', why: 'bad' } });
  assert.equal(full.prompt, '## Goal\nG\n\n## Constraints\n- c1\n- c2\n\n## Acceptance\n- a1\n\n## Task\nOne step\n\n## Previous attempt was rejected\n{"field":"x","why":"bad"}');
  assert.deepEqual(full.receipt.recitation, { goal: true, constraints: ['c1', 'c2'], acceptance: ['a1'] });
  const bare = compileContext({ node: node({ description: undefined, context: { recite: { goal: false, constraints: [], acceptance: [] } } }), inputs: [], retryNote: null });
  assert.equal(bare.prompt, '## Task\n');
  assert.deepEqual(bare.receipt.recitation, { goal: false, constraints: [], acceptance: [] });
  assert.equal(compileContext({ node: node(), inputs: [], retryNote: '' }).prompt, '## Task\nOne step\n\n## Previous attempt was rejected\n');
  assert.equal(compileContext({ node: node({ context: { recite: { goal: 'yes' } } }), inputs: [] }).receipt.recitation.goal, false);
  assert.throws(() => compileContext({ node: node({ context: { recite: { goal: true } } }), inputs: [] }), e => e.message === 'Goal recitation requires workflow.goal');
  assert.throws(() => compileContext({ node: node({ context: { recite: { constraints: ['ok', 3] } } }), inputs: [] }), e => e.message === 'Recited constraints and acceptance must be strings');
  assert.throws(() => compileContext({ node: node({ context: { recite: { acceptance: [null] } } }), inputs: [] }), { code: 'CONTEXT_INPUT' });
});

test('hidden context: budget validation and the smaller-budget rule', () => {
  const c = (budget, classBudget) => compileContext({ node: node({ context: { budget } }), inputs: [{ name: 'x', value: 'y' }], classBudget });
  assert.deepEqual(c(undefined, undefined).receipt.budget, { maxInputTokens: null, onOverflow: 'fail' });
  assert.deepEqual(c({ maxInputTokens: 500 }, 900).receipt.budget, { maxInputTokens: 500, onOverflow: 'fail' });
  assert.deepEqual(c({ maxInputTokens: 900, onOverflow: 'truncate' }, 500).receipt.budget, { maxInputTokens: 500, onOverflow: 'truncate' });
  assert.deepEqual(c(undefined, null).receipt.budget, { maxInputTokens: null, onOverflow: 'fail' });
  assert.throws(() => c({ onOverflow: 'drop' }), e => e.message === 'Unknown onOverflow policy: drop');
  for (const bad of [0, -5, 1.5, '100']) assert.throws(() => c({ maxInputTokens: bad }), e => e.message === 'Token budgets must be positive integers', String(bad));
  assert.throws(() => c(undefined, 0), e => e.message === 'Token budgets must be positive integers');
});

test('hidden context: the budget boundary is inclusive and overflow reports the estimate', () => {
  const make = pad => ({ node: node({ instructions: `Do it.${'.'.repeat(pad)}` }), inputs: [{ name: 'x', value: 'abc' }] });
  let pad = 0, total;
  for (;; pad++) { const o = compileContext(make(pad)); total = bytes(o.system) + bytes(o.prompt); if (total % 4 === 0) break; }
  const exact = compileContext({ ...make(pad), classBudget: total / 4 });
  assert.equal(exact.receipt.totalTokens, total / 4);
  assert.throws(() => compileContext({ ...make(pad), classBudget: total / 4 - 1 }), e => e.code === 'CONTEXT_OVERFLOW'
    && e.message === `Context for n1 needs ${estimateTokens(exact.system) + estimateTokens(exact.prompt)} tokens (estimate) but the budget is ${total / 4 - 1}`
    && e.details.maxInputTokens === total / 4 - 1 && e.details.onOverflow === 'fail');
});

test('hidden context: per-input maxTokens truncates only above the limit and keeps UTF-8 intact', () => {
  const run = (value, maxTokens) => compileContext({ node: node(), inputs: [{ name: 'x', value, maxTokens }] });
  const atLimit = run('a'.repeat(400), 100);
  assert.equal(atLimit.receipt.inputs[0].truncated, false);
  assert.equal(blockOf(atLimit.prompt, 'x'), 'a'.repeat(400));
  const over = run('a'.repeat(401), 100);
  assert.equal(over.receipt.inputs[0].truncated, true);
  assert.equal(blockOf(over.prompt, 'x'), 'a'.repeat(400 - bytes(marker(401))) + marker(401));
  const euros = run('€'.repeat(200), 50);
  const keep = Math.floor((200 - bytes(marker(600))) / 3);
  assert.equal(blockOf(euros.prompt, 'x'), '€'.repeat(keep) + marker(600));
  const emoji = run('😀'.repeat(100), 30);
  assert.equal(blockOf(emoji.prompt, 'x'), '😀'.repeat(Math.floor((120 - bytes(marker(400))) / 4)) + marker(400));
  assert.equal(euros.receipt.inputs[0].tokens, estimateTokens(blockOf(euros.prompt, 'x')));
  // a marker longer than the data never "truncates" it
  const tiny = run('abcdefgh', 1);
  assert.equal(tiny.receipt.inputs[0].truncated, false);
  assert.equal(blockOf(tiny.prompt, 'x'), 'abcdefgh');
});

test('hidden context: overflow truncation takes the lowest priority, then the later input, until it fits', () => {
  const inputs = () => [{ name: 'first', value: 'a'.repeat(3000) }, { name: 'second', value: 'b'.repeat(3000) }, { name: 'keep', value: 'c'.repeat(3000), priority: 2 }];
  const n = node({ context: { budget: { maxInputTokens: 2000, onOverflow: 'truncate' } } });
  const out = compileContext({ node: n, inputs: inputs() });
  assert.deepEqual(out.receipt.inputs.map(i => [i.name, i.truncated]), [['first', false], ['second', true], ['keep', false]]);
  assert.equal(bytes(out.system) + bytes(out.prompt), 2000 * 4);
  const tighter = compileContext({ node: node({ context: { budget: { maxInputTokens: 1000, onOverflow: 'truncate' } } }), inputs: inputs() });
  assert.deepEqual(tighter.receipt.inputs.map(i => i.truncated), [true, true, false]);
  assert.ok(bytes(tighter.system) + bytes(tighter.prompt) <= 4000);
  const negative = compileContext({ node: n, inputs: [{ name: 'first', value: 'a'.repeat(3000), priority: -1 }, { name: 'second', value: 'b'.repeat(3000) }, { name: 'keep', value: 'c'.repeat(3000), priority: 2 }] });
  assert.deepEqual(negative.receipt.inputs.map(i => i.truncated), [true, false, false]);
  assert.throws(() => compileContext({ node: node({ context: { budget: { maxInputTokens: 2000, onOverflow: 'fail' } } }), inputs: inputs() }), { code: 'CONTEXT_OVERFLOW' });
});

test('hidden context: hashes, receipt fields and quarantine declassification', () => {
  const schema = { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' } } };
  const inputs = [{ name: 'doc', value: 'text', label: 'untrusted:web', sourceRef: 'input.doc' }, { name: 'n', value: 3 }];
  const plain = compileContext({ node: node(), inputs });
  assert.equal(plain.promptHash, digest({ system: plain.system, prompt: plain.prompt }));
  assert.equal(plain.receipt.promptHash, plain.promptHash);
  assert.equal(plain.receiptHash, digest(plain.receipt));
  assert.equal(plain.receipt.prefixHash, createHash('sha256').update(plain.system, 'utf8').digest('hex'));
  assert.equal(plain.receipt.compiler, CONTEXT_COMPILER);
  assert.deepEqual(plain.receipt.inputs, [
    { name: 'doc', sourceRef: 'input.doc', sourceHash: digest('text'), label: 'untrusted:web', tokens: 1, truncated: false },
    { name: 'n', sourceRef: null, sourceHash: digest(3), label: 'trusted', tokens: 1, truncated: false }]);
  assert.equal(plain.receipt.totalTokens, Math.ceil((bytes(plain.system) + bytes(plain.prompt)) / 4));
  assert.equal(plain.outputLabel, 'untrusted:web');
  assert.equal('declassifiedFrom' in plain.receipt, false);
  const withSchema = compileContext({ node: node(), inputs, schema });
  assert.equal(withSchema.promptHash, digest({ system: plain.system, prompt: plain.prompt, schema }));
  assert.equal(compileContext({ node: node({ returns: schema }), inputs }).promptHash, withSchema.promptHash);
  const q = compileContext({ node: node({ quarantined: true, returns: schema }), inputs });
  assert.equal(q.outputLabel, 'trusted'); assert.equal(q.receipt.declassifiedFrom, 'untrusted:web');
  const qTrusted = compileContext({ node: node({ quarantined: true, returns: schema }), inputs: [{ name: 'n', value: 3 }] });
  assert.equal(qTrusted.outputLabel, 'trusted'); assert.equal('declassifiedFrom' in qTrusted.receipt, false);
  const notQuite = compileContext({ node: node({ quarantined: 'yes', returns: { type: 'object', properties: { s: { type: 'string' } } } }), inputs });
  assert.equal(notQuite.outputLabel, 'untrusted:web');
  assert.throws(() => compileContext({ node: node({ quarantined: true, returns: { type: 'object', additionalProperties: false, properties: { s: { type: 'string' } } } }), inputs }), { code: 'QUARANTINE_SCHEMA' });
});

test('hidden context: estimateTokens is ceil(utf8 bytes / 4)', () => {
  for (const [text, n] of [['', 0], ['a', 1], ['abcd', 1], ['abcde', 2], ['€', 1], ['€€', 2], ['😀😀', 2], ['x'.repeat(4001), 1001]]) assert.equal(estimateTokens(text), n, text);
});
