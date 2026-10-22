// The gameqa-web arms. Every arm gets the same tester session (reset/run/observe on build B1, no probes) and returns
// bug reports; the oracle scores them afterwards. Only the arms' model calls cost money (Haiku via ModelPort).
//   monkey            random input (with random goto navigation) + the template's generic detectors + code repro/ddmin. $0.
//   agent             a Haiku agent alone: each turn it plans a run, reads the trace, keeps notes, maintains its reports.
//   workflow          the cheap-built QA workflow (template.json): Haiku constructs personas + executable checks, code plays
//                     the personas' plans and evaluates every check per tick, code reproduces + ddmin-minimizes, Haiku judges.
//   workflow-random   ablation: the same constructed checks, triage, repro, ddmin and judge, but monkey exploration instead
//                     of personas (isolates what the persona exploration adds).
import { tokenError } from '../../beds/gameqa-web/driver.mjs';
import { renderRun, renderMap, renderObs, compileChecks, scanRun, violationPredicate, ddmin, coverageOf, FROZEN_WINDOW } from './qa-lib.mjs';
import * as P from './prompts.mjs';

// ------------------------------------------------------------------------------------------------ helpers
export function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const pick = (rng, xs) => xs[Math.floor(rng() * xs.length)];
const KEYS = ['up', 'down', 'left', 'right'];
const DASH = ['dash-up', 'dash-down', 'dash-left', 'dash-right'];
const BUTTONS = ['btn-resume', 'btn-restart', 'btn-next', 'btn-retry', 'btn-again'];
const COMBO_PARTS = [...KEYS, ...DASH, 'use', 'pause', 'esc', 'enter'];
/** One random harness token (weights in the PREREG): moves 40%, dashes 10%, wait 10%, use 4%, pause/esc/enter 12%, clicks 10%, 2-key combos 8%, goto 6%. */
export function monkeyToken(rng) {
  const r = rng();
  if (r < 0.40) return pick(rng, KEYS);
  if (r < 0.50) return pick(rng, DASH);
  if (r < 0.60) return 'wait';
  if (r < 0.64) return 'use';
  if (r < 0.76) return pick(rng, ['pause', 'esc', 'enter']);
  if (r < 0.86) return `click:${pick(rng, BUTTONS)}`;
  if (r < 0.94) return `${pick(rng, COMBO_PARTS)}+${pick(rng, COMBO_PARTS)}`;
  return `goto:${1 + Math.floor(rng() * 12)},${1 + Math.floor(rng() * 8)}`;
}
const seedOf = rng => 1 + Math.floor(rng() * 1_000_000);
const GENERIC_CLASS = { 'generic:frozen': 'softlock', 'generic:page-error': 'softlock' };
const GENERIC_RULE = { 'generic:frozen': 'The game must always respond: the state may not stay unchanged with no dialog or button to act on.', 'generic:page-error': 'The page shows no script errors.' };
const outcomeOf = run => { const s = run.final.state; return `ended at (${s.player.x},${s.player.y}) ${s.mode}${s.dialog ? `/${s.dialog}` : ''} score=${s.score} lives=${s.lives} keys=${s.keys} time=${s.timeLeft}`; };

/** Model calls with one schema retry, a per-run USD cap, and a call log (no prompts: they are rebuilt from code). */
export function makeCaller({ port, runId, modelId, usdCap, decoding = { reasoning: 'low' }, log = () => {} }) {
  const st = { spent: 0, calls: 0, failed: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0, unknownSpend: 0 };
  async function call(nodeKey, { system, prompt, schema }) {
    let feedback = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      if (st.spent >= usdCap) { log({ nodeKey, attempt, skipped: 'RUN_BUDGET' }); return { ok: false, error: { code: 'RUN_BUDGET' } }; }
      let r;
      try { r = await port.call({ runId, nodeKey, attempt, modelId, system, prompt: prompt + feedback, schema, decoding }); }
      catch (e) { st.failed++; log({ nodeKey, attempt, ok: false, error: e.code ?? e.message }); return { ok: false, error: { code: e.code ?? 'ERROR', message: e.message } }; }
      const cost = r.costUsd ?? 0, unknown = r.costUnknown ? (r.costCapUsd ?? 0) : 0;
      st.spent += cost + unknown; st.unknownSpend += unknown; st.calls++; st.inputTokens += r.usage?.inputTokens ?? 0; st.outputTokens += r.usage?.outputTokens ?? 0; st.latencyMs += r.latencyMs ?? 0;
      log({ nodeKey, attempt, ok: r.ok, costUsd: cost, latencyMs: r.latencyMs, usage: r.usage, error: r.error?.code, value: r.ok ? r.value : undefined });
      if (r.ok) return r;
      st.failed++;
      if (r.error?.code !== 'MODEL_SCHEMA') return r;
      feedback = `\n\nYour previous answer was rejected: ${String(r.error.feedback ?? r.error.message).slice(0, 600)}. Answer again with JSON that satisfies the schema.`;
    }
    return { ok: false, error: { code: 'MODEL_SCHEMA' } };
  }
  return { call, stats: st };
}

