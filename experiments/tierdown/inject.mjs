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
//   node experiments/tierdown/inject.mjs --answers A.jsonl[,B.jsonl] --leverage L.json --slice C|H
//        --assign 'name=site:tier,site:tier;name2=...' | --each (every site x tier in the answers alone)
//        [--runs DIR] [--concurrency 2] --out FILE.json
import path from 'node:path';
import os from 'node:os';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { listArms, rowId, readJsonl, DEFAULT_RUNS, DEFAULT_EXPERIMENTS } from './archive.mjs';
import { replayRow } from './replay.mjs';
import { requestKeyOf } from './override.mjs';
import { siteIdOf, outcomeOf, pool } from './leverage.mjs';

export const MAX_ESCALATION_ROUNDS = 6;

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

// Inject one assignment into one row. answersByKey: Map(key -> Map(tier -> answer)).
export async function injectRow({ arm, row, base, assignment, answersByKey, work, interpreterUsd }) {
  const decisions = new Map();
  for (const j of base.judges) if (j.key && !decisions.has(j.key)) decisions.set(j.key, { key: j.key, name: j.name, site: siteIdOf(arm.family, j.name) });
  const refCost = key => base.calls.filter(c => c.key === key).reduce((s, c) => s + (c.origCostUsd ?? 0), 0);
  const refLatency = key => base.calls.filter(c => c.key === key).reduce((s, c) => s + (c.origLatencyMs ?? 0), 0);
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
  let judgeUsd = 0, latencyMs = 0, refUsd = 0, refLatencyMs = 0;
  for (const d of decisions.values()) {
    refUsd += refCost(d.key); refLatencyMs += refLatency(d.key);
    const tier = assignment.map[d.site];
    if (!tier) { judgeUsd += refCost(d.key); latencyMs += refLatency(d.key); continue; }
    const a = answersByKey.get(d.key).get(tier);
    // A model tier in a k-sample judge is charged k answers (one was asked: K = 1); a rule or memo answer once.
    const k = ['rule', 'memo'].includes(tier) ? 1 : (a.samples ?? 1);
    judgeUsd += (a.costUsd ?? 0) * k; latencyMs += a.latencyMs ?? 0;
    if (fellBack.has(d.key)) { judgeUsd += refCost(d.key); latencyMs += refLatency(d.key); }
  }
  const deoptUsd = outcome === 'deopt' || outcome === 'crash' ? (interpreterUsd ?? 0) : 0;
  return { status: 'measured', outcome, basePass: base.pass, pass: outcome === 'unmeasured' ? null : (outcome === 'same' || outcome === 'changed' ? base.pass : outcome === 'flip' ? !base.pass : false),
    direction: outcome === 'flip' ? (base.pass ? 'pass->fail' : 'fail->pass') : null, assigned: assigned.length, served: serve.size,
    fellBack: Object.fromEntries([...new Set(fellBack.values())].map(v => [v, [...fellBack.values()].filter(x => x === v).length])), escalationRounds: rounds,
    judgeUsd, refUsd, deoptUsd, latencyMs, refLatencyMs, misses: run.memo?.misses ?? null, deopt: run.deopt?.kind ?? null };
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
  let assignments;
  if (flag('--each')) {
    const pairs = [...new Set(answers.map(a => `${a.site}\0${a.tier}`))].sort();
    assignments = pairs.map(p => { const [site, tier] = p.split('\0'); return { name: `${site}@${tier}`, map: { [site]: tier } }; });
  } else assignments = parseAssign(opt('--assign'));
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
