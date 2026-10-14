// G21 tier 0 (tools/ui): the formState adapter and the host validator. Round trips through both routes, a
// differential check against the engine's own validator (src/validate.mjs validateData, ajv 8), soundness under
// garbage input, hostile content, the loopback host, and an end-to-end run through the real Runtime.
// $0, no model, no network beyond 127.0.0.1. Development evidence.
//   node --test tests/ui-form-adapter.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import net from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateData, validateWorkflow } from '../src/validate.mjs';
import { Store } from '../src/store.mjs';
import { Runtime } from '../src/runtime.mjs';
import { createDefaultRegistry } from '../src/capabilities.mjs';
import {
  compileForm, tryCompileForm, validateAnswer, answerFromFormState, acceptSubmission, formStateFromAnswer, submissionFromAnswer, renderForm,
  createFormHandler, parseNumberText, patternProblems, patternTest, valueErrors, FORM_CSP_HEADER, displayText, canonicalAnswer, MAX_ERRORS,
  PATTERN_BUDGET_MS,
} from '../tools/ui/index.mjs';
import { genSchema, genValid, mutate, rng, PLANTED_NUMBER_TEXT, openuiNumeric, openuiValue, plantedOutcomes, webAppNumber, webAppValue } from '../tools/ui/generate.mjs';

const engineAccepts = (schema, value) => { try { validateData(schema, value, 'answer', { trustedSchema: true }); return true; } catch (error) { if (error.code === 'SCHEMA_MISMATCH' || error.code === 'UNSAFE_KEY' || error.code === 'DATA_LIMIT') return false; throw error; } };
const gen = (schema, question, formName) => compileForm({ answerSchema: schema, question, formName, allowPattern: true });
const KNOWN_GAPS = new Set(['undeclared-property', 'empty-optional-group', 'optional-empty-text', 'optional-empty-selection', 'selection-order-or-duplicates', 'line-break-in-single-line-input', 'carriage-return', 'lone-surrogate']);

const HOLD = { type: 'object', additionalProperties: false, required: ['decision', 'amount', 'reason'], properties: {
  decision: { enum: ['release', 'keep-hold', 'reduce-limit'] }, amount: { type: 'number', minimum: 0, maximum: 1000000 },
  reason: { type: 'string', minLength: 1, maxLength: 500 }, tags: { type: 'array', items: { enum: ['urgent', 'vip', 'fraud-check'] }, maxItems: 2 },
  notify: { type: 'boolean' }, reference: { type: 'string', pattern: '^INV-[0-9]{6}$', maxLength: 10 },
} };
const holdSpec = (bind = null) => compileForm({ answerSchema: HOLD, question: 'Release the credit hold on SO-1042?', formName: 'hold', bind, allowPattern: true });

test('differential: the host validator accepts exactly what the engine validator accepts (2,000 generated schemas, 14,000 answers)', t => {
  const r = rng(424242);
  const tally = { schemas: 0, pairs: 0, valid: 0, invalid: 0, disagreements: [] };
  for (let i = 0; i < 2000; i++) {
    const schema = genSchema(r);
    const spec = gen(schema, `Generated ${i}?`);
    tally.schemas++;
    const answers = [];
    for (let k = 0; k < 3; k++) answers.push(genValid(r, schema));
    for (let k = 0; k < 4; k++) answers.push(mutate(r, schema, answers[k % 3]));
    for (const answer of answers) {
      if (answer === undefined) continue;
      tally.pairs++;
      const host = validateAnswer(spec, answer).length === 0, engine = engineAccepts(schema, answer);
      if (host) tally.valid++; else tally.invalid++;
      if (host !== engine) tally.disagreements.push({ i, schema, answer, host, engine });
    }
  }
  assert.deepEqual(tally.disagreements.slice(0, 3), [], `${tally.disagreements.length} disagreements`);
  assert.ok(tally.pairs >= 13000 && tally.valid > 4000 && tally.invalid > 4000, JSON.stringify({ ...tally, disagreements: tally.disagreements.length }));
  t.diagnostic(`differential ${JSON.stringify({ ...tally, disagreements: tally.disagreements.length })}`);
});

