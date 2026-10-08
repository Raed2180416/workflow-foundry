// PROMOTE and ROLLBACK (DESIGN §9). `decide` is a pure function of the verification record: the proposer, its rationale and
// the model never reach it. A promotion is a compare-and-swap on the lineage head (the kit Store's saveWorkflow with
// expectedHash) plus one line in lineage.jsonl; a rollback is a second compare-and-swap that restores the parent's content as a
// new version. Frozen artifacts and pre-registered arms are never touched: a promoted head only serves heal-scoped runs.
import path from 'node:path';
import { appendFileSync, mkdirSync, readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { REPO } from './kit.mjs';
import { digest, clone } from './ir.mjs';
import { reviewReasons } from './ops.mjs';

export const LINEAGE = 'heal-lineage/1';
export const LINEAGE_FILE = path.join(REPO, 'research/heal-20261008/lineage.jsonl');
export const DECISIONS = Object.freeze(['promote', 'owner-review', 'reject', 'pending', 'blocked', 'exhausted']);
export const MAX_DEPTH = 3;   // the repair lifecycle's lineage depth (docs/REPAIR-LIFECYCLE.md)

// ---- the gate: pure --------------------------------------------------------------------------------------------------------------
export function decide(verification, proposal, policy = {}) {
  const P = { autoPromote: true, costReview: 1.25, ...policy };
  if (verification?.rejectCode === 'HEAL_EXHAUSTED' || proposal?.exhausted) return { decision: 'exhausted', reasons: ['round or budget limit reached'] };
  if (!verification || verification.schema !== 'heal-verification/1') return { decision: 'reject', reasons: ['no verification record'] };
  if (verification.rejectCode) return { decision: 'reject', reasons: [verification.rejectCode] };
  if (verification.pending) return { decision: 'pending', reasons: verification.stages.filter(s => s.ok === null).map(s => `${s.id}:${s.code}`) };
  if (!verification.ok) return { decision: 'reject', reasons: ['a stage did not pass'] };
  if (verification.partial) return { decision: 'pending', reasons: [`partial verification (stages ${verification.stages.map(s => s.id).join(',')}): a promotion needs V0..V8`] };
  if ((proposal.depth ?? 0) > MAX_DEPTH) return { decision: 'exhausted', reasons: [`lineage depth ${proposal.depth} exceeds ${MAX_DEPTH}`] };
  if (verification.lintDebtOpen && proposal.kind === 'defect') return { decision: 'blocked', reasons: ['lint errors remain on the candidate: heal the lint debt first'] };
  const reasons = reviewReasons(proposal.ops ?? [], { costRatio: verification.costRatio ?? 1 });
  if (reasons.some(r => r.startsWith('cost ratio'))) { /* already phrased */ }
  if ((proposal.ops ?? []).some(o => o.op === 'strengthen_acceptance' && o.via === 'check')) reasons.push('acceptance change beyond the mechanical lint-debt forms');
  if (!P.autoPromote) reasons.push('auto-promotion disabled by policy');
  return reasons.length ? { decision: 'owner-review', reasons } : { decision: 'promote', reasons: [] };
}

// ---- circuit breaker (DESIGN §9): pure over use histories --------------------------------------------------------------------------
// A use: { pass: boolean (oracle or caught), mismatch: boolean (verdict vs oracle) }.
export function circuitBreaker(uses, parentUses = [], { canaryAccepted = false, probeRegression = false } = {}) {
  if (canaryAccepted) return { rollback: true, reason: 'a canary (bad control) is newly accepted' };
  if (probeRegression) return { rollback: true, reason: 'a construction probe regressed' };
  let run = 0; for (const u of uses.slice().reverse()) { if (u.pass) break; run++; }
  if (run >= 3) return { rollback: true, reason: `${run} consecutive failures` };
  if (uses.length >= 5 && uses.filter(u => u.pass).length / uses.length <= 0.5) return { rollback: true, reason: `success ${uses.filter(u => u.pass).length}/${uses.length} <= 0.5` };
  const rate = xs => xs.length ? xs.filter(u => u.mismatch).length / xs.length : 0;
  if (uses.length >= 5 && rate(uses) > rate(parentUses)) return { rollback: true, reason: `verdict-vs-oracle mismatch rate ${rate(uses).toFixed(2)} above the parent's ${rate(parentUses).toFixed(2)}` };
  return { rollback: false, reason: null };
}

const atomicWrite = (file, text) => { mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, text); renameSync(tmp, file); };

// ---- lineage -----------------------------------------------------------------------------------------------------------------------
export class Lineage {
  constructor({ kit, dir, file = LINEAGE_FILE }) {
    this.kit = kit; this.file = file; this.dir = dir; mkdirSync(dir, { recursive: true });
    this.store = new kit.Store(dir);
    this.shadowFile = path.join(dir, 'shadow.json');
  }
  close() { this.store.close(); }
  // Register the base version as the head if the lineage is new. The kit store insists the first version is 1.
  open(workflow) {
    let head; try { head = this.store.workflow(workflow.id); } catch (e) { if (e.code !== 'NOT_FOUND' && !/not found|unknown/i.test(e.message)) throw e; }
    if (head) return { hash: head.hash, workflow: head.workflow, created: false };
    if (workflow.version !== 1) throw Object.assign(new Error(`HEAL_LINEAGE_BASE: the base workflow is version ${workflow.version}; a lineage starts at version 1`), { code: 'HEAL_LINEAGE_BASE' });
    const saved = this.store.saveWorkflow(workflow);
    return { hash: saved.hash, workflow: saved.workflow, created: true };
  }
  head(id) { const h = this.store.workflow(id); return { hash: h.hash, workflow: h.workflow }; }
  lines() { return existsSync(this.file) ? readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []; }
  depthOf(id) { return this.lines().filter(l => l.workflowId === id && l.type === 'promote').length; }
  append(line) { mkdirSync(path.dirname(this.file), { recursive: true }); appendFileSync(this.file, JSON.stringify({ schema: LINEAGE, at: new Date().toISOString(), ...line }) + '\n'); return line; }