// Repro + minimize one candidate (code-owned): replay twice, then ddmin with the same predicate.
async function reproAndMinimize(session, cand, checks, budgets, counter) {
  const pred = violationPredicate(session, cand.seed, cand.checkId, checks, { counter });
  const prefix = cand.steps;
  if (!(await pred([...prefix])) || !(await violationPredicate(session, cand.seed, cand.checkId, checks, { counter })([...prefix]))) return { ...cand, confirmed: false };
  const m = await ddmin(prefix, pred, { maxTests: budgets.minimizeTestsPerCandidate ?? 400 });
  return { ...cand, confirmed: true, steps: m.tokens, oneMinimal: m.oneMinimal, ddminTests: m.tests, originalLength: prefix.length };
}

function noteViolations(cands, run, start, seed, tokens, checks, { generic = true } = {}) {
  const { violations, errors } = scanRun(run, start, checks, { generic });
  for (const v of violations) {
    const steps = tokens.slice(0, v.tokenIndex + 1);
    const prev = cands.get(v.checkId);
    if (!prev || steps.length < prev.steps.length) cands.set(v.checkId, { checkId: v.checkId, seed, steps, step: v.step });
  }
  return errors;
}

// ------------------------------------------------------------------------------------------------ monkey
async function monkeyExplore({ session, rng, exploreTicks, episodeTokens = 200, checks = [], counter }) {
  const cands = new Map(), runs = [];
  let ticks = 0, episodes = 0;
  const evalErrors = new Map();
  while (ticks < exploreTicks) {
    const seed = seedOf(rng), tokens = Array.from({ length: episodeTokens }, () => monkeyToken(rng));
    const start = await session.reset(seed);
    const run = await session.run(tokens, { detail: 'each' });
    ticks += run.primitives; episodes++;
    for (const e of noteViolations(cands, run, start, seed, tokens, checks)) evalErrors.set(e.id, e.error);
    runs.push({ steps: run.steps.filter(s => s.obs).map(s => ({ obs: { state: s.obs.state } })) });
    if (counter) counter.exploreTicks = ticks;
  }
  return { cands, ticks, episodes, coverage: coverageOf(runs), evalErrors: [...evalErrors].map(([id, error]) => ({ id, error })) };
}

export async function runMonkey({ session, rng, budgets }) {
  const counter = { replays: 0 };
  const ex = await monkeyExplore({ session, rng, exploreTicks: budgets.exploreTicks, counter });
  const reports = [], minimized = [];
  for (const cand of ex.cands.values()) {
    const m = await reproAndMinimize(session, cand, [], budgets, counter);
    minimized.push(m);
    if (!m.confirmed) continue;
    reports.push({ bug_class: GENERIC_CLASS[m.checkId], title: `${m.checkId === 'generic:frozen' ? 'Game stops responding' : 'Script error'} after this input`,
      observed: m.checkId === 'generic:frozen' ? `After these tokens the state stops changing for ${FROZEN_WINDOW} ticks and no dialog or button is visible.` : 'The page reports a script error.',
      expected: GENERIC_RULE[m.checkId], seed: m.seed, steps: m.steps });
  }
  return { reports, stats: { exploreTicks: ex.ticks, episodes: ex.episodes, verifyReplays: counter.replays, candidates: ex.cands.size, coverage: ex.coverage }, minimized };
}

// ------------------------------------------------------------------------------------------------ agent alone
export async function runAgent({ session, caller, budgets }) {
  const { maxTurns = 40, exploreTicks = 8000, maxStepsShown = 120 } = budgets;
  let notes = '', reports = [], lastRun = null, lastError = null, ticks = 0, finished = false;
  const history = [];
  for (let turn = 1; turn <= maxTurns && !finished; turn++) {
    const prompt = P.agentTurnPrompt({ turn, maxTurns, ticksLeft: Math.max(0, exploreTicks - ticks), notes, history, lastRun, lastError, reports });
    lastError = null;
    const r = await caller.call(`turn-${turn}`, { system: P.AGENT_SYSTEM, prompt, schema: P.AGENT_SCHEMA });
    if (!r.ok) { lastError = `the model call failed (${r.error?.code})`; if (r.error?.code === 'RUN_BUDGET') break; continue; }
    const v = r.value;
    notes = v.notes; reports = v.reports;
    if (v.action === 'finish') { finished = true; break; }
    const bad = v.steps.length ? v.steps.map(tokenError).find(Boolean) : 'steps is empty';
    if (bad) { lastError = `invalid steps (${bad}); nothing was run`; lastRun = null; continue; }
    if (ticks >= exploreTicks) { lastError = 'the tick budget is used up: finish now'; lastRun = null; continue; }
    const start = await session.reset(v.seed);
    const run = await session.run(v.steps, { detail: 'each' });
    ticks += run.primitives;
    lastRun = { seed: v.seed, text: renderRun(run, { start, maxSteps: maxStepsShown }), map: renderMap(run.final) };
    history.push({ n: history.length + 1, seed: v.seed, steps: v.steps, tokens: v.steps.length, outcome: outcomeOf(run) });
  }
  return { reports, stats: { exploreTicks: ticks, runs: history.length, finished, notes } };
}

