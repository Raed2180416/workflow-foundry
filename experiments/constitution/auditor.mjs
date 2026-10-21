// The scripted auditor (ATTACK-FABLE §2.2 item 3, §3.3): five population queries and a 10-case sample walkthrough,
// answered from an evidence pack alone: the host journal (full rows with their hash chain) and, when the organisation
// has one, the constitution registry's journal. No world, no truth label, no harness state. Each query reports whether
// it is answerable, its population, and why not; groundTruth() computes the same populations analyst-side (world truth,
// the registry object, the port's in-memory log, the solver's source hash) and compare() reads pass/fail per query:
// pass = answered from the pack alone and the population equals the ground truth.
//   Q1 versions of the workflow that ran in the period (with first/last tick), complete over every case-tick
//   Q2 constitution versions in the period with proposer, approvers and the gate decision
//   Q3 refunds above the threshold pinned for their order, with approver and SoD check
//   Q4 enforcement interventions (holds, releases, break-glass, suppressions)
//   Q5 runs whose journaled constitution hash differs from the version in force at their order's placement
import { verifyChain } from '../../beds/ebed/host/journal.mjs';
import { verifyRegistryChain } from './registry.mjs';
import { holds, thresholdOf } from './constitution.mjs';
import { parseJournal } from './observer.mjs';
import { APPROVAL_KIND } from './overlay.mjs';
import { rng } from '../../beds/lib/rng.mjs';

