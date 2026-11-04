#!/usr/bin/env node
// End-to-end injection at $0 (A10 / #42; dossier §4 item 3): a cheaper tier's REAL answers (tier-replay.mjs) served to
// the archived compiled solver through the override, every other judge held at its archived answer (strict memo), and
// the bed oracle on the output. This re-runs the D11 comparison without its confound: tierdown-e2e.mjs re-sampled every
// other judge live, so a difference there mixes the swapped judge with fresh draws of all the others.
//
// An assignment is a map {site: tier}; all its sites are served together in one run (one site for the screen; every
// promoted site for the policy; every site at one tier for the B-all-cheap baselines). Per row and assignment:
//   - an answer that is missing, invalid or an abstention is not served: the judge falls back to its reference answer
//     (a cascade [tier, reference]), and the reference cost is added to the tier's;
//   - a served answer the solver's own check rejects (the judge event comes back ok: false) is removed and the run
//     repeated (the cascade escalates to the reference on a failed check), at most 6 times; the reference cost is added;
//   - outcome against the base replay (leverage.mjs outcomeOf): same, changed, flip, deopt, crash, unmeasured. A deopt
//     is charged the arm's mean interpreter cost (the stream falls back to the interpreter).
// Judge cost of a row = sum over its judge decisions of the tier cost (assigned sites) or the archived reference cost.
//
// Review 2026-11-04 (RESULT-TIERDOWN.md §0) corrections, in force for every file written from then on:
//   - #1 a decision is a request KEY, and several judge events can send it (kinetics prose-events-a, prose-events-b and
//     prose-events-arbiter send one identical request). A model tier is charged once per reference EVENT x its k samples
//     (tierChargeOf), not once per key; the injected run's own event count is recorded (injEvents) because the override
//     serves one value to every event of a key, so readers that disagreed in the reference agree by construction.
//   - #1 a decision whose reference cascade STARTS at the candidate tier (sameFirstTier) is not a tier change: its
//     deployed cascade [tier, ...reference] is the reference cascade (policy.mjs cascadeOf), so any saving measured there
//     is a K = 1 draw suppressing an escalation, a split vote or an arbiter. It is flagged per decision.
//   - #6 latency is wall time per decision: the union of the reference calls' [createdAt - latencyMs, createdAt]
//     intervals (concurrent vote samples and concurrent readers counted once), not their sum; the tier's K = 1 answer
//     latency stands for its decision (a lower bound for a k-vote, whose wall time is the slowest of k draws).
//   - #10 a deopt or crash of a passing unit is a pass->fail loss (directionOf), not a direction-less outcome.
//   - #9 the tier's tokens are recorded per row (tierTokens) so a token-priced sensitivity can re-price Mercury.
//
//   node experiments/tierdown/inject.mjs --answers A.jsonl[,B.jsonl] --leverage L.json --slice C|H
//        --assign 'name=site:tier,site:tier;name2=...' | --each (every site x tier in the answers alone)
//        [--runs DIR] [--concurrency 2] --out FILE.json
import path from 'node:path';
import os from 'node:os';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { listArms, rowId, readJsonl, DEFAULT_RUNS, DEFAULT_EXPERIMENTS, REPO } from './archive.mjs';
import { replayRow } from './replay.mjs';
import { requestKeyOf } from './override.mjs';
import { siteIdOf, outcomeOf, pool } from './leverage.mjs';

export const MAX_ESCALATION_ROUNDS = 6;
// The frontier model's list price over each judge model's, from policy/models.json (model ids and prices only from the
// owner policy). Used only when input and output give the same ratio, so cache tokens scale with it too (Opus 5.5 over
// Haiku 5.5 = 40, over Sonnet 5.5 = 2). Haiku's long-prompt price (> 100K tokens) is not modelled: an estimate.
export const FRONTIER_MODEL = 'claude-opus-5-5';
export function frontierRatios(policy = JSON.parse(readFileSync(path.join(REPO, 'policy/models.json'), 'utf8'))) {
  const all = Object.values(policy).filter(Array.isArray).flat().filter(m => m?.id && m.price);
  const f = all.find(m => m.id === FRONTIER_MODEL)?.price;
  if (!f) throw new Error(`frontierRatios: ${FRONTIER_MODEL} has no price in policy/models.json`);
  const out = {};
  for (const m of all) {
    if (!(m.price.inputPerMTok > 0 && m.price.outputPerMTok > 0)) continue;
    const ri = f.inputPerMTok / m.price.inputPerMTok, ro = f.outputPerMTok / m.price.outputPerMTok;
    if (Math.abs(ri - ro) < 1e-9) out[m.id] = ri;
  }
  return out;
}
let ratios = null;
const FRONTIER_RATIO = new Proxy({}, { get: (_, id) => (ratios ??= frontierRatios())[id] });

