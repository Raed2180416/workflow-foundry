// compose-runtime/2: an exactly-once envelope around any tick/1 solver (research/blockers-20261021/ATTACK.md Move 2,
// D28(3); write-up research/blockers-20261021/MOVE2-COMP.md). $0, no model calls. A NEW harness version: the 16 files
// PREREG-COMP1 froze (runtime.mjs, bundle.mjs, fault-run.mjs, ...) are imported, never edited.
//
// Effect identity is a platform property, not something a builder hand-writes. Three mechanisms, all driven by an
// effect registry (effects.registry.json: one identity template per system.op over entity arguments):
//   1. Outbound keys from identity. Every write the registry knows leaves with key '=' + its identity (or '=#' + a
//      digest when the identity is long or has unsafe characters), whatever key the caller chose and whether or not it
//      chose one. Two emissions of one logical effect, from any module, any instance or any trigger, therefore share
//      one key, and the host's idempotency makes the second a no-op. Same identity with different arguments, after the
//      first was committed, is answered by the host with 409 key-conflict and applies nothing: the conflict is in the
//      journal and in the envelope's findings, never silent. A write whose identity arguments are missing keeps the
//      caller's key (`identity-unresolved`). Reads and ops the registry does not know keep their key.
//   2. An inbound inbox. Results are routed back under the caller's own key (null when it gave none), so the wrapped
//      solver sees what it would see without the envelope. Per (key, emitter) the envelope counts emissions and
//      delivered results, in the carry. The host answers each emission exactly once, so a result beyond the recorded
//      emissions answers an emission the solver's (rolled-back) state does not know: it is dropped (`surplus`), as is a
//      result for an identity key with no record at all (`orphan`). Both arise only when a crash rolled the carry back
//      after the platform applied the tick's effects; the solver's re-emission is then answered by the host's
//      deduplicated result, so it still sees exactly one result per emission it remembers. Timer and human-task events
//      are never filtered: after a crash the solver's state rolled back with the envelope's, so it must see them again.
//      Option `reconcile` (read-back, off by default): the host remembers committed keys only, so a re-emission after a
//      crash re-attempts an effect whose first attempt FAILED (a declined charge is tried twice). With `reconcile`, an
//      orphaned result of a single write is parked in the carry; when the solver re-emits that identity (within three
//      ticks, with no `after` dependant), the envelope sends a read of the identity key's status instead and answers the
//      re-emission with the parked result: the outcome of the attempt the platform already made, failures included.
//   3. A static single-writer gate (singleWriterProblems): a manifest in which two owners (parent or modules) declare
//      overlapping write kinds is reported (bundle2.mjs refuses it in `enforce` mode). At run time a second caller key
//      for one identity inside an instance is logged (`shared-identity`) and its write is a no-op at the host.
// The envelope's state rides in the carry ({ cv: 'env2', c: <the solver's carry>, x: <envelope state> }), so a crash
// that rolls the carry back rolls the envelope back with it, and a restart keeps it. Answered entries are evicted
// oldest first when the state outgrows its byte budget (the carry limit is the host's 64 KiB for both together).
// Findings are written to `decisions.envelope` only when a tick has some (E8 grades `decisions.subject` only), so a
// tick without findings journals the solver's own decisions. Sweep ticks pass through untouched (E8 has no sweeps).
//
// This file imports nothing and every top-level name is prefixed (env*, R2_*): bundle2.mjs inlines it next to
// runtime.mjs and loader.mjs (exports stripped) inside the sandboxed solver, and fault-run2.mjs uses the same function
// host-side as a gateway in front of monolithic solvers, so composed and monolithic arms meet the same envelope.

export const R2_VERSION = 'compose-runtime/2';
export const R2_CARRY = 'env2';
export const R2_CARRY_LIMIT = 64 * 1024;               // the E8 host's carry limit (beds/ebed/host/output.mjs LIMITS)
const R2_SAFE = /^[A-Za-z0-9:._@+=-]+$/;
const R2_MAX_IDENTITY = 150;
const R2_MAX_FINDINGS = 50;
const r2IsObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const r2Own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const r2Copy = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const r2Bytes = v => { const s = JSON.stringify(v); let n = 0; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xd800 && c < 0xdc00) ? (i++, 4) : 3; } return n; };

