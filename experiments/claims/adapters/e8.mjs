// Back-fill adapter: E8 builds, repairs, gradings and agent-H runs (research/enterprise-20261014/runs/, B1-E8-DEV.md).
// $0; reads run outputs only. Every value is copied or computed from those outputs, quoted from B1-E8-DEV.md (`doc`), or
// marked missing with the reason.
import { originOf } from '../origin.mjs';
import { chargeMany, chargeOf } from '../meter.mjs';
import { P, baseRow, readJson, readJsonl, exists, rowId } from './util.mjs';

export const ADAPTER = 'e8@0';
const RUNS = 'research/enterprise-20261014/runs';
const DOC = 'research/enterprise-20261014/B1-E8-DEV.md';
const BED = 'ebed-e8';

// Build and repair sessions. arm = the construction arm; run = the lineage label.
export const BUILDS = Object.freeze([
  { label: 'b1h-e8-1', arm: 'B1-H', kind: 'build' },
  { label: 'b1lh-e8-1', arm: 'B1L-H', kind: 'build' },
  { label: 'b1lh-e8-2', arm: 'B1L-H', kind: 'build' },
  { label: 'b1lh-e8-3', arm: 'B1L-H', kind: 'build' },
  { label: 'b1o-e8-1', arm: 'B1-O', kind: 'build' },
  { label: 'b1nh-e8-2', arm: 'B1N-H', kind: 'repair', of: 'b1lh-e8-2' },
  { label: 'b1nh-e8-3', arm: 'B1N-H', kind: 'repair', of: 'b1lh-e8-3' },
]);
// Gradings: label -> the solver's build label. A regrade supersedes the original grading of the same solver and world.
export const GRADES = Object.freeze([
  { label: 'b1h-e8-1', solver: 'b1h-e8-1' },
  { label: 'b1lh-e8-1', solver: 'b1lh-e8-1' }, { label: 'b1lh-e8-2', solver: 'b1lh-e8-2' }, { label: 'b1lh-e8-3', solver: 'b1lh-e8-3' },
  { label: 'b1o-e8-1', solver: 'b1o-e8-1' },
  { label: 'b1nh-e8-2', solver: 'b1nh-e8-2' }, { label: 'b1nh-e8-3', solver: 'b1nh-e8-3' },
  { label: 'regrade-oracle2-b1lh-e8-1', solver: 'b1lh-e8-1', supersedes: 'b1lh-e8-1' },
  { label: 'regrade-oracle2-b1lh-e8-2', solver: 'b1lh-e8-2', supersedes: 'b1lh-e8-2' },
  { label: 'regrade-oracle2-b1lh-e8-3', solver: 'b1lh-e8-3', supersedes: 'b1lh-e8-3' },
  { label: 'regrade-oracle2-b1nh-e8-2', solver: 'b1nh-e8-2', supersedes: 'b1nh-e8-2' },
  { label: 'regrade-oracle2-b1nh-e8-3', solver: 'b1nh-e8-3', supersedes: 'b1nh-e8-3' },
  { label: 'grade-s12-b1lh-e8-1', solver: 'b1lh-e8-1' }, { label: 'grade-s12-b1nh-e8-2', solver: 'b1nh-e8-2' },
  { label: 'grade-s12-b1nh-e8-3', solver: 'b1nh-e8-3' }, { label: 'grade-s12-b1o-e8-1', solver: 'b1o-e8-1' },
]);

const armOf = label => BUILDS.find(b => b.label === label)?.arm;
export const worldKey = ({ seed, d, size }) => `${BED}:w${seed}:d${d}:${size ? `s${size}` : 'full'}:tail`;
const buildKey = (b, spec) => (b.kind === 'repair' ? `${BED}:repair-of:${b.of}` : `${BED}:build:spec-${String(spec).slice(0, 12)}`);
const buildRowId = label => { const b = BUILDS.find(x => x.label === label); return b ? rowId(ADAPTER, b.label, b.arm, `@build:${b.label}`, 0, b.kind) : null; };

