// Running arms through the real E8 host and judging them on every signal of the composition harness
// (research/composition-20261021/HARNESS.md §1). $0 when the arm is code (no model calls here).
//   assess(...) = end to end (the E8 oracle, unchanged) + business capabilities (capabilities.mjs) + interface honesty
//   (trace.mjs, for composed arms) + fault metrics (exactly-once, compensation completeness, critical violations).
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { createHost } from '../../beds/ebed/host/host.mjs';
import { runReference } from '../../beds/ebed/oracle/policy.mjs';
import { gradeStream } from '../../beds/ebed/oracle/grade.mjs';
import { evaluateCapabilities, DEFAULT_RULES } from './capabilities.mjs';
import { interfaceReport } from './trace.mjs';
import { exactlyOnce, compensationCompleteness } from './faults.mjs';
import { composedReference, manifestFor } from './reference.mjs';

/** Reference pools for a world under an item and a host binding (contract §6): both reference runs must complete a case. */
export async function poolsFor(world, { item = e8.oracleItem, binding = e8.binding } = {}) {
  const v = {};
  for (const timing of ['earliest', 'latest']) {
    const r = await runReference({ item, binding, world, timing });
    v[timing] = gradeStream({ item, world, rows: r.rows });
  }
  const pools = {};
  for (const cv of v.earliest.cases) {
    const other = v.latest.cases.find(x => x.case === cv.case);
    pools[cv.case] = cv.complete && other?.complete ? 'completed' : 'censored';
  }
  return { pools, verdicts: v };
}

/** Run an arm (any tick/1 arm object) over a world through the host; returns { rows, status }. */
export async function runArm({ world, arm, binding = e8.binding, maxWakeups = 30_000, callTimeoutMs = null }) {
  const host = createHost({ item: binding, world, arm, maxWakeups, ...(callTimeoutMs ? { callTimeoutMs } : {}) });
  let status;
  try { status = (await host.run()).status; } catch (e) { status = `host-error: ${String(e?.message ?? e).slice(0, 200)}`; }
  return { rows: host.journal.contentRows(), status, host };
}

/** Run the composed reference (reference.mjs) over a world; `wrap(arm)` adds faults (faults.mjs). */
export async function runComposedReference({ world, timing = 'earliest', variant = null, mode = 'strict', item = e8.oracleItem, binding = e8.binding, wrap = null }) {
  const holder = {};
  let arm = composedReference({ world, timing, variant, mode, item, journal: () => ({ committed: holder.host.journal.rows, staged: holder.host.journal.staged }) });
  if (wrap) arm = wrap(arm, () => composedReference({ world, timing, variant, mode, item, journal: () => ({ committed: holder.host.journal.rows, staged: holder.host.journal.staged }) }));
  holder.host = createHost({ item: binding, world, arm, maxWakeups: 30_000 });
  let status;
  try { status = (await holder.host.run()).status; } catch (e) { status = `host-error: ${String(e?.message ?? e).slice(0, 200)}`; }
  return { rows: holder.host.journal.contentRows(), status, arm, manifest: manifestFor(variant) };
}

/** Every signal on one journal. `manifest`: the trusted manifest of a composed arm (null for a monolith). */
export function assess({ world, rows, pools, manifest = null, rules = DEFAULT_RULES, item = e8.oracleItem }) {
  const v = gradeStream({ item, world, rows, pools });
  const comp = v.cases.filter(c => c.pool === 'completed');
  const codes = {};
  for (const c of comp.filter(x => !x.pass)) { const k = c.firstDivergence ? `L${c.firstDivergence.layer}:${c.firstDivergence.code}` : 'unfinished'; codes[k] = (codes[k] ?? 0) + 1; }
  const caps = evaluateCapabilities(world, rows, { pools, rules, canonicalArgs: item.canonicalArgs });
  const capCases = caps.cases.filter(c => c.pool === 'completed');
  const byCap = Object.fromEntries(Object.entries(caps.byCapability).map(([k, b]) => [k, `${b.pass}/${b.n}`]));
  return {
    oracle: { completed: comp.length, passed: comp.filter(c => c.pass).length, critical: v.critical.length, codes, failing: comp.filter(c => !c.pass).map(c => ({ case: c.case, class: c.class, first: c.firstDivergence })) },
    capabilities: { completed: capCases.length, passed: capCases.filter(c => c.pass).length, byCapability: byCap, failing: capCases.filter(c => !c.pass).map(c => ({ case: c.case, class: c.class, violations: c.violations })) },
    interface: manifest ? interfaceReport(rows, manifest) : null,
    faults: { exactlyOnce: exactlyOnce(world, rows, { item }), compensation: compensationCompleteness(world, rows, { pools, item }) },
    armErrors: rows.filter(r => r.type === 'arm.error').length,
  };
}

/** A one-line summary of assess(). */
export function brief(a) {
  const i = a.interface;
  return `oracle ${a.oracle.passed}/${a.oracle.completed} (critical ${a.oracle.critical}) | capabilities ${a.capabilities.passed}/${a.capabilities.completed} | `
    + `exactly-once dup ${a.faults.exactlyOnce.duplicates.length} (money ${a.faults.exactlyOnce.money}) | compensation ${a.faults.compensation.complete}/${a.faults.compensation.due}`
    + `${i ? ` | interface violations ${i.violations} ${JSON.stringify(i.violationsByCode)} dropped ${i.dropped} integrity ${i.integrity.length}` : ''} | arm errors ${a.armErrors}`;
}
