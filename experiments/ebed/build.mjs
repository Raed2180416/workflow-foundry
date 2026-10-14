// Arm B1 ("build once from spec", E-BED §4; W-BED arm (e)): one sandboxed `claude -p` session writes a `tick/1` solver
// for an E-bed item from spec-E, the API schemas and the tick contract only: no world, no generator, no oracle, no
// fixtures, no traces, no score service, no smoke runner. The solver is then run out of process (beds/ebed/host/
// sandbox-arm.mjs) on dev worlds and graded by the item's oracle with the reference pools. Model ids come from
// policy/models.json only. METERED: the build session spends model budget (its own cap); grading is $0.
//   node experiments/ebed/build.mjs --model claude-haiku-5-5 --effort high --budget 3 --minutes 40 --label b1h-1 \
//        [--grade-only <solver.mjs>] [--seeds 1232-1234] [--difficulties 2,3,5] [--loop none|smoke|graded]
// --loop (default none = B1 as declared): the builder may run its solver on practice worlds 1235-1237 through a
// host-side smoke service (smoke-service.mjs) and see arm errors and effect results (smoke) or also first divergences
// on those practice worlds (graded). A different arm from B1; reported under its own label.
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClaudeCode } from '../../src/executors/claude-code.mjs';
import { MockSystem } from '../../beds/ebed/host/mocks.mjs';
import { createHost } from '../../beds/ebed/host/host.mjs';
import { sandboxArm } from '../../beds/ebed/host/sandbox-arm.mjs';
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { CLIENT, clientInstructions, serveMailbox, PRACTICE } from './smoke-service.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const POLICY = JSON.parse(readFileSync(path.join(ROOT, 'policy', 'models.json'), 'utf8'));
const ITEMS = { e8 };

/** The contract text an arm author gets: BED-CONTRACT v1.1 §3.1-§3.4 and the host's arm interface (README §2). */
export function contractText() {
  const c = readFileSync(path.join(ROOT, 'research/enterprise-20261014/BED-CONTRACT-v1.1.md'), 'utf8').split('\n');
  const from = c.findIndex(l => l.startsWith('### 3.1')), to = c.findIndex(l => l.startsWith('### 3.5'));
  const h = readFileSync(path.join(ROOT, 'beds/ebed/host/README.md'), 'utf8').split('\n');
  const a = h.findIndex(l => l.startsWith('**Arm**')), b = h.findIndex(l => l.startsWith('**The journal is not arm-readable'));
  return ['# The tick contract (excerpt of the bed contract)', '', ...c.slice(from, to), '', '# The arm interface (excerpt of the host README)', '', ...h.slice(a, b)].join('\n');
}

/** The builder's workspace: spec, API schemas, contract, task. Nothing else. */
export function buildFiles(item, { loop = 'none' } = {}) {
  const t0 = Date.parse('2026-03-02T00:00:00+01:00');
  const files = { 'SPEC-E.md': item.specE.text, 'CONTRACT.md': contractText() };
  for (const def of item.systems) files[`api/${def.id}.schema.json`] = JSON.stringify(new MockSystem(def).apiSchema(t0), null, 1);
  files['TASK.md'] = `# Task

Write \`solver.mjs\` in this directory: an ES module (Node 24, no dependencies, no network) exporting

    export function createSolver() { return { id: 'solver', tick(input, ctx) { ... return output; } }; }

\`tick\` is called once per case-tick as CONTRACT.md describes (input: { kind: 'case', item, world, instance, now, events,
carry }; ctx: { files, query(table, filter), status(system, key), instances({ subject }) }) and must return a TickOutput
that implements every rule of SPEC-E.md exactly. The API of each system is in api/<system>.schema.json; at run time the
same files appear in ctx.files under api/, with the rulebook (rulebook/<edition>/...), master data (master/*.json), the
calendar, the spec, the instance's records (sor/<instance>.json) and documents (docs/<eventId>.txt).

Constraints: deterministic (no Date.now, no Math.random; time is input.now); keep state in \`carry\` (JSON, at most 64 KB);
every output must be valid (decisions.subject is required on every tick: the normalised order id or null). You cannot
run the real systems here; you may write and run your own tests with node. When you are done, \`solver.mjs\` must be the
complete solver. Work carefully through every rule, race and reading in SPEC-E.md.
`;
  if (loop !== 'none') {
    files['TASK.md'] = files['TASK.md'].replace('You cannot\nrun the real systems here; you may', 'You may').replace('You cannot run the real systems here; you may', 'You may') + clientInstructions(loop);
    files['smoke.mjs'] = CLIENT;
  }
  return files;
}