// The `urlencoded` route is the encoder submissionFromAnswer feeding acceptSubmission: it is built from the same spec as
// the parser and does not read the rendered page (review P2-9; tests/ui-form.test.mjs checks the page's field names and
// option tokens against the spec, and tests/ui-form-browser.test.mjs drives one schema in Chromium).
test('completability: every generated valid answer has a canonical equivalent that round-trips exactly through every route; the only misses are text a browser widget cannot hold', t => {
  const r = rng(77);
  const counts = { answers: 0, exact: { typed: 0, text: 0, urlencoded: 0 }, canonical: { typed: 0, text: 0, urlencoded: 0 }, gaps: {} };
  const BROWSER_ONLY = new Set(['line-break-in-single-line-input', 'carriage-return', 'lone-surrogate']);
  for (let i = 0; i < 1000; i++) {
    const schema = genSchema(r);
    const spec = gen(schema, `Generated ${i}?`, 'gen');
    for (let k = 0; k < 3; k++) {
      const answer = genValid(r, schema);
      assert.equal(validateAnswer(spec, answer).length, 0, 'the generator makes valid answers');
      counts.answers++;
      const canonical = canonicalAnswer(spec, answer);
      assert.equal(validateAnswer(spec, canonical).length, 0, `canonical answer ${i} stays valid`);
      assert.ok(engineAccepts(schema, canonical));
      for (const [route, run] of [
        ['typed', a => { const { event, gaps } = formStateFromAnswer(spec, a); return { gaps, result: answerFromFormState(spec, event) }; }],
        ['text', a => { const { event, gaps } = formStateFromAnswer(spec, a, { mode: 'text' }); return { gaps, result: answerFromFormState(spec, event) }; }],
        ['urlencoded', a => { const { body, gaps } = submissionFromAnswer(spec, a); return { gaps, result: acceptSubmission(spec, body) }; }],
      ]) {
        // as given: no gap means an exact round trip; every gap is a known kind
        const given = run(answer);
        for (const g of given.gaps) { assert.ok(KNOWN_GAPS.has(g), `unknown gap ${g}`); counts.gaps[`${route}:${g}`] = (counts.gaps[`${route}:${g}`] ?? 0) + 1; }
        if (given.result.ok) assert.ok(engineAccepts(schema, given.result.answer), `${route}: accepted an answer the engine rejects`);
        if (given.gaps.length === 0) { assert.deepEqual(given.result.answer, answer, `${route} ${i}`); counts.exact[route]++; }
        // canonical: only text a browser widget cannot hold may remain
        const canon = run(canonical);
        assert.ok(canon.gaps.every(g => route === 'urlencoded' && BROWSER_ONLY.has(g)), `${route} ${i}: canonical gaps ${canon.gaps}`);
        if (canon.gaps.length === 0) { assert.deepEqual(canon.result.answer, canonical, `${route} canonical ${i}`); counts.canonical[route]++; }
      }
    }
  }
  assert.equal(counts.canonical.typed, counts.answers);
  assert.equal(counts.canonical.text, counts.answers);
  assert.ok(counts.canonical.urlencoded / counts.answers > 0.9, JSON.stringify(counts));
  t.diagnostic(`completability ${JSON.stringify(counts)}`);
});

test('mutants through the routes: whatever the adapter accepts, the engine accepts (soundness on 4,000 mutated answers, two routes)', t => {
  const r = rng(9001);
  let accepted = 0, rejected = 0;
  for (let i = 0; i < 1000; i++) {
    const schema = genSchema(r);
    const spec = gen(schema, 'q', 'm');
    for (let k = 0; k < 4; k++) {
      const bad = mutate(r, schema, genValid(r, schema));
      for (const result of [answerFromFormState(spec, formStateFromAnswer(spec, bad).event), answerFromFormState(spec, formStateFromAnswer(spec, bad, { mode: 'text' }).event)]) {
        if (result.ok) { accepted++; assert.ok(engineAccepts(schema, result.answer)); } else rejected++;
      }
    }
  }
  assert.ok(rejected > accepted, `${rejected} rejected, ${accepted} accepted (accepted mutants lost their defect in the form, e.g. an undeclared key)`);
  t.diagnostic(`mutants rejected ${rejected}, accepted ${accepted} (all accepted ones engine-valid)`);
});

test('garbage formState and request bodies never throw, and anything accepted passes the engine validator', () => {
  const r = rng(5);
  const junk = () => r.pick([null, true, 0, -0, 1e308, 'x', '', '12abc', [], [null], {}, { value: 1 }, { __proto__: null }, 'true', '<script>', [1, 'a'], { 0: true }, { a: { b: 1 } }]);
  const spec = holdSpec();
  let accepted = 0;
  for (let i = 0; i < 4000; i++) {
    const fields = {};
    for (const f of spec.fields) if (r.chance(0.7)) fields[f.name] = r.chance(0.9) ? { value: junk(), ...(r.chance(0.5) ? { componentType: r.pick([f.componentType, 'Input', 'Slider', 1]) } : {}) } : junk();
    if (r.chance(0.1)) fields[r.pick(['answer/x', '__proto__', '', 'answer'])] = { value: junk() };
    const event = r.chance(0.8) ? { formName: r.pick(['hold', 'hold', 'other', undefined]), formState: { hold: fields } } : r.pick([junk(), { hold: fields }, { hold: fields, other: {} }]);
    const result = answerFromFormState(spec, event);
    if (result.ok) { accepted++; assert.ok(engineAccepts(HOLD, result.answer)); }
    else assert.ok(result.errors.length > 0 && result.errors.every(e => e.source && e.code && e.message));
  }
  for (let i = 0; i < 2000; i++) {
    const params = new URLSearchParams();
    params.append('_spec', r.chance(0.9) ? spec.specHash : 'x');
    for (const f of spec.fields) { const n = r.pick([0, 1, 1, 1, 2]); for (let k = 0; k < n; k++) params.append(f.name, r.pick(['', '0', '1', '2', '7', 'true', 'false', 'x', '12abc', '1e3', ' 5 ', 'INV-123456', '-1', '%zz'])); }
    if (r.chance(0.1)) params.append(r.pick(['_token', 'answer/zz', 'answer']), 'x');
    const result = acceptSubmission(spec, r.chance(0.95) ? params.toString() : r.pick(['%', '&&&', '=x', 'a=%E0%A4%A', '_spec']));
    if (result.ok) { accepted++; assert.ok(engineAccepts(HOLD, result.answer)); }
  }
  // control: the same pipeline accepts a well-formed entry (so the loop above did not pass by rejecting everything)
  const control = acceptSubmission(spec, new URLSearchParams([['_spec', spec.specHash], ['answer/decision', '0'], ['answer/amount', '5'], ['answer/reason', 'x']]).toString());
  assert.deepEqual(control.answer, { decision: 'release', amount: 5, reason: 'x' });
  return accepted;
});

