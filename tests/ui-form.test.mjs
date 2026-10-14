// G21 tier 0 (tools/ui): schema -> form compile, golden HTML, the static page contract and the conformance fixtures.
// $0, no model, no network. Development evidence (the fixtures were written while building the sidecar).
//   node --test tests/ui-form.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { checkCase, listCases } from '../tools/ui/fixtures.mjs';
import { compileForm, tryCompileForm, renderForm, renderAccepted, FORM_CSP, FORM_CSS, FORM_STYLE_HASH, LIMITS, acceptSubmission, submissionFromAnswer } from '../tools/ui/index.mjs';
import { genSchema, rng } from '../tools/ui/generate.mjs';

const cases = listCases();

test('fixtures: the conformance layout holds at least 40 cases in three areas', () => {
  const byArea = Object.groupBy(cases, c => c.area);
  assert.deepEqual(Object.keys(byArea).sort(), ['compile', 'refuse', 'submit']);
  assert.ok(cases.length >= 40, `${cases.length} cases`);
  for (const c of byArea.compile) assert.ok(c.html && c.expected?.fields, `${c.id} has expected.json fields and expected.html`);
  for (const c of byArea.refuse) assert.ok(c.expected?.errors?.length, `${c.id} lists its refusal`);
  for (const c of byArea.submit) assert.ok(c.interactions?.interactions.length, `${c.id} has interactions`);
});

for (const c of cases) {
  test(`fixture ${c.id}`, () => assert.deepEqual(checkCase(c), []));
}

test('refusal codes: every refuse case fires only its listed codes, and the set covers every compile refusal code', () => {
  const codes = new Set(cases.filter(c => c.area === 'refuse').flatMap(c => c.expected.errors.map(e => e.code)));
  for (const code of ['unsupported-keyword', 'unsupported-type', 'keyword-not-applicable', 'unsupported-nesting', 'unsupported-array-items', 'no-fields',
    'required-undeclared', 'enum-duplicate', 'enum-member-invalid', 'unsatisfiable', 'pattern-invalid', 'pattern-unsafe', 'pattern-needs-max-length',
    'schema-limit', 'invalid-schema', 'invalid-question', 'invalid-bind', 'unsafe-key']) assert.ok(codes.has(code), `a refuse fixture covers ${code}`);
});

