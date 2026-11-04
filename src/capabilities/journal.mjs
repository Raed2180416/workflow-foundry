// Acquisition journaling, ARCHITECTURE.md §2.9: every broker step (find, implicit or explicit request, grant, refusal, proposal) is a
// `foundry-decision/1` record (kind selection or adaptation) chained into the run through src/store.mjs recordDecision. Features hold only
// trusted, host-computed fields (enough to recompute the decision, I10); the model's need sits in action.need with an untrustedSpans
// entry; its free-text `why` enters features only as a hash. Ids are deterministic: `<runId>/nodecap/<nodeKey>/<n>`.
import { validateDecision } from '../validate.mjs';
import { digest } from './common.mjs';

export const RULE = 'nodecap-broker/1';
export function decisionRecord({ runId, nodeKey, seq, identity, kind, features, action, need = null, controlLabel = 'trusted', rationale }) {
  const spans = [];
  const act = { ...action };
  if (need) {
    act.need = need;
    if (controlLabel !== 'trusted') spans.push({ path: 'action.need', label: controlLabel, sourceHash: digest({ need }) });
  }
  const record = { schema: 'foundry-decision/1', id: `${runId}/nodecap/${nodeKey}/${seq}`.slice(0, 256), at: Date.now(), kind, identity,
    features: { rule: RULE, ...features, ...(need?.why ? { whyHash: `sha256:${digest({ why: need.why })}` } : {}) },
    action: act, alternatives: [], propensity: 1, rationale: String(rationale).slice(0, 400), costUsd: 0, ...(spans.length ? { untrustedSpans: spans } : {}) };
  return validateDecision(record);
}
/** Record through the run's store (chained when called inside a live run, as probe G1 established). Returns the decision id. */
export function record(ctx, decision) { ctx.store.recordDecision(ctx.runId, decision); return decision.id; }
/** The nodecap decisions of a run, in chain order. */
export const nodecapDecisions = (store, runId) => store.decisions(runId).filter(d => d.features?.rule === RULE);
