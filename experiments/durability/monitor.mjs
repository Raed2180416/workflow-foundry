// DUR-1 monitor: channels m1-m5 per world-day on an arm's own journal, and the incident rules (PREREG-DUR-1 §6.1, §6.2;
// BUILD-PLAN row 7). $0. ORACLE-FREE except where noted: it reads the arm's journal, the capability contracts
// (experiments/compose/capabilities.mjs, the FH-1 verifier; they index cases with the bed's truth-side event map, the
// V-9 caveat, so the per-case attribution of m2 is truth-indexed; the payload-derived cross-check V-9 was NOT built, so
// every D-6 number is also reported without m2; review mi11),
// the OT-0 observer's clause C1 (oracle-free, experiments/constitution/observer.mjs), config digests, announcements and
// delivered complaints. m6 (edetector.mjs) never opens an incident.
//   m1  arm errors (a call that did not return a valid output, arm.error rows) and effect errors not followed by a success
//       of the same (order, system, op) by the day's end; declines (402), permanent failures (F6) and the spec'd
//       collection races (409 already-collected / not-cancellable) are business outcomes, not signals.
//   m2  a contract fails for an order SETTLED by the day's end (every instance that declared it closed; the arm's own
//       declarations), judged on the journal prefix up to the day's end under the rule reading in force at its placement;
//       every remaining order is judged on the whole journal at the world's end (day 14).
//   m3  observer clause C1 (conservation, exactly-once) on the same settled orders.
//   m4  announcements published during the day; changed digests of the spec text, rulebook files or API schemas.
//   m5  complaints delivered during the day.
import { pathToFileURL } from 'node:url';
import { evaluateCapabilities, DEFAULT_RULES } from '../compose/capabilities.mjs';
import { observe } from '../constitution/observer.mjs';
import { buildRegistry } from '../constitution/registry.mjs';
import { prefixRows } from './arms.mjs';
import { evaluateSandboxed } from './contract-sandbox.mjs';
import { dayStart, HORIZON_DAYS, DAY_MS } from './schedule.mjs';

export const BENIGN_ERRORS = Object.freeze([{ code: 402 }, { code: 'permanent' }, { code: 409, reason: 'already-collected' }, { code: 409, reason: 'not-cancellable' }]);
const benign = e => BENIGN_ERRORS.some(b => b.code === e?.code && (b.reason === undefined || b.reason === e?.reason));
const normOrder = s => (typeof s === 'string' ? s.trim().replace(/^#/, '').toUpperCase() : null);
// The order an effect concerns: its orderId, or the order of the fulfilment its `about` names (SPEC-E §4.8: about is the order
// id, or the fulfilment id <orderId>-F<n> for fulfilment notices). Build fix 2026-11-04: notify.send carries no orderId.
export const orderOfArgs = a => { const o = normOrder(a?.orderId ?? a?.about ?? null); return o ? o.replace(/-F\d+$/, '') : null; };
// FH-1's finding normaliser (experiments/fh/heal.mjs `norm`): one class per contract, rule and kind of finding.
export const normFinding = s => String(s).replace(/ORD-\d+-\d+(-F\d+)?/g, 'ORD-…').replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})?/g, '<time>')
  .replace(/\b(o|e|ev|ar)\d{3,}\b/g, '<id>').replace(/\b\d+(\.\d+)?\b/g, '<n>').slice(0, 160);

// ---------------------------------------------------------------------------------------------------------------------
// Contracts under rule readings (C-O): [{ fromMs, rules, module? }] sorted by fromMs; the reading for an order is the last
// whose fromMs <= its placement. `module`: a patched copy of capabilities.mjs (contracts-owner.mjs), model-written: it is
// evaluated OUT OF PROCESS (contract-sandbox.mjs; review R2-B5), never imported into the harness.
export const BASE_READINGS = Object.freeze([Object.freeze({ fromMs: -Infinity, rules: DEFAULT_RULES, module: null, id: 'base' })]);
const readingOf = (readings, pMs) => { let r = readings[0]; for (const x of readings) if (x.fromMs <= pMs) r = x; return r; };
const subWorld = (W, ids) => ({ ...W, truth: { ...W.truth, cases: Object.fromEntries(ids.map(c => [c, W.truth.cases[c]])) } });