/** Canonical JSON (sorted keys), for digests. */
export function envCanonical(v) {
  if (Array.isArray(v)) return `[${v.map(x => envCanonical(x === undefined ? null : x)).join(',')}]`;
  if (r2IsObj(v)) return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${envCanonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v === undefined ? null : v);
}

/** A 64-bit digest (two FNV-style passes) of a value's canonical JSON, as 16 hex characters. Not cryptographic. */
export function envDigest(v) {
  const s = typeof v === 'string' ? v : envCanonical(v);
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
    b ^= b >>> 15;
  }
  return a.toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------------------------------------------------
// Registry

const R2_SLOT = /\{([A-Za-z0-9_]+)(?:\|([^}]*))?\}/g;

/** Problems of an effect registry ([] when valid). */
export function envRegistryProblems(reg) {
  const out = [];
  if (!r2IsObj(reg) || reg.version !== 1 || !r2IsObj(reg.ops)) return ['registry: { version: 1, ops: { "system.op": entry } } required'];
  for (const [op, e] of Object.entries(reg.ops)) {
    if (!/^[a-z][a-z0-9-]*\.[A-Za-z][A-Za-z0-9]*$/.test(op)) out.push(`${op}: not a system.op name`);
    if (!r2IsObj(e)) { out.push(`${op}: entry must be an object`); continue; }
    for (const k of Object.keys(e)) if (!['identity', 'batch', 'read', 'money'].includes(k)) out.push(`${op}: unknown field ${k}`);
    if (e.read === true) { if (r2Own(e, 'identity') || e.batch === true || e.money === true) out.push(`${op}: a read has no identity, batch or money flag`); continue; }
    if (typeof e.identity !== 'string' || !(e.identity.match(R2_SLOT) ?? []).length) out.push(`${op}: identity template with at least one {arg}`);
    else if (!e.identity.startsWith(`${op.split('.')[1]}`) && !/^[a-z][a-z-]*:/.test(e.identity)) out.push(`${op}: identity must start with a kind prefix ("kind:")`);
    for (const k of ['batch', 'money']) if (r2Own(e, k) && typeof e[k] !== 'boolean') out.push(`${op}: ${k} must be boolean`);
  }
  // Two ops may not share an identity prefix: the prefix is what makes identities of different ops disjoint.
  const prefixes = new Map();
  for (const [op, e] of Object.entries(reg.ops)) {
    if (!r2IsObj(e) || typeof e.identity !== 'string') continue;
    const p = e.identity.split(':')[0];
    if (prefixes.has(p)) out.push(`${op}: identity prefix ${p} is also ${prefixes.get(p)}'s`);
    prefixes.set(p, op);
  }
  return out;
}

/** Fill an identity template from arguments; null when a required argument is missing or not a string or number. */
export function envFill(tmpl, args) {
  let ok = true;
  const s = tmpl.replace(R2_SLOT, (m, f, dflt) => {
    const v = r2IsObj(args) ? args[f] : undefined;
    if (v === null || v === undefined) { if (dflt !== undefined) return dflt; ok = false; return ''; }
    if (typeof v !== 'string' && typeof v !== 'number') { ok = false; return ''; }
    return String(v);
  });
  return ok ? s : null;
}

/** The registry entry of an effect (null when the registry does not know its op). */
export function envEntry(registry, e) { return registry?.ops?.[`${e?.system}.${e?.op}`] ?? null; }

/**
 * The logical identities of an effect: { batch: false, identity } for a single write, { batch: true, items: [identity
 * | null] } for a batch write (per item, over the batch arguments plus the item, without its key), null for a read or
 * an op the registry does not know. `identity` is null when the template cannot be filled.
 */
export function envIdentities(registry, e) {
  const ent = envEntry(registry, e);
  if (!ent || ent.read === true || typeof ent.identity !== 'string') return null;
  if (ent.batch === true) {
    const items = Array.isArray(e?.args?.items) ? e.args.items : [];
    const { items: _i, ...ctxArgs } = r2IsObj(e?.args) ? e.args : {};
    return { batch: true, items: items.map(it => (r2IsObj(it) ? envFill(ent.identity, { ...ctxArgs, ...it }) : null)) };
  }
  return { batch: false, identity: envFill(ent.identity, e?.args) };
}

