// Executing the generated functions (trusted bed code) on JSON arguments, for three purposes: (1) the generator proves
// every planted defect is behaviourally real (the planted code differs from the correct code on a probe) and every decoy
// is behaviourally correct (equal on every probe); (2) the oracle checks a finding's witness (arguments, valid per the
// function's stated domain, on which the planted and the correct function differ); (3) tests.
//
// Each world gets two node:vm contexts: `planted` holds every function exactly as rendered in the repository (callers
// call the planted helpers) and `correct` holds the correct body of every function. Calls run through a precompiled
// script with a timeout. Arguments are JSON values only; they are validated against the function's domain spec before
// any call, which also bounds sizes (no allocation a witness could blow up).
import vm from 'node:vm';

// A call that runs longer than this is a timeout. The oracle's witness check uses TIMEOUT_MS and re-runs a timed-out call
// once with GEN_TIMEOUT_MS before it gives up (score.mjs); generation always uses GEN_TIMEOUT_MS (observeMany batches a
// function's probes into one call) and treats a timeout as a generator error (world.mjs obsGen), so a slow machine can
// never change a task. No generated body loops unboundedly.
export const TIMEOUT_MS = 200, GEN_TIMEOUT_MS = 2000;
const CALL = new vm.Script('__out = { r: globalThis[__name](...__args) }');

/** Build a context holding the given function sources (each `function name(...) {...}`, no export keyword). */
export function makeContext(sources) {
  const ctx = vm.createContext({ __args: [], __argsList: [], __name: '', __out: null, __outs: null });
  vm.runInContext(sources.join('\n\n'), ctx, { timeout: 2000 });
  return ctx;
}

const tagValue = v => {
  if (v === undefined) return { $undefined: true };
  if (typeof v === 'number' && !Number.isFinite(v)) return { $number: String(v) };
  if (typeof v === 'function') return { $function: true };
  if (typeof v === 'bigint' || typeof v === 'symbol') return { $other: typeof v };
  return v;
};
/** Canonical text of a JS value: sorted keys; undefined, NaN and Infinity tagged; -0 as 0. */
export function canonValue(v, depth = 0) {
  if (depth > 20) return '"$deep"';
  v = tagValue(v);
  if (v === null || typeof v !== 'object') return JSON.stringify(Object.is(v, -0) ? 0 : v);
  if (Array.isArray(v)) return `[${Array.from(v, x => canonValue(x, depth + 1)).join(',')}]`;
  return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonValue(v[k], depth + 1)}`).join(',')}}`;
}

/** Call `name` in `ctx` on a fresh copy of `args`. Observation = what a caller can see: the return value or the thrown
 *  error's name, and the arguments after the call (a mutated argument is observable). */
