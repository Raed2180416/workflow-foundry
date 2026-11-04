#!/usr/bin/env node
// Node V runner (research/breadth-20261021/PLAN.md §6.6): enterprise streams from the family factory, one arm at a time.
//
// Patterns reused from experiments/autobench/run.mjs and experiments/sopbench/run.mjs: every model session is a sandboxed
// `claude -p` (src/executors/claude-code.mjs) that sees only the policy (or the messy request), the trigger payload and
// AutomationBench's own tools through bridge.py serve; truth, deltas and grades stay in a host-only directory
// (experiments/breadth/factory/step.py); environment faults (rate or usage limits, model unavailable, no sandbox, disk
// full) are never scored: the run stops with exit 3 and `--resume` continues from the last graded trigger; a cost cap is
// checked before every session against the session's own budget; split hygiene refuses sealed seeds unless the frozen
// PREREG-V-1 hash is given.
//
//   node experiments/breadth/factory/run.mjs --arm A-H --family abr-reg-incident-clock --seeds 2113-2114 --cap 10
//   node experiments/breadth/factory/run.mjs --arm scripted --solver reference --family abr-itsm-queue --seeds 2113   ($0)
//   node experiments/breadth/factory/run.mjs --arm A-H --family all --seeds 2113-2116 --dry-run                       ($0 plan + cost)
//   node experiments/breadth/factory/run.mjs --arm F-H --sealed --prereg research/breadth-20261021/factory/PREREG-V-1.md ...
//
// Arms: scripted ($0 code solver: reference, a control, or path.py[:fn]); A-H / A-S (Haiku / Sonnet as an agent, one
// session per trigger, no memory beyond the apps); A-O (Opus xhigh, one session per trigger plus a NOTES.md the arm keeps
// across the stream: the closest to PLAN's "one long session" the one-shot executor allows, an open design decision OD-V2);
// F-H / wf-O (Haiku / Opus construct workflow.py once per stream from the builder kit; the host then runs it per trigger
// through the same tools at $0 per trigger); blind-H (G8: Haiku with the policy and the payload, no tools).
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, copyFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../../..');
const STEP = path.join(HERE, 'step.py');
export const AB_PY = process.env.FACTORY_AB_PY || path.join(REPO, 'corpus/AutomationBench/.venv/bin/python');
export const FAMILIES = ['abr-itsm-queue', 'abr-p2p-audit', 'abr-reg-incident-clock'];
export const DEV = [2101, 2160], SEALED = [8850, 8873];
const ENV_FAULT = /MODEL_RATE_LIMIT|MODEL_UNAVAILABLE|SANDBOX_UNAVAILABLE|EXECUTOR_LAUNCH|EXECUTOR_PROTOCOL|USAGE_LIMIT|ENOSPC|EDQUOT|EMFILE/;

/** Arms. budgetUsd is the per-session cap passed to the CLI; tokens are planning assumptions for the estimate only. */
export const ARMS = Object.freeze({
  scripted: { mode: 'scripted' },
  'A-H': { mode: 'agent', model: 'claude-haiku-5-5', budgetUsd: 0.12, inTok: 120e3, outTok: 3e3 },
  'A-S': { mode: 'agent', model: 'claude-sonnet-5-5', budgetUsd: 0.80, inTok: 100e3, outTok: 3e3 },
  'A-O': { mode: 'agent', model: 'claude-opus-5-5', effort: 'xhigh', notes: true, budgetUsd: 1.50, inTok: 110e3, outTok: 5e3 },
  'F-H': { mode: 'construct', model: 'claude-haiku-5-5', budgetUsd: 1.50, buildInTok: 1.2e6, buildOutTok: 40e3 },
  'wf-O': { mode: 'construct', model: 'claude-opus-5-5', effort: 'xhigh', budgetUsd: 8, buildInTok: 1.2e6, buildOutTok: 60e3 },
  'blind-H': { mode: 'blind', model: 'claude-haiku-5-5', budgetUsd: 0.02, inTok: 6e3, outTok: 300 },
});
/** USD per MTok from policy/models.json (read 2026-11-04); cached input is billed at 0.1x when the CLI caches. */
export const PRICES = Object.freeze({ 'claude-haiku-5-5': [0.1, 0.5], 'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20] });

export const sha256 = s => createHash('sha256').update(s).digest('hex');
const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, o) => { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(o, null, 1) + '\n'); };

