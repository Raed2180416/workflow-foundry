// WorkBench extras: the reuse streams and the fault/drift subset (research/breadth-20261021/PLAN.md §4.3 T1-1 "Extras",
// §3.2 "Adaptivity" and "Reuse over recurring streams"). Rule wb-extras-v1.
//
// THE RULE IS FIXED BY THE COMMIT THAT ADDS THIS FILE (the "extras-rule commit"), before any model run on WorkBench and
// before its salt exists:
//   salt = the full 40-hex SHA of the first commit on refs/heads/claude/intelligent-hamilton-vg1f9a whose subject starts
//          with "WIP:" (an orchestrator autosave) and whose committer timestamp is strictly later than the extras-rule
//          commit's committer timestamp.
// Both sets are held out: their content stays host-only (outside the repository); only manifest hashes are committed.
//
// 1. Reuse streams (20 streams × 10 instances, H2-ext by construction).
//    Templates: the 40 held-out templates of SPLIT.json (wb-split-v1). Per domain, ordered by ascending
//    sha256(salt + ':stream:' + template_id); the domain takes half its held-out templates, rounded down, and the 20 - sum
//    remaining places go to the domains with the largest fractional half (all ties: domain name order). Streams are
//    listed in domain name order, then hash order.
//    Instances: WorkBench's own generators (bed.py regen, the shipped world) with seed 8860, then 8861 ... 8869 to top up;
//    within a seed, generator order. An instance is skipped when its task text equals a shipped task text, a sealed or
//    companion instance text, or an earlier instance of the same stream, or when its gold does not replay cleanly. The
//    first 10 kept are the stream, in that order (the arrival order of the recurring stream). Each stream records how
//    many distinct gold lists it holds and how many instances differ from the stream's first gold (the naive-reuse
//    exposure); nothing is filtered on these.
// 2. Fault/drift subset (20 units, paired with the same instances' clean sealed runs).
//    Population: instances of the primary sealed manifest (wb-sealed-v1) whose gold has at least one write.
//    Order: ascending sha256(salt + ':fault:' + instance id); the first 20. Unit i (0-based) gets FAULT_KINDS[i % 4]:
//      transient     the session's first write call is answered "503 Service Unavailable" and NOT applied (retry needed)
//      lost_ack      the session's first write call IS applied but answered with a timeout error (a blind retry
//                    duplicates the effect; checking the world first does not)
//      rename_param  drift: in the tool of gold's first write, one parameter is renamed (RENAME below) in the schema the
//                    model sees; the host maps it back; the old name is refused with an "unknown parameter" error
//      distractor    a retired twin of gold's first write tool (`<name>_v2`, same schema) is listed; calling it changes
//                    nothing and answers "this endpoint is retired"
//    Grading is unchanged (WorkBench is_correct on the world's journaled actions); a fault is never an environment fault.
import { createHash } from 'node:crypto';

export const EXTRAS_RULE = Object.freeze({
  version: 'wb-extras-v1',
  saltSource: Object.freeze({ ref: 'refs/heads/claude/intelligent-hamilton-vg1f9a', subjectPrefix: 'WIP:', after: 'extras-rule commit (committer timestamp, strict)' }),
  streams: Object.freeze({ n: 20, perStream: 10, seed: 8860, topUpSeeds: Object.freeze([8861, 8862, 8863, 8864, 8865, 8866, 8867, 8868, 8869]) }),
  faults: Object.freeze({ n: 20 }),
});
export const FAULT_KINDS = Object.freeze(['transient', 'lost_ack', 'rename_param', 'distractor']);
/** Drift renames per write tool (bed name -> [old parameter, new parameter]). */
export const RENAME = Object.freeze({
  'calendar.create_event': ['participant_email', 'attendee_email'],
  'calendar.delete_event': ['event_id', 'id'],
  'calendar.update_event': ['new_value', 'value'],
  'email.send_email': ['recipient', 'to'],
  'email.forward_email': ['recipient', 'to'],
  'email.reply_email': ['body', 'message'],
  'email.delete_email': ['email_id', 'id'],
  'project_management.create_task': ['assigned_to_email', 'assignee_email'],
  'project_management.update_task': ['new_value', 'value'],
  'project_management.delete_task': ['task_id', 'id'],
  'customer_relationship_manager.add_customer': ['assigned_to_email', 'owner_email'],
  'customer_relationship_manager.update_customer': ['new_value', 'value'],
  'customer_relationship_manager.delete_customer': ['customer_id', 'id'],
  'analytics.create_plot': ['value_to_plot', 'metric'],
});

const sha256 = s => createHash('sha256').update(s, 'utf8').digest('hex');
export const toolOfAction = a => a.split('(')[0].replace(/\.func$/, '');

