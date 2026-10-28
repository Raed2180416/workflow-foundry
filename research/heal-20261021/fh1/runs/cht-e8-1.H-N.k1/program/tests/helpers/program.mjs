// Test helper for modules that call other modules: runs one module of the program with every module loaded, so its
// ctx.call reaches the modules it declares (compose-kit/kit.mjs loads one module only). Same runtime, same isolation,
// same schema and declaration checks as the platform. Used by the contract tests of the modules that call others.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createComposedSolver, kindsOfE8 } from '../../compose-kit/runtime.mjs';
import { loadProgram } from '../../compose-kit/loader.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(readFileSync(path.join(root, 'composition.json'), 'utf8'));
const sources = Object.fromEntries([manifest.parent, ...Object.values(manifest.modules)]
  .map(d => [d.file, readFileSync(path.join(root, d.file), 'utf8')]));
const prog = loadProgram({ vm, manifest, sources });
if (prog.problems.length) throw new Error(`program does not load: ${prog.problems.join('; ')}`);

// The effect's name without the runtime's `<module>/<key>/` prefix.
const local = name => (typeof name === 'string' ? name.replace(/^[a-z-]+\/[^/]+\//, '') : name);

/**
 * programHarness(id) → { step(input, opts), onEvent(event, opts) }. opts: { key, state, states, now, files, query,
 * status }. `states` gives the carried state of other module instances: { [module]: { [key]: state } }.
 * The result: { output, state, effects, obligations, humanTasks, violations, error, carry } where effects carry
 * their local keys and `carry` is every module's state after the call.
 */
export function programHarness(id) {
  const testManifest = { version: 1, parent: { file: '__parent.mjs', calls: [id], effects: [] }, modules: manifest.modules };
  const run = (kind, arg, { key = 'K', state = null, states = {}, now = '2026-03-02T10:00:00+01:00', files = {}, query = () => [], status = () => 'not-found' } = {}) => {
    let output, error = null;
    const parent = { tick(input, ctx) {
      try {
        if (kind === 'step') output = ctx.call(id, key, arg);
        else {
          // An event this module caused carries its local names: give them the module's namespace (as the runtime does).
          const ev = JSON.parse(JSON.stringify(arg));
          const p = ev.payload ?? {};
          const ns = n => `${id}/${key}/${n}`;
          if (ev.type === 'effect.result') { if (typeof p.key === 'string') p.key = ns(p.key); for (const it of p.items ?? []) if (typeof it.key === 'string') it.key = ns(it.key); }
          if (ev.type === 'timer.fired') p.obligationId = ns(p.obligationId);
          if (String(ev.type).startsWith('humanTask.')) p.taskId = ns(p.taskId);
          output = ctx.deliver(ev);
        }
      } catch (e) { error = String(e?.message ?? e); }
      return { decisions: { subject: key } };
    } };
    const solver = createComposedSolver({ manifest: testManifest, parent, modules: prog.modules, kindsOf: kindsOfE8, mode: 'strict', realm: prog.realm });
    const m = JSON.parse(JSON.stringify(states));
    m[id] = { ...(m[id] ?? {}), [key]: state };
    const carry = { cv: 1, p: null, m };
    const out = solver.tick({ kind: 'case', item: 'test', world: 'test', instance: 'i-test', now, events: [], carry },
      { files, query, status: (s, k) => status(s, local(k)), instances: () => [] });
    const effects = out.effects.map(e => ({ ...e, key: local(e.key), ...(e.after ? { after: local(e.after) } : {}),
      ...(Array.isArray(e.args?.items) ? { args: { ...e.args, items: e.args.items.map(i => ({ ...i, key: local(i.key) })) } } : {}) }));
    return {
      output: output === undefined ? null : output,
      state: out.carry.m?.[id]?.[key] ?? null,
      effects,
      obligations: { upsert: out.obligations.upsert.map(o => ({ ...o, id: local(o.id) })), cancel: out.obligations.cancel.map(local) },
      humanTasks: out.humanTasks,
      violations: out.decisions.composition.violations,
      error,
      carry: out.carry.m,
    };
  };
  return { step: (input, opts) => run('step', input, opts), onEvent: (event, opts) => run('event', event, opts) };
}

// A file of the program as the platform presents it: JSON files arrive as their text.
export const asFile = value => JSON.stringify(value);