test('planted number text: the host rejects every entry (no wrong value); OpenUI numeric and the current web/app.js parser store wrong values for some', t => {
  const spec = holdSpec();
  const openui = PLANTED_NUMBER_TEXT.filter(openuiNumeric), webApp = PLANTED_NUMBER_TEXT.filter(webAppNumber);
  // review P2-10: "accepted" and "accepted with a wrong value" are reported apart; four planted entries are only
  // non-canonical spellings ("12.", ".5", "+5", "12" + NBSP), which the host refuses at a usability cost
  const outcomes = { openui: plantedOutcomes(openuiNumeric, openuiValue), webApp: plantedOutcomes(webAppNumber, webAppValue) };
  assert.deepEqual([outcomes.openui.accepts, outcomes.openui.wrongValue, outcomes.webApp.accepts, outcomes.webApp.wrongValue], [15, 11, 6, 2]);
  assert.deepEqual(outcomes.webApp.wrong, ['0x10', '0b101']);
  for (const text of PLANTED_NUMBER_TEXT) {
    const result = answerFromFormState(spec, { formName: 'hold', formState: { hold: { 'answer/decision': { value: 'release' }, 'answer/amount': { value: text }, 'answer/reason': { value: 'r' } } } });
    assert.equal(result.ok, false, `${JSON.stringify(text)} must be rejected`);
    assert.ok(['not-a-number', 'number-out-of-range'].includes(result.errors[0].code), `${text}: ${result.errors[0].code}`);
  }
  assert.ok(openui.includes('12abc') && openui.length >= 8, `OpenUI numeric accepts ${JSON.stringify(openui)}`);
  assert.ok(webApp.includes('0x10') && webApp.includes('0b101'), `web/app.js Number() accepts ${JSON.stringify(webApp)}`);
  t.diagnostic(`planted ${PLANTED_NUMBER_TEXT.length}: host accepts 0 (refuses 4 unambiguous spellings); OpenUI numeric accepts ${openui.length}, ${outcomes.openui.wrongValue} with a wrong value; web/app.js accepts ${webApp.length}, ${outcomes.webApp.wrongValue} with a wrong value ${JSON.stringify(outcomes.webApp.wrong)}`);
  // and good entries parse exactly
  for (const [text, n] of [['0', 0], ['-12.5', -12.5], ['1e3', 1000], ['1E-2', 0.01], ['\t42 ', 42], ['007', null], ['-0.0', 0], ['1250.50', 1250.5], ['0.1', 0.1],
    ['12.5e1', 125], ['100000000000000000000', 1e20], ['9007199254740992', 2 ** 53], ['5e-324', 5e-324], ['1.7976931348623157e308', Number.MAX_VALUE]]) {
    const parsed = parseNumberText(text, 'number');
    if (n === null) assert.equal(parsed.code, 'not-a-number', text); else assert.equal(Object.is(parsed.value, n), true, `${text} -> ${parsed.value}`);
  }
});

test('number text that the stored number would not keep exactly is refused, not rounded (review P2-7)', () => {
  for (const [text, type] of [['0.99999999999999999', 'integer'], ['1.0000000000000001', 'number'], ['1.00000000000000001', 'integer'], ['9007199254740993', 'integer'],
    ['9007199254740993', 'number'], ['123456789012345678', 'number'], ['4e-324', 'number'], ['0.30000000000000000001', 'number']]) {
    assert.equal(parseNumberText(text, type).code, 'number-precision', `${type} ${text}`);
  }
  // the probe: an integer field with maximum 1 and a number field with maximum 1 no longer take these as 1
  const spec = compileForm({ answerSchema: { type: 'object', required: ['n', 'x'], properties: { n: { type: 'integer', minimum: 0, maximum: 1 }, x: { type: 'number', maximum: 1 } } }, question: 'q', formName: 'i' });
  const r = acceptSubmission(spec, new URLSearchParams([['_spec', spec.specHash], ['answer/n', '0.99999999999999999'], ['answer/x', '1.0000000000000001']]).toString());
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map(e => [e.code, e.statementId]), [['number-precision', 'answer/n'], ['number-precision', 'answer/x']]);
});

