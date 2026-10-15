// AGENTV-E8 runner (FIRST-CLASS-PROGRAMS §1.5; preregistration research/enterprise-20261014/AGENTV-E8-PREREG.md). It
// mirrors experiments/ebed/run-agent.mjs (same world generator call, reference pools, host options, grading summary,
// resumable on-disk journal, live files outside the repository) with the arm "agent-H + validator" (./arm.mjs). METERED:
// every session is one model call. The meter is the need router's §12 one cap meter (FIRST-CLASS-PROGRAMS §0.3): each
// session's bound is reserved before launch (up to `--concurrency` in flight), a session is charged max(reported,
// re-priced) when its cost was observed and its bound when it was not, and a start that does not fit under the cap is a
// host QuotaStop (the clock freezes; cases still open are censored, not failed). Every reservation and charge goes to
// spend.jsonl in the live directory, so a resumed run starts from what was already spent.
//   node experiments/agentv/run.mjs --model claude-haiku-5-5 --label agentv-e8-s12 --seeds 1232 --difficulties 2 \
//        --size 12 --tick-budget 0.4 --tick-minutes 6 --cap 5 --concurrency 4 --retries 1
// --dry (label must start with dry-): a scripted session instead of the model ($0, no model call) that checks a minimal
// draft through validate.mjs and writes it; results stay in the live directory. A wiring check of this file, not a row.
// Before any paid call it prints the preregistration's banner (MDE, prediction, what refutes) from the prereg file and
// refuses to start without it. Grading (the oracle and the reference pools) happens here, in the analyst process; the arm
// and its validator never import it.
import { writeFileSync, mkdirSync, existsSync, readFileSync, copyFileSync, appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { createHost, QuotaStop, bindItem } from '../../beds/ebed/host/host.mjs';
import { resumeRun } from '../../beds/ebed/host/replay.mjs';
import { CONTROL_TYPES } from '../../beds/ebed/host/journal.mjs';
import { hashOf, sha256 } from '../../beds/lib/canonical.mjs';
import { summarize } from '../ebed/run-agent.mjs';
import { contractText } from '../ebed/build.mjs';
import { addUsage, cacheReadShare, zeroUsage } from '../memory/cache-share.mjs';
import { StageBudget, loadSpend, meterOf } from '../need-router/label-run.mjs';
import { messageUsageOf } from '../c0/construct.mjs';
import { agentVArm, ENV_FAULT_CODES, problemClass } from './arm.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');
export const PREREG_FILE = path.join(ROOT, 'research/enterprise-20261014/AGENTV-E8-PREREG.md');
export const LIVE_ROOT = '/var/tmp/foundry-work/agentv-arms';
export const AGENTH_JOURNAL = '/var/tmp/foundry-work/ebed-arms/agenth-e8-s12/journal-w1232-d2.jsonl';
/** The world agent-H s12 and the built workflows were graded on (run.start world digest of agenth-e8-s12). */
export const EXPECTED_WORLDS = Object.freeze({ '1232/2/12': '56971c9b3aaa4886229ac81fd55dcc4f9d41640a7be06fae2651ba0b087f1bff' });
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

/** The banner block of the preregistration (```prereg-banner … ```) and the file's sha256; throws when either is missing. */
export function preregBanner(file = PREREG_FILE) {
  if (!existsSync(file)) throw new Error(`no preregistration at ${file}: write it before any paid row (FIRST-CLASS-PROGRAMS §0.3)`);
  const text = readFileSync(file, 'utf8');
  const m = text.match(/```prereg-banner\n([\s\S]*?)\n```/);
  if (!m) throw new Error(`${file} has no prereg-banner block (MDE, prediction, refutation)`);
  for (const k of ['MDE', 'PREDICTION', 'REFUTED']) if (!m[1].includes(k)) throw new Error(`the prereg banner lacks ${k}`);
  return { text: m[1], sha256: sha256(text) };
}

/**
 * The §12 one cap meter over a spend ledger (PREREG-NEED-V1 §12 K5; label-run.mjs StageBudget and meterOf, imported
 * read-only). before() reserves a session's bound or throws QuotaStop; after() charges it. A resumed meter starts from
 * the ledger: settled charges, plus reservations never settled at their bound.
 */
