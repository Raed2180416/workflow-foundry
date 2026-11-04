#!/usr/bin/env node
// Review 2026-11-04 finding #1, measured at $0: what was `kinetics/prose-events-a@haiku`?
//
// In the kinetics solvers, three judges send ONE identical request (same system, prompt and schema; only the model
// differs): `prose-events-a` and `prose-events-b` (two Haiku readers, asked concurrently) and, when they disagree,
// `prose-events-arbiter` (Opus). Some solver versions instead let each reader escalate to Opus on a failed check. The
// override keys a decision on the request without the model (override.mjs requestKeyOf), so serving one tier answer at
// that key answers all three judges with the same value: the readers agree by construction and the arbiter and the
// escalation never run. The tier (Haiku) is also the readers' own reference tier, so the "tier-down" was really
// "replace the two-reader vote and its arbiter by ONE Haiku read".
//
// This tool measures that single-read policy with K = 3 draws per decision, at $0:
//   draw 1, 2  the two archived Haiku reader answers of the unit (first-tier calls in the archived journal);
//   draw 3     the fresh Haiku answer asked by tier-replay.mjs (answers-{C,H}.jsonl, already paid for).
// Each draw is served to the decision key end to end (inject.mjs injectRow: every other judge at its archived answer, the
// solver's own check rejecting -> fallback to the reference). Deployed single-read cost per draw: the draw's Haiku cost,
// plus the unit's archived Opus cost when the solver's check rejects the draw (the reader's own escalation; the site mean
// when the unit has no archived Opus call). Reference cost: the archived two readers plus arbiter/escalations.
//
//   node experiments/tierdown/readers.mjs --answers A.jsonl,B.jsonl --leverage L.json [--runs DIR] --out readers.json
import path from 'node:path';
import os from 'node:os';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { listArms, rowId, readJsonl, DEFAULT_RUNS, DEFAULT_EXPERIMENTS } from './archive.mjs';
import { replayRow } from './replay.mjs';
import { siteIdOf, pool } from './leverage.mjs';
import { injectRow, eventsByKey } from './inject.mjs';
import { sliceOf } from './tier-replay.mjs';
import { canonical } from './override.mjs';
import { tangoInterval } from './policy.mjs';
import { clopperPearson } from '../lib/stats-ebed.mjs';

export const SITE = 'kinetics/prose-events-a';
const FIRST_TIER = 'claude-haiku-5-5', ESCALATION = 'claude-opus-5-5';

// Single-read deployed cost of one draw: its own cost, plus an escalation when the solver's check rejected it.
export function singleReadCost({ drawUsd, checkRejected, unitOpusUsd, siteOpusUsd }) {
  return drawUsd + (checkRejected ? (unitOpusUsd ?? siteOpusUsd ?? 0) : 0);
}

// Summary over draws: losses (pass -> not pass), gains, check rejections, mean costs; and the same per unit.
export function summarise(draws) {
  const measured = draws.filter(d => d.outcome !== 'unmeasured');
  const loss = measured.filter(d => d.basePass && !d.pass).length, gain = measured.filter(d => !d.basePass && d.pass).length;
  const units = [...new Set(measured.map(d => d.row))];
  const mean = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const perUnit = units.map(u => { const ds = measured.filter(d => d.row === u); return { row: u, refUsd: ds[0].refUsd, singleUsd: mean(ds.map(d => d.singleReadUsd)) }; });
  const refUsd = perUnit.reduce((s, u) => s + u.refUsd, 0), singleUsd = perUnit.reduce((s, u) => s + u.singleUsd, 0);
  return { draws: measured.length, units: units.length, unmeasured: draws.length - measured.length, losses: loss, gains: gain,
    lossUpper95: measured.length ? clopperPearson(loss, measured.length, 'upper', { level: 0.95 }).upper : null,
    checkRejected: measured.filter(d => d.checkRejected).length,
    refUsdPerUnit: units.length ? refUsd / units.length : null, singleReadUsdPerUnit: units.length ? singleUsd / units.length : null,
    saved: refUsd > 0 ? 1 - singleUsd / refUsd : null,
    // Accuracy against the reference with one unit per draw (iid draws, runs of one task included): Tango 90% interval.
    diff: measured.length ? tangoInterval({ b: loss, c: gain, n: measured.length }) : null };
}