// ---- the static page contract -------------------------------------------------------------------------------------
const tagNames = html => [...html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\b/g)].map(m => m[1].toLowerCase());
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
const unescape = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Returns contract violations of a rendered page (empty = ok). */
function pageContract(html, spec) {
  const problems = [], add = p => problems.push(p);
  const allowed = new Set(['html', 'head', 'meta', 'title', 'style', 'body', 'main', 'div', 'h1', 'h2', 'p', 'span', 'ul', 'li', 'a', 'form', 'input', 'label', 'fieldset', 'legend', 'select', 'option', 'textarea', 'button', 'pre']);
  for (const name of tagNames(html)) if (!allowed.has(name)) add(`element <${name}> is outside the page vocabulary`);
  if (/\son[a-z]+\s*=/i.test(html)) add('an event-handler attribute');
  if (/\sstyle\s*=/i.test(html)) add('an inline style attribute');
  // No attribute may load or navigate anywhere: no src-like attribute at all, and href/action are in-page or relative.
  if (/<[^>]*\s(?:src|srcset|formaction|poster|background|ping|data)\s*=/i.test(html)) add('a resource-loading attribute');
  for (const m of html.matchAll(/\s(href|action)="([^"]*)"/g)) if (/^\s*[a-z][a-z0-9+.-]*:|^\s*\/\//i.test(unescape(m[2]))) add(`${m[1]} with a URL`);
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)];
  if (styles.length !== 1 || `sha256-${createHash('sha256').update(styles[0][1]).digest('base64')}` !== FORM_STYLE_HASH) add('the style block does not match its CSP hash');
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);
  if (!csp || unescape(csp[1]) !== FORM_CSP) add('the CSP meta is missing or different');
  const ids = [...html.matchAll(/\sid="([^"]*)"/g)].map(m => m[1]);
  if (new Set(ids).size !== ids.length) add('duplicate ids');
  const idSet = new Set(ids);
  for (const m of html.matchAll(/\sfor="([^"]*)"/g)) if (!idSet.has(m[1])) add(`label for="${m[1]}" has no target`);
  for (const m of html.matchAll(/\saria-(?:describedby|labelledby)="([^"]*)"/g)) for (const id of m[1].split(' ')) if (!idSet.has(id)) add(`aria reference ${id} has no target`);
  for (const m of html.matchAll(/\shref="([^"]*)"/g)) if (!m[1].startsWith('#') || !idSet.has(m[1].slice(1))) add(`link ${m[1]} is not an in-page anchor`);
  const labelled = new Set([...html.matchAll(/<label for="([^"]*)"/g)].map(m => m[1]));
  const controls = [...html.matchAll(/<(input|select|textarea)\b[^>]*>/g)].map(m => m[0]).filter(tag => attr(tag, 'type') !== 'hidden');
  for (const tag of controls) if (!labelled.has(attr(tag, 'id'))) add(`control ${attr(tag, 'name')} has no label`);
  if (spec) {
    const names = new Set(controls.map(tag => unescape(attr(tag, 'name'))));
    const declared = new Set(spec.fields.map(f => f.name));
    if (names.size !== declared.size || [...names].some(n => !declared.has(n))) add(`rendered fields ${[...names]} != declared ${[...declared]}`);
    if (!html.includes(`name="_spec" value="${spec.specHash}"`)) add('the spec hash is not in the form');
    if (!/<form method="post" action="[^"]*" novalidate/.test(html)) add('the form is not a novalidate POST form');
  }
  if ((html.match(/<h1\b/g) ?? []).length !== 1) add('the page needs exactly one h1');
  return problems;
}

test('page contract: every compile fixture page, empty and after a rejected submission, meets the static contract', () => {
  for (const c of cases.filter(x => x.area === 'compile')) {
    const spec = compileForm(c.input);
    assert.deepEqual(pageContract(renderForm(spec), spec), [], c.id);
    // an all-blank submission: every required field gets an error, linked from the summary
    const rejected = acceptSubmission(spec, `_spec=${encodeURIComponent(spec.specHash)}`);
    if (!rejected.ok) {
      const html = renderForm(spec, { values: rejected.values, errors: rejected.errors });
      assert.deepEqual(pageContract(html, spec), [], `${c.id} with errors`);
      assert.match(html, /<title>Error: /);
      assert.match(html, /role="alert"[^>]*autofocus/);
      for (const e of rejected.errors.filter(x => x.statementId)) {
        const field = spec.fields.find(f => f.name === e.statementId);
        assert.match(html, new RegExp(`id="${field.id}-error"`), `${c.id}: ${field.name} shows its error`);
        assert.match(html, new RegExp(`aria-describedby="[^"]*${field.id}-error`), `${c.id}: ${field.name} links its error`);
      }
    }
  }
  const spec = compileForm(cases.find(c => c.id === 'compile/007-hold-release').input);
  assert.deepEqual(pageContract(renderAccepted(spec, { decision: 'release', amount: 1, reason: '</pre><script>x</script>' })), []);
});

test('compile is deterministic and idempotent on 300 generated schemas; every leaf has exactly one field', () => {
  const r = rng(20261014);
  let compiled = 0;
  for (let i = 0; i < 300; i++) {
    const schema = genSchema(r);
    const a = tryCompileForm({ answerSchema: schema, question: `Generated ${i}?` });
    assert.equal(a.ok, true, `generated schema ${i} is inside the subset: ${JSON.stringify(a.errors)}`);
    const b = compileForm({ answerSchema: structuredClone(schema), question: `Generated ${i}?` });
    assert.equal(a.spec.specHash, b.specHash);
    assert.equal(renderForm(a.spec), renderForm(b));
    const leaves = [];
    const walk = (s, p) => { if (s.type === 'object' && !Object.hasOwn(s, 'enum')) for (const [k, v] of Object.entries(s.properties)) walk(v, `${p}/${k.replaceAll('~', '~0').replaceAll('/', '~1')}`); else leaves.push(p); };
    walk(schema, '');
    assert.deepEqual(a.spec.fields.map(f => f.path), leaves, `schema ${i}: one field per leaf, in schema order`);
    assert.deepEqual(pageContract(renderForm(a.spec), a.spec), [], `schema ${i}`);
    compiled++;
  }
  assert.equal(compiled, 300);
});

