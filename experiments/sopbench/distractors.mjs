#!/usr/bin/env node
// SOP-Bench distractor-tool ablation catalogs (research/sopbench-20261021/DESIGN.md §8). Deterministic, seeded, committed:
//  - minimal: an SOP's catalog without its shipped stub tools (video_annotation ships 20 tools whose body is `pass`, the
//    paper's "bloated registry"; the minimal cell keeps its 6 real tools);
//  - bloated: an SOP's real tools plus 20 generated distractors in the style of upstream's own (a plausible domain operation
//    named after one of the task's fields, e.g. validateWeatherConditions(video_id, weather); paper v2 §3.3.2 "semantically
//    similar but functionally redundant tools"). Like upstream's stubs, every distractor answers null.
// The bridge serves a catalog file with --catalog: the real tools it names (specs from the clone's toolspecs.json) and its
// distractors, in its order, replace toolspecs.json; a distractor answers null; a tool left out is an unknown tool.
//   node experiments/sopbench/distractors.mjs --sop dangerous_goods --kind bloated --prep <live>/prep/dangerous_goods [--n 20]
//   node experiments/sopbench/distractors.mjs --sop video_annotation --kind minimal --prep <live>/prep/video_annotation --stubs a,b,...
import path from 'node:path';
import { HERE, readJson, sha256, shuffled, writeJson, rng } from './lib.mjs';

export const SEED = 'sopbench-20261021-distractors-v1';
const VERBS = ['validate', 'check', 'analyze', 'review', 'verify', 'assess', 'normalize', 'summarize', 'reconcile', 'audit'];
const NOUNS = ['', 'Status', 'History', 'Consistency', 'Compliance', 'Profile', 'Trend', 'Summary'];
const words = f => String(f).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\s]+/g, ' ').trim().toLowerCase();
const pascal = f => words(f).split(' ').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join('');
const camelCase = names => names.filter(n => /^[a-z]+[A-Z]/.test(n)).length >= names.filter(n => n.includes('_')).length;

const DESC = [
  (v, f) => `${v[0].toUpperCase()}${v.slice(1)}s the ${f} against the current policy reference data and records the outcome.`,
  (v, f) => `${v[0].toUpperCase()}${v.slice(1)}s the ${f} for the record and returns the result of the check.`,
  (v, f) => `Runs a ${v} step over the ${f} as part of the standard review workflow.`,
  (v, f) => `${v[0].toUpperCase()}${v.slice(1)}s historical ${f} data to support the decision process.`,
];

/** n distractors for a catalog, named after the task's fields; deterministic per (seed, sop). */
export function makeDistractors({ sop, catalog, fields, n = 20, seed = SEED }) {
  const real = new Set(catalog.map(t => t.name));
  const camel = camelCase([...real]);
  // The id parameter of the first real tool (every SOP's tools take a record id first).
  const first = catalog[0]?.input_schema ?? {};
  const idParam = (first.required ?? Object.keys(first.properties ?? {}))[0];
  const idSpec = idParam ? { type: 'string', description: 'The record identifier.' } : null;   // our wording, not upstream's
  const r = rng(`${seed}:${sop}`);
  const pick = xs => xs[Math.floor(r() * xs.length)];
  const fieldList = shuffled([...new Set(fields.filter(f => f !== idParam))], `${seed}:${sop}:fields`);
  const out = [], used = new Set(real);
  for (let i = 0; out.length < n && i < n * 50; i++) {
    const field = fieldList[i % fieldList.length] ?? `record${i}`, verb = pick(VERBS), noun = pick(NOUNS);
    const name = camel ? `${verb}${pascal(field)}${noun}` : `${verb}_${words(field).replace(/ /g, '_')}${noun ? `_${words(noun)}` : ''}`;
    if (used.has(name)) continue;
    used.add(name);
    const props = { ...(idSpec ? { [idParam]: idSpec } : {}), [field]: { type: 'string', description: `The ${words(field)} of the record.` } };
    out.push({ name, description: pick(DESC)(verb, words(field)) + (noun ? ` Includes the ${words(noun)}.` : ''), input_schema: { type: 'object', properties: props, required: Object.keys(props) } });
  }
  return out;
}

// A catalog file holds no upstream text (CC BY-NC): the real tools by name only (the bridge takes their specs from the
// pinned clone), our generated distractor specs, and the order in which the agent and the builder see the tools.
export function bloatedCatalog({ sop, catalog, fields, n = 20, seed = SEED }) {
  const distractorSpecs = makeDistractors({ sop, catalog, fields, n, seed });
  const order = shuffled([...catalog.map(t => t.name), ...distractorSpecs.map(t => t.name)], `${seed}:${sop}:order`);
  const body = { sop, kind: 'bloated', seed, real: catalog.map(t => t.name), removed: [], distractors: distractorSpecs.map(t => t.name), distractorSpecs, order };
  return { ...body, sha256: sha256(JSON.stringify(body)) };
}

export function minimalCatalog({ sop, catalog, stubs }) {
  const real = catalog.map(t => t.name).filter(nm => !stubs.includes(nm));
  const body = { sop, kind: 'minimal', real, removed: stubs, distractors: [], distractorSpecs: [], order: real };
  return { ...body, sha256: sha256(JSON.stringify(body)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2), a = {};
  for (let i = 0; i < argv.length; i++) a[argv[i].slice(2)] = argv[++i];
  const catalog = readJson(path.join(a.prep, 'catalog.json')), meta = readJson(path.join(a.prep, 'meta.json'));
  const props = catalog.flatMap(t => Object.keys(t.input_schema?.properties ?? {}));
  const c = a.kind === 'minimal' ? minimalCatalog({ sop: a.sop, catalog, stubs: a.stubs.split(',') })
    : bloatedCatalog({ sop: a.sop, catalog, fields: [...meta.input_columns, ...props], n: Number(a.n ?? 20) });
  const out = path.join(HERE, 'ablation', `${a.sop}-${a.kind}.json`);
  writeJson(out, c);
  console.log(JSON.stringify({ out, tools: c.order.length, distractors: c.distractors.length, removed: c.removed, sha256: c.sha256 }));
}
