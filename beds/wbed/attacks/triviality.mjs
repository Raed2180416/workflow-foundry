#!/usr/bin/env node
// Triviality and structure-necessity attack driver for the W-bed rungs (W-BED §2.4). PREPARED, DRY-RUN ONLY: this
// script never calls a model and never starts `claude`. It prints the plan (12 attack seeds x 2 efforts x one Haiku
// call per rung), the expected cost, the gate, and the exact call shape the coordinator runs with the owner's token.
//
//   node beds/wbed/attacks/triviality.mjs [--rung r0|r1|r2|r3|r4|all] [--difficulty 3] [--seeds 379-390] [--efforts none,medium]
//                                         [--stub empty|reference|<control name>] [--emit DIR] [--json]
//
//   (default)  dry run: plan, sizes, cost, gate, call shapes
//   --stub     run the whole plan through the bed oracle with a stub "model" that answers with an empty object, the
//              bed's reference output, or one bad control's output; no model call. Proves the scoring path and the gate
//              table before any money is spent.
//   --emit DIR write, per planned call, the rendered prompt (inline render, as the B0-call arm sends it), the output schema,
//              the system prompt, a calls.jsonl manifest and a run.sh with the exact claude -p lines. Nothing is executed.
//
// The gate (§2.4 item 1): a rung is admitted only if one Haiku 5.5 call passes <= 2/12 at each effort. For R0 (§3.0) the
// expectation is inverted: one call should pass >= 10/12. Structure necessity (§2.4 item 3) has no separate attack for R1:
// R1's structural feature is the typed pipeline itself, and "the best workflow without it" is the one-call attack. R2 and
// R3 declare their necessity attack in the rung table below; its deterministic stand-ins are the beds'
// `necessityControls`, which `--stub <name>` scores through the oracle like any bad control.
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inlineRender } from '../../../experiments/lib/beds.mjs';
import { canonical, sha256, estimateTokens } from '../lib/prng.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
// The rung table: one row per admitted rung. `expect` is what one Haiku call should do ('fail' = the gate of §2.4 item 1).
const ONE_CALL_GATE = 'admit the rung only if one call passes <= 2/12 at each effort (W-BED §2.4 item 1); attack success drops the rung';
export const RUNGS = {
  r0: { family: 'wbed-r0', expect: 'pass', gate: 'R0 control: one call should pass >= 10/12 at each effort (W-BED §3.0)', necessity: null },
  r1: { family: 'wbed-r1', expect: 'fail', gate: ONE_CALL_GATE, necessity: 'none separate: the typed pipeline is the feature, so the one-call attack is the necessity attack' },
  r2: { family: 'wbed-r2', expect: 'fail', gate: ONE_CALL_GATE,
    necessity: 'the best workflow without the judged branch: one handler for every document kind (bed necessityControls one-handler:*, no-escalation, review-everything) must fail >= 50% of attack seeds' },
  r3: { family: 'wbed-r3', expect: 'fail', gate: ONE_CALL_GATE,
    necessity: 'the best workflow without fan-out/fan-in: one sequential context (size: >= 32K tokens inline at d4, >= 60K at d5) and a reducer-less fan-in (bed necessityControls) must fail >= 50% of attack seeds' },
  r4: { family: 'wbed-r4', expect: 'fail', gate: ONE_CALL_GATE,
    necessity: 'none by design (W-BED §2.4 item 3: nesting never changes correctness); R4 is measured on construction cost through reuse (curriculum CUR - ISO, bed scoreReuse)' },
};
export const MODEL = 'claude-haiku-5-5';
export const ATTACK_SEEDS = Array.from({ length: 12 }, (_, i) => 379 + i); // W-BED §8 wbed-attack (dev 379-390)
export const EFFORTS = ['none', 'medium'];
// The B0-call arm's system prompt (experiments/lib/arms/b0-call.mjs SYSTEM; the test pins that they are equal).
export const B0_SYSTEM = 'You solve the task below. Read all of it carefully, follow its rules exactly, and return only the final answer as JSON matching the provided schema.';
// Measured per-call cost of one Haiku call on records/kinetics through claude-cli (W-BED §3, REPORT.md:19-20).
export const MEASURED_CALL_USD = [0.026, 0.030];

export async function loadRung(rung) {
  if (!RUNGS[rung]) throw new Error(`unknown rung ${rung}`);
  return import(pathToFileURL(path.join(here, '..', rung, 'index.mjs')).href);
}

/** The claude-cli route as the engine runs it: invocation and child env from policy/models.json, effort and thinking
 *  budget from src/models/port.mjs (both read, never modified). */
