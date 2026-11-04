#!/usr/bin/env node
// The $0 validator rule the CI-1 result proposes for the engine (RESULT-CI1.md §5.3, §10 step 1), and its replay over every recorded
// CI-1 build (review finding 5). Engine semantics (src/runtime.mjs node(): a node whose `needs` include a node that did not complete is
// itself skipped under the default join all_success; a node whose `when` is false is skipped): skipping propagates along `needs`, so an
// ordinary node never reads a skipped node's output. The reads that CAN hit a skipped node are
//   - acceptance conditions (top level, and a map body's acceptance), which are evaluated whatever ran, and
//   - nodes with a join other than all_success,
// when they read `nodes.X...` without a `default` and X may be skipped: X has a `when`, or X needs (transitively) a node that may be
// skipped. Condition semantics (src/data.mjs condition): `exists` catches a missing reference, and `any` / `all` short-circuit, so a read
// inside `exists`, or inside `any` / `all` after an earlier sibling that reads only nodes that are never skipped (a guard such as
// "plan.count == 0"), is treated as guarded (the guard's truth is not checked: a heuristic in the rule's favour). This module does not change src/validate.mjs (the engine v2 series owns it); it measures the rule on recorded builds:
// recall on the builds that failed with MISSING_REFERENCE, and how many builds that passed every hidden world it would have flagged.
//   node experiments/ci1-r/skip-ref-rule.mjs [labels...] [--out research/ci1-20261021/r/skip-ref-rule.json]
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Every {$ref} object in a value, with its path text. */
export function refsIn(v, out = []) {
  if (Array.isArray(v)) v.forEach(x => refsIn(x, out));
  else if (isObj(v)) { if (typeof v.$ref === 'string') out.push({ ref: v.$ref, hasDefault: Object.hasOwn(v, 'default') }); else for (const x of Object.values(v)) refsIn(x, out); }
  return out;
}
/** Node ids (of one frame: the top level, or one map body) that may be skipped: a `when`, or (under the default join all_success) a
 *  need that may be skipped. */
export function maySkip(nodes) {
  const byId = new Map((nodes ?? []).map(n => [n.id, n])), memo = new Map();
  const visit = (id, seen = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    const n = byId.get(id); if (!n || seen.has(id)) return false;
    seen.add(id);
    // a join other than all_success (all_resolved, any, ...) runs whatever its predecessors did: only its own `when` skips it
    const r = !!n.when || ((n.join ?? 'all_success') === 'all_success' && (n.needs ?? []).some(d => visit(d, seen)));
    memo.set(id, r); return r;
  };
  return new Set((nodes ?? []).map(n => n.id).filter(id => visit(id)));
}
const stripExists = c => (Array.isArray(c) ? c.map(stripExists) : !isObj(c) ? c : c.op === 'exists' ? {} : Object.fromEntries(Object.entries(c).map(([k, v]) => [k, stripExists(v)])));
const target = ref => (/^nodes\.([^.[\]]+)/.exec(ref) ?? [])[1] ?? null;
/** Unguarded reads of may-be-skipped nodes in one condition tree (see the header for what counts as guarded). */
export function unguardedReads(cond, skippable, out = []) {
  if (Array.isArray(cond)) { for (const c of cond) unguardedReads(c, skippable, out); return out; }
  if (!isObj(cond)) return out;
  if (cond.op === 'exists') return out;
  if (cond.op === 'any' || cond.op === 'all') {
    const cs = cond.conditions ?? [];
    cs.forEach((c, i) => { const guarded = cs.slice(0, i).some(prev => { const rs = refsIn(prev); return rs.length && rs.every(r => !skippable.has(target(r.ref))); }); if (!guarded) unguardedReads(c, skippable, out); });
    return out;
  }
  if (cond.op === 'not') return unguardedReads(cond.condition, skippable, out);
  for (const r of refsIn([cond.left, cond.right, cond.value])) if (skippable.has(target(r.ref)) && !r.hasDefault) out.push(r);
  return out;
}
/** Findings of the rule in one workflow: [{frame, where, ref}]. guards: false = every unprotected read of a may-be-skipped node in an
 *  acceptance condition counts (only `exists` and `default` protect); true = also the short-circuit guard heuristic above. */