function common(r, { model, role, spec, K = 1 }) {
  const o = originOf(BED);
  r.task.bed = BED; r.task.family = 'e8-order-saga';
  r.origin = o.origin; r.fidelity = o.fidelity;
  r.evidence = { class: 'development', K };
  r.models = model ? [{ role, id: model }] : [];
  r.harness = { id: role === 'executor' ? 'ebed-agent-arm' : 'ebed-build', version: null, hashes: spec ? { specE: spec } : null };
  r.provenance['origin.class'] = P.computed(`bed registry (origin.mjs BEDS.${BED}): ${o.why}`);
  r.provenance.fidelity = P.computed('bed registry tier (origin.mjs); no S5 world manifest exists yet');
  r.provenance['evidence.class'] = P.doc(`${DOC}: "Development evidence on dev seeds"; one lineage or run per row (K = 1)`);
  r.provenance['task.key'] = P.computed('seed, difficulty, size and mix of the graded world (result.json rows)');
  r.provenance['usd.world'] = P.missing('the E8 world and systems were hand-built with frontier effort; that cost was never recorded (OWNER-DECISIONS F5)');
  r.usd.world = null;
}

/** One build or repair session row. */
function buildRow(b) {
  const dir = `${RUNS}/${b.label}`;
  const res = readJson(`${dir}/result.json`);
  const tr = readJsonl(`${dir}/transcript.jsonl`);
  const fin = tr.findLast(e => e.type === 'result') ?? null, init = tr.find(e => e.type === 'system' && e.subtype === 'init') ?? null;
  const smoke = readJsonl(`${dir}/smoke.jsonl`);
  const files = [`${dir}/result.json`, `${dir}/transcript.jsonl`, ...(exists(`${dir}/smoke.jsonl`) ? [`${dir}/smoke.jsonl`] : [])];
  const r = baseRow({ adapter: ADAPTER, files, experiment: 'E8-B1', arm: b.arm, run: b.label, rowKind: b.kind, taskKey: `@build:${b.label}` });
  r.id = buildRowId(b.label);
  const B = res.build;
  const spec = res.spec ?? null;
  r.task.key = buildKey(b, spec ?? 'c013c04c80636682f46fd9bdbc2bf436712ed53233b03a06ba74bd88824f8cf1');
  r.task.unit = 'build'; r.task.split = 'dev'; r.task.cases = null;
  const model = B?.model ?? init?.model ?? null;
  common(r, { model, role: b.kind === 'repair' ? 'repairer' : 'builder', spec });
  r.provenance['task.key'] = spec ? P.computed('builder input: SPEC-E sha256 from result.json `spec`') : P.computed(`repair of ${b.of} (result.json build.repairOf)`);
  r.provenance.models = B?.model ? P.copied('result.json build.model') : P.copied('transcript.jsonl system/init model (result.json build is null)');
  r.provenance['harness.hashes'] = spec ? P.copied('result.json spec (SPEC-E sha256); the build runner source hash was not recorded') : P.missing('result.json of a repair carries no spec or runner hash');
  if (!spec) r.harness.hashes = null;
  r.verdict = { ...r.verdict, kind: 'none' };
  r.provenance.verdict = P.na('a build session has no verdict of its own; its solver is graded on the grading rows (refs.build)');
  r.provenance['verdict.oracle.id'] = P.na('no verdict on a build row');
  // dollars
  const cost = B?.costUsd ?? fin?.total_cost_usd ?? null;
  const bound = B?.budgetUsd ?? (b.label === 'b1h-e8-1' ? 3 : null);
  const m = chargeOf({ reportedUsd: cost ?? 0, costUnknown: cost === null }, bound ?? 0);
  Object.assign(r.usd, { build: cost, run: null, reported: cost, repriced: null, bound, starts: 1, charged: m.charged, observed: m.observed, imputed: m.imputed });
  r.provenance['usd.reported'] = B?.costUsd != null ? P.copied('result.json build.costUsd') : P.copied('transcript.jsonl result.total_cost_usd (result.json build is null)');
  r.provenance['usd.build'] = r.provenance['usd.reported'];
  r.provenance['usd.repriced'] = P.missing('the per-request token split needed to re-price a session is in the transcript, but the price tier per request was not re-derived for back-fill');
  r.provenance['usd.bound'] = B?.budgetUsd != null ? P.copied('result.json build.budgetUsd') : (b.label === 'b1h-e8-1' ? P.doc(`${DOC} arms table: B1-H session cap $3`) : P.missing('repair.mjs --budget was not recorded in result.json (default $1.5 at HEAD)'));
  r.provenance['usd.charged'] = P.computed('§12 meter (meter.mjs chargeOf): observed cost, charged max(reported, re-priced)');
  // timing
  const wall = B?.wallMs ?? fin?.duration_ms ?? null;
  const api = fin?.duration_api_ms ?? null;
  const smokeMs = smoke.reduce((s, x) => s + (x.ms ?? 0), 0);
  r.timing.wallMs = wall; r.timing.timeToDoneMs = wall;
  r.provenance['timing.wallMs'] = B?.wallMs != null ? P.copied('result.json build.wallMs (runner-measured)') : P.copied('transcript.jsonl result.duration_ms (CLI-measured; the runner wall was not saved)');
  r.provenance['timing.timeToDoneMs'] = P.computed('a build is done when its session ends: = wallMs');
  r.provenance['timing.timeToFirstEffectMs'] = P.na('a build session makes no external effect');
  r.timing.stages = [{ stage: 'builder-session (CLI duration_ms)', ms: fin?.duration_ms ?? null }, ...(smoke.length ? [{ stage: 'smoke runs on practice worlds', ms: smokeMs, n: smoke.length }] : [])];
  r.provenance['timing.stages'] = P.computed('transcript result.duration_ms; sum of smoke.jsonl `ms` (one entry per smoke run)');
  r.timing.components.modelMs = api;
  r.provenance['timing.components.modelMs'] = api != null ? P.copied('transcript.jsonl result.duration_api_ms') : P.missing('no result event in the transcript');
  r.timing.components.nonModelMs = api != null && wall != null ? Math.max(0, wall - api) : null;
  r.provenance['timing.components.nonModelMs'] = r.timing.components.nonModelMs != null ? P.computed('wallMs - duration_api_ms (tools, smoke service, CLI overhead together)') : P.missing('no model time');
  r.provenance['timing.components.toolMs'] = P.missing('the transcript does not time tool calls separately from CLI overhead');
  r.timing.components.mockMs = smoke.length ? smokeMs : 0;
  r.provenance['timing.components.mockMs'] = smoke.length ? P.computed('sum of smoke.jsonl ms: the solver run through the real host on practice worlds 1235-1237') : P.computed('no smoke service in this arm (no loop), so no mock time');
  r.provenance['timing.components.waits'] = P.missing('rate-limit, Retry-After and queue waits are not separated in the transcript');
  r.timing.concurrency.configured = 1;
  r.provenance['timing.concurrency.configured'] = P.computed('one builder session per build');
  r.provenance['timing.concurrency.observedMax'] = P.na('one session');
  r.provenance['timing.businessTime.simulatedMs'] = P.na('a build has no simulated business clock');
  r.envFaults = B?.error ? [{ code: String(B.error.code ?? B.error), n: 1 }] : [];
  r.provenance.envFaults = P.computed('result.json build.error (null = none)');
  if (b.kind === 'repair') r.refs.build = buildRowId(b.of);
  return r;
}

