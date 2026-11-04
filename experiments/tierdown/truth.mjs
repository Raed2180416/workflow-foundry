#!/usr/bin/env node
// Review 2026-11-04 ("cheaper approaches" 1 and 2, and F11), at $0: score the records family's decisive leaf, each
// system's numeric date order, against the bed's GROUND TRUTH instead of against the reference answer.
//
// The records world (beds/records/world.mjs buildWorld(seed, split, difficulty).ctx) holds the task's conventions:
// conv.bd, conv.atlas, conv.vendex ('dmy' | 'mdy') and, at difficulty >= 4, an ATLAS cutoff day after which ATLAS
// numeric dates read the other way. Only dev seeds are built (archive.mjs assertDevRow); no sealed or devCheck path is
// read. Leaves scored:
//   records/date-order    value.{BRIGHTDESK, ATLAS, VENDEX}                     (ATLAS: the order before any cutoff)
//   records/rules         value.date_order.{BRIGHTDESK, ATLAS, VENDEX}          (same)
//   records/source-rules  value.rules.{brightdesk,atlas,vendex}_numeric_dates.value (ATLAS with a cutoff: 'X_then_Y')
// for the reference answer (the archived answer the solver was served, from a $0 replay) and every tier answer in the
// answers files. Then the cascade RESULT §9.2 proposed, from committed data only: at records/date-order, serve the
// rule's answer when the rule and Mercury give identical leaves, else the reference; its task outcome is the injected
// outcome of that served value (inject-{C,H}.json single-pair rows), its cost $0 when they agree.
//
//   node experiments/tierdown/truth.mjs --answers a.jsonl,... --inject inject-C.json,inject-H.json --leverage L.json [--runs DIR] --out truth.json
import path from 'node:path';
import os from 'node:os';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { listArms, rowId, readJsonl, assertDevRow, DEFAULT_RUNS } from './archive.mjs';
import { replayRow } from './replay.mjs';
import { siteIdOf, pool } from './leverage.mjs';
import { sliceOf } from './tier-replay.mjs';
import { canonical } from './override.mjs';
import { buildWorld } from '../../beds/records/world.mjs';

export const SYSTEMS = Object.freeze({ BRIGHTDESK: 'bd', ATLAS: 'atlas', VENDEX: 'vendex' });
const flip = o => (o === 'DMY' ? 'MDY' : 'DMY');

// Ground truth of one dev task: {BRIGHTDESK, ATLAS, VENDEX} orders, and ATLAS's switch form when it has a cutoff.
export function truthOf({ seed, difficulty }, build = buildWorld) {
  const w = build(seed, 'dev', difficulty), conv = w.ctx.conv;
  const t = Object.fromEntries(Object.entries(SYSTEMS).map(([sys, k]) => [sys, String(conv[k]).toUpperCase()]));
  return { ...t, atlasSwitch: w.ctx.cutoff == null ? null : `${t.ATLAS}_then_${flip(t.ATLAS)}` };
}

// The date-order leaves of one answer value at one site: {SYSTEM: order}.
export function leavesOf(site, value) {
  if (!value || typeof value !== 'object') return {};
  if (site === 'records/date-order') return Object.fromEntries(Object.keys(SYSTEMS).filter(s => typeof value[s] === 'string').map(s => [s, value[s]]));
  if (site === 'records/rules') return Object.fromEntries(Object.keys(SYSTEMS).filter(s => typeof value.date_order?.[s] === 'string').map(s => [s, value.date_order[s]]));
  if (site === 'records/source-rules') return Object.fromEntries(Object.keys(SYSTEMS).map(s => [s, value.rules?.[`${s.toLowerCase()}_numeric_dates`]?.value]).filter(([, v]) => typeof v === 'string'));
  return {};
}

// One leaf against the truth: true, false, or null (unscorable). Plain 'DMY' / 'MDY' is compared with the order before
// any cutoff; 'X_then_Y' (source-rules' switch form) with ATLAS's switch (wrong when the task has no switch). Other
// solver-specific labels ('MDY_from_2015', 'MDY_from_cutoff': each compiled solver writes its own enum) have no
// unambiguous reading here and are counted as unscorable, never as right or wrong.
export function leafCorrect(site, sys, got, truth) {
  if (got === 'DMY' || got === 'MDY') return got === truth[sys];
  const m = /^(DMY|MDY)_then_(DMY|MDY)$/.exec(String(got));
  if (m) return sys === 'ATLAS' && truth.atlasSwitch ? got === truth.atlasSwitch : false;
  return null;
}

export function scoreAnswers(items) {
  const by = new Map();
  for (const it of items) {
    const k = `${it.site}\0${it.tier}`, s = by.get(k) ?? { site: it.site, tier: it.tier, decisions: 0, leaves: 0, correct: 0, unscorable: 0, wrongTasks: new Set(), bySystem: {} };
    s.decisions++;
    for (const [sys, got] of Object.entries(it.leaves)) {
      const ok = leafCorrect(it.site, sys, got, it.truth), b = s.bySystem[sys] ??= { leaves: 0, correct: 0 };
      if (ok === null) { s.unscorable++; continue; }
      s.leaves++; b.leaves++; if (ok) { s.correct++; b.correct++; } else s.wrongTasks.add(it.taskKey);
    }
    by.set(k, s);
  }
  return [...by.values()].map(s => ({ ...s, accuracy: s.leaves ? s.correct / s.leaves : null, wrongTasks: [...s.wrongTasks].sort() }))
    .sort((a, b) => a.site.localeCompare(b.site) || a.tier.localeCompare(b.tier));
}