  // Compare-and-swap promotion: only the decision 'promote' can pass; a lost swap is STALE_WORKFLOW (another heal moved the head).
  promote({ proposal, verification, decision, kitHash, lintPin, policyHash }) {
    if (decision?.decision !== 'promote') throw Object.assign(new Error(`HEAL_NOT_PROMOTABLE: decision is ${decision?.decision}`), { code: 'HEAL_NOT_PROMOTABLE' });
    if (verification.candidateHash !== digest(proposal.workflow)) throw Object.assign(new Error('HEAL_CANDIDATE_CHANGED: the verified candidate is not the proposal workflow'), { code: 'HEAL_CANDIDATE_CHANGED' });
    const head = this.head(proposal.workflow.id);
    if (proposal.base?.hash && proposal.base.hash !== verification.baseHash) throw Object.assign(new Error('HEAL_BASE_MISMATCH: the proposal is bound to a different base than the one that was verified'), { code: 'HEAL_BASE_MISMATCH' });
    if (head.hash !== verification.baseHash) throw Object.assign(new Error('STALE_WORKFLOW: the lineage head moved since this proposal was verified'), { code: 'STALE_WORKFLOW', details: { expectedHash: verification.baseHash, currentHash: head.hash } });
    const saved = this.store.saveWorkflow(proposal.workflow, { expectedHash: head.hash });
    this.append({ type: 'promote', workflowId: proposal.workflow.id, proposalId: proposal.id, kind: proposal.kind, parentHash: head.hash, newHash: saved.hash, newVersion: proposal.workflow.version,
      ops: proposal.ops.map(o => o.op), proposer: proposal.proposer?.mechanical ? { mechanical: proposal.proposer.mechanical } : { modelId: proposal.proposer?.modelId, class: proposal.proposer?.class, briefHash: proposal.proposer?.briefHash },
      verification: { digest: digest(verification.stages.map(s => [s.id, s.ok, s.code ?? null])), costUsd: verification.costUsd, costRatio: verification.costRatio ?? null, stages: verification.stages.map(s => ({ id: s.id, ok: s.ok })) },
      decision: decision.decision, healedWithoutOracle: !!proposal.healedWithoutOracle, kitHash, lintPin, policyHash, waivers: proposal.waivers ?? [], probes: proposal.probes ?? [] });
    return { hash: saved.hash, version: proposal.workflow.version, parentHash: head.hash };
  }
  // A proposal that passed every gate but needs a person: queued, no head change. Approval is an explicit owner action.
  queueReview({ proposal, verification, decision }) {
    return this.append({ type: 'review', workflowId: proposal.workflow.id, proposalId: proposal.id, kind: proposal.kind, baseHash: verification.baseHash, candidateHash: verification.candidateHash, ops: proposal.ops, reasons: decision.reasons, status: 'awaiting-owner' });
  }
  approveReview({ proposal, verification, owner }) {
    if (typeof owner !== 'string' || !owner) throw Object.assign(new Error('HEAL_OWNER_REQUIRED: approval is an explicit owner action'), { code: 'HEAL_OWNER_REQUIRED' });
    return this.promote({ proposal, verification, decision: { decision: 'promote', reasons: [`approved by ${owner}`] }, kitHash: null, lintPin: null, policyHash: null });
  }
  rollback({ id, toHash, reason }) {
    const head = this.head(id), parent = this.store.workflow(toHash);
    const restored = { ...clone(parent.workflow), version: head.workflow.version + 1 };
    const saved = this.store.saveWorkflow(restored, { expectedHash: head.hash });
    this.append({ type: 'rollback', workflowId: id, fromHash: head.hash, restoresContentOf: toHash, newHash: saved.hash, newVersion: restored.version, reason });
    return { hash: saved.hash, version: restored.version };
  }
  // Shadow period: each use of a promoted head (run alongside its parent) is recorded; the breaker decides.
  uses() { return existsSync(this.shadowFile) ? JSON.parse(readFileSync(this.shadowFile, 'utf8')) : {}; }
  recordUse(hash, use) { const all = this.uses(); (all[hash] ??= []).push({ at: new Date().toISOString(), ...use }); atomicWrite(this.shadowFile, JSON.stringify(all, null, 1) + '\n'); return all[hash].length; }
  evaluate({ id, parentHash, flags = {} }) {
    const head = this.head(id), all = this.uses();
    const verdict = circuitBreaker(all[head.hash] ?? [], all[parentHash] ?? [], flags);
    return verdict.rollback ? { ...verdict, rolledBack: this.rollback({ id, toHash: parentHash, reason: verdict.reason }) } : verdict;
  }
}
