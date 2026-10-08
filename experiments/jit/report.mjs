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
  return {
    spec, slug: meta.slug ?? rows[0]?.armSlug, kind, tasks: n, successes, successRate: n ? successes / n : null, ci: { lo: r4(ci.lo), hi: r4(ci.hi) },
    totalUsd: r4(totalUsd), rowsUsd: r4(rowsUsd), unbilledUsd: r4(unbilledUsd), usdPerSuccess: successes ? r4(totalUsd / successes) : null, usdPerTask: n ? r4(totalUsd / n) : null,
    costUnknownRows: rows.filter(r => r.costUnknown).length, costBreakdown: breakdown,
    steadyState: { fromIdx: half, tasks: last.length, successes: last.filter(r => r.pass).length, successRate: last.length ? r4(last.filter(r => r.pass).length / last.length) : null,
      usdPerTask: last.length ? r4(last.reduce((s, r) => s + (r.costUsd ?? 0), 0) / last.length) : null },
    deliveredBy: count(rows, r => r.delivered),
    counts: {
      compiles: ev.filter(e => e.kind === 'compile' || e.kind === 'recompile').length, recompiles: ev.filter(e => e.kind === 'recompile').length,
      compileAttempts: ev.filter(e => e.kind === 'compile-attempt').length, fallbackCompiles: ev.filter(e => e.kind === 'fallback-compile').length,
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