test('the spec hash binds the schema, the question, the form name and the task binding', () => {
  const base = { answerSchema: { type: 'boolean' }, question: 'Proceed?', formName: 'a', bind: { runId: 'r1', nodeKey: 'root/ask' } };
  const h = x => compileForm({ ...base, ...x }).specHash;
  const all = [h({}), h({ question: 'Proceed now?' }), h({ formName: 'b' }), h({ bind: { runId: 'r2', nodeKey: 'root/ask' } }), h({ answerSchema: { type: 'boolean', description: 'x' } })];
  assert.equal(new Set(all).size, all.length);
  assert.equal(h({}), h({}));
  const spec = compileForm(base);
  assert.ok(Object.isFrozen(spec) && Object.isFrozen(spec.fields[0]), 'specs are immutable');
  // a body from one task's form is stale for another task's form
  const other = compileForm({ ...base, bind: { runId: 'r2', nodeKey: 'root/ask' } });
  const body = submissionFromAnswer(spec, true).body;
  assert.equal(acceptSubmission(spec, body).ok, true);
  assert.deepEqual(acceptSubmission(other, body).errors.map(e => e.code), ['stale-form']);
});

test('limits: oversized and over-deep schemas and questions are refused, not truncated', () => {
  const deep = {}; let at = deep; for (let i = 0; i < 20; i++) { at.type = 'object'; at.properties = { x: {} }; at = at.properties.x; }
  at.type = 'string';
  assert.deepEqual(tryCompileForm({ answerSchema: deep, question: 'q' }).errors.map(e => e.code), ['schema-limit']);
  const wide = { type: 'object', properties: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`p${i}`, { type: 'boolean', description: 'd'.repeat(1900) }])) };
  assert.deepEqual(tryCompileForm({ answerSchema: wide, question: 'q' }).errors.map(e => e.code), ['schema-limit']);
  assert.deepEqual(tryCompileForm({ answerSchema: { type: 'boolean' }, question: 'q'.repeat(LIMITS.questionCodePoints + 1) }).errors.map(e => e.code), ['invalid-question']);
  assert.deepEqual(tryCompileForm({ answerSchema: { type: 'boolean', description: 'd'.repeat(LIMITS.noteCodePoints + 1) }, question: 'q' }).errors.map(e => e.code), ['invalid-schema']);
  assert.deepEqual(tryCompileForm({ answerSchema: { enum: Array.from({ length: LIMITS.options + 1 }, (_, i) => i) }, question: 'q' }).errors.map(e => e.code), ['schema-limit']);
  assert.throws(() => compileForm({ answerSchema: { type: 'null' }, question: 'q' }), e => e.code === 'UI_FORM_REFUSED' && e.errors[0].code === 'unsupported-type');
  assert.deepEqual(tryCompileForm({ answerSchema: { type: 'string', maxLength: 9, pattern: '^[0-9]{9}$' }, question: 'q', allowPattern: false }).errors.map(e => e.code), ['unsupported-keyword']);
});

test('render: the action must be a relative URL; the CSS has no remote reference', () => {
  const spec = compileForm({ answerSchema: { type: 'boolean' }, question: 'q' });
  for (const action of ['https://evil.example/', '//evil.example/x', 'javascript:alert(1)', 'data:text/html,x', '\\\\evil', 'a\nb']) assert.throws(() => renderForm(spec, { action }), TypeError, action);
  for (const action of ['', '/tasks/7/answer', '?step=2', 'answer']) assert.doesNotThrow(() => renderForm(spec, { action }));
  assert.doesNotMatch(FORM_CSS, /url\(|@import|https?:/);
});