/** The outbound key of an identity: '=' + identity, or '=#' + digest when it is long or has unsafe characters. */
export function envKey(identity) {
  return R2_SAFE.test(identity) && identity.length <= R2_MAX_IDENTITY ? `=${identity}` : `=#${envDigest(identity)}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Static single-writer gate

const envKindParts = k => String(k).split(':');
const envOverlap = (a, b) => {
  const pa = envKindParts(a), pb = envKindParts(b);
  const n = Math.min(pa.length, pb.length);
  for (let i = 0; i < n; i++) if (pa[i] !== pb[i]) return false;
  return true;                                              // equal, or one qualifies the other
};

/**
 * singleWriterProblems(manifest, registry) → [{ kinds: [a, b], owners: [x, y] }]: pairs of owners (the parent or a
 * module) whose declared write kinds overlap (equal, or one a qualifier of the other: `orders.setStatus` covers
 * `orders.setStatus:fulfilment:cancelled`). Reads (registry `read: true`) are not effects and never conflict; kinds of
 * ops the registry does not know are compared like writes.
 */
export function singleWriterProblems(manifest, registry) {
  if (!r2IsObj(manifest)) return [];
  const owners = [];
  const isRead = k => registry?.ops?.[envKindParts(k)[0]]?.read === true;
  if (r2IsObj(manifest.parent)) owners.push(['parent', manifest.parent.effects ?? []]);
  for (const [id, d] of Object.entries(manifest.modules ?? {})) owners.push([id, r2IsObj(d) ? d.effects ?? [] : []]);
  const out = [];
  for (let i = 0; i < owners.length; i++) {
    for (let j = i + 1; j < owners.length; j++) {
      for (const a of owners[i][1]) {
        if (typeof a !== 'string' || isRead(a)) continue;
        for (const b of owners[j][1]) {
          if (typeof b !== 'string' || isRead(b)) continue;
          if (envOverlap(a, b)) out.push({ kinds: [a, b], owners: [owners[i][0], owners[j][0]] });
        }
      }
    }
  }
  return out;
}

/** The gate as problem strings. */
export const singleWriterMessages = (manifest, registry) => singleWriterProblems(manifest, registry)
  .map(p => `single-writer: ${p.owners[0]} declares ${p.kinds[0]} and ${p.owners[1]} declares ${p.kinds[1]}`);

// ---------------------------------------------------------------------------------------------------------------------
// Envelope state, carried in the solver's carry:
//   x = { v: 2, r: { <outbound key>: { d: <args digest | null>, c: <0|1 committed seen>, i: <1 identity key | 0>,
//                                       e: [[<caller key | null>, <emitted>, <delivered>], ...] } },
//         o: [<outbound key>, ...] (first-seen order, for eviction) }
//   and only with option `reconcile`: p: { <outbound key>: { payload, t } } (parked orphan results), q: { <read key>:
//   { nk, legacy, payload, t } } (read-backs in flight), t: <ticks seen>. Without the option the state, and so the
//   carry and the journal, is byte-identical to the envelope before the option existed.

const envFresh = () => ({ v: 2, r: {}, o: [] });
const R2_PARK_TICKS = 3;
const R2_READBACK_TICKS = 20;

/** Unwrap an enveloped carry: { inner, x }. A carry the envelope did not write is the solver's own. */
export function envUnwrap(carry) {
  if (r2IsObj(carry) && carry.cv === R2_CARRY && r2IsObj(carry.x) && carry.x.v === 2) return { inner: carry.c ?? null, x: r2Copy(carry.x) };
  return { inner: carry ?? null, x: envFresh() };
}

/** caller key -> outbound key, for status reads (the latest outbound key wins if a caller reused a key). */
function envLegacyMap(x) {
  const m = new Map();
  for (const nk of x.o) for (const [legacy] of x.r[nk]?.e ?? []) if (typeof legacy === 'string' && legacy !== nk) m.set(legacy, nk);
  return m;
}

function envRecord(x, nk, legacy, digest, findings, { identity }) {
  let rec = x.r[nk];
  if (!rec) { rec = x.r[nk] = { d: null, c: 0, i: identity ? 1 : 0, e: [] }; x.o.push(nk); }
  let e = rec.e.find(z => z[0] === legacy);
  if (!e) {
    if (rec.e.length) findings.push({ code: 'shared-identity', key: nk, first: rec.e[0][0], emitter: legacy });
    e = [legacy, 0, 0];
    rec.e.push(e);
  }
  e[1] += 1;
  if (identity && digest !== null) {
    if (rec.d === null) rec.d = digest;
    else if (rec.d !== digest) findings.push({ code: 'identity-conflict', key: nk, emitter: legacy, committed: rec.c === 1 });
  }
}

/** The keyed slots a result payload carries: [{ key, item? }]. */
const envSlots = p => (typeof p?.key === 'string' ? [{ key: p.key, item: null }]
  : Array.isArray(p?.items) ? p.items.filter(it => r2IsObj(it) && typeof it.key === 'string').map(it => ({ key: it.key, item: it })) : []);

function envSettle(rec, status) {
  if (status === 'ok') rec.c = 1;
  else if (rec.c !== 1 && (status === 'error' || status === 'rate-limited')) rec.d = null;   // nothing committed: a corrected re-emission is no conflict
}

/** Translate one inbound event for the solver; null drops it. */
function envInbound(ev, x, findings, { reconcile = false } = {}) {
  if (!r2IsObj(ev) || ev.type !== 'effect.result' || !r2IsObj(ev.payload)) return ev;
  const slots = envSlots(ev.payload);
  if (!slots.length) return ev;                             // a key-less result: nothing to route or count
  // the read-back of a parked identity: answer the solver's re-emission with the parked result
  if (reconcile && slots.length === 1 && !slots[0].item && r2Own(x.q, slots[0].key)) {
    const q = x.q[slots[0].key];
    delete x.q[slots[0].key];
    const entry = x.r[q.nk]?.e.find(z => z[0] === q.legacy && z[2] < z[1]);
    if (entry) { entry[2] += 1; envSettle(x.r[q.nk], q.payload.status); }
    const read = ev.payload.result?.status ?? null;
    findings.push({ code: 'reconciled', key: q.nk, emitter: q.legacy, parked: q.payload.status, read, ...(q.payload.status === 'ok' && read !== 'committed' ? { mismatch: true } : {}) });
    return { ...r2Copy(ev), payload: { ...r2Copy(q.payload), key: q.legacy } };
  }
  // park an orphaned result of a single write (a read-back's own late result, '=?', is never parked: nothing re-emits it)
  if (reconcile && slots.length === 1 && !slots[0].item && slots[0].key.startsWith('=') && !slots[0].key.startsWith('=?') && !x.r[slots[0].key]) {
    x.p[slots[0].key] = { payload: r2Copy(ev.payload), t: x.t };
    findings.push({ code: 'orphan-parked', key: slots[0].key, event: ev.id ?? null });
    return null;
  }
  const plan = slots.map(s => {
    const rec = x.r[s.key];
    if (!rec) return { s, rec: null, entry: null, why: s.key.startsWith('=') ? 'orphan' : 'foreign' };
    const entry = rec.e.find(z => z[2] < z[1]) ?? null;
    return { s, rec, entry, why: entry ? 'deliver' : 'surplus' };
  });
  // Drop the event when no slot is owed a result (every keyed slot is an orphan or a surplus answer). A key the envelope
  // never issued nor recorded ('foreign') passes through untouched.
  if (plan.every(p => p.why === 'orphan' || p.why === 'surplus')) {
    for (const p of plan) findings.push({ code: p.why, key: p.s.key, event: ev.id ?? null });
    return null;
  }
  const out = r2Copy(ev);
  const outSlots = envSlots(out.payload);
  plan.forEach((p, i) => {
    if (p.why === 'foreign') return;
    if (p.why !== 'deliver') {
      // A batch result owed for some items but not this one: delivered (it is one event), named by its first caller key,
      // and not counted.
      findings.push({ code: `${p.why}-in-batch`, key: p.s.key, event: ev.id ?? null });
      if (p.rec && outSlots[i].item) outSlots[i].item.key = p.rec.e[0]?.[0] ?? null;
      return;
    }
    p.entry[2] += 1;
    const status = p.s.item ? p.s.item.status : ev.payload.status;
    envSettle(p.rec, status);
    const err = p.s.item ? p.s.item.error : ev.payload.error;
    if (err?.reason === 'key-conflict') findings.push({ code: 'host-key-conflict', key: p.s.key, emitter: p.entry[0] });
    const o = outSlots[i];
    if (o.item) o.item.key = p.entry[0];                    // null when the caller gave the item no key
    else out.payload.key = p.entry[0];
  });
  return out;
}

/** Before the solver's tick: unwrap the carry, translate and filter the events, wrap ctx.status. */
export function envBefore(input, ctx, opts = {}) {
  const { inner, x } = envUnwrap(input?.carry);
  // read-back state exists only with the option, so the default carry is byte-identical to the envelope without it
  if (opts.reconcile) { x.p ??= {}; x.q ??= {}; x.t ??= 0; }
  const findings = [];
  const events = [];
  for (const ev of Array.isArray(input?.events) ? input.events : []) { const t = envInbound(ev, x, findings, opts); if (t !== null) events.push(t); }
  const status0 = ctx?.status;
  const ctx2 = ctx && typeof ctx === 'object' ? { ...ctx } : ctx;
  if (ctx2 && typeof status0 === 'function') {
    // The map is rebuilt at each read so emissions earlier in this tick are not visible (the host reads as of the round
    // start, and those emissions are not applied yet either).
    ctx2.status = (system, key) => { const m = envLegacyMap(x); return status0(system, typeof key === 'string' && m.has(key) ? m.get(key) : key); };
  }
  return { input: { ...input, carry: inner, events }, ctx: ctx2, x, findings };
}

/** Evict answered entries (oldest first) until the state fits `budget` bytes; then, if needed, unanswered ones. */
function envEvict(x, budget, maxEntries, findings) {
  let bytes = r2Bytes(x);
  const answered = k => (x.r[k]?.e ?? []).every(z => z[2] >= z[1]);
  for (const pass of ['evicted', 'evicted-pending']) {
    for (let i = 0; i < x.o.length && (bytes > budget || x.o.length > maxEntries);) {
      const k = x.o[i];
      if (pass === 'evicted' && !answered(k)) { i++; continue; }
      bytes -= r2Bytes(k) + r2Bytes(x.r[k]) + r2Bytes(k) + 2;
      delete x.r[k]; x.o.splice(i, 1);
      findings.push({ code: pass, key: k });
    }
  }
}

/** After the solver's tick: re-key its effects by identity, record emissions, wrap the carry, attach findings. */
export function envAfter(out, pre, registry, { maxEnvelopeBytes = 24 * 1024, maxEntries = 400, carryLimit = R2_CARRY_LIMIT, reconcile = false } = {}) {
  if (!r2IsObj(out)) return out;
  const { x, findings } = pre;
  const res = { ...out };
  if (reconcile) x.t = (x.t ?? 0) + 1;
  if (Array.isArray(out.effects)) {
    const local = new Map();                                // caller key -> outbound key, within this output (for `after`)
    const legacyMap = envLegacyMap(x);
    const afterTargets = new Set(out.effects.filter(r2IsObj).map(e => e.after).filter(a => typeof a === 'string'));
    res.effects = out.effects.map(e0 => {
      if (!r2IsObj(e0)) return e0;
      const e = r2Copy(e0);
      const ids = envIdentities(registry, e);
      const op = `${e.system}.${e.op}`;
      if (ids && ids.batch) {
        if (!Array.isArray(e.args?.items)) return e;
        const { items: _i, ...ctxArgs } = e.args;
        e.args.items = e.args.items.map((it, i) => {
          if (!r2IsObj(it)) return it;
          const legacy = typeof it.key === 'string' ? it.key : null;
          const ident = ids.items[i];
          if (ident === null) {
            findings.push({ code: 'identity-unresolved', op, key: legacy });
            if (legacy) envRecord(x, legacy, legacy, null, findings, { identity: false });
            return it;
          }
          const nk = envKey(ident);
          const { key: _k, ...itemArgs } = it;
          envRecord(x, nk, legacy, envDigest({ ...ctxArgs, ...itemArgs }), findings, { identity: true });
          if (!legacy) findings.push({ code: 'key-assigned', op, key: nk });
          return { ...it, key: nk };
        });
        return e;
      }
      const legacy = typeof e.key === 'string' ? e.key : null;
      if (ids && ids.identity !== null) {
        const nk = envKey(ids.identity);
        envRecord(x, nk, legacy, envDigest(e.args ?? null), findings, { identity: true });
        if (!legacy) findings.push({ code: 'key-assigned', op, key: nk });
        else local.set(legacy, nk);
        e.key = nk;
        // read-back: the platform already made this attempt (its result is parked); ask for its status instead of a
        // second attempt, unless a dependant follows this effect's outcome or the system has no status read
        if (reconcile && r2Own(x.p, nk) && !(legacy && afterTargets.has(legacy)) && registry?.ops?.[`${e.system}.status`]?.read === true) {
          const rk = envKey(`readback:${ids.identity}`).replace(/^=/, '=?');
          x.q[rk] = { nk, legacy, payload: x.p[nk].payload, t: x.t };
          delete x.p[nk];
          findings.push({ code: 'readback', key: nk, emitter: legacy });
          return { key: rk, system: e.system, op: 'status', args: { key: nk } };
        }
        return e;
      }
      if (ids) findings.push({ code: 'identity-unresolved', op, key: legacy });
      if (legacy) envRecord(x, legacy, legacy, null, findings, { identity: false });   // reads, unknown ops, unresolved
      return e;
    });
    for (const e of res.effects) {
      if (!r2IsObj(e)) continue;
      if (typeof e.after === 'string' && local.has(e.after)) e.after = local.get(e.after);
      if (typeof e.compensates === 'string') e.compensates = local.get(e.compensates) ?? legacyMap.get(e.compensates) ?? e.compensates;
    }
  }
  if (reconcile) {
    for (const [k, v] of Object.entries(x.p)) if (x.t - v.t > R2_PARK_TICKS) { delete x.p[k]; findings.push({ code: 'park-expired', key: k }); }
    for (const [k, v] of Object.entries(x.q)) if (x.t - v.t > R2_READBACK_TICKS) { delete x.q[k]; findings.push({ code: 'readback-expired', key: v.nk }); }
  }
  const inner = r2Own(out, 'carry') ? out.carry ?? null : null;
  const budget = Math.max(0, Math.min(maxEnvelopeBytes, carryLimit - r2Bytes(inner) - 256));
  envEvict(x, budget, maxEntries, findings);
  res.carry = { cv: R2_CARRY, c: inner, x };
  if (findings.length && r2IsObj(res.decisions)) res.decisions = { ...res.decisions, envelope: { v: 2, runtime: R2_VERSION, n: findings.length, findings: findings.slice(0, R2_MAX_FINDINGS) } };
  return res;
}

/**
 * withEnvelope(solver, { registry, id }) → a solver with the same interface ({ id, tick, sweep?, close? }); tick may be
 * synchronous (inside a bundle) or return a promise (a host-side arm). Sweeps pass through untouched.
 */
export function withEnvelope(solver, { registry, id = null, ...opts } = {}) {
  const w = {
    id: id ?? `${solver?.id ?? 'solver'}+env2`,
    runtime2: R2_VERSION,
    tick(input, ctx) {
      const pre = envBefore(input, ctx, opts);
      const r = solver.tick(pre.input, pre.ctx);
      if (r && typeof r.then === 'function') return r.then(out => envAfter(out, pre, registry, opts));
      return envAfter(r, pre, registry, opts);
    },
  };
  if (typeof solver?.sweep === 'function') w.sweep = (input, ctx) => solver.sweep(input, ctx);
  if (typeof solver?.close === 'function') w.close = () => solver.close();
  return w;
}
