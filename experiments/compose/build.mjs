// Arms C-H and C-H-T (research/composition-20261021/HARNESS.md §7): one sandboxed build session writes a COMPOSED
// program (a parent orchestrator plus sub-workflow modules it chooses, each with a declared typed interface and its own
// contract tests) for E8, under the same conditions as B1L-H (experiments/ebed/build.mjs, research/enterprise-20261014/
// B1-E8-DEV.md): the same spec, contract text, API schemas and smoke loop on practice worlds 1235-1237, the same model,
// effort, budget and wall cap, the same grading worlds. C-H-T adds decomposition templates written by a frontier model
// from SPEC-E only (builder/templates/). The harness, not the builder, bundles the program with its composition runtime.
// Grading ($0): the E8 oracle (unchanged), the hidden capability contracts, interface honesty, the module contract
// tests (run in the sandbox); faults and drift with fault-run.mjs on the saved program. METERED: the session spends
// model budget; `--dry-run` replaces the session by a scripted stub builder ($0) to check the whole pipeline.
//   node experiments/compose/build.mjs --arm C-H --model claude-haiku-5-5 --effort high --budget 3 --minutes 40 --label ch-e8-1
//   node experiments/compose/build.mjs --arm C-H-T --model claude-haiku-5-5 --effort high --budget 3 --minutes 40 --label cht-e8-1 [--templates <dir>]
//   node experiments/compose/build.mjs --arm C-H --dry-run --label dry-ch-1 [--seeds 1232 --difficulties 2 --size 12]
//   node experiments/compose/build.mjs --grade-only <program dir> --label regrade-x
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync, cpSync, rmSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runClaudeCode, maskSteps, sandboxScript, UNSHARE_ARGS, DEFAULT_HIDDEN, binaryKeeps, sandboxAvailable } from '../../src/executors/claude-code.mjs';
import { MockSystem } from '../../beds/ebed/host/mocks.mjs';
import { sandboxArm } from '../../beds/ebed/host/sandbox-arm.mjs';
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { contractText } from '../ebed/build.mjs';
import { CLIENT, practiceFor } from '../ebed/smoke-service.mjs';
import { serveComposedMailbox, composedClientInstructions } from './smoke.mjs';
import { readProgram, bundle, RUNTIME_SOURCE, LOADER_SOURCE } from './bundle.mjs';
import { runArm, assess } from './run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const POLICY = JSON.parse(readFileSync(path.join(ROOT, 'policy', 'models.json'), 'utf8'));
export const ARMS = Object.freeze(['C-H', 'C-H-T']);
/** The B1L-H conditions (B1-E8-DEV.md, runs/b1lh-e8-1..3/result.json): the composed arms keep every one of them. */
export const B1LH_CONDITIONS = Object.freeze({ model: 'claude-haiku-5-5', effort: 'high', budgetUsd: 3, minutes: 40, loop: 'smoke',
  practice: { seeds: [1235, 1236, 1237], difficulties: [2, 3, 5] }, grading: { seeds: [1232, 1233, 1234], difficulties: [2, 3, 5] }, paired: { seed: 1232, d: 2, size: 12 } });

