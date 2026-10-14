// Conformance fixtures for tier-0 forms, in OpenUI's layout (spec/fixtures/1.0, openui@39ce989): one folder per
// case, `<area>/<NNN-short-name>/`, with an input, an expected result and, for interaction cases, an
// `interactions.json` of { interactions, expected }. Comparison follows OpenUI's rules: errors are compared as a
// multiset on the structural keys each expected entry lists (`source`, `code`, `statementId`, `component`, `path`);
// `message` and `hint` are text for people and are never compared.
//
//   node tools/ui/fixtures.mjs                 run every case, print a summary, exit 1 on any mismatch
//   node tools/ui/fixtures.mjs --write-html    rewrite compile/*/expected.html from the current renderer (review the diff)
//
// Files per case:
//   input.json          { question, answerSchema, formName?, bind?, token?, allowPattern? }
//   expected.json       compile:  { fields: [[name, componentType, valueType, required, group]], warnings: [code] }
//                       refuse:   { errors: [{ source, code, path }] }
//   expected.html       compile only: the golden page (byte-exact, with the spec hash written as {{spec}}: the hash
//                       binds the semantics code, compile.mjs SEMANTICS, so it changes with any edit of that code)
//   interactions.json   submit only: { interactions: [step], expected: { results: [result] } } where a step is
//                       { formState: <event or formState> } | { submit: [[name, value], ...] } | { submitRaw: "a=b" }
//                       | { answer: <typed answer> }, and a result is { ok: true, answer } or { ok: false, errors }.
//                       In submit pairs, "{{spec}}" and "{{token}}" stand for the spec hash and the case token.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { tryCompileForm } from './compile.mjs';
import { acceptSubmission, answerFromFormState } from './formstate.mjs';
import { renderForm } from './render.mjs';
import { validateAnswer } from './validate.mjs';

export const FIXTURES = fileURLToPath(new URL('./fixtures/1/', import.meta.url));
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
const STRUCTURAL = ['source', 'code', 'statementId', 'component', 'path'];

