// Token and dollar accounting for R6's decisive comparison (W-BED §3.6, PROOF-LEDGER B6): `wide` versus `best_of_n` at
// equal tokens and at equal dollars, with the same verifier. Also the attention model behind the size-gated controls,
// the declared worker slice, and the read set of an agent with tools and no workflow.
//
// The attention model (stand-in, as R3's SEQUENTIAL_BUDGET_TOKENS): a single context reads the corpus in document-id
// order and keeps what it read within a budget of SEQUENTIAL_BUDGET_TOKENS input tokens (prompt and inputs included);
// documents past the budget are not read at all. It is a hypothesis about long-context reading, encoded so that the
// controls are deterministic; the paid one-call attack measures the real thing. Every $0 control that separates `wide`
// from a single context rests on it (review 2026-10-14, finding 4).
//
// The reference `wide` reads (input tokens, utf8/4): plan = prompt + inputs + the header digest of every document
// (Type, Venue, Published, Affiliation, Title) + the consortium notices; one worker per plan candidate reads its slice
// (`workerSlice`: prompt + inputs + every notice + every research document and review that mentions the candidate);
// verify = a panel of 3 judges on a 20% sample of cells, each reading that cell's worker slice (evidence) or only the
// cited source (source-only).
//
// Output and thinking tokens are counted per call (review 2026-10-14, finding 5): output by a per-call estimate
// (OUTPUT_EST, [I]), thinking at the effort's cap (THINKING_CAP: an upper bound, mirrors src/models/port.mjs THINKING,
// pinned by test). They scale with the number of calls, not with the reads: at effort medium `wide`'s 50-190 calls carry
// up to 0.4-1.5M thinking tokens. Dollars use Haiku 5.5's list price with its 100K-token prompt step (HAIKU_PRICE, pinned
// to policy/models.json by test): a prompt above 100K pays the higher rate on its input and output.
//
// best_of_n's unit. W-BED §3.6 defines best_of_n as N independent Haiku *agent* solves. The bed has two $0 readings:
// (1) one inline call per candidate (what the bed's control simulates; N = wide / one inline call), and (2) an agent
// solve, modelled [I] by `agentTokens`: an agent that reads the documents it needs (`agentReadSet`) in tool-result
// batches and re-sends its whole context every turn. Neither decides B6: the B6 run computes N with `nAtEqual` from the
// measured ledgers of both arms, at the effort, unit and difficulty the PREREG fixes.
import { estimateTokens, rng } from '../lib/prng.mjs';
import { isResearch } from './world.mjs';

export const SEQUENTIAL_BUDGET_TOKENS = 32000;
/** Tokens the inline render adds per file ("## files/corpus/D001.txt" and the fences). */
export const PER_FILE_OVERHEAD = 12;
export const PANEL = { n: 3, sample: 0.2 };
export const BEST_OF_N_MIN = 3;
/** Thinking tokens per call at each effort (cap; src/models/port.mjs THINKING, pinned by test). */
export const THINKING_CAP = Object.freeze({ none: 0, low: 1024, medium: 8000, high: 32000 });
/** Haiku 5.5 list price per MTok, and the prompt size above which the higher rate applies (policy/models.json). */
export const HAIKU_PRICE = Object.freeze({ inputPerMTok: 0.1, outputPerMTok: 0.5, longInputPerMTok: 0.5, longOutputPerMTok: 2.5, longAboveTokens: 100000 });
/** Output tokens per call [I]: typed JSON with quoted evidence. answer = one best_of_n candidate's final JSON. */
export const OUTPUT_EST = Object.freeze({ planBase: 60, planPerCandidate: 40, scope: 80, cell: 90, oneCallBase: 80, panel: 60, answerBase: 300, answerPerCell: 45, agentTurn: 120 });
/** Tool-result batch sizes for the agent-solve model [I]. */
export const AGENT_BATCHES = Object.freeze([8000, 16000, 32000]);
export const EFFORTS = Object.freeze(['none', 'medium']);

export const NOTICE_KINDS = new Set(['erratum', 'retraction', 'concern', 'office']);
const headerOf = text => text.split('\n\n')[0];

/** Dollars of one call at Haiku 5.5 list price; the long-prompt rate applies to the whole call above 100K input tokens. */
export function callUsd(input, output) {
  const P = HAIKU_PRICE, long = input > P.longAboveTokens;
  return (input * (long ? P.longInputPerMTok : P.inputPerMTok) + output * (long ? P.longOutputPerMTok : P.outputPerMTok)) / 1e6;
}
/** N at equal budget: how many candidates of cost `perCandidate` fit in `wide` (tokens or dollars, from a ledger). */
export const nAtEqual = (wide, perCandidate) => Math.max(1, Math.floor(wide / perCandidate));

