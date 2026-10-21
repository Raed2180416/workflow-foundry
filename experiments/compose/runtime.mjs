// Composition runtime for composed tick/1 solvers (research/composition-20261021/HARNESS.md §2). $0, no model calls.
//
// A composed program is a parent orchestrator plus sub-workflow modules, each declared in a manifest
// (composition.json) with a typed input and output, the effect kinds and human-task kinds it may emit, whether it may
// set timers, the systems it may read and the modules it may call. The runtime, not the builder, runs the program:
//   - the parent gets the host's case-tick (its own state instead of the carry) and reaches modules only through
//     ctx.call(module, key, input) (a typed call to the sub-workflow instance `key` of `module`) and ctx.deliver(event)
//     (an effect result, timer or human-task event the module instance caused, routed back to it by provenance);
//   - every module instance has its own durable state slot; the parent never sees it, only the module's typed output;
//   - every effect, timer and human task is attributed to the module (or the parent) that emitted it, and checked
//     against that emitter's declaration; calls are checked against the declared call graph; inputs and outputs
//     against the declared schemas; reads against the declared systems. A breach is an interface violation, recorded
//     per tick. Mode 'strict' (the default) also enforces: an undeclared effect, timer or task is dropped (never
//     reaches the platform) and an undeclared call, a schema breach or a recursion is refused (an error thrown to the
//     caller). Mode 'audit' records and lets everything through.
//   - the tick's output is an ordinary TickOutput; the per-tick trace rides in `decisions.composition` (E8 grades
//     `decisions.subject` only, contract §3.1), so the host, the oracle and every existing tool are unchanged, and the
//     harness re-verifies the trace against the trusted manifest from the journal (trace.mjs).
// This file imports nothing: bundle.mjs inlines it into the solver.mjs the sandbox runs (exports stripped).

export const RUNTIME_VERSION = 'compose-runtime/1';
export const MODULE_ID = /^[a-z][a-z0-9-]{0,39}$/;
export const PORTABLE = Object.freeze(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const',
  'minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'maxLength', 'description']);
const MAX_DEPTH = 6;
const MAX_ID = 200;
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const jcopy = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** An interface violation thrown to the caller (strict mode) or an error the runtime raises itself. */
export class InterfaceError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = 'InterfaceError'; this.code = code; }
}

// ---------------------------------------------------------------------------------------------------------------------
// Portable-subset JSON Schema (the host's subset, beds/ebed/host/schema.mjs), self-contained.

/** Problems of a schema under the portable subset ([] when fine). */
export function schemaProblems(schema, path = '#', depth = 0) {
  const out = [];
  if (depth > 20) return [`${path}: nested too deeply`];
  if (!isObj(schema)) return [`${path}: must be an object`];
  for (const k of Object.keys(schema)) if (!PORTABLE.includes(k)) out.push(`${path}: keyword ${k} is outside the portable subset`);
  if (own(schema, 'type')) {
    const ts = [].concat(schema.type);
    if (!ts.length || ts.some(t => !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(t))) out.push(`${path}: bad type`);
  }
  if (own(schema, 'properties')) {
    if (!isObj(schema.properties)) out.push(`${path}.properties: must be an object`);
    else for (const [k, s] of Object.entries(schema.properties)) out.push(...schemaProblems(s, `${path}.properties.${k}`, depth + 1));
  }
  if (own(schema, 'required') && !(Array.isArray(schema.required) && schema.required.every(x => typeof x === 'string'))) out.push(`${path}.required: must be strings`);
  if (own(schema, 'additionalProperties') && typeof schema.additionalProperties !== 'boolean') out.push(...schemaProblems(schema.additionalProperties, `${path}.additionalProperties`, depth + 1));
  if (own(schema, 'items')) out.push(...schemaProblems(schema.items, `${path}.items`, depth + 1));
  if (own(schema, 'enum') && !(Array.isArray(schema.enum) && schema.enum.length)) out.push(`${path}.enum: must be a non-empty array`);
  return out.slice(0, 20);
}