/** Contract verdicts per case (only `cases`, or every order case) under the readings in force at each placement. */
export async function contractsFor(bundle, rows, { pools = null, readings = BASE_READINGS, cases = null } = {}) {
  const W = bundle.W;
  const ids = (cases ?? Object.keys(W.truth.cases)).filter(c => W.truth.cases[c]?.subject);
  const groups = new Map();
  for (const c of ids) { const r = readingOf(readings, Date.parse(W.truth.cases[c].placedAt)); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(c); }
  const out = new Map();
  for (const [r, list] of groups) {
    if (r.module) {
      const cases = await evaluateSandboxed({ module: r.module, itemFile: bundle.item.dur1File ?? null, worldKey: `${bundle.key}|${bundle.worldDigest}`, W, cases: list, rows, pools, rules: r.rules });
      for (const c of cases) out.set(c.case, { ...c, reading: r.id ?? null });
      continue;
    }
    const res = evaluateCapabilities(subWorld(W, list), rows, { pools, rules: r.rules, canonicalArgs: bundle.item.canonicalArgs });
    for (const c of res.cases) out.set(c.case, { ...c, reading: r.id ?? null });
  }
  return out;
}

/** Contract failure classes of one case (FH-1 contractClasses keys: contract | rule | normalised finding). */
export const contractClassesOf = v => (v?.failed ?? []).map(cap => { const [rule, detail] = v.violations?.[cap]?.[0] ?? ['?', '']; return { key: `m2|${cap}|${rule}|${normFinding(detail)}`, contract: cap, rule, detail: String(detail).slice(0, 300) }; });

// ---------------------------------------------------------------------------------------------------------------------
// Settled orders (oracle-free: the arm's own subject declarations and instance closes).

/** Map order -> { instances: Set, open: Set, settledAt } at time T from a journal. */
export function orderState(rows, T = Infinity) {
  const declared = new Map(), closedAt = new Map();
  let now = null;
  for (const r of rows) {
    if (r.type === 'wakeup') { now = Date.parse(r.at); if (now >= T) break; }
    if (r.type === 'call' && r.kind === 'case' && r.outcome === 'ok') {
      const s = normOrder(r.output?.decisions?.subject ?? null);
      if (s) { if (!declared.has(s)) declared.set(s, new Set()); declared.get(s).add(r.target); }
    }
    if (r.type === 'instance.close' || r.type === 'instance.merge') closedAt.set(r.instance, now);
  }
  const out = new Map();
  for (const [o, insts] of declared) {
    const open = [...insts].filter(i => !closedAt.has(i));
    out.set(o, { instances: insts, open: new Set(open), settledAt: open.length ? null : Math.max(...[...insts].map(i => closedAt.get(i))) });
  }
  return out;
}

const caseOfOrder = W => { const m = new Map(); for (const [c, t] of Object.entries(W.truth.cases)) if (t.subject) m.set(t.subject, c); return m; };
const C1_REGISTRY = buildRegistry();

