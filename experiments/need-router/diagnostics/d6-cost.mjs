// D6: cost-meter delta (DESIGN §2 "One cost meter", §7 M0 item 10). The CLI books its own session figure (total_cost_usd); the v1
// label factory re-prices every row from recorded token usage with one pinned table (need-v1-prices@2026-10-14, prereg/stages.json).
// How far apart are the two on archived agent rows, and does the choice of meter move the labels?
//   Check 1  builder sessions of the C0 dev round (constructions.jsonl, 8 rows) record the CLI's FINAL usage, including output tokens and the
//            5-minute / 1-hour split of cache writes. Re-pricing it with the pinned table tests the price formula where the usage is complete.
//   Check 2  agent task sessions (P1 b0agent-haiku, C0 B0-*, JIT agent and interpreter sessions via their committed traces) record only
//            `streamUsage`, the aggregate of per-message usage lines. Its output tokens are a snapshot taken at the start of each message
//            (a few dozen per session against tens of thousands), so a token re-price from it cannot see output. Reported against
//            re-priced, per model, with the output tokens the gap implies.
//   Check 3  direct-call rows: recorded tokens carry no cache fields.
//   Check 4  what the meter does to the labels: agent rows re-priced under each meter, labels recomputed over the whole grid.
// Price variants: p5 = the pinned table, 5-minute cache writes, the session aggregate at one tier (what label-run.priceSession does for
// a session with streamUsage only); p1h = the same with cache writes at the 1-hour rate (2 x input). Policy 2026-10-08.1 set
// FORCE_PROMPT_CACHING_5M=1 (commit 5f145ba, 2026-10-08 20:55 UTC): P1 and the C0 dev round ran before it, the JIT streams (from
// 2026-10-08 23:36 UTC) after it. Check 1 shows which rate the CLI billed before the flag; `pEra` assumes the policy's own account of the
// flag for each session's era (pre-flag 1h, post-flag 5m), which the archive cannot confirm for the post-flag sessions.
// Evidence grade: LEGACY/dev.
import { readJson, quantile, median, mean, sum, round, sourceOf } from './common.mjs';
import { STAGES_FILE } from './census.mjs';
import { needTable, needLabels, GRID, HEADLINE } from '../metrics.mjs';
import { toMatrix, LEGACY_REGISTRY } from './legacy.mjs';

export const priceTable = (file = STAGES_FILE) => readJson(file).priceTable;
/** git log -S FORCE_PROMPT_CACHING_5M policy/models.json: the commit that introduced the 5-minute cache flag. */
export const CACHE_FLAG = Object.freeze({ commit: '5f145ba', at: '2026-10-08T20:55:17Z', source: 'policy/models.json notes (2026-10-08), git log -S' });
export const eraOf = at => (at && at < CACHE_FLAG.at ? 'pre-flag' : at ? 'post-flag' : 'unknown');
const tierOf = (m, promptTokens, low) => (low ? m.tiers[0] : (m.tiers.find(t => t.maxPromptTokens == null || promptTokens <= t.maxPromptTokens) ?? m.tiers.at(-1)));

/**
 * USD for one usage record. u = { input, output, cacheRead, cacheWrite5m, cacheWrite1h } (tokens). opts.low prices every token at the
 * model's lowest tier (a bound for sessions whose per-request prompt size is unknown). null for a model the table does not price.
 */
export function priceTokens(table, model, u, { low = false } = {}) {
  const m = table.models[model];
  if (!m) return null;
  const input = u.input ?? 0, out = u.output ?? 0, cr = u.cacheRead ?? 0, w5 = u.cacheWrite5m ?? 0, w1 = u.cacheWrite1h ?? 0;
  const t = tierOf(m, input + cr + w5 + w1, low);
  return { usd: (input * t.input + out * t.output + cr * t.cacheRead + w5 * t.cacheWrite5m + w1 * 2 * t.input) / 1e6, outPerMTok: t.output, tier: t };
}
const asTokens = su => ({ input: su.inputTokens ?? 0, output: su.outputTokens ?? 0, cacheRead: su.cacheReadTokens ?? 0 });

