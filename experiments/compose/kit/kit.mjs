// compose-kit/kit.mjs: run one module of YOUR composed program exactly as the platform's composition runtime does
// (same isolation, schema checks, declaration checks), for contract tests. No platform, world or grading inside.
//   import { moduleHarness } from '../compose-kit/kit.mjs';
//   const pay = moduleHarness('payment');                       // reads ../composition.json and the module file
//   const r = pay.step({ ...input }, { key: 'ORD-1-F1', state: null, now: '2026-03-02T10:00:00+01:00', files, query, status });
//   r.output, r.state, r.effects (keys as you wrote them), r.obligations, r.humanTasks, r.violations, r.error
//   const r2 = pay.onEvent({ type: 'effect.result', payload: { key: 'charge', ... } }, { key: 'ORD-1-F1', state: r.state, now });
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createComposedSolver, kindsOfE8 } from './runtime.mjs';
import { loadProgram } from './loader.mjs';

const strip = (who, key, name) => (typeof name === 'string' && name.startsWith(`${who}/${key}/`) ? name.slice(who.length + key.length + 2) : name);

/** moduleHarness(id, { dir }) → { step(input, opts), onEvent(event, opts) } for module `id` of the program in `dir`. */
export function moduleHarness(id, { dir = path.resolve(process.cwd()) } = {}) {
  const manifest = JSON.parse(readFileSync(path.join(dir, 'composition.json'), 'utf8'));
  const decl = manifest.modules?.[id];
  if (!decl) throw new Error(`no module ${id} in composition.json`);
  const sources = { [decl.file]: readFileSync(path.join(dir, decl.file), 'utf8'), '__parent.mjs': 'export function tick(input, ctx) { return null; }' };
  // A one-module program: a test parent that makes exactly one call (or one delivery) and reports what came back.
  const testManifest = { version: 1, parent: { file: '__parent.mjs', calls: [id], effects: [] }, modules: { [id]: decl } };
  const prog = loadProgram({ vm, manifest: testManifest, sources });
  if (prog.problems.length) throw new Error(`module ${id} does not load: ${prog.problems.join('; ')}`);
  const run = (kind, arg, { key = 'K', state = null, now = '2026-03-02T10:00:00+01:00', files = {}, query = () => [], status = () => 'not-found' } = {}) => {
    let output, error = null;
    const parent = { tick(input, ctx) {
      try {
        if (kind === 'step') output = ctx.call(id, key, arg);
        else {
          const ev = JSON.parse(JSON.stringify(arg));
          const p = ev.payload ?? {};
          if (ev.type === 'effect.result') { if (typeof p.key === 'string') p.key = `${id}/${key}/${p.key}`; for (const it of p.items ?? []) if (typeof it.key === 'string') it.key = `${id}/${key}/${it.key}`; }
          if (ev.type === 'timer.fired') p.obligationId = `${id}/${key}/${p.obligationId}`;
          if (String(ev.type).startsWith('humanTask.')) p.taskId = `${id}/${key}/${p.taskId}`;
          output = ctx.deliver(ev);
        }
      } catch (e) { error = String(e?.message ?? e); }
      return { decisions: { subject: null }, state: null };
    } };
    const solver = createComposedSolver({ manifest: testManifest, parent, modules: prog.modules, kindsOf: kindsOfE8, mode: 'strict', realm: prog.realm });
    const carry = { cv: 1, p: null, m: state === null ? {} : { [id]: { [key]: state } } };
    const out = solver.tick({ kind: 'case', item: 'test', world: 'test', instance: 'i-test', now, events: [], carry }, { files, query, status: (s, k) => status(s, strip(id, key, k)), instances: () => [] });
    const effects = out.effects.map(e => ({ ...e, ...(e.key ? { key: strip(id, key, e.key) } : {}), ...(e.after ? { after: strip(id, key, e.after) } : {}),
      ...(Array.isArray(e.args?.items) ? { args: { ...e.args, items: e.args.items.map(i => ({ ...i, key: strip(id, key, i.key) })) } } : {}) }));
    return { output: output === undefined ? null : output, state: out.carry.m?.[id]?.[key] ?? null, effects,
      obligations: { upsert: out.obligations.upsert.map(o => ({ ...o, id: strip(id, key, o.id) })), cancel: out.obligations.cancel.map(c => strip(id, key, c)) },
      humanTasks: out.humanTasks.map(t => ({ ...t, id: strip(id, key, t.id) })), violations: out.decisions.composition.violations, error };
  };
  return { step: (input, opts) => run('step', input, opts), onEvent: (event, opts) => run('event', event, opts), declaration: decl };
}