test('patterns: admitted patterns stay fast on worst-case inputs; catastrophic shapes are refused', () => {
  for (const p of ['^(a+)+$', '^(a|aa)*$', '(.*a){12}', '^(\\w+\\s?)*$', '^([a-z0-9]+)*@x$', '\\d*\\d*x', '^(?<=a)b$', '^(a)\\1$',
    // review P1-1: [^] and [] close the class at once; every quantifier counts, small ones and ? included
    '^[^](a+)+[^]$', '^[](a+)+[]$', '^[^](a*)*$', `^${'a?'.repeat(28)}${'a'.repeat(28)}$`, `^${'a{0,16}'.repeat(10)}$`, '^[a-z]*[a-z]*[a-z]*$',
    '^(?:a|b|c|d)?(?:a|b|c|d)?[a-z]*[a-z]*$', '^(?i:a)+$', '^(?<n>a+)+$']) assert.ok(patternProblems(p).length > 0, p);
  for (const p of ['^INV-[0-9]{6}$', '^[A-Z]{2}-[0-9]{1,6}$', '^[a-z]+$', '^(?:yes|no)$', 'INV', '^[a-z]*[a-z]*$', '^[^]{0,5}$', '^(?<prefix>[A-Z]{3})-[0-9]+$', '^[^\\]]+$']) {
    assert.deepEqual(patternProblems(p), [], p);
  }
  const spec = compileForm({ answerSchema: { type: 'string', maxLength: 256, pattern: '^[a-z]*[a-z]*$' }, question: 'q', formName: 'p', allowPattern: true });
  const evil = `${'a'.repeat(255)}!`;
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) assert.equal(validateAnswer(spec, evil)[0].code, 'pattern-mismatch');
  assert.ok(performance.now() - t0 < 2000, `20 worst-case checks took ${performance.now() - t0} ms`);
  // a string over maxLength never reaches the pattern
  assert.equal(validateAnswer(spec, `${'a'.repeat(100000)}!`)[0].code, 'too-long');
});

test('patterns: the matcher runs in a worker with a per-answer budget, so a pattern the bound misjudges costs at most the budget (review P1-1)', () => {
  // patternTest is the backstop for any pattern, admitted or not
  assert.equal(patternTest('^INV-[0-9]{6}$', 'INV-123456'), true);
  assert.equal(patternTest('^INV-[0-9]{6}$', 'INV-12345X'), false);
  let t0 = performance.now();
  assert.equal(patternTest('^(a+)+$', `${'a'.repeat(40)}!`, 200), 'timeout');
  assert.ok(performance.now() - t0 < 2000, `timed out after ${performance.now() - t0} ms`);
  assert.equal(patternTest('^a$', 'a'), true, 'a fresh worker replaces the stopped one');
  // through the validator: one budget per answer, however many pattern fields time out; the answer is rejected
  const evil = { type: 'string', maxLength: 64, pattern: '^(a+)+$' };
  const schema = { type: 'object', properties: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`f${i}`, evil])) };
  const answer = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`f${i}`, `${'a'.repeat(40)}!`]));
  t0 = performance.now();
  const errors = valueErrors(schema, answer);
  const elapsed = performance.now() - t0;
  assert.deepEqual(errors.map(e => e.code), Array(8).fill('pattern-timeout'));
  assert.ok(elapsed < PATTERN_BUDGET_MS + 1500, `8 timed-out fields took ${elapsed} ms (budget ${PATTERN_BUDGET_MS} ms per answer)`);
  // the reviewer's admitted bypasses are refused at compile time, and the enum route no longer runs a pattern
  assert.deepEqual(tryCompile({ type: 'string', maxLength: 64, pattern: '^[^](a+)+[^]$' }), ['pattern-unsafe']);
  assert.deepEqual(tryCompile({ type: 'string', maxLength: 256, pattern: `^${'a{0,16}'.repeat(10)}$` }), ['pattern-unsafe']);
  t0 = performance.now();
  assert.deepEqual(tryCompile({ type: 'string', enum: [`x${'a'.repeat(40)}!!`, 'ok'], pattern: '^[^](a+)+[^]$' }), ['keyword-not-applicable']);
  assert.ok(performance.now() - t0 < 500);
});
const tryCompile = schema => { const r = tryCompileForm({ answerSchema: schema, question: 'q', allowPattern: true }); return r.ok ? [] : r.errors.map(e => e.code); };