/** Grading rows: one per graded world of a solver. $0 runs (no model call); their wall time was never recorded. */
function gradeRows(g, supersededIds) {
  const dir = `${RUNS}/${g.label}`;
  const res = readJson(`${dir}/result.json`);
  const sb = BUILDS.find(b => b.label === g.solver);
  const lineage = sb.kind === 'repair' ? BUILDS.find(b => b.label === sb.of) : sb;
  const out = [];
  for (const w of res.rows) {
    const size = w.size ?? res.size ?? null;
    const key = worldKey({ seed: w.seed, d: w.d, size });
    const r = baseRow({ adapter: ADAPTER, files: [`${dir}/result.json`], experiment: 'E8-B1', arm: sb.arm, run: g.label, taskKey: key });
    r.task.unit = 'world'; r.task.split = 'dev'; r.task.cases = w.completed;
    const models = [{ role: 'builder', id: readBuildModel(lineage.label) }, ...(sb.kind === 'repair' ? [{ role: 'repairer', id: readBuildModel(sb.label) }] : [])];
    common(r, { model: null, role: 'builder', spec: res.spec ?? null });
    r.models = models;
    r.provenance.models = P.computed('the solver\'s builder (and repairer) model from the build rows (refs.build); the solver runs without a model');
    r.provenance['harness.hashes'] = res.spec ? P.copied('result.json spec (SPEC-E sha256 of the graded contract); grader code version not recorded') : P.missing('this result.json carries no spec hash');
    if (!res.spec) r.harness.hashes = null;
    const pass = w.passed === w.completed && w.critical === 0 && w.status === 'complete';
    r.verdict = { kind: 'count', pass, successes: w.passed, total: w.completed, score: w.completed ? w.passed / w.completed : null, censored: false, excluded: false,
      oracle: { id: `ebed-e8-oracle@spec-${String(res.spec ?? 'unrecorded').slice(0, 12)}`, sha256: res.spec ?? null } };
    r.provenance.verdict = P.copied('result.json rows[].passed / completed (completed tail-mix cases), critical, status; pass = all completed cases pass, no critical violation');
    r.provenance['verdict.oracle.id'] = res.spec ? P.computed('E8 oracle identified by the SPEC-E sha the grading ran under') : P.computed('E8 oracle; the spec hash was not recorded in this result');
    Object.assign(r.usd, { run: 0, build: null, reported: 0, repriced: null, bound: 0, starts: 0, charged: 0, observed: true, imputed: 0 });
    r.provenance['usd.reported'] = P.computed('the solver runs out of process with no model call: $0 (build.mjs grade)');
    r.provenance['usd.repriced'] = P.na('no model call to re-price');
    r.provenance['usd.bound'] = P.computed('no model call, bound $0');
    r.provenance['usd.charged'] = P.computed('§12 meter: $0');
    r.provenance['usd.build'] = P.na('the build cost is on the build row (refs.build), not repeated per world');
    for (const f of ['timing.wallMs', 'timing.timeToDoneMs', 'timing.stages', 'timing.components.modelMs', 'timing.components.nonModelMs', 'timing.components.toolMs', 'timing.components.mockMs'])
      r.provenance[f] = P.missing('build.mjs grade() records no time per world (B1-E8-DEV says "seconds per world"; smoke.jsonl ms on practice worlds is the nearest measurement)');
    r.provenance['timing.timeToFirstEffectMs'] = P.missing('the host journal (first committed effect) was not kept with the result');
    r.provenance['timing.components.waits'] = P.na('no model call, no external wait');
    r.provenance['timing.concurrency.configured'] = P.missing('the host concurrency of the grading run is not recorded');
    r.provenance['timing.concurrency.observedMax'] = P.missing('no per-call times');
    r.provenance['timing.businessTime.simulatedMs'] = P.missing('the world\'s simulated horizon is not in the result');
    r.envFaults = w.status === 'complete' ? [] : [{ code: `HOST:${String(w.status).slice(0, 40)}`, n: 1 }];
    r.provenance.envFaults = P.computed('result.json rows[].status (complete = none)');
    r.refs.build = buildRowId(g.solver);
    if (g.supersedes) r.refs.supersedes = rowId(ADAPTER, g.supersedes, sb.arm, key, 0, 'task');
    if (supersededIds.has(r.id)) r.refs.supersededBy = supersededIds.get(r.id);
    out.push(r);
  }
  return out;
}