export function parseSeeds(s) {
  const out = [];
  for (const part of String(s).split(',').filter(Boolean)) {
    const [a, b] = part.split('-').map(Number);
    for (let x = a; x <= (b ?? a); x++) out.push(x);
  }
  return out;
}

/** Split hygiene: dev seeds only, unless --sealed with the PREREG-V-1 file whose sha256 is in FREEZE-V-1.json. */
export function checkSeeds(seeds, { sealed = false, prereg = null, freezeFile = path.join(REPO, 'research/breadth-20261021/factory/FREEZE-V-1.json') } = {}) {
  const inDev = s => s >= DEV[0] && s <= DEV[1], inSealed = s => s >= SEALED[0] && s <= SEALED[1];
  if (!sealed) {
    const bad = seeds.filter(s => !inDev(s));
    if (bad.length) throw new Error(`seeds ${bad.join(',')} refused: dev/practice seeds ${DEV.join('-')} only (sealed needs --sealed --prereg)`);
    return true;
  }
  if (!prereg || !existsSync(freezeFile)) throw new Error('sealed run refused: PREREG-V-1 is not frozen (no FREEZE-V-1.json); draft only');
  const want = readJson(freezeFile).sha256;
  if (sha256(readFileSync(prereg)) !== want) throw new Error('sealed run refused: --prereg does not match the frozen PREREG-V-1 hash');
  const bad = seeds.filter(s => !inSealed(s));
  if (bad.length) throw new Error(`seeds ${bad.join(',')} are not sealed V seeds`);
  return true;
}

/** Planning estimate (USD) for one arm over n streams of t triggers: upper (no cache) and cached (90% of input as cache reads). */
export function estimate(armName, { streams, triggers }) {
  const a = ARMS[armName];
  if (!a || a.mode === 'scripted') return { arm: armName, upperUsd: 0, cachedUsd: 0, sessions: 0 };
  const [pin, pout] = PRICES[a.model];
  const cost = (inTok, outTok, cached) => (cached ? inTok * (0.1 + 0.9 * 0.1) : inTok) / 1e6 * pin + outTok / 1e6 * pout;
  if (a.mode === 'construct') {
    const per = cached => cost(a.buildInTok, a.buildOutTok, cached) * 2;      // build + one repair after the amendment
    return { arm: armName, sessions: streams * 2, upperUsd: +(streams * per(false)).toFixed(2), cachedUsd: +(streams * per(true)).toFixed(2),
             capPerStreamUsd: a.budgetUsd * 2 };
  }
  const n = streams * triggers;
  return { arm: armName, sessions: n, upperUsd: +(n * cost(a.inTok, a.outTok, false)).toFixed(2), cachedUsd: +(n * cost(a.inTok, a.outTok, true)).toFixed(2),
           capUsd: +(n * a.budgetUsd).toFixed(2) };
}

function py(args, { input = null } = {}) {
  const out = execFileSync(AB_PY, ['-I', '-B', STEP, ...args], { cwd: '/tmp', encoding: 'utf8', input, maxBuffer: 64 << 20, stdio: ['pipe', 'pipe', 'pipe'] });
  return JSON.parse(out.trim().split('\n').pop());
}

function parseArgs(argv) {
  const o = { arm: null, family: null, seeds: '2113', cap: 0, runId: null, resume: false, dryRun: false, solver: 'reference', mode: 'fast',
              sealed: false, prereg: null, live: path.join('/var/tmp/foundry-work', 'factory-runs'), binary: null, intake: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = () => argv[++i];
    if (k === '--arm') o.arm = v(); else if (k === '--family') o.family = v(); else if (k === '--seeds') o.seeds = v();
    else if (k === '--cap') o.cap = Number(v()); else if (k === '--run-id') o.runId = v(); else if (k === '--resume') o.resume = true;
    else if (k === '--dry-run') o.dryRun = true; else if (k === '--solver') o.solver = v(); else if (k === '--mode') o.mode = v();
    else if (k === '--sealed') o.sealed = true; else if (k === '--prereg') o.prereg = v(); else if (k === '--live') o.live = v();
    else if (k === '--binary') o.binary = v(); else if (k === '--intake') o.intake = v();
    else throw new Error(`unknown option ${k}`);
  }
  if (!ARMS[o.arm]) throw new Error(`--arm must be one of ${Object.keys(ARMS).join(', ')}`);
  return o;
}

