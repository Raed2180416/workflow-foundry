// Back-fill adapter: J-NEED-2 property readers (research/need-router-20261014/runs/jev-need2/). $0.
// One row per reader x W-bed task: Jev (6 option orders averaged) and Haiku read six task properties S1-S6. The verdict is
// the share of the six answers that match the family truth table written before any request (jneed2/truth.json); a
// cannot_tell answer or a tie is a miss, as in the report's property table.
import { originOf } from '../origin.mjs';
import { chargeOf } from '../meter.mjs';
import { P, baseRow, readJson, readJsonl, fileSha } from './util.mjs';

export const ADAPTER = 'jneed2@0';
const DIR = 'research/need-router-20261014/runs/jev-need2';
const TRUTH = 'research/need-router-20261014/jneed2/truth.json';
const CODE = 'experiments/need-router/jev-need2.mjs';
const QS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
const JEV_IN_PER_TOKEN = 0.042 / 1e6;   // policy/models.json judgmentModels jev-1.13.0 price.inputPerMTok (second-hand, unverified)

/** The answer a probability triple gives: argmax, null on a tie. */
export function argmax(p) {
  const e = Object.entries(p ?? {}).sort((a, b) => b[1] - a[1]);
  if (!e.length || (e.length > 1 && e[0][1] === e[1][1])) return null;
  return e[0][0];
}
/** Cells matched against the family truth: yes/no answers equal to truth; cannot_tell, null or a tie is a miss. */
export function matchCells(answers, truth) {
  let k = 0;
  for (const q of QS) if ((answers[q] === 'yes' || answers[q] === 'no') && answers[q] === truth[q]) k += 1;
  return k;
}