/** Check 1: the 8 builder sessions with complete usage. */
export function builderCheck(builds, table) {
  const rows = builds.filter(b => b.builderUsage && Number.isFinite(b.builderCostUsd)).map(b => {
    const u = b.builderUsage, cc = u.cache_creation ?? {};
    const w1 = cc.ephemeral_1h_input_tokens ?? 0, w5 = cc.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens ?? 0) - w1);
    const tok = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0 };
    const as5 = priceTokens(table, b.builderModel, { ...tok, cacheWrite5m: w5 + w1 }), real = priceTokens(table, b.builderModel, { ...tok, cacheWrite5m: w5, cacheWrite1h: w1 });
    const asLow5 = priceTokens(table, b.builderModel, { ...tok, cacheWrite5m: w5 + w1 }, { low: true }), realLow = priceTokens(table, b.builderModel, { ...tok, cacheWrite5m: w5, cacheWrite1h: w1 }, { low: true });
    const streamOut = b.builderStreamUsage?.outputTokens ?? null;
    return {
      label: b.label, model: b.builderModel, reportedUsd: round(b.builderCostUsd, 4), p5Usd: round(as5.usd, 4), billedRateUsd: round(real.usd, 4), billedRateLowTierUsd: round(realLow.usd, 4), p5LowTierUsd: round(asLow5.usd, 4),
      ratioReportedOverP5: round(b.builderCostUsd / as5.usd, 3), ratioReportedOverBilledRate: round(b.builderCostUsd / real.usd, 3),
      reportedInBilledRateBracket: b.builderCostUsd >= realLow.usd - 5e-5 && b.builderCostUsd <= real.usd + 5e-5, exactAtBilledRate: Math.abs(b.builderCostUsd / real.usd - 1) < 5e-3 || Math.abs(b.builderCostUsd / realLow.usd - 1) < 5e-3,
      cacheWrite1hShare: w1 + w5 ? round(w1 / (w1 + w5), 3) : null, outputTokensFinal: u.output_tokens ?? 0, outputTokensStreamUsage: streamOut,
      thinkingTokens: u.output_tokens_details?.thinking_tokens ?? null,
    };
  });
  const byModel = {};
  for (const r of rows) { const a = (byModel[r.model] ??= { sessions: 0, reported: 0, p5: 0, billedRate: 0 }); a.sessions += 1; a.reported += r.reportedUsd; a.p5 += r.p5Usd; a.billedRate += r.billedRateUsd; }
  for (const a of Object.values(byModel)) { a.ratioReportedOverP5 = round(a.reported / a.p5, 3); a.ratioReportedOverBilledRate = round(a.reported / a.billedRate, 3); for (const k of ['reported', 'p5', 'billedRate']) a[k] = round(a[k], 4); }
  return { sessions: rows, byModel, inBracket: rows.filter(r => r.reportedInBilledRateBracket).length, exact: rows.filter(r => r.exactAtBilledRate).length, total: rows.length };
}

