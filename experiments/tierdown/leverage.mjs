#!/usr/bin/env node
// Judge leverage by $0 counterfactual replay (A10 / #42; dossier research/tierdown-20261021/DOSSIER.md §4 item 1).
//
// For every archived compiled answer (archive.mjs: dev arms only):
//   1. Fidelity gate. Replay it under the flow its solver was written for and under the hooked flow (flow-v2: version-1
//      solvers have no override hook), both on a STRICT memo of that run's journal. Faithful = both ran with zero misses,
//      the two outputs are identical, and a delivered compiled answer scores what the archive recorded.
//   2. Inventory. Every judge decision of the faithful replay (one per request key, override.mjs requestKeyOf), with its
//      site (family + judge name, templated names collapsed), tier and original spend (replay.mjs recordingMemoPort).
//   3. Screen. For each decision, a seeded sample of one-at-a-time perturbations (perturb.mjs) is served through the
//      override for that request (every tier and sample); every other judge is served from the journal. Outcomes:
//        same        output identical to the base replay (the code absorbed the change)
//        changed     output differs, oracle verdict unchanged
//        flip        oracle verdict changed (pass->fail or fail->pass, reported apart)
//        deopt       the solver refused (a check, guard or invariant caught it: the stream falls back to the interpreter)
//        crash       the solver crashed or returned an invalid output (the stream also falls back)
//        unmeasured  a later judge's request changed, so the journal cannot answer it (REPLAY_MISS; never paid)
//   4. Spend. Each site's original spend split by phase (delivery from the replays; compile and check from the arm
//      journal, attributed by the judge's system prompt hash), and the identical-request duplicates per phase.
// Leverage of a site = flips / measured perturbations, with a two-sided 95% Clopper-Pearson interval; rank = leverage x
// share of judge spend. Development evidence only: these are synthetic errors, not a cheaper tier's real errors
// (dossier §6 risk 2); the decision is taken on real answers injected end to end (inject.mjs).
//
//   node experiments/tierdown/leverage.mjs [--runs DIR] [--experiments a,b] [--per-decision 3] [--max-decisions 60]
//        [--concurrency 2] [--rows N] [--work DIR] [--out FILE.json] [--md FILE.md]
import path from 'node:path';
import os from 'node:os';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { listArms, journalOf, phaseOf, rowId, versionOf, sha256, DEFAULT_RUNS, DEFAULT_EXPERIMENTS } from './archive.mjs';
import { replayRow } from './replay.mjs';
import { canonical } from './override.mjs';
import { perturbations, samplePerturbations } from './perturb.mjs';
import { clopperPearson } from '../lib/stats-ebed.mjs';
import { runCompiled, createMemoPort } from '../jit/run-compiled.mjs';
import { rowJournal, solverOf } from './archive.mjs';
import { taskOf, bedOf } from './replay.mjs';

// 'vendex-3' -> 'vendex-*', 'extract:DOC-7' -> 'extract:*', 'apply:d1:k' -> 'apply:*'; plain names unchanged.
export function siteNameOf(name) {
  const [head, ...rest] = String(name).split(':');
  const h = head.replace(/-[A-Za-z_]*\d[\w]*$/, '-*');
  return rest.length ? `${h}:*` : h;
}
export const siteIdOf = (family, name) => `${family}/${siteNameOf(name)}`;

export async function pool(items, limit, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => { while (next < items.length) { const i = next++; await fn(items[i], i); } }));
}

// Outcome of one perturbed replay against the base replay.
export function outcomeOf(base, run) {
  if (run.status === 'no-solver') return 'unmeasured';
  if ((run.memo?.misses ?? 0) > 0) return 'unmeasured';
  if (run.status === 'deopt') return 'deopt';
  if (run.status !== 'ok') return 'crash';
  if (canonical(run.output) === canonical(base.output)) return 'same';
  return run.pass === base.pass ? 'changed' : 'flip';
}

