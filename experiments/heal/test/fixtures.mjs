// Incident fixtures for the verification tests: the object verify() needs for a recorded failing trial, built from a synthetic
// localisation row (the flip the real localiser found), the recorded journals and the bed.
import assert from 'node:assert/strict';
import { buildIncident } from '../heal.mjs';
import { finish } from '../localise.mjs';
import { compileOps } from '../ops.mjs';
import { verify } from '../verify.mjs';
import { Budget } from '../budget.mjs';
import { openCtx, replayRun, taskOf, acceptedCalls } from '../replay.mjs';
import { digest } from '../ir.mjs';
import { world, byKey, modelIds } from './helpers.mjs';

const cache = new Map();
export async function incidentFor(key, wfName, flipRow) {
  if (cache.has(key)) return cache.get(key);
  const { kit, gate, trials, wf } = await world(), trial = byKey(trials, key), workflow = wf[wfName];
  const ctx0 = await openCtx(trial.source, { kit, name: 'fx' }), task = await taskOf(trial), base = await replayRun(ctx0, workflow, trial, { task });
  const loc = finish({ head: { base: { pass: false, score: trial.score } }, rows: [flipRow(ctx0, trial)], workflow });
  const pool = trials.filter(t => t.source === trial.source && t.armId === trial.armId && t.family === trial.family);
  const incident = await buildIncident({ kit, trial, workflow, pool, localisation: loc, ctx0, base, bed: { task } });
  incident.id = `fx-${wfName}`;
  const out = { kit, gate, trials, wf, trial, workflow, ctx0, loc, incident, task, base, policy: kit.sessionPolicy(modelIds) };
  cache.set(key, out); return out;
}
export const recordsFlip = (ctx0, trial) => { const row = acceptedCalls(ctx0.journal, trial.runId).find(r => r.nodeKey === 'root/conf');
  return { id: 'c6', node: 'conf', nodeKey: 'root/conf', type: 'inject', path: 'orders.0.numeric_order', pathArr: ['orders', 0, 'numeric_order'], rowId: row.id, from: 'MDY', to: 'DMY', identity: { system: 'BRIGHTDESK' }, ran: true, pass: true, score: 1, deltaScore: 0.21, changedShare: 0.31, needsLive: false }; };
export const codefixFlip = () => ({ id: 'c15', node: 'check1', nodeKey: 'root/check1', type: 'pin', path: 'ok', pathArr: ['ok'], from: false, to: true, ran: true, pass: true, score: 1, deltaScore: 0.04, changedShare: 1, needsLive: false });
export const envOf = ({ kit, gate, policy }) => ({ classOrder: policy.classOrder, classOf: id => kit.policy.modelById(policy, id).class, isStrong: gate.isStrong });
export function proposalFrom(w, base, ops, extra = {}) {
  const c = compileOps(base, ops, { ...envOf(w), allowed: null, locus: null });
  assert.deepEqual(c.errors, [], JSON.stringify(c.errors));
  return { id: `t-${digest(ops).slice(0, 6)}`, kind: 'defect', ops, workflow: c.workflow, candidateHash: c.candidateHash, proofs: c.proofs, waivers: c.waivers, probes: c.probes, touched: c.touched, ...extra };
}
export const freshHook = (wins = { base: true, cand: true }) => ({ ledger: { schema: 'x', entries: [], referenceHashes: {} }, saveLedger: () => {}, runTask: async ({ arm }) => ({ pass: wins[arm], costUsd: 0 }) });
export const runVerify = (w, { base, proposal, extra = {} }) => verify({ kit: w.kit, gate: w.gate, budget: new Budget(5), base: { workflow: base, hash: digest(base) }, proposal, incident: w.incident, sourcePolicy: w.policy, ...extra });
