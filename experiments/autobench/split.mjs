#!/usr/bin/env node
// Frozen dev/test split of AutomationBench's 600 scored public tasks (PREREG-AB-v1). No model, $0.
//
// Rule (recorded verbatim in SPLIT-v1.json): per scored domain, order the domain's 100 tasks by
// sha256('ab-split-v1:' + taskName) (lowercase hex, ascending). The base test set is the first 50. Every task in the
// forced set (tasks already exposed to us before the freeze: run, graded, read or summarised) must be in dev: for each
// forced task in the base test set, taken in hash order, move it to dev and move the lowest-hash dev task of the same
// domain that is neither forced nor already in test into test. The result is the first 50 non-forced tasks in hash
// order. Dev is the rest. Two frozen sub-lists: devCheck (10 per domain: non-forced dev tasks by
// sha256('ab-devcheck-v1:' + task)) and testRef (10 per domain of test by sha256('ab-ref-v1:' + task)).
//
//   node experiments/autobench/split.mjs --check                 recompute from the corpus listing + recorded forced set
//   node experiments/autobench/split.mjs --write --forced F.json  (once, at the freeze) F = { task: [sourceIds] }
//
// Task names come from bridge.py `list` (the official dataset build); only task and domain are kept.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CORPUS, PUBLIC_DOMAINS, REPO, listTasks, sha256, writeJson } from './lib.mjs';

export const SPLIT_PATH = path.join(REPO, 'research/automationbench-20261014/SPLIT-v1.json');
export const SCHEMA = 'foundry.autobench.split/v1';
export const SALTS = Object.freeze({ split: 'ab-split-v1:', devCheck: 'ab-devcheck-v1:', ref: 'ab-ref-v1:' });
export const PER_DOMAIN_TEST = 50;
export const PER_DOMAIN_DEVCHECK = 10;
export const PER_DOMAIN_REF = 10;

export const key = (salt, task) => sha256(salt + task);
const byKey = salt => (a, b) => { const x = key(salt, a), y = key(salt, b); return x < y ? -1 : x > y ? 1 : 0; };
const codeUnitSort = arr => [...arr].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
/** sha256 of the compact JSON array of the names sorted by UTF-16 code unit (ASCII names: plain byte order). */
export const listSha256 = arr => sha256(JSON.stringify(codeUnitSort(arr)));
export const domainOf = task => task.slice(0, task.indexOf('.'));

/**
 * universe: [{ task, domain }] for the scored domains; forced: Set or Map of task names that must be in dev.
 * Returns { dev, test, devCheck, testRef, swaps, perDomain } with dev/test sorted by code unit.
 */
export function computeSplit(universe, forced, { domains = PUBLIC_DOMAINS, perDomainTest = PER_DOMAIN_TEST, perDomainDevCheck = PER_DOMAIN_DEVCHECK, perDomainRef = PER_DOMAIN_REF } = {}) {
  const isForced = t => forced.has(t);
  const dev = [], test = [], devCheck = [], testRef = [], swaps = [], perDomain = {};
  for (const d of domains) {
    const order = universe.filter(u => u.domain === d).map(u => u.task).sort(byKey(SALTS.split));
    if (order.length < perDomainTest) throw new Error(`domain ${d}: ${order.length} tasks < ${perDomainTest}`);
    const inTest = new Set(order.slice(0, perDomainTest));
    // Forced swaps, in hash order of the forced task; the replacement is the lowest-hash eligible dev task.
    for (const f of order.slice(0, perDomainTest).filter(isForced)) {
      const repl = order.find(t => !inTest.has(t) && !isForced(t));
      if (!repl) throw new Error(`domain ${d}: no eligible dev task left to replace ${f}`);
      inTest.delete(f); inTest.add(repl);
      swaps.push({ domain: d, out: f, in: repl, outRank: order.indexOf(f), inRank: order.indexOf(repl) });
    }
    const t = order.filter(x => inTest.has(x)), v = order.filter(x => !inTest.has(x));
    if (t.some(isForced)) throw new Error(`domain ${d}: a forced task is in test`);
    const dc = v.filter(x => !isForced(x)).sort(byKey(SALTS.devCheck)).slice(0, perDomainDevCheck);
    const rf = [...t].sort(byKey(SALTS.ref)).slice(0, perDomainRef);
    if (dc.length < perDomainDevCheck) throw new Error(`domain ${d}: only ${dc.length} non-forced dev tasks for devCheck`);
    test.push(...t); dev.push(...v); devCheck.push(...dc); testRef.push(...rf);
    perDomain[d] = { total: order.length, test: t.length, dev: v.length, forcedInDev: v.filter(isForced).length, swaps: swaps.filter(s => s.domain === d).length, devCheck: dc.length, testRef: rf.length };
  }
  return { dev: codeUnitSort(dev), test: codeUnitSort(test), devCheck: codeUnitSort(devCheck), testRef: codeUnitSort(testRef), swaps, perDomain };
}

