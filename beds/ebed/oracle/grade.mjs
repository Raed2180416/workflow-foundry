// The per-case grading machine of BED-CONTRACT v1.1 §5.3, item-independent. For each truth case it walks the case's
// processing points in journal order (deliveries of its truth events, case-ticks of instances bound to it, ledger rows
// attributed to it, its human tasks and their events, every window's `latest`, the horizon end), evaluates the item's
// referenceTransition on the view before each point, and grades:
//   layer 0  arm errors on a bound instance
//   layer 1  decisions on graded case-ticks; over-escalation (a task no rule asked for)
//   layer 2  effects: each ledger row (every attempt) must match an open logical effect or a permitted pattern; a
//            commit satisfies its lid once, inside its window, after its declared predecessors; keys: one key per lid
//            over all attempts, never one key for two lids
//   layer 3  deadlines: an open lid unsatisfied at its latest is missed
//   layer 4  human tasks: required tasks created inside their windows with the right role and exclusions
//   layer 5  business records at the case's end equal the expectation's
// Lids open when an expectation first names them, take the window of the latest expectation that names them, and are
// withdrawn when a later expectation stops naming them while unsatisfied. Same-instant knowledge: a withdrawal at
// instant t does not apply to a row emitted in an earlier instant (an effect already in flight) or emitted at t by a
// call that had not been given an event of the case at t (it could not have reacted).
import { indexJournal, caseView, caseIds } from './view.mjs';
import { canonical, hashOf } from '../../lib/canonical.mjs';

const argsMatch = (match, args) => Object.keys(match ?? {}).every(k => args && Object.hasOwn(args, k) && canonical(args[k]) === canonical(match[k]));
const cmp = (a, b) => a.at - b.at || a.seq - b.seq;

/**
 * gradeStream({ item, world, rows, pools?, arm? }) → StreamVerdict (contract §5.4). `item` supplies
 * referenceTransition, canonicalArgs, recordsOf? and critical?. `pools` maps case → 'completed' | 'censored' (from the two
 * reference runs); without it every case is reported with pool null.
 */
export function gradeStream({ item, world, rows, pools = null, arm = null }) {
  const idx = indexJournal(world, rows, { canonicalArgs: item.canonicalArgs });
  const cases = caseIds(world).map(c => gradeCase({ item, world, idx, c, pool: pools?.[c] ?? null }));
  const completed = cases.filter(v => v.pool === 'completed');
  const passed = completed.filter(v => v.pass).length;
  const critical = cases.flatMap(v => v.critical.map(x => ({ case: v.case, ...x })));
  const routed = idx.deliveries.filter(d => d.truth && d.round === 1 && d.event.type !== 'migration');
  const intake = routed.length ? routed.filter(d => idx.instances.get(d.instance)?.binding === d.case).length / routed.length : null;
  return {
    world: world.id, arm: arm ?? idx.start?.arm ?? null, mix: world.mix, track: world.track, profile: idx.start?.profile ?? null,
    cases,
    score: { completed: completed.length, passed, rate: completed.length ? passed / completed.length : null,
      all: cases.length, passedAll: cases.filter(v => v.pass).length, armCensored: completed.filter(v => v.armCensored).length },
    censored: censoredByEpoch(world, cases),
    critical, oracleErrors: cases.filter(v => v.oracleError).map(v => ({ case: v.case, error: v.oracleError })),
    intakeAccuracy: intake,
    digests: { world: hashOf(world), journal: hashOf(rows) },
  };
}

function censoredByEpoch(world, cases) {
  const by = new Map();
  for (const v of cases) {
    const e = v.epoch ?? 'ep?';
    if (!by.has(e)) by.set(e, { epoch: e, cases: 0, censored: 0 });
    const r = by.get(e);
    r.cases += 1;
    if (v.pool === 'censored') r.censored += 1;
  }
  return [...by.values()].map(r => ({ ...r, share: r.cases ? r.censored / r.cases : null }));
}