export function skipRefFindings(workflow, { guards = true } = {}) {
  const out = [];
  const frame = (nodes, acceptance, name) => {
    const skippable = maySkip(nodes);
    const bad = (refs, where) => { for (const r of refs) { const t = target(r.ref); if (t && skippable.has(t) && !r.hasDefault) out.push({ frame: name, where, ref: r.ref }); } };
    const reads = guards ? unguardedReads(acceptance ?? [], skippable) : refsIn(stripExists(acceptance ?? [])).filter(r => skippable.has(target(r.ref)) && !r.hasDefault);
    for (const r of reads) out.push({ frame: name, where: 'acceptance', ref: r.ref });
    for (const n of nodes ?? []) {
      if ((n.join ?? 'all_success') !== 'all_success') bad(refsIn({ args: n.args, when: n.when, items: n.items }), `node ${n.id} (join ${n.join})`);
      if (n.kind === 'map' && n.body) frame(n.body.nodes, n.body.acceptance, `${name}/${n.id}`);
    }
  };
  frame(workflow?.nodes, workflow?.acceptance, 'top');
  return out;
}

// ------------------------------------------------------------------------------------------------ the model-checked variant
// The strict variant ignores what guards a read; the guarded one trusts any earlier sibling. Both are wrong on real builds (§11.5).
// This variant checks the frame exhaustively over a small value model: every ref that a `when` or an acceptance condition reads gets the
// constants it is compared with (numbers also +-1), plus values no constant equals; for every combination, the nodes' skip states
// follow from their `when`s and the join rule, and the acceptance list is evaluated with the engine's short-circuit semantics
// (src/data.mjs condition; runtime: acceptance.every). A read of a skipped node without `default` (outside `exists`) is a finding.
// Correlations through the same ref ("kind == none" vs "kind == urgent") are modelled; anything else is free, so it over-approximates.
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));
const isRef = v => isObj(v) && typeof v.$ref === 'string';
function leaves(c, out = []) {
  if (Array.isArray(c)) { c.forEach(x => leaves(x, out)); return out; }
  if (!isObj(c)) return out;
  if (c.op === 'all' || c.op === 'any') (c.conditions ?? []).forEach(x => leaves(x, out));
  else if (c.op === 'not') leaves(c.condition, out);
  else out.push(c);
  return out;
}
function candidates(conds) {
  const vals = new Map(), add = (ref, v) => { if (!vals.has(ref)) vals.set(ref, []); if (v !== undefined) vals.get(ref).push(v); };
  for (const l of leaves(conds)) {
    const L = l.left, R = l.right ?? l.value;
    if (isRef(L)) add(L.$ref, isRef(R) ? undefined : R); if (isRef(R)) add(R.$ref, isRef(L) ? undefined : L); if (l.op === 'exists' && isRef(l.value)) add(l.value.$ref);
    if (isRef(L) && l.op === 'in' && Array.isArray(R)) for (const x of R) add(L.$ref, x);
  }
  const out = new Map();
  for (const [ref, cs] of vals) {
    const set = new Map(); const put = v => set.set(canon(v), v);
    // a ref compared only with numbers is a number, one compared only with true/false a boolean (a string there would be a CONDITION_TYPE error, not a skip); when every such
    // constant is >= 0 it is taken as a count (no negative values): both assumptions favour the rule, so findings stay conservative
    const flat = cs.filter(c => !Array.isArray(c)), numeric = flat.length > 0 && flat.every(c => typeof c === 'number'), nonNeg = numeric && flat.every(c => c >= 0);
    for (const c of flat) { put(c); if (typeof c === 'number') { if (!nonNeg || c - 1 >= 0) put(c - 1); put(c + 1); } if (typeof c === 'boolean') put(!c); }
    const boolean = flat.length > 0 && flat.every(c => typeof c === 'boolean'); // compared only with true/false: a boolean flag
    if (!numeric && !boolean) { put(`__other_${ref}__`); if (!cs.length) put(`__other2_${ref}__`); }
    out.set(ref, [...set.values()]);
  }
  return out;
}
const ERR = Symbol('missing');
function evalCond(c, val) {
  const get = x => { if (!isRef(x)) return x; const v = val(x.$ref); if (v === ERR) { if (Object.hasOwn(x, 'default')) return x.default; throw ERR; } return v; };
  if (c.op === 'all') return (c.conditions ?? []).every(x => evalCond(x, val));
  if (c.op === 'any') return (c.conditions ?? []).some(x => evalCond(x, val));
  if (c.op === 'not') return !evalCond(c.condition, val);
  if (c.op === 'exists') { try { return get(c.value) !== undefined; } catch (e) { if (e === ERR) return false; throw e; } }
  const l = get(c.left), r = get(c.right);
  if (c.op === 'eq') return canon(l) === canon(r);
  if (c.op === 'ne') return canon(l) !== canon(r);
  if (['gt', 'gte', 'lt', 'lte'].includes(c.op)) { if (typeof l !== 'number' || typeof r !== 'number') return false; return { gt: l > r, gte: l >= r, lt: l < r, lte: l <= r }[c.op]; }
  if (c.op === 'in') return Array.isArray(r) && r.some(x => canon(x) === canon(l));
  if (c.op === 'contains') return Array.isArray(l) ? l.some(x => canon(x) === canon(r)) : typeof l === 'string' && typeof r === 'string' && l.includes(r);
  return false;
}
/** Model-checked findings of one frame (null when the value model is too large: the strict findings then stand). */
export function modelFrame(nodes, acceptance, { maxCombos = 200000 } = {}) {
  nodes = nodes ?? []; acceptance = acceptance ?? [];
  const skippable = maySkip(nodes); if (!skippable.size) return [];
  const conds = [...nodes.filter(n => n.when).map(n => n.when), ...acceptance];
  const cand = candidates(conds), refs = [...cand.keys()];
  const total = refs.reduce((p, r) => p * cand.get(r).length, 1);
  if (total > maxCombos) return null;
  const byId = new Map(nodes.map(n => [n.id, n])), found = new Map();
  const idx = refs.map(() => 0);
  for (let i = 0; i < total; i++) {
    let k = i; for (let j = 0; j < refs.length; j++) { const n = cand.get(refs[j]).length; idx[j] = k % n; k = Math.floor(k / n); }
    const assign = new Map(refs.map((r, j) => [r, cand.get(r)[idx[j]]]));
    const skipped = new Map();
    const isSkipped = id => {
      if (skipped.has(id)) return skipped.get(id);
      const n = byId.get(id); if (!n) return false;
      skipped.set(id, false);
      let sk = (n.join ?? 'all_success') === 'all_success' && (n.needs ?? []).some(isSkipped);
      if (!sk && n.when) { try { sk = !evalCond(n.when, ref => valOf(ref)); } catch { sk = true; } }
      skipped.set(id, sk); return sk;
    };
    const valOf = ref => { const t = target(ref); if (t && byId.has(t) && isSkipped(t)) return ERR; return assign.has(ref) ? assign.get(ref) : 1; };
    try { acceptance.every(c => evalCond(c, valOf)); }
    catch (e) {
      if (e !== ERR) throw e;
      const sk = [...skippable].filter(id => isSkipped(id)).sort().join(',');
      if (!found.has(sk)) found.set(sk, { skipped: sk, example: Object.fromEntries([...assign].filter(([r]) => !r.startsWith('nodes.') || !skippable.has(target(r))).slice(0, 6)) });
    }
  }
  return [...found.values()];
}
export function modelFindings(workflow) {
  const out = []; let unknown = false;
  const frame = (nodes, acceptance, name) => {
    const f = modelFrame(nodes, acceptance);
    if (f === null) { unknown = true; for (const x of skipRefFindings({ nodes, acceptance }, { guards: false }).filter(x => x.frame === 'top')) out.push({ ...x, frame: name, model: 'too large: strict' }); }
    else for (const x of f) out.push({ frame: name, where: 'acceptance', skipped: x.skipped, example: x.example });
    for (const n of nodes ?? []) if (n.kind === 'map' && n.body) frame(n.body.nodes, n.body.acceptance, `${name}/${n.id}`);
  };
  frame(workflow?.nodes, workflow?.acceptance, 'top');
  return Object.assign(out, { unknown });
}

