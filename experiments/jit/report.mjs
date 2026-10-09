// Per-arm report for a JIT stream run (SPEC §7): success with Wilson CI, dollars, cumulative curves, steady state over
// the last half, JIT event counts, delivered-by, break-even against each agent arm. Reads every arm directory's
// results.jsonl / events.jsonl / faults.jsonl (arms run as separate processes) and writes report.md + report.json.
// CLI: node experiments/jit/report.mjs <runDir>
import path from 'node:path';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { wilson } from '../lib/stats.mjs';

export const NOISE_SUCCESSES = 3;   // SPEC §7: with K=1 per stream, any gap under 3 points is noise
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
const r4 = x => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e4) / 1e4);
const usd = x => (x == null || !Number.isFinite(x) ? '–' : `$${x.toFixed(x < 10 ? 3 : 2)}`);
const pct = x => (x == null || !Number.isFinite(x) ? '–' : `${(100 * x).toFixed(1)}%`);
const count = (xs, f) => xs.reduce((m, x) => { const k = f(x); if (k != null) m[k] = (m[k] ?? 0) + 1; return m; }, {});

export function loadRun(runDir) {
  const arms = [];
  for (const d of readdirSync(runDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const dir = path.join(runDir, d.name);
    if (!existsSync(path.join(dir, 'results.jsonl')) && !existsSync(path.join(dir, 'arm.json'))) continue;
    const meta = existsSync(path.join(dir, 'arm.json')) ? JSON.parse(readFileSync(path.join(dir, 'arm.json'), 'utf8')) : { slug: d.name };
    const rows = readJsonl(path.join(dir, 'results.jsonl'));
    // A resumed row replaces nothing (finished rows are skipped), but keep the last one per idx defensively.
    const byIdx = new Map(rows.map(r => [r.idx, r]));
    arms.push({ dir, meta, rows: [...byIdx.values()].sort((a, b) => a.idx - b.idx), events: readJsonl(path.join(dir, 'events.jsonl')), faults: readJsonl(path.join(dir, 'faults.jsonl')) });
  }
  return arms.sort((a, b) => (a.meta.spec ?? a.meta.slug).localeCompare(b.meta.spec ?? b.meta.slug));
}

// Uncertainty flags (JIT v2, opt-in). Shadows are grouped by why they ran: row.shadowReason ('schedule' | 'flag' |
// 'schedule+flag', with jit.shadowOnFlags), or 'schedule' for a shadowed row without one (shadowOnFlags off: every shadow
// is a scheduled one). Measured against the shadow (the system's own view, no oracle):
// - flag rate: flagged runs / compiled ok runs;
// - the scheduled sample (unbiased: every shadowEvery-th compiled ok run, flagged or not), split into flagged and unflagged
//   runs; the unflagged disagreement rate is the base rate, and recall = flagged disagreements / all its disagreements;
// - precision: the disagreement rate of the flag-triggered shadows (reason 'flag' or 'schedule+flag');
// - the cost of the extra shadows flags caused (reason 'flag' only: shadow + adjudicator dollars).
// The oracle columns (pass among flagged vs unflagged compiled runs) are the experimenter's view, never the system's; they
// score the compiled answer (row.compiledPass where an adjudicated answer replaced it), not the delivered one.
// null when the arm is not a v2 arm (opts.enabled) and has neither flags nor shadow reasons, so v1 reports are unchanged.
export function flagSummary(rows, { enabled = false } = {}) {
  const isFlagged = r => (r.flags?.count ?? 0) > 0;
  const flagged = rows.filter(isFlagged);
  if (!enabled && !flagged.length && !rows.some(r => r.shadowReason)) return null;
  const has = (r, kind) => (r.events ?? []).some(e => e.kind === kind);
  const reasonOf = r => r.shadowReason ?? (has(r, 'shadow') || has(r, 'shadow-fault') ? 'schedule' : null);
  const shadowOf = r => (r.events ?? []).find(e => e.kind === 'shadow');
  const group = rs => {
    const answered = rs.filter(r => shadowOf(r) && shadowOf(r).agree != null), disagreements = rs.filter(r => has(r, 'disagree')).length;
    return { shadows: rs.filter(r => shadowOf(r)).length, answered: answered.length, disagreements, regressions: rs.filter(r => has(r, 'regression')).length,
      disagreeRate: answered.length ? r4(disagreements / answered.length) : null,
      costUsd: r4(rs.reduce((s, r) => s + (r.costBreakdown?.shadow ?? 0) + (r.costBreakdown?.adjudicator ?? 0), 0)) };
  };
  const byName = {};
  for (const r of flagged) for (const n of r.flags.names ?? []) byName[n] = (byName[n] ?? 0) + 1;
  const compiledOk = rows.filter(r => r.compiledStatus === 'ok'), unflagged = compiledOk.filter(r => !isFlagged(r));
  const sched = rows.filter(r => /schedule/.test(reasonOf(r) ?? '')), flagTriggered = group(rows.filter(r => /flag/.test(reasonOf(r) ?? '')));
  const scheduled = { ...group(sched), flagged: group(sched.filter(isFlagged)), unflagged: group(sched.filter(r => !isFlagged(r))) };
  const compiledPass = r => (r.delivered === 'compiled' ? !!r.pass : r.compiledPass);   // undefined: not scored (no compiledPass)
  const oracleOf = rs => ({ runs: rs.length, compiledPass: rs.filter(r => compiledPass(r) === true).length, scored: rs.filter(r => compiledPass(r) !== undefined).length,
    notDelivered: rs.filter(r => r.delivered !== 'compiled').length });
  const flagOnly = rows.filter(r => reasonOf(r) === 'flag');
  return {
    flaggedRuns: flagged.length, flagsRaised: flagged.reduce((s, r) => s + r.flags.count, 0), runsByFlagName: byName,
    compiledOk: compiledOk.length, flagRate: compiledOk.length ? r4(flagged.length / compiledOk.length) : null,
    scheduled, baseRate: scheduled.unflagged.disagreeRate,
    recall: scheduled.disagreements ? r4(scheduled.flagged.disagreements / scheduled.disagreements) : null,
    flagTriggered, flagPrecision: flagTriggered.disagreeRate, flagOnly: flagOnly.length, flagOnlyCostUsd: group(flagOnly).costUsd,
    oracle: { flagged: oracleOf(flagged), unflagged: oracleOf(unflagged) },
  };
}

// JIT v2.1 (opt-in): per compile attempt, the comparison its host check used and its acceptance rule and criteria, from the
// compile-attempt events (compactCheck carries checkTraces.compare and checkTraces.acceptance only when non-default) and
// the arm definition. Shadows of a tolerant arm (jit.compare 'tolerant') also count the agreements that held only
// tolerantly (canonicalAgree false). null when the arm uses neither option, so default reports are unchanged.
export function compileSettings({ meta, rows, events }) {
  const def = meta.def ?? {}, dc = def.compile ?? {}, dj = def.jit ?? {};
  const attempts = events.filter(e => e.kind === 'compile-attempt' && e.result).map(e => ({ idx: e.idx, ...e.result }))
    .filter(a => a.checkTraces?.compare || a.checkTraces?.acceptance);
  const shadows = rows.flatMap(r => (r.events ?? []).filter(e => e.kind === 'shadow' && 'canonicalAgree' in e));
  const configured = dc.compare === 'tolerant' || dc.acceptance === 'strict' || dj.compare === 'tolerant';
  if (!configured && !attempts.length && !shadows.length) return null;
  const tol = o => (o?.compare === 'tolerant' || o?.mode === 'tolerant' ? { mode: 'tolerant', relTol: o.relTol ?? null, absTol: o.absTol ?? null } : { mode: o?.compare ?? o?.mode ?? 'canonical' });
  return {
    config: { compileCompare: tol(dc), acceptance: dc.acceptance ?? 'named', ...(dc.acceptance === 'strict' ? { minPartial: dc.minPartial ?? null } : {}), jitCompare: tol(dj) },
    attempts: attempts.map(a => {
      const ct = a.checkTraces, acc = ct.acceptance;
      return { idx: a.idx, version: a.version, builderModel: a.builderModel, compare: ct.compare ?? { mode: 'canonical' }, exact: ct.exact, labeled: ct.labeled,
        canonicalExact: ct.canonicalExact ?? null, partial: ct.partial, clean: ct.clean, accepted: ct.accepted, unexplained: ct.unexplained ?? [],
        acceptance: acc ? { mode: acc.mode, minPartial: acc.criteria?.agreement?.minPartial ?? null, tracePartial: acc.criteria?.agreement?.partial ?? null,
          exactTraces: acc.criteria?.agreement?.exactTraces ?? null, passed: acc.passed ?? [], failed: acc.failed ?? [] } : { mode: 'named' } };
    }),
    shadows: shadows.length ? { tolerant: shadows.length, agreeTolerantOnly: shadows.filter(e => e.agree === true && e.canonicalAgree === false).length } : null,
  };
}

export function summarizeArm({ meta, rows, events, faults }) {
  const spec = meta.spec ?? rows[0]?.arm ?? meta.slug, kind = meta.kind ?? rows[0]?.kind ?? spec.split(':')[0];
  const n = rows.length, successes = rows.filter(r => r.pass).length;
  const billed = new Set(rows.flatMap(r => r.spendIds ?? []));
  // Spend of attempts that never finished a row (a crash or fault at the end of a run): counted, never dropped.
  const unbilledUsd = events.filter(e => e.kind === 'spend' && !billed.has(e.id)).reduce((s, e) => s + (e.costUsd ?? 0), 0);
  const rowsUsd = rows.reduce((s, r) => s + (r.costUsd ?? 0), 0), totalUsd = rowsUsd + unbilledUsd;
  const maxIdx = rows.length ? Math.max(...rows.map(r => r.idx)) : -1;
  const at = new Map(rows.map(r => [r.idx, r]));
  const curve = [];
  let cumUsd = 0, cumPass = 0;
  for (let i = 0; i <= maxIdx; i++) {
    const r = at.get(i);
    if (r) { cumUsd += r.costUsd ?? 0; cumPass += r.pass ? 1 : 0; }
    curve.push({ idx: i, done: !!r, pass: r ? !!r.pass : null, costUsd: r ? r4(r.costUsd) : null, cumUsd: r4(cumUsd), cumSuccesses: cumPass });
  }
  const half = Math.ceil((maxIdx + 1) / 2), last = rows.filter(r => r.idx >= half);
  const ev = rows.flatMap(r => (r.events ?? []).map(e => ({ ...e, idx: r.idx })));
  const breakdown = {};
  for (const r of rows) for (const [k, v] of Object.entries(r.costBreakdown ?? {})) breakdown[k] = r4((breakdown[k] ?? 0) + v);
  const ci = wilson(successes, n);
  const out = {
    spec, slug: meta.slug ?? rows[0]?.armSlug, kind, tasks: n, successes, successRate: n ? successes / n : null, ci: { lo: r4(ci.lo), hi: r4(ci.hi) },
    totalUsd: r4(totalUsd), rowsUsd: r4(rowsUsd), unbilledUsd: r4(unbilledUsd), usdPerSuccess: successes ? r4(totalUsd / successes) : null, usdPerTask: n ? r4(totalUsd / n) : null,
    costUnknownRows: rows.filter(r => r.costUnknown).length, costBreakdown: breakdown,
    steadyState: { fromIdx: half, tasks: last.length, successes: last.filter(r => r.pass).length, successRate: last.length ? r4(last.filter(r => r.pass).length / last.length) : null,
      usdPerTask: last.length ? r4(last.reduce((s, r) => s + (r.costUsd ?? 0), 0) / last.length) : null },
    deliveredBy: count(rows, r => r.delivered),
    counts: {
      compiles: ev.filter(e => e.kind === 'compile' || e.kind === 'recompile').length, recompiles: ev.filter(e => e.kind === 'recompile').length,
      compileAttempts: ev.filter(e => e.kind === 'compile-attempt' || e.kind === 'compile-reused').length, fallbackCompiles: ev.filter(e => e.kind === 'fallback-compile').length,
      compileFailed: ev.filter(e => e.kind === 'compile-failed').length, rejected: ev.filter(e => e.kind === 'rejected').length, voided: ev.filter(e => e.kind === 'void').length,
      deoptsByKind: count(ev.filter(e => e.kind === 'deopt'), e => e.deoptKind ?? 'unknown'),
      crashes: ev.filter(e => e.kind === 'crash').length, timeouts: ev.filter(e => e.kind === 'timeout').length, invalid: ev.filter(e => e.kind === 'invalid').length,
      noVersion: ev.filter(e => e.kind === 'no-version').length,
      shadows: ev.filter(e => e.kind === 'shadow').length, disagreements: ev.filter(e => e.kind === 'disagree').length,
      adjudications: count(ev.filter(e => e.kind === 'adjudicate'), e => e.outcome), regressions: ev.filter(e => e.kind === 'regression').length,
      unresolved: ev.filter(e => e.kind === 'unresolved').length, faultRetries: ev.filter(e => e.kind === 'fault-retry').length,
      faults: faults.length, nestedModelAttempts: ev.reduce((s, e) => s + (e.nestedModelAttempts ?? 0), 0), hiddenPathAttempts: ev.reduce((s, e) => s + (e.hiddenPathAttempts ?? 0), 0),
    },
    versions: [...new Set(rows.map(r => r.version).filter(v => v != null))],
    curve,
  };
  // A v2 arm (arm.json def: jit.shadowOnFlags or compile.promptVersion >= 2) always gets a summary, so one that never flags shows 0.
  const flags = flagSummary(rows, { enabled: !!(meta.def?.jit?.shadowOnFlags || (meta.def?.compile?.promptVersion ?? 1) >= 2) });
  if (flags) out.flags = flags;
  const settings = compileSettings({ meta, rows, events });
  if (settings) out.compileSettings = settings;
  return out;
}

// Break-even against a reference arm: the first index from which this arm's cumulative cost stays at or below the
// reference's (observed, over indices both finished), plus a linear projection from the last-half per-task costs.
export function breakEven(a, ref) {
  const shared = a.curve.filter(p => p.done && ref.curve[p.idx]?.done).map(p => p.idx);
  if (!shared.length) return { observedIdx: null, projectedIdx: null, note: 'no shared tasks' };
  // Cumulative over shared indices only (an index one arm has not finished is left out of both).
  let ca = 0, cr = 0;
  const diffs = shared.map(i => { ca += a.curve[i].costUsd ?? 0; cr += ref.curve[i].costUsd ?? 0; return { idx: i, d: ca - cr }; });
  let observedIdx = null;
  for (let k = diffs.length - 1; k >= 0 && diffs[k].d <= 1e-9; k--) observedIdx = diffs[k].idx;
  const sa = a.steadyState.usdPerTask, sr = ref.steadyState.usdPerTask, gap = diffs.at(-1).d;
  let projectedIdx = null, note = null;
  if (observedIdx != null) note = 'reached';
  else if (sa != null && sr != null && sa < sr) { projectedIdx = Math.ceil(shared.at(-1) + gap / (sr - sa)); note = 'projected from last-half $/task (an extrapolation, not a measurement)'; }
  else note = 'not reached; last-half $/task is not lower';
  return { observedIdx, projectedIdx, cumGapUsd: r4(gap), note };
}

export function buildReport(runDir, { arms = loadRun(runDir) } = {}) {
  const sums = arms.map(summarizeArm);
  const agents = sums.filter(s => s.kind === 'agent');
  for (const s of sums) {
    s.breakEven = Object.fromEntries(agents.filter(a => a !== s).map(a => [a.spec, breakEven(s, a)]));
    s.vsAgents = Object.fromEntries(agents.filter(a => a !== s).map(a => {
      const d = s.successes - a.successes;
      return [a.spec, { successGap: d, successRateGap: s.tasks && a.tasks ? r4(s.successRate - a.successRate) : null, noise: Math.abs(d) < NOISE_SUCCESSES || s.tasks !== a.tasks }];
    }));
  }
  const rows0 = arms.flatMap(a => a.rows);
  const split = rows0[0]?.taskKey?.split(':')[1] ?? null;
  return {
    experiment: rows0[0]?.experiment ?? path.basename(runDir), runDir, generatedAt: new Date().toISOString(), split,
    evidence: split === 'test' ? 'held-out stream (test split)' : 'development / diagnostic (not held-out evidence)',
    noiseRule: `K=1 stream per arm: any success gap under ${NOISE_SUCCESSES} points (tasks) is noise; arms with different task counts are not compared.`,
    arms: sums,
  };
}

export function renderMarkdown(rep) {
  const L = [];
  const short = s => s.replace(/^static:.*\/([^/]+)\/solve\.mjs$/, 'static:$1');
  L.push(`# JIT stream report: ${rep.experiment}`, '', `Generated ${rep.generatedAt}. Evidence: **${rep.evidence}**.`, '', `> ${rep.noiseRule}`, '');
  L.push('## Arms', '', '| arm | n | success | 95% CI (Wilson) | total $ | $/success | $/task | last half (success, $/task) | delivered by |', '|---|---|---|---|---|---|---|---|---|');
  for (const a of rep.arms) {
    L.push(`| ${short(a.spec)} | ${a.tasks} | ${a.successes}/${a.tasks} (${pct(a.successRate)}) | ${pct(a.ci.lo)}–${pct(a.ci.hi)} | ${usd(a.totalUsd)}${a.unbilledUsd ? ` (incl. ${usd(a.unbilledUsd)} unfinished attempts)` : ''} | ${usd(a.usdPerSuccess)} | ${usd(a.usdPerTask)} | ${a.steadyState.successes}/${a.steadyState.tasks} (${pct(a.steadyState.successRate)}), ${usd(a.steadyState.usdPerTask)} | ${Object.entries(a.deliveredBy).map(([k, v]) => `${k} ${v}`).join(', ')} |`);
  }
  L.push('', '## Cost breakdown ($)', '', '| arm | ' + 'components |', '|---|---|');
  for (const a of rep.arms) L.push(`| ${short(a.spec)} | ${Object.entries(a.costBreakdown).map(([k, v]) => `${k} ${usd(v)}`).join(', ') || '–'} |`);
  const jit = rep.arms.filter(a => a.kind !== 'agent');
  if (jit.length) {
    L.push('', '## Compiled-path events', '', '| arm | compiles (recompiles) | attempts / Opus fallbacks | rejected | failed | deopts by kind | crashes | timeouts | invalid | shadows | disagreements | adjudicated | regressions | unresolved | faults |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const a of jit) {
      const c = a.counts;
      L.push(`| ${short(a.spec)} | ${c.compiles} (${c.recompiles}) | ${c.compileAttempts} / ${c.fallbackCompiles} | ${c.rejected} | ${c.compileFailed} | ${Object.entries(c.deoptsByKind).map(([k, v]) => `${k} ${v}`).join(', ') || '0'} | ${c.crashes} | ${c.timeouts} | ${c.invalid} | ${c.shadows} | ${c.disagreements} | ${Object.entries(c.adjudications).map(([k, v]) => `${k} ${v}`).join(', ') || '0'} | ${c.regressions} | ${c.unresolved} | ${c.faults} |`);
    }
  }
  const flagged = rep.arms.filter(a => a.flags);
  if (flagged.length) {
    const rate = g => `${g.disagreements}/${g.answered}${g.answered ? ` (${pct(g.disagreeRate)})` : ''}`;
    const cell = k => String(k).replace(/[|\r\n]/g, ' ');   // flag names come from the solver
    const oracle = o => `${o.compiledPass}/${o.scored}${o.scored < o.runs ? ` (${o.runs - o.scored} unscored)` : ''}`;
    L.push('', '## Uncertainty flags and flag-triggered shadows', '',
      'Shadows are grouped by why they ran: scheduled (every shadowEvery-th compiled ok run, flagged or not, so an unbiased sample) or flag-triggered (jit.shadowOnFlags); a run both scheduled and flagged counts in both. Disagreement is with the shadow, not the oracle. Base rate = disagreement rate of unflagged runs in the scheduled sample; recall = share of the scheduled disagreements whose run was flagged; precision = disagreement rate of the flag-triggered shadows. Flag-only shadows are the extra ones flags caused (their shadow and adjudicator dollars). The oracle column is the experimenter\'s view only: the compiled answer\'s pass rate (compiledPass where an adjudicated answer replaced it). Prompt version 2 also sends near-threshold cases to a judge (item 6), so a gap between a v1 and a v2 arm mixes that change with flags; compare flagged and unflagged runs within an arm.', '',
      '| arm | flagged runs / compiled ok (flag rate), flags | scheduled shadows | scheduled disagree: flagged / unflagged (base rate) | recall of flags | flag-triggered shadows (flag-only, $) | flag-triggered disagree (precision) | regressions from flags | oracle, compiled answer: flagged / unflagged | flags by name (runs) |', '|---|---|---|---|---|---|---|---|---|---|');
    for (const a of flagged) {
      const f = a.flags, noSample = !f.scheduled.answered;
      L.push(`| ${short(a.spec)} | ${f.flaggedRuns}/${f.compiledOk} (${pct(f.flagRate)}), ${f.flagsRaised} | ${f.scheduled.shadows} | ${noSample ? 'no base rate, recall not measurable (no answered scheduled shadow)' : `${rate(f.scheduled.flagged)} / ${rate(f.scheduled.unflagged)}`} | ${f.recall == null ? '–' : pct(f.recall)} | ${f.flagTriggered.shadows} (${f.flagOnly}, ${usd(f.flagOnlyCostUsd)}) | ${rate(f.flagTriggered)} | ${f.flagTriggered.regressions} | ${oracle(f.oracle.flagged)}, ${oracle(f.oracle.unflagged)} | ${Object.entries(f.runsByFlagName).map(([k, v]) => `${cell(k)} ${v}`).join(', ') || '–'} |`);
    }
  }
  const tuned = rep.arms.filter(a => a.compileSettings);
  if (tuned.length) {
    const cmp = c => (c?.mode === 'tolerant' ? `tolerant (rel ${c.relTol}, abs ${c.absTol})` : c?.mode ?? 'canonical');
    L.push('', '## Comparison and acceptance (non-default)', '',
      'Shown only for arms with compile.compare, compile.acceptance or jit.compare set. Exact and partial are under the compile\'s comparison; canonical exact is the same cases under canonical JSON. Strict acceptance: clean, then (trace mean partial >= minPartial or one exact trace), then every diff case explained by a quote verbatim from its own task.', '');
    for (const a of tuned) {
      const s = a.compileSettings;
      L.push(`- ${short(a.spec)}: compile comparison ${cmp(s.config.compileCompare)}, acceptance ${s.config.acceptance}${s.config.minPartial != null ? ` (minPartial ${s.config.minPartial})` : ''}, shadow comparison ${cmp(s.config.jitCompare)}`
        + (s.shadows ? `; tolerant shadows ${s.shadows.tolerant}, of which agreeing only within tolerance ${s.shadows.agreeTolerantOnly}` : '') + '.');
    }
    const att = tuned.flatMap(a => a.compileSettings.attempts.map(x => ({ a, x })));
    if (att.length) {
      L.push('', '| arm | idx | version (builder) | comparison | exact / labelled (canonical exact) | mean partial | acceptance | passed | failed | unexplained | accepted |', '|---|---|---|---|---|---|---|---|---|---|---|');
      for (const { a, x } of att) {
        const acc = x.acceptance;
        L.push(`| ${short(a.spec)} | ${x.idx} | v${x.version} (${x.builderModel}) | ${cmp(x.compare)} | ${x.exact ?? '–'}/${x.labeled ?? '–'}${x.canonicalExact != null ? ` (${x.canonicalExact})` : ''} | ${x.partial ?? '–'} | ${acc.mode}${acc.mode === 'strict' ? ` (trace partial ${acc.tracePartial ?? '–'} vs ${acc.minPartial}, exact traces ${acc.exactTraces})` : ''} | ${acc.passed?.join(', ') || '–'} | ${acc.failed?.join(', ') || '–'} | ${x.unexplained.join(', ') || '–'} | ${x.accepted ? 'yes' : 'no'} |`);
      }
    }
  }
  const agents = rep.arms.filter(a => a.kind === 'agent');
  if (agents.length && rep.arms.length > 1) {
    L.push('', '## Against each agent arm', '', '| arm | vs | success gap (tasks) | noise? | break-even idx (observed) | projected | cumulative $ gap |', '|---|---|---|---|---|---|---|');
    for (const a of rep.arms) for (const [ref, be] of Object.entries(a.breakEven)) {
      const v = a.vsAgents[ref];
      L.push(`| ${short(a.spec)} | ${short(ref)} | ${v.successGap >= 0 ? '+' : ''}${v.successGap} | ${v.noise ? 'noise' : 'no'} | ${be.observedIdx ?? '–'} | ${be.projectedIdx ?? '–'} | ${usd(be.cumGapUsd)} |`);
    }
  }
  const maxN = Math.max(0, ...rep.arms.map(a => a.curve.length));
  if (maxN) {
    L.push('', '## Cumulative curves (successes / $ by task index)', '', `| idx | ${rep.arms.map(a => short(a.spec)).join(' | ')} |`, `|---|${rep.arms.map(() => '---').join('|')}|`);
    for (let i = 0; i < maxN; i++) L.push(`| ${i} | ${rep.arms.map(a => { const p = a.curve[i]; return p?.done ? `${p.cumSuccesses} / ${usd(p.cumUsd)}${p.pass ? '' : ' *'}` : '–'; }).join(' | ')} |`);
    L.push('', '`*` marks a failed task at that index.');
  }
  const integrity = rep.arms.filter(a => a.counts.nestedModelAttempts || a.counts.hiddenPathAttempts || a.counts.voided || a.costUnknownRows);
  if (integrity.length) {
    L.push('', '## Integrity flags', '');
    for (const a of integrity) L.push(`- ${short(a.spec)}: nested model attempts ${a.counts.nestedModelAttempts}, hidden-path attempts ${a.counts.hiddenPathAttempts} (review by hand), voided compiles ${a.counts.voided}, rows with unknown cost ${a.costUnknownRows}.`);
  }
  L.push('');
  return L.join('\n');
}

export function writeReport(runDir) {
  const rep = buildReport(runDir);
  writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(rep, null, 1));
  writeFileSync(path.join(runDir, 'report.md'), renderMarkdown(rep));
  return rep;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir || !existsSync(dir)) { console.error('usage: node experiments/jit/report.mjs <runDir>'); process.exit(2); }
  const rep = writeReport(path.resolve(dir));
  console.log(`report: ${path.join(path.resolve(dir), 'report.md')} (${rep.arms.length} arms)`);
}
