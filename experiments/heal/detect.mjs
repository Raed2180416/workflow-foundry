// DETECT and CLASSIFY (DESIGN §4, §5). A signal is a typed record, a reason to look, never a reason to patch. Sealed families and
// splits are refused at intake. Everything here is code over recorded data and a free strict replay.
import { loadGate } from './pin-gate.mjs';
import { sealedRefusal } from './kit.mjs';
import { acceptedCalls } from './replay.mjs';
import { resolveNode, shapeKey, checkTrace, decisionFields, canonical, nodeRef, refsIn, digest } from './ir.mjs';

export const SIGNAL = 'heal-signal/1';
export const ENV_FAULTS = Object.freeze(['MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'SANDBOX_UNAVAILABLE', 'EXECUTOR_LAUNCH', 'EXECUTOR_PROTOCOL']);
export const THRESHOLDS = Object.freeze({ costOutlier: 1.5, minPopulation: 6, vacuousShare: 0.25, fragileShare: 0.05 });

const quantile = (xs, q) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };

const mk = (kind, trial, workflowRef, extra = {}) => ({ schema: SIGNAL, kind, workflow: workflowRef, run: { runId: trial.runId, taskKey: trial.taskKey, trial: trial.trial, armId: trial.armId },
  split: trial.split, oracle: extra.oracle ?? 'absent', evidence: extra.evidence ?? [], ...(extra.node ? { node: extra.node } : {}), ...(extra.detail ? { detail: extra.detail } : {}) });

// Check trace over journaled outputs: for each model node with checks, which decision fields did the effective checks read?
// A field that is unconstrained in more than `vacuousShare` of the outputs, and varies among those outputs, is a vacuous check.
export function checkVacuity({ workflow, journal, runIds, kit, vacuousShare = THRESHOLDS.vacuousShare }) {
  const groups = new Map();
  for (const runId of runIds) for (const row of acceptedCalls(journal, runId)) {
    const node = resolveNode(workflow, row.nodeKey);
    if (!node || node.kind !== 'agent' || !(node.checks ?? []).length || !node.returns) continue;
    const g = groups.get(shapeKey(row.nodeKey)) ?? { node, outputs: [] }; groups.set(shapeKey(row.nodeKey), g); g.outputs.push(row.response.value);
  }
  const { condition } = kit.data, { bindOutput } = kit.validate, out = [];
  for (const [key, { node, outputs }] of groups) {
    const fields = decisionFields(node.returns), traces = outputs.map(v => checkTrace(node.checks, v, { condition, bindOutput }));
    const everRead = new Set(traces.flatMap(t => [...t.reads]));
    for (const field of fields) {
      if (!everRead.has(field)) continue;   // never read by any effective branch: an escalation trigger design question, not an escape hatch
      const free = outputs.filter((_, i) => !traces[i].reads.has(field));
      const distinct = new Set(free.map(v => canonical(v[field]))).size;
      const share = free.length / outputs.length;
      if (share > vacuousShare && distinct >= 2) out.push({ nodeKey: key, node: node.id, field, outputs: outputs.length, unconstrained: free.length, share: +share.toFixed(3), distinctValues: distinct });
    }
  }
  return out;
}

// CHECK_MODEL_DISAGREEMENT: a node routed by `when` on an upstream check returned, for the field it was shown as the previous
// attempt, exactly the flagged candidate.
export function checkDisagreements({ workflow, outputs }) {
  const out = [];
  for (const n of workflow.nodes) {
    if (n.kind !== 'agent' || !n.when || outputs[n.id] == null) continue;
    const routedBy = [...new Set(refsIn(n.when).map(nodeRef).filter(Boolean).map(r => r.id))];
    for (const spec of n.context?.inputs ?? []) {
      const r = nodeRef(spec.ref); if (!r?.path.length || !workflow.nodes.some(m => m.id === r.id && m.kind === 'agent')) continue;
      const field = r.path.at(-1);
      if (outputs[r.id] != null && outputs[n.id][field] !== undefined && canonical(outputs[n.id][field]) === canonical(outputs[r.id][field])) out.push({ node: n.id, flaggedNode: r.id, field, routedBy });
    }
  }
  return out;
}

// Signals for one recorded trial. `base` is its strict replay (already proven identical). `population` = comparable trials.
export async function detect({ trial, workflow, base, population = [], kit, ctx, gate = null, withVacuity = true }) {
  gate ??= await loadGate();
  if (sealedRefusal(trial)) return { refused: 'HEAL_SEALED_REFUSED', signals: [] };
  const wf = { id: workflow.id, hash: base.workflowHash }, signals = [], oracle = trial.family ? 'present' : 'absent';
  const lint = gate.lintWorkflow(workflow, { modelPolicy: ctx.policy });
  const verdict = gate.verdictOf(base.run, { workflow });
  if (!trial.pass) signals.push(mk('ORACLE_FAILED', trial, wf, { oracle, evidence: [`results:${trial.key}`], detail: { score: trial.score } }));
  if (trial.verdict === 'pass' && !trial.pass) signals.push(mk('VERDICT_ORACLE_MISMATCH', trial, wf, { oracle, evidence: [`results:${trial.key}`], detail: { runVerdict: trial.verdict, oraclePass: false } }));
  if (trial.verdict !== 'pass' && trial.pass) signals.push(mk('VERDICT_ORACLE_MISMATCH', trial, wf, { oracle, evidence: [`results:${trial.key}`], detail: { runVerdict: trial.verdict, oraclePass: true } }));
  if (['unverified', 'inconclusive'].includes(verdict.verdict)) signals.push(mk('UNVERIFIED_VERDICT', trial, wf, { evidence: ['pinned-verdict'], detail: { verdict: verdict.verdict, code: verdict.code } }));
  for (const f of lint.findings) if (f.severity === 'error' || ['GLOBAL_READ_UNGUARDED', 'ESCALATION_WITHOUT_CHECKS'].includes(f.code))
    signals.push(mk('LINT_FINDING', trial, wf, { node: f.node, evidence: [`lint:${f.code}:${f.path}`], detail: { code: f.code, severity: f.severity, repair: f.repair?.action } }));
  for (const e of base.events) {
    if (e.type === 'model.escalated') signals.push(mk(e.rule === 'E2' ? 'CHECK_FAILED' : 'ESCALATED', trial, wf, { node: e.nodeKey, evidence: ['events'], detail: { rule: e.rule, from: e.from, to: e.to } }));
    else if (e.type === 'model.resampled') signals.push(mk('CHECK_FAILED', trial, wf, { node: e.nodeKey, evidence: ['events'], detail: { rule: 'E2-resample' } }));
  }
  for (const d of checkDisagreements({ workflow, outputs: base.outputs })) signals.push(mk('CHECK_MODEL_DISAGREEMENT', trial, wf, { node: d.node, evidence: ['outputs'], detail: d }));
  const peers = population.filter(t => t.source === trial.source && t.armId === trial.armId && t.family === trial.family);
  if (peers.length >= THRESHOLDS.minPopulation) {
    const cp = quantile(peers.map(t => t.costUsd), 0.25), lp = quantile(peers.map(t => t.latencyMs), 0.25);
    if (cp > 0 && trial.costUsd > THRESHOLDS.costOutlier * cp) signals.push(mk('COST_OUTLIER', trial, wf, { evidence: ['results'], detail: { costUsd: +trial.costUsd.toFixed(4), p25: +cp.toFixed(4), n: peers.length } }));
    if (lp > 0 && trial.latencyMs > THRESHOLDS.costOutlier * lp) signals.push(mk('LATENCY_OUTLIER', trial, wf, { evidence: ['results'], detail: { latencyMs: trial.latencyMs, p25: Math.round(lp), n: peers.length } }));
  }
  if (['COST_BUDGET', 'DEADLINE', 'STEP_BUDGET'].includes(trial.row?.error?.code) || trial.row?.costUnknown) signals.push(mk('BUDGET_BREACH', trial, wf, { evidence: ['results'] }));
  let vacuity = [];
  if (withVacuity) {
    const runIds = (population.length ? peers : [trial]).map(t => t.runId);
    vacuity = checkVacuity({ workflow, journal: ctx.journal, runIds, kit });
    for (const v of vacuity) signals.push(mk('CHECK_VACUOUS', trial, wf, { node: v.nodeKey, evidence: [`journal:${runIds.length}-runs`], detail: v }));
  }
  const byKind = {}; for (const s of signals) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
  return { signals, byKind, vacuity, lint: { ok: lint.ok, counts: lint.counts, codes: lint.codes, findings: lint.findings }, verdict, incidentKey: digest({ workflow: wf.hash, family: trial.family }).slice(0, 12) };
}

// ---- CLASSIFY (before localising) -------------------------------------------------------------------------------------
export function classifyEarly({ trial, fidelity, base }) {
  if (sealedRefusal(trial)) return { class: 'refused-sealed', heal: false, reasons: ['sealed family or split'] };
  if (!fidelity.identical) return { class: 'replay-infidelity', heal: false, reasons: Object.entries(fidelity.checks).filter(([, ok]) => !ok).map(([k]) => k) };
  const codes = [trial.row?.error?.code, ...Object.keys(trial.row?.meta?.errors ?? {})].filter(Boolean);
  if (codes.some(c => ENV_FAULTS.includes(c))) return { class: 'env', heal: false, reasons: codes.filter(c => ENV_FAULTS.includes(c)) };
  const e2 = base.events.filter(e => e.type === 'model.escalated' && e.rule === 'E2');
  if (trial.pass && e2.length) return { class: 'working-as-designed', heal: false, reasons: [`check-triggered escalation at ${e2.map(e => e.nodeKey).join(', ')} and the oracle passes: allocator data only`] };
  return { class: 'candidate', heal: true, reasons: [] };
}

// After localisation (and an optional variance test).
export function classifyLate({ localisation, variance = null, contract = null }) {
  if (localisation.blocked) return { class: 'replay-infidelity', heal: false, reasons: [localisation.blocked] };
  if (contract && !contract.referenceAccepted) return { class: 'contract-unsatisfiable', heal: false, reasons: ['the bed reference answer is rejected by the workflow\'s own acceptance'] };
  if (!localisation.root) return { class: localisation.needsLive ? 'needs-live' : 'unknown', heal: false, reasons: [localisation.note ?? 'no root'] };
  variance ??= localisation.variance?.decisive ? { ...localisation.variance, class: localisation.variance.wilsonLower > localisation.variance.tau ? 'model-variance' : 'workflow-defect' } : null;
  if (variance?.class === 'model-variance') return { class: 'model-variance', heal: true, allocatorOnly: true, reasons: [`wilson lower ${variance.wilsonLower} > tau ${variance.tau}`] };
  return { class: 'workflow-defect', heal: true, allocatorOnly: false, varianceTested: !!variance, reasons: variance ? [`wilson lower ${variance.wilsonLower} <= tau ${variance.tau}`] : ['variance not tested (needs a live provider)'] };
}