/** TASK.md of a composed arm (the B1 E8 task's wording kept where the task is the same). */
export function composedTaskText(arm) {
  const t = `# Task

Build the order process of SPEC-E.md as a **composed program**: a parent orchestrator plus sub-workflow modules that
you choose, each a separate module with a declared, typed interface and its own contract tests, as COMPOSE.md describes.
Write, in this directory:

- \`composition.json\`: the manifest (every module's purpose, the SPEC-E rules it owns, its input and output schemas,
  the effects, human tasks and timers it may use, the modules it may call);
- \`parent.mjs\`: the parent (exports \`tick(input, ctx)\`);
- \`modules/<id>.mjs\`: one file per sub-workflow (exports \`step(input, ctx)\` and/or \`onEvent(event, ctx)\`);
- \`tests/<id>.test.mjs\`: contract tests for every module (node:test with compose-kit/kit.mjs).

The platform bundles your files with its composition runtime into one tick/1 solver and runs it once per case-tick as
CONTRACT.md describes (input: { kind: 'case', item, world, instance, now, events, carry }; ctx: { files, query(table,
filter), status(system, key), instances({ subject }) }); together, the parent and the modules must implement every rule
of SPEC-E.md exactly. You decide the decomposition: which sub-workflows exist, what each one owns, its input and output,
and the effects it may emit. The runtime holds every module to its declaration (COMPOSE.md, "What the runtime
enforces"). The API of each system is in api/<system>.schema.json; at run time the same files appear in ctx.files under
api/, with the rulebook (rulebook/<edition>/...), master data (master/*.json), the calendar, the spec, the instance's
records (sor/<instance>.json) and documents (docs/<eventId>.txt).

Constraints: deterministic (no Date.now, no Math.random; time is input.now); state in the parent's \`state\` and each
module instance's \`state\` (JSON; the whole carry at most 64 KB); decisions.subject is required on every tick (the
normalised order id or null). When you are done, \`node compose-kit/compose.mjs check\` and \`node compose-kit/compose.mjs
test\` must pass. Work carefully through every rule, race and reading in SPEC-E.md.
`;
  if (arm === 'C-H') return t;
  return `${t}
## Decomposition templates

\`templates/\` holds a decomposition of this process written for you by a senior engineer from SPEC-E.md:
DECOMPOSITION.md (the modules, the rules each one owns, their interfaces and the call graph), a complete
composition.json and skeleton files. Start from it: copy templates/composition.json, templates/parent.mjs and
templates/modules/ into this directory, then write the logic and the tests. Change the decomposition only where SPEC-E.md
requires it, and keep each rule in the module that owns it.
`;
}

/** The builder's workspace: spec, contract, API schemas, the composition interface and kit, the task; templates for C-H-T. */
export function composedBuildFiles(item, { arm = 'C-H', loop = 'smoke', templates = path.join(here, 'builder', 'templates') } = {}) {
  if (!ARMS.includes(arm)) throw new Error(`--arm must be one of ${ARMS.join(', ')}`);
  const t0 = Date.parse('2026-03-02T00:00:00+01:00');
  const files = { 'SPEC-E.md': item.specE.text, 'CONTRACT.md': contractText(), 'COMPOSE.md': readFileSync(path.join(here, 'builder', 'COMPOSE.md'), 'utf8') };
  for (const def of item.systems) files[`api/${def.id}.schema.json`] = JSON.stringify(new MockSystem(def).apiSchema(t0), null, 1);
  files['compose-kit/runtime.mjs'] = RUNTIME_SOURCE;
  files['compose-kit/loader.mjs'] = LOADER_SOURCE;
  files['compose-kit/kit.mjs'] = readFileSync(path.join(here, 'kit', 'kit.mjs'), 'utf8');
  files['compose-kit/compose.mjs'] = readFileSync(path.join(here, 'kit', 'compose.mjs'), 'utf8');
  files['TASK.md'] = composedTaskText(arm) + (loop === 'none' ? '' : composedClientInstructions(loop));
  if (loop !== 'none') files['smoke.mjs'] = CLIENT;
  if (arm === 'C-H-T') {
    const tdir = templates;
    const walk = rel => {
      for (const ent of readdirSync(path.join(tdir, rel), { withFileTypes: true })) {
        const r = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) walk(r); else files[`templates/${r}`] = readFileSync(path.join(tdir, r), 'utf8');
      }
    };
    walk('');
  }
  return files;
}