/** Run a solver (source) out of process on dev worlds and grade it with the item's oracle. $0. */
export async function grade(item, solverSource, { seeds, difficulties, label }) {
  const rows = [];
  for (const d of difficulties) for (const seed of seeds) {
    const w = item.generateWorld({ seed, difficulty: d, mix: 'tail' });
    const { pools } = await item.referenceRuns(w);
    const arm = sandboxArm({ id: label, solverSource, timeoutMs: 20_000 });
    const host = createHost({ item: item.binding, world: w, arm, callTimeoutMs: 25_000 });
    let status;
    try { status = (await host.run()).status; } catch (e) { status = `host-error: ${String(e?.message ?? e).slice(0, 160)}`; } finally { arm.close(); }
    const v = item.oracle(w, host.journal.contentRows(), { pools, arm: label });
    const comp = v.cases.filter(c => c.pool === 'completed');
    const byClass = {};
    for (const c of comp) { const k = (byClass[c.class] ??= { n: 0, pass: 0 }); k.n += 1; if (c.pass) k.pass += 1; }
    const codes = {};
    for (const c of comp.filter(x => !x.pass)) { const k = c.firstDivergence ? `L${c.firstDivergence.layer}:${c.firstDivergence.code}` : 'armCensored'; codes[k] = (codes[k] ?? 0) + 1; }
    const armErrors = host.journal.contentRows().filter(r => r.type === 'arm.error').length;
    rows.push({ seed, d, status, completed: comp.length, passed: comp.filter(c => c.pass).length, tail: comp.filter(c => c.tail).length,
      tailPassed: comp.filter(c => c.tail && c.pass).length, critical: v.critical.length, armErrors, byClass, codes });
    console.log(`  d${d} seed ${seed}: ${rows.at(-1).passed}/${comp.length} completed cases pass (tail ${rows.at(-1).tailPassed}/${rows.at(-1).tail}), critical ${v.critical.length}, arm errors ${armErrors}`);
  }
  return rows;
}

async function main() {
  const item = ITEMS[arg('--item', 'e8')];
  const label = arg('--label', `build-${Date.now()}`);
  const out = path.join(ROOT, 'research/enterprise-20261014/runs', label);
  mkdirSync(out, { recursive: true });
  const [s0, s1] = arg('--seeds', '1232-1234').split('-').map(Number);
  const seeds = Array.from({ length: (s1 ?? s0) - s0 + 1 }, (_, i) => s0 + i);
  const difficulties = arg('--difficulties', '2,3,5').split(',').map(Number);
  let solverSource, build = null;
  const gradeOnly = arg('--grade-only', null);
  if (gradeOnly) solverSource = readFileSync(gradeOnly, 'utf8');
  else {
    const model = arg('--model', null);
    if (!POLICY.models.some(m => m.id === model)) throw new Error(`--model must be a policy model id (policy/models.json): ${model}`);
    const workdir = path.join('/var/tmp/foundry-work/ebed-build', label);
    if (existsSync(workdir)) throw new Error(`workdir exists: ${workdir}`);
    const loop = arg('--loop', 'none');
    if (!['none', 'smoke', 'graded'].includes(loop)) throw new Error(`--loop must be none, smoke or graded: ${loop}`);
    if (loop !== 'none' && seeds.some(x => PRACTICE.seeds.includes(x))) throw new Error('grading seeds overlap the practice worlds');
    const files = buildFiles(item, { loop });
    const prompt = `${files['TASK.md']}\nRead SPEC-E.md, CONTRACT.md and api/*.schema.json first.`;
    const budgetUsd = Number(arg('--budget', '3')), minutes = Number(arg('--minutes', '40'));
    const t = Date.now();
    const box = loop === 'none' ? null : serveMailbox({ item, workdir, mode: loop, journal: path.join(out, 'smoke.jsonl') });
    let r;
    try { r = await runClaudeCode({ model, prompt, workdir, files, budgetUsd, timeoutMs: minutes * 60_000, effort: arg('--effort', 'high') }); }
    finally { if (box) build = { smokeRuns: await box.stop() }; }
    build = { model, effort: arg('--effort', 'high'), budgetUsd, minutes, loop, ...(build ?? {}), wallMs: Date.now() - t, costUsd: r.costUsd ?? null, error: r.error ?? null, turns: r.turns ?? null };
    copyFileSync(path.join(workdir, '.executor-transcript.jsonl'), path.join(out, 'transcript.jsonl'));
    if (!existsSync(path.join(workdir, 'solver.mjs'))) { writeFileSync(path.join(out, 'result.json'), JSON.stringify({ label, build, solver: null }, null, 1)); throw new Error('no solver.mjs written'); }
    solverSource = readFileSync(path.join(workdir, 'solver.mjs'), 'utf8');
    writeFileSync(path.join(out, 'solver.mjs'), solverSource);
    console.log(`build: ${JSON.stringify(build)}`);
  }
  const rows = await grade(item, solverSource, { seeds, difficulties, label });
  const sum = k => rows.reduce((s, r) => s + r[k], 0);
  const summary = { completed: sum('completed'), passed: sum('passed'), tail: sum('tail'), tailPassed: sum('tailPassed'), critical: sum('critical'), armErrors: sum('armErrors') };
  writeFileSync(path.join(out, 'result.json'), JSON.stringify({ label, item: item.family.id, spec: item.specE.sha256, build, seeds, difficulties, summary, rows }, null, 1));
  console.log(`summary: ${JSON.stringify(summary)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