// The judge decisions of a base replay: one per request key, with spend joined from the port record.
export function decisionsOf(base, family) {
  const byKey = new Map();
  for (const j of base.judges) {
    if (!j.key) continue;
    if (!byKey.has(j.key)) byKey.set(j.key, { key: j.key, name: j.name, site: siteIdOf(family, j.name), value: j.value, schema: j.schema, tier: j.tier, tiersTried: j.tiersTried, events: 0 });
    byKey.get(j.key).events++;
  }
  for (const d of byKey.values()) {
    const calls = base.calls.filter(c => c.key === d.key);
    d.calls = calls.length; d.origCostUsd = calls.reduce((s, c) => s + (c.origCostUsd ?? 0), 0);
    d.origLatencyMs = calls.reduce((s, c) => s + (c.origLatencyMs ?? 0), 0);
    d.models = [...new Set(calls.map(c => c.modelId))];
    const log = base.log.find(l => l.key === d.key);
    d.sys = log?.sys ?? null; d.sch = log?.sch ?? null;
  }
  return [...byKey.values()];
}

async function replayOriginal({ arm, row, work }) {
  const workdir = path.join(work, `orig-${arm.slug}-${row.idx}`);
  const port = createMemoPort({ journal: rowJournal(arm, row), strict: true });
  try {
    const run = await runCompiled({ solvePath: solverOf(arm, row), task: await taskOf(row), modelPort: port, perTaskUsd: 1, timeoutMs: 10 * 60 * 1000, workdir, familyId: arm.family, flowPath: arm.flows.original, label: 'tierdown-orig' });
    return { status: run.status, output: run.output, misses: port.memo.stats().misses };
  } finally { rmSync(workdir, { recursive: true, force: true }); }
}

// Steps 1-3 for one row.
export async function screenRow({ arm, row, work, perDecision = 3, maxDecisions = 60, log = () => {} }) {
  const id = rowId(arm, row), bed = await bedOf(arm.family);
  if (!solverOf(arm, row)) return { id, status: 'no-solver' };
  const base = await replayRow({ arm, row, flowPath: arm.flows.hooked, work });
  const orig = arm.flows.original === arm.flows.hooked ? { status: base.status, output: base.output, misses: base.memo.misses } : await replayOriginal({ arm, row, work });
  const fidelity = {
    baseStatus: base.status, baseMisses: base.memo?.misses ?? null, origStatus: orig.status, origMisses: orig.misses,
    sameAsOriginalFlow: base.status === 'ok' && orig.status === 'ok' && canonical(base.output) === canonical(orig.output),
    archivedScore: row.score, replayScore: base.score, delivered: row.delivered,
  };
  fidelity.faithful = fidelity.sameAsOriginalFlow && base.memo.misses === 0 && orig.misses === 0 && (row.delivered !== 'compiled' || base.score === row.score);
  const rec = { id, experiment: arm.experiment, arm: arm.slug, idx: row.idx, taskKey: row.taskKey, seed: row.seed, difficulty: row.difficulty, version: versionOf(row),
    family: arm.family, delivered: row.delivered, fidelity, basePass: base.pass, baseScore: base.score, decisions: [], perturbed: [] };
  if (!fidelity.faithful) { rec.status = 'unfaithful'; return rec; }
  rec.status = 'screened';
  rec.decisions = decisionsOf(base, arm.family).map(({ value, schema, ...d }) => ({ ...d, valueSha: sha256(canonical(value)).slice(0, 16) }));
  const decisions = decisionsOf(base, arm.family).slice(0, maxDecisions);
  for (const d of decisions) {
    const all = perturbations(d.value, d.schema), picked = samplePerturbations(all, perDecision, `${id}:${d.key}`);
    for (const p of picked) {
      const run = await replayRow({ arm, row, flowPath: arm.flows.hooked, work, overrideData: { serve: [{ key: d.key, value: p.value }] } });
      const outcome = outcomeOf(base, run);
      rec.perturbed.push({ key: d.key, site: d.site, name: d.name, kind: p.kind, path: p.path, outcome, ...(outcome === 'flip' ? { direction: base.pass ? 'pass->fail' : 'fail->pass' } : {}),
        ...(outcome === 'deopt' ? { deoptKind: run.deopt?.kind ?? null } : {}) });
    }
    rec.decisionsTried = (rec.decisionsTried ?? 0) + 1;
    rec.perturbableLeaves = (rec.perturbableLeaves ?? 0) + all.length;
  }
  log(`${id} ${row.taskKey}: ${rec.decisions.length} decisions, ${rec.perturbed.length} perturbed, flips ${rec.perturbed.filter(p => p.outcome === 'flip').length}`);
  return rec;
}

