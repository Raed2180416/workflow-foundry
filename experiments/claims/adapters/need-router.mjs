// Back-fill adapter: need-router M1 (tags m1, m1-d5) and M1-R one-call rows (research/need-router-20261014/runs/).
// $0; reads run outputs only. The meter is the need router's own §12 rule (meter.mjs), so the tag totals reproduce
// PREREG-NEED-V1 §12: m1 $28.9957, m1-d5 $33.9199, M1-R final rows $17.8934.
import { originOf } from '../origin.mjs';
import { chargeOf } from '../meter.mjs';
import { P, baseRow, readJsonl, observedMax, iso } from './util.mjs';

export const ADAPTER = 'need-router@0';
const RUNS = 'research/need-router-20261014/runs';
const PREREG = 'research/need-router-20261014/PREREG-NEED-V1.md';
// Launch facts per tag. The runner source at the launch commit is the evidence for concurrency, bound and timeout; the
// sha256 values are the ones PREREG-NEED-V1 records (m1-d5, M1-R) or the launch commit's blob (m1, e5defed).
export const TAGS = Object.freeze([
  { tag: 'm1', dir: 'm1', experiment: 'need-m1-wbed-triviality', runner: 'experiments/need-router/m1-run.mjs@e5defed', runnerSha: '478744664b95accf016fe7ea628ee856b3ab7bdb559081a0b7ac261d4c8a58e7', timeoutMs: 300000, timeoutFrom: 'src/models/port.mjs@e5defed ModelPort default timeoutMs = 300000 (m1-run.mjs sets none)' },
  { tag: 'm1-d5', dir: 'm1-d5', experiment: 'need-m1-wbed-triviality', runner: 'experiments/need-router/m1-run.mjs@56c0a82', runnerSha: '7916277c5cae0d70181228d582547ffec47fca54d5c353890f95b4a1980d5692', timeoutMs: 300000, timeoutFrom: 'src/models/port.mjs@56c0a82 ModelPort default timeoutMs = 300000 (m1-run.mjs sets none)' },
  { tag: 'm1-r', dir: 'm1-r', experiment: 'need-m1-r', runner: 'experiments/need-router/m1-rerun.mjs@4e2e8fe', runnerSha: '662ae4407990fc5a5178d28d64fe1a948a0a58dda63a4e7892bda1e2d7508a49', timeoutMs: 600000, timeoutFrom: 'experiments/need-router/m1-rerun.mjs@4e2e8fe --timeout-ms default 600000, passed to createModelPort' },
]);
const BOUND = 1;          // maxBudgetUsdPerCall: 1 in every runner (createModelPort), the §12 bound per call
const CONCURRENCY = 4;    // pool concurrency: 4 in every runner at its launch commit
const NO_ANSWER = new Set(['MODEL_TIMEOUT']);   // no output delivered; MODEL_SCHEMA delivered an (invalid) answer