export async function callShape(effort) {
  const policy = JSON.parse(readFileSync(path.join(root, 'policy/models.json'), 'utf8'));
  const cli = policy.providers['claude-cli'];
  const { DECODING_BY_KIND } = await import(pathToFileURL(path.join(root, 'src/models/port.mjs')).href);
  const dec = DECODING_BY_KIND['claude-cli']({ reasoning: effort });
  const price = policy.models.find(m => m.id === MODEL)?.price ?? null;
  return { binary: cli.binary, invocation: cli.invocation, childEnv: { ...(cli.childEnv ?? {}), MAX_THINKING_TOKENS: String(dec.thinkingTokens) },
    effortFlag: dec.effort, thinkingTokens: dec.thinkingTokens, price };
}
const shq = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
export function cliLine(shape, { systemFile, schemaFile, promptFile, maxBudgetUsd = 1 }) {
  const env = Object.entries(shape.childEnv).map(([k, v]) => `${k}=${shq(v)}`).join(' ');
  const inv = shape.invocation.map(shq).join(' ');
  return `env ${env} ${shape.binary} ${inv} --model ${MODEL} --system-prompt "$(cat ${shq(systemFile)})" --json-schema "$(cat ${shq(schemaFile)})" --effort ${shape.effortFlag} --max-budget-usd ${maxBudgetUsd} < ${shq(promptFile)}`;
}

export async function plan({ rungs = ['r1'], difficulty = 3, seeds = ATTACK_SEEDS, efforts = EFFORTS } = {}) {
  const out = [];
  for (const rung of rungs) {
    const bed = await loadRung(rung);
    const tasks = seeds.map(seed => {
      const task = bed.generate({ seed, split: 'dev', difficulty });
      const prompt = inlineRender(task);
      return { seed, task, prompt, promptTokens: estimateTokens(prompt), taskHash: sha256(canonical(task)) };
    });
    const shapes = {};
    for (const e of efforts) shapes[e] = await callShape(e);
    const toks = tasks.map(t => t.promptTokens);
    const calls = tasks.length * efforts.length;
    // Token-priced estimate: input = prompt + system + schema; output = the bed's suggested budget + the thinking budget.
    const price = shapes[efforts[0]].price ?? { inputPerMTok: 0.1, outputPerMTok: 0.5 };
    let tokenUsd = 0;
    for (const t of tasks) for (const e of efforts) {
      const inTok = t.promptTokens + estimateTokens(B0_SYSTEM) + estimateTokens(JSON.stringify(bed.outputSchema));
      const outTok = (t.task.budget?.outputTokens ?? 1000) + shapes[e].thinkingTokens;
      tokenUsd += (inTok * price.inputPerMTok + outTok * price.outputPerMTok) / 1e6;
    }
    out.push({
      rung, family: bed.family.id, version: bed.family.version, difficulty, seeds, efforts, model: MODEL, calls,
      promptTokens: { min: Math.min(...toks), mean: Math.round(toks.reduce((a, b) => a + b, 0) / toks.length), max: Math.max(...toks) },
      estUsd: { tokenPriced: Math.round(tokenUsd * 1000) / 1000, measuredOverhead: MEASURED_CALL_USD.map(x => Math.round(x * calls * 100) / 100) },
      gate: RUNGS[rung].gate, necessity: RUNGS[rung].necessity,
      shapes, tasks,
    });
  }
  return out;
}

export async function runStub(p, stub = 'empty') {
  const rows = [];
  for (const r of p) {
    const bed = await loadRung(r.rung);
    const ctl = [...bed.badControls, ...(bed.necessityControls ?? [])].find(c => c.name === stub);
    if (!['empty', 'reference'].includes(stub) && !ctl) throw new Error(`unknown stub ${stub} for ${r.rung}`);
    for (const e of r.efforts) {
      let pass = 0;
      for (const t of r.tasks) {
        const output = stub === 'reference' ? bed.referenceSolve(t.task) : stub === 'empty' ? {} : ctl.make(t.task);
        if (bed.oracle(t.task, output).pass) pass++;
      }
      const n = r.tasks.length;
      const verdict = RUNGS[r.rung].expect === 'pass' ? (pass >= 10 ? 'as expected (one call suffices)' : 'R0 harder than intended')
        : (pass <= 2 ? 'gate holds (rung admitted)' : 'gate fails (rung dropped)');
      rows.push({ rung: r.rung, effort: e, stub, pass, n, verdict });
    }
  }
  return rows;
}

export function emit(p, dir) {
  mkdirSync(dir, { recursive: true });
  const manifest = [], sh = ['#!/usr/bin/env bash', '# W-bed triviality attack: one Haiku call per line. Generated by beds/wbed/attacks/triviality.mjs --emit.',
    '# Not executed by the generator. Needs the owner\'s claude login or CLAUDE_CODE_OAUTH_TOKEN in the environment (never written here).',
    'set -u', 'mkdir -p out'];
  writeFileSync(path.join(dir, 'system.txt'), B0_SYSTEM);
  for (const r of p) {
    const schemaFile = `schema-${r.rung}.json`;
    for (const t of r.tasks) {
      const promptFile = `prompt-${r.rung}-d${r.difficulty}-s${t.seed}.txt`;
      writeFileSync(path.join(dir, promptFile), t.prompt);
      for (const e of r.efforts) {
        const outFile = `out/${r.rung}-d${r.difficulty}-s${t.seed}-${e}.json`;
        manifest.push({ rung: r.rung, family: r.family, seed: t.seed, difficulty: r.difficulty, effort: e, taskHash: t.taskHash, promptFile, schemaFile, outFile });
        sh.push(`${cliLine(r.shapes[e], { systemFile: 'system.txt', schemaFile, promptFile })} > ${shq(outFile)}`);
      }
    }
  }
  writeFileSync(path.join(dir, 'calls.jsonl'), manifest.map(x => JSON.stringify(x)).join('\n') + '\n');
  writeFileSync(path.join(dir, 'run.sh'), sh.join('\n') + '\n');
  return manifest.length;
}
async function writeSchemas(p, dir) {
  for (const r of p) { const bed = await loadRung(r.rung); writeFileSync(path.join(dir, `schema-${r.rung}.json`), JSON.stringify(bed.outputSchema)); }
}