const HOSTILE = [
  '<img src=x onerror="window.__pwned=1">', '"><script>window.__pwned=2</script>', "'><svg onload=alert(1)>", '<a href="javascript:alert(1)">x</a>',
  '</textarea><script>x</script>', '</option></select><input name="answer/amount" value="0">', '<style>*{display:none}</style>', '<!--', ']]>', '&lt;b&gt;',
  'javascript:alert(1)', 'data:text/html,<b>x</b>', 'https://evil.example/collect?d=', '{{constructor.constructor("x")()}}', '${7*7}', '<%= 7*7 %>',
  `evil${String.fromCodePoint(0x202E)}txt.exe`, `a${String.fromCodePoint(0x200B)}b`, `x${String.fromCodePoint(0x2066)}y${String.fromCodePoint(0x2069)}`,
  `nul${String.fromCharCode(0)}byte`, `bell${String.fromCharCode(7)}`, `cr\rlf`, String.fromCharCode(0xD800), `${String.fromCodePoint(0xFEFF)}bom`, `soft${String.fromCodePoint(0xAD)}hyphen`,
  'a'.repeat(5000), '\n\n\nlead', '  spaced  ', 'line1\nline2', '\\u003cscript\\u003e', '%3Cscript%3E', '&#60;script&#62;', 'url(javascript:x)', 'expression(alert(1))',
  '<form action="https://evil.example">', '<base href="https://evil.example/">', '<meta http-equiv="refresh" content="0;url=https://evil.example">', '<iframe srcdoc="x">', '<math><mi xlink:href="x">', '<details open ontoggle=alert(1)>',
];
// The element/attribute skeleton of a page: tag names and attribute names in order, attribute values and text left out.
const skeleton = html => [...html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z-]+(?:="[^"]*")?)*)\s*>/g)]
  .map(m => `${m[1]}${m[2]}[${[...m[3].matchAll(/\s+([a-zA-Z-]+)(?:="[^"]*")?/g)].map(a => a[1]).join(',')}]`).join(' ');

test(`hostile content (${HOSTILE.length} payloads) in the question, titles, descriptions, property names, enum labels and echoed values adds no element or attribute`, () => {
  const build = p => { const n = p.slice(0, 1500); return { type: 'object', required: ['pick', 'note'], properties: {
    [`k${p}`]: { type: 'string', maxLength: 50, title: n, description: n }, pick: { enum: [p, 'other'] }, note: { type: 'string', description: n }, tags: { type: 'array', items: { enum: [p, 'z'] } },
  } }; };
  const benign = 'X';
  const base = compileForm({ answerSchema: build(benign), question: benign });
  const baseSkeleton = skeleton(renderForm(base, { values: { 'answer/note': benign }, errors: [{ source: 'validator', code: 'x', statementId: 'answer/note', message: benign }] }));
  for (const p of HOSTILE) {
    const spec = compileForm({ answerSchema: build(p), question: p });
    const html = renderForm(spec, { values: { 'answer/note': p }, errors: [{ source: 'validator', code: 'x', statementId: 'answer/note', message: p }] });
    assert.equal(skeleton(html), baseSkeleton, `payload ${JSON.stringify(p.slice(0, 40))} changed the element/attribute skeleton`);
    assert.ok(!html.includes(p) || !/[<>"'&]/.test(p), `payload ${JSON.stringify(p.slice(0, 40))} appears unescaped`);
    for (const c of [0x202E, 0x200B, 0x2066, 0xFEFF, 0x00AD, 0, 7]) if (p.includes(String.fromCodePoint(c))) {
      const marker = displayText(String.fromCodePoint(c));
      assert.ok(html.includes(marker) && marker.startsWith(String.fromCodePoint(0x27E6)), `hidden character U+${c.toString(16)} is shown as a marker`);
    }
  }
});

test('hostile values typed by a person round-trip byte-exact through the browser route and stay text', () => {
  const spec = compileForm({ answerSchema: { type: 'object', required: ['note'], properties: { note: { type: 'string' } } }, question: 'Note?', formName: 'n' });
  for (const p of [...HOSTILE.filter(x => !/[\r\uD800-\uDFFF]/.test(x)), 'x'.repeat(1000000), '<script>'.repeat(100000)]) {
    const { body, gaps } = submissionFromAnswer(spec, { note: p });
    assert.deepEqual(gaps, []);
    const result = acceptSubmission(spec, body);
    assert.equal(result.ok, true);
    assert.equal(result.answer.note, p, `round trip of ${JSON.stringify(p.slice(0, 30))}`);
  }
  // CR and lone surrogates are the documented exceptions
  assert.deepEqual(submissionFromAnswer(spec, { note: 'a\rb' }).gaps, ['carriage-return']);
  assert.deepEqual(submissionFromAnswer(spec, { note: String.fromCharCode(0xD800) }).gaps, ['lone-surrogate']);
});

// ---- the loopback host -------------------------------------------------------------------------------------------
async function serve(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  return { port, origin: `http://127.0.0.1:${port}`, url: `http://127.0.0.1:${port}${handler.path}`, server };
}
const post = (url, body, type = 'application/x-www-form-urlencoded') => fetch(url, { method: 'POST', headers: { 'content-type': type }, body });
// A raw request with any headers (fetch does not let a caller set Host).
const raw = (port, { method = 'GET', path = '/', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, method, path, headers: { ...(body !== undefined ? { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) } : {}), ...headers } }, res => {
    let data = ''; res.setEncoding('utf8'); res.on('data', c => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
  });
  req.on('error', reject);
  if (body !== undefined) req.write(body);
  req.end();
});
const TOKEN = 'tok-7-0123456789abcdefghijklmnopqrstuvwxyz';

