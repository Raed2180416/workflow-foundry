// Validation of arm outputs (BED-CONTRACT-v1.1 §3.1). The host applies nothing from an output that fails here: the
// tick is an arm error (§3.7). Effect *arguments* are not checked here: the system checks them when the effect is
// applied (an F5 rename makes that time-dependent) and answers 400, as a real API would. Human-task answer schemas must
// be in the portable subset with an object root (the engine's human-node rule), so the host can re-validate answers.
import { schemaProblems, validate, plainCopy } from './schema.mjs';
import { canonical } from '../../lib/canonical.mjs';
import { isIsoTime } from './time.mjs';

export const LIMITS = Object.freeze({ carryBytes: 64 * 1024, effects: 1000, humanTasks: 100, obligations: 1000, idLength: 200,
  questionLength: 4000, decisionsBytes: 256 * 1024, excludeUsers: 100 });

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isId = v => typeof v === 'string' && v.length > 0 && v.length <= LIMITS.idLength;
const bytes = v => Buffer.byteLength(canonical(v));
const CASE_KEYS = new Set(['decisions', 'effects', 'obligations', 'humanTasks', 'merge', 'close', 'carry']);
const SWEEP_KEYS = new Set(['effects', 'wake', 'carry']);

function checkEffects(effects, effectSchemas, errs, { sweep }) {
  if (!Array.isArray(effects)) { errs.push('effects: not an array'); return; }
  if (effects.length > LIMITS.effects) { errs.push(`effects: more than ${LIMITS.effects}`); return; }
  const keysSoFar = new Set();
  effects.forEach((e, i) => {
    const p = `effects[${i}]`;
    if (!isObj(e)) { errs.push(`${p}: not an object`); return; }
    for (const k of Object.keys(e)) if (!['key', 'system', 'op', 'args', 'compensates', 'after'].includes(k)) errs.push(`${p}: unexpected ${k}`);
    if (own(e, 'key') && !isId(e.key)) errs.push(`${p}.key: must be a non-empty string`);
    const name = `${e.system}.${e.op}`;
    const op = effectSchemas[name];
    if (typeof e.system !== 'string' || typeof e.op !== 'string' || !op) { errs.push(`${p}: unknown op ${name}`); return; }
    if (!isObj(e.args)) errs.push(`${p}.args: not an object`);
    if (own(e, 'compensates') && !isId(e.compensates)) errs.push(`${p}.compensates: must be a key`);
    if (own(e, 'after')) {
      if (!isId(e.after)) errs.push(`${p}.after: must be a key`);
      else if (!keysSoFar.has(e.after)) errs.push(`${p}.after: names no earlier effect of this output`);
    }
    if (op.batch && own(e, 'key')) errs.push(`${p}.key: a batch op keys its items, not the batch`);
    if (sweep) {
      const subj = op.batch ? [] : op.subjectArgs;
      if (!op.batch && !(subj.length && isObj(e.args) && subj.some(a => typeof e.args[a] === 'string'))) errs.push(`${p}: a sweep effect needs a subject argument (${op.subjectArgs.join(', ') || 'none declared'})`);
    }
    if (own(e, 'key') && isId(e.key)) keysSoFar.add(e.key);
  });
}

