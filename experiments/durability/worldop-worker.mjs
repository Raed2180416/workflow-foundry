// DUR-1 world-operator worker (changes.mjs runWorldOp runs it under Node's permission model; review R2-M12). It runs ONE
// sealed world operator, a function source written by the sealed-author model session, on one world, and prints the
// result. The operator gets a fresh VM context whose helpers are this child's own objects; the child holds no oracle
// grades, ledger, freezes or credentials (its environment is empty), cannot write files or start processes, and the
// definition and the call each run under a time limit. Input (stdin, JSON): { source, W, id, salt, eff, timeoutMs }.
// Output (stdout, JSON): { ok: true, W } or { ok: false, error }.
import vm from 'node:vm';
import { rng } from '../../beds/lib/rng.mjs';
import { collectionRuns, minutesOf } from '../../beds/ebed/e8/world.mjs';
import { isoLocal, dayStart } from './schedule.mjs';

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const out = o => process.stdout.write(JSON.stringify(o));
try {
  const { source, W, id, salt, eff, timeoutMs } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const ctx = vm.createContext(Object.create(null));
  ctx.__api = Object.freeze({ rng: (...p) => rng('dur1/sealed', id, salt, W.id, ...p), minutesOf, isoLocal, dayStart, collectionRuns, eff });
  ctx.api = ctx.__api;   // the operator's second argument, also a global (as before)
  ctx.__world = JSON.stringify(W);
  vm.runInContext(`globalThis.clone = x => JSON.parse(JSON.stringify(x)); globalThis.__fn = (${source});`, ctx, { timeout: timeoutMs });
  if (vm.runInContext('typeof __fn', ctx) !== 'function') throw new Error(`sealed ${id}: worldOp is not a function`);
  const res = vm.runInContext('JSON.stringify(__fn(JSON.parse(__world), __api))', ctx, { timeout: timeoutMs });
  const W2 = res === undefined ? null : JSON.parse(res);
  if (!W2 || typeof W2 !== 'object' || !W2.truth) throw new Error(`sealed ${id}: worldOp must return a world`);
  out({ ok: true, W: W2 });
} catch (e) {
  out({ ok: false, error: String(e?.message ?? e).slice(0, 600) });
}
