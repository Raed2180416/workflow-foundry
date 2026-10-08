// Generator for the failures-code group (JUDGE-PROGRAM.md §1.2 group F, X1 codefix, X6, Q6; §2.2, §3.4; plan group
// "failures-code"):
//   F1          failure_class: exec-injected workflows under a frozen copy of src/ (labels = the healer's checks, cross-checked
//               against the injected cause), the probe templates rewritten to the new taxonomy (train, <= 20%), and gameqa
//               crash texts replayed on the bed's engine (finding). Out-of-distribution axis: workflow shape (skeleton buckets).
//   X1:codefix  injected_instruction on the codefix bed: bug-thread comments, service-log lines and module comments (the
//               codefix tap labels spans from knobs.injections / knobs.codeInjection), plus train-pool lines in train-like slices.
//   F2          suspect_function: wave-2 smoke over four training domains; two domains (routing, ratelimit) are test-ood only.
//               The ownerci family is under the plan's cutLine and is not built here.
//   X6, Q6      report_triage and spec_violation, wave 2: codefix is their held-out family (test-ood only).
//
// Pure: the same (slice, seeds, opts, factory version, bed pin, frozen src commit) gives the same records in the same order.
// Every choice is a salted hash of the record key; the only clock the runtime reads (its own event timestamps) never reaches a
// state. Beds are imported through ctx.beds (the frozen copy). The frozen runtime commit comes from opts.frozenSrc (recorded in
// the build manifest's config.opts); this file never reads the held-out directory.
//
// opts (plain data, all optional unless stated):
//   frozenSrc   { commit, root?, outRoot? } or a commit string. REQUIRED for F1: the named commit of src/ the exec family runs under
//   ports       port ids to generate (default: the slice's ports)
//   rows        { F1: {slice: n}, X1: {...}, F2: {...}, X6: {...}, Q6: {...} } row targets per slice (defaults: JUDGE-PROGRAM.md §4.3)
//   f1          { rows, mix: {templates, gameqa, twins, paraphrase, adversarial}, concurrency, cacheDir, noSandbox }
//   wordings    { F1: [{id, text}], X1: [...] } the held-out wordings of THIS slice (required in calib-ood, dev-ood, test-ood)
import { stringLeaves } from '../lib/leakage.mjs';
import { f1Records, stats as f1Stats } from '../exec/f1.mjs';
import { codefixRecords, stats as cfStats } from '../exec/codefix-rows.mjs';
import { freezeSrc, loadRuntime } from '../exec/frozen-src.mjs';
import { fail } from '../exec/rows.mjs';

export const group = 'failures-code';
export const ports = ['F1', 'X1:codefix', 'F2', 'X6:codefix', 'Q6:codefix'];
export const GENERATOR_VERSION = 'failures-code@1';
export const HELD_OUT_PORTS = Object.freeze(['X6', 'Q6']);
export const SMOKE_PORTS = Object.freeze(['F2', 'X6', 'Q6']);

// Which ports a slice asks for by default (§10: F1 and X1 everywhere in wave 1; the wave-2 smoke of F2 in train and
// dev-select; the held-out families of X6 and Q6 and the held-out domains of F2 in test-ood only, §3.4).
export const SLICE_PORTS = Object.freeze({
  train: ['F1', 'X1', 'F2'], 'calib-in': ['F1', 'X1'], 'calib-ood': ['F1', 'X1'], 'dev-select': ['F1', 'X1', 'F2'], 'dev-ood': ['F1', 'X1'],
  'test-in': ['F1', 'X1'], 'test-ood': ['F1', 'X1', 'F2', 'X6', 'Q6'], 'real-reserve': [], 'e2e-reserve': [],
});
export const stats = { f1: f1Stats, codefix: cfStats };

export async function openFrozenRuntime(opts = {}) {
  const spec = opts.frozenSrc;
  const commit = typeof spec === 'string' ? spec : spec?.commit;
  if (!commit) throw fail('FROZEN_SRC_REQUIRED', 'F1 runs its exec-injected workflows under a frozen copy of src/ at a NAMED commit: pass opts.frozenSrc = { commit } (it is recorded in the build manifest)');
  const frozen = freezeSrc({ commit, ...(typeof spec === 'object' && spec.root ? { root: spec.root } : {}), ...(typeof spec === 'object' && spec.outRoot ? { outRoot: spec.outRoot } : {}) });
  return { frozen, rt: await loadRuntime(frozen) };
}

export async function* records(slice, seeds, opts = {}, ctx) {
  const wanted = (opts.ports ?? SLICE_PORTS[slice] ?? []).map(p => String(p).split(':')[0]);
  for (const p of wanted) if (HELD_OUT_PORTS.includes(p) && slice !== 'test-ood') throw fail('HELDOUT_FAMILY', `${p}:codefix is a held-out family (test-ood only, §3.4); it is not generated in ${slice}`);
  if (!wanted.length) return;
  if (wanted.includes('F1')) {
    const { frozen, rt } = await openFrozenRuntime(opts);
    if (!opts.f1?.noSandbox) {
      const sb = await rt.sandbox.sandboxStatus();
      if (!sb.available) throw fail('SANDBOX_UNAVAILABLE', `the exec family runs code nodes in the runtime's sandbox, which is unavailable here (${sb.reason}); pass opts.f1.noSandbox = true to drop the code-node recipes explicitly`);
    }
    for (const r of await f1Records({ slice, seeds, opts, ctx, rt, frozen })) yield r;
  }
  const cfPorts = wanted.filter(p => p !== 'F1');
  if (cfPorts.length) for (const r of await codefixRecords({ slice, seeds, opts, ctx, ports: cfPorts })) yield r;
}

// ---- label-bearing spans of the held-out family (for the span registry, §2.3 rule 7) ---------------------------------------------------------------
// X6 and Q6 codefix: the report / behaviour text. The assembly registers them with registry.add(text, {slice: 'heldout', ...}).
export function heldoutSpans(record) {
  const masks = record.meta?.masks ?? { names: [], markers: [] }, out = [];
  const ports = Object.keys(record.questions).map(q => q.split('~')[0]);
  if (ports.includes('X6')) out.push({ text: record.state.report, port: 'X6', kind: 'family-span', masks });
  if (ports.includes('Q6')) out.push({ text: record.state.behaviour, port: 'Q6', kind: 'family-span', masks });
  return out.filter(s => s.text);
}
export function registerHeldout(registry, recs) {
  let n = 0;
  for (const r of recs) for (const s of heldoutSpans(r)) { registry.add(s.text, { slice: 'heldout', source: 'failures-code', port: s.port, kind: s.kind, names: s.masks.names, markers: s.masks.markers }); n++; }
  return n;
}
export { stringLeaves };
