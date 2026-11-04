#!/usr/bin/env node
// Independent check of a nodecap run's acquisitions (ARCHITECTURE.md §2.9), development tool:
//   1. recompute every member decision (grant or refusal) from its recorded features with the pure broker rule, and compare;
//   2. chain audit: every dispatcher member call that succeeded was bound in the lock or preceded by a grant decision of this run, and
//      every effectful (act) call has a user approval.decided for its approval id in the chain;
//   3. every nodecap decision names the lock and envelope the run was launched under.
// Reads only the workspace store and the lock; never calls a server or a model. Usage: node verify-acquisitions.mjs <workspace> <runId> <lock.json>
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Store } from '../../src/store.mjs';
import { verifyRun } from '../../src/verify-run.mjs';
import { decideMember } from '../../src/capabilities/broker.mjs';
import { nodecapDecisions } from '../../src/capabilities/journal.mjs';
import { DEFAULT_ENVELOPE, checkEnvelope } from '../../src/capabilities/envelope.mjs';
import { digest } from '../../src/data.mjs';

export function verifyAcquisitions({ store, runId, lock, envelope = checkEnvelope(DEFAULT_ENVELOPE) }) {
  const lockHash = `sha256:${digest(lock)}`, findings = [], add = (code, detail) => findings.push({ code, ...detail });
  const chain = verifyRun(store, runId);
  if (!chain.ok) add('CHAIN', { detail: (chain.findings ?? []).filter(f => f.severity === 'error').map(f => f.code).slice(0, 5) });
  const decisions = nodecapDecisions(store, runId), events = store.events(runId);
  let recomputed = 0;
  for (const d of decisions) {
    if (d.features.lockHash !== lockHash) add('LOCK_MISMATCH', { id: d.id });
    if (!d.features.member || !['implicit', 'act', 'request'].includes(d.features.via) || !['granted', 'refused'].includes(d.action.result)) continue;
    const member = lock.members[d.features.member];
    if (!member) { add('MEMBER_OUTSIDE_LOCK', { id: d.id, member: d.features.member }); continue; }
    const again = decideMember(d.features, member, envelope);
    recomputed++;
    if (again.result !== d.action.result || (again.code ?? null) !== (d.action.code ?? null) || (again.level ?? null) !== (d.action.level ?? null)) add('DECISION_MISMATCH', { id: d.id, recorded: d.action.result, recomputed: again.result });
  }
  // Chain audit over the dispatcher outputs in event order.
  const seqOfDecision = new Map(events.filter(e => e.type === 'decision.recorded').map(e => [e.id, e.seq]));
  const grants = decisions.filter(d => d.action.result === 'granted').map(d => ({ node: d.features.node, member: d.action.member, seq: seqOfDecision.get(d.id) ?? Infinity, level: d.action.level, approvalId: d.features.approvalId ?? null }));
  let calls = 0;
  for (const e of events) {
    const m = /\/([A-Za-z][A-Za-z0-9_-]*)__loop:\d+\/(do|act)$/.exec(e.nodeKey ?? '');
    if (e.type !== 'node.completed' || !m || !e.output?.ok || !e.output.member) continue;
    calls++;
    const [, node, body] = m, section = lock.nodes[node], member = e.output.member;
    const bound = section && (section.bound.includes(member) || section.skills.includes(member));
    const granted = grants.some(g => g.node === node && g.member === member && g.seq < e.seq);
    if (!bound && !granted) add('UNGRANTED_CALL', { nodeKey: e.nodeKey, member });
    if (body === 'act') {
      const approvalId = events.findLast(x => x.type === 'approval.requested' && x.nodeKey === e.nodeKey && x.seq < e.seq)?.approvalId;
      if (!approvalId || !events.some(x => x.type === 'approval.decided' && x.approvalId === approvalId && x.approved === true && x.actor === 'user' && x.seq < e.seq)) add('EFFECT_WITHOUT_APPROVAL', { nodeKey: e.nodeKey, member });
    }
  }
  return { ok: findings.length === 0, runId, lockHash, decisions: decisions.length, recomputed, calls, findings };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [workspace, runId, lockFile] = process.argv.slice(2);
  if (!workspace || !runId || !lockFile) { console.error('usage: verify-acquisitions.mjs <workspace> <runId> <lock.json>'); process.exit(2); }
  const store = new Store(workspace);
  try {
    const report = verifyAcquisitions({ store, runId, lock: JSON.parse(readFileSync(lockFile, 'utf8')) });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  } finally { store.close(); }
}