/** The recorded split, verified against its own hashes. */
export function loadSplit(p = SPLIT_PATH) {
  const s = JSON.parse(readFileSync(p, 'utf8'));
  if (s.schema !== SCHEMA) throw new Error(`split schema ${s.schema} != ${SCHEMA}`);
  for (const k of ['dev', 'test', 'devCheck', 'testRef']) if (listSha256(s[k]) !== s.sha256[k]) throw new Error(`split ${k} list does not match its sha256`);
  if (sha256(JSON.stringify({ dev: s.dev, test: s.test })) !== s.sha256.split) throw new Error('split sha256 mismatch');
  return s;
}

/** 'dev' | 'test' | null for a task name, from the recorded split. */
export function splitOf(task, s = loadSplit()) {
  return s.test.includes(task) ? 'test' : s.dev.includes(task) ? 'dev' : null;
}

/** Throws unless every task is a dev task (a guard for development runs). */
export function assertDevOnly(tasks, s = loadSplit()) {
  const bad = tasks.filter(t => splitOf(t, s) !== 'dev' && !t.startsWith('simple.'));
  if (bad.length) throw new Error(`not dev-split tasks (test or unknown): ${bad.length} task(s); development runs may use dev tasks only`);
}

function forcedSummary(forced, sources) {
  const bySource = {};
  for (const [t, ids] of Object.entries(forced)) for (const id of ids) (bySource[id] ??= []).push(t);
  return Object.entries(sources).map(([id, src]) => ({ id, ...src, n: (bySource[id] ?? []).length, tasks: codeUnitSort(bySource[id] ?? []) }));
}

async function universeFromCorpus() {
  const live = mkdtempSync(path.join(os.tmpdir(), 'autobench-split-'));
  try {
    const rows = await listTasks(PUBLIC_DOMAINS, { liveDir: live });
    return rows.map(r => ({ task: r.task, domain: r.domain }));
  } finally { rmSync(live, { recursive: true, force: true }); }
}

const corpusCommit = () => execFileSync('git', ['-C', CORPUS, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

async function main(argv) {
  const a = Object.fromEntries(argv.map((x, i) => (x.startsWith('--') ? [x.slice(2), argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true] : null)).filter(Boolean));
  const universe = await universeFromCorpus();
  if (universe.length !== 600) throw new Error(`expected 600 scored public tasks, got ${universe.length}`);
  for (const u of universe) if (domainOf(u.task) !== u.domain) throw new Error(`task ${u.task} not prefixed by its domain ${u.domain}`);
  if (a.write) {
    const spec = JSON.parse(readFileSync(a.forced, 'utf8')); // { sources: {id: {...}}, forced: {task: [ids]} }
    const forced = new Map(Object.entries(spec.forced));
    for (const t of forced.keys()) if (!universe.some(u => u.task === t)) throw new Error(`forced task not in the scored universe: ${t}`);
    const r = computeSplit(universe, forced);
    const out = {
      schema: SCHEMA,
      frozenAt: spec.frozenAt,
      repoHeadAtFreeze: spec.repoHeadAtFreeze,
      corpusCommit: corpusCommit(),
      corpusPackage: 'automation-bench 1.0.6',
      universe: { n: universe.length, domains: PUBLIC_DOMAINS, excluded: 'simple (200 tasks, not scored)', sha256: listSha256(universe.map(u => u.task)) },
      rule: spec.rule,
      sha256Definition: 'sha256 (lowercase hex) of the UTF-8 bytes of JSON.stringify(list sorted by UTF-16 code unit), compact, no whitespace; split = sha256 of JSON.stringify({dev, test}) with both lists so sorted',
      counts: { dev: r.dev.length, test: r.test.length, devCheck: r.devCheck.length, testRef: r.testRef.length, forced: forced.size, swaps: r.swaps.length, perDomain: r.perDomain },
      forcedSources: forcedSummary(spec.forced, spec.sources),
      swaps: r.swaps.map(s => ({ ...s, outReasons: spec.forced[s.out] })),
      swapsIfOnlySubset60: spec.swapsIfOnlySubset60,
      dev: r.dev, test: r.test, devCheck: r.devCheck, testRef: r.testRef,
      sha256: { dev: listSha256(r.dev), test: listSha256(r.test), devCheck: listSha256(r.devCheck), testRef: listSha256(r.testRef), split: sha256(JSON.stringify({ dev: r.dev, test: r.test })) },
    };
    writeJson(a.out ?? SPLIT_PATH, out);
    console.log(JSON.stringify({ wrote: a.out ?? SPLIT_PATH, counts: out.counts, sha256: out.sha256 }));
    return;
  }
  // --check (default): recompute from the corpus listing and the recorded forced set.
  const s = loadSplit(a.split ?? SPLIT_PATH);
  if (s.corpusCommit !== corpusCommit()) throw new Error(`corpus commit ${corpusCommit()} != recorded ${s.corpusCommit}`);
  if (listSha256(universe.map(u => u.task)) !== s.universe.sha256) throw new Error('scored task universe differs from the recorded one');
  const forced = new Set(s.forcedSources.flatMap(f => f.tasks));
  const r = computeSplit(universe, forced);
  const same = ['dev', 'test', 'devCheck', 'testRef'].every(k => listSha256(r[k]) === s.sha256[k]);
  console.log(JSON.stringify({ ok: same, counts: { dev: r.dev.length, test: r.test.length, forced: forced.size, swaps: r.swaps.length }, sha256: s.sha256 }));
  if (!same) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; });
}
