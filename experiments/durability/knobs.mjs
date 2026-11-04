// DUR-1 WC-1 knob DSL (PREREG-DUR-1 §8.1-§8.2; BUILD-PLAN row 14). $0, analyst side. A knob vector names a world the
// GENERATOR makes (never a hand-written one): a fuzz base 1301-1310 expanded by a derived salt (the generator's split
// argument, so the ledger seed stays the base), a difficulty 2-5, a mix, a size 12-200, at most two IN-SPEC metamorphic
// transforms (beds/ebed/e8/metamorphic.mjs), one platform fault or an LDFI fault pair, and designer-known change overlays.
// Out-of-contract (OOC) worlds are allowed but labelled: they are scored on harm and loud/silent only (§8.1).
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { generateWorld } from '../../beds/ebed/e8/world.mjs';
import { actors as baseActors } from '../../beds/ebed/e8/actors.mjs';
import { MRS, MR5_VARIANTS, duplicateInbound, injectDocs, addUnrelatedCases, permuteInstants, transformWorld, adaptActors, renaming, amountScale, addLateEdition } from '../../beds/ebed/e8/metamorphic.mjs';
import { rng } from '../../beds/lib/rng.mjs';
import { addEdition, addRename, reviewLoad, failureLoad, duplicatePlacements, duplicateReports, withFaultRamp, withFaultRamp as _wfr, editionCarriers, needsEditionCarriers, itemFor, ruleEdits, P1_EDITION, WORK } from './changes.mjs';
import { T0_MS, DAY_MS, FUZZ_BASES, isoLocal } from './schedule.mjs';
import { createHash } from 'node:crypto';

const sha = s => createHash('sha256').update(s).digest('hex');
/** In-spec transforms (MR3's week shift is left out: DUR-1's day clock is anchored at t0; MR6/MR13 transform the arm). */
export const TRANSFORMS = Object.freeze(['MR1', 'MR2', 'MR4', 'MR5-same', 'MR5-delayed', 'MR5-delayed-actions', 'MR7', 'MR9', 'MR11', 'MR12']);
/** Out-of-contract world features (§8.1 OOC): scored on harm and loud vs silent only. */
export const OOC = Object.freeze(['MR5-same-review-placement']);
export const FAULTS = Object.freeze(['none', 'restart', 'crash', 'ldfi-pair']);
export const OVERLAYS = Object.freeze(['P1', 'E1', 'R1', 'L1', 'F', 'ADV']);
export const DIFFICULTIES = Object.freeze([2, 3, 4, 5]);
export const SIZE = Object.freeze({ min: 12, max: 200 });

export class KnobError extends Error { constructor(m) { super(`DUR1_KNOB: ${m}`); this.code = 'DUR1_KNOB'; } }

/** Validate a knob vector: { base, salt, difficulty, mix, size, transforms: [], fault, overlays: [] }. Returns { ooc }. */
export function checkVector(v) {
  if (!FUZZ_BASES.includes(v.base)) throw new KnobError(`base ${v.base} is not a fuzz base (1301-1310)`);
  if (!Number.isInteger(v.salt) || v.salt < 0 || v.salt >= 10_000) throw new KnobError('salt must be an integer in [0, 10^4)');
  if (!DIFFICULTIES.includes(v.difficulty)) throw new KnobError('difficulty 2-5');
  if (!['natural', 'tail'].includes(v.mix)) throw new KnobError('mix natural | tail');
  if (!Number.isInteger(v.size) || v.size < SIZE.min || v.size > SIZE.max) throw new KnobError(`size ${SIZE.min}-${SIZE.max}`);
  if ((v.transforms ?? []).length > 2) throw new KnobError('at most two transforms');
  for (const t of v.transforms ?? []) if (!TRANSFORMS.includes(t) && !OOC.includes(t)) throw new KnobError(`transform ${t} is not in the in-spec list (out-of-spec transforms are refused)`);
  if (!FAULTS.includes(v.fault ?? 'none')) throw new KnobError(`fault ${v.fault}`);
  for (const o of v.overlays ?? []) if (!OVERLAYS.includes(o)) throw new KnobError(`overlay ${o} is not designer-known`);
  return { ooc: (v.transforms ?? []).some(t => OOC.includes(t)) };
}

export const vectorKey = (target, v) => `wc1-${target}-${v.base}-${v.salt}-d${v.difficulty}${v.mix[0]}${v.size}-${(v.transforms ?? []).join('+') || 'none'}-${v.fault ?? 'none'}-${(v.overlays ?? []).join('+') || 'none'}`;

/** LDFI: two steps on the lineage of a straight order's good outcome (reserve, charge, ship) -> two failure injections. */
export function ldfiPair(W, r) {
  const straight = Object.entries(W.truth.cases).filter(([, t]) => t.class === 'straight' && t.subject)
    .filter(([, t]) => W.sor['inventory.allocations'].find(a => a.orderId === t.subject).fulfilments.some(f => f.available)).sort(([a], [b]) => (a < b ? -1 : 1));
  if (!straight.length) return { W, pair: null };
  const [c, t] = straight[Math.floor(r.next() * straight.length)];
  const steps = [['inventory', 'reserve'], ['billing', 'charge'], ['carrier', 'create']];
  const i = Math.floor(r.next() * steps.length), j = (i + 1 + Math.floor(r.next() * (steps.length - 1))) % steps.length;
  const Wt = structuredClone(W);
  // The earlier step fails transiently (F2, once) and the later permanently (F6): both on the order's lineage of a good outcome.
  const [a, b] = [steps[Math.min(i, j)], steps[Math.max(i, j)]];
  Wt.faults.push({ case: c, system: a[0], op: a[1], ordinal: 1, kind: 'F2' });
  Wt.faults.push({ case: c, system: b[0], op: b[1], ordinal: 1, kind: 'F6' });
  return { W: Wt, pair: { case: c, steps: [a.join('.'), b.join('.')] } };
}