export function observe(ctx, name, args, timeout = TIMEOUT_MS) {
  const copy = JSON.parse(JSON.stringify(args));
  ctx.__args = copy; ctx.__name = name; ctx.__out = null;
  let ret = null, threw = null;
  try { CALL.runInContext(ctx, { timeout }); ret = ctx.__out.r; }
  catch (e) { threw = (e && typeof e === 'object' && typeof e.name === 'string') ? (e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' ? 'Timeout' : e.name) : 'Thrown'; }
  return { returns: threw ? null : canonValue(ret), throws: threw, argsAfter: canonValue(copy) };
}
function hasNegZero(v, depth = 0) {
  if (Object.is(v, -0)) return true;
  if (depth > 20 || v === null || typeof v !== 'object') return false;
  return Array.isArray(v) ? v.some(x => hasNegZero(x, depth + 1)) : Object.values(v).some(x => hasNegZero(x, depth + 1));
}
const MANY = new vm.Script(`__outs = __argsList.map(a => { try { return { ok: true, r: globalThis[__name](...a) }; }
  catch (e) { return { ok: false, e: (e && typeof e === 'object' && typeof e.name === 'string') ? e.name : 'Thrown' }; } })`);
/** observe() for many argument lists in ONE vm call (one timeout watchdog instead of one per call; the generator makes
 *  thousands of calls). The timeout covers the whole batch; a timeout throws (generation treats it as an error). With
 *  `negZero`, each observation also says whether the result holds -0. */
export function observeMany(ctx, name, argsList, { timeout = GEN_TIMEOUT_MS, negZero = false } = {}) {
  const copies = argsList.map(a => JSON.parse(JSON.stringify(a)));
  ctx.__argsList = copies; ctx.__name = name; ctx.__outs = null;
  try { MANY.runInContext(ctx, { timeout }); } catch (e) {
    if (e?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw new Error(`wbed-r3p: ${name} timed out during generation`);
    throw e;
  }
  return ctx.__outs.map((o, i) => ({ returns: o.ok ? canonValue(o.r) : null, throws: o.ok ? null : o.e, argsAfter: canonValue(copies[i]),
    ...(negZero ? { negZero: o.ok && hasNegZero(o.r) } : {}) }));
}
export const sameObs = (a, b) => a.returns === b.returns && a.throws === b.throws && a.argsAfter === b.argsAfter;

// ---- domain specs (the valid inputs a contract states; rendered into the JSDoc @param lines)
// { t: 'int', min, max } | { t: 'num', min, max, dp } (at most dp decimals) | { t: 'str', max } | { t: 'enum', values }
// | { t: 'bool' } | { t: 'scalar' } (int, short string or boolean) | { t: 'arr', of, max } | { t: 'obj', props: {k: spec}, keys?: [...] }
// | { t: 'nullable', of } | { t: 'iso' } (a real YYYY-MM-DD date, years 1600-2400) | { t: 'json', maxBytes }
const isInt = v => Number.isSafeInteger(v);
const DIM = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export function isIsoDate(s) {
  const m = typeof s === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1600 || y > 2400 || mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return d <= (mo === 2 && leap ? 29 : DIM[mo - 1]);
}
export function valueOk(spec, v) {
  switch (spec.t) {
    case 'int': return isInt(v) && v >= spec.min && v <= spec.max;
    case 'num': return typeof v === 'number' && Number.isFinite(v) && v >= spec.min && v <= spec.max
      && Math.abs(v * 10 ** spec.dp - Math.round(v * 10 ** spec.dp)) < 1e-6;
    case 'str': return typeof v === 'string' && v.length <= spec.max;
    case 'enum': return spec.values.includes(v);
    case 'bool': return typeof v === 'boolean';
    case 'scalar': return (isInt(v) && Math.abs(v) <= 1e6) || (typeof v === 'string' && v.length <= 40) || typeof v === 'boolean';
    case 'nullable': return v === null || valueOk(spec.of, v);
    case 'iso': return isIsoDate(v);
    case 'arr': return Array.isArray(v) && v.length <= spec.max && v.every(x => valueOk(spec.of, x));
    case 'obj': {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
      const keys = Object.keys(v);
      if (spec.keys && keys.some(k => !spec.keys.includes(k))) return false;
      for (const [k, s] of Object.entries(spec.props ?? {})) {
        if (!Object.prototype.hasOwnProperty.call(v, k)) { if (!spec.optional?.includes(k)) return false; continue; }
        if (!valueOk(s, v[k])) return false;
      }
      return true;
    }
    case 'json': { try { return JSON.stringify(v).length <= spec.maxBytes; } catch { return false; } }
    default: throw new Error(`unknown domain spec ${spec.t}`);
  }
}
/** Arguments valid for a function: right count, each value in its spec, the family's cross-argument condition. */
export function argsOk(fn, args) {
  if (!Array.isArray(args) || args.length !== fn.domain.params.length) return false;
  try { if (JSON.stringify(args).length > 4000) return false; } catch { return false; }
  if (!fn.domain.params.every((s, i) => valueOk(s, args[i]))) return false;
  return fn.domain.where ? Boolean(fn.domain.where(args)) : true;
}