test('host: GET renders under the strict CSP; a bad POST re-renders with errors (422); the first good POST wins and later ones get 409', async t => {
  const spec = holdSpec({ taskId: 'T-hold' }), answers = [];
  const handler = createFormHandler({ spec, token: TOKEN, onAnswer: a => answers.push(a) });
  assert.equal(handler.path, `/?t=${TOKEN}`);
  const { url, origin } = await serve(t, handler);
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('content-security-policy'), FORM_CSP_HEADER);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await page.text(), new RegExp(`name="_token" value="${TOKEN}"`));
  const good = submissionFromAnswer(spec, { decision: 'release', amount: 10, reason: 'ok' }, { token: TOKEN }).body;
  const bad = good.replace('answer%2Famount=10', 'answer%2Famount=12abc');
  const rejected = await post(url, bad);
  assert.equal(rejected.status, 422);
  const html = await rejected.text();
  assert.match(html, /There is a problem/);
  assert.match(html, /value="12abc"/, 'what the person typed is kept');
  assert.equal((await post(url, good, 'text/plain')).status, 415);
  assert.equal((await fetch(url, { method: 'PUT' })).status, 405);
  assert.equal((await fetch(`${origin}/favicon.ico?t=${TOKEN}`)).status, 404);
  assert.equal(answers.length, 0);
  const accepted = await post(url, good);
  assert.equal(accepted.status, 200);
  assert.match(await accepted.text(), /Answer recorded/);
  assert.deepEqual(answers, [{ decision: 'release', amount: 10, reason: 'ok' }]);
  assert.equal((await post(url, good)).status, 409);
  assert.equal(answers.length, 1);
});

test('host: only the holder of the capability URL, on loopback, same-origin, can read or answer the form (review P1-2, P1-3)', async t => {
  const spec = holdSpec({ taskId: 'T-hold' }), answers = [];
  const handler = createFormHandler({ spec, onAnswer: a => answers.push(a) });
  assert.match(handler.token, /^[A-Za-z0-9_-]{43}$/, 'a random 256-bit token when none is given');
  assert.notEqual(createFormHandler({ spec }).token, handler.token);
  const { url, origin, port } = await serve(t, handler);
  const host = `127.0.0.1:${port}`;
  const good = submissionFromAnswer(spec, { decision: 'release', amount: 10, reason: 'ok' }, { token: handler.token }).body;
  const attacker = submissionFromAnswer(spec, { decision: 'release', amount: 999999, reason: 'x' }).body; // the spec hash is public
  // without the token nothing is served, GET included, and nothing is echoed
  for (const path of ['/', '/?t=', `/?t=${handler.token.slice(0, -1)}x`, `/?t=${handler.token}&t=${handler.token}`]) {
    const r = await raw(port, { path, headers: { host } });
    assert.equal(r.status, 403, path);
    assert.doesNotMatch(r.body, /_token|<form/);
  }
  assert.equal((await post(`${origin}/`, attacker)).status, 403);
  // DNS rebinding: a request naming another host gets nothing, even with the right path
  for (const name of [`rebind.evil.example:${port}`, '127.0.0.1', `127.0.0.1:${port + 1}`, `127.0.0.1.nip.example:${port}`]) {
    const r = await raw(port, { path: handler.path, headers: { host: name } });
    assert.equal(r.status, 403, name);
    assert.doesNotMatch(r.body, new RegExp(handler.token));
  }
  for (const name of [`localhost:${port}`, `LOCALHOST:${port}`]) assert.equal((await raw(port, { path: handler.path, headers: { host: name } })).status, 200, name);
  // cross-site and cross-origin requests are refused before the body is read, with the token in the URL or not
  for (const headers of [{ 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }, { origin: 'https://evil.example' }, { origin: `http://localhost:${port + 1}` }, { 'sec-fetch-site': 'none' }]) {
    const r = await raw(port, { method: 'POST', path: handler.path, headers: { host, ...headers }, body: good });
    assert.equal(r.status, 403, JSON.stringify(headers));
  }
  assert.equal((await raw(port, { path: handler.path, headers: { host, 'sec-fetch-site': 'cross-site' } })).status, 403);
  // a browser's same-origin form post under no-referrer sends Origin: null with Sec-Fetch-Site: same-origin
  // P1-3: an envelope failure (no or wrong _token, stale _spec) is a 403 with no form and no echoed values
  const p9 = await raw(port, { method: 'POST', path: handler.path, headers: { host, origin: 'null', 'sec-fetch-site': 'same-origin' }, body: 'answer%2Fdecision=1&answer%2Famount=999999' });
  assert.equal(p9.status, 403);
  assert.doesNotMatch(p9.body, /<form|_token|999999|checked/);
  const wrongToken = await raw(port, { method: 'POST', path: handler.path, headers: { host }, body: good.replace(encodeURIComponent(handler.token), 'x'.repeat(43)) });
  assert.equal(wrongToken.status, 403);
  assert.doesNotMatch(wrongToken.body, /<form|_token/);
  assert.equal(answers.length, 0);
  assert.equal(handler.state.refused >= 10, true);
  const ok = await raw(port, { method: 'POST', path: handler.path, headers: { host, origin: 'null', 'sec-fetch-site': 'same-origin' }, body: good });
  assert.equal(ok.status, 200);
  assert.deepEqual(answers, [{ decision: 'release', amount: 10, reason: 'ok' }]);
  // after the answer, the recorded answer is still behind the token
  assert.equal((await raw(port, { path: '/', headers: { host } })).status, 403);
  assert.match((await fetch(url).then(r => r.text())), /Answer recorded/);
  // a handler needs a task-bound spec and a strong token (review P2-6)
  assert.throws(() => createFormHandler({ spec: holdSpec() }), /bound to one task/);
  assert.throws(() => createFormHandler({ spec, token: 'tok-7' }), /32 to 256/);
});