const typeOk = (t, v) => (t === 'null' ? v === null : t === 'object' ? isObj(v) : t === 'array' ? Array.isArray(v)
  : t === 'string' ? typeof v === 'string' : t === 'number' ? typeof v === 'number' && Number.isFinite(v)
  : t === 'integer' ? Number.isInteger(v) : t === 'boolean' ? typeof v === 'boolean' : false);
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Validation errors of `value` against a portable-subset schema ([] when valid; at most 8). */
export function validate(schema, value, path = '$') {
  const errs = [];
  const walk = (s, v, p) => {
    if (errs.length >= 8 || !isObj(s)) return;
    if (own(s, 'type') && ![].concat(s.type).some(t => typeOk(t, v))) { errs.push(`${p}: expected ${[].concat(s.type).join('|')}`); return; }
    if (own(s, 'enum') && !s.enum.some(x => deepEq(x, v))) errs.push(`${p}: not one of ${JSON.stringify(s.enum).slice(0, 80)}`);
    if (own(s, 'const') && !deepEq(s.const, v)) errs.push(`${p}: must be ${JSON.stringify(s.const).slice(0, 80)}`);
    if (typeof v === 'number') {
      if (own(s, 'minimum') && v < s.minimum) errs.push(`${p}: below ${s.minimum}`);
      if (own(s, 'maximum') && v > s.maximum) errs.push(`${p}: above ${s.maximum}`);
    }
    if (typeof v === 'string') {
      const n = [...v].length;
      if (own(s, 'minLength') && n < s.minLength) errs.push(`${p}: shorter than ${s.minLength}`);
      if (own(s, 'maxLength') && n > s.maxLength) errs.push(`${p}: longer than ${s.maxLength}`);
    }
    if (Array.isArray(v)) {
      if (own(s, 'minItems') && v.length < s.minItems) errs.push(`${p}: fewer than ${s.minItems} items`);
      if (own(s, 'maxItems') && v.length > s.maxItems) errs.push(`${p}: more than ${s.maxItems} items`);
      if (own(s, 'items')) v.forEach((x, i) => walk(s.items, x, `${p}[${i}]`));
    }
    if (isObj(v)) {
      for (const k of s.required ?? []) if (!own(v, k)) errs.push(`${p}.${k}: required`);
      const props = isObj(s.properties) ? s.properties : {};
      for (const [k, x] of Object.entries(v)) {
        if (own(props, k)) walk(props[k], x, `${p}.${k}`);
        else if (s.additionalProperties === false) errs.push(`${p}.${k}: not allowed`);
        else if (isObj(s.additionalProperties)) walk(s.additionalProperties, x, `${p}.${k}`);
      }
    }
  };
  walk(schema, value, path);
  return errs;
}

// ---------------------------------------------------------------------------------------------------------------------
// Manifest

/**
 * Problems of a composition manifest ([] when valid). `ops` (optional): the item's effect ops as 'system.op' names, to
 * check declared effect kinds; `taskKinds` (optional): the item's human-task kinds.
 */
