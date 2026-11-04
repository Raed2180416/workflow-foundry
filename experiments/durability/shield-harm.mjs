// DUR-1 +SH ablation: a harm shield on the effect boundary (PREREG-DUR-1 §8.4; BUILD-PLAN row 16). $0, B-tier. Applied to
// S-H* and to MH-H's version timelines (no re-heal); reported: silent critical cases turned into loud refusals, and
// refusals of correct effects. Policy (oracle-free; the shield reads only the systems of record through ctx.query, as an
// arm could): refuse (1) a second charge for a fulfilment, (2) a refund above the committed charge's remainder, (3) a
// charge on an ended order, (4) a repeated notice of a template to the same subject.
// Deviation, disclosed: the prereg names experiments/constitution/port.mjs effectPort, whose only actions are allow and
// hold-for-approval; E8's actors never answer approval tasks, so a hold would be a refusal plus human tasks the grader
// counts as over-escalation. The shield therefore refuses (drops) the effect and journals the refusal in the tick's
// decisions (E8 grades `subject` only), which makes it loud to the deployment.
const ENDED = new Set(['cancelled', 'failed', 'timedOut', 'completed']);
const norm = s => (typeof s === 'string' ? s.trim().replace(/^#/, '').toUpperCase() : null);

/** The harm policy: refuse(effect, ctx) -> null (allow) or a reason. */
export function harmPolicy(e, ctx) {
  const a = e.args ?? {};
  const q = (t, f) => { try { return ctx.query(t, f) ?? []; } catch { return []; } };
  if (e.system === 'billing' && e.op === 'charge') {
    if (q('billing.charges', { fulfilmentId: a.fulfilmentId }).length) return 'second charge for a fulfilment';
    const o = q('orders.orders', { orderId: norm(a.orderId) })[0];
    if (o && ENDED.has(o.status)) return `charge on an ended order (${o.status})`;
  }
  if (e.system === 'billing' && e.op === 'refund') {
    const c = q('billing.charges', { fulfilmentId: a.fulfilmentId })[0];
    const amount = a.amountMinor ?? a.amount;
    if (!c) return 'refund without a committed charge';
    if (typeof amount === 'number' && amount > c.amountMinor - (c.refundedMinor ?? 0)) return 'refund above the committed charge';
  }
  if (e.system === 'notify' && e.op === 'send') {
    if (q('notify.notifications', { about: a.about, template: a.template }).length) return 'repeated notice of a template to the same subject';
  }
  return null;
}

/** harmShield(arm) → arm: refused effects are dropped (with the effects that name them in `after`) and journaled. */
export function harmShield(inner, { policy = harmPolicy } = {}) {
  const log = [];
  return {
    id: `${inner.id}+SH`,
    log,
    async tick(input, ctx) {
      const out = await inner.tick(input, ctx);
      if (!out || !Array.isArray(out.effects) || !out.effects.length) return out;
      const refused = [], keep = [];
      for (const e of out.effects) { const why = policy(e, ctx); if (why) refused.push({ key: e.key ?? null, system: e.system, op: e.op, why }); else keep.push(e); }
      if (!refused.length) return out;
      const gone = new Set(refused.map(r => r.key).filter(Boolean));
      const kept = keep.filter(e => !gone.has(e.after));
      for (const r of refused) log.push({ at: input.now, instance: input.instance, ...r });
      return { ...out, effects: kept, decisions: { ...(out.decisions ?? {}), dur1Shield: refused } };
    },
    close() { inner.close?.(); },
  };
}

/** Shield refusals of a journal (the loud signals the ablation adds): [{ at, instance, refused: [...] }]. */
export function shieldRefusals(rows) {
  let now = null;
  const out = [];
  for (const r of rows) {
    if (r.type === 'wakeup') now = r.at;
    if (r.type === 'call' && r.output?.decisions?.dur1Shield?.length) out.push({ at: now, instance: r.target, refused: r.output.decisions.dur1Shield });
  }
  return out;
}