// ------------------------------------------------------------------------------------------------ cheap-built workflow
export async function construct({ caller }) {
  const r = await caller.call('construct', { system: P.CONSTRUCT_SYSTEM, prompt: 'Write the personas and the checks for this game.', schema: P.CONSTRUCT_SCHEMA });
  if (!r.ok) return { ok: false, error: r.error };
  let { personas, checks: specs } = r.value;
  // ids must be unique and must not collide with the generic detectors
  const seen = new Set();
  specs = specs.map((c, i) => { let id = String(c.id).replace(/^generic:/, ''); if (seen.has(id)) id = `${id}-${i}`; seen.add(id); return { ...c, id }; });
  let { checks, rejected } = compileChecks(specs);
  let repaired = 0;
  if (rejected.length) {
    const withSrc = rejected.map(x => ({ ...x, ...specs.find(c => c.id === x.id) }));
    const rr = await caller.call('construct-repair', { system: P.CONSTRUCT_SYSTEM, prompt: P.repairPrompt(withSrc), schema: P.REPAIR_SCHEMA });
    if (rr.ok) {
      const fixed = compileChecks(rr.value.checks.filter(c => rejected.some(x => x.id === c.id)));
      checks = checks.concat(fixed.checks); repaired = fixed.checks.length; rejected = fixed.rejected;
    }
  }
  return { ok: true, personas, specs: checks.map(({ _expect, _when, needsUi, ...c }) => c), checks, rejected, repaired };
}