// Step 4: each site's spend by phase, from the arm journals (compile and check attributed by system prompt hash).
export function spendBySite(arms, recs) {
  const sysToSite = new Map(), out = {};
  for (const r of recs) for (const d of r.decisions ?? []) if (d.sys) sysToSite.set(`${r.family}:${d.sys}`, d.site);
  const add = (site, phase, usd, dup) => {
    out[site] ??= { delivery: 0, check: 0, compile: 0, other: 0, calls: { delivery: 0, check: 0, compile: 0, other: 0 }, duplicateUsd: { check: 0, compile: 0, delivery: 0, other: 0 } };
    out[site][phase] += usd; out[site].calls[phase]++; if (dup) out[site].duplicateUsd[phase] += usd;
  };
  for (const arm of arms) {
    const seen = new Set();
    for (const j of journalOf(arm)) {
      if (!j.ok && !j.costUsd) continue;
      const body = j.request?.body ?? null, phase = phaseOf(String(j.runId));
      const sys = body ? sha256(String(body.system ?? '')).slice(0, 16) : null;
      const site = (sys && sysToSite.get(`${arm.family}:${sys}`)) ?? `${arm.family}/(unattributed)`;
      const dupKey = body ? sha256(canonical([j.modelId, body.system ?? '', body.prompt ?? '', body.schema ?? null])) : null;
      const dup = dupKey ? seen.has(dupKey) : false;
      if (dupKey) seen.add(dupKey);
      add(site, phase, j.costUsd ?? 0, dup);
    }
  }
  return out;
}

const OUTCOMES = ['same', 'changed', 'flip', 'deopt', 'crash', 'unmeasured'];
export function siteTable(recs, spend) {
  const sites = {};
  const totalUsd = Object.values(spend).reduce((s, x) => s + x.delivery + x.check + x.compile, 0);
  const deliveryUsd = Object.values(spend).reduce((s, x) => s + x.delivery, 0);
  for (const r of recs) {
    for (const d of r.decisions ?? []) {
      const s = sites[d.site] ??= { site: d.site, rows: new Set(), decisions: 0, models: new Set(), replayDeliveryUsd: 0, outcomes: Object.fromEntries(OUTCOMES.map(o => [o, 0])), flipsPassFail: 0, flipsFailPass: 0, kinds: {} };
      s.rows.add(r.id); s.decisions++; d.models.forEach(m => s.models.add(m)); s.replayDeliveryUsd += d.origCostUsd;
    }
    for (const p of r.perturbed ?? []) {
      const s = sites[p.site];
      s.outcomes[p.outcome]++;
      if (p.direction === 'pass->fail') s.flipsPassFail++; else if (p.direction === 'fail->pass') s.flipsFailPass++;
      const k = s.kinds[p.kind] ??= { n: 0, flip: 0 }; k.n++; if (p.outcome === 'flip') k.flip++;
    }
  }
  return Object.values(sites).map(s => {
    const measured = OUTCOMES.filter(o => o !== 'unmeasured').reduce((a, o) => a + s.outcomes[o], 0), tried = measured + s.outcomes.unmeasured;
    const flips = s.outcomes.flip, ci = clopperPearson(flips, measured, 'two-sided');
    const sp = spend[s.site] ?? { delivery: 0, check: 0, compile: 0 };
    const siteUsd = sp.delivery + sp.check + sp.compile;
    const leverage = measured ? flips / measured : null, share = totalUsd ? siteUsd / totalUsd : 0;
    return { site: s.site, rows: s.rows.size, decisions: s.decisions, models: [...s.models].sort(), perturbations: tried, measured, coverage: tried ? measured / tried : null,
      outcomes: s.outcomes, flipsPassFail: s.flipsPassFail, flipsFailPass: s.flipsFailPass, leverage, leverageCI: measured ? [ci.lower, ci.upper] : null,
      guarded: measured ? (s.outcomes.deopt + s.outcomes.crash) / measured : null, kinds: s.kinds,
      spendUsd: { delivery: sp.delivery, check: sp.check, compile: sp.compile, total: siteUsd }, spendShare: share, deliveryShare: deliveryUsd ? sp.delivery / deliveryUsd : 0,
      duplicateUsd: sp.duplicateUsd ?? null, rank: leverage == null ? null : leverage * share };
  }).sort((a, b) => (b.rank ?? -1) - (a.rank ?? -1) || b.spendUsd.total - a.spendUsd.total);
}