export function rows() {
  const out = [];
  for (const T of TAGS) {
    const file = `${RUNS}/${T.dir}/results.jsonl`;
    const rs = readJsonl(file);
    const intervals = rs.map(x => { const end = Date.parse(x.at); return [end - (x.latencyMs ?? 0), end]; });
    const obsMax = observedMax(intervals);
    for (const x of rs) {
      const r = baseRow({ adapter: ADAPTER, files: [file], experiment: T.experiment, arm: x.arm, run: T.tag, trial: x.trial ?? 0, taskKey: x.taskKey });
      const o = originOf('wbed');
      r.task.bed = 'wbed'; r.task.family = x.family; r.task.unit = 'task'; r.task.split = 'dev'; r.task.cases = 1;
      r.origin = o.origin; r.fidelity = o.fidelity;
      r.provenance['task.key'] = P.copied('results.jsonl taskKey');
      r.provenance['origin.class'] = P.computed(`bed registry (origin.mjs BEDS.wbed): ${o.why}`);
      r.provenance.fidelity = P.computed('W-bed tasks are documents with exact oracles; no simulated system, so no world tier');
      r.evidence = { class: 'development', K: 1 };
      r.provenance['evidence.class'] = P.doc(`${RUNS}/m1/REPORT.md: "Development evidence: dev attack seeds ... K = 1"`);
      r.models = [{ role: 'executor', id: 'claude-haiku-5-5' }];
      r.provenance.models = P.code(`${T.runner} (allowedModels ['claude-haiku-5-5']; arm ${x.arm})`);
      r.harness = { id: 'need-router-b0Call', version: T.tag, hashes: { arm: x.armHash, task: x.taskHash, runner: T.runnerSha } };
      r.provenance['harness.hashes'] = P.copied(`results.jsonl armHash, taskHash; runner sha256 from ${PREREG} (m1-d5, M1-R) or the launch commit blob (m1)`);
      // verdict
      const answered = !NO_ANSWER.has(x.error?.code);
      r.verdict = { kind: 'binary', pass: !!x.pass, successes: x.pass ? 1 : 0, total: 1, score: typeof x.score === 'number' ? x.score : null,
        censored: false, excluded: false, oracle: { id: `wbed-oracle:${x.family}`, sha256: x.taskHash ?? null } };
      r.provenance.verdict = P.copied('results.jsonl pass, score (a timeout or schema-invalid answer is a fail, an outcome for the router)');
      r.provenance['verdict.oracle.id'] = P.computed('the family\'s exact-field oracle (beds/wbed/<rung>); the oracle code version is not in the row, taskHash identifies the task');
      // dollars on the §12 meter
      const m = chargeOf({ reportedUsd: x.costUsd ?? 0, imputedUsd: x.imputedUsd ?? 0, costUnknown: !!x.costUnknown, errorCode: x.error?.code ?? null,
        tokens: { input: x.meta?.tokensIn ?? 0, output: x.meta?.tokensOut ?? 0 } }, BOUND);
      Object.assign(r.usd, { run: m.reported, build: null, reported: m.reported, repriced: null, bound: BOUND, starts: 1, charged: m.charged, observed: m.observed, imputed: m.imputed });
      r.provenance['usd.reported'] = P.copied('results.jsonl costUsd + imputedUsd');
      r.provenance['usd.repriced'] = P.missing('meta.tokensIn excludes cache tokens, so the row cannot be re-priced');
      r.provenance['usd.bound'] = P.code(`${T.runner} createModelPort maxBudgetUsdPerCall: 1 (PREREG §12 "$1 per call bound")`);
      r.provenance['usd.charged'] = P.computed('§12 meter (meter.mjs chargeOf -> prereg-rules rowCharge): a row with no observed cost (MODEL_TIMEOUT) at its $1 bound');
      r.provenance['usd.build'] = P.na('a one-call arm builds nothing');
      r.provenance['usd.world'] = P.missing('the W-bed rungs were authored by frontier sessions whose cost was never attached to the bed');
      // timing: one model call per row
      const lat = x.latencyMs ?? null, end = Date.parse(x.at);
      r.timing.wallMs = lat; r.timing.timeToDoneMs = lat;
      r.timing.timeToFirstEffectMs = answered ? lat : null;
      r.timing.startedAt = iso(end - (lat ?? 0)); r.timing.endedAt = x.at ?? null;
      r.provenance['timing.wallMs'] = P.copied('results.jsonl latencyMs');
      r.provenance['timing.timeToDoneMs'] = P.computed('= latencyMs (one call)');
      r.provenance['timing.timeToFirstEffectMs'] = answered ? P.computed('the answer is the only effect of a one-call arm: = latencyMs') : P.na('MODEL_TIMEOUT: no answer was delivered, so no effect');
      r.timing.stages = [{ stage: 'model call', ms: lat }];
      r.provenance['timing.stages'] = P.computed('one stage: the call');
      r.timing.components.modelMs = lat; r.timing.components.nonModelMs = 0; r.timing.components.toolMs = 0; r.timing.components.mockMs = 0;
      r.provenance['timing.components.modelMs'] = P.computed('one model call and nothing else: model time = latencyMs (includes provider queueing)');
      r.provenance['timing.components.nonModelMs'] = P.computed('no tool, mock or harness step in a b0Call row');
      r.provenance['timing.components.toolMs'] = P.computed('no tool call');
      r.provenance['timing.components.mockMs'] = P.computed('no mock');
      r.provenance['timing.components.waits'] = P.missing('provider queueing and rate-limit waits inside the call are not separated from latencyMs');
      r.timing.concurrency.configured = CONCURRENCY; r.timing.concurrency.observedMax = obsMax;
      r.provenance['timing.concurrency.configured'] = P.code(`${T.runner} pool concurrency: 4`);
      r.provenance['timing.concurrency.observedMax'] = obsMax ? P.computed(`max overlap of [at - latencyMs, at] over the ${rs.length} rows of tag ${T.tag}`) : P.missing('no intervals');
      r.provenance['timing.businessTime.simulatedMs'] = P.na('no simulated clock');
      // The runner's per-call wall limit: a MODEL_TIMEOUT row's latency is truncated at it, so a tail quantile that lands on
      // such a row is the deadline, not a measured latency (report.mjs flags it).
      r.timing.deadline = { ms: T.timeoutMs, hit: x.error?.code === 'MODEL_TIMEOUT' };
      r.provenance['timing.deadline'] = P.code(`${T.timeoutFrom}; hit = error.code MODEL_TIMEOUT`);
      r.envFaults = [];
      r.provenance.envFaults = P.computed(`final rows only: env-fault attempts were set aside outside the repository (${T.tag === 'm1-r' ? 'M1-R: 8 set-aside attempts, 4 invalid attempt-1 timeouts and 4 MODEL_RATE_LIMIT, PREREG §13 D7' : 'none recorded'})`);
      out.push(r);
    }
  }
  return out;
}

/** The set-aside attempts the repository does not hold, with what PREREG-NEED-V1 says about them (for the coverage report). */
export const NOT_IN_REPO = Object.freeze([
  { tag: 'm1-r', attempts: 8, codes: { 'MODEL_TIMEOUT (attempt 1, invalid: the port\'s 300 s deadline overrode the 600 s wall)': 4, MODEL_RATE_LIMIT: 4 }, meterUsd: 8,
    from: `${PREREG} §13 D7: attempt 1's 4 rows "are kept outside the repository"; at 02:09 "four trials hit MODEL_RATE_LIMIT ... set aside outside the repository"; §12: "Counting the 8 set-aside attempts at their bound as well (§12): $25.8934"` },
]);