/** The salt: from `git log` lines "<sha> <committer epoch> <subject>", the earliest autosave strictly after ruleEpoch. */
export function pickExtrasSalt(logLines, ruleEpoch) {
  const rows = logLines.map(l => /^([0-9a-f]{40}) (\d+) (.*)$/.exec(l)).filter(Boolean).map(m => ({ sha: m[1], epoch: Number(m[2]), subject: m[3] }));
  return rows.filter(r => r.epoch > ruleEpoch && r.subject.startsWith(EXTRAS_RULE.saltSource.subjectPrefix)).sort((a, b) => a.epoch - b.epoch)[0] ?? null;
}

/** Per-domain stream counts: half of each domain's held-out templates, rounded down, then largest remainders. */
export function streamQuota(heldOutTemplates, n = EXTRAS_RULE.streams.n) {
  const per = {};
  for (const t of heldOutTemplates) { const d = t.split('/')[0]; per[d] = (per[d] ?? 0) + 1; }
  const total = heldOutTemplates.length;
  const domains = Object.keys(per).sort();
  const exact = Object.fromEntries(domains.map(d => [d, (per[d] * n) / total]));
  const q = Object.fromEntries(domains.map(d => [d, Math.floor(exact[d])]));
  let left = n - Object.values(q).reduce((a, b) => a + b, 0);
  const byRemainder = [...domains].sort((a, b) => (exact[b] - Math.floor(exact[b])) - (exact[a] - Math.floor(exact[a])) || (a < b ? -1 : 1));
  for (const d of byRemainder) { if (left <= 0) break; q[d] += 1; left -= 1; }
  return q;
}

/** The 20 stream templates, in domain name order, then hash order. */
export function streamTemplates(heldOutTemplates, salt) {
  if (!/^[0-9a-f]{40}$/.test(String(salt))) throw new Error('salt must be a 40-hex commit SHA');
  const q = streamQuota(heldOutTemplates);
  const out = [];
  for (const d of Object.keys(q).sort()) {
    const ranked = heldOutTemplates.filter(t => t.startsWith(`${d}/`)).map(t => ({ t, k: sha256(`${salt}:stream:${t}`) })).sort((a, b) => (a.k < b.k ? -1 : 1));
    out.push(...ranked.slice(0, q[d]).map(r => r.t));
  }
  return out;
}

/** One stream from regenerated rows (seeds in order, generator order within a seed). */
export function pickStream(templateId, rowsBySeed, excludedTexts, cleanIds, n = EXTRAS_RULE.streams.perStream) {
  const taken = [], skipped = { textDuplicate: 0, goldNotClean: 0 };
  for (const [seed, rows] of rowsBySeed) {
    for (const r of rows) {
      if (taken.length >= n) break;
      if (r.template_id !== templateId) continue;
      if (excludedTexts.has(r.task) || taken.some(t => t.task === r.task)) { skipped.textDuplicate++; continue; }
      if (!cleanIds.has(r.id)) { skipped.goldNotClean++; continue; }
      taken.push({ ...r, seed });
    }
    if (taken.length >= n) break;
  }
  const first = taken[0] ? JSON.stringify(taken[0].outcome) : null;
  return { taken, skipped, distinctGold: new Set(taken.map(t => JSON.stringify(t.outcome))).size, differFromFirst: taken.filter(t => JSON.stringify(t.outcome) !== first).length };
}

/** The fault/drift units from the primary sealed instances. */
export function faultUnits(sealedInstances, salt, writeTools, n = EXTRAS_RULE.faults.n) {
  if (!/^[0-9a-f]{40}$/.test(String(salt))) throw new Error('salt must be a 40-hex commit SHA');
  const pop = sealedInstances.filter(t => t.outcome.some(a => writeTools.has(toolOfAction(a))));
  const ranked = pop.map(t => ({ t, k: sha256(`${salt}:fault:${t.id}`) })).sort((a, b) => (a.k < b.k ? -1 : 1)).slice(0, n).map(r => r.t);
  return ranked.map((t, i) => {
    const kind = FAULT_KINDS[i % FAULT_KINDS.length];
    const firstWrite = toolOfAction(t.outcome.find(a => writeTools.has(toolOfAction(a))));
    const spec = kind === 'transient' || kind === 'lost_ack' ? { kind, target: 'write', nth: 1 }
      : kind === 'rename_param' ? { kind, tool: firstWrite, from: RENAME[firstWrite][0], to: RENAME[firstWrite][1] }
        : { kind, like: firstWrite };
    return { id: t.id, template_id: t.template_id, domain: t.domain, fault: spec };
  });
}
