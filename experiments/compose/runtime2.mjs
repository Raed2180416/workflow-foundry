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
//      caller's key (`identity-unresolved`). Reads and ops the registry does not know keep their key. Slot values are
//      escaped, so identities are injective (envFill).
//   2. An inbound inbox. Results are routed back under the caller's own key (null when it gave none), so the wrapped
//      solver sees what it would see without the envelope. Per outbound key the envelope counts, in the carry, each
//      caller key's emissions and delivered results, and (when more than one caller key shares the identity) the order
//      of the emissions still owed a result: the host answers each emission once and, per system, in emission order, so
//      results are handed out first-in first-out. A result for an identity key with no record at all is dropped
//      (`orphan`): it answers an emission a crash rolled back. A result beyond the recorded emissions (a `surplus`)
//      means an unremembered emission came first, so an earlier delivery may have been its answer; the surplus is
//      compared with what the solver was told, and delivered (`conflicting-result`, not counted) when the solver's view
//      would otherwise be wrong: an `ok` when no `ok` was delivered (the effect committed), a 409 key-conflict (its
//      remembered arguments differ from the committed ones), or a failure that differs from the failure delivered. It
//      is dropped when it agrees (`surplus`), or when it is a failure after a delivered `ok` (`surplus-after-commit`:
//      the effect committed and the solver knows it). Timer and human-task events are never filtered: after a crash
//      the solver's state rolled back with the envelope's, so it must see them again.
//      Option `reconcile` (read-back, off by default): the host remembers committed keys only, so a re-emission after a
//      crash re-attempts an effect whose first attempt FAILED (a declined charge is tried twice). With `reconcile`, an
//      orphaned FAILURE of a single write is parked in the carry; when the solver re-emits that identity (within three
//      ticks, with no `after` dependant, on a system with a status read), the envelope sends a read of the identity
//      key's status instead. If the read confirms that nothing committed (`not-found`), the re-emission is answered
//      with the parked failure; otherwise (committed, pending, or the read failed or never came) the re-emission goes
//      to the system as written (`readback-reissued`), so the host's own idempotency answers it. An orphaned `ok` is
//      never parked: the re-emission goes to the host, which answers with the committed result when the arguments are
//      equal and with 409 key-conflict when they differ. Limit: the host's status read returns { key, status } only,
//      so a re-emission whose arguments differ from those of the failed, rolled-back attempt cannot be told apart.
//   3. A static single-writer gate (singleWriterProblems): a manifest in which two owners (parent or modules) declare
//      overlapping write kinds is a problem (bundle2.mjs refuses it by default; `report` mode records it). At run time
//      a second caller key for one identity inside an instance is logged (`shared-identity`) and its write is a no-op
//      at the host.
// The envelope's state rides in the carry ({ cv: 'env2', c: <the solver's carry>, x: <envelope state> }), so a crash
// that rolls the carry back rolls the envelope back with it, and a restart keeps it. Answered entries are evicted
// oldest first when the state outgrows its byte budget, then parked read-back results; an entry still owed a result is
// never evicted. If what remains does not fit the host's carry limit (64 KiB for the solver's carry and the envelope's
// state together) the tick throws, loudly, instead of dropping a result the solver waits for.
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
    else {
      if (!e.identity.startsWith(`${op.split('.')[1]}`) && !/^[a-z][a-z-]*:/.test(e.identity)) out.push(`${op}: identity must start with a kind prefix ("kind:")`);
      // injectivity: slot values are escaped (no ':', '%' or '#' survives), so two slots must be separated by text with a
      // ':' and a default may not contain those characters (else '{a}{b}' or a default spelled like a value collide)
      if (/\}[^{:]*\{/.test(e.identity)) out.push(`${op}: two slots must be separated by text containing ':'`);
      for (const m of e.identity.matchAll(R2_SLOT)) if (m[2] !== undefined && /[%:#{}]/.test(m[2])) out.push(`${op}: slot default ${JSON.stringify(m[2])} may not contain % : # { }`);
    }
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

/** One slot value, escaped so the filled template is injective: '%', ':' and '#' as %XX; a number as '#<n>'. */
const r2Esc = s => s.replace(/[%:#]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * Fill an identity template from arguments; null when a required argument is missing, null, or not a string or a
 * finite number. {arg|x} writes x when the argument is null or missing. Values are escaped (r2Esc), a number is written
 * '#<n>' (so 1 and '1' differ), and a value spelled like its slot's default is written '%=' + value (so a fulfilment
 * id '-' differs from a missing one). E8's identities contain none of these characters, so they equal identityOf's.
 */
export function envFill(tmpl, args) {
  let ok = true;
  const s = tmpl.replace(R2_SLOT, (m, f, dflt) => {
    const v = r2IsObj(args) ? args[f] : undefined;
    if (v === null || v === undefined) { if (dflt !== undefined) return dflt; ok = false; return ''; }
    if (typeof v === 'number') { if (!Number.isFinite(v)) { ok = false; return ''; } return `#${v}`; }
    if (typeof v !== 'string') { ok = false; return ''; }
    const e = r2Esc(v);
    return dflt !== undefined && e === dflt ? `%=${e}` : e;
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
//   x = { v: 2, r: { <outbound key>: { d: <args digest | null>, c: <0|1 an ok delivered>, i: <1 identity key | 0>,
//                                       e: [[<caller key | null>, <emitted>, <delivered>], ...],
//                                       l?: <8-hex digest of the last failure delivered, while no ok was>,
//                                       f?: [<index into e>, ...] (owed emissions in emission order) and
//                                       z?: <index into e of the latest emission>, both only once a second caller key
//                                           shares the identity } },
//         o: [<outbound key>, ...] (first-seen order, for eviction) }
//   and only with option `reconcile`: p: { <outbound key>: { payload, t } } (parked orphaned failures), q: { <read
//   key>: { nk, legacy, payload, w: <the re-emitted write>, t } } (read-backs in flight), w: [<write to re-issue>, ...],
//   t: <ticks seen>. Without the option the state holds none of these fields.

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

const envOwed = rec => rec.e.reduce((n, z) => n + Math.max(0, z[1] - z[2]), 0);

function envRecord(x, nk, legacy, digest, findings, { identity }) {
  let rec = x.r[nk];
  if (!rec) { rec = x.r[nk] = { d: null, c: 0, i: identity ? 1 : 0, e: [] }; x.o.push(nk); }
  let idx = rec.e.findIndex(z => z[0] === legacy);
  if (idx < 0) {
    if (rec.e.length) findings.push({ code: 'shared-identity', key: nk, first: rec.e[0][0], emitter: legacy });
    rec.e.push([legacy, 0, 0]);
    idx = rec.e.length - 1;
  }
  // first-in first-out over caller keys, kept only once a second caller key shares the identity: the owed emissions so
  // far all belong to the first caller key, which emitted them earlier
  if (rec.e.length > 1 && !Array.isArray(rec.f)) rec.f = Array(Math.max(0, rec.e[0][1] - rec.e[0][2])).fill(0);
  rec.e[idx][1] += 1;
  if (Array.isArray(rec.f)) { rec.f.push(idx); rec.z = idx; }
  if (identity && digest !== null) {
    if (rec.d === null) rec.d = digest;
    else if (rec.d !== digest) findings.push({ code: 'identity-conflict', key: nk, emitter: legacy, committed: rec.c === 1 });
  }
}

/** Take the entry owed the next result (first-in first-out; a given caller key's own entry for a read-back answer). */
function envTake(rec, legacy) {
  let i;
  if (legacy !== undefined) i = rec.e.findIndex(z => z[0] === legacy && z[2] < z[1]);
  else {
    while (Array.isArray(rec.f) && rec.f.length && !(rec.e[rec.f[0]] && rec.e[rec.f[0]][2] < rec.e[rec.f[0]][1])) rec.f.shift();
    i = Array.isArray(rec.f) && rec.f.length ? rec.f[0] : rec.e.findIndex(z => z[2] < z[1]);
  }
  if (i < 0 || !rec.e[i] || rec.e[i][2] >= rec.e[i][1]) return null;
  if (Array.isArray(rec.f)) { const j = rec.f.indexOf(i); if (j >= 0) rec.f.splice(j, 1); }
  rec.e[i][2] += 1;
  return rec.e[i];
}

/** The caller key of the latest emission of an identity (the one a surplus answers). */
const envLatest = rec => (rec.e[typeof rec.z === 'number' ? rec.z : rec.e.length - 1] ?? rec.e[0])?.[0] ?? null;

/** The keyed slots a result payload carries: [{ key, item? }]. */
const envSlots = p => (typeof p?.key === 'string' ? [{ key: p.key, item: null }]
  : Array.isArray(p?.items) ? p.items.filter(it => r2IsObj(it) && typeof it.key === 'string').map(it => ({ key: it.key, item: it })) : []);

/** What a slot says: { status, digest } (digest over status, result and error; 8 hex characters). */
function envSays(ev, s) {
  const src = s.item ?? ev.payload;
  const status = src.status ?? null;
  return { status, error: src.error ?? null, digest: envDigest({ status, result: src.result ?? null, error: src.error ?? null }).slice(0, 8) };
}

/** Record a result delivered for an identity: committed, or the failure the solver was told. */
function envSettle(rec, said) {
  if (said.status === 'ok') { rec.c = 1; delete rec.l; return; }
  rec.l = said.digest;
  if (rec.c !== 1 && (said.status === 'error' || said.status === 'rate-limited')) rec.d = null;   // nothing committed: a corrected re-emission is no conflict
}

/** A result beyond the recorded emissions: 'conflict' (deliver it), 'surplus' or 'surplus-after-commit' (drop it). */
function envSurplus(rec, said) {
  if (said.status === 'ok') return rec.c === 1 ? 'surplus' : 'conflict';
  if (said.error?.reason === 'key-conflict') return 'conflict';
  if (rec.c === 1) return 'surplus-after-commit';
  return rec.l === said.digest ? 'surplus' : 'conflict';
}

/** Translate one inbound event for the solver; null drops it. */
function envInbound(ev, x, findings, { reconcile = false } = {}) {
  if (!r2IsObj(ev) || ev.type !== 'effect.result' || !r2IsObj(ev.payload)) return ev;
  const slots = envSlots(ev.payload);
  if (!slots.length) return ev;                             // a key-less result: nothing to route or count
  // the read-back of a parked identity: answer the solver's re-emission with the parked failure if the read confirms
  // that nothing committed; otherwise re-issue the re-emitted write (the host's idempotency then answers it)
  if (reconcile && slots.length === 1 && !slots[0].item && r2Own(x.q, slots[0].key)) {
    const q = x.q[slots[0].key];
    delete x.q[slots[0].key];
    const read = ev.payload.status === 'ok' ? ev.payload.result?.status ?? null : `read-${ev.payload.status ?? 'failed'}`;
    if (read !== 'not-found') {
      x.w.push({ ...q.w, key: q.nk });
      findings.push({ code: 'readback-reissued', key: q.nk, emitter: q.legacy, parked: q.payload.status, read });
      return null;
    }
    const rec = x.r[q.nk];
    if (rec && envTake(rec, q.legacy)) envSettle(rec, envSays({ payload: q.payload }, { item: null }));
    findings.push({ code: 'reconciled', key: q.nk, emitter: q.legacy, parked: q.payload.status, read });
    return { ...r2Copy(ev), payload: { ...r2Copy(q.payload), key: q.legacy } };
  }
  // park an orphaned failure of a single write (a read-back's own late result, '=?', is never parked: nothing
  // re-emits it; an orphaned `ok` is not parked: the host answers a re-emission of a committed key exactly)
  if (reconcile && slots.length === 1 && !slots[0].item && slots[0].key.startsWith('=') && !slots[0].key.startsWith('=?') && !x.r[slots[0].key]
      && ev.payload.status !== 'ok') {
    x.p[slots[0].key] = { payload: r2Copy(ev.payload), t: x.t };
    findings.push({ code: 'orphan-parked', key: slots[0].key, event: ev.id ?? null });
    return null;
  }
  // classify every slot before changing anything (two items of one batch may share an identity)
  const owedLeft = new Map();
  const plan = slots.map(s => {
    const rec = x.r[s.key];
    if (!rec) return { s, rec: null, why: s.key.startsWith('=') ? 'orphan' : 'foreign' };
    if (!owedLeft.has(rec)) owedLeft.set(rec, envOwed(rec));
    const said = envSays(ev, s);
    if (owedLeft.get(rec) > 0) { owedLeft.set(rec, owedLeft.get(rec) - 1); return { s, rec, said, why: 'deliver' }; }
    return { s, rec, said, why: envSurplus(rec, said) };
  });
  // Drop the event when no slot is owed or due a result (every keyed slot is an orphan or an agreeing surplus). A key the
  // envelope never issued nor recorded ('foreign') passes through untouched.
  if (plan.every(p => p.why === 'orphan' || p.why === 'surplus' || p.why === 'surplus-after-commit')) {
    for (const p of plan) findings.push({ code: p.why, key: p.s.key, event: ev.id ?? null });
    return null;
  }
  const out = r2Copy(ev);
  const outSlots = envSlots(out.payload);
  plan.forEach((p, i) => {
    if (p.why === 'foreign') return;
    const o = outSlots[i];
    if (p.why === 'deliver') {
      const entry = envTake(p.rec);
      const legacy = entry ? entry[0] : envLatest(p.rec);
      envSettle(p.rec, p.said);
      if (p.said.error?.reason === 'key-conflict') findings.push({ code: 'host-key-conflict', key: p.s.key, emitter: legacy });
      if (o.item) o.item.key = legacy;                      // null when the caller gave the item no key
      else out.payload.key = legacy;
      return;
    }
    // A conflicting surplus answers the latest emission the solver remembers: delivered under its caller key and not
    // counted. Any other non-delivered slot of a delivered batch event rides along, named the same way (an orphan item
    // keeps its key), and is not counted.
    if (p.why === 'conflict') {
      envSettle(p.rec, p.said);
      findings.push({ code: o.item ? 'conflicting-result-in-batch' : 'conflicting-result', key: p.s.key, emitter: envLatest(p.rec), status: p.said.status });
      if (p.said.error?.reason === 'key-conflict') findings.push({ code: 'host-key-conflict', key: p.s.key, emitter: envLatest(p.rec) });
    } else findings.push({ code: `${p.why}-in-batch`, key: p.s.key, event: ev.id ?? null });
    if (!p.rec) return;
    if (o.item) o.item.key = envLatest(p.rec);
    else out.payload.key = envLatest(p.rec);
  });
  return out;
}

/** Before the solver's tick: unwrap the carry, translate and filter the events, wrap ctx.status. */
export function envBefore(input, ctx, opts = {}) {
  const { inner, x } = envUnwrap(input?.carry);
  // read-back state exists only with the option
  if (opts.reconcile) { x.p ??= {}; x.q ??= {}; x.w ??= []; x.t ??= 0; }
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

/**
 * Evict answered entries (oldest first) until the state fits `budget` bytes and `maxEntries`, then parked read-back
 * results (dropping one only forgoes its read-back). An entry still owed a result is never evicted: the result would
 * arrive as an orphan and the solver would never see it.
 */
function envEvict(x, budget, maxEntries, findings) {
  let bytes = r2Bytes(x);
  const answered = k => (x.r[k]?.e ?? []).every(z => z[2] >= z[1]);
  for (let i = 0; i < x.o.length && (bytes > budget || x.o.length > maxEntries);) {
    const k = x.o[i];
    if (!answered(k)) { i++; continue; }
    bytes -= r2Bytes(k) + r2Bytes(x.r[k]) + r2Bytes(k) + 2;
    delete x.r[k]; x.o.splice(i, 1);
    findings.push({ code: 'evicted', key: k });
  }
  if (r2IsObj(x.p)) for (const k of Object.keys(x.p)) {
    if (bytes <= budget) break;
    bytes -= r2Bytes(k) + r2Bytes(x.p[k]) + 2;
    delete x.p[k];
    findings.push({ code: 'park-evicted', key: k });
  }
  if (bytes > budget || x.o.length > maxEntries) findings.push({ code: 'over-budget', bytes: r2Bytes(x), budget, entries: x.o.length });
}

/** After the solver's tick: re-key its effects by identity, record emissions, wrap the carry, attach findings. */
export function envAfter(out, pre, registry, { maxEnvelopeBytes = 24 * 1024, maxEntries = 400, carryLimit = R2_CARRY_LIMIT, reconcile = false } = {}) {
  if (!r2IsObj(out)) return out;
  const { x, findings } = pre;
  const res = { ...out };
  if (reconcile) x.t = (x.t ?? 0) + 1;
  if (Array.isArray(out.effects)) {
    const local = new Map();                                // caller key -> outbound key, within this output (for `after`/`compensates`)
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
        // read-back: the platform already made this attempt and it failed (its result is parked); ask whether anything
        // committed instead of a second attempt, unless a dependant follows this effect's outcome or the system has no
        // status read
        if (reconcile && r2Own(x.p, nk) && !(legacy && afterTargets.has(legacy)) && registry?.ops?.[`${e.system}.status`]?.read === true) {
          const rk = envKey(`readback:${ids.identity}`).replace(/^=/, '=?');
          const { key: _k, after: _a, ...w } = e;
          if (typeof w.compensates === 'string') w.compensates = local.get(w.compensates) ?? legacyMap.get(w.compensates) ?? w.compensates;
          x.q[rk] = { nk, legacy, payload: x.p[nk].payload, w, t: x.t };
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
    // a read-back whose answer never came: the re-emitted write goes to the system after all
    for (const [k, v] of Object.entries(x.q)) if (x.t - v.t > R2_READBACK_TICKS) { delete x.q[k]; x.w.push({ ...v.w, key: v.nk }); findings.push({ code: 'readback-expired', key: v.nk, emitter: v.legacy }); }
    if (x.w.length) {
      res.effects = [...(Array.isArray(res.effects) ? res.effects : []), ...x.w];
      for (const w of x.w) findings.push({ code: 'reissued', key: w.key });
      x.w = [];
    }
  }
  const inner = r2Own(out, 'carry') ? out.carry ?? null : null;
  const innerBytes = r2Bytes(inner);
  const budget = Math.max(0, Math.min(maxEnvelopeBytes, carryLimit - innerBytes - 256));
  envEvict(x, budget, maxEntries, findings);
  res.carry = { cv: R2_CARRY, c: inner, x };
  const total = r2Bytes(res.carry);
  if (total > carryLimit) {
    const owed = x.o.reduce((n, k) => n + envOwed(x.r[k]), 0);
    throw new Error(`${R2_VERSION}: the carry would be ${total} bytes (the solver's ${innerBytes}), over the host limit of ${carryLimit}, and the envelope holds ${owed} results still owed; it does not drop them`);
  }
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