export function makeMeter({ capUsd, stage, spendFile, priceTable }) {
  const prior = loadSpend([spendFile], stage);
  const budget = new StageBudget(capUsd, prior.totalUsd, { stage, files: [spendFile], attempts: prior.attempts });
  return {
    budget, prior,
    before({ model, bound, instance, now, attempt }) {
      const tok = budget.reserve(bound, { kind: 'session', key: `${instance}|${now}|a${attempt}`, model });
      if (!tok) throw new QuotaStop(`cap $${capUsd} reached on the §12 meter (spent $${budget.spentUsd.toFixed(4)}, in flight $${budget.reservedUsd.toFixed(2)}, next bound $${bound})`);
      return { ...tok, model };
    },
    after(tok, r) {
      const messageUsage = r?.transcript ? messageUsageOf(r.transcript) : null;
      const m = meterOf({ kind: 'session', priceTable, model: tok.model, bound: tok.bound,
        r: { costUsd: r?.costUsd ?? null, costUnknown: r?.costUsd === null || r?.costUsd === undefined, error: r?.error ?? null, meta: { messageUsage, streamUsage: r?.streamUsage ?? null } } });
      budget.settle(tok, m.charged, { reported: m.reported, measured: m.measured, imputed: m.imputed, unknown: m.unknown, error: typeof r?.error === 'string' ? r.error : r?.error?.code ?? null });
      return m.charged;
    },
  };
}

/** Completed-case verdicts of a run (pass, class, first divergence), for the paired comparison. */
export function perCase(world, rows, pools, label) {
  return e8.oracle(world, rows, { pools, arm: label }).cases.filter(c => c.pool === 'completed')
    .map(c => ({ case: c.case, class: c.class, pass: !!c.pass, armCensored: !!c.armCensored, divergence: c.firstDivergence ? `L${c.firstDivergence.layer}:${c.firstDivergence.code}` : null }));
}

/** Content rows of a host journal file (control rows dropped, chain fields stripped), as host.journal.contentRows(). */
export function journalContentRows(file) {
  return readJsonl(file).filter(r => !CONTROL_TYPES.has(r.type)).map(({ seq, prev, hash, ...c }) => c);
}

/** Exact two-sided McNemar p from the discordant counts b (A pass, B fail) and c (A fail, B pass). */
export function mcnemarExact(b, c) {
  const n = b + c;
  if (!n) return 1;
  let tail = 0, coef = 1;
  for (let i = 0; i <= Math.min(b, c); i++) { tail += coef; coef = coef * (n - i) / (i + 1); }
  return Math.min(1, 2 * tail / 2 ** n);
}

/** Paired table of two per-case lists on the same world (only cases completed in both). */
export function paired(a, b) {
  const byB = new Map(b.map(x => [x.case, x]));
  let both = 0, aOnly = 0, bOnly = 0, neither = 0;
  const flips = [];
  for (const x of a) {
    const y = byB.get(x.case);
    if (!y) continue;
    if (x.pass && y.pass) both++; else if (x.pass) { aOnly++; flips.push({ case: x.case, class: x.class, pass: 'A' }); }
    else if (y.pass) { bOnly++; flips.push({ case: x.case, class: x.class, pass: 'B' }); } else neither++;
  }
  return { n: both + aOnly + bOnly + neither, both, aOnly, bOnly, neither, mcnemarP: mcnemarExact(aOnly, bOnly), flips };
}