function printPlan(p) {
  for (const r of p) {
    console.log(`\n== ${r.family} v${r.version} (rung ${r.rung.toUpperCase()}), difficulty ${r.difficulty}`);
    console.log(`plan: ${r.seeds.length} seeds (${r.seeds[0]}-${r.seeds[r.seeds.length - 1]}) x ${r.efforts.length} efforts (${r.efforts.join(', ')}) x 1 call of ${r.model} = ${r.calls} calls`);
    console.log(`inline prompt size (tokens, utf8/4): min ${r.promptTokens.min}, mean ${r.promptTokens.mean}, max ${r.promptTokens.max}`);
    console.log(`expected cost: token-priced $${r.estUsd.tokenPriced} list; with the measured claude-cli per-call overhead $${r.estUsd.measuredOverhead[0]}-${r.estUsd.measuredOverhead[1]}`);
    console.log(`gate: ${r.gate}`);
    if (r.necessity) console.log(`structure necessity: ${r.necessity}`);
    for (const e of r.efforts) {
      const s = r.shapes[e];
      console.log(`call shape, effort ${e}: ${cliLine(s, { systemFile: 'system.txt', schemaFile: `schema-${r.rung}.json`, promptFile: `prompt-${r.rung}-d${r.difficulty}-s<seed>.txt` })}`);
    }
  }
  console.log(`
In-repo route (journaled ModelPort; preferred, same decoding): after the one-line registration in experiments/lib/beds.mjs
(research/jit-20261008/design/W-BED-R1-NOTES.md), run with the owner's token in the environment:
  makeTasks('${p.map(r => r.family).join("' | '")}', { split: 'dev', seeds: [${ATTACK_SEEDS[0]}..${ATTACK_SEEDS[ATTACK_SEEDS.length - 1]}], difficulty: 3 })
  arms: b0Call({ id: 'b0-call-haiku-none', model: '${MODEL}', modelPort, reasoning: 'none' }),
        b0Call({ id: 'b0-call-haiku-medium', model: '${MODEL}', modelPort, reasoning: 'medium' })   (experiments/lib/arms/b0-call.mjs)
  runExperiment({ experiment: 'wbed-triviality', arms, tasks, trials: 1, workRoot: '/var/tmp/foundry-work/wbed-triv', concurrency: 4, envFaultRule: true })
  with modelPort from createModelPort({ journalFile, allowedModels: ['${MODEL}'], maxBudgetUsdPerCall: 1 }) (experiments/lib/models.mjs).
The JIT interpreter (experiments/jit/interpret.mjs, one agent session) is NOT part of this attack: it is arm (d), not "one call".
No model was called by this script.`);
}

// ---------------------------------------------------------------------------------------------------------------------
async function main(argv) {
  const arg = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
  const rungArg = arg('--rung', 'r1');
  const rungs = rungArg === 'all' ? Object.keys(RUNGS) : rungArg.split(',');
  const difficulty = Number(arg('--difficulty', '3'));
  const seedArg = arg('--seeds', null);
  const seeds = seedArg ? (seedArg.includes('-') ? (([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i))(seedArg.split('-').map(Number)) : seedArg.split(',').map(Number)) : ATTACK_SEEDS;
  const efforts = arg('--efforts', EFFORTS.join(',')).split(',');
  const p = await plan({ rungs, difficulty, seeds, efforts });
  const stubI = argv.indexOf('--stub');
  if (stubI >= 0) {
    const stub = argv[stubI + 1] && !argv[stubI + 1].startsWith('--') ? argv[stubI + 1] : 'empty';
    const rows = await runStub(p, stub);
    if (argv.includes('--json')) console.log(JSON.stringify(rows));
    else for (const x of rows) console.log(`stub ${x.stub}: ${x.rung} effort ${x.effort}: ${x.pass}/${x.n} pass -> ${x.verdict}`);
    return;
  }
  const dir = arg('--emit', null);
  if (dir) {
    const n = emit(p, dir); await writeSchemas(p, dir);
    console.log(`wrote ${n} planned calls to ${dir} (calls.jsonl, run.sh, prompts, schemas, system.txt); nothing executed`);
    return;
  }
  if (argv.includes('--json')) console.log(JSON.stringify(p.map(({ tasks, shapes, ...rest }) => ({ ...rest, taskHashes: tasks.map(t => t.taskHash) }))));
  else printPlan(p);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(e => { console.error(e?.stack ?? e); process.exit(1); });
}
