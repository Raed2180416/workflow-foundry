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
// 2026-10-08 23:36 UTC) after it. Check 1 shows which rate the CLI billed before the flag.
//   The billed rate (`pEra`, `ratioReportedOverEra`, `impliedOutputTokensEra`; the names are older than the rule). Each session is priced at the cache-write
//            rate it was BILLED at, not at the rate its era's policy says. The post-flag sessions' own CLI transcripts are listed in analysis/m0/launch-env.json
//            (path = <experiment>/<arm>/<traceId>/.executor-transcript.jsonl), which records the share of their cache writes the CLI billed at the 1-hour rate:
//            every one of them, 336 of 336, 1. D6 used to price all post-flag sessions at p5 on the policy's account (review of 2026-10-15) and so booked the Opus
//            ratio at 2.96x where the sessions' own transcripts give 1.93x. Now: a session joined to its transcript (same model, same reported cost) is priced at
//            its measured share (`rateSource: measured`); one with no transcript at the median measured share of the same model and era, the builder sessions of
//            Check 1 standing in for the pre-flag era (`measured-same-model`); one with neither at the era's policy account (`assumed-by-era`, counted per group).
//   Gate     summary.meterGate (meter-gate.mjs buildMeterGate) turns checks 1 and 2 into a machine-readable flag, `block-until-verified` while the archived usage lines
//            record output tokens far from the CLI's final usage, `insufficient-evidence` while the evidence is too thin to say the meter is right (fewer than
//            MIN_BUILDER_SESSIONS builder sessions, a model the paid arms use with no era group of MIN_ERA_SESSIONS, no launch-environment measurement): label-run
//            refuses a paid agent stage while it is anything but `clear`.
// Evidence grade: LEGACY/dev.
import { readJson, quantile, median, mean, sum, round, sourceOf } from './common.mjs';
import { STAGES_FILE } from './census.mjs';
import { needTable, needLabels, GRID, HEADLINE } from '../metrics.mjs';
import { toMatrix, labelSetsOf, LEGACY_REGISTRY } from './legacy.mjs';
import { buildMeterGate, agentModelsOf } from '../meter-gate.mjs';

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
    out.push({ job: job.id, mode: r.mode, arm: r.arm, model: r.model, unit: r.unit, traceId: r.traceId ?? null, reported, streamUsage: r.streamUsage, turns: r.turns, source: r.source, at: r.at ?? null, era: eraOf(r.at) });
  }
  return out;
}

/** The cache-write rate an unmeasured session is assumed to have been billed at: the policy's account of its era (pre-flag 1-hour, post-flag 5-minute). */
export const eraShare = era => (era === 'pre-flag' ? 1 : 0);

/**
 * Re-price one session under p5 and p1h, and at the rate it was billed at (`pEra`): s.cacheWrite1hShare of its cache writes at the 1-hour rate and the rest at the
 * 5-minute rate when a share is given (joinBilledRate sets it), else the era's policy account (`rateSource: assumed-by-era`). Also estimates the output tokens the gap
 * implies (the reported figure minus the re-price without output, over the output rate).
 */
export function repriceSession(s, table) {
  const t = asTokens(s.streamUsage), w = s.streamUsage.cacheWriteTokens ?? 0;
  const p5 = priceTokens(table, s.model, { ...t, cacheWrite5m: w }), p1h = priceTokens(table, s.model, { ...t, cacheWrite1h: w });
  if (!p5) return null;
  const era = s.era ?? eraOf(s.at);
  const given = Number.isFinite(s.cacheWrite1hShare), share = given ? s.cacheWrite1hShare : eraShare(era);
  const at = { cacheWrite5m: w * (1 - share), cacheWrite1h: w * share };
  const pRate = priceTokens(table, s.model, { ...t, ...at });
  const implied = base => Math.max(0, (s.reported - priceTokens(table, s.model, { ...t, output: 0, ...base }).usd) / (p1h.outPerMTok / 1e6));
  return { ...s, era, p5: p5.usd, p1h: p1h.usd, pEra: pRate.usd, tier: p1h.tier.maxPromptTokens == null ? 'upper' : 'lower', recordedOutputTokens: t.output,
    impliedOutputTokens: implied({ cacheWrite1h: w }), impliedOutputTokensEra: implied(at), cacheWrite1hShare: share, rateSource: given ? (s.rateSource ?? 'given') : 'assumed-by-era' };
}