/** Totals over the validator journal (one row per tick). */
export function validatorStats(rows) {
  const s = { ticks: rows.length, sessions: 0, retries: 0, ticksRetried: 0, retryFixed: 0, finalInvalid: 0, finalMissing: 0, quotaStops: 0,
    validateCalls: 0, ticksUsingValidator: 0, validateInvalid: 0, inSessionProblemClasses: {}, firstGateRefusalClasses: {}, envFaultSessions: 0, reportedUsd: 0, chargedUsd: 0, usage: zeroUsage() };
  for (const r of rows) {
    s.sessions += r.sessions.length; s.retries += r.retries; s.validateCalls += r.validateCalls; s.validateInvalid += r.validateInvalid;
    if (r.validateCalls) s.ticksUsingValidator += 1;
    if (r.retries) { s.ticksRetried += 1; if (r.final === 'valid') s.retryFixed += 1; }
    if (r.final === 'invalid' || r.final === 'not-json') s.finalInvalid += 1;
    if (r.final === 'missing') s.finalMissing += 1;
    if (r.final === 'quota-stop') s.quotaStops += 1;
    for (const [k, v] of Object.entries(r.problemsSeen ?? {})) s.inSessionProblemClasses[k] = (s.inSessionProblemClasses[k] ?? 0) + v;
    const g1 = r.gates?.[0];
    if (g1 && g1.kind !== 'valid') for (const p of g1.problems) s.firstGateRefusalClasses[problemClass(p)] = (s.firstGateRefusalClasses[problemClass(p)] ?? 0) + 1;
    for (const x of r.sessions) {
      if (ENV_FAULT_CODES.has(x.error)) s.envFaultSessions += 1;
      s.reportedUsd += x.costUsd ?? 0; s.chargedUsd += x.charged ?? 0; addUsage(s.usage, x.tokens);
    }
  }
  s.cacheReadShare = cacheReadShare(s.usage);
  return s;
}

/**
 * One world, resumable: a fresh host run, or (when its journal exists) resumeRun from the last commit, where the
 * committed prefix replays at $0 and live calls pick up at the interrupted wake-up. Returns { status, host, world, pools }.
 */
export async function runWorldV({ seed, d, size, liveDir, armFor, concurrency, callTimeoutMs, allowNewWorld = false }) {
  const w = e8.generateWorld({ seed, difficulty: d, mix: 'tail', ...(size ? { size } : {}) });
  const digest = hashOf(w), want = EXPECTED_WORLDS[`${seed}/${d}/${size ?? ''}`];
  if (want && digest !== want && !allowNewWorld) throw new Error(`world ${seed}/d${d}/size ${size} digest ${digest} is not the agent-H/workflow world ${want}: the paired cases would differ`);
  const { pools } = await e8.referenceRuns(w);
  const workRoot = path.join(liveDir, `w${seed}-d${d}`);
  const journalFile = path.join(liveDir, `journal-w${seed}-d${d}.jsonl`), blobDir = path.join(liveDir, `blobs-w${seed}-d${d}`);
  const hostOpts = { item: e8.binding, world: w, arm: armFor(workRoot), concurrency, callTimeoutMs, journalFile, blobDir };
  let status, host, resumed = false;
  if (existsSync(journalFile)) { resumed = true; const r = await resumeRun(hostOpts); status = r.status; host = r.host; }
  else { host = createHost(hostOpts); status = (await host.run()).status; }
  return { status, host, world: w, digest, pools, resumed, journalFile };
}

/** --dry: a scripted session (no model, $0): it checks a minimal draft through validate.mjs, then writes it. */
export async function dryRunner({ workdir }) {
  const input = JSON.parse(readFileSync(path.join(workdir, 'task.json'), 'utf8'));
  const subject = input.events.find(e => typeof e.payload?.orderId === 'string')?.payload.orderId ?? input.carry?.subject ?? null;
  const out = { decisions: { subject }, effects: [], carry: { subject } };
  writeFileSync(path.join(workdir, 'draft.json'), JSON.stringify(out));
  const code = await new Promise(res => { const c = spawn(process.execPath, ['validate.mjs', 'draft.json'], { cwd: workdir, stdio: 'ignore' }); c.on('close', res); c.on('error', () => res(-1)); });
  if (code === 0) writeFileSync(path.join(workdir, 'output.json'), JSON.stringify(out));
  return { costUsd: 0, turns: 1, error: null, streamUsage: zeroUsage() };
}