const buildModels = new Map();
function readBuildModel(label) {
  if (buildModels.has(label)) return buildModels.get(label);
  const res = readJson(`${RUNS}/${label}/result.json`);
  let m = res.build?.model ?? null;
  if (!m) m = readJsonl(`${RUNS}/${label}/transcript.jsonl`).find(e => e.type === 'system' && e.subtype === 'init')?.model ?? null;
  buildModels.set(label, m);
  return m;
}

const tickCost = t => ({ reportedUsd: t.costUsd ?? 0, costUnknown: !!t.costUnknown, errorCode: t.error?.code ?? null,
  tokens: t.tokens ? { input: (t.tokens.inputTokens ?? 0) + (t.tokens.cacheReadTokens ?? 0) + (t.tokens.cacheWriteTokens ?? 0), output: t.tokens.outputTokens ?? 0 } : null });
const simSpan = ticks => { const ts = ticks.map(t => Date.parse(t.now)).filter(Number.isFinite); return ts.length ? Math.max(...ts) - Math.min(...ts) : null; };

function agentCommon(r, { model, spec, ticks, bound }) {
  common(r, { model, role: 'executor', spec });
  r.provenance.models = P.copied('result.json model / ticks.jsonl model');
  r.provenance['harness.hashes'] = spec ? P.copied('result.json spec (SPEC-E sha256); agent-arm source hash not recorded') : P.missing('no result.json for this run');
  if (!spec) r.harness.hashes = null;
  const m = chargeMany(ticks.map(tickCost), () => bound);
  Object.assign(r.usd, { run: m.reported, build: null, reported: m.reported, repriced: null, bound, starts: ticks.length, charged: m.charged, observed: m.observed, imputed: m.imputed });
  r.provenance['usd.reported'] = P.computed('sum of ticks.jsonl costUsd (one model session per case-tick)');
  r.provenance['usd.repriced'] = P.missing('per-request prompt sizes (the price tier) are not in the tick log');
  r.provenance['usd.bound'] = P.copied('ticks.jsonl costUpperUsd (the per-tick session bound)');
  r.provenance['usd.charged'] = P.computed('§12 meter over the ticks (meter.mjs chargeMany): observed ticks at max(reported, re-priced), unobserved ticks at the per-tick bound');
  r.provenance['usd.build'] = P.na('the agent arm builds nothing');
  r.provenance['timing.timeToFirstEffectMs'] = P.missing('ticks carry the simulated clock only; no wall timestamp per tick or effect');
  r.provenance['timing.components.modelMs'] = P.missing('tick sessions are not timed');
  r.provenance['timing.components.nonModelMs'] = P.missing('tick sessions are not timed');
  r.provenance['timing.components.toolMs'] = P.missing('tick sessions are not timed');
  r.provenance['timing.components.mockMs'] = P.missing('host and system time is not separated from session time');
  r.provenance['timing.components.waits'] = P.missing('rate-limit and queue waits are not timed (rate-limit refusals are counted as env faults)');
  r.provenance['timing.concurrency.configured'] = P.missing('run-agent.mjs --concurrency was not recorded in result.json (default 4 at HEAD)');
  r.provenance['timing.concurrency.observedMax'] = P.missing('no per-tick wall times');
  r.timing.businessTime.simulatedMs = simSpan(ticks);
  r.provenance['timing.businessTime.simulatedMs'] = r.timing.businessTime.simulatedMs != null ? P.computed('simulated clock: last tick `now` minus first tick `now` (business time, never mixed with wall time)') : P.missing('no tick times');
}