/** launch-env.json records by <experiment>/<arm>/<traceId> (the three directories above the transcript file); a key two records share is ambiguous and joins nothing. */
export function launchIndex(launchEnv) {
  const idx = new Map();
  for (const t of launchEnv?.transcripts ?? []) {
    const parts = String(t.path).split('/');
    if (parts.length < 4) continue;
    const key = parts.slice(-4, -1).join('/');
    idx.set(key, idx.has(key) ? 'ambiguous' : t);
  }
  return idx;
}
const median3 = xs => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };

/**
 * Give every session the cache-write rate it was billed at. A session joins its CLI transcript (launch-env.json) by experiment/arm/traceId when the transcript's
 * model equals the session's and its reported cost equals the session's within 0.5%: then `cacheWrite1hShare` is the measured share (`rateSource: measured`, with the
 * transcript's path and sha256). A session that joins nothing takes the median measured share of the same model and era (the builder sessions of Check 1 count for the
 * pre-flag era), `rateSource: measured-same-model`, or, with no measurement for its model and era, stays without a share (`assumed-by-era` in repriceSession).
 * Returns { sessions, join: { joined, unjoined: [{reason: n}], ... } } (the sessions are copies).
 */
export function joinBilledRate(sessions, { launchEnv = null, builderSessions = [] } = {}) {
  const idx = launchIndex(launchEnv), reasons = {};
  const noteReason = r => { reasons[r] = (reasons[r] ?? 0) + 1; };
  const out = sessions.map(s => {
    if (!launchEnv) { noteReason('no launch-env measurement'); return { ...s }; }
    if (!s.traceId) { noteReason('no trace id (a session of the archived P1 or C0 rows)'); return { ...s }; }
    const rec = idx.get(`${s.job}/${s.arm}/${s.traceId}`);
    if (!rec) { noteReason('no transcript in launch-env.json'); return { ...s }; }
    if (rec === 'ambiguous') { noteReason('two transcripts share the key'); return { ...s }; }
    if (rec.skipped) { noteReason('transcript has no final usage'); return { ...s }; }
    if (rec.model !== s.model) { noteReason('transcript is another model'); return { ...s }; }
    if (!(Math.abs(rec.reportedUsd - s.reported) <= 0.005 * Math.max(s.reported, 1e-9))) { noteReason('transcript reports another cost'); return { ...s }; }
    if (!(rec.cacheWriteTokens > 0) || !Number.isFinite(rec.cacheWrite1hShare)) { noteReason('transcript records no cache writes or no split of them'); return { ...s }; }
    return { ...s, cacheWrite1hShare: rec.cacheWrite1hShare, rateSource: 'measured', launch: { path: rec.path, sha256: rec.sha256 } };
  });
  // The measured share per model and era: the joined sessions of that group (cache writes > 0) and, before the flag, the builder sessions of Check 1.
  const shares = new Map();
  const add = (key, x) => { if (Number.isFinite(x)) (shares.get(key) ?? shares.set(key, []).get(key)).push(x); };
  for (const s of out) if (s.rateSource === 'measured' && (s.streamUsage?.cacheWriteTokens ?? 0) > 0) add(`${s.model}|${s.era}`, s.cacheWrite1hShare);
  for (const b of builderSessions) add(`${b.model}|pre-flag`, b.cacheWrite1hShare);
  for (let i = 0; i < out.length; i++) {
    const s = out[i];
    if (Number.isFinite(s.cacheWrite1hShare)) continue;
    const m = median3(shares.get(`${s.model}|${s.era}`) ?? []);
    if (m !== null) out[i] = { ...s, cacheWrite1hShare: m, rateSource: 'measured-same-model' };
  }
  return { sessions: out, join: { sessions: out.length, measured: out.filter(s => s.rateSource === 'measured').length, measuredSameModel: out.filter(s => s.rateSource === 'measured-same-model').length, notJoined: reasons } };
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
      meanCacheWrite1hShare: round(mean(v.map(x => x.cacheWrite1hShare)), 3),
      rateSources: Object.fromEntries(['measured', 'measured-same-model', 'assumed-by-era'].map(k => [k, v.filter(x => x.rateSource === k).length])),
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
 * labels over the whole grid and count the cells where the label or the best mode changes against the reported meter. Labels are L_today (the
 * fields at the top of each entry) with L_ceiling beside it for jobs that have ceiling arms (workflows not written by the cheap builder: hand-written,
 * Opus-built, Opus- or Sonnet-compiled, whose authoring or build cost is charged: legacy.mjs). Cells the label factory leaves unlabelled (more than 30% of
 * a contending mode's dollars imputed, DESIGN §2) are reported as such and never counted as a label flip or a best-mode change.
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
    const sets = labelSetsOf(job.pairing.modes);
    const variants = {};
    for (const meter of ['reported', 'p5', 'p1h']) {
      const rows = job.rows.map(r => {
        if (meter === 'reported' || !repriced.has(r.mode)) return r;
        const x = repriceSession({ ...r, reported: r.usdReported, streamUsage: r.streamUsage }, table);
        return { ...r, usdReported: meter === 'p5' ? x.p5 : x.p1h };
      });
      const { rows: mr, builds } = toMatrix({ ...job, rows });
      const tbl = needTable(mr, builds, { registry: LEGACY_REGISTRY });
      variants[meter] = { today: needLabels(tbl, { cells: GRID, reps: 0, modes: sets.today.modes }), ceiling: sets.ceiling ? needLabels(tbl, { cells: GRID, reps: 0, modes: sets.ceiling.modes }) : null };
    }
    // A cell the label factory leaves unlabelled (DESIGN §2: more than 30% of a contending mode's dollars imputed; metrics.needLabels sets `unlabelled`) has no
    // NEED label and no best mode under that meter. It is reported as unlabelled with its reason and counted per meter; a label flip or a best-mode change is
    // counted only on cells labelled under BOTH meters, so a cell whose label rests on imputed dollars never reads as a finding.
    const headOf = e => ({ headlineLabel: e.unlabelled ? 'unlabelled' : e.label, headlineTop: e.unlabelled ? null : e.top, headlineUnlabelled: e.unlabelled ?? null });
    const view = which => {
      const L = meter => variants[meter][which];
      const cmp = meter => {
        const flips = [], tops = []; let comparable = 0, unlabelled = 0;
        for (const c of GRID) {
          const a = L('reported').at(job.id, c), b = L(meter).at(job.id, c);
          if (b.unlabelled) unlabelled += 1;
          if (a.unlabelled || b.unlabelled) continue;
          comparable += 1;
          if (a.label !== b.label) flips.push(c.key);
          if (a.top !== b.top) tops.push(c.key);
        }
        return { labelFlips: flips.length, topChanges: tops.length, comparableCells: comparable, unlabelledCells: unlabelled, ...headOf(L(meter).at(job.id, HEADLINE)) };
      };
      const rep = L('reported'), reportedUnlabelled = GRID.filter(c => rep.at(job.id, c).unlabelled).length;
      return { reported: { unlabelledCells: reportedUnlabelled, ...headOf(rep.at(job.id, HEADLINE)) }, p5: cmp('p5'), p1h: cmp('p1h') };
    };
    out.push({ job: job.id, repricedModes: [...repriced.keys()], cells: GRID.length, ...view('today'), labelSets: { today: sets.today, ceiling: sets.ceiling }, ceiling: sets.ceiling ? view('ceiling') : null });
  }
  return out;
}