async function main() {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const POLICY = JSON.parse(readFileSync(path.join(ROOT, 'policy', 'models.json'), 'utf8'));
  const STAGES = JSON.parse(readFileSync(path.join(ROOT, 'research/need-router-20261014/prereg/stages.json'), 'utf8'));
  const model = arg('--model', null);
  if (!POLICY.models.some(m => m.id === model)) throw new Error(`--model must be a policy model id (policy/models.json): ${model}`);
  if (!STAGES.priceTable?.models?.[model]) throw new Error(`no §12 price table entry for ${model} (research/need-router-20261014/prereg/stages.json)`);
  const label = arg('--label', null);
  if (!label || !/^[\w.-]+$/.test(label)) throw new Error('--label is required (letters, digits, . _ -)');
  const dry = process.argv.includes('--dry');
  if (dry !== label.startsWith('dry-')) throw new Error('--dry runs, and only they, carry a label starting with dry-');
  const banner = preregBanner(arg('--prereg', PREREG_FILE));
  console.log(`AGENTV-E8 preregistration (sha256 ${banner.sha256.slice(0, 16)}…):\n${banner.text}\n`);
  const liveDir = path.join(LIVE_ROOT, label);
  const out = dry ? path.join(liveDir, 'result') : path.join(ROOT, 'research/enterprise-20261014/runs', label);
  if (existsSync(path.join(out, 'result.json'))) throw new Error(`${out}/result.json exists`);
  mkdirSync(out, { recursive: true });
  const [s0, s1] = arg('--seeds', '1232').split('-').map(Number);
  const seeds = Array.from({ length: (s1 ?? s0) - s0 + 1 }, (_, i) => s0 + i);
  const difficulties = arg('--difficulties', '2').split(',').map(Number);
  const size = arg('--size', null) === null ? undefined : Number(arg('--size'));
  const cap = Number(arg('--cap', '5')), tickBudget = Number(arg('--tick-budget', '0.4')), tickMinutes = Number(arg('--tick-minutes', '6'));
  const concurrency = Number(arg('--concurrency', '4')), retries = Number(arg('--retries', '1')), effort = arg('--effort', null);
  if (!(cap > 0 && tickBudget > 0 && tickMinutes > 0 && concurrency >= 1 && concurrency <= 4)) throw new Error('bad --cap/--tick-budget/--tick-minutes/--concurrency (concurrency 1..4, §12)');
  // Live files stay outside the repository while the run is in flight; they are copied in when it ends.
  mkdirSync(liveDir, { recursive: true });
  const liveTicks = path.join(liveDir, 'ticks.jsonl'), liveVal = path.join(liveDir, 'validator.jsonl'), spendFile = path.join(liveDir, 'spend.jsonl'), wallFile = path.join(liveDir, 'wall.jsonl');
  const meter = makeMeter({ capUsd: cap, stage: label, spendFile, priceTable: STAGES.priceTable });
  if (meter.prior.totalUsd) console.log(`  resuming: $${meter.prior.totalUsd.toFixed(4)} already on the meter (${meter.prior.openUsd ? `$${meter.prior.openUsd.toFixed(2)} of it unsettled reservations at their bound` : 'all settled'})`);
  const schemas = bindItem(e8.binding).schemas;
  // Both sessions of a retried tick must fit in one host call.
  const callTimeoutMs = ((1 + retries) * tickMinutes + 1) * 60_000;
  const rows = [];
  for (const d of difficulties) for (const seed of seeds) {
    const armFor = workRoot => agentVArm({ id: label, model, workRoot, contract: contractText(), effort, budgetUsdPerTick: tickBudget, minutesPerTick: tickMinutes,
      journal: liveTicks, validatorJournal: liveVal, schemas, retries, meter, ...(dry ? { runner: dryRunner } : {}) });
    const t = Date.now(), startedAt = new Date().toISOString();
    let r;
    try { r = await runWorldV({ seed, d, size, liveDir, armFor, concurrency, callTimeoutMs, allowNewWorld: process.argv.includes('--allow-new-world') }); }
    catch (e) { rows.push({ seed, d, size: size ?? null, status: `host-error: ${String(e?.message ?? e).slice(0, 200)}`, wallMs: Date.now() - t }); console.log(`  d${d} seed ${seed}: ${rows.at(-1).status}`); continue; }
    appendFileSync(wallFile, JSON.stringify({ seed, d, startedAt, endedAt: new Date().toISOString(), wallMs: Date.now() - t, status: r.status, resumed: r.resumed }) + '\n');
    const content = r.host.journal.contentRows();
    const s = summarize(r.world, content, r.pools, label);
    const cases = perCase(r.world, content, r.pools, label);
    const wallAllMs = readJsonl(wallFile).filter(x => x.seed === seed && x.d === d).reduce((a, x) => a + x.wallMs, 0);
    const row = { seed, d, size: size ?? null, worldDigest: r.digest, status: r.status, wallMs: Date.now() - t, wallAllInvocationsMs: wallAllMs, ...s, cases };
    if (`${seed}/${d}/${size ?? ''}` in EXPECTED_WORLDS && existsSync(arg('--paired-with', AGENTH_JOURNAL))) {
      const hRows = journalContentRows(arg('--paired-with', AGENTH_JOURNAL));
      row.pairedVsAgentH = paired(cases, perCase(r.world, hRows, r.pools, 'agenth-e8-s12'));   // A = agent-H + V, B = agent-H
    }
    rows.push(row);
    console.log(`  d${d} seed ${seed}${size ? ` size ${size}` : ''}: ${r.status}; ${s.passed}/${s.completed} completed pass (${s.armCensored} open at freeze), critical ${s.critical}, arm errors ${s.armErrors}, ${s.ticks} ticks, $${s.costUsd.toFixed(2)} reported`);
    if (row.pairedVsAgentH) console.log(`    paired vs agent-H: both ${row.pairedVsAgentH.both}, V only ${row.pairedVsAgentH.aOnly}, H only ${row.pairedVsAgentH.bOnly}, neither ${row.pairedVsAgentH.neither}; exact McNemar p ${row.pairedVsAgentH.mcnemarP.toFixed(3)}`);
    writeFileSync(path.join(liveDir, 'result.partial.json'), JSON.stringify({ label, model, rows }, null, 1));
    if (r.status === 'frozen') break;
  }
  const vstats = validatorStats(readJsonl(liveVal));
  const spend = loadSpend([spendFile], label);
  if (vstats.envFaultSessions) console.log(`WARNING: ${vstats.envFaultSessions} session(s) ended in an environment fault (${[...ENV_FAULT_CODES].join(', ')}). Per the preregistration the run is contaminated from the first one: cut the journal back to the last clean commit and resume.`);
  const result = { label, experiment: 'AGENTV-E8', arm: 'agent-H+V', ...(dry ? { dry: 'scripted sessions, no model: a wiring check, not a row' } : {}), prereg: { file: path.relative(ROOT, arg('--prereg', PREREG_FILE)), sha256: banner.sha256 },
    item: e8.family.id, spec: e8.specE.sha256, model, effort, tickBudgetUsd: tickBudget, tickMinutes, retries, concurrency, callTimeoutMs,
    meter: { capUsd: cap, totalUsd: spend.totalUsd, settledUsd: spend.settledUsd, unsettledAtBoundUsd: spend.openUsd, rule: 'PREREG-NEED-V1 §12 K5 (label-run.mjs StageBudget, meterOf)' },
    validator: vstats, seeds, difficulties, size: size ?? null, rows,
    claimRow: { schema: 'claim-row/0 fields for back-fill (experiments/claims/ not built yet, SPINE-0)', program: 'F1', experiment: 'AGENTV-E8', arm: 'agent-H+V',
      bed: 'ebed-e8', origin: 'our generator', fidelityTier: null, evidence: 'development', K: 1,
      usd: { run: spend.totalUsd, build: 0, world: null, upkeep: 0, imputedInMeter: spend.entries.filter(e => e.settled).reduce((a, e) => a + (e.imputed ?? 0), 0), reservedUnsettled: spend.openUsd },
      timing: { wallMs: rows.reduce((a, x) => a + (x.wallAllInvocationsMs ?? x.wallMs ?? 0), 0), concurrency }, envFaults: vstats.envFaultSessions } };
  writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 1));
  for (const f of ['ticks.jsonl', 'validator.jsonl', 'spend.jsonl', 'wall.jsonl']) if (existsSync(path.join(liveDir, f))) copyFileSync(path.join(liveDir, f), path.join(out, f));
  console.log(`metered $${spend.totalUsd.toFixed(4)} of $${cap} (reported $${vstats.reportedUsd.toFixed(4)}); validator: ${vstats.validateCalls} calls in ${vstats.ticksUsingValidator}/${vstats.ticks} ticks, ${vstats.ticksRetried} ticks retried (${vstats.retryFixed} fixed), ${vstats.finalInvalid} invalid outputs reached the host; prompt-cache read share ${vstats.cacheReadShare ?? '–'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
