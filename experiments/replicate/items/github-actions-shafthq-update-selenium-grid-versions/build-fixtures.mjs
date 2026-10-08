#!/usr/bin/env node
// Materialises the canonical suite (one instance of each of the 14 scenario kinds: dev split, difficulty 5, seeds 0-13) as plain files
// under fixtures/scenarios/, so the inputs, the recorded answers of the external calls and the expected results can be read and diffed
// without running code:   node build-fixtures.mjs [--write]      (without --write it only reports drift; item.test.mjs does the same)
//   fixtures/scenarios/NN-<kind>/scenario.json            kind, seed, trigger, open pull requests, the recorded fetch (status), expectations
//   fixtures/scenarios/NN-<kind>/repo/<path>              the repository files before the run
//   fixtures/scenarios/NN-<kind>/recorded/reference.yml   the body the mocked raw.githubusercontent.com returns (absent when the connection is cut)
//   fixtures/scenarios/NN-<kind>/expected-<mode>.yml      the pull request's selenium4.yml per mode, when a pull request is expected
// HIDDEN FROM SOLVERS: these files hold the expected results. They are read by tests and humans, never put into a task.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalInstances } from './scenarios.mjs';
import { COMPOSE_PATH } from './spec.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SCENARIO_DIR = path.join(HERE, 'fixtures', 'scenarios');
const pad = n => String(n).padStart(2, '0');

export function snapshot() {
  const files = new Map();
  for (const inst of canonicalInstances()) {
    const dir = `${pad(inst.seed)}-${inst.kind}`;
    const put = (rel, text) => files.set(`${dir}/${rel}`, text);
    for (const [p, text] of Object.entries(inst.world.repo)) put(`repo/${p}`, text);
    if (!inst.world.http.error) put('recorded/reference.yml', inst.world.http.body);
    for (const mode of ['original', 'intent']) if (inst.truth[mode].composeAfter) put(`expected-${mode}.yml`, inst.truth[mode].composeAfter);
    const pointer = mode => { const { composeAfter, ...rest } = inst.truth[mode]; return { ...rest, composeAfter: composeAfter ? `expected-${mode}.yml` : null }; };
    put('scenario.json', JSON.stringify({
      kind: inst.kind, seed: inst.seed, split: inst.split, difficulty: inst.difficulty, trigger: inst.world.trigger, composePath: COMPOSE_PATH,
      fetch: inst.world.http.error ? { error: inst.world.http.error } : { status: inst.world.http.status, bodyFile: 'recorded/reference.yml' },
      openPullRequests: inst.world.openPullRequests,
      truth: { original: pointer('original'), intent: pointer('intent') },
      meta: inst.meta,
    }, null, 1) + '\n');
  }
  return files;
}
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) { const p = path.join(dir, name); if (statSync(p).isDirectory()) walk(p, out); else out.push(p); }
  return out;
}
export function drift() {
  const want = snapshot(), have = new Map(walk(SCENARIO_DIR).map(f => [path.relative(SCENARIO_DIR, f).split(path.sep).join('/'), readFileSync(f, 'utf8')]));
  const problems = [];
  for (const [k, v] of want) if (!have.has(k)) problems.push(`missing ${k}`); else if (have.get(k) !== v) problems.push(`changed ${k}`);
  for (const k of have.keys()) if (!want.has(k)) problems.push(`unexpected ${k}`);
  return problems;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--write')) {
    rmSync(SCENARIO_DIR, { recursive: true, force: true });
    for (const [rel, text] of snapshot()) { const f = path.join(SCENARIO_DIR, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, text); }
    console.log(`wrote ${snapshot().size} files under fixtures/scenarios/`);
  } else { const d = drift(); console.log(d.length ? `DRIFT:\n${d.join('\n')}` : 'fixtures/scenarios/ matches the generator'); process.exitCode = d.length ? 1 : 0; }
}