export function listCases(root = FIXTURES) {
  const cases = [];
  for (const area of readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort()) {
    for (const name of readdirSync(path.join(root, area), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort()) {
      const dir = path.join(root, area, name);
      const file = f => path.join(dir, f);
      cases.push({
        area, name, dir, id: `${area}/${name}`,
        input: readJson(file('input.json')),
        expected: existsSync(file('expected.json')) ? readJson(file('expected.json')) : null,
        html: existsSync(file('expected.html')) ? readFileSync(file('expected.html'), 'utf8') : null,
        interactions: existsSync(file('interactions.json')) ? readJson(file('interactions.json')) : null,
      });
    }
  }
  return cases;
}

const compileInput = input => ({ answerSchema: input.answerSchema, question: input.question, formName: input.formName, bind: input.bind, allowPattern: input.allowPattern === true });
// The golden page with the spec hash replaced by a placeholder (the page contract test checks the real hash is there).
const goldenHtml = (spec, input) => renderForm(spec, { token: input.token ?? null }).replaceAll(spec.specHash, '{{spec}}');

/** Errors as a multiset: every expected entry must match a distinct actual entry on the keys it lists, and no actual entry may be left over. */
export function errorsMatch(expected, actual) {
  const left = [...actual];
  for (const e of expected) {
    const i = left.findIndex(a => Object.keys(e).filter(k => STRUCTURAL.includes(k)).every(k => isDeepStrictEqual(a[k], e[k])));
    if (i < 0) return false;
    left.splice(i, 1);
  }
  return left.length === 0;
}

const fill = (text, spec, token) => String(text).replaceAll('{{spec}}', spec.specHash).replaceAll('{{token}}', token ?? '');

export function runStep(spec, step, token) {
  if (own(step, 'formState')) return answerFromFormState(spec, step.formState);
  if (own(step, 'submit')) {
    const params = new URLSearchParams();
    for (const [name, value] of step.submit) params.append(fill(name, spec, token), fill(value, spec, token));
    return acceptSubmission(spec, params, { token: token ?? null });
  }
  if (own(step, 'submitRaw')) return acceptSubmission(spec, fill(step.submitRaw, spec, token), { token: token ?? null });
  if (own(step, 'answer')) { const errors = validateAnswer(spec, step.answer); return errors.length ? { ok: false, errors } : { ok: true, answer: step.answer, errors }; }
  throw new Error(`unknown interaction ${JSON.stringify(Object.keys(step))}`);
}
const own = (o, k) => Object.hasOwn(o, k);

/** Runs one case; returns a list of mismatch descriptions (empty = pass). */
export function checkCase(c) {
  const problems = [];
  const result = tryCompileForm(compileInput(c.input));
  if (c.area === 'refuse') {
    if (result.ok) return ['compiled, but the case expects a refusal'];
    if (!errorsMatch(c.expected.errors, result.errors)) problems.push(`errors ${JSON.stringify(result.errors.map(e => ({ code: e.code, path: e.path })))} != expected ${JSON.stringify(c.expected.errors)}`);
    return problems;
  }
  if (!result.ok) return [`refused: ${JSON.stringify(result.errors.map(e => ({ code: e.code, path: e.path })))}`];
  const spec = result.spec;
  if (c.expected?.fields) {
    const fields = spec.fields.map(f => [f.name, f.componentType, f.valueType, f.required, f.group]);
    if (!isDeepStrictEqual(fields, c.expected.fields)) problems.push(`fields ${JSON.stringify(fields)} != expected ${JSON.stringify(c.expected.fields)}`);
    const warnings = spec.warnings.map(w => w.code);
    if (!isDeepStrictEqual(warnings, c.expected.warnings ?? [])) problems.push(`warnings ${JSON.stringify(warnings)} != expected ${JSON.stringify(c.expected.warnings ?? [])}`);
  }
  if (c.html !== null) {
    const html = goldenHtml(spec, c.input);
    if (html !== c.html) problems.push('rendered HTML differs from expected.html (run with --write-html and review the diff)');
  }
  if (c.interactions) {
    const { interactions, expected } = c.interactions;
    if (interactions.length !== expected.results.length) problems.push('interactions and expected.results differ in length');
    interactions.forEach((step, i) => {
      const actual = runStep(spec, step, c.input.token);
      const want = expected.results[i];
      if (actual.ok !== want.ok) problems.push(`step ${i}: ok ${actual.ok} != ${want.ok} (${JSON.stringify(actual.errors.map(e => [e.source, e.code, e.statementId]))})`);
      else if (want.ok && !isDeepStrictEqual(actual.answer, want.answer)) problems.push(`step ${i}: answer ${JSON.stringify(actual.answer)} != ${JSON.stringify(want.answer)}`);
      else if (!want.ok && !errorsMatch(want.errors, actual.errors)) problems.push(`step ${i}: errors ${JSON.stringify(actual.errors.map(e => Object.fromEntries(STRUCTURAL.filter(k => e[k] !== undefined).map(k => [k, e[k]]))))} != expected ${JSON.stringify(want.errors)}`);
    });
  }
  return problems;
}

export function writeGoldenHtml(cases = listCases()) {
  let written = 0;
  for (const c of cases.filter(x => x.area === 'compile')) {
    const result = tryCompileForm(compileInput(c.input));
    if (!result.ok) continue;
    writeFileSync(path.join(c.dir, 'expected.html'), goldenHtml(result.spec, c.input));
    written++;
  }
  return written;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write-html')) { console.log(`wrote ${writeGoldenHtml()} expected.html files`); process.exit(0); }
  const cases = listCases();
  const failures = cases.map(c => ({ id: c.id, problems: checkCase(c) })).filter(r => r.problems.length);
  const byArea = {};
  for (const c of cases) byArea[c.area] = (byArea[c.area] ?? 0) + 1;
  console.log(JSON.stringify({ cases: cases.length, byArea, interactions: cases.reduce((n, c) => n + (c.interactions?.interactions.length ?? 0), 0), failures }, null, 2));
  process.exit(failures.length ? 1 : 0);
}