/**
 * The bundle of a knob vector (red-team flagged: never in any evidence or regression set). Returns { key, W, item,
 * binding, wrapArm, redTeam: true, ooc, specAt, configAt, announcements, worldDigest, itemDigest }.
 */
export async function vectorBundle(target, v, { sealed = null } = {}) {
  const { ooc } = checkVector(v);
  const split = `fuzz-dur1-${target}-${v.salt}`;
  let W = generateWorld({ seed: v.base, split, difficulty: v.difficulty, mix: v.mix, size: v.size, injection: (v.overlays ?? []).includes('ADV') });
  W.truth.dur1Eff = {};
  W.truth.dur1 = { stream: 'wc1', k: 0, active: [...(v.overlays ?? [])], exclude: [] };
  let actors = baseActors;
  let wrap = null;
  for (const t of v.transforms ?? []) {
    if (t === 'MR1') { const tf = renaming(); const W0 = W; W = transformWorld(W0, tf); actors = adaptActors(W0, tf); }
    else if (t === 'MR2') { const tf = amountScale(10); const W0 = W; W = transformWorld(W0, tf); actors = adaptActors(W0, tf); }
    else if (t === 'MR4') W = permuteInstants(W).Wt;
    else if (t.startsWith('MR5-')) { const r = duplicateInbound(W, MR5_VARIANTS[t.slice(4)]); W = r.Wt; if (r.B?.actors) actors = r.B.actors; }
    else if (t === 'MR7') W = addUnrelatedCases(W, 2).Wt;
    else if (t === 'MR9') { const r = addLateEdition(W); W = r.Wt ?? r; }
    else if (t === 'MR11') W = failureLoad(W, { share: 1, salt: `wc1/${target}` }).W;
    else if (t === 'MR12') W = injectDocs(W);
  }
  const r = rng('dur1/wc1', target, v.base, v.salt);
  if (v.fault === 'ldfi-pair') W = ldfiPair(W, r).W;
  const salt = `wc1/${target}/${v.base}/${v.salt}`;
  for (const o of v.overlays ?? []) {
    if (o === 'P1') W = addEdition(W, { ...P1_EDITION, fromMs: T0_MS + 3 * DAY_MS, publishMs: T0_MS + DAY_MS });
    if (o === 'E1') W = addRename(W, { system: 'carrier', op: 'create', from: 'location', to: 'site', atMs: T0_MS + 4 * DAY_MS });
    if (o === 'R1') { W = reviewLoad(W, { n: 6, fromMs: T0_MS + 2 * DAY_MS, toMs: T0_MS + 7 * DAY_MS, salt }).W; W.truth.dur1Eff.R1 = T0_MS + 2 * DAY_MS; }
    if (o === 'L1') W = failureLoad(W, { share: 0.15, salt }).W;
    if (o === 'F') { W = duplicatePlacements(W, { share: 0.1, salt }).W; actors = duplicateReports(actors, { share: 0.1, salt }); }
  }
  if (needsEditionCarriers(W)) actors = editionCarriers(actors);
  const wantF = (v.overlays ?? []).includes('F') || v.fault === 'crash' || v.fault === 'restart';
  if (wantF) {
    const prob = v.fault === 'restart' ? () => 0 : v.fault === 'crash' ? () => 0.3 : undefined;
    wrap = (arm, factory) => withFaultRamp(arm, factory, { salt, ...(prob ? { prob } : {}), restartEvery: v.fault === 'crash' ? 1e9 : 7 });
  }
  const item = await itemFor(ruleEdits(sealed));
  const key = vectorKey(target, v);
  return { key, spec: { stream: 'wc1', k: 0, seed: v.base, changes: [] }, vector: v, W, item, binding: Object.freeze({ ...e8.binding, actors }), wrapArm: wrap, redTeam: true, ooc,
    announcements: [], specAt: () => e8.specE.text, configAt: () => ({ spec: '', rulebook: '', api: '' }), touched: {},
    worldDigest: sha(JSON.stringify(W)).slice(0, 16), itemDigest: item.dur1Digest.slice(0, 16) };
}

/** A random knob vector (the pool generator) and its class (for inclusion probabilities). */
export function randomVector(r, { target, maxSize = SIZE.max } = {}) {
  const n = r.int(0, 2);
  const transforms = r.sample(TRANSFORMS, n);
  const v = { base: r.pick(FUZZ_BASES), salt: r.int(0, 9_999), difficulty: r.pick(DIFFICULTIES), mix: r.pick(['natural', 'tail']), size: r.int(SIZE.min, Math.min(maxSize, SIZE.max)),
    transforms, fault: r.pick(FAULTS), overlays: r.sample(OVERLAYS, r.int(0, 2)) };
  return v;
}
export const vectorClass = v => `${v.fault}|${v.transforms.length}|${v.overlays.length ? 'overlay' : 'plain'}`;

/** Neighbours of a vector (local search): a neighbouring salt, one transform or one fault changed. */
export function neighbours(v, r) {
  const out = [{ ...v, salt: (v.salt + 1) % 10_000 }, { ...v, salt: (v.salt + 7919) % 10_000 }];
  const t = TRANSFORMS.filter(x => !v.transforms.includes(x));
  if (v.transforms.length < 2 && t.length) out.push({ ...v, transforms: [...v.transforms, r.pick(t)] });
  if (v.transforms.length) out.push({ ...v, transforms: v.transforms.slice(1) });
  out.push({ ...v, fault: r.pick(FAULTS.filter(f => f !== v.fault)) });
  return out;
}