// The judge decisions a solver's check rejected in a run: judge events that came back ok: false.
export function rejectedKeys(run, served) {
  const out = new Set();
  for (const j of run.judges ?? []) if (j.key && served.has(j.key) && j.ok === false) out.add(j.key);
  return out;
}

// Mean interpreter cost of an arm (what a deopt costs the stream).
export function interpreterCostOf(arm) {
  const rows = readJsonl(path.join(arm.dir, 'results.jsonl')).filter(r => r.delivered === 'interpreter' && typeof r.costUsd === 'number');
  return rows.length ? rows.reduce((s, r) => s + r.costUsd, 0) / rows.length : null;
}

export function parseAssign(spec) {
  return spec.split(';').filter(Boolean).map(part => {
    const [name, body] = part.split('=');
    return { name, map: Object.fromEntries(body.split(',').filter(Boolean).map(x => { const i = x.lastIndexOf(':'); return [x.slice(0, i), x.slice(i + 1)]; })) };
  });
}

// Length of the union of [start, end] intervals (ms).
export function wallMs(intervals) {
  const xs = intervals.filter(v => v && Number.isFinite(v[0]) && Number.isFinite(v[1]) && v[1] >= v[0]).map(v => [v[0], v[1]]).sort((a, b) => a[0] - b[0]);
  let total = 0, cur = null;
  for (const [a, b] of xs) {
    if (!cur || a > cur[1]) { if (cur) total += cur[1] - cur[0]; cur = [a, b]; } else cur[1] = Math.max(cur[1], b);
  }
  return cur ? total + cur[1] - cur[0] : 0;
}
// A replayed call's archived wall interval (createdAt is when the call returned).
export const intervalOf = c => (c.origCreatedAt != null && c.origLatencyMs != null ? [c.origCreatedAt - c.origLatencyMs, c.origCreatedAt] : null);
// Reference wall time of one decision from its archived calls; the plain sum when any interval is unknown.
export function refWallMs(calls) {
  const iv = calls.map(intervalOf);
  return iv.length && iv.every(Boolean) ? wallMs(iv) : calls.reduce((s, c) => s + (c.origLatencyMs ?? 0), 0);
}
// Direction of a measured unit's outcome: any change of pass counts, a deopt or crash of a passing unit included.
export function directionOf(basePass, pass) {
  if (pass == null) return null;
  return basePass && !pass ? 'pass->fail' : !basePass && pass ? 'fail->pass' : null;
}
// What serving one tier answer at a decision would cost deployed: every reference event of the key asks the tier with
// its own k samples (a model tier), or runs the code once (rule, memo: $0). The answer was asked once (K = 1).
export function tierChargeOf({ tier, answer, events }) {
  const code = ['rule', 'memo'].includes(tier);
  const asks = code ? events.length : events.reduce((s, e) => s + (e.samples ?? 1), 0);
  const per = k => (answer?.[k] ?? 0) * (code ? 0 : asks);
  return { asks, usd: code ? 0 : (answer?.costUsd ?? 0) * asks, tokens: code ? null : { input: per('inputTokens'), output: per('outputTokens'), cacheRead: per('cacheReadTokens') } };
}
// The reference events of every decision key of a base replay: judge names, k samples, and the first tier each tried.
export function eventsByKey(judges) {
  const out = new Map();
  for (const j of judges ?? []) {
    if (!j.key) continue;
    if (!out.has(j.key)) out.set(j.key, []);
    out.get(j.key).push({ name: j.name, samples: j.samples ?? 1, firstTier: j.tiersTried?.[0]?.model ?? j.tier ?? null, tier: j.tier ?? null });
  }
  return out;
}