/** Keys in reading order: document ids ascending, rotated to start at `offset`. */
export function readingOrder(world, offset = 0) {
  const keys = world.docs.map(d => d.key);
  const k = ((offset % keys.length) + keys.length) % keys.length;
  return [...keys.slice(k), ...keys.slice(0, k)];
}
/** Documents a single context never reads: everything past the budget in `order`. */
export function unseenPast(world, order, budget = SEQUENTIAL_BUDGET_TOKENS) {
  let used = world.render.fixedTokens;
  const unseen = new Set();
  for (const k of order) {
    used += world.render.tokens.get(k) + PER_FILE_OVERHEAD;
    if (used > budget) unseen.add(k);
  }
  return unseen;
}

/**
 * The declared worker slice for compound `code`: keys of every notice and of every research document and review that
 * mentions the compound. With prompt and inputs, this is all one worker reads; the bed's exact worker on this slice
 * reproduces the truth on every task (tested), so the task is separable under the declared design.
 */
export function workerSlice(world, code) {
  const e = world.entities.find(x => x.code === code);
  return world.docs.filter(d => NOTICE_KINDS.has(d.kind) || ((isResearch(d) || d.kind === 'review') && e && Boolean(d.styles[e.id]))).map(d => d.key);
}

/**
 * Keys an agent with tools and no workflow reads (review 2026-10-14, finding 4): every notice (it learns the lab's
 * abbreviation and former name from the membership and rename notices); every research document whose Affiliation is
 * one of the lab's names and that was published on or after the date; every research document and review that mentions
 * a compound found there, by name or by code; and every later version of a document it read (found by title).
 */
export function agentReadSet(world) {
  const found = world.docs.filter(d => isResearch(d) && d.lab === world.X && d.pubDay >= world.Y);
  const grep = new Set(found.flatMap(d => Object.keys(d.styles)));
  const seen = new Set(world.docs.filter(d => NOTICE_KINDS.has(d.kind) || found.includes(d)
    || ((isResearch(d) || d.kind === 'review') && Object.keys(d.styles).some(id => grep.has(id)))).map(d => d.key));
  for (const d of world.docs) if (d.supersedes && seen.has(d.supersedes)) seen.add(d.key);
  return seen;
}

/**
 * One agent solve [I]: the agent reads `read` tokens of documents in tool-result batches of `batch` tokens and re-sends
 * its whole context every turn (call j reads fixed + j batches); the last call writes the answer. Returns calls and
 * input, output and thinking tokens at `effort`.
 */
export function agentTokens({ fixed, read, batch, cells, effort = 'none' }) {
  const batches = Math.max(1, Math.ceil(read / batch));
  let input = 0;
  for (let j = 0; j <= batches; j++) input += fixed + Math.min(j * batch, read);
  const calls = batches + 1;
  const output = batches * OUTPUT_EST.agentTurn + OUTPUT_EST.answerBase + OUTPUT_EST.answerPerCell * cells;
  const thinking = calls * THINKING_CAP[effort];
  return { calls, input, output, thinking, tokens: input + output + thinking };
}

/**
 * Accounting of one task: corpus, inline render, the reference wide's phases under three designs, and best_of_n's N
 * at equal tokens and equal dollars, per effort and per unit. Designs: `declared` (the reference: chain workers = per
 * candidate one scope judge, then for an in-scope candidate one judge per requested property, each reading the
 * candidate's slice; panel reads the evidence), `oneCall` (one typed judgment per candidate; panel reads the evidence)
 * and `lean` (one call per candidate; panel reads the cited source only).
 */
