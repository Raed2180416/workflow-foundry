// P09 judge -> confidence gate -> review queue (escalate, never guess) — L1-PATTERNS §4. Fragment -> {decided, review_queue}.
// Slots: ITEMS (path), DECIDE (judge: {choice: enum incl. 'undecidable', quote}), SAMPLES (int[2,5]), AGREE (fn votes -> bool;
// reads enum fields only), QUEUE_REASON (enum[]), CONCURRENCY (int[1,8]).
// flow.flagged (the L0 changes note) is not in flow-v3, so the vote is taken in code over SAMPLES identical judge calls
// (the option L1-PATTERNS §4 names); autoFlag still marks escalations in the trace.
export default async function P09(flow, task, x, S) {
  const items = S.ITEMS(task, x);
  const out = await flow.map(items, async it => {
    const votes = [];
    for (let s = 0; s < S.SAMPLES; s++) votes.push(await flow.judge('decide', judgeSpec(S.DECIDE, it)));   // cap: SAMPLES, int[2,5]
    const undecided = votes.some(v => v.choice === 'undecidable');
    const reason = undecided ? 'undecidable' : S.AGREE(votes) ? null : 'split-vote';
    if (reason) {
      flow.invariant('queue-reason-known', S.QUEUE_REASON.includes(reason), { reason });
      return { id: it.id, queue: { reason, quote: (votes.find(v => v.quote) ?? { quote: '' }).quote } };
    }
    return { id: it.id, decided: votes[0].choice };
  }, { concurrency: S.CONCURRENCY });
  flow.invariant('each-once', out.length === items.length, {});
  return { decided: out.filter(o => o.decided).map(o => ({ id: o.id, choice: o.decided })), review_queue: out.filter(o => o.queue).map(o => ({ id: o.id, ...o.queue })) };
}