// The agreement cascade at records/date-order, from committed data: rule and Mercury identical -> the rule's answer
// (cost 0, outcome = its injected outcome); otherwise the reference (archived cost and outcome).
export function agreementCascade(decisions, injected) {
  const out = [];
  for (const d of decisions) {
    const rule = d.tiers.rule, merc = d.tiers['mercury-3'];
    const agree = rule?.ok && merc?.ok && canonical(rule.leaves) === canonical(merc.leaves);
    const inj = agree ? injected.get(`records/date-order@rule\0${d.row}`) : null;
    out.push({ row: d.row, taskKey: d.taskKey, slice: d.slice, agree: !!agree, served: agree ? 'rule' : 'reference',
      leavesCorrect: Object.entries(agree ? rule.leaves : d.ref).every(([s, v]) => leafCorrect('records/date-order', s, v, d.truth) === true),
      refLeavesCorrect: Object.entries(d.ref).every(([s, v]) => leafCorrect('records/date-order', s, v, d.truth) === true),
      basePass: inj?.basePass ?? d.basePass, pass: agree ? (inj?.pass ?? null) : d.basePass, usd: agree ? 0 : d.refUsd, refUsd: d.refUsd });
  }
  const n = out.length, m = out.filter(x => x.pass != null);
  return { decisions: n, agree: out.filter(x => x.agree).length, losses: m.filter(x => x.basePass && !x.pass).length, gains: m.filter(x => !x.basePass && x.pass).length,
    leafCorrect: out.filter(x => x.leavesCorrect).length, refLeafCorrect: out.filter(x => x.refLeavesCorrect).length,
    usd: out.reduce((s, x) => s + x.usd, 0), refUsd: out.reduce((s, x) => s + x.refUsd, 0), rows: out };
}

async function main() {
  const args = process.argv.slice(2), opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const SITES = ['records/date-order', 'records/rules', 'records/source-rules'];
  const answers = (opt('--answers') ?? '').split(',').filter(Boolean).flatMap(f => readJsonl(f)).filter(a => SITES.includes(a.site) && a.ok);
  const injected = new Map((opt('--inject') ?? '').split(',').filter(Boolean).flatMap(f => JSON.parse(readFileSync(f, 'utf8')).rows).filter(r => r.status === 'measured').map(r => [`${r.assignment}\0${r.row}`, r]));
  const lev = JSON.parse(readFileSync(opt('--leverage'), 'utf8'));
  const faithful = new Set(lev.rows.filter(r => r.status === 'screened').map(r => r.id));
  const arms = listArms({ runs: opt('--runs', DEFAULT_RUNS), experiments: ['jit-dev-records-1', 'jit-r0-records'] });
  const jobs = arms.flatMap(arm => arm.rows.filter(row => faithful.has(rowId(arm, row))).map(row => ({ arm, row })));
  const work = mkdtempSync(path.join(os.tmpdir(), 'tierdown-truth-')), items = [], dateOrder = [];
  try {
    await pool(jobs, Number(opt('--concurrency', 2)), async ({ arm, row }) => {
      const id = rowId(arm, row), k = assertDevRow(row, arm), truth = truthOf(k), slice = sliceOf(row.taskKey);
      const base = await replayRow({ arm, row, flowPath: arm.flows.hooked, work }), seen = new Set();
      for (const j of base.judges) {
        const site = siteIdOf(arm.family, j.name);
        if (!SITES.includes(site) || !j.key || seen.has(j.key)) continue;
        seen.add(j.key);
        const ref = leavesOf(site, j.value), refUsd = base.calls.filter(c => c.key === j.key).reduce((s, c) => s + (c.origCostUsd ?? 0), 0);
        items.push({ row: id, taskKey: row.taskKey, slice, site, tier: 'reference', leaves: ref, truth });
        const tiers = {};
        for (const a of answers.filter(x => x.row === id && x.key === j.key)) {
          const leaves = leavesOf(site, a.value);
          items.push({ row: id, taskKey: row.taskKey, slice, site, tier: a.tier, leaves, truth });
          tiers[a.tier] = { ok: true, leaves };
        }
        if (site === 'records/date-order') dateOrder.push({ row: id, taskKey: row.taskKey, slice, truth, ref, refUsd, basePass: base.pass, tiers });
      }
    });
  } finally { rmSync(work, { recursive: true, force: true }); }
  const res = { tool: 'experiments/tierdown/truth.mjs', modelCalls: 0, evidence: 'development (archived dev runs, C and H; the rule tier was written from C, so its C rows are in-sample)',
    scores: { all: scoreAnswers(items), C: scoreAnswers(items.filter(i => i.slice === 'C')), H: scoreAnswers(items.filter(i => i.slice === 'H')) },
    cascade: { all: agreementCascade(dateOrder, injected), C: agreementCascade(dateOrder.filter(d => d.slice === 'C'), injected), H: agreementCascade(dateOrder.filter(d => d.slice === 'H'), injected) } };
  writeFileSync(opt('--out'), JSON.stringify(res, null, 1));
  const brief = s => s.map(x => `${x.site} ${x.tier}: ${x.correct}/${x.leaves} (${x.decisions} decisions${x.unscorable ? `, ${x.unscorable} unscorable` : ''})${x.wrongTasks.length ? ' wrong on ' + x.wrongTasks.join(' ') : ''}`);
  console.log(JSON.stringify({ C: brief(res.scores.C), H: brief(res.scores.H), cascade: Object.fromEntries(Object.entries(res.cascade).map(([k, v]) => [k, { ...v, rows: undefined }])) }, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e.stack ?? e); process.exit(1); });
