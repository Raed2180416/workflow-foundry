// Interface honesty from the journal (research/composition-20261021/HARNESS.md §2.4). $0, analyst side.
// Every committed call row of a composed arm carries the runtime's per-tick trace in `output.decisions.composition`
// (owners of the output's effects, calls, violations, dropped effects). This module re-verifies the trace against the
// TRUSTED manifest (the one the harness bundled, never the one inside the sandbox): every effect must be attributed and
// lie inside its owner's declared kinds; every task kind inside its owner's declaration. A call row without a trace, a
// trace whose owner list does not match the output's effects, or an effect outside its owner's kinds that the runtime
// did not flag, is a `trace-integrity` finding (the runtime was bypassed or broken).
import { kindsOfE8, reachable } from './runtime.mjs';

const inc = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };

/**
 * interfaceReport(rows, manifest, { kindsOf, binding }) → { ticks, traced, calls, effectsByOwner, violations,
 * violationsByCode, violationsByModule, dropped, integrity, armErrors, compositionErrors, perTick? }.
 * `binding` (optional): instance -> truth case, from instance.open rows (for per-case attribution).
 */
export function interfaceReport(rows, manifest, { kindsOf = kindsOfE8, keepTicks = false } = {}) {
  const decl = who => (who === 'parent' ? manifest.parent : manifest.modules[who]);
  const binding = new Map();
  for (const r of rows) if (r.type === 'instance.open') binding.set(r.instance, r.binding ?? null);
  const rep = { ticks: 0, traced: 0, calls: {}, callErrors: {}, effectsByOwner: {}, effectKinds: {}, violations: 0, violationsByCode: {}, violationsByModule: {},
    violationCases: {}, dropped: 0, integrity: [], armErrors: 0, compositionErrors: 0, reachable: [...reachable(manifest)].sort(), perTick: keepTicks ? [] : undefined };
  let at = null;
  for (const r of rows) {
    if (r.type === 'wakeup') at = r.at;
    if (r.type === 'arm.error') { rep.armErrors += 1; if (JSON.stringify(r.detail ?? '').includes('[composition')) rep.compositionErrors += 1; }
    if (r.type !== 'call' || r.kind !== 'case') continue;
    rep.ticks += 1;
    if (r.outcome !== 'ok') continue;
    const out = r.output ?? {};
    const tr = out.decisions?.composition;
    if (!tr || tr.v !== 1) { rep.integrity.push({ at, instance: r.target, what: 'no composition trace' }); continue; }
    rep.traced += 1;
    const effects = Array.isArray(out.effects) ? out.effects : [];
    if (!Array.isArray(tr.owners) || tr.owners.length !== effects.length) { rep.integrity.push({ at, instance: r.target, what: 'owner list does not match the effects' }); continue; }
    const flagged = new Set((tr.violations ?? []).filter(v => ['effect-undeclared', 'parent-effect-undeclared'].includes(v.code)).map(v => `${v.module}|${v.kind}`));
    effects.forEach((e, i) => {
      const who = tr.owners[i];
      const d = decl(who);
      const kinds = kindsOf(e);
      inc(rep.effectsByOwner, who);
      inc(rep.effectKinds, `${who} ${kinds.at(-1)}`);
      if (!d) { rep.integrity.push({ at, instance: r.target, what: `effect attributed to unknown ${who}` }); return; }
      if (!kinds.some(k => (d.effects ?? []).includes(k)) && !flagged.has(`${who}|${kinds.at(-1)}`)) rep.integrity.push({ at, instance: r.target, what: `unflagged ${kinds.at(-1)} from ${who}` });
    });
    for (const [caller, mid, , kind, status] of tr.calls ?? []) {
      inc(rep.calls, `${caller}->${mid}${kind === 'event' ? ' (event)' : ''}`);
      if (status !== 'ok') inc(rep.callErrors, `${caller}->${mid} ${status}`);
    }
    for (const v of tr.violations ?? []) {
      if (v.code === 'module-error') continue;            // an exception, not an interface breach (reported in callErrors)
      rep.violations += 1;
      inc(rep.violationsByCode, v.code);
      inc(rep.violationsByModule, v.module ?? '?');
      const c = binding.get(r.target);
      if (c) inc(rep.violationCases, c);
    }
    rep.dropped += (tr.dropped ?? []).length;
    if (keepTicks && ((tr.violations ?? []).length || (tr.dropped ?? []).length)) rep.perTick.push({ at, instance: r.target, violations: tr.violations, dropped: tr.dropped });
  }
  return rep;
}