/** Messy or policy intake per (family, seed): sealed seeds from SPLIT.json; dev seeds from --intake (default policy). */
function intakeOf(family, seed, o) {
  if (o.sealed) {
    const split = readJson(path.join(REPO, 'research/breadth-20261021/factory/SPLIT.json'));
    return split.sealed_by_family[family].find(r => r.seed === seed)?.intake ?? 'policy';
  }
  return o.intake ?? 'policy';
}

function streamsOf(o) {
  const fams = o.family === 'all' ? FAMILIES : [o.family];
  const seeds = parseSeeds(o.seeds);
  checkSeeds(seeds, { sealed: o.sealed, prereg: o.prereg });
  if (o.sealed) {
    const split = readJson(path.join(REPO, 'research/breadth-20261021/factory/SPLIT.json'));
    return fams.flatMap(f => split.sealed_by_family[f].filter(r => seeds.includes(r.seed)).map(r => ({ family: f, seed: r.seed })));
  }
  return fams.flatMap(f => seeds.map(s => ({ family: f, seed: s })));
}

/** One agent session for one trigger: bridge.py serve on world_t, a sandboxed CLI session, final world back host-side. */
async function agentTrigger({ arm, o, dir, stepDir, k, catalog }) {
  const { runClaudeCode } = await import('../../../src/executors/claude-code.mjs');
  const { startServe, materializeWorkdir, adapterText } = await import('../../autobench/lib.mjs');
  const a = ARMS[arm];
  const workdir = path.join(o.live, 'work', path.basename(dir), String(k));
  rmSync(workdir, { recursive: true, force: true });
  mkdirSync(workdir, { recursive: true });
  materializeWorkdir(workdir, catalog);
  if (a.notes && existsSync(path.join(dir, 'NOTES.md'))) copyFileSync(path.join(dir, 'NOTES.md'), path.join(workdir, 'NOTES.md'));
  const input = readJson(path.join(stepDir, 'input.json'));
  const hostDir = path.join(stepDir, 'host');
  const bridge = startServe({ liveDir: path.join(o.live, 'bridge'), input: path.join(stepDir, 'input.json'), world: path.join(stepDir, 'world_t.json'),
                              mailbox: path.join(workdir, '.tools'), hostDir, det: 'seed' });
  await bridge.ready;
  const user = input.prompt.find(m => m.role === 'user').content;
  const notes = a.notes ? '\n\nYou keep NOTES.md in your working directory across triggers of this stream; read it first and update it last.' : '';
  let r;
  try {
    r = await runClaudeCode({ model: a.model, prompt: user + notes, workdir, budgetUsd: a.budgetUsd, effort: a.effort ?? null,
                              appendSystemPrompt: adapterText(catalog, 50), tools: ['Bash', 'Read', 'Write', 'Edit'], binary: o.binary ?? null });
  } finally {
    await bridge.stop().catch(() => bridge.kill());
  }
  if (a.notes && existsSync(path.join(workdir, 'NOTES.md'))) copyFileSync(path.join(workdir, 'NOTES.md'), path.join(dir, 'NOTES.md'));
  return { session: r, after: path.join(hostDir, 'final-world.json') };
}