function agentRows() {
  const out = [];
  // 1. agent-H on the sized world 1232 d2 s12: the resumed run (final) and its set-aside rate-limited segment.
  {
    const dir = `${RUNS}/agenth-e8-s12`, cdir = `${dir}/contaminated-ratelimit-20261015`;
    const res = readJson(`${dir}/result.json`), cres = readJson(`${cdir}/result.json`);
    const ticks = readJsonl(`${dir}/ticks.jsonl`), cticks = readJsonl(`${cdir}/ticks.jsonl`);
    const w = res.rows[0], cw = cres.rows[0];
    const key = worldKey({ seed: w.seed, d: w.d, size: w.size });
    const r = baseRow({ adapter: ADAPTER, files: [`${dir}/result.json`, `${dir}/ticks.jsonl`, `${cdir}/result.json`, `${cdir}/ticks.jsonl`, `${cdir}/README.txt`], experiment: 'E8-agent', arm: 'agent-H', run: 'agenth-e8-s12', taskKey: key });
    r.task.unit = 'world'; r.task.split = 'dev'; r.task.cases = w.completed;
    agentCommon(r, { model: res.model, spec: res.spec, ticks, bound: ticks[0]?.costUpperUsd ?? res.tickBudgetUsd });
    r.verdict = { kind: 'count', pass: w.passed === w.completed && w.critical === 0, successes: w.passed, total: w.completed, score: w.passed / w.completed,
      censored: w.armCensored > 0, excluded: false, oracle: { id: `ebed-e8-oracle@spec-${res.spec.slice(0, 12)}`, sha256: res.spec } };
    r.provenance.verdict = P.copied('result.json rows[0].passed / completed, critical, armCensored');
    r.provenance['verdict.oracle.id'] = P.computed('E8 oracle identified by the SPEC-E sha the grading ran under');
    // Wall time: run 1 ran ticks 1-84 cleanly, then 13 refused ticks (MODEL_RATE_LIMIT); the journal was cut to tick 84 and
    // the resume replayed that prefix at $0 and ran 59 more ticks. Run 1's clean part cannot be separated from its refused part.
    const lo = w.wallMs, hi = w.wallMs + cw.wallMs;
    r.timing.wallMsBounds = { lo, hi }; r.timing.wallMs = null; r.timing.timeToDoneMs = null;
    r.timing.stages = [{ stage: 'run 1 (ticks 1-84 clean, then 13 refused; contaminated result.json wallMs)', ms: cw.wallMs }, { stage: 'resume (prefix replayed at $0, then 59 live ticks; result.json wallMs)', ms: w.wallMs }];
    r.provenance['timing.wallMs'] = P.missing(`run 1's clean 84 ticks cannot be timed apart from its 13 refused ticks; bounds [${lo}, ${hi}] ms are in timing.wallMsBounds (resume alone; resume + all of run 1); ${DOC} says "about 1.5 h"`);
    r.provenance['timing.timeToDoneMs'] = P.missing('same as wallMs: only bounds are known');
    r.provenance['timing.stages'] = P.copied('contaminated-ratelimit-20261015/result.json rows[0].wallMs; result.json rows[0].wallMs');
    r.envFaults = [];
    r.provenance.envFaults = P.computed('no tick in the final log carries an error; the refused segment is the set-aside row (refs.setAsideOf)');
    out.push(r);
    // the set-aside segment: ticks 85-97 of run 1 (MODEL_RATE_LIMIT), kept out of the result, counted on the meter.
    const refused = cticks.slice(84);
    const s = baseRow({ adapter: ADAPTER, files: [`${cdir}/result.json`, `${cdir}/ticks.jsonl`, `${cdir}/README.txt`], experiment: 'E8-agent', arm: 'agent-H', run: 'agenth-e8-s12-run1-refused', rowKind: 'set-aside', taskKey: key });
    s.task.unit = 'world'; s.task.split = 'dev'; s.task.cases = cw.completed;
    agentCommon(s, { model: cres.model, spec: cres.spec, ticks: refused, bound: refused[0]?.costUpperUsd ?? cres.tickBudgetUsd });
    s.verdict = { ...s.verdict, kind: 'none', excluded: true, oracle: { id: `ebed-e8-oracle@spec-${cres.spec.slice(0, 12)}`, sha256: cres.spec } };
    s.provenance.verdict = P.copied(`${cdir}/README.txt: run 1's reported ${cw.passed}/${cw.completed} is an environment fault, not an outcome`);
    s.provenance['verdict.oracle.id'] = P.na('excluded: an environment fault carries no verdict');
    s.verdict.oracle = { id: null, sha256: null };
    s.provenance['timing.wallMs'] = P.missing('the refused segment is inside run 1\'s wallMs and cannot be separated');
    s.provenance['timing.timeToDoneMs'] = P.na('excluded segment');
    s.provenance['timing.stages'] = P.missing('not separable from run 1');
    const codes = {};
    for (const t of refused) if (t.error?.code) codes[t.error.code] = (codes[t.error.code] ?? 0) + 1;
    s.envFaults = Object.entries(codes).map(([code, n]) => ({ code, n }));
    s.provenance.envFaults = P.computed('error codes of ticks 85-97 of the contaminated tick log');
    s.refs.setAsideOf = r.id;
    s.usd.run = s.usd.reported;
    out.push(s);
  }
  // 2. agent-H on the full world 1232 d2: two runs killed at the 2-hour job limit, never graded.
  for (const [n, f] of [[1, 'ticks-killed-run1.jsonl'], [2, 'ticks-killed-run2.jsonl']]) {
    const p = `${RUNS}/agenth-e8-1/${f}`;
    const ticks = readJsonl(p);
    const key = worldKey({ seed: 1232, d: 2, size: null });
    const r = baseRow({ adapter: ADAPTER, files: [p], experiment: 'E8-agent', arm: 'agent-H', run: `agenth-e8-1-run${n}`, taskKey: key });
    r.task.unit = 'world'; r.task.split = 'dev'; r.task.cases = null;
    agentCommon(r, { model: ticks[0]?.model, spec: null, ticks, bound: ticks[0]?.costUpperUsd ?? null });
    r.provenance['task.key'] = P.doc(`${DOC}: "The full d2 world 1232 has 71 arrivals" (the tick log names no world)`);
    r.verdict = { ...r.verdict, kind: 'none', censored: true };
    r.provenance.verdict = P.doc(`${DOC}: "Each of two runs stopped at the 2-hour limit"; never graded (no result.json)`);
    r.provenance['verdict.oracle.id'] = P.na('never graded');
    r.timing.wallMs = 2 * 3600 * 1000; r.timing.timeToDoneMs = null;
    r.provenance['timing.wallMs'] = P.doc(`${DOC}: "Each of two runs stopped at the 2-hour limit" (no wall time in the tick log)`);
    r.provenance['timing.timeToDoneMs'] = P.na('killed before done');
    r.provenance['timing.stages'] = P.missing('no stage timing in the tick log');
    r.envFaults = [{ code: 'JOB_TIME_LIMIT', n: 1 }];
    r.provenance.envFaults = P.doc(`${DOC}: the job time limit stopped the run (an environment limit, not an outcome)`);
    out.push(r);
  }
  // 3. agent-H practice smoke on world 1235 d2 size 2.
  {
    const dir = `${RUNS}/agenth-smoke-1235`;
    const res = readJson(`${dir}/result.json`), ticks = readJsonl(`${dir}/ticks.jsonl`), w = res.rows[0];
    const key = worldKey({ seed: w.seed, d: w.d, size: w.size });
    const r = baseRow({ adapter: ADAPTER, files: [`${dir}/result.json`, `${dir}/ticks.jsonl`], experiment: 'E8-agent', arm: 'agent-H', run: 'agenth-smoke-1235', taskKey: key });
    r.task.unit = 'world'; r.task.split = 'practice'; r.task.cases = w.completed;
    agentCommon(r, { model: res.model, spec: res.spec, ticks, bound: ticks[0]?.costUpperUsd ?? res.tickBudgetUsd });
    r.verdict = { kind: 'count', pass: w.passed === w.completed && w.critical === 0, successes: w.passed, total: w.completed, score: w.passed / w.completed,
      censored: w.armCensored > 0, excluded: false, oracle: { id: `ebed-e8-oracle@spec-${res.spec.slice(0, 12)}`, sha256: res.spec } };
    r.provenance.verdict = P.copied('result.json rows[0].passed / completed, critical');
    r.provenance['verdict.oracle.id'] = P.computed('E8 oracle identified by the SPEC-E sha the grading ran under');
    r.timing.wallMs = w.wallMs; r.timing.timeToDoneMs = w.wallMs;
    r.provenance['timing.wallMs'] = P.copied('result.json rows[0].wallMs');
    r.provenance['timing.timeToDoneMs'] = P.computed('= wallMs (the world run ends when the arm is done)');
    r.timing.stages = [{ stage: 'world run', ms: w.wallMs }];
    r.provenance['timing.stages'] = P.copied('result.json rows[0].wallMs (one stage)');
    r.envFaults = [];
    r.provenance.envFaults = P.computed('no tick carries an error');
    out.push(r);
  }
  return out;
}

/** All E8 claim rows. */
export function rows() {
  const out = BUILDS.map(buildRow);
  // superseded ids: the original gradings that an oracle-2 regrade replaces
  const sup = new Map();
  for (const g of GRADES.filter(x => x.supersedes)) {
    const res = readJson(`${RUNS}/${g.label}/result.json`);
    const sb = BUILDS.find(b => b.label === g.solver);
    for (const w of res.rows) {
      const key = worldKey({ seed: w.seed, d: w.d, size: w.size ?? res.size ?? null });
      sup.set(rowId(ADAPTER, g.supersedes, sb.arm, key, 0, 'task'), rowId(ADAPTER, g.label, sb.arm, key, 0, 'task'));
    }
  }
  for (const g of GRADES) out.push(...gradeRows(g, sup));
  out.push(...agentRows());
  return out;
}

export const _test = { armOf, buildRowId };
