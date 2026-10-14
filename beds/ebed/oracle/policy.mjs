// The reference policy (BED-CONTRACT v1.1 §5.6), item-independent: an analyst-side arm that, at every case-tick,
// emits the canonical output of the current expectation of the instance's truth case: every required logical effect
// and human task at its window's earliest (`timing: 'earliest'`) or latest (`'latest'`), with deterministic keys (the
// lid), and a wake-up at the next window it must act in. Its two runs through the real host define the completed and
// censored pools (§6) and must themselves pass every case (a self-consistency check of the oracle, never evidence about
// an arm). It reads the host's own journal (committed and staged rows) and world truth: it is not an arm under test.
import { JournalIndex, caseView } from './view.mjs';
import { createHost } from '../host/host.mjs';
import { canonical } from '../../lib/canonical.mjs';

const argsMatch = (match, args) => Object.keys(match ?? {}).every(k => args && Object.hasOwn(args, k) && canonical(args[k]) === canonical(match[k]));

const MIN = 60_000;
export const LATE_SLACK = 10 * MIN;
const iso = (m, off) => { const d = new Date(m + off * MIN); return `${d.toISOString().slice(0, 19)}${off >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')}:${String(Math.abs(off) % 60).padStart(2, '0')}`; };
const offsetOf = s => { const m = /([+-])(\d\d):(\d\d)$/.exec(s); return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0; };

/** Map internal argument names to the names an F5 rename makes current at `atMs` (the API file shows the same). */
function currentNames(world, system, op, args, atMs) {
  const renames = (world.faults ?? []).filter(f => f.kind === 'F5' && f.system === system && f.op === op && Date.parse(f.at) <= atMs);
  if (!renames.length) return args;
  const out = { ...args };
  for (const r of renames) if (r.params.from in out) { out[r.params.to] = out[r.params.from]; delete out[r.params.from]; }
  return out;
}

/**
 * referenceArm({ item, world, timing, journal: () => rows }) → arm. `item.batch` maps 'system.op' of batch ops to
 * { group: lid -> group key, envelope: lid -> batch args, item: lid -> item args }; `item.taskSpec(tk, ctx)` builds a task.
 */