const f = (x, d = 3) => (x == null ? '—' : Number(x).toFixed(d));
export function markdown({ recs, table, spend }) {
  const faithful = recs.filter(r => r.status === 'screened').length;
  const lines = [`Rows: ${recs.length}; faithful replays: ${faithful}; unfaithful: ${recs.filter(r => r.status === 'unfaithful').map(r => r.id).join(', ') || 'none'}; no solver: ${recs.filter(r => r.status === 'no-solver').length}.`, '',
    '| site | models | rows | decisions | measured / tried | flips (p→f, f→p) | leverage [95% CI] | guarded | delivery $ | check $ | compile $ | share | rank |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const t of table) lines.push(`| ${t.site} | ${t.models.map(m => m.replace('claude-', '').replace('-5-5', '')).join(',')} | ${t.rows} | ${t.decisions} | ${t.measured}/${t.perturbations} | ${t.outcomes.flip} (${t.flipsPassFail}, ${t.flipsFailPass}) | ${f(t.leverage, 2)} [${t.leverageCI ? t.leverageCI.map(x => f(x, 2)).join(', ') : '—'}] | ${f(t.guarded, 2)} | ${f(t.spendUsd.delivery, 2)} | ${f(t.spendUsd.check, 2)} | ${f(t.spendUsd.compile, 2)} | ${f(t.spendShare, 3)} | ${f(t.rank, 4)} |`);
  const un = Object.entries(spend).filter(([k]) => k.endsWith('(unattributed)'));
  if (un.length) lines.push('', `Unattributed judge spend (system prompts never seen in a faithful delivery replay): ${un.map(([k, v]) => `${k} delivery ${f(v.delivery, 2)}, check ${f(v.check, 2)}, compile ${f(v.compile, 2)}`).join('; ')}.`);
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2), opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const runs = opt('--runs', DEFAULT_RUNS), experiments = (opt('--experiments') ?? DEFAULT_EXPERIMENTS.join(',')).split(',');
  const perDecision = Number(opt('--per-decision', 3)), maxDecisions = Number(opt('--max-decisions', 60)), concurrency = Number(opt('--concurrency', 2));
  const work = opt('--work') ?? mkdtempSync(path.join(os.tmpdir(), 'tierdown-leverage-')), out = opt('--out'), md = opt('--md'), limit = opt('--rows') ? Number(opt('--rows')) : Infinity;
  mkdirSync(work, { recursive: true });
  const arms = listArms({ runs, experiments });
  const jobs = arms.flatMap(arm => arm.rows.map(row => ({ arm, row }))).slice(0, limit);
  console.error(`${jobs.length} archived compiled answers in ${arms.length} arms`);
  const recs = new Array(jobs.length), t0 = Date.now();
  await pool(jobs, concurrency, async ({ arm, row }, i) => {
    try { recs[i] = await screenRow({ arm, row, work, perDecision, maxDecisions, log: m => console.error(`[${Math.round((Date.now() - t0) / 1000)}s] ${m}`) }); }
    catch (e) { recs[i] = { id: rowId(arm, row), status: 'error', error: String(e.stack ?? e).slice(0, 600) }; console.error(`${rowId(arm, row)}: ${e.message}`); }
  });
  const spend = spendBySite(arms, recs), table = siteTable(recs, spend);
  const result = { tool: 'experiments/tierdown/leverage.mjs', modelCalls: 0, evidence: 'development (archived dev streams; synthetic perturbations)', runs: path.relative(process.cwd(), runs) || runs,
    experiments, perDecision, maxDecisions, rows: recs, spend, sites: table };
  if (out) { mkdirSync(path.dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(result, null, 1)); }
  const text = markdown({ recs, table, spend });
  if (md) writeFileSync(md, text + '\n');
  console.log(text);
  if (!opt('--work')) rmSync(work, { recursive: true, force: true });
}