export function gradeCase({ item, world, idx, c, pool = null }) {
  const truth = world.truth.cases[c];
  const bound = new Set([...idx.instances.values()].filter(i => i.binding === c).map(i => i.id));
  const points = [];
  const push = (at, seq, kind, ref) => points.push({ at, seq, kind, ref });
  const startMs = Date.parse(truth.start);
  push(startMs, -1, 'start', null);
  for (const d of idx.deliveries) if (d.case === c && d.truth) push(d.at, d.seq, 'delivery', d);
  for (const k of idx.calls) if (bound.has(k.instance)) push(k.at, k.seq, 'call', k);
  for (const r of idx.ledger) if (r.case === c) push(r.at, r.seq, 'row', r);
  for (const t of idx.tasks) if (t.case === c) push(t.at, t.seq, 'task', t);
  for (const e of idx.taskEvents) if (e.case === c) push(e.at, e.seq, 'taskEvent', e);
  push(idx.horizonMs, Infinity, 'end', null);
  points.sort(cmp);
  const queued = new Set(points.map(p => `${p.at}|${p.seq}|${p.kind}`));
  const insertLatest = at => {
    if (at > idx.horizonMs) return;
    const key = `${at}|Infinity|latest`;
    if (queued.has(key)) return;
    queued.add(key);
    const p = { at, seq: Infinity, kind: 'latest', ref: null };
    let i = points.findIndex(q => cmp(q, p) > 0);
    if (i < 0) i = points.length;
    points.splice(i, 0, p);
  };

  const lids = new Map();                    // lid -> state
  const tlids = new Map();                   // task lid -> state
  const keyOwner = new Map();
  let first = null, oracleError = null, last = null;
  const critical = [];
  const diverge = (pt, layer, code, extra = {}) => { if (!first) first = { at: new Date(pt.at).toISOString(), layer, code, ...extra }; };
  const humanTasks = { required: 0, created: 0 };

  const exemptFrom = (row, w) => row.callAt < w.at || (row.callAt === w.at && !row.knows.has(c));
  const live = (st, row) => st.withdrawn === null || st.satisfied || (row && exemptFrom(row, st.withdrawn));

  for (let pi = 0; pi < points.length; pi++) {
    const pt = points[pi];
    // 1. Expectation before the point (frozen after the first divergence or an oracle error).
    if (!first && !oracleError) {
      let E;
      try { E = item.referenceTransition(world, caseView(idx, c, pt.at, pt.seq)); }
      catch (e) { oracleError = `${pt.kind}@${new Date(pt.at).toISOString()}: ${String(e?.message ?? e).slice(0, 300)}`; break; }
      last = E;
      const names = new Set();
      for (const e of E.effects.required) {
        names.add(e.lid);
        const st = lids.get(e.lid);
        if (!st) lids.set(e.lid, { def: e, opened: { at: pt.at, seq: pt.seq }, withdrawn: null, satisfied: false, commit: null, key: undefined, attempts: 0 });
        else { st.def = e; if (!st.satisfied) st.withdrawn = null; }
        insertLatest(e.window.latest);
      }
      for (const [id, st] of lids) if (!names.has(id) && !st.satisfied && st.withdrawn === null) st.withdrawn = { at: pt.at, seq: pt.seq };
      const tnames = new Set();
      for (const tk of E.humanTasks.required) {
        tnames.add(tk.lid);
        const st = tlids.get(tk.lid);
        if (!st) { tlids.set(tk.lid, { def: tk, satisfied: false, withdrawn: null }); humanTasks.required += 1; }
        else { st.def = tk; if (!st.satisfied) st.withdrawn = null; }
        insertLatest(tk.window.latest);
      }
      for (const [id, st] of tlids) if (!tnames.has(id) && !st.satisfied && st.withdrawn === null) st.withdrawn = { at: pt.at, seq: pt.seq };
    }
    if (oracleError) break;
    const E = last;
    // 2. The point itself.
    if (pt.kind === 'call' && !first) {
      const k = pt.ref;
      if (k.outcome !== 'ok') diverge(pt, 0, 'arm-error', { instance: k.instance, error: k.error?.code ?? null });
      else {
        const o = k.output ?? {};
        const onlyCloses = !(o.effects?.length) && !(o.humanTasks?.length) && !(o.obligations?.upsert?.length) && (o.close === true || !!o.merge);
        if (!onlyCloses) {
          for (const [f, v] of Object.entries(E.decisions.graded ?? {})) {
            if (canonical(o.decisions?.[f] ?? null) !== canonical(v)) { diverge(pt, 1, 'decision', { field: f, expected: v, got: o.decisions?.[f] ?? null, instance: k.instance }); break; }
          }
        }
      }
    } else if (pt.kind === 'row') {
      const r = pt.ref;
      const cands = [...lids.entries()].filter(([, st]) => st.def.system === r.system && st.def.op === r.op && argsMatch(st.def.match, r.args) && live(st, r))
        .sort(([a, x], [b, y]) => x.def.window.latest - y.def.window.latest || x.def.window.earliest - y.def.window.earliest || (a < b ? -1 : 1));
      let pick = null;
      if (r.key !== null) pick = cands.find(([, st]) => st.key === r.key) ?? null;
      const unsat = cands.filter(([, st]) => !st.satisfied);
      pick = pick ?? unsat.find(([, st]) => r.at >= st.def.window.earliest && r.at <= st.def.window.latest) ?? unsat[0] ?? cands[0] ?? null;
      if (!pick) {
        const perm = (E?.effects.permitted ?? []).some(p => p.system === r.system && p.op === r.op && argsMatch(p.match, r.args));
        if (!perm) {
          diverge(pt, 2, 'outside-allowed', { system: r.system, op: r.op, args: r.args, committed: r.committed });
          if (r.committed && r.money) critical.push({ code: 'money-outside-allowed', at: new Date(r.at).toISOString(), system: r.system, op: r.op });
        }
      } else {
        const [id, st] = pick;
        if (r.key !== null) {
          const kk = `${r.system}\u0000${r.key}`;
          const owner = keyOwner.get(kk);
          if (owner === undefined) keyOwner.set(kk, id);
          else if (owner !== id) diverge(pt, 2, 'key-reuse', { lid: id, other: owner, key: r.key });
        }
        if (st.attempts > 0 && r.key !== st.key) diverge(pt, 2, 'key-split', { lid: id, key: r.key, first: st.key });
        if (st.attempts === 0) st.key = r.key;
        st.attempts += 1;
        if (r.committed) {
          if (st.satisfied) {
            diverge(pt, 2, 'duplicate', { lid: id });
            if (st.def.money) critical.push({ code: 'duplicate-money', lid: id, at: new Date(r.at).toISOString() });
          } else {
            st.satisfied = true; st.commit = { at: r.at, seq: r.seq };
            if (r.at < st.def.window.earliest) diverge(pt, 2, 'early', { lid: id });
            else if (r.at > st.def.window.latest) diverge(pt, 3, 'late', { lid: id });
            for (const p of st.def.after ?? []) {
              const ps = lids.get(p);
              if (!(ps && ps.satisfied && cmp(ps.commit, { at: r.at, seq: r.seq }) < 0)) { diverge(pt, 2, 'order', { lid: id, before: p }); break; }
            }
          }
        }
      }
    } else if (pt.kind === 'task' && !first) {
      const tk = pt.ref;
      humanTasks.created += 1;
      const ex = tk.task.excludeUsers ?? [];
      const ok = st => st.def.kind === tk.task.kind && st.def.role === tk.task.role && (st.def.mustExclude ?? []).every(u => ex.includes(u)) && tk.at >= st.def.window.earliest && tk.at <= st.def.window.latest;
      const req = [...tlids.values()].find(st => !st.satisfied && st.withdrawn === null && ok(st));
      if (req) req.satisfied = true;
      else if (!(E?.humanTasks.permitted ?? []).some(p => p.kind === tk.task.kind && p.role === tk.task.role && tk.at >= p.window.earliest && tk.at <= p.window.latest)) {
        diverge(pt, 1, 'over-escalation', { kind: tk.task.kind, role: tk.task.role });
      }
    }
    // 3. Deadlines: open lids whose latest has passed.
    if (!first) {
      for (const [id, st] of lids) {
        if (st.satisfied || st.withdrawn !== null) continue;
        const L = st.def.window.latest;
        if (L < pt.at || (L === pt.at && pt.seq === Infinity)) { diverge({ at: L }, 3, 'missed', { lid: id, rule: st.def.rule }); break; }
      }
      for (const [id, st] of tlids) {
        if (first || st.satisfied || st.withdrawn !== null) continue;
        const L = st.def.window.latest;
        if (L < pt.at || (L === pt.at && pt.seq === Infinity)) diverge({ at: L }, 4, 'under-escalation', { lid: id, kind: st.def.kind });
      }
    }
  }

  const E = last;
  const openLids = [...lids.entries()].filter(([, st]) => !st.satisfied && st.withdrawn === null).map(([id]) => id);
  const complete = !!E && E.terminal && openLids.length === 0 && [...tlids.values()].every(st => st.satisfied || st.withdrawn !== null);
  let records = null;
  if (!first && !oracleError && complete && E.records && item.recordsOf) {
    records = item.recordsOf(world, idx, c);
    if (canonical(records) !== canonical(E.records)) diverge({ at: idx.horizonMs }, 5, 'records', { expected: E.records, got: records });
  }
  if (item.critical) for (const x of item.critical(world, idx, c, { expectation: E, complete }) ?? []) critical.push(x);
  if (oracleError && !first) first = { at: null, layer: -1, code: 'oracle-error', detail: oracleError };
  const pass = !first && complete;
  return {
    case: c, subject: truth.subject, epoch: truth.epoch, class: truth.class, tail: !!truth.tail, pool,
    pass, armCensored: !first && !complete, complete, end: E?.end ?? null, firstDivergence: first, critical, oracleError,
    humanTasks, openLids,
  };
}