const RUNS = process.env.CI1_RUNS ?? '/var/tmp/foundry-work/ci1-20261021/runs';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values: a, positionals } = parseArgs({ options: { out: { type: 'string' }, latent: { type: 'string' } }, allowPositionals: true });
  const labels = positionals.length ? positionals : ['test-A0', 'test-A0t', 'test-A1c', 'test-A2', 'test-A2M', 'w2-A0', 'w2-A0t', 'w2-A1c', 'w2-A2'];
  const rows = [];
  for (const label of labels) {
    const dir = path.join(RUNS, label, 'records'); if (!existsSync(dir)) { console.log(`${label}: no local records`); continue; }
    for (const f of readdirSync(dir).filter(x => x.endsWith('.json')).sort()) {
      const rec = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
      if (rec.outcome !== 'ready' || !rec.workflow) continue;
      const findings = skipRefFindings(rec.workflow), strict = skipRefFindings(rec.workflow, { guards: false }), model = modelFindings(rec.workflow);
      const missingRef = (rec.worlds ?? []).some(w => /MISSING_REFERENCE/.test(`${w.error ?? ''} ${(w.reasons ?? []).join(' ')}`));
      const row = { label, item: rec.item, k: rec.k, flagged: findings.length > 0, flaggedStrict: strict.length > 0, flaggedModel: model.length > 0, modelUnknown: model.unknown, findings: strict.slice(0, 3), modelFindings: model.slice(0, 2), missingRef, passedAllWorlds: !!rec.pass || (rec.worlds ?? []).every(w => w.pass) };
      // --latent N: run a flagged build that never hit a skipped read in its hidden worlds in the item's first N generated candidate
      // worlds (the bed's own generator, seed 1, as at the freeze; needs CI1_BED for the build's wave): does any world hit it?
      if (a.latent && row.flaggedModel && !row.missingRef) {
        const { loadItem, candidates } = await import('../ci1/bed.mjs'), { runBuilt } = await import('../ci1/foundry-world.mjs');
        const item = await loadItem(rec.item); let hits = 0, ran = 0;
        for (const w of candidates(item, Number(a.latent))) { const r = await runBuilt(rec.workflow, w); ran++; if (r.error?.code === 'MISSING_REFERENCE' || /MISSING_REFERENCE/.test(String(r.error?.message ?? ''))) hits++; }
        row.latent = { worlds: ran, missingReference: hits };
      }
      rows.push(row);
    }
  }
  const id = r => `${r.label} ${r.item} k${r.k}`;
  const variant = key => {
    const tp = rows.filter(r => r[key] && r.missingRef), fn = rows.filter(r => !r[key] && r.missingRef), extra = rows.filter(r => r[key] && !r.missingRef);
    const latentTrue = extra.filter(r => r.latent?.missingReference > 0), latentNone = extra.filter(r => r.latent && r.latent.missingReference === 0);
    return { caught: tp.length, missed: fn.map(id), flagged: tp.length + extra.length, flaggedWithoutHiddenFailure: extra.length,
      ...(a.latent ? { ofThoseLatentInCandidateWorlds: latentTrue.map(id), ofThoseNeverHitInCandidateWorlds: latentNone.map(id) } : {}),
      flaggedButPassedEveryHiddenWorld: extra.filter(r => r.passedAllWorlds).length };
  };
  const out = { rule: 'acceptance / non-all_success-join $ref to a may-be-skipped node without default', labels, readyBuilds: rows.length,
    missingReferenceBuilds: rows.filter(r => r.missingRef).length, strict: variant('flaggedStrict'), guarded: variant('flagged'), model: variant('flaggedModel'), modelTooLarge: rows.filter(r => r.modelUnknown).length, latentWorlds: a.latent ? Number(a.latent) : null, rows };
  if (a.out) writeFileSync(a.out, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`ready builds ${rows.length}; MISSING_REFERENCE builds (hidden worlds) ${out.missingReferenceBuilds}`);
  console.log(`model variant: value model too large (strict used) on ${out.modelTooLarge} builds`);
  for (const k of ['strict', 'guarded', 'model']) { const v = out[k]; console.log(`${k}: caught ${v.caught}, missed ${v.missed.length} [${v.missed.join('; ')}]; flagged ${v.flagged}; flagged without a hidden failure ${v.flaggedWithoutHiddenFailure}${a.latent ? `: latent in candidate worlds ${v.ofThoseLatentInCandidateWorlds.length}, never hit ${v.ofThoseNeverHitInCandidateWorlds.length}` : ''}`); }
}