/** Construction session (F-H, wf-O): the arm writes workflow.py (handle(payload, ctx) through abr.lib.factory.store). */
async function construct({ arm, o, dir, family, seed }) {
  const { runClaudeCode } = await import('../../../src/executors/claude-code.mjs');
  const a = ARMS[arm];
  const workdir = path.join(o.live, 'work', path.basename(dir), 'build');
  mkdirSync(workdir, { recursive: true });
  const it = path.join(dir, 'host', 'intake.json');
  const policy = existsSync(it) ? readJson(it).text : readFileSync(path.join(REPO, 'experiments/autobench/families', family, 'POLICY.md'), 'utf8');
  const kit = readFileSync(path.join(HERE, 'builder-kit.md'), 'utf8');
  writeFileSync(path.join(workdir, 'REQUEST.md'), policy);
  writeFileSync(path.join(workdir, 'BUILDER-KIT.md'), kit);
  const prompt = 'Build the standing automation described in REQUEST.md as workflow.py, following BUILDER-KIT.md. It will run once per trigger with no memory except the apps. Write only workflow.py.';
  const r = await runClaudeCode({ model: a.model, prompt, workdir, budgetUsd: a.budgetUsd, effort: a.effort ?? null, tools: ['Read', 'Write', 'Edit'], binary: o.binary ?? null });
  const wf = path.join(workdir, 'workflow.py');
  if (existsSync(wf)) copyFileSync(wf, path.join(dir, 'workflow.py'));
  return r;
}

