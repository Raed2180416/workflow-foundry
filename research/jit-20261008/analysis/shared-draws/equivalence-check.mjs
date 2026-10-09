// Row 23 (B10-E1) equivalence check, $0, no model calls.
// Runs the REAL stream.mjs arms (an agent arm and a JIT arm on the same interpreter model) through the REAL interpret.mjs,
// b0-agent.mjs and runClaudeCode (sandbox included), with the CLI replaced by stand-in-cli.sh, which records the argv, the
// working directory, the prompt and the workdir files it was handed. The compiler, compiled runner, oracle and model port
// are fakes (no builder session, no gateway). The task is synthetic (no bed seed is generated or read).
// Then it diffs what the CLI received from each call site: agent arm 'interpreter', JIT 'interpreter' (warmup),
// JIT 'shadow' and JIT 'adjudicator', for the same task and model.
//   node research/jit-20261008/analysis/shared-draws/equivalence-check.mjs [--work-root /var/tmp/foundry-work/shared-draws-check]
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, '../../../..');
const { runStream, POLICY_MODELS } = await import(path.join(REPO, 'experiments/jit/stream.mjs'));
const { interpret } = await import(path.join(REPO, 'experiments/jit/interpret.mjs'));
const { loadFamily } = await import(path.join(REPO, 'experiments/lib/beds.mjs'));

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const workBase = arg('--work-root', '/var/tmp/foundry-work/shared-draws-check');
rmSync(workBase, { recursive: true, force: true });
const runRoot = path.join(workBase, 'runs'), workRoot = path.join(workBase, 'work');
mkdirSync(runRoot, { recursive: true }); mkdirSync(workRoot, { recursive: true });
const STAND_IN = readFileSync(path.join(HERE, 'stand-in-cli.sh'), 'utf8');
const calls = [];   // the interpret() arguments exactly as stream.mjs passed them (binary aside)
const sha = s => createHash('sha256').update(s).digest('hex');

const MODEL = 'claude-sonnet-5-5';
const config = {
  experiment: 'shared-draws-equiv', familyId: 'records', split: 'dev', segments: [{ difficulty: 3, seeds: [9901, 9902] }],
  arms: [`agent:${MODEL}`, `jit:${MODEL}/claude-haiku-5-5`],
  // warmup 1 and a shadow on every compiled ok, so task idx 1 exercises shadow and adjudicator.
  jit: { warmup: 1, shadowEvery: 1, recompileOnDeopts: 2, maxTraces: 8, compilerFallback: 'claude-opus-5-5', compare: 'unordered' },
  agentBudgetUsd: 2, agentMinutes: 2, perTaskUsd: 1, concurrency: 1,
};
const fam = await loadFamily('records');
const synthetic = seed => ({ id: `synthetic:dev:d3:${seed}`, seed, split: 'dev', difficulty: 3,
  prompt: 'SYNTHETIC equivalence-check task (no bed seed). Merge the rows in inputs.json.', inputs: { export: 'name,dob\nA,01/02/1990\n' }, files: { 'notes.txt': 'n' } });
const deps = {
  policyIds: [...POLICY_MODELS], outputSchema: fam.outputSchema,
  makeTasks: async (familyId, { seeds, difficulty }) => seeds.map(seed => ({ familyId, task: synthetic(seed), taskKey: `synthetic:dev:d${difficulty}:s${seed}`, taskHash: `syn${seed}` })),
  loadFamily: async () => fam,
  createModelPort: () => ({ port: { fake: true } }),
  score: async () => ({ pass: false, score: 0 }),
  // The real interpret (b0Agent -> runClaudeCode -> sandbox). The sandbox hides home and the repository, so the stand-in is
  // copied into the (already fresh) workdir as .stand-in-cli.sh and passed as the binary; everything else is as stream.mjs
  // passed it.
  interpret: a => {
    const { binary: _b, ...rest } = a;
    calls.push({ ...rest, task: rest.task?.id, outputSchema: rest.outputSchema ? sha(JSON.stringify(rest.outputSchema)).slice(0, 16) : null });
    const bin = path.join(a.workdir, '.stand-in-cli.sh');
    writeFileSync(bin, STAND_IN); chmodSync(bin, 0o755);
    return interpret({ ...a, binary: bin });
  },
  async runCompiled() { return { status: 'ok', output: { records: [{ entity_id: 1 }] }, deopt: null, trace: [], costUsd: 0, costUnknown: false, latencyMs: 1, error: null, meta: { errors: {} } }; },
  async compile(a) {
    const workdir = path.join(a.workRoot, a.label); mkdirSync(workdir, { recursive: true });
    const solvePath = path.join(workdir, 'solve.mjs'); writeFileSync(solvePath, '// fake\n');
    const perCase = a.traces.map((t, i) => ({ id: `trace-${i}`, ref: t.traceId, kind: 'trace', status: 'exact', exact: true, partial: 1 }));
    const checkTraces = { exact: perCase.length, exactRate: 1, partial: 1, deopts: 0, crashes: 0, deoptKinds: {}, perCase, clean: true, unexplained: [], accepted: true };
    return { record: { checkTraces, builderCostUsd: 0, gatewayCostUsd: 0, checkCostUsd: 0, compileCostUsd: 0, nestedModelAttempts: 0, builderError: null }, workdir, solvePath };
  },
};
await runStream({ config, deps, runRoot, workRoot, binary: 'unused-see-deps.interpret', log: () => {} });