/** Observer clause C1 violations per order on a journal (C2/C3 are OT-0's and ignored here). */
export function c1ByOrder(bundle, rows) {
  const v = observe({ rows, registry: C1_REGISTRY, ref: { catalog: bundle.W.master.catalog, editions: bundle.W.rulebook.editions } }).verdict;
  const out = new Map();
  for (const x of v.C1.violations) { const o = normOrder(x.order ?? String(x.fulfilment ?? '').replace(/-F\d+$/, '')); if (!o) continue; if (!out.has(o)) out.set(o, []); out.get(o).push(x.code); }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Per-day evaluation of one run

/**
 * signalsOfRun({ bundle, rows, pools, readings, complaints, fromDay, toDay }) → { days: { [d]: [signal] }, firstSignal: Map(case ->
 * { at, ch }) }. A signal: { ch, day, at, order, case, cls, detail }. `case` is the analysis label (truth); every rule
 * acts on `order` and `cls`.
 */
export async function signalsOfRun({ bundle, rows, pools = null, readings = BASE_READINGS, complaints = [], fromDay = 1, toDay = HORIZON_DAYS, judgedBefore = null }) {
  const W = bundle.W;
  const caseOf = caseOfOrder(W);
  const days = {};
  const push = s => { (days[s.day] ??= []).push(s); };
  // m1: arm errors and unrecovered effect errors, by day.
  let now = null;
  const errs = [], okBy = new Map(), callInst = new Map();
  const instOrder = new Map();
  for (const r of rows) {
    if (r.type === 'wakeup') now = Date.parse(r.at);
    if (r.type === 'call' && r.kind === 'case') {
      const s = normOrder(r.output?.decisions?.subject ?? null);
      if (s) instOrder.set(r.target, s);
      if (r.outcome !== 'ok') errs.push({ kind: 'arm', at: now, instance: r.target, code: r.error?.code ?? r.outcome, detail: JSON.stringify(r.error ?? r.outcome).slice(0, 200) });
    }
    if (r.type === 'arm.error') errs.push({ kind: 'arm', at: now, instance: r.instance ?? null, code: r.code ?? 'arm.error', detail: JSON.stringify(r.detail ?? r.error ?? '').slice(0, 200) });
    if (r.type === 'ledger') {
      const k = `${r.subjectCase ?? ''}|${r.system}.${r.op}`;
      if (r.committed) { if (!okBy.has(k)) okBy.set(k, []); okBy.get(k).push(Date.parse(r.at)); }
      else if (r.error && !benign(r.error)) errs.push({ kind: 'effect', at: Date.parse(r.at), instance: r.instance ?? null, key: k, case: r.subjectCase ?? null, system: r.system, op: r.op, code: r.error.code, reason: r.error.reason ?? null,
        detail: JSON.stringify(r.error).slice(0, 300), emission: r.emission });
    }
    void callInst;
  }
  const argsOf = new Map(rows.filter(r => r.type === 'effect.emit').map(r => [r.emission, r.effect]));
  for (const e of errs) {
    const d = Math.min(HORIZON_DAYS, Math.max(1, Math.floor((e.at - dayStart(1)) / DAY_MS) + 1));
    if (d < fromDay || d > toDay) continue;
    if (e.kind === 'effect' && (okBy.get(e.key) ?? []).some(t => t >= e.at && t < dayStart(d + 1))) continue;
    const order = e.kind === 'effect' ? orderOfArgs(argsOf.get(e.emission)?.args) ?? (e.case ? W.truth.cases[e.case]?.subject : null) : instOrder.get(e.instance) ?? null;
    push({ ch: 'm1', day: d, at: e.at, order, case: order ? caseOf.get(order) ?? null : null,
      cls: e.kind === 'effect' ? `m1|${e.system}.${e.op}|${e.code}|${e.reason ?? ''}` : `m1|arm|${e.code}`, detail: e.detail,
      raw: e.kind === 'effect' ? { request: argsOf.get(e.emission)?.args ?? null, error: JSON.parse(e.detail) } : null });
  }
  // m2 and m3: orders settled by each day's end (prefix), and every remaining order at the world's end. Orders judged
  // on an earlier day of the same world (`judgedBefore`: their journal before a swap is identical) are not judged again.
  const judged = new Set(judgedBefore ?? []);
  const judgedAt = new Map();
  for (let d = fromDay; d <= toDay; d++) {
    const T = dayStart(d + 1);
    const final = d === HORIZON_DAYS;
    const st = orderState(rows, T);
    const settled = [...st.entries()].filter(([, s]) => s.settledAt !== null).map(([o]) => o);
    const ids = (final ? [...caseOf.keys()] : settled).map(o => caseOf.get(o)).filter(c => c && !judged.has(c));
    if (!ids.length) continue;
    const pre = final ? rows : prefixRows(rows, T, { stamp: true });
    const cv = await contractsFor(bundle, pre, { pools, readings, cases: ids });
    const c1 = c1ByOrder(bundle, pre);
    for (const c of ids) {
      judged.add(c);
      judgedAt.set(c, d);
      const order = W.truth.cases[c].subject;
      const at = final ? dayStart(HORIZON_DAYS + 1) - 1 : (st.get(order)?.settledAt ?? T - 1);
      // An order still open at the world's end is judged there (a stuck order is a finding); its whole journal is history.
      const unsettled = final && (st.get(order)?.settledAt ?? null) === null;
      for (const k of contractClassesOf(cv.get(c))) push({ ch: 'm2', day: d, at, order, case: c, cls: k.key, detail: `[${k.contract} ${k.rule}] ${k.detail}`, contract: k.contract, rule: k.rule, unsettled });
      for (const code of [...new Set(c1.get(order) ?? [])]) push({ ch: 'm3', day: d, at, order, case: c, cls: `m3|C1|${code}`, detail: `observer C1 ${code}`, unsettled });
    }
  }
  // m4: announcements and config digests.
  let prev = bundle.configAt(dayStart(fromDay) - 1);
  for (let d = fromDay; d <= toDay; d++) {
    for (const a of bundle.announcements ?? []) if (a.at >= dayStart(d) && a.at < dayStart(d + 1)) push({ ch: 'm4', day: d, at: a.at, order: null, case: null, cls: `m4|announcement|${a.kind}`, detail: `${a.kind} published`, announcement: a });
    const cur = bundle.configAt(dayStart(d + 1) - 1);
    for (const k of Object.keys(cur)) if (cur[k] !== prev[k]) push({ ch: 'm4', day: d, at: dayStart(d + 1) - 1, order: null, case: null, cls: `m4|config|${k}`, detail: `${k} digest changed`, config: k });
    prev = cur;
  }
  // m5: complaints delivered in the world (carried ones arrive on d1).
  for (const cmp of complaints) {
    const d = Math.min(HORIZON_DAYS, Math.max(1, Math.floor((cmp.at - dayStart(1)) / DAY_MS) + 1));
    if (d < fromDay || d > toDay) continue;
    const order = cmp.order ? normOrder(cmp.order) : null;
    push({ ch: 'm5', day: d, at: cmp.at, order, case: order ? caseOf.get(order) ?? null : null, cls: `m5|${cmp.topic}`, detail: cmp.text, complaint: cmp });
  }
  for (const d of Object.keys(days)) days[d].sort((a, b) => a.at - b.at || (a.cls < b.cls ? -1 : 1));
  return { days, judgedAt };
}

/** Unrecovered effect errors and arm errors of a whole journal, per order: Map(order -> Set(m1 class)), plus the arm-error count. */
export function m1Findings(rows) {
  const ok = new Set(), errs = [], instOrder = new Map(), emits = new Map();
  let armErrors = 0;
  for (const r of rows) {
    if (r.type === 'effect.emit') emits.set(r.emission, r.effect);
    if (r.type === 'call' && r.kind === 'case') {
      const s = normOrder(r.output?.decisions?.subject ?? null);
      if (s) instOrder.set(r.target, s);
      if (r.outcome !== 'ok') { armErrors += 1; errs.push({ order: instOrder.get(r.target) ?? null, cls: `m1|arm|${r.error?.code ?? r.outcome}` }); }
    }
    if (r.type === 'ledger') {
      const a = emits.get(r.emission)?.args ?? null;
      const order = orderOfArgs(a);
      const k = `${order}|${r.system}.${r.op}`;
      if (r.committed) ok.add(k);
      else if (r.error && !benign(r.error)) errs.push({ order, k, cls: `m1|${r.system}.${r.op}|${r.error.code}|${r.error.reason ?? ''}` });
    }
  }
  const out = new Map();
  for (const e of errs) { if (e.k && ok.has(e.k)) continue; if (!e.order) continue; if (!out.has(e.order)) out.set(e.order, new Set()); out.get(e.order).add(e.cls); }
  return { byOrder: out, armErrors };
}

/**
 * Every finding of a whole journal per order (contract classes on completed cases, unrecovered m1 errors, C1 codes):
 * the gate's and the smoke report's view. Returns { byOrder: Map(order -> Set(cls)), contracts: Map(case -> verdict),
 * armErrors, completed: [case] }.
 */
export async function journalFindings(bundle, rows, { pools, readings = BASE_READINGS, only = null } = {}) {
  const W = bundle.W;
  const completed = Object.keys(W.truth.cases).filter(c => W.truth.cases[c].subject && pools?.[c] === 'completed' && (!only || only.has(c)));
  const contracts = await contractsFor(bundle, rows, { pools, readings, cases: completed });
  const byOrder = new Map();
  const add = (o, cls) => { if (!byOrder.has(o)) byOrder.set(o, new Set()); byOrder.get(o).add(cls); };
  for (const c of completed) for (const k of contractClassesOf(contracts.get(c))) add(W.truth.cases[c].subject, k.key);
  // m1 and m3 findings are kept for every order of the world, finished or not: an effect error or a conservation breach
  // is deployment-visible when it happens (on a history replay every row is before the alarm), whereas the contracts
  // judge only finished orders. (Build fix 2026-11-04: with completed orders only, the gate could never see a heal of an
  // m1 incident whose orders were still in flight at the alarm, and rejected the dry run's correct API patch.)
  const m1 = m1Findings(rows);
  const keep = only ? new Set(completed.map(c => W.truth.cases[c].subject)) : new Set(Object.values(W.truth.cases).map(t => t.subject).filter(Boolean));
  for (const [o, set] of m1.byOrder) if (keep.has(o)) for (const cls of set) add(o, cls);
  for (const [o, codes] of c1ByOrder(bundle, rows)) if (keep.has(o)) for (const code of codes) add(o, `m3|C1|${code}`);
  return { byOrder, contracts, armErrors: m1.armErrors, completed };
}

/** First attributable signal per case among the given channels (silent/loud analysis). */
export function firstSignals(days, channels) {
  const out = new Map();
  for (const list of Object.values(days)) for (const s of list) {
    if (!channels.includes(s.ch) || !s.case) continue;
    const cur = out.get(s.case);
    if (!cur || s.at < cur.at) out.set(s.case, { at: s.at, ch: s.ch, cls: s.cls });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Incidents (prereg §6.2 rules 1-6). One book per (arm, lineage, stream); it carries across worlds.

export const VERIFIER_BLIND = Object.freeze({ minComplaints: 2, windowDays: 3 });
export const TOPIC_OF_CLASS = cls => {
  if (/billing\.charge|capture|\|chg/.test(cls)) return 'charge';
  if (/billing\.refund|refund|\|rf/.test(cls)) return 'refund';
  if (/notify|notifications|\|ntf/.test(cls)) return 'notice';
  if (/carrier|shipment|tracking/.test(cls)) return 'delivery';
  if (/setStatus|status|intake/.test(cls)) return 'status';
  return null;
};

export class IncidentBook {
  constructor({ label }) { this.label = label; this.incidents = []; this.uncorroborated = []; this.n = 0; this.log = []; }
  open(kind, { cls, k, day, at, signals = [], topic = null, extra = {} }) {
    const inc = { id: `${this.label}#${++this.n}`, kind, cls, topic, opened: { k, day, at }, status: 'open', evidence: [], complaints: [], sessions: 0, promotions: [], rejected: [], ...extra };
    for (const s of signals) this.#evidence(inc, s, k);
    this.incidents.push(inc);
    this.log.push({ k, day, event: 'open', id: inc.id, kind, cls });
    return inc;
  }
  #evidence(inc, s, k) {
    if (inc.evidence.some(e => e.k === k && e.order === s.order && e.cls === s.cls)) return;
    inc.evidence.push({ k, world: s.world ?? null, day: s.day, at: s.at, order: s.order, case: s.case, ch: s.ch, cls: s.cls, detail: s.detail, raw: s.raw ?? null, practice: !!s.practice, unsettled: !!s.unsettled });
  }
  /** The live incident of a class: open, healing, or parked as a loud failure (needs-human, budget-stop), so a class that
   * exhausted its sessions gathers evidence instead of reopening (and re-spending) every day. Healed classes reopen. */
  active(cls) { return this.incidents.find(i => i.cls === cls && ['open', 'healing', 'needs-human', 'budget-stop'].includes(i.status)) ?? null; }
  /**
   * Ingest one day's signals (rules 1, 3, 4, 5). m4 signals are returned for the driver's canary (rule 2); m6 is never
   * passed here. Returns { opened, verifierBlind: [{ topic, complaints }], m4 }.
   */
  ingest(signals, { k, day, worldKey, streamDay }) {
    const opened = [], m4 = [], verifierBlind = [];
    const defectSignals = signals.filter(s => ['m1', 'm2', 'm3'].includes(s.ch));
    for (const s of defectSignals) {
      const inc = this.active(s.cls);
      if (inc) { this.#evidence(inc, { ...s, world: worldKey }, k); continue; }
      opened.push(this.open('defect', { cls: s.cls, k, day, at: s.at, signals: [{ ...s, world: worldKey }], topic: TOPIC_OF_CLASS(s.cls) }));
    }
    for (const s of signals.filter(x => x.ch === 'm4')) m4.push(s);
    for (const s of signals.filter(x => x.ch === 'm5')) {
      const c = s.complaint;
      // Rule 3: a complaint on an order that ANY defect incident holds (any status: open, healing, healed, needs-human,
      // budget-stop, flake), i.e. an order with an m1-m3 signal, is corroborated and joins the newest such incident (review
      // B5: late true complaints about orders whose incident was already healed went uncorroborated and fed rule 4).
      const holders = s.order ? this.incidents.filter(i => i.kind !== 'verifier-blind' && i.evidence.some(e => e.order === s.order)) : [];
      const inc = holders.find(i => ['open', 'healing', 'needs-human', 'budget-stop'].includes(i.status)) ?? holders.at(-1);
      if (inc) { inc.complaints.push({ ...c, corroborated: true, streamDay }); continue; }
      this.uncorroborated.push({ ...c, streamDay, used: false });
    }
    // Rule 4: >= 2 uncorroborated complaints on one topic within 3 world-days -> one verifier-blind incident.
    const fresh = this.uncorroborated.filter(c => !c.used && streamDay - c.streamDay < VERIFIER_BLIND.windowDays);
    const byTopic = new Map();
    for (const c of fresh) { if (!byTopic.has(c.topic)) byTopic.set(c.topic, []); byTopic.get(c.topic).push(c); }
    for (const [topic, list] of byTopic) {
      if (list.length < VERIFIER_BLIND.minComplaints) continue;
      if (this.incidents.some(i => i.kind === 'verifier-blind' && i.topic === topic && ['open', 'healing'].includes(i.status))) continue;
      for (const c of list) c.used = true;
      const inc = this.open('verifier-blind', { cls: `vb|${topic}`, k, day, at: Math.max(...list.map(c => c.at)), topic, extra: { complaintsUsed: list.map(c => c.id) } });
      inc.complaints.push(...list.map(c => ({ ...c, corroborated: false })));
      verifierBlind.push(inc);
      opened.push(inc);
    }
    return { opened, verifierBlind, m4 };
  }
  openIncidents() { return this.incidents.filter(i => i.status === 'open'); }
}