/** The gate's evidence from D6's own checks: builder sessions (output tokens in the stream usage against the CLI's final usage) and the model-era re-price ratios at the billed rate. */
export function gateEvidence(builder, byModelEra, { requiredModels = [], priceTable = null, evidenceGaps = [] } = {}) {
  return {
    outputRatios: builder.sessions.filter(r => Number.isFinite(r.outputTokensStreamUsage) && r.outputTokensFinal > 0).map(r => ({ label: r.label, model: r.model, recorded: r.outputTokensStreamUsage, final: r.outputTokensFinal })),
    eraRatios: byModelEra.map(m => ({ key: m.key, sessions: m.sessions, ratio: m.ratioReportedOverEra })),
    requiredModels, priceTable, evidenceGaps,
  };
}

/** The models the paid agent arms run (stages.json arms): the gate needs an era group for each. */
export const requiredAgentModels = (file = STAGES_FILE) => agentModelsOf(Object.values(readJson(file).arms ?? {}));

export function runD6(jobs, { constructions = [], table = priceTable(), tableSource = sourceOf(STAGES_FILE), launchEnv = null, requiredModels = requiredAgentModels() } = {}) {
  const builder = builderCheck(constructions, table);
  const joined = joinBilledRate(agentSessions(jobs), { launchEnv, builderSessions: builder.sessions });
  const sessions = joined.sessions.map(s => repriceSession(s, table)).filter(Boolean);
  const byModel = summarise(sessions, s => s.model);
  const byModelEra = summarise(sessions, s => `${s.model} | ${s.era}`);
  const groups = summarise(sessions, s => `${s.job} | ${s.mode} | ${s.model}`);
  const impact = meterImpact(jobs, table);
  // Without the launch-environment measurement the post-flag cache-write rate is the policy's account, which launch-env.json contradicts wherever it was measured:
  // the gate says it has no evidence on the rate instead of reading the policy's ratios as the meter's.
  const evidenceGaps = launchEnv ? [] : [{ code: 'NO_LAUNCH_ENV_MEASUREMENT', detail: 'analysis/m0/launch-env.json is absent, so the cache-write rate the post-flag sessions were billed at is the policy\'s account, not a measurement' }];
  const meterGate = buildMeterGate(gateEvidence(builder, byModelEra, { requiredModels, priceTable: table.id, evidenceGaps }));
  return {
    id: 'D6', grade: 'LEGACY/dev', question: 'CLI-reported cost against token re-priced cost on archived agent rows', priceTable: table.id, sources: [tableSource],
    builderSessions: builder, agentSessions: { count: sessions.length, byModel, byModelEra, groups, billedRate: joined.join }, cacheFlag: CACHE_FLAG, directCalls: directCallCheck(jobs, table), meterImpact: impact,
    summary: {
      sessions: sessions.length, byModel: Object.fromEntries(byModel.map(m => [m.key, { sessions: m.sessions, ratioReportedOverP5: m.ratioReportedOverP5, ratioReportedOverP1h: m.ratioReportedOverP1h, medianImpliedOutputTokens: m.medianImpliedOutputTokens, meanRecordedOutputTokens: m.meanRecordedOutputTokens }])),
      byModelEra: Object.fromEntries(byModelEra.map(m => [m.key, { sessions: m.sessions, ratioReportedOverP5: m.ratioReportedOverP5, ratioReportedOverEra: m.ratioReportedOverEra, medianImpliedOutputTokensEra: m.medianImpliedOutputTokensEra, rateSources: m.rateSources }])),
      builder: { sessions: builder.total, exactAtBilledRate: builder.exact, inBilledRateBracket: builder.inBracket },
      builderRatioOverP5: Object.fromEntries(Object.entries(builder.byModel).map(([m, a]) => [m, a.ratioReportedOverP5])), builderRatioOverBilledRate: Object.fromEntries(Object.entries(builder.byModel).map(([m, a]) => [m, a.ratioReportedOverBilledRate])),
      meterChangesLabels: impact.some(i => i.p5.labelFlips > 0 || i.p1h.labelFlips > 0), jobsAffected: impact.filter(i => i.p5.topChanges > 0 || i.p1h.topChanges > 0).map(i => i.job),
      meterChangesCeilingLabels: impact.some(i => i.ceiling && (i.ceiling.p5.labelFlips > 0 || i.ceiling.p1h.labelFlips > 0)), ceilingJobsAffected: impact.filter(i => i.ceiling && (i.ceiling.p5.topChanges > 0 || i.ceiling.p1h.topChanges > 0)).map(i => i.job),
      // Machine-readable gate (meter-gate.mjs): label-run.mjs refuses to start a paid stage with an agent arm unless status is clear (or a verification record clears it).
      meterGate,
    },
  };
}