/** Errors of a case-tick output ([] when valid). `ctx`: { schemas, round, inbound, instances, self }. */
export function validateCaseOutput(raw, ctx) {
  const out = plainCopy(raw);
  if (out === undefined) return { errors: ['output: not plain JSON data'] };
  const errs = [];
  if (!isObj(out)) return { errors: ['output: not an object'] };
  for (const k of Object.keys(out)) if (!CASE_KEYS.has(k)) errs.push(`output: unexpected ${k}`);
  if (!own(out, 'decisions') || !isObj(out.decisions)) errs.push('decisions: required object');
  else {
    if (!own(out.decisions, 'subject') || !(out.decisions.subject === null || isId(out.decisions.subject))) errs.push('decisions.subject: required, a business key or null');
    if (bytes(out.decisions) > LIMITS.decisionsBytes) errs.push('decisions: too large');
    else if (ctx.schemas.decisions) { const { subject, ...rest } = out.decisions; errs.push(...validate(ctx.schemas.decisions, rest, 'decisions')); }
  }
  if (!own(out, 'carry')) errs.push('carry: required (null for none)');
  else if (bytes(out.carry ?? null) > LIMITS.carryBytes) errs.push(`carry: larger than ${LIMITS.carryBytes} bytes`);
  if (own(out, 'effects')) checkEffects(out.effects, ctx.schemas.effects, errs, { sweep: false });
  if (own(out, 'obligations')) {
    const o = out.obligations;
    if (!isObj(o)) errs.push('obligations: not an object');
    else {
      for (const k of Object.keys(o)) if (!['upsert', 'cancel'].includes(k)) errs.push(`obligations: unexpected ${k}`);
      const up = o.upsert ?? [], cancel = o.cancel ?? [];
      if (!Array.isArray(up) || up.length > LIMITS.obligations) errs.push('obligations.upsert: array of at most 1000');
      else up.forEach((ob, i) => {
        const p = `obligations.upsert[${i}]`;
        if (!isObj(ob)) { errs.push(`${p}: not an object`); return; }
        for (const k of Object.keys(ob)) if (!['id', 'kind', 'anchor', 'dueAt', 'calendar', 'onDue'].includes(k)) errs.push(`${p}: unexpected ${k}`);
        if (!isId(ob.id)) errs.push(`${p}.id: required`);
        if (typeof ob.kind !== 'string') errs.push(`${p}.kind: required string`);
        if (!isIsoTime(ob.dueAt)) errs.push(`${p}.dueAt: ISO time with offset required`);
        if (own(ob, 'calendar') && ob.calendar !== null && typeof ob.calendar !== 'string') errs.push(`${p}.calendar: string or null`);
      });
      if (!Array.isArray(cancel) || cancel.length > LIMITS.obligations || !cancel.every(isId)) errs.push('obligations.cancel: array of ids');
    }
  }
  if (own(out, 'humanTasks')) {
    const ts = out.humanTasks;
    if (!Array.isArray(ts) || ts.length > LIMITS.humanTasks) errs.push(`humanTasks: array of at most ${LIMITS.humanTasks}`);
    else ts.forEach((t, i) => {
      const p = `humanTasks[${i}]`;
      if (!isObj(t)) { errs.push(`${p}: not an object`); return; }
      for (const k of Object.keys(t)) if (!['id', 'kind', 'role', 'excludeUsers', 'subject', 'question', 'answerSchema', 'dueAt', 'onTimeout'].includes(k)) errs.push(`${p}: unexpected ${k}`);
      if (!isId(t.id)) errs.push(`${p}.id: required`);
      if (!isId(t.kind)) errs.push(`${p}.kind: required`);
      if (!isId(t.role)) errs.push(`${p}.role: required`);
      if (own(t, 'excludeUsers') && !(Array.isArray(t.excludeUsers) && t.excludeUsers.length <= LIMITS.excludeUsers && t.excludeUsers.every(isId))) errs.push(`${p}.excludeUsers: array of user ids`);
      if (!own(t, 'subject') || !(t.subject === null || isId(t.subject))) errs.push(`${p}.subject: required, a business key or null`);
      if (typeof t.question !== 'string' || t.question.length > LIMITS.questionLength) errs.push(`${p}.question: string`);
      const sp = schemaProblems(t.answerSchema, { root: 'object' });
      if (sp.length) errs.push(`${p}.answerSchema: ${sp[0]}`);
      if (!isIsoTime(t.dueAt)) errs.push(`${p}.dueAt: ISO time with offset required`);
      if (!own(t, 'onTimeout')) errs.push(`${p}.onTimeout: required`);
    });
    if (Array.isArray(ts)) {
      const ids = ts.filter(isObj).map(t => t.id);
      if (new Set(ids).size !== ids.length) errs.push('humanTasks: duplicate id in one output');
    }
  }
  if (own(out, 'merge')) {
    const m = out.merge;
    if (!isObj(m) || !isId(m.into)) errs.push('merge: { into: <instance> }');
    else if (ctx.round !== 1) errs.push('merge: only in the first round of a wake-up');
    else if (!ctx.inbound) errs.push('merge: only on an instance started by an inbound event');
    else if (m.into === ctx.self) errs.push('merge: into itself');
    else if (!ctx.instances.get(m.into) || ctx.instances.get(m.into).closed) errs.push('merge: target is not an open instance');
  }
  if (own(out, 'close') && out.close !== true) errs.push('close: must be true when present');
  return { errors: errs.slice(0, 32), output: out };
}

/** Errors of a sweep-tick output ([] when valid). */
export function validateSweepOutput(raw, ctx) {
  const out = plainCopy(raw);
  if (out === undefined) return { errors: ['output: not plain JSON data'] };
  if (!isObj(out)) return { errors: ['output: not an object'] };
  const errs = [];
  for (const k of Object.keys(out)) if (!SWEEP_KEYS.has(k)) errs.push(`output: unexpected ${k}`);
  if (!own(out, 'carry')) errs.push('carry: required (null for none)');
  else if (bytes(out.carry ?? null) > LIMITS.carryBytes) errs.push(`carry: larger than ${LIMITS.carryBytes} bytes`);
  if (own(out, 'effects')) checkEffects(out.effects, ctx.schemas.effects, errs, { sweep: true });
  if (own(out, 'wake')) {
    if (!Array.isArray(out.wake) || !out.wake.every(isId)) errs.push('wake: array of instance ids');
    else for (const id of out.wake) if (!ctx.instances.get(id) || ctx.instances.get(id).closed) errs.push(`wake: ${id} is not an open instance`);
  }
  return { errors: errs.slice(0, 32), output: out };
}