export function referenceArm({ item, world, timing = 'earliest', journal, id = `reference-${timing}`, variant = {} }) {
  // `variant` turns the reference into a control (controls.mjs): armWorld (the world the arm believes), viewFilter,
  // drop(lid) (never emitted, treated as done), due(lid, due) (when to act), merge (false: never merge), post(out, info).
  const off = offsetOf(world.t0);
  const armWorld = variant.armWorld ?? world;
  const idx = new JournalIndex(world, { canonicalArgs: item.canonicalArgs });
  let fed = 0;
  return {
    id,
    tick(input, ctx) {
      // The committed journal is fed once, in order; the open wake-up's staged rows are added tentatively.
      const { committed, staged } = journal();
      for (; fed < committed.length; fed++) if (!['clock.freeze', 'run.resume'].includes(committed[fed].type)) idx.add(committed[fed]);
      idx.begin();
      try { idx.addAll(staged); return this.decide(input, ctx, idx); } finally { idx.rollback(); }
    },
    decide(input, ctx, idx) {
      const now = Date.parse(input.now);
      const inst = idx.instances.get(input.instance);
      const c = inst?.binding ?? null;
      if (c === null) return { decisions: { subject: null }, effects: [], obligations: { upsert: [], cancel: [] }, humanTasks: [], close: true, carry: null };
      const view = caseView(idx, c, now, Infinity);
      const E = item.referenceTransition(armWorld, variant.viewFilter ? variant.viewFilter({ ...view, world: armWorld }) : { ...view, world: armWorld });
      const subject = E.decisions.graded.subject ?? null;
      const out = { decisions: { ...E.decisions.graded }, effects: [], obligations: { upsert: [], cancel: [] }, humanTasks: [], carry: null };
      // An instance started by an inbound message joins the case's open instance, if there is one.
      if (inst.startedBy?.kind === 'event' && input.carry === null && subject !== null) {
        const other = ctx.instances({ subject }).find(r => r.instance !== input.instance);
        if (other && variant.merge !== false) return post({ ...out, merge: { into: other.instance } });
        if (other) return post({ ...out, close: true });
      }
      const bucket = idx.bucket(c);
      // A lid is done when a committed row matches it (system, op, match), whatever key it carried (controls drop keys).
      const committedRows = bucket.ledger.filter(r => r.committed);
      const done = new Set(E.effects.required.filter(e => committedRows.some(r => r.system === e.system && r.op === e.op && argsMatch(e.match, r.args))).map(e => e.lid));
      for (const e of E.effects.required) if (variant.drop?.(e)) done.add(e.lid);
      const tasksMade = bucket.tasks.map(t => t.task.id);
      // 'latest' acts LATE_SLACK before the window closes (never before it opens): a platform retry or a partial batch
      // after an injected fault needs a few minutes inside the window, as for any arm acting late.
      const due0 = w => (timing === 'earliest' ? w.earliest : Math.max(w.earliest, w.latest - LATE_SLACK));
      const dueE = e => (variant.due ? variant.due(e, due0(e.window)) : due0(e.window));
      const due = w => due0(w);
      const todo = E.effects.required.filter(e => !done.has(e.lid));
      const ready = todo.filter(e => dueE(e) <= now && ctx.status(e.system, e.lid) !== 'pending');
      // Effects in expectation order; a dependant goes out when its predecessors have committed, or with `after` on the
      // one predecessor emitted earlier in this output (a batch carries one `after` for all its items).
      const emitted = new Set();
      const groups = new Map();
      for (const e of ready) {
        const deps = (e.after ?? []).filter(p => !done.has(p));
        if (deps.length > 1 || (deps.length === 1 && !emitted.has(deps[0]))) continue;
        const b = item.batch?.[`${e.system}.${e.op}`];
        if (b) {
          const g = b.group(e);
          let grp = groups.get(g);
          if (!grp) { grp = { system: e.system, op: e.op, args: { ...b.envelope(e), items: [] }, ...(deps.length ? { after: deps[0] } : {}) }; groups.set(g, grp); out.effects.push(grp); }
          else if ((grp.after ?? null) !== (deps[0] ?? null)) continue;
          grp.args.items.push({ key: e.lid, ...b.item(e) });
        } else {
          const args = item.fullArgs ? item.fullArgs(e, { lidRef: e.lid }) : e.args;
          out.effects.push({ key: e.lid, system: e.system, op: e.op, args, ...(deps.length ? { after: deps[0] } : {}) });
          emitted.add(e.lid);
        }
      }
      out.effects = out.effects.map(x => ({ ...x, args: currentNames(world, x.system, x.op, x.args, now) }));
      for (const tk of E.humanTasks.required) {
        if (due(tk.window) > now) continue;
        if (tasksMade.some(id => id.startsWith(`${tk.lid}#`))) continue;
        out.humanTasks.push(item.taskSpec(tk, { now, subject, iso: m => iso(m, off) }));
      }
      // Wake at the next window to act in; close when the case has ended and nothing is left.
      const future = [...todo.map(e => dueE(e)), ...E.humanTasks.required.filter(tk => !tasksMade.some(id => id.startsWith(`${tk.lid}#`))).map(tk => due(tk.window))].filter(m => m > now);
      // A task just created opens windows the next expectation names (deadlines from its creation): re-plan a minute on.
      if (out.humanTasks.length) future.push(now + MIN);
      if (future.length) out.obligations.upsert.push({ id: 'wake', kind: 'window', anchor: null, dueAt: iso(Math.min(...future), off), onDue: null });
      if (E.terminal && !todo.length && !out.effects.length && !out.humanTasks.length) out.close = true;
      if (subject === null) out.close = true;
      return post(out);
      function post(o) { return variant.post ? variant.post(o, { input, ctx, E, idx, c, now, iso: m => iso(m, off) }) : o; }
    },
  };
}

/** Run one reference run of `item` over `world` through the real host. Returns { journal rows, result }. */
export async function runReference({ item, binding, world, timing = 'earliest', maxWakeups, variant, id } = {}) {
  const holder = {};
  const arm = referenceArm({ item, world, timing, variant, ...(id ? { id } : {}), journal: () => ({ committed: holder.host.journal.rows, staged: holder.host.journal.staged }) });
  holder.host = createHost({ item: binding, world, arm, ...(maxWakeups ? { maxWakeups } : {}) });
  const result = await holder.host.run();
  return { rows: holder.host.journal.contentRows(), result };
}