/** Run the program's module contract tests inside the executor sandbox ($0). Returns { files, modulesWithTests, pass, fail, ok }. */
export async function runModuleTests(dir, { timeoutMs = 180_000 } = {}) {
  const prog = readProgram(dir);
  const mods = Object.keys(prog.manifest?.modules ?? {});
  const tdir = path.join(dir, 'tests');
  const files = existsSync(tdir) ? readdirSync(tdir).filter(f => f.endsWith('.test.mjs')) : [];
  const withTests = mods.filter(m => files.includes(`${m}.test.mjs`));
  if (!files.length || !sandboxAvailable()) return { files: files.length, modules: mods.length, modulesWithTests: withTests.length, pass: 0, fail: 0, ok: false, ran: false };
  const root = '/var/tmp/foundry-work/compose-tests';
  mkdirSync(root, { recursive: true });
  const work = mkdtempSync(path.join(root, 'run-'));
  try {
    cpSync(dir, work, { recursive: true, filter: src => !src.includes(`${path.sep}.smoke`) && !src.includes('.executor-transcript') });
    const script = sandboxScript(maskSteps({ workdir: work, hidden: DEFAULT_HIDDEN, keepRo: binaryKeeps(['node']) }), work, ['node', '--test', '--test-concurrency=1', '--test-reporter=tap', 'tests/*.test.mjs']);
    const child = spawn('unshare', [...UNSHARE_ARGS, '--net', 'sh', '-c', script], { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: '/tmp', TMPDIR: '/tmp', LANG: 'C.UTF-8' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let out = '';
    child.stdout.on('data', d => { if (out.length < 200_000) out += d; });
    child.stderr.on('data', () => {});
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }, timeoutMs);
    const code = await new Promise(r => child.on('close', r));
    clearTimeout(timer);
    const num = re => Number(re.exec(out)?.[1] ?? 0);
    return { files: files.length, modules: mods.length, modulesWithTests: withTests.length, pass: num(/^# pass (\d+)/m), fail: num(/^# fail (\d+)/m), ok: code === 0, ran: true };
  } finally { rmSync(work, { recursive: true, force: true }); }
}

/** Grade a program directory: the bundled solver in the sandbox arm, on every signal. $0. */
export async function gradeProgram(dir, { worlds, label = 'composed', log = console.log }) {
  const prog = readProgram(dir);
  const b = bundle(prog, { item: e8 });
  const rows = [];
  for (const w of worlds) {
    const world = e8.generateWorld({ seed: w.seed, difficulty: w.d, mix: 'tail', ...(w.size ? { size: w.size } : {}) });
    const { pools } = await e8.referenceRuns(world);
    const arm = sandboxArm({ id: label, solverSource: b.source, timeoutMs: 20_000 });
    let r;
    try { r = await runArm({ world, arm, callTimeoutMs: 25_000 }); } finally { arm.close(); }
    const a = assess({ world, rows: r.rows, pools, manifest: prog.manifest });
    const row = { seed: w.seed, d: w.d, size: w.size ?? null, status: r.status, oracle: a.oracle, capabilities: { completed: a.capabilities.completed, passed: a.capabilities.passed, byCapability: a.capabilities.byCapability },
      interface: a.interface ? { violations: a.interface.violations, byCode: a.interface.violationsByCode, byModule: a.interface.violationsByModule, dropped: a.interface.dropped, integrity: a.interface.integrity.length, calls: a.interface.calls } : null,
      exactlyOnce: { duplicates: a.faults.exactlyOnce.duplicates.length, money: a.faults.exactlyOnce.money }, armErrors: a.armErrors };
    rows.push(row);
    log(`  ${w.seed} d${w.d}${w.size ? ` size ${w.size}` : ''}: oracle ${a.oracle.passed}/${a.oracle.completed} (critical ${a.oracle.critical}), capabilities ${a.capabilities.passed}/${a.capabilities.completed}, interface violations ${a.interface?.violations ?? '-'}, arm errors ${a.armErrors}`);
  }
  return { problems: b.problems, bundleDigest: b.digest, programDigest: b.programDigest, modules: Object.keys(prog.manifest?.modules ?? {}), rows };
}

/**
 * The stub builder of the dry run ($0): what a session does, scripted. It writes the fault harness's straight-saga
 * program (fixtures/straight-saga) with one contract test per module into the workdir, runs the kit's check, and asks
 * the platform for one smoke run through the mailbox.
 */
export async function stubBuilder({ workdir }) {
  const src = path.join(here, 'fixtures', 'straight-saga');
  cpSync(src, workdir, { recursive: true });
  mkdirSync(path.join(workdir, 'tests'), { recursive: true });
  const prog = readProgram(workdir);
  for (const id of Object.keys(prog.manifest.modules)) {
    writeFileSync(path.join(workdir, 'tests', `${id}.test.mjs`), `import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';
test('${id} loads and runs inside its declaration', () => {
  const m = moduleHarness('${id}');
  const r = m.onEvent({ type: 'timer.fired', payload: { obligationId: 'x' } }, { key: 'K' });
  assert.equal(r.error, null);
  assert.deepEqual(r.violations, []);
});
`);
  }
  const check = spawnSync(process.execPath, ['compose-kit/compose.mjs', 'check'], { cwd: workdir, encoding: 'utf8' });
  // Asynchronous: the mailbox is served by this same process, so a synchronous spawn would deadlock it.
  const smoke = await new Promise(resolve => {
    const c = spawn(process.execPath, ['smoke.mjs'], { cwd: workdir });
    let o = '';
    c.stdout.on('data', d => { o += d; });
    const timer = setTimeout(() => c.kill('SIGKILL'), 20 * 60_000);
    c.on('close', () => { clearTimeout(timer); resolve(o); });
  });
  return { costUsd: 0, turns: 0, error: null, stub: true, check: check.stdout.trim(), smoke: smoke.slice(0, 4000) };
}

async function main() {
  const item = e8;
  const label = arg('--label', `compose-${Date.now()}`);
  const out = path.join(ROOT, 'research/composition-20261021/runs', label);
  const seeds = (() => { const [a, b2] = arg('--seeds', '1232-1234').split('-').map(Number); return Array.from({ length: (b2 ?? a) - a + 1 }, (_, i) => a + i); })();
  const difficulties = arg('--difficulties', '2,3,5').split(',').map(Number);
  const size = arg('--size', null) === null ? null : Number(arg('--size'));
  for (const s of seeds) if (!(s >= 1232 && s <= 1234)) throw new Error(`grading seeds are the E8 dev rehearsals 1232-1234 (the B1L-H worlds): ${s}`);
  const worlds = [];
  for (const d of difficulties) for (const seed of seeds) worlds.push({ seed, d, ...(size ? { size } : {}) });
  if (!process.argv.includes('--no-paired') && !worlds.some(w => w.seed === 1232 && w.d === 2 && w.size === 12)) worlds.unshift({ ...B1LH_CONDITIONS.paired });
  let dir, build = null;
  const gradeOnly = arg('--grade-only', null);
  if (gradeOnly) dir = path.resolve(gradeOnly);
  else {
    const armName = arg('--arm', null);
    if (!ARMS.includes(armName)) throw new Error(`--arm must be one of ${ARMS.join(', ')}`);
    const dry = process.argv.includes('--dry-run');
    const model = dry ? 'stub' : arg('--model', B1LH_CONDITIONS.model);
    if (!dry && !POLICY.models.some(m => m.id === model)) throw new Error(`--model must be a policy model id (policy/models.json): ${model}`);
    const workdir = path.join('/var/tmp/foundry-work/compose-build', label);
    if (existsSync(workdir)) throw new Error(`workdir exists: ${workdir}`);
    mkdirSync(out, { recursive: true });
    const practice = practiceFor(item);
    if (worlds.some(w => practice.seeds.includes(w.seed))) throw new Error('grading seeds overlap the practice worlds');
    const templates = path.resolve(arg('--templates', path.join(here, 'builder', 'templates')));
    const files = composedBuildFiles(item, { arm: armName, loop: 'smoke', templates });
    const prompt = `${files['TASK.md']}\nRead SPEC-E.md, CONTRACT.md, COMPOSE.md and api/*.schema.json first.`;
    const budgetUsd = Number(arg('--budget', String(B1LH_CONDITIONS.budgetUsd))), minutes = Number(arg('--minutes', String(B1LH_CONDITIONS.minutes)));
    const effort = arg('--effort', B1LH_CONDITIONS.effort);
    mkdirSync(workdir, { recursive: true });
    const liveSmoke = path.join(path.dirname(workdir), `${label}.smoke.jsonl`);
    const box = serveComposedMailbox({ item, workdir, mode: 'smoke', journal: liveSmoke, practice });
    const t = Date.now();
    let r;
    try {
      if (dry) {
        for (const [f, text] of Object.entries(files)) { mkdirSync(path.dirname(path.join(workdir, f)), { recursive: true }); writeFileSync(path.join(workdir, f), text); }
        r = await stubBuilder({ workdir });
      } else r = await runClaudeCode({ model, prompt, workdir, files, budgetUsd, timeoutMs: minutes * 60_000, effort });
    } finally { build = { smokeRuns: await box.stop() }; if (existsSync(liveSmoke)) copyFileSync(liveSmoke, path.join(out, 'smoke.jsonl')); }
    build = { arm: armName, model, effort, budgetUsd, minutes, loop: 'smoke', dryRun: dry, ...(armName === 'C-H-T' ? { templates: path.relative(ROOT, templates) } : {}), ...build, wallMs: Date.now() - t, costUsd: r.costUsd ?? null, error: r.error ?? null, turns: r.turns ?? null, ...(dry ? { stub: { check: r.check, smoke: r.smoke } } : {}) };
    if (existsSync(path.join(workdir, '.executor-transcript.jsonl'))) copyFileSync(path.join(workdir, '.executor-transcript.jsonl'), path.join(out, 'transcript.jsonl'));
    dir = workdir;
    console.log(`build: ${JSON.stringify({ ...build, stub: undefined })}`);
  }
  mkdirSync(out, { recursive: true });
  const prog = readProgram(dir);
  if (!prog.manifest) { writeFileSync(path.join(out, 'result.json'), JSON.stringify({ label, build, program: null, problems: prog.problems }, null, 1)); throw new Error(`no program: ${prog.problems.join('; ')}`); }
  // Keep the program as built (the files the manifest names, the tests) for faults, drift and audit.
  const keep = path.join(out, 'program');
  mkdirSync(keep, { recursive: true });
  writeFileSync(path.join(keep, 'composition.json'), JSON.stringify(prog.manifest, null, 1));
  for (const [f, text] of Object.entries(prog.sources)) { mkdirSync(path.dirname(path.join(keep, f)), { recursive: true }); writeFileSync(path.join(keep, f), text); }
  if (existsSync(path.join(dir, 'tests'))) cpSync(path.join(dir, 'tests'), path.join(keep, 'tests'), { recursive: true });
  const tests = await runModuleTests(dir);
  console.log(`module contract tests: ${JSON.stringify(tests)}`);
  const graded = await gradeProgram(dir, { worlds, label });
  const sum = (k, f) => graded.rows.reduce((s, r) => s + f(r), 0);
  const full = graded.rows.filter(r => r.size === null);
  const summary = {
    paired: graded.rows.find(r => r.seed === 1232 && r.d === 2 && r.size === 12) ?? null,
    full: { completed: full.reduce((s, r) => s + r.oracle.completed, 0), passed: full.reduce((s, r) => s + r.oracle.passed, 0), critical: full.reduce((s, r) => s + r.oracle.critical, 0),
      capabilitiesPassed: full.reduce((s, r) => s + r.capabilities.passed, 0), capabilitiesCompleted: full.reduce((s, r) => s + r.capabilities.completed, 0),
      interfaceViolations: full.reduce((s, r) => s + (r.interface?.violations ?? 0), 0), armErrors: full.reduce((s, r) => s + r.armErrors, 0) },
    worlds: graded.rows.length, armErrors: sum('armErrors', r => r.armErrors),
  };
  writeFileSync(path.join(out, 'result.json'), JSON.stringify({ label, item: item.family.id, spec: item.specE.sha256, conditions: B1LH_CONDITIONS, build, program: { modules: graded.modules, programDigest: graded.programDigest, bundleDigest: graded.bundleDigest, problems: graded.problems }, tests, worlds, summary, rows: graded.rows }, null, 1));
  console.log(`summary: ${JSON.stringify(summary.full)}; paired ${summary.paired ? `${summary.paired.oracle.passed}/${summary.paired.oracle.completed}` : '-'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