export function manifestProblems(m, { ops = null, taskKinds = null } = {}) {
  const out = [];
  if (!isObj(m)) return ['manifest: must be an object'];
  if (m.version !== 1) out.push('version: must be 1');
  if (!isObj(m.parent)) out.push('parent: required object');
  if (!isObj(m.modules) || !Object.keys(m.modules).length) out.push('modules: required, at least one module');
  if (out.length) return out;
  const ids = Object.keys(m.modules);
  for (const id of ids) if (!MODULE_ID.test(id) || id === 'parent') out.push(`modules.${id}: id must match ${MODULE_ID} and not be "parent"`);
  const kindOk = k => typeof k === 'string' && (!ops || ops.includes(k.split(':')[0]));
  const checkDecl = (d, where, isParent) => {
    for (const k of Object.keys(d)) if (!['file', 'purpose', 'rules', 'input', 'output', 'effects', 'humanTasks', 'timers', 'calls', 'reads'].includes(k)) out.push(`${where}: unknown field ${k}`);
    if (typeof d.file !== 'string' || !/^[A-Za-z0-9_./-]+\.mjs$/.test(d.file) || d.file.includes('..')) out.push(`${where}.file: a relative .mjs path`);
    for (const f of ['effects', 'humanTasks', 'calls', 'reads', 'rules']) if (own(d, f) && !(Array.isArray(d[f]) && d[f].every(x => typeof x === 'string'))) out.push(`${where}.${f}: array of strings`);
    for (const k of d.effects ?? []) if (!kindOk(k)) out.push(`${where}.effects: unknown effect kind ${k}`);
    if (taskKinds) for (const k of d.humanTasks ?? []) if (!taskKinds.includes(k)) out.push(`${where}.humanTasks: unknown task kind ${k}`);
    for (const c of d.calls ?? []) if (!own(m.modules, c)) out.push(`${where}.calls: unknown module ${c}`);
    if (own(d, 'timers') && typeof d.timers !== 'boolean') out.push(`${where}.timers: boolean`);
    if (!isParent) {
      for (const f of ['input', 'output']) {
        if (!own(d, f)) out.push(`${where}.${f}: required schema`);
        else out.push(...schemaProblems(d[f], `${where}.${f}`));
      }
    }
  };
  checkDecl(m.parent, 'parent', true);
  for (const id of ids) checkDecl(m.modules[id], `modules.${id}`, false);
  const files = [m.parent.file, ...ids.map(id => m.modules[id].file)];
  if (new Set(files).size !== files.length) out.push('files: every module needs its own file');
  // The call graph must be acyclic (a sub-workflow never calls back up).
  const state = {};
  const visit = (id, trail) => {
    if (state[id] === 2) return;
    if (state[id] === 1) { out.push(`calls: cycle ${[...trail, id].join(' -> ')}`); return; }
    state[id] = 1;
    for (const c of m.modules[id]?.calls ?? []) if (own(m.modules, c)) visit(c, [...trail, id]);
    state[id] = 2;
  };
  for (const id of ids) visit(id, []);
  return out.slice(0, 40);
}

/** Modules reachable from the parent through the declared call graph. */
export function reachable(m) {
  const seen = new Set();
  const go = id => { for (const c of (id === 'parent' ? m.parent.calls : m.modules[id]?.calls) ?? []) if (!seen.has(c)) { seen.add(c); go(c); } };
  go('parent');
  return seen;
}

// ---------------------------------------------------------------------------------------------------------------------
// The runtime

/** Default realm: trusted in-process modules (plain objects, JSON copies across the boundary). */
export function plainRealm() {
  return {
    toRealm: (who, v) => jcopy(v),
    makeCtx: (who, meta, h) => ({ ...meta, get files() { return h.files(); }, query: h.query, status: h.status, instances: h.instances,
      call: h.call, deliver: h.deliver, ownerOf: h.ownerOf, emit: h.emit }),
  };
}

/**
 * createComposedSolver({ manifest, parent, modules, kindsOf, mode, realm, id }) → { id, tick(input, hostCtx) }.
 * parent: { tick(input, ctx) → { decisions, state?, effects?, obligations?, humanTasks?, merge?, close? } };
 * modules: { [id]: { step?(input, ctx) → Result, onEvent?(event, ctx) → Result } },
 *   Result = { output?, state?, effects?, obligations?: { upsert?, cancel? }, humanTasks? };
 * kindsOf(effect) → the effect's qualified kinds, least to most specific (e.g. ['notify.send', 'notify.send:order-cancelled']).
 */