export async function main(argv = process.argv.slice(2)) {
  const o = parseArgs(argv);
  const streams = streamsOf(o);
  const runId = o.runId ?? `${o.arm}-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`;
  const runDir = path.join(o.live, runId);
  const est = estimate(o.arm, { streams: streams.length, triggers: 160 });
  if (o.dryRun) {
    console.log(JSON.stringify({ runId, arm: o.arm, streams, estimate: est, note: 'dry run: nothing generated, no session started ($0)' }, null, 1));
    return 0;
  }
  if (ARMS[o.arm].mode !== 'scripted' && !(o.cap > 0)) throw new Error('--cap <USD> is required for a model arm');
  const launch = { runId, arm: o.arm, family: o.family, seeds: o.seeds, sealed: o.sealed, cap: o.cap, solver: o.solver, mode: o.mode };
  const lf = path.join(runDir, 'launch.json');
  if (existsSync(lf)) {
    if (!o.resume) throw new Error(`${runDir} exists: use --resume (same settings) or a new --run-id`);
    const old = readJson(lf);
    if (JSON.stringify(old) !== JSON.stringify(launch)) throw new Error('resume refused: settings differ from launch.json');
  } else writeJson(lf, launch);
  const resF = path.join(runDir, 'results.jsonl'), faultF = path.join(runDir, 'faults.jsonl'), costF = path.join(runDir, 'cost.json');
  const done = new Set(existsSync(resF) ? readFileSync(resF, 'utf8').split('\n').filter(Boolean).map(l => { const x = JSON.parse(l); return `${x.family}/${x.seed}/${x.k}`; }) : []);
  let spent = existsSync(costF) ? readJson(costF).spentUsd : 0;
  for (const { family, seed } of streams) {
    const dir = path.join(runDir, `${family}-${seed}`), host = path.join(dir, 'host');
    if (!existsSync(path.join(host, 'meta.json'))) {
      const sealedFrom = o.sealed ? path.join('/var/tmp/foundry-work/benches/factory/sealed', family, String(seed)) : null;
      py(['init', '--family', family, '--seed', String(seed), '--host', host, '--intake', intakeOf(family, seed, o), ...(sealedFrom ? ['--sealed-from', sealedFrom] : [])]);
    }
    const meta = readJson(path.join(host, 'meta.json'));
    let world = path.join(dir, 'world.json');
    if (!existsSync(world)) copyFileSync(path.join(host, 'world0.json'), world);
    let catalog = null;
    if (ARMS[o.arm].mode === 'construct' && !existsSync(path.join(dir, 'workflow.py'))) {
      if (o.cap - spent < ARMS[o.arm].budgetUsd) { console.error('cost cap reached before construction'); return 2; }
      const r = await construct({ arm: o.arm, o, dir, family, seed });
      spent += r.costUpperUsd ?? ARMS[o.arm].budgetUsd; writeJson(costF, { spentUsd: spent });
      if (r.error && ENV_FAULT.test(r.error.code)) { appendFileSync(faultF, JSON.stringify({ family, seed, phase: 'build', error: r.error.code }) + '\n'); return 3; }
    }
    for (let k = 0; k < meta.triggers; k++) {
      if (done.has(`${family}/${seed}/${k}`)) continue;
      const stepDir = path.join(dir, 'steps', String(k));
      const t = py(['before', '--host', host, '--k', String(k), '--world', world, '--out', stepDir]);
      const before = path.join(stepDir, 'world_t.json');
      let after = path.join(stepDir, 'after.json'), session = null, err = null;
      const mode = ARMS[o.arm].mode;
      if (mode === 'scripted' || mode === 'construct') {
        const solver = mode === 'scripted' ? o.solver : path.join(dir, 'workflow.py');
        const r = existsSync(solver) || mode === 'scripted' ? py(['solve', '--host', host, '--k', String(k), '--world', before, '--solver', solver, '--out', after, '--mode', mode === 'construct' ? 'ab' : o.mode])
          : { error: 'no workflow.py' };
        err = r.error;
        if (!existsSync(after)) copyFileSync(before, after);
      } else {
        if (o.cap - spent < ARMS[o.arm].budgetUsd) { console.error(`cost cap: spent ${spent.toFixed(2)} of ${o.cap}; stopping before ${family}/${seed}/${k}`); return 2; }
        catalog ??= JSON.parse(execFileSync(AB_PY, ['-I', '-B', STEP, 'catalog', '--out', path.join(stepDir, 'input.json'), '--world', before], { cwd: '/tmp', encoding: 'utf8' }).trim().split('\n').pop());
        const r = await agentTrigger({ arm: o.arm, o, dir, stepDir, k, catalog });
        session = r.session; after = r.after;
        spent += session.costUpperUsd ?? ARMS[o.arm].budgetUsd; writeJson(costF, { spentUsd: spent });
        if (session.error && ENV_FAULT.test(session.error.code)) {
          appendFileSync(faultF, JSON.stringify({ family, seed, k, error: session.error.code }) + '\n');
          console.error(`environment fault ${session.error.code}: not scored; resume with --resume`);
          return 3;
        }
        if (!existsSync(after)) copyFileSync(before, after);
      }
      const v = py(['grade', '--host', host, '--k', String(k), '--before', before, '--after', after]);
      appendFileSync(resF, JSON.stringify({ family, seed, k, ...t, ...v, error: err, costUsd: session?.costUsd ?? 0, turns: session?.turns ?? null }) + '\n');
      copyFileSync(after, world);
    }
  }
  const rows = readFileSync(resF, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const summary = summarize(rows);
  writeJson(path.join(runDir, 'summary.json'), { ...launch, spentUsd: +spent.toFixed(4), ...summary });
  console.log(JSON.stringify({ runId, ...summary }));
  return 0;
}

export function summarize(rows) {
  const byStream = {};
  for (const r of rows) (byStream[`${r.family}/${r.seed}`] ??= []).push(r);
  const streams = Object.entries(byStream).map(([id, rs]) => {
    const weeks = [...new Set(rs.map(r => r.week))];
    return { id, triggers: rs.length, passed: rs.filter(r => r.pass).length, hard: rs.reduce((s, r) => s + (r.hard_violations ?? 0), 0),
             cleanWeeks: weeks.filter(w => rs.filter(r => r.week === w).every(r => r.pass)).length, weeks: weeks.length,
             clean: rs.every(r => r.pass) && rs.every(r => !r.hard_violations) };
  });
  return { streams: streams.length, cleanStreams: streams.filter(s => s.clean).length,
           cleanWeeks: `${streams.reduce((s, x) => s + x.cleanWeeks, 0)}/${streams.reduce((s, x) => s + x.weeks, 0)}`,
           triggers: rows.length, passRate: +(rows.filter(r => r.pass).length / Math.max(1, rows.length)).toFixed(4),
           hardViolations: streams.reduce((s, x) => s + x.hard, 0), perStream: streams };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().then(code => process.exit(code ?? 0), e => { console.error(e.message); process.exit(1); });
}
