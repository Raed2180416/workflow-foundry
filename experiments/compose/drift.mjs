// Drift variants of E8 (research/composition-20261021/HARNESS.md §4.4). $0, analyst side.
// A drift is ONE SPEC-E rule changed, with the matching oracle change (a copy of beds/ebed/e8/transition.mjs with one
// edit, loaded like the reference mutants of defects.mjs; the original file is never touched), the matching world change
// (more cases that exercise the rule), the capability contracts' reading of the rule, and the arm-facing spec text the
// host serves (binding.specE). It is used later to ask whether a rebuild or patch of a composed program touches only the
// module that owns the rule, and whether everything else keeps passing.
//
// D1 `review-timeout-clears` (R2.2, capability `fraud`): a fraud review with no usable answer by the deadline no longer
// cancels the order; the shop accepts the risk and the order is cleared just after the deadline. Local to the fraud
// capability: what follows from clearing (R3.1, R4) is unchanged, it only now also happens after a review timeout.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { rng } from '../../beds/lib/rng.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const TRANSITION = path.join(ROOT, 'beds/ebed/e8/transition.mjs');

export const DRIFTS = Object.freeze({
  'review-timeout-clears': Object.freeze({
    id: 'review-timeout-clears', rule: 'R2.2', capability: 'fraud', rules: { reviewTimeout: 'clear' },
    spec: [
      { from: `- no usable answer by the deadline: cancel the order (R6.1) **after the deadline** and at the latest **deadline + 120
  min**, reason \`fraud-review-timeout\` (an answer exactly at the deadline still counts). A later answer changes
  nothing. An answer counts only if it carries \`decision\`; free text is unusable.`,
        to: `- no usable answer by the deadline: the shop accepts the risk and the order is **cleared just after the deadline**
  (an answer exactly at the deadline still counts, so nothing that follows from clearing may be done at the deadline
  itself): R3.1 and R4.1 then apply with their windows running from the deadline, exclusive of it, (deadline, deadline +
  120 min] and (deadline, deadline + 60 min]. A later answer changes nothing. An answer counts only if it carries
  \`decision\`; free text is unusable.` },
      { from: 'decides it, not from when you set its status: the fraud verdict `reject` (R2.1), a `reject` answer or the review\n  deadline passing without a usable answer (R2.2), a `cancel` that counts',
        to: 'decides it, not from when you set its status: the fraud verdict `reject` (R2.1), a `reject` answer (R2.2), a\n  `cancel` that counts' },
    ],
    transition: [
      { from: `    if (!ans) return cancelOrder('R2.2', deadline + SEC, deadline + 120 * MIN, deadline);         // after the deadline (S1)
    if (ans.payload.answer.decision === 'reject') return cancelOrder('R2.2', ans.at, ans.at + 120 * MIN);
    cleared = ans.at;`,
        to: `    if (!ans) cleared = deadline + SEC;                                                            // drift D1: cleared after the deadline (S1)
    else if (ans.payload.answer.decision === 'reject') return cancelOrder('R2.2', ans.at, ans.at + 120 * MIN);
    else cleared = ans.at;` },
    ],
  }),
});

const once = (text, from, to, where) => {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`${where}: the drift anchor occurs ${n} times (expected once): ${from.slice(0, 80)}`);
  return text.replace(from, to);
};

/** The drifted arm-facing spec text. */
export function driftedSpec(id) {
  const D = DRIFTS[id];
  if (!D) throw new Error(`unknown drift ${id}`);
  return D.spec.reduce((t, e) => once(t, e.from, e.to, 'SPEC-E.md'), e8.specE.text);
}

/** The host binding with the drifted spec (what the arm reads as spec/SPEC-E.md). */
export function driftedBinding(id) { return Object.freeze({ ...e8.binding, specE: driftedSpec(id) }); }

/** The oracle item with the drifted transition (a copy of transition.mjs with the drift's edits, imported from `dir`). */
export async function driftedItem(id, dir) {
  const D = DRIFTS[id];
  const src = D.transition.reduce((t, e) => once(t, e.from, e.to, 'transition.mjs'), readFileSync(TRANSITION, 'utf8'));
  const file = path.join(dir, `transition-drift-${id}.mjs`);
  writeFileSync(file, src);
  const mod = await import(pathToFileURL(file).href);
  return { ...e8.oracleItem, referenceTransition: mod.referenceTransition, canonicalArgs: mod.canonicalArgs };
}

/**
 * The drifted world: up to `n` straight orders (not go-live, placed in the first 9 days so the saga can finish) become
 * fraud reviews the analyst answers only after the 24-hour deadline (an approve 25-30 hours after the task), so the
 * changed rule decides them. Returns { world, converted: [case] }.
 */
export function driftWorld(W, id, { n = 4 } = {}) {
  if (id !== 'review-timeout-clears') throw new Error(`no world change for drift ${id}`);
  const Wt = structuredClone(W);
  const r = rng('compose/drift', W.id, id);
  const t0 = Date.parse(W.t0);
  const cands = Object.entries(Wt.truth.cases).filter(([, t]) => t.subject && t.class === 'straight' && Date.parse(t.placedAt) < t0 + 9 * 1440 * 60_000)
    .filter(([, t]) => Wt.sor['inventory.allocations'].find(a => a.orderId === t.subject).fulfilments.every(f => f.available));
  const converted = [];
  for (const [c, t] of cands) {
    if (converted.length >= n) break;
    t.verdict = 'review'; t.class = 'review-timeout'; t.tail = true;
    t.review = { decision: 'approve', delay: r.int(25 * 60, 30 * 60) };
    Wt.sor['fraud.verdicts'].push({ orderId: t.subject, verdict: 'review' });
    converted.push(c);
  }
  return { world: Wt, converted };
}

/**
 * patchLocality(before, after, { rule }) → which program files a rebuild or patch changed, which modules declare the
 * drifted rule (manifest `rules`), and whether the change stayed inside them (the parent's wiring counted apart).
 * before/after: { manifest, sources } (bundle.mjs readProgram).
 */
export function patchLocality(before, after, { rule }) {
  const files = new Set([...Object.keys(before.sources), ...Object.keys(after.sources)]);
  const changed = [...files].filter(f => before.sources[f] !== after.sources[f]).sort();
  const whoOf = (m, f) => (m.parent.file === f ? 'parent' : Object.entries(m.modules).find(([, d]) => d.file === f)?.[0] ?? f);
  const changedModules = [...new Set(changed.map(f => whoOf(after.manifest ?? before.manifest, f)))].sort();
  const owners = Object.entries((after.manifest ?? before.manifest).modules).filter(([, d]) => (d.rules ?? []).some(x => x === rule || rule.startsWith(`${x}.`) || x.startsWith(`${rule}`))).map(([id]) => id).sort();
  const manifestChanged = JSON.stringify(before.manifest) !== JSON.stringify(after.manifest);
  const outside = changedModules.filter(m => m !== 'parent' && !owners.includes(m));
  return { changedFiles: changed, changedModules, owners, manifestChanged, local: outside.length === 0 && changedModules.length > 0, localStrict: outside.length === 0 && !changedModules.includes('parent'), outside };
}