export async function runWorkflow({ session, caller, rng, budgets, explore = 'personas', constructed = null, log = () => {} }) {
  const B = { ...P.TEMPLATE.budgets, ...budgets }, counter = { replays: 0 };
  // 1. construct (or reuse the paired run's construction, for the exploration ablation)
  const built = constructed ? { ok: true, ...constructed, ...compileChecks(constructed.specs) } : await construct({ caller });
  if (!built.ok) return { reports: [], stats: { failed: 'construct', error: built.error } };
  let checks = built.checks;
  // smoke: drop checks that cannot even be evaluated on a short run (evaluation errors are check defects, not findings)
  const smokeStart = await session.reset(1);
  const smoke = await session.run(['wait', 'right', 'down', 'pause', 'pause'], { detail: 'each' });
  const smokeErr = scanRun(smoke, smokeStart, checks, { generic: false }).errors;
  checks = checks.filter(c => !smokeErr.some(e => e.id === c.id));
  log({ node: 'construct', personas: built.personas?.length, checks: checks.length, rejected: built.rejected, smokeErrors: smokeErr });

  // 2. explore + playback
  const cands = new Map(), evalErrors = new Map();
  let ticks = 0, rounds = 0, plansPlayed = 0, coverage;
  if (explore === 'random') {
    const ex = await monkeyExplore({ session, rng, exploreTicks: B.exploreTicks, checks, counter });
    for (const [k, v] of ex.cands) cands.set(k, v);
    ex.evalErrors.forEach(e => evalErrors.set(e.id, e.error));
    ticks = ex.ticks; coverage = ex.coverage;
  } else {
    const personas = built.personas, memory = personas.map(() => ({ notes: '', lastRuns: [], lastError: null })), allRuns = [];
    for (let round = 1; round <= B.rounds && ticks < B.exploreTicks; round++) {
      rounds = round;
      const cov = coverageOf(allRuns);
      const known = [...cands.keys()].map(id => `${id}${checks.find(c => c.id === id) ? ` (${checks.find(c => c.id === id).rule.slice(0, 80)})` : ''}`);
      const answers = await Promise.all(personas.map((p, i) => caller.call(`explore-r${round}-p${i}`, { system: P.exploreSystem(p),
        prompt: P.explorePrompt({ round, rounds: B.rounds, notes: memory[i].notes, coverage: cov, violations: known, lastRuns: memory[i].lastRuns, lastError: memory[i].lastError }), schema: P.EXPLORE_SCHEMA })));
      for (const [i, a] of answers.entries()) {
        const mem = memory[i]; mem.lastRuns = []; mem.lastError = null;
        if (!a.ok) { mem.lastError = `the planning call failed (${a.error?.code})`; continue; }
        mem.notes = a.value.notes;
        for (const plan of a.value.plans.slice(0, B.plansPerRound)) {
          if (ticks >= B.exploreTicks) break;
          const bad = plan.steps.map(tokenError).find(Boolean);
          if (bad) { mem.lastError = `a plan was not run: ${bad}`; continue; }
          const start = await session.reset(plan.seed);
          const run = await session.run(plan.steps.slice(0, B.tokensPerPlan), { detail: 'each' });
          ticks += run.primitives; plansPlayed++;
          for (const e of noteViolations(cands, run, start, plan.seed, plan.steps.slice(0, B.tokensPerPlan), checks)) evalErrors.set(e.id, e.error);
          allRuns.push(run);
          mem.lastRuns.push({ purpose: plan.purpose, seed: plan.seed, text: renderRun(run, { start, maxSteps: 40 }), map: renderMap(run.final) });
        }
      }
    }
    coverage = coverageOf(allRuns);
  }
  // 3. triage: one candidate per violated check (checks that errored during exploration are dropped)
  const triaged = [...cands.values()].filter(c => !evalErrors.has(c.checkId)).slice(0, B.maxCandidates);
  // 4-5. repro + minimize (code)
  const minimized = [];
  for (const c of triaged) minimized.push(await reproAndMinimize(session, c, checks, B, counter));
  const confirmed = minimized.filter(m => m.confirmed);
  // dedup: candidates whose minimized repros are the same token list are one finding, judged with all their checks
  const unique = [];
  for (const m of confirmed) {
    const u = unique.find(x => x.steps.join(' ') === m.steps.join(' '));
    if (u) u.checkIds.push(m.checkId); else unique.push({ seed: m.seed, steps: m.steps, checkIds: [m.checkId] });
  }
  // 6. judge (Haiku), batched, with the full trace of each minimized replay
  const reports = [], verdicts = [];
  for (let i = 0; i < unique.length; i += B.judgeBatch) {
    const batch = [];
    for (const [j, u] of unique.slice(i, i + B.judgeBatch).entries()) {
      const its = u.checkIds.map(id => checks.find(c => c.id === id)).filter(Boolean);
      const watch = u.checkIds.includes('generic:frozen') ? Array(FROZEN_WINDOW).fill('wait') : [];
      const start = await session.reset(u.seed);
      const run = await session.run([...u.steps, ...watch], { detail: 'each' });
      const found = scanRun(run, start, its, { generic: u.checkIds.some(id => id.startsWith('generic:')) }).violations;
      batch.push({ n: i + j, seed: u.seed, steps: u.steps, trace: renderRun(run, { start, maxSteps: 60 }),
        checks: u.checkIds.map(id => { const c = checks.find(x => x.id === id); return { id, rule: c?.rule ?? GENERIC_RULE[id], when: c?.when, expect: c?.expect, step: found.find(v => v.checkId === id)?.step ?? '?' }; }) });
    }
    const r = await caller.call(`judge-${i / B.judgeBatch}`, { system: P.JUDGE_SYSTEM, prompt: P.judgePrompt(batch), schema: P.JUDGE_SCHEMA });
    if (!r.ok) { verdicts.push({ batch: i / B.judgeBatch, error: r.error?.code }); continue; }
    for (const v of r.value.verdicts) {
      const u = unique[v.candidate];
      if (!u || v.candidate < i || v.candidate >= i + B.judgeBatch) continue;
      verdicts.push({ candidate: v.candidate, checkIds: u.checkIds, is_bug: v.is_bug, bug_class: v.bug_class, title: v.title });
      if (v.is_bug && !reports.some(x => x._cand === v.candidate)) reports.push({ _cand: v.candidate, bug_class: v.bug_class, title: v.title, observed: v.observed, expected: v.expected, seed: u.seed, steps: u.steps });
    }
  }
  return {
    reports: reports.map(({ _cand, ...r }) => r),
    stats: { exploreTicks: ticks, rounds, plansPlayed, verifyReplays: counter.replays, checks: checks.length, rejectedChecks: built.rejected?.length ?? 0, repairedChecks: built.repaired ?? 0,
      smokeErrors: smokeErr.length, evalErrors: [...evalErrors].map(([id, error]) => ({ id, error })), candidates: cands.size, confirmed: confirmed.length, unique: unique.length, coverage },
    constructed: { personas: built.personas, specs: built.specs ?? checks.map(({ _expect, _when, needsUi, ...c }) => c) },
    minimized: minimized.map(({ checkId, seed, steps, confirmed: ok, oneMinimal, ddminTests, originalLength }) => ({ checkId, seed, steps, confirmed: ok, oneMinimal, ddminTests, originalLength })),
    verdicts,
  };
}