export function tokenAccounting(world, { candidates, inScope }) {
  const tok = world.render.tokens, fixed = world.render.fixedTokens;
  const tokOf = key => tok.get(key);
  const corpus = world.docs.reduce((s, d) => s + tokOf(d.key), 0);
  const inline = fixed + corpus + world.docs.length * PER_FILE_OVERHEAD;
  const notices = world.docs.filter(d => NOTICE_KINDS.has(d.kind)).reduce((s, d) => s + tokOf(d.key), 0);
  const digest = world.docs.reduce((s, d) => s + estimateTokens(headerOf(world.render.texts.get(d.key))), 0);
  const plan = fixed + digest + world.docs.filter(d => d.kind === 'office').reduce((s, d) => s + tokOf(d.key), 0);
  const byKey = new Map(world.docs.map(d => [d.key, d]));
  const workerOf = code => fixed + workerSlice(world, code).reduce((s, k) => s + tokOf(k), 0);
  const ownDocsOf = code => workerSlice(world, code).filter(k => !NOTICE_KINDS.has(byKey.get(k).kind)).reduce((s, k) => s + tokOf(k), 0);
  const inSet = new Set(inScope), k = world.props.length;
  const perWorker = candidates.map(workerOf);
  const oneCall = perWorker.reduce((a, b) => a + b, 0);
  const chain = candidates.reduce((s, code, i) => s + perWorker[i] * (inSet.has(code) ? 1 + k : 1), 0);
  // prompt caching (slice 2 item 6b): the shared prefix (prompt + inputs + notices) is written once, each candidate's
  // documents once; every other read of them is a cache hit
  const uncached = fixed + notices + candidates.reduce((s, code) => s + ownDocsOf(code), 0);
  const cells = inScope.length * k;
  const sample = Math.ceil(PANEL.sample * cells);
  const r = rng('wbed', 'r6', 'panel', world.spec.split, world.spec.seed, world.spec.difficulty);
  const sampled = Array.from({ length: sample }, () => r.pick(inScope));
  const meanDoc = corpus / world.docs.length;
  const sourceOnly = Math.round(fixed + notices + meanDoc);
  const verify = PANEL.n * sampled.reduce((s, code) => s + workerOf(code), 0);
  const verifySourceOnly = PANEL.n * sample * sourceOnly;
  const total = plan + chain + verify, totalOneCall = plan + oneCall + verify, totalLean = plan + oneCall + verifySourceOnly;

  // per call: [input, output]; thinking and dollars per effort
  const callsOf = (worker, panel) => {
    const calls = [[plan, OUTPUT_EST.planBase + OUTPUT_EST.planPerCandidate * candidates.length]];
    candidates.forEach((code, i) => {
      if (worker === 'chain') { calls.push([perWorker[i], OUTPUT_EST.scope]); if (inSet.has(code)) for (let j = 0; j < k; j++) calls.push([perWorker[i], OUTPUT_EST.cell]); }
      else calls.push([perWorker[i], OUTPUT_EST.oneCallBase + (inSet.has(code) ? k * OUTPUT_EST.cell : 0)]);
    });
    for (const code of sampled) for (let j = 0; j < PANEL.n; j++) calls.push([panel === 'evidence' ? workerOf(code) : sourceOnly, OUTPUT_EST.panel]);
    return calls;
  };
  const DESIGNS = { declared: callsOf('chain', 'evidence'), oneCall: callsOf('one', 'evidence'), lean: callsOf('one', 'source') };
  const priced = (calls, effort) => {
    const th = THINKING_CAP[effort];
    const input = calls.reduce((s, c) => s + c[0], 0), output = calls.reduce((s, c) => s + c[1], 0), thinking = calls.length * th;
    const usd = calls.reduce((s, c) => s + callUsd(c[0], c[1] + th), 0);
    return { calls: calls.length, input, output, thinking, tokens: input + output + thinking, usd: Math.round(usd * 1e5) / 1e5 };
  };
  const answerOut = OUTPUT_EST.answerBase + OUTPUT_EST.answerPerCell * cells;
  const read = [...agentReadSet(world)].reduce((s, key) => s + tokOf(key) + PER_FILE_OVERHEAD, 0);
  const wideBy = {}, bonBy = {};
  for (const effort of EFFORTS) {
    const th = THINKING_CAP[effort];
    const candidate = { input: inline, output: answerOut, thinking: th, tokens: inline + answerOut + th, usd: Math.round(callUsd(inline, answerOut + th) * 1e5) / 1e5 };
    wideBy[effort] = {};
    bonBy[effort] = { candidate };
    for (const [name, calls] of Object.entries(DESIGNS)) {
      const w = priced(calls, effort);
      wideBy[effort][name] = w;
      bonBy[effort][name] = { nTokens: nAtEqual(w.tokens, candidate.tokens), nUsd: nAtEqual(w.usd, candidate.usd) };
    }
    bonBy[effort].agent = Object.fromEntries(AGENT_BATCHES.map(batch => {
      const a = agentTokens({ fixed, read, batch, cells, effort });
      const usd = Math.round(Array.from({ length: a.calls }, (_, j) => j).reduce((s, j) => s + callUsd(fixed + Math.min(j * batch, read), (j === a.calls - 1 ? OUTPUT_EST.answerBase + OUTPUT_EST.answerPerCell * cells : OUTPUT_EST.agentTurn) + th), 0) * 1e5) / 1e5;
      return [batch, { ...a, usd, nTokens: nAtEqual(wideBy[effort].declared.tokens, a.tokens), nUsd: nAtEqual(wideBy[effort].declared.usd, usd) }];
    }));
  }
  const workerMax = Math.max(0, ...perWorker);
  return {
    corpus, inline, notices, digest,
    wide: { plan, workers: chain, workersOneCall: oneCall, workerMean: Math.round(oneCall / Math.max(1, candidates.length)), workerMax,
      cacheableShare: Math.round((1 - uncached / chain) * 1000) / 1000, verify, verifySourceOnly, total, totalOneCall, totalLean,
      calls: { plan: 1, workers: candidates.length + inScope.length * k, verify: PANEL.n * sample }, candidates: candidates.length, cells, sample, byEffort: wideBy },
    bestOfN: {
      unit: 'one inline call per candidate (the bed control); the B6 arm is N agent solves, N from the measured ledger (nAtEqual)',
      // the control's N: declared design, effort none, input + output tokens
      nAtEqualTokens: bonBy.none.declared.nTokens, nOneCall: bonBy.none.oneCall.nTokens, nLean: bonBy.none.lean.nTokens,
      ratio: Math.round((total / inline) * 100) / 100, agentRead: read, byEffort: bonBy,
    },
    over100k: { inline: inline > HAIKU_PRICE.longAboveTokens, workerMax: workerMax > HAIKU_PRICE.longAboveTokens },
  };
}