const norm = s => (typeof s === 'string' ? s.trim().replace(/^#/, '').toUpperCase() : null);
const ms = s => (typeof s === 'number' ? s : Date.parse(s));
const strip = r => { const { seq, prev, hash, ...c } = r; return c; };

/** A registry read from its journal rows only (versions, approvals, the gate's recorded decisions). */
function registryFromRows(rows) {
  const vs = new Map();
  for (const r of rows) {
    if (r.type === 'proposed') vs.set(r.versionHash, { version: r.version, hash: r.versionHash, doc: r.doc, proposedBy: r.by, proposedAt: r.at, approvals: [], decision: 'pending', reasons: [], decidedAt: null });
    else if (r.type === 'approval') vs.get(r.versionHash)?.approvals.push({ by: r.by, at: r.at });
    else if (r.type === 'gate') Object.assign(vs.get(r.versionHash) ?? {}, { decision: r.decision, reasons: r.reasons, decidedAt: r.at });
  }
  const list = [...vs.values()];
  const inForceAt = t => list.filter(v => v.decision === 'accepted' && ms(v.doc.effectiveFrom) <= ms(t) && ms(v.decidedAt) <= ms(t))
    .sort((a, b) => ms(a.doc.effectiveFrom) - ms(b.doc.effectiveFrom)).at(-1) ?? null;
  return { list, inForceAt, byHash: h => vs.get(h) ?? null };
}

/** Run the five queries and the walkthrough on an evidence pack { host: full host journal rows, registry: registry rows | null }. */
export function audit({ host, registry = null, sampleSize = 10 }) {
  const Q = {};
  let chain = true;
  try { verifyChain(host); } catch { chain = false; }
  const rows = host.map(strip);
  const J = parseJournal(rows);
  const complete = chain && !!J.end;
  let reg = null, regChain = null;
  if (registry) { try { verifyRegistryChain(registry); regChain = true; } catch { regChain = false; } reg = registryFromRows(registry); }
  const okCalls = J.calls.filter(c => c.outcome === 'ok' && c.output?.decisions);
  const K = c => c.output?.decisions?.constitution ?? null;

  // Q1
  {
    const why = [];
    if (!complete) why.push(chain ? 'the journal has no run.end: the population may be incomplete' : 'the host journal chain does not verify');
    const missing = okCalls.filter(c => !K(c)?.workflow).length;
    if (missing) why.push(`${missing} of ${okCalls.length} case-ticks journal no workflow hash; the journal names the arm only by its label (${J.start?.arm ?? '?'}) and the spec hash, which do not identify the code that ran`);
    const pop = new Map();
    for (const c of okCalls) { const h = K(c)?.workflow; if (!h) continue; const p = pop.get(h) ?? { workflow: h, ticks: 0, first: c.at, last: c.at }; p.ticks += 1; p.last = c.at; pop.set(h, p); }
    Q.Q1 = { answerable: !why.length, population: [...pop.values()].map(p => ({ ...p, first: new Date(p.first).toISOString(), last: new Date(p.last).toISOString() })), why, ticks: okCalls.length };
  }
  // Q2
  {
    const why = [];
    if (!reg) why.push('no constitution registry journal in the evidence: no version, proposer or approver is recorded anywhere');
    else if (!regChain) why.push('the registry journal chain does not verify');
    const pinned = new Set(okCalls.flatMap(c => Object.values(K(c)?.pins ?? {})));
    if (reg) for (const h of pinned) if (!reg.byHash(h)) why.push(`pinned hash ${h.slice(0, 12)} is not in the registry`);
    Q.Q2 = { answerable: !why.length, population: reg ? reg.list.map(v => ({ version: v.version, hash: v.hash, proposedBy: v.proposedBy, approvers: v.approvals.map(a => a.by), decision: v.decision, reasons: v.reasons, effectiveFrom: v.doc.effectiveFrom })) : [], why };
  }
  // Orders, placements and SoD sets from deliveries.
  const placed = new Map(), entered = new Map();
  for (const d of J.deliveries) {
    const e = d.event, p = e.payload ?? {};
    if (e.type === 'order.placed') { const O = norm(p.orderId); if (!placed.has(O)) placed.set(O, ms(p.placedAt)); }
    else if (e.type === 'migration') { for (const r of p.records?.['orders.orders'] ?? []) if (!placed.has(norm(r.orderId))) placed.set(norm(r.orderId), ms(r.placedAt)); }
    else if (e.type === 'customer.action' && ['amend', 'cancel'].includes(p.action)) {
      const O = norm(p.orderRef); const s = entered.get(O) ?? new Map(); s.set(e.id, p.enteredBy ?? null); entered.set(O, s);
    }
  }
  const pins = new Map();
  for (const c of okCalls) for (const [O, h] of Object.entries(K(c)?.pins ?? {})) { const s = pins.get(norm(O)) ?? new Set(); s.add(h); pins.set(norm(O), s); }
  const pinnedVersion = O => {
    const s = pins.get(O);
    if (s?.size === 1 && reg) return reg.byHash([...s][0]);
    if (!s && reg && placed.has(O)) return reg.inForceAt(placed.get(O));      // derivable: placement is journaled, the registry says what was in force
    return null;
  };
  // Approvals bound to fulfilments.
  const tasks = [...J.tasks.values()].filter(t => t.task.kind === APPROVAL_KIND);
  const answers = J.deliveries.filter(d => d.event.type === 'humanTask.answered').map(d => ({ at: d.at, taskId: d.event.payload.taskId, user: d.event.payload.user, decision: d.event.payload.answer?.decision, instance: d.instance }));
  const refunds = J.ledger.filter(r => r.committed && r.system === 'billing' && r.op === 'refund');
  // Q3
  {
    const why = [];
    if (!reg) why.push('no threshold is recorded: without the constitution registry the auditor cannot tell which refunds were above T');
    const pop = [];
    let unbound = 0;
    for (const r of refunds) {
      const O = norm(r.args.orderId), F = r.args.fulfilmentId, amount = r.args.amountMinor ?? r.args.amount;
      const v = pinnedVersion(O);
      if (!v) { if (reg) why.push(`refund ${r.key ?? F}: no pin and no journaled placement for ${O}`); continue; }
      const T = thresholdOf(v.doc);
      if (!(amount > T)) continue;
      const bound = tasks.filter(t => t.task.subject === F || (t.task.subject === O));
      const ans = answers.filter(a => bound.some(t => t.task.id === a.taskId && t.instance === a.instance) && a.decision === 'approve' && a.at <= r.emittedAt);
      if (bound.some(t => t.task.subject === O && t.task.subject !== F)) unbound += 1;
      const sod = [...(entered.get(O)?.values() ?? [])].filter(Boolean);
      // C2-X1: a break-glass request (its question says so) answered by a controller is an authorised exception, listed
      // for after-the-fact review; any other approver must hold finance-approver. The first valid answer is the evidence.
      const judged = ans.map(x => {
        const bg = /^BREAK-GLASS/.test(bound.find(t => t.task.id === x.taskId)?.task.question ?? '');
        return { ...x, breakGlass: bg, role: holds(v.doc, x.user, 'finance-approver') || (bg && holds(v.doc, x.user, 'controller')), sodOk: !sod.includes(x.user) };
      });
      const a = judged.find(x => x.role && x.sodOk) ?? judged[0] ?? null;
      pop.push({ key: r.key, order: O, fulfilment: F, amountMinor: amount, thresholdMinor: T, version: v.version, approver: a?.user ?? null,
        approverHoldsRole: a ? a.role : null, sodOk: a ? a.sodOk : null, breakGlass: a?.breakGlass ?? false, enteredBy: sod });
    }
    if (unbound) why.push(`${unbound} approvals name only the order, not the refund: the decision is not bound to the effect`);
    Q.Q3 = { answerable: !why.length, population: pop, why, exceptionsForReview: pop.filter(p => p.breakGlass).map(p => p.key) };
  }
  // Q4
  {
    const ports = new Set(okCalls.map(c => K(c)?.port).filter(Boolean));
    const pop = [];
    for (const c of okCalls) {
      const k = K(c); if (!k) continue;
      for (const x of k.interventions ?? []) pop.push({ at: new Date(c.at).toISOString(), instance: c.instance, ...x });
      for (const x of k.releases ?? []) pop.push({ at: new Date(c.at).toISOString(), instance: c.instance, action: 'release', ...x });
    }
    const missingHash = pop.filter(x => ['hold', 'release', 'break-glass', 'abandon', 'suppress'].includes(x.action) && x.clause && !x.constitution).length;
    const why = [];
    if (!ports.size) why.push('no enforcement layer is journaled (no port decisions in any case-tick)');
    if (missingHash) why.push(`${missingHash} interventions carry no constitution hash`);
    Q.Q4 = { applicable: ports.size > 0, answerable: ports.size > 0 && !missingHash, population: pop, why, ports: [...ports] };
  }
  // Q5
  {
    const why = [];
    const runs = [...placed.keys()];
    const unpinned = runs.filter(O => !pins.has(O));
    if (unpinned.length) why.push(`${unpinned.length} of ${runs.length} runs journal no constitution hash: whether they ran under the version in force cannot be proved`);
    if (!reg) why.push('no registry: the version in force at a placement is unknown');
    const pop = [];
    if (reg) for (const O of runs) {
      const s = pins.get(O); if (!s) continue;
      const want = reg.inForceAt(placed.get(O))?.hash ?? null;
      for (const h of s) if (h !== want) pop.push({ order: O, pinned: h, inForce: want, refused: reg.byHash(h)?.decision === 'refused' });
    }
    Q.Q5 = { answerable: !why.length, population: pop, why, runs: runs.length };
  }
  // The 10-case walkthrough: a sample drawn from the journal itself (refund-bearing orders first).
  const r = rng('ot0/audit-sample', host.at(-1)?.hash ?? 'none');
  const withRefund = new Set(refunds.map(x => norm(x.args.orderId)));
  const cancelled = new Set(entered.keys());
  const all = [...placed.keys()].sort();
  const strata = [all.filter(O => withRefund.has(O)), all.filter(O => !withRefund.has(O) && cancelled.has(O)), all.filter(O => !withRefund.has(O) && !cancelled.has(O))];
  const sample = [];
  for (const s of strata) for (const O of r.shuffle(s)) if (sample.length < sampleSize) sample.push(O);
  const walkthrough = sample.map(O => {
    const steps = {};
    steps.placement = placed.has(O);
    const v = pinnedVersion(O);
    steps.pinned = pins.has(O) ? (reg ? [...pins.get(O)].every(h => h === reg.inForceAt(placed.get(O))?.hash) : false) : false;
    const money = J.ledger.filter(x => x.committed && x.system === 'billing' && norm(x.args.orderId) === O);
    steps.moneyTraced = money.every(x => x.instance && J.calls.some(c => c.instance === x.instance && c.at === x.emittedAt && c.outcome === 'ok'));
    const above = v ? money.filter(x => x.op === 'refund' && (x.args.amountMinor ?? 0) > thresholdOf(v.doc)) : money.filter(x => x.op === 'refund');
    steps.approvalsBound = v ? above.every(x => Q.Q3.population.some(p => p.key === x.key && p.approver && p.approverHoldsRole && p.sodOk)) : (above.length === 0 ? null : false);
    const fst = J.ledger.filter(x => x.committed && x.system === 'orders' && x.op === 'setStatus' && norm(x.args.orderId) === O);
    steps.outcome = fst.some(x => !x.args.fulfilmentId && ['completed', 'failed', 'cancelled', 'timedOut'].includes(x.args.status)) ? true : 'open-at-period-end';
    const pass = steps.placement && steps.pinned && steps.moneyTraced && steps.approvalsBound !== false;
    return { order: O, pass, steps };
  });
  return { chain, complete, registryChain: regChain, queries: Q, walkthrough, walkthroughPassed: walkthrough.filter(w => w.pass).length };
}

/** Analyst-side ground truth for the five populations (world truth, the registry object, the port's log, the solver hash). */
export function groundTruth({ world, rows, registry, port = null, workflowHash = null }) {
  const J = parseJournal(rows);
  const caseOfOrder = new Map(Object.entries(world.truth.cases).filter(([, t]) => t.subject).map(([c, t]) => [t.subject, t]));
  const Q1 = workflowHash ? [{ workflow: workflowHash, ticks: J.calls.filter(c => c.outcome === 'ok').length }] : [];
  const Q2 = registry.versions.map(v => ({ version: v.version, hash: v.hash, proposedBy: v.proposedBy, approvers: v.approvals.map(a => a.by), decision: v.decision }));
  const Q3 = [];
  for (const r of rows.filter(x => x.type === 'ledger' && x.committed && x.system === 'billing' && x.op === 'refund')) {
    const t = world.truth.cases[r.subjectCase];
    const em = J.ledger.find(x => x.at === Date.parse(r.at) && x.key === (r.key ?? null) && x.op === 'refund');
    const amount = em?.args.amountMinor ?? em?.args.amount;
    const v = registry.inForceAt(t.placedAt);
    if (amount > thresholdOf(v.doc)) Q3.push({ key: r.key, order: t.subject, amountMinor: amount, thresholdMinor: thresholdOf(v.doc) });
  }
  const Q4 = port ? port.log.flatMap(l => [...l.interventions, ...l.releases.map(x => ({ action: 'release', ...x }))]) : [];
  // Q5: the pins the port journaled (it pins at the placement it saw) against the version in force at the true placement.
  const Q5 = [];
  if (port?.policy === 'shield') for (const [O, o] of port.orders) {
    const t = caseOfOrder.get(O);
    if (!t || o.placedAt === null) continue;
    const got = registry.inForceAt(o.placedAt)?.hash ?? null, want = registry.inForceAt(t.placedAt).hash;
    if (got !== want) Q5.push({ order: O, pinned: got, inForce: want });
  }
  return { Q1, Q2, Q3, Q4, Q5, orders: [...caseOfOrder.keys()].length };
}

/** Pass/fail per query: answerable from the pack alone and the population equal to the ground truth. */
export function compare(a, g) {
  const keySet = (xs, f) => new Set(xs.map(f));
  const eq = (A, B) => A.size === B.size && [...A].every(x => B.has(x));
  const res = {};
  res.Q1 = a.queries.Q1.answerable && eq(keySet(a.queries.Q1.population, p => `${p.workflow}|${p.ticks}`), keySet(g.Q1, p => `${p.workflow}|${p.ticks}`));
  res.Q2 = a.queries.Q2.answerable && eq(keySet(a.queries.Q2.population, p => `${p.hash}|${p.decision}|${p.approvers.join(',')}`), keySet(g.Q2, p => `${p.hash}|${p.decision}|${p.approvers.join(',')}`));
  res.Q3 = a.queries.Q3.answerable && eq(keySet(a.queries.Q3.population, p => `${p.key}|${p.amountMinor}|${p.thresholdMinor}`), keySet(g.Q3, p => `${p.key}|${p.amountMinor}|${p.thresholdMinor}`));
  res.Q4 = a.queries.Q4.applicable ? (a.queries.Q4.answerable && a.queries.Q4.population.length === g.Q4.length) : 'n/a';
  res.Q5 = a.queries.Q5.answerable && eq(keySet(a.queries.Q5.population, p => `${p.order}|${p.pinned}`), keySet(g.Q5, p => `${p.order}|${p.pinned}`));
  const why = Object.fromEntries(['Q1', 'Q2', 'Q3', 'Q4', 'Q5'].map(q => [q, a.queries[q].why]));
  return { pass: res, why, walkthrough: `${a.walkthroughPassed}/${a.walkthrough.length}`, walkthroughSteps: a.walkthrough.map(w => ({ order: w.order, pass: w.pass, ...w.steps })) };
}