async function main() {
  const args = process.argv.slice(2), opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const fresh = (opt('--answers') ?? '').split(',').filter(Boolean).flatMap(f => readJsonl(f)).filter(a => a.site === SITE && a.tier === FIRST_TIER);
  const lev = JSON.parse(readFileSync(opt('--leverage'), 'utf8'));
  const faithful = new Set(lev.rows.filter(r => r.status === 'screened').map(r => r.id));
  const arms = listArms({ runs: opt('--runs', DEFAULT_RUNS), experiments: (opt('--experiments') ?? DEFAULT_EXPERIMENTS.join(',')).split(',') });
  const jobs = arms.flatMap(arm => arm.rows.filter(row => faithful.has(rowId(arm, row))).map(row => ({ arm, row })));
  const work = mkdtempSync(path.join(os.tmpdir(), 'tierdown-readers-')), units = [];
  try {
    await pool(jobs, Number(opt('--concurrency', 2)), async ({ arm, row }) => {
      const id = rowId(arm, row), base = await replayRow({ arm, row, flowPath: arm.flows.hooked, work });
      const events = eventsByKey(base.judges);
      for (const [key, ev] of events) {
        if (siteIdOf(arm.family, ev[0].name) !== SITE) continue;
        const calls = base.calls.filter(c => c.key === key);
        const haiku = calls.filter(c => c.modelId === FIRST_TIER && c.ok !== false), opus = calls.filter(c => c.modelId === ESCALATION);
        const draws = haiku.map((c, i) => ({ draw: `archived-${i + 1}`, value: c.value, costUsd: c.origCostUsd ?? 0, latencyMs: c.origLatencyMs ?? null }));
        const f = fresh.find(a => a.row === id && a.key === key && a.ok);
        if (f) draws.push({ draw: 'fresh', value: f.value, costUsd: f.costUsd ?? 0, latencyMs: f.latencyMs ?? null });
        units.push({ arm, row, id, key, base, events: ev, calls, opusUsd: opus.reduce((s, c) => s + (c.origCostUsd ?? 0), 0) || null, draws,
          readersIdentical: haiku.length >= 2 ? canonical(haiku[0].value) === canonical(haiku[1].value) : null });
      }
    });
    const opusCalls = units.flatMap(u => u.calls.filter(c => c.modelId === ESCALATION));
    const siteOpusUsd = opusCalls.length ? opusCalls.reduce((s, c) => s + (c.origCostUsd ?? 0), 0) / opusCalls.length : null;
    const out = [];
    for (const u of units.sort((a, b) => a.id.localeCompare(b.id))) {
      const refUsd = u.calls.reduce((s, c) => s + (c.origCostUsd ?? 0), 0);
      for (const d of u.draws) {
        const answersByKey = new Map([[u.key, new Map([['draw', { ok: true, value: d.value, costUsd: d.costUsd, latencyMs: d.latencyMs, samples: 1 }]])]]);
        const r = await injectRow({ arm: u.arm, row: u.row, base: u.base, assignment: { name: d.draw, map: { [SITE]: 'draw' } }, answersByKey, work, interpreterUsd: 0 });
        const checkRejected = (r.fellBack?.['check-failed'] ?? 0) > 0;
        out.push({ row: u.id, taskKey: u.row.taskKey, slice: sliceOf(u.row.taskKey), key: u.key.slice(0, 16), draw: d.draw, refEvents: u.events.map(e => `${e.name}@${e.firstTier}`),
          refModels: u.calls.map(c => c.modelId), readersIdentical: u.readersIdentical, basePass: r.basePass, pass: r.pass, outcome: r.outcome, checkRejected,
          refUsd, drawUsd: d.costUsd, singleReadUsd: singleReadCost({ drawUsd: d.costUsd, checkRejected, unitOpusUsd: u.opusUsd, siteOpusUsd }) });
      }
    }
    const res = { tool: 'experiments/tierdown/readers.mjs', modelCalls: 0, site: SITE, evidence: 'development (archived dev runs, C and H slices; the fresh draw was paid in the tier-replay passes)',
      siteOpusUsd, draws: out, summary: { all: summarise(out), C: summarise(out.filter(d => d.slice === 'C')), H: summarise(out.filter(d => d.slice === 'H')) } };
    writeFileSync(opt('--out'), JSON.stringify(res, null, 1));
    console.log(JSON.stringify(res.summary, null, 1));
  } finally { rmSync(work, { recursive: true, force: true }); }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e.stack ?? e); process.exit(1); });