test('host: a malformed request is a 400 and the host keeps serving (review P1-4)', async t => {
  const spec = compileForm({ answerSchema: { type: 'boolean' }, question: 'q', bind: { taskId: 'T-url' } });
  const handler = createFormHandler({ spec });
  const { port, url } = await serve(t, handler);
  for (const target of ['http://[', 'http://a b/', 'http://%zz/']) {
    const line = await new Promise(resolve => {
      const c = net.connect(port, '127.0.0.1', () => c.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`));
      let d = ''; c.on('data', x => { d += x; }); c.on('close', () => resolve(d.split('\r\n')[0])); c.on('error', e => resolve(String(e.code)));
    });
    assert.match(line, /^HTTP\/1\.1 4\d\d /, `${target}: ${line}`);
  }
  assert.equal((await fetch(url)).status, 200, 'still serving');
});

test('host: an async onAnswer is awaited; a rejection is not recorded, the person is told so, and the form stays open (review P1-5)', async t => {
  const spec = compileForm({ answerSchema: { enum: ['yes', 'no'] }, question: 'Ok?', formName: 'a', bind: { taskId: 'T-async' } });
  let mode = 'reject', release, calls = 0;
  const recorded = [];
  const handler = createFormHandler({ spec, onAnswer: async answer => {
    calls++;
    await null;
    if (mode === 'reject') { const e = new Error('conflict'); e.code = 'ANSWER_CONFLICT'; throw e; }
    if (mode === 'null') throw null; // eslint-disable-line no-throw-literal
    if (mode === 'slow') await new Promise(resolve => { release = resolve; });
    recorded.push(answer);
  } });
  const { url } = await serve(t, handler);
  const body = submissionFromAnswer(spec, 'yes', { token: handler.token }).body;
  const refused = await post(url, body);
  assert.equal(refused.status, 409);
  const html = await refused.text();
  assert.match(html, /The answer was not recorded \(ANSWER_CONFLICT\)/);
  assert.doesNotMatch(html, /Answer recorded/);
  assert.equal(handler.state.answered, false);
  mode = 'null';
  assert.equal((await post(url, body)).status, 409, 'throw null is handled');
  assert.equal(handler.state.answered, false);
  // while an answer is being recorded, other posts get 409 and the first one still wins
  mode = 'slow';
  const first = post(url, body);
  while (!release) await new Promise(resolve => setTimeout(resolve, 5));
  const second = await post(url, submissionFromAnswer(spec, 'no', { token: handler.token }).body);
  assert.equal(second.status, 409);
  assert.match(await second.text(), /being recorded/);
  release();
  assert.equal((await first).status, 200);
  assert.deepEqual(recorded, ['yes']);
  assert.equal(handler.state.answered, true);
  assert.equal(calls, 3);
});

test('host: oversized bodies get a delivered 413, error pages are capped, and close() ends the task (review P2-11, P2-6)', async t => {
  const spec = compileForm({ answerSchema: { type: 'boolean' }, question: 'q', bind: { taskId: 'T-big' } });
  const handler = createFormHandler({ spec });
  const { url } = await serve(t, handler);
  const big = await post(url, `_spec=x&answer=${'a'.repeat(2 * 1024 * 1024)}`);
  assert.equal(big.status, 413);
  // a body of thousands of unknown names: the page lists at most MAX_ERRORS problems
  const names = Array.from({ length: 20000 }, (_, i) => `z${i.toString(36)}=`).join('&');
  const t0 = performance.now();
  const flood = await post(url, `_spec=${encodeURIComponent(spec.specHash)}&_token=${handler.token}&${names}`);
  assert.equal(flood.status, 422);
  const html = await flood.text();
  assert.ok(html.length < 64 * 1024, `the error page is ${html.length} bytes`);
  assert.equal((html.match(/<li>/g) ?? []).length + (html.match(/<li><a /g) ?? []).length, MAX_ERRORS);
  assert.match(html, /more problems are not listed/);
  assert.ok(performance.now() - t0 < 2000);
  handler.close();
  assert.equal((await fetch(url)).status, 410);
  assert.equal((await post(url, submissionFromAnswer(spec, true, { token: handler.token }).body)).status, 410);
});

// ---- end to end through the real runtime ----------------------------------------------------------------------------
test('runtime: awaiting_human -> compiled form -> host re-validation -> Runtime.answer -> the run completes; "12abc" never reaches the runtime', async t => {
  const answerSchema = { type: 'object', additionalProperties: false, required: ['decision', 'amount', 'reason'], properties: {
    decision: { enum: ['release', 'keep-hold'] }, amount: { type: 'number', minimum: 0 }, reason: { type: 'string', minLength: 1, maxLength: 200 },
    tags: { type: 'array', items: { enum: ['urgent', 'vip'] } } } };
  const ref = $ref => ({ $ref });
  const workflow = { schemaVersion: '1.0', id: 'UiFormHold', version: 1, title: 'Credit hold release with a tier-0 form', domain: 'diagnostic',
    goal: 'Exercise a human node answered through the compiled form route.', envelope: { assumptions: ['Synthetic local capabilities only'], risks: [], successCriteria: ['The typed answer reaches the run.'] },
    budget: { maxSteps: 20, maxConcurrency: 1, maxDurationMs: 5000, maxCost: 0 },
    nodes: [{ id: 'ask', kind: 'human', needs: [], description: 'A person decides the hold', question: 'Release the credit hold on SO-1042?', answerSchema },
      { id: 'echo', kind: 'task', needs: ['ask'], description: 'Echo the decision', tool: 'core.identity', args: { decision: ref('nodes.ask.answer.decision'), amount: ref('nodes.ask.answer.amount') }, timeoutMs: 1000, retry: { maxAttempts: 1 } }],
    acceptance: [{ op: 'eq', left: ref('nodes.echo.decision'), right: 'release' }, { op: 'eq', left: ref('nodes.echo.amount'), right: 1250.5 }] };
  const registry = createDefaultRegistry();
  const validation = validateWorkflow(workflow, { registry });
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  const workspace = mkdtempSync(path.join(tmpdir(), 'foundry-ui-form-'));
  const store = new Store(workspace);
  t.after(() => { store.close(); rmSync(workspace, { recursive: true, force: true }); });
  store.saveWorkflow(workflow);
  const runtime = new Runtime(store, registry, { allowedCapabilities: registry.list().map(c => c.name), maxSteps: 20, maxConcurrency: 1, maxDurationMs: 5000, maxCost: 0 });
  const run = runtime.create(workflow, {});
  assert.equal((await runtime.execute(run.id)).status, 'awaiting_human');
  const state = store.rows.nodeState(run.id, 'root', 'ask');
  const spec = compileForm({ answerSchema: state.answerSchema, question: state.question, formName: 'root/ask', bind: { runId: run.id, nodeKey: 'root/ask' } });
  // the runtime itself also refuses an untyped amount (defence in depth)
  assert.throws(() => runtime.answer(run.id, 'root/ask', { decision: 'release', amount: '12abc', reason: 'x' }), { code: 'SCHEMA_MISMATCH' });
  let calls = 0;
  const handler = createFormHandler({ spec, onAnswer: answer => { calls++; runtime.answer(run.id, 'root/ask', answer); } });
  const { url } = await serve(t, handler);
  const answer = { decision: 'release', amount: 1250.5, reason: 'Paid in full\n<script>x</script>', tags: ['vip'] };
  const good = submissionFromAnswer(spec, answer, { token: handler.token }).body;
  assert.equal((await post(url, good.replace('answer%2Famount=1250.5', 'answer%2Famount=12abc'))).status, 422);
  assert.equal(calls, 0, 'the planted entry never reached Runtime.answer');
  assert.equal(store.rows.nodeState(run.id, 'root', 'ask').status, 'awaiting_human');
  assert.equal((await post(url, good)).status, 200);
  assert.equal(calls, 1);
  const done = await runtime.execute(run.id);
  assert.equal(done.status, 'succeeded', JSON.stringify(done.error ?? done.verdict));
  assert.deepEqual(store.rows.nodeState(run.id, 'root', 'ask').status, 'completed');
});