// Collect every interpreter-family session the two arms ran.
const sessions = [];
for (const slug of [`agent-${MODEL}`, `jit-${MODEL}--claude-haiku-5-5`]) {
  const rows = readFileSync(path.join(runRoot, config.experiment, slug, 'results.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  for (const r of rows) for (const [role, id] of [['interpreter', r.traceId], ['shadow', r.shadowTraceId], ['adjudicator', r.adjudicatorTraceId]]) {
    if (!id) continue;
    const trace = JSON.parse(readFileSync(path.join(runRoot, config.experiment, slug, 'traces', `${id}.json`), 'utf8'));
    const cap = f => readFileSync(path.join(trace.workdir, '.capture', f), 'utf8');
    sessions.push({ arm: slug, idx: r.idx, role, traceId: id, cwd: cap('cwd.txt').trim(), argv: cap('argv.txt').trimEnd().split('\n'), prompt: cap('prompt.txt'),
      files: cap('files.txt').trim().split('\n').map(l => { const [h, f] = l.split(/\s+/); return { file: f, sha256: h.slice(0, 16) }; }),
      traceFields: { model: trace.model, effort: trace.effort, budgetUsd: trace.budgetUsd, taskSha256: trace.taskSha256 } });
  }
}

// Pairwise field comparison of each JIT session against the agent arm's session on the same task.
const fields = s => ({ argv: s.argv.join('\u0000'), prompt: s.prompt, files: JSON.stringify(s.files), model: s.traceFields.model, effort: String(s.traceFields.effort),
  budgetUsd: String(s.traceFields.budgetUsd), taskSha256: s.traceFields.taskSha256, cwd: s.cwd });
const comparisons = [];
for (const s of sessions.filter(x => x.arm.startsWith('jit-'))) {
  const ref = sessions.find(x => x.arm.startsWith('agent-') && x.idx === s.idx);
  const a = fields(ref), b = fields(s);
  comparisons.push({ idx: s.idx, jitRole: s.role, same: Object.fromEntries(Object.keys(a).map(k => [k, a[k] === b[k]])), agentCwd: ref.cwd, jitCwd: s.cwd });
}
// The interpret() arguments (JS level), JIT call vs the agent-arm call on the same task: which keys differ.
const argDiffs = calls.filter(c => c.workdir.includes('/jit-')).map(c => {
  const ref = calls.find(x => x.workdir.includes('/agent-') && x.task === c.task);
  const keys = [...new Set([...Object.keys(ref), ...Object.keys(c)])].sort();
  return { task: c.task, role: c.traceId.split('-')[1], differ: keys.filter(k => JSON.stringify(ref[k]) !== JSON.stringify(c[k])), same: keys.filter(k => JSON.stringify(ref[k]) === JSON.stringify(c[k])) };
});
// Two agent-arm draws of the same task would differ only in the random traceId suffix; show the template.
const template = c => c.replace(/[0-9a-f]{6}$/, '<rand6>');
const out = {
  about: 'Row 23 equivalence check: what the Claude CLI receives from stream.mjs agent arms vs JIT interpreter roles (same task, same model). Stand-in CLI; $0; no model calls.',
  // The code this check exercised (working tree), and whether each file differed from HEAD when it ran.
  code: Object.fromEntries(['experiments/jit/stream.mjs', 'experiments/jit/interpret.mjs', 'experiments/lib/arms/b0-agent.mjs', 'src/executors/claude-code.mjs'].map(f => [f, {
    sha256: sha(readFileSync(path.join(REPO, f))).slice(0, 16),
    head: execFileSync('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD']).toString().trim(),
    dirty: spawnSync('git', ['-C', REPO, 'diff', '--quiet', 'HEAD', '--', f]).status !== 0 }])),
  model: MODEL, argv: sessions[0].argv, promptSha256: sha(sessions[0].prompt).slice(0, 16), files: sessions[0].files,
  sessions: sessions.map(s => ({ arm: s.arm, idx: s.idx, role: s.role, cwdTemplate: template(s.cwd).replace(workRoot, '<workRoot>'), promptSha256: sha(s.prompt).slice(0, 16),
    argvSha256: sha(s.argv.join('\u0000')).slice(0, 16), filesSha256: sha(JSON.stringify(s.files)).slice(0, 16) })),
  interpretArgs: argDiffs,
  comparisons: comparisons.map(c => ({ ...c, agentCwd: template(c.agentCwd).replace(workRoot, '<workRoot>'), jitCwd: template(c.jitCwd).replace(workRoot, '<workRoot>') })),
};
writeFileSync(path.join(HERE, 'equivalence-check.json'), JSON.stringify(out, null, 1) + '\n');
for (const c of out.comparisons) console.log(`idx ${c.idx} jit ${c.jitRole}: ${Object.entries(c.same).map(([k, v]) => `${k}=${v ? 'same' : 'DIFF'}`).join(' ')}\n  agent cwd ${c.agentCwd}\n  jit   cwd ${c.jitCwd}`);
if (!existsSync(path.join(HERE, 'equivalence-check.json'))) process.exit(1);