/** Sessions with streamUsage only: one record per archived agent run. */
export function agentSessions(jobs) {
  const out = [], seen = new Set();
  for (const job of jobs) for (const r of job.allRows) {
    if (!r.streamUsage || !r.model) continue;
    const reported = r.traceCostUsd ?? r.usdReported;
    const key = `${job.id}|${r.arm}|${r.taskKey}|${r.trial}|${r.traceId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ job: job.id, mode: r.mode, arm: r.arm, model: r.model, unit: r.unit, reported, streamUsage: r.streamUsage, turns: r.turns, source: r.source, at: r.at ?? null, era: eraOf(r.at) });
  }
  return out;
}

/** Re-price one session under p5 and p1h and estimate the output tokens the gap implies (p1h minus its output term). */
export function repriceSession(s, table) {
  const t = asTokens(s.streamUsage), w = s.streamUsage.cacheWriteTokens ?? 0;
  const p5 = priceTokens(table, s.model, { ...t, cacheWrite5m: w }), p1h = priceTokens(table, s.model, { ...t, cacheWrite1h: w });
  if (!p5) return null;
  const era = s.era ?? eraOf(s.at);
  const pEra = era === 'pre-flag' ? p1h : p5;
  const implied = base => Math.max(0, (s.reported - priceTokens(table, s.model, { ...t, output: 0, ...base }).usd) / (p1h.outPerMTok / 1e6));
  return { ...s, era, p5: p5.usd, p1h: p1h.usd, pEra: pEra.usd, tier: p1h.tier.maxPromptTokens == null ? 'upper' : 'lower', recordedOutputTokens: t.output,
    impliedOutputTokens: implied({ cacheWrite1h: w }), impliedOutputTokensEra: implied(era === 'pre-flag' ? { cacheWrite1h: w } : { cacheWrite5m: w }) };
}

export function summarise(sessions, keyOf) {
  const by = new Map();
  for (const s of sessions) (by.get(keyOf(s)) ?? by.set(keyOf(s), []).get(keyOf(s))).push(s);
  return [...by].map(([key, v]) => {
    const rep = sum(v.map(x => x.reported)), p5 = sum(v.map(x => x.p5)), p1h = sum(v.map(x => x.p1h)), pe = sum(v.map(x => x.pEra));
    return {
      key, sessions: v.length, reportedUsd: round(rep, 3), p5Usd: round(p5, 3), p1hUsd: round(p1h, 3), pEraUsd: round(pe, 3), ratioReportedOverP5: round(rep / p5, 3), ratioReportedOverP1h: round(rep / p1h, 3), ratioReportedOverEra: round(rep / pe, 3),
      medianSessionRatioOverP1h: round(median(v.map(x => x.reported / x.p1h)), 3), meanRecordedOutputTokens: Math.round(mean(v.map(x => x.recordedOutputTokens))),
      medianImpliedOutputTokens: Math.round(median(v.map(x => x.impliedOutputTokens))), medianImpliedOutputTokensEra: Math.round(median(v.map(x => x.impliedOutputTokensEra))), upperTierShare: round(v.filter(x => x.tier === 'upper').length / v.length, 3),
    };
  }).sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** Check 3: P1 direct calls, whose usage has no cache fields. */
export function directCallCheck(jobs, table, models = { 'direct-H': 'claude-haiku-5-5', 'direct-S': 'claude-sonnet-5-5', 'direct-H-med': 'claude-haiku-5-5' }) {
  const out = [];
  for (const [mode, model] of Object.entries(models)) {
    const rows = jobs.flatMap(j => j.allRows).filter(r => r.mode === mode && r.delivered && Number.isFinite(r.tokensOut) && r.source?.includes('p1/'));
    if (!rows.length) continue;
    const rep = sum(rows.map(r => r.usdReported)), rp = sum(rows.map(r => priceTokens(table, model, { output: r.tokensOut }).usd));
    out.push({ mode, model, rows: rows.length, reportedUsd: round(rep, 3), outputOnlyUsd: round(rp, 3), outputShareOfReported: round(rp / rep, 3) });
  }
  return out;
}

/**
 * Check 4: replace the cost of every agent mode whose rows all have streamUsage by its re-priced value (per row), recompute the NEED
 * labels over the whole grid and count the cells where the label or the best mode changes against the reported meter.
 */
export function meterImpact(jobs, table) {
  const out = [];
  for (const job of jobs) {
    const repriced = new Map();
    for (const mode of new Set(job.rows.map(r => r.mode))) {
      const rs = job.rows.filter(r => r.mode === mode);
      if (rs.length && rs.every(r => r.streamUsage && r.model)) repriced.set(mode, rs);
    }
    if (!repriced.size) continue;
    const variants = {};
    for (const meter of ['reported', 'p5', 'p1h']) {
      const rows = job.rows.map(r => {
        if (meter === 'reported' || !repriced.has(r.mode)) return r;
        const x = repriceSession({ ...r, reported: r.usdReported, streamUsage: r.streamUsage }, table);
        return { ...r, usdReported: meter === 'p5' ? x.p5 : x.p1h };
      });
      const { rows: mr, builds } = toMatrix({ ...job, rows });
      variants[meter] = needLabels(needTable(mr, builds, { registry: LEGACY_REGISTRY }), { cells: GRID, reps: 0 });
    }
    const cmp = meter => {
      const flips = [], tops = [];
      for (const c of GRID) { const a = variants.reported.at(job.id, c), b = variants[meter].at(job.id, c); if (a.label !== b.label) flips.push(c.key); if (a.top !== b.top) tops.push(c.key); }
      return { labelFlips: flips.length, topChanges: tops.length, headlineTop: variants[meter].at(job.id, HEADLINE).top, headlineLabel: variants[meter].at(job.id, HEADLINE).label };
    };
    out.push({ job: job.id, repricedModes: [...repriced.keys()], cells: GRID.length, reported: { headlineTop: variants.reported.at(job.id, HEADLINE).top, headlineLabel: variants.reported.at(job.id, HEADLINE).label }, p5: cmp('p5'), p1h: cmp('p1h') });
  }
  return out;
}

export function runD6(jobs, { constructions = [], table = priceTable(), tableSource = sourceOf(STAGES_FILE) } = {}) {
  const sessions = agentSessions(jobs).map(s => repriceSession(s, table)).filter(Boolean);
  const builder = builderCheck(constructions, table);
  const byModel = summarise(sessions, s => s.model);
  const byModelEra = summarise(sessions, s => `${s.model} | ${s.era}`);
  const groups = summarise(sessions, s => `${s.job} | ${s.mode} | ${s.model}`);
  const impact = meterImpact(jobs, table);
  return {
    id: 'D6', grade: 'LEGACY/dev', question: 'CLI-reported cost against token re-priced cost on archived agent rows', priceTable: table.id, sources: [tableSource],
    builderSessions: builder, agentSessions: { count: sessions.length, byModel, byModelEra, groups }, cacheFlag: CACHE_FLAG, directCalls: directCallCheck(jobs, table), meterImpact: impact,
    summary: {
      sessions: sessions.length, byModel: Object.fromEntries(byModel.map(m => [m.key, { sessions: m.sessions, ratioReportedOverP5: m.ratioReportedOverP5, ratioReportedOverP1h: m.ratioReportedOverP1h, medianImpliedOutputTokens: m.medianImpliedOutputTokens, meanRecordedOutputTokens: m.meanRecordedOutputTokens }])),
      byModelEra: Object.fromEntries(byModelEra.map(m => [m.key, { sessions: m.sessions, ratioReportedOverP5: m.ratioReportedOverP5, ratioReportedOverEra: m.ratioReportedOverEra, medianImpliedOutputTokensEra: m.medianImpliedOutputTokensEra }])),
      builder: { sessions: builder.total, exactAtBilledRate: builder.exact, inBilledRateBracket: builder.inBracket },
      builderRatioOverP5: Object.fromEntries(Object.entries(builder.byModel).map(([m, a]) => [m, a.ratioReportedOverP5])), builderRatioOverBilledRate: Object.fromEntries(Object.entries(builder.byModel).map(([m, a]) => [m, a.ratioReportedOverBilledRate])),
      meterChangesLabels: impact.some(i => i.p5.labelFlips > 0 || i.p1h.labelFlips > 0), jobsAffected: impact.filter(i => i.p5.topChanges > 0 || i.p1h.topChanges > 0).map(i => i.job),
    },
  };
}