// Inject one assignment into one row. answersByKey: Map(key -> Map(tier -> answer)).
export async function injectRow({ arm, row, base, assignment, answersByKey, work, interpreterUsd }) {
  const decisions = new Map(), events = eventsByKey(base.judges);
  for (const j of base.judges) if (j.key && !decisions.has(j.key)) decisions.set(j.key, { key: j.key, name: j.name, site: siteIdOf(arm.family, j.name) });
  const refCalls = key => base.calls.filter(c => c.key === key);
  const refCost = key => refCalls(key).reduce((s, c) => s + (c.origCostUsd ?? 0), 0);
  const refLatency = key => refWallMs(refCalls(key));
  const assigned = [...decisions.values()].filter(d => assignment.map[d.site]);
  if (!assigned.length) return null;
  const serve = new Map(), fellBack = new Map(), missing = [];
  for (const d of assigned) {
    const a = answersByKey.get(d.key)?.get(assignment.map[d.site]);
    if (!a) { missing.push(d.key); continue; }
    if (a.ok) serve.set(d.key, a); else fellBack.set(d.key, a.abstain ? 'abstain' : 'invalid');
  }
  if (missing.length) return { status: 'incomplete', missing: missing.length, assigned: assigned.length };
  let run, rounds = 0;
  for (;;) {
    run = await replayRow({ arm, row, flowPath: arm.flows.hooked, work, overrideData: { serve: [...serve].map(([key, a]) => ({ key, value: a.value })) } });
    const rej = rejectedKeys(run, serve);
    if (!rej.size || rounds >= MAX_ESCALATION_ROUNDS) break;
    for (const k of rej) { serve.delete(k); fellBack.set(k, 'check-failed'); }
    rounds++;
  }
  const outcome = outcomeOf(base, run);
  const injEvents = eventsByKey(run.judges);
  let judgeUsd = 0, latencyMs = 0, refUsd = 0, refLatencyMs = 0, refLatencySumMs = 0;
  const tierTokens = {}, detail = [];
  for (const d of decisions.values()) {
    refUsd += refCost(d.key); refLatencyMs += refLatency(d.key); refLatencySumMs += refCalls(d.key).reduce((s, c) => s + (c.origLatencyMs ?? 0), 0);
    const tier = assignment.map[d.site];
    if (!tier) { judgeUsd += refCost(d.key); latencyMs += refLatency(d.key); continue; }
    const a = answersByKey.get(d.key).get(tier), ev = events.get(d.key) ?? [{ name: d.name, samples: a.samples ?? 1 }];
    // Per reference event x k samples (review #1); the old per-key charge (a.samples once) is kept for the audit trail.
    const charge = tierChargeOf({ tier, answer: a, events: ev });
    judgeUsd += charge.usd; latencyMs += a.latencyMs ?? 0;
    if (charge.tokens) { const t = tierTokens[tier] ??= { input: 0, output: 0, cacheRead: 0 }; for (const k of Object.keys(t)) t[k] += charge.tokens[k]; }
    if (fellBack.has(d.key)) { judgeUsd += refCost(d.key); latencyMs += refLatency(d.key); }
    detail.push({ key: d.key.slice(0, 16), site: d.site, tier, names: [...new Set(ev.map(e => e.name))], refEvents: ev.length, injEvents: injEvents.get(d.key)?.length ?? 0,
      asks: charge.asks, perKeyAsks: ['rule', 'memo'].includes(tier) ? 1 : (a.samples ?? 1), sameFirstTier: ev.some(e => e.firstTier === tier),
      refModels: [...new Set(refCalls(d.key).map(c => c.modelId))], refUsd: refCost(d.key), tierUsd: charge.usd, fellBack: fellBack.get(d.key) ?? null,
      refWallMs: refLatency(d.key), refSumMs: refCalls(d.key).reduce((s, c) => s + (c.origLatencyMs ?? 0), 0), tierMs: a.latencyMs ?? null });
  }
  const deoptUsd = outcome === 'deopt' || outcome === 'crash' ? (interpreterUsd ?? 0) : 0;
  const pass = outcome === 'unmeasured' ? null : (outcome === 'same' || outcome === 'changed' ? base.pass : outcome === 'flip' ? !base.pass : false);
  return { status: 'measured', outcome, basePass: base.pass, pass, direction: directionOf(base.pass, pass), assigned: assigned.length, served: serve.size,
    fellBack: Object.fromEntries([...new Set(fellBack.values())].map(v => [v, [...fellBack.values()].filter(x => x === v).length])), escalationRounds: rounds,
    judgeUsd, refUsd, deoptUsd, latencyMs, refLatencyMs, refLatencySumMs, tierTokens, decisions: detail, misses: run.memo?.misses ?? null, deopt: run.deopt?.kind ?? null };
}