export function createComposedSolver({ manifest, parent, modules, kindsOf = e => [`${e.system}.${e.op}`], mode = 'strict', realm = plainRealm(), id = 'composed' }) {
  if (!['strict', 'audit'].includes(mode)) throw new Error(`mode must be strict or audit: ${mode}`);
  const M = manifest;
  const reach = reachable(M);
  const declOf = who => (who === 'parent' ? M.parent : M.modules[who]);

  function tick(input, hostCtx) {
    const carry = isObj(input.carry) && input.carry.cv === 1 ? jcopy(input.carry) : { cv: 1, p: null, m: {}, own: {}, ob: {}, tk: {} };
    const out = { effects: [], owners: [], upsert: [], cancel: [], tasks: [] };
    const trace = { v: 1, owners: out.owners, calls: [], violations: [], dropped: [] };
    const undo = [];                              // undo log for atomic calls
    const stack = [];                             // the modules currently running (call chain)
    const violation = (code, who, detail, extra = {}) => { trace.violations.push({ code, module: who, ...(stack.length ? { by: stack.at(-1) } : {}), detail: String(detail).slice(0, 300), ...extra }); };
    const strict = mode === 'strict';
    const refuse = (code, who, detail) => { violation(code, who, detail); if (strict) throw new InterfaceError(code, detail); };

    // --- effect, timer and task intake, attributed to `who` ---
    const keysOf = e => [...(typeof e.key === 'string' ? [e.key] : []), ...(Array.isArray(e?.args?.items) ? e.args.items.map(i => i?.key).filter(k => typeof k === 'string') : [])];
    const ownerTag = (who, ikey) => (who === 'parent' ? 'parent' : `${who}\u0001${ikey}`);
    function takeEffect(who, ikey, e) {
      if (!isObj(e) || typeof e.system !== 'string' || typeof e.op !== 'string') { violation('bad-effect', who, 'an effect must be { system, op, args, key? }'); if (strict) return; }
      const decl = declOf(who);
      const kinds = isObj(e) ? kindsOf(e) : [];
      const declared = decl.effects ?? [];
      const ok = kinds.some(k => declared.includes(k));
      if (!ok) {
        violation(who === 'parent' ? 'parent-effect-undeclared' : 'effect-undeclared', who, `${kinds.at(-1) ?? '?'} is not among ${JSON.stringify(declared).slice(0, 200)}`, { kind: kinds.at(-1) ?? null });
        if (strict) { trace.dropped.push({ owner: who, kind: kinds.at(-1) ?? null, key: keysOf(e)[0] ?? null }); return; }
      }
      const tag = ownerTag(who, ikey);
      for (const k of keysOf(e)) {
        const prev = carry.own[k];
        if (prev !== undefined && prev !== tag) {
          violation('key-foreign', who, `key ${k} belongs to ${prev.split('\u0001')[0]}`);
          if (strict) { trace.dropped.push({ owner: who, kind: kinds.at(-1) ?? null, key: k }); return; }
        }
      }
      for (const k of keysOf(e)) if (carry.own[k] === undefined) { carry.own[k] = tag; undo.push(() => { delete carry.own[k]; }); }
      out.effects.push(e); out.owners.push(who);
      undo.push(() => { out.effects.pop(); out.owners.pop(); });
    }
    const nsId = (who, ikey, local) => {
      const s = `${who}/${ikey}/${local}`;
      if (s.length > MAX_ID) throw new InterfaceError('id-too-long', `${s.slice(0, 60)}...`);
      return s;
    };
    function takeObligations(who, ikey, ob) {
      if (ob === undefined || ob === null) return;
      if (!isObj(ob)) { violation('bad-result', who, 'obligations must be { upsert, cancel }'); return; }
      const up = Array.isArray(ob.upsert) ? ob.upsert : [], cancel = Array.isArray(ob.cancel) ? ob.cancel : [];
      if (!up.length && !cancel.length) return;
      if (who !== 'parent' && declOf(who).timers !== true) { violation('timer-undeclared', who, 'timers: true is not declared'); if (strict) return; }
      for (const o of up) {
        if (!isObj(o) || typeof o.id !== 'string') { violation('bad-result', who, 'an obligation needs an id'); continue; }
        if (who === 'parent') { out.upsert.push(o); undo.push(() => out.upsert.pop()); continue; }
        const id2 = nsId(who, ikey, o.id);
        const had = carry.ob[id2];
        carry.ob[id2] = [who, ikey, o.id];
        out.upsert.push({ ...o, id: id2 });
        undo.push(() => { out.upsert.pop(); if (had === undefined) delete carry.ob[id2]; else carry.ob[id2] = had; });
      }
      for (const c of cancel) {
        if (typeof c !== 'string') continue;
        const id2 = who === 'parent' ? c : nsId(who, ikey, c);
        out.cancel.push(id2); undo.push(() => out.cancel.pop());
      }
    }
    function takeTasks(who, ikey, tasks) {
      if (tasks === undefined || tasks === null) return;
      if (!Array.isArray(tasks)) { violation('bad-result', who, 'humanTasks must be an array'); return; }
      for (const t of tasks) {
        if (!isObj(t) || typeof t.id !== 'string') { violation('bad-result', who, 'a human task needs an id'); continue; }
        if (!(declOf(who).humanTasks ?? []).includes(t.kind)) {
          violation(who === 'parent' ? 'parent-task-undeclared' : 'task-undeclared', who, `task kind ${t.kind} is not declared`, { kind: t.kind ?? null });
          if (strict) continue;
        }
        if (who === 'parent') { out.tasks.push(t); undo.push(() => out.tasks.pop()); continue; }
        const id2 = nsId(who, ikey, t.id);
        const had = carry.tk[id2];
        carry.tk[id2] = [who, ikey, t.id];
        out.tasks.push({ ...t, id: id2 });
        undo.push(() => { out.tasks.pop(); if (had === undefined) delete carry.tk[id2]; else carry.tk[id2] = had; });
      }
    }

    // --- ownership of inbound events (provenance, never business meaning) ---
    function ownerOf(ev) {
      if (!isObj(ev) || !isObj(ev.payload)) return null;
      const p = ev.payload;
      let tag = null, local = null;
      if (ev.type === 'effect.result') {
        const k = typeof p.key === 'string' ? p.key : Array.isArray(p.items) ? p.items.map(i => i?.key).find(x => typeof x === 'string') : null;
        tag = k ? carry.own[k] ?? null : null;
        if (tag === 'parent') tag = null;
        return tag ? { module: tag.split('\u0001')[0], key: tag.split('\u0001').slice(1).join('\u0001') } : null;
      }
      if (ev.type === 'timer.fired') local = carry.ob[p.obligationId];
      else if (typeof ev.type === 'string' && ev.type.startsWith('humanTask.')) local = carry.tk[p.taskId];
      return Array.isArray(local) ? { module: local[0], key: local[1] } : null;
    }
    const localise = ev => {
      const e = jcopy(ev);
      if (e.type === 'timer.fired' && Array.isArray(carry.ob[e.payload.obligationId])) e.payload.obligationId = carry.ob[e.payload.obligationId][2];
      if (typeof e.type === 'string' && e.type.startsWith('humanTask.') && Array.isArray(carry.tk[e.payload.taskId])) e.payload.taskId = carry.tk[e.payload.taskId][2];
      return e;
    };

    // --- reads ---
    const readable = who => {
      if (who === 'parent') return null;                       // the parent reads everything (correlation is its job)
      const d = declOf(who);
      return new Set([...(d.reads ?? []), ...(d.effects ?? []).map(k => k.split('.')[0])]);
    };
    const handlersFor = (who, ikey) => {
      const can = readable(who);
      const checkRead = system => { if (can && !can.has(system)) refuse('read-undeclared', who, `reads of ${system} are not declared`); };
      return {
        files: () => realm.toRealm(who, hostCtx.files),
        query: (table, filter) => { checkRead(String(table).split('.')[0]); return realm.toRealm(who, hostCtx.query(table, filter)); },
        status: (system, key) => { checkRead(system); return hostCtx.status(system, key); },
        instances: f => { if (who !== 'parent') refuse('instances-module', who, 'only the parent reads the open-instance index'); return realm.toRealm(who, hostCtx.instances(f)); },
        call: (mid, key, inp) => realm.toRealm(who, invoke(who, mid, key, 'call', inp)),
        deliver: ev => {
          const o = ownerOf(ev);
          if (!o) throw new InterfaceError('deliver-unowned', `no module instance owns event ${ev?.id ?? '?'} (${ev?.type ?? '?'})`);
          return realm.toRealm(who, invoke(who, o.module, o.key, 'event', localise(ev)));
        },
        ownerOf: ev => realm.toRealm(who, ownerOf(ev)),
        emit: (...effects) => { for (const e of effects.flat()) takeEffect(who, ikey, jcopy(e)); return effects.length; },
      };
    };

    // --- a call into a module instance (atomic: on failure nothing it did stays) ---
    function invoke(caller, mid, ikey, kind, arg) {
      const decl = M.modules[mid];
      const rec = [caller, mid, ikey, kind, 'ok'];
      trace.calls.push(rec);
      if (!decl || !modules[mid]) { rec[4] = 'refused'; throw new InterfaceError('unknown-module', `${mid} is not a declared module`); }
      if (typeof ikey !== 'string' || !ikey || ikey.length > 120) { rec[4] = 'refused'; throw new InterfaceError('bad-key', `${mid}: the instance key must be a string of 1-120 characters`); }
      if (stack.includes(mid)) { rec[4] = 'refused'; violation('recursion', mid, `${[...stack, mid].join(' -> ')}`); throw new InterfaceError('recursion', `${[...stack, mid].join(' -> ')}`); }
      if (stack.length >= MAX_DEPTH) { rec[4] = 'refused'; throw new InterfaceError('depth', `call depth above ${MAX_DEPTH}`); }
      const allowed = kind === 'event' && caller === 'parent' ? reach.has(mid) : (declOf(caller).calls ?? []).includes(mid);
      if (!allowed) {
        violation('call-undeclared', mid, `${caller} -> ${mid} is not in the declared call graph`, { caller });
        if (strict) { rec[4] = 'refused'; throw new InterfaceError('call-undeclared', `${caller} -> ${mid} is not in the declared call graph`); }
      }
      if (kind === 'call') {
        const errs = validate(decl.input, arg);
        if (errs.length) {
          violation('input-schema', mid, errs.join('; '));
          if (strict) { rec[4] = 'refused'; throw new InterfaceError('input-schema', `${mid}: ${errs.join('; ')}`); }
        }
      }
      const fn = kind === 'call' ? modules[mid].step : modules[mid].onEvent;
      if (typeof fn !== 'function') { rec[4] = 'refused'; throw new InterfaceError('no-entry', `${mid} exports no ${kind === 'call' ? 'step' : 'onEvent'} function`); }
      const mark = undo.length;
      const rollback = () => { while (undo.length > mark) undo.pop()(); };
      const slot = (carry.m[mid] ??= {});
      const prev = own(slot, ikey) ? slot[ikey] : null;
      const meta = { module: mid, key: ikey, state: prev === null ? null : jcopy(prev), now: input.now };
      const ctx = realm.makeCtx(mid, meta, handlersFor(mid, ikey));
      stack.push(mid);
      let res;
      try {
        res = fn(realm.toRealm(mid, arg), ctx);
        if (res && typeof res.then === 'function') throw new InterfaceError('async', `${mid}: step/onEvent must return a result, not a promise`);
        res = res === undefined || res === null ? {} : jcopy(res);
        if (!isObj(res)) throw new InterfaceError('bad-result', `${mid}: must return an object`);
        if (own(res, 'effects') && !Array.isArray(res.effects)) throw new InterfaceError('bad-result', `${mid}: effects must be an array`);
        const oerrs = validate(decl.output, own(res, 'output') ? res.output : null);
        if (oerrs.length) {
          violation('output-schema', mid, oerrs.join('; '));
          if (strict) throw new InterfaceError('output-schema', `${mid}: ${oerrs.join('; ')}`);
        }
        for (const e of res.effects ?? []) takeEffect(mid, ikey, e);
        takeObligations(mid, ikey, res.obligations);
        takeTasks(mid, ikey, res.humanTasks);
        if (own(res, 'state')) {
          const had = own(slot, ikey), old = slot[ikey];
          if (res.state === null) delete slot[ikey]; else slot[ikey] = res.state;
          undo.push(() => { if (had) slot[ikey] = old; else delete slot[ikey]; });
        }
      } catch (e) {
        rollback();
        rec[4] = 'error';
        if (!(e instanceof InterfaceError)) violation('module-error', mid, String(e?.message ?? e));
        throw e instanceof InterfaceError ? e : new Error(`${mid}: ${String(e?.message ?? e)}`);
      } finally { stack.pop(); }
      return own(res, 'output') ? res.output : null;
    }

    // --- the parent ---
    const pIn = { kind: input.kind, item: input.item, world: input.world, instance: input.instance, now: input.now, events: input.events, state: carry.p === null ? null : jcopy(carry.p) };
    const pctx = realm.makeCtx('parent', { module: 'parent', key: input.instance, state: pIn.state, now: input.now }, handlersFor('parent', input.instance));
    let r;
    try {
      r = parent.tick(realm.toRealm('parent', pIn), pctx);
      if (r && typeof r.then === 'function') throw new InterfaceError('async', 'parent.tick must return a result, not a promise');
      r = jcopy(r);
      if (!isObj(r)) throw new InterfaceError('bad-result', 'parent.tick must return an object');
    } catch (e) {
      const brief = { violations: trace.violations.slice(0, 5), calls: trace.calls.length };
      const err = new Error(`${String(e?.message ?? e).slice(0, 1500)} [composition ${JSON.stringify(brief).slice(0, 400)}]`);
      err.composition = trace;
      throw err;
    }
    for (const e of r.effects ?? []) takeEffect('parent', input.instance, e);
    takeObligations('parent', input.instance, r.obligations);
    takeTasks('parent', input.instance, r.humanTasks);
    if (own(r, 'state')) carry.p = r.state ?? null;
    // Fired timers and answered tasks leave the routing tables once their event was delivered to this tick.
    for (const ev of input.events ?? []) {
      if (ev?.type === 'timer.fired' && carry.ob[ev.payload?.obligationId] && !out.upsert.some(o => o.id === ev.payload.obligationId)) delete carry.ob[ev.payload.obligationId];
    }
    for (const c of out.cancel) delete carry.ob[c];
    const decisions = isObj(r.decisions) ? { ...r.decisions, composition: trace } : r.decisions;
    const output = { decisions, effects: out.effects, obligations: { upsert: out.upsert, cancel: out.cancel }, humanTasks: out.tasks, carry };
    if (own(r, 'merge')) output.merge = r.merge;
    if (own(r, 'close')) output.close = r.close;
    return output;
  }
  return { id, tick, mode, runtime: RUNTIME_VERSION };
}

// ---------------------------------------------------------------------------------------------------------------------
// E8 effect kinds (the item's qualifier): 'system.op', plus the target of a status change and its status, and the
// template of a notification. A declaration covers an effect when it names any of its kinds.

export function kindsOfE8(e) {
  const base = `${e?.system}.${e?.op}`;
  const out = [base];
  if (base === 'orders.setStatus') {
    const target = e.args?.fulfilmentId === null || e.args?.fulfilmentId === undefined ? 'order' : 'fulfilment';
    out.push(`${base}:${target}`, `${base}:${target}:${e.args?.status}`);
  }
  if (base === 'notify.send') out.push(`${base}:${e.args?.template}`);
  return out;
}