export function rows() {
  const truth = readJson(TRUTH).families, truthSha = fileSha(TRUTH);
  const jev = readJsonl(`${DIR}/rows.jsonl`), haiku = readJsonl(`${DIR}/haiku-rows.jsonl`);
  const o = originOf('jneed2-properties');
  const out = [];
  const readers = [
    { arm: 'jneed2-jev', file: `${DIR}/rows.jsonl`, rows: jev, answers: x => Object.fromEntries(QS.map(q => [q, argmax(x.mean?.[q])])) },
    { arm: 'jneed2-haiku', file: `${DIR}/haiku-rows.jsonl`, rows: haiku, answers: x => (x.ok ? x.answers : null) },
  ];
  for (const R of readers) {
    for (const x of R.rows) {
      const r = baseRow({ adapter: ADAPTER, files: [R.file, TRUTH], experiment: 'J-NEED-2', arm: R.arm, run: 'jev-need2', taskKey: x.taskKey });
      r.task.bed = 'jneed2-properties'; r.task.family = x.family; r.task.unit = 'task'; r.task.split = 'dev'; r.task.cases = QS.length;
      r.origin = o.origin; r.fidelity = o.fidelity;
      r.provenance['task.key'] = P.copied(`${R.file.split('/').pop()} taskKey (a W-bed M1 task)`);
      r.provenance['origin.class'] = P.computed(`bed registry (origin.mjs BEDS['jneed2-properties']): ${o.why}`);
      r.provenance.fidelity = P.computed('documents read for properties: no world');
      r.evidence = { class: 'diagnostic', K: 1 };
      r.provenance['evidence.class'] = P.copied(`${DIR}/result.json diagnostic: true ("development/diagnostic evidence")`);
      r.harness = { id: 'jev-need2', version: 'jev-need2/result@1', hashes: { truth: truthSha } };
      r.provenance['harness.hashes'] = P.computed('sha256 of the truth table; the harness source hash was not recorded');
      const a = R.answers(x);
      const fam = truth[x.family];
      if (!a || !fam) {
        r.verdict = { ...r.verdict, kind: 'none', excluded: true };
        r.provenance.verdict = P.copied(!a ? 'the reader returned no answers for this task (ok: false)' : `no truth row for family ${x.family}`);
        r.provenance['verdict.oracle.id'] = P.na('no verdict');
      } else {
        const k = matchCells(a, fam);
        r.verdict = { kind: 'count', pass: k === QS.length, successes: k, total: QS.length, score: k / QS.length, censored: false, excluded: false, oracle: { id: 'jneed2/truth@1', sha256: truthSha } };
        r.provenance.verdict = P.computed(R.arm === 'jneed2-jev' ? 'per property: argmax of the order-averaged probabilities (rows.jsonl mean), matched to the family truth; cannot_tell or a tie is a miss'
          : 'per property: Haiku\'s answer (haiku-rows.jsonl answers) matched to the family truth; cannot_tell is a miss');
        r.provenance['verdict.oracle.id'] = P.computed('the truth table, written by an independent reader before any request (truth.json writtenBefore)');
      }
      if (R.arm === 'jneed2-jev') {
        r.models = [{ role: 'reader', id: x.jevModel }];
        r.provenance.models = P.copied('rows.jsonl jevModel (served version)');
        const tin = x.usage?.input_tokens ?? 0, tout = x.usage?.output_tokens ?? 0, repriced = tin * JEV_IN_PER_TOKEN;
        const m = chargeOf({ repricedUsd: repriced, tokens: { input: tin, output: tout } }, 0);
        Object.assign(r.usd, { run: repriced, reported: null, repriced, bound: null, starts: x.perms?.length ?? null, charged: m.charged, observed: m.observed, imputed: 0 });
        r.provenance['usd.reported'] = P.missing('Jev responses report tokens, not dollars');
        r.provenance['usd.repriced'] = P.computed('rows.jsonl usage.input_tokens x $0.042/M (policy/models.json jev-1.13.0, second-hand and unverified; output unpriced, so a lower bound)');
        r.provenance['usd.bound'] = P.missing('Jev requests carry no dollar bound (the cap is a request count)');
        r.provenance['usd.charged'] = P.computed('§12 meter: observed (tokens recorded), charged at the re-priced figure');
        for (const f of ['timing.wallMs', 'timing.timeToDoneMs', 'timing.timeToFirstEffectMs', 'timing.stages', 'timing.components.modelMs', 'timing.components.nonModelMs', 'timing.components.toolMs', 'timing.components.mockMs', 'timing.components.waits', 'timing.concurrency.observedMax'])
          r.provenance[f] = P.missing('requests.jsonl records dispatch times only; rows.jsonl records one completion time per task, no duration');
        r.provenance['timing.concurrency.configured'] = P.missing(`${CODE} --concurrency (default 2) was not recorded`);
      } else {
        r.models = [{ role: 'reader', id: x.modelId }];
        r.provenance.models = P.copied('haiku-rows.jsonl modelId');
        const m = chargeOf({ reportedUsd: (x.costUsd ?? 0) + (x.imputedUsd ?? 0), errorCode: x.error?.code ?? null,
          tokens: { input: (x.usage?.inputTokens ?? 0) + (x.usage?.cacheReadTokens ?? 0) + (x.usage?.cacheWriteTokens ?? 0), output: x.usage?.outputTokens ?? 0 } }, 0.2);
        Object.assign(r.usd, { run: m.reported, reported: m.reported, repriced: null, bound: 0.2, starts: 1, charged: m.charged, observed: m.observed, imputed: m.imputed });
        r.provenance['usd.reported'] = P.copied('haiku-rows.jsonl costUsd + imputedUsd');
        r.provenance['usd.repriced'] = P.missing('not re-priced in the back-fill');
        r.provenance['usd.bound'] = P.code(`${CODE} runHaiku maxPerCall = 0.2`);
        r.provenance['usd.charged'] = P.computed('§12 meter (meter.mjs chargeOf)');
        const lat = x.latencyMs ?? null, answered = !!x.ok;
        r.timing.wallMs = lat; r.timing.timeToDoneMs = lat; r.timing.timeToFirstEffectMs = answered ? lat : null;
        r.timing.endedAt = x.at ?? null;
        r.provenance['timing.wallMs'] = P.copied('haiku-rows.jsonl latencyMs');
        r.provenance['timing.timeToDoneMs'] = P.computed('= latencyMs (one call)');
        r.provenance['timing.timeToFirstEffectMs'] = answered ? P.computed('the answer is the only effect: = latencyMs') : P.na('no answer delivered');
        r.timing.stages = [{ stage: 'model call', ms: lat }];
        r.provenance['timing.stages'] = P.computed('one stage: the call');
        r.timing.components.modelMs = lat; r.timing.components.nonModelMs = 0; r.timing.components.toolMs = 0; r.timing.components.mockMs = 0;
        r.provenance['timing.components.modelMs'] = P.computed('one model call: model time = latencyMs');
        r.provenance['timing.components.nonModelMs'] = P.computed('no tool, mock or harness step');
        r.provenance['timing.components.toolMs'] = P.computed('no tool call');
        r.provenance['timing.components.mockMs'] = P.computed('no mock');
        r.provenance['timing.components.waits'] = P.missing('waits inside the call are not separated from latencyMs');
        r.provenance['timing.concurrency.configured'] = P.missing(`${CODE} --concurrency (default 4 for Haiku) was not recorded`);
        r.provenance['timing.concurrency.observedMax'] = P.missing('one completion time per row, but the runner\'s queueing makes start = at - latency unreliable across a shared pool; not derived');
      }
      r.provenance['usd.build'] = P.na('nothing is built');
      r.provenance['usd.world'] = P.na('no world: the tasks are W-bed documents (their authoring cost is on the M1 rows as missing)');
      r.provenance['timing.businessTime.simulatedMs'] = P.na('no simulated clock');
      r.envFaults = [];
      r.provenance.envFaults = P.computed('final rows only (no error code in the rows)');
      out.push(r);
    }
  }
  return out;
}