async function main() {
  const args = process.argv.slice(2), opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; }, flag = n => args.includes(n);
  const slice = opt('--slice');
  const answers = opt('--answers').split(',').flatMap(f => readJsonl(f)).filter(a => a.slice === slice);
  const lev = JSON.parse(readFileSync(opt('--leverage'), 'utf8'));
  const faithful = new Set(lev.rows.filter(r => r.status === 'screened').map(r => r.id));
  const answersByKey = new Map();
  for (const a of answers) { if (!answersByKey.has(a.key)) answersByKey.set(a.key, new Map()); answersByKey.get(a.key).set(a.tier, a); }
  const rowsWithAnswers = new Set(answers.map(a => a.row));
  const assignments = [];
  if (flag('--each')) {
    const pairs = [...new Set(answers.map(a => `${a.site}\0${a.tier}`))].sort();
    assignments.push(...pairs.map(p => { const [site, tier] = p.split('\0'); return { name: `${site}@${tier}`, map: { [site]: tier } }; }));
  }
  if (opt('--assign')) assignments.push(...parseAssign(opt('--assign')));
  const experiments = (opt('--experiments') ?? DEFAULT_EXPERIMENTS.join(',')).split(',');
  const arms = listArms({ runs: opt('--runs', DEFAULT_RUNS), experiments });
  const { sliceOf } = await import('./tier-replay.mjs');
  const jobs = arms.flatMap(arm => arm.rows.filter(row => faithful.has(rowId(arm, row)) && sliceOf(row.taskKey) === slice && (flag('--all-rows') || rowsWithAnswers.has(rowId(arm, row)))).map(row => ({ arm, row })));
  const work = mkdtempSync(path.join(os.tmpdir(), 'tierdown-inj-')), out = [];
  console.error(`slice ${slice}: ${jobs.length} rows, ${assignments.length} assignments, ${answers.length} answers`);
  try {
    await pool(jobs, Number(opt('--concurrency', 2)), async ({ arm, row }) => {
      const id = rowId(arm, row), base = await replayRow({ arm, row, flowPath: arm.flows.hooked, work }), interpreterUsd = interpreterCostOf(arm);
      const refUsd = base.calls.reduce((s, c) => s + (c.origCostUsd ?? 0), 0);
      // Judge time per unit: per decision wall time (concurrent samples counted once), summed over decisions (review #6).
      const keys = [...new Set(base.calls.map(c => c.key))], refLatencyMs = keys.reduce((s, k) => s + refWallMs(base.calls.filter(c => c.key === k)), 0);
      const refLatencySumMs = base.calls.reduce((s, c) => s + (c.origLatencyMs ?? 0), 0);
      // All-frontier COST estimate (review #4; no accuracy): every delivery judge call re-priced at Opus list price with its
      // archived token counts held fixed (policy/models.json: Opus/Haiku = 40x and Opus/Sonnet = 2x on every token class).
      const allFrontierUsd = base.calls.reduce((s, c) => s + (c.origCostUsd ?? 0) * (FRONTIER_RATIO[c.modelId] ?? 1), 0);
      // B-ref: every judge at its archived answer (the solvers as compiled); the denominator of every comparison.
      out.push({ row: id, taskKey: row.taskKey, family: arm.family, arm: arm.slug, version: row.stateAfter.version.dir, assignment: 'B-ref', status: 'reference', basePass: base.pass,
        rowRefUsd: refUsd, refLatencyMs, refLatencySumMs, allFrontierUsd, refCalls: base.calls.length, unpricedCalls: base.calls.filter(c => FRONTIER_RATIO[c.modelId] == null).length });
      for (const assignment of assignments) {
        const r = await injectRow({ arm, row, base, assignment, answersByKey, work, interpreterUsd });
        out.push({ row: id, taskKey: row.taskKey, family: arm.family, arm: arm.slug, version: row.stateAfter.version.dir, assignment: assignment.name, basePass: base.pass, rowRefUsd: refUsd,
          ...(r ?? { status: 'not-applicable' }) });
      }
      console.error(`${id}: ${assignments.length} assignments`);
    });
  } finally { rmSync(work, { recursive: true, force: true }); }
  out.sort((a, b) => `${a.assignment}\0${a.row}`.localeCompare(`${b.assignment}\0${b.row}`));
  const o = opt('--out');
  mkdirSync(path.dirname(path.resolve(o)), { recursive: true });
  writeFileSync(o, JSON.stringify({ tool: 'experiments/tierdown/inject.mjs', modelCalls: 0, slice, assignments, rows: out }, null, 1));
  const by = {};
  for (const r of out.filter(x => x.status === 'measured')) {
    const s = by[r.assignment] ??= { units: 0, flipsPF: 0, flipsFP: 0, unmeasured: 0, deopt: 0, judgeUsd: 0, refUsd: 0 };
    s.units++; if (r.direction === 'pass->fail') s.flipsPF++; if (r.direction === 'fail->pass') s.flipsFP++; if (r.outcome === 'unmeasured') s.unmeasured++; if (r.outcome === 'deopt' || r.outcome === 'crash') s.deopt++;
    s.judgeUsd += r.judgeUsd + r.deoptUsd; s.refUsd += r.refUsd;
  }
  console.log(JSON.stringify(by, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e.stack ?? e); process.exit(1); });
