// Test helper (not a test file): runs one module of the whole program through the composition runtime, so that a
// module's calls to the modules it may call (COMPOSE.md, `calls`) really run. moduleHarness (compose-kit/kit.mjs) runs a
// module alone and refuses calls to other modules; the tests of modules that call others use this instead.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createComposedSolver, kindsOfE8 } from '../compose-kit/runtime.mjs';
import { loadProgram } from '../compose-kit/loader.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'composition.json'), 'utf8'));
const sources = { [manifest.parent.file]: readFileSync(path.join(root, manifest.parent.file), 'utf8') };
for (const d of Object.values(manifest.modules)) sources[d.file] = readFileSync(path.join(root, d.file), 'utf8');
const prog = loadProgram({ vm, manifest, sources });
if (prog.problems.length) throw new Error(`program does not load: ${prog.problems.join('; ')}`);

const NOW = '2026-03-02T10:00:00+01:00';

/**
 * runCall({ mod, key, input | event, carry, files, query, status, instances, now }) runs `mod`/`key` once.
 * carry: { [module]: { [key]: state } } (module states before the call). Returns:
 *   output (what the module returned), carry (module states after the call), effects (keys as the module wrote them,
 *   prefixed by `<module>/<key>/` for the module's own effects), obligations, humanTasks, violations, error.
 */
export function runCall({ mod, key, input, event, carry = {}, files = {}, query = () => [], status = () => 'not-found',
  instances = () => [], now = NOW }) {
  let output = null, error = null;
  const prefix = `${mod}/${key}/`;
  const parent = { tick(_input, ctx) {
    try {
      if (event) {
        const ev = JSON.parse(JSON.stringify(event));
        const p = ev.payload ?? {};
        if (ev.type === 'effect.result') {
          if (typeof p.key === 'string') p.key = prefix + p.key;
          for (const it of p.items ?? []) if (typeof it.key === 'string') it.key = prefix + it.key;
        }
        if (ev.type === 'timer.fired') p.obligationId = prefix + p.obligationId;
        if (String(ev.type).startsWith('humanTask.')) p.taskId = prefix + p.taskId;
        output = ctx.deliver(ev);
      } else {
        output = ctx.call(mod, key, input);
      }
    } catch (e) { error = String(e?.message ?? e); }
    return { decisions: { subject: null }, state: null };
  } };
  const solver = createComposedSolver({ manifest, parent, modules: prog.modules, kindsOf: kindsOfE8, mode: 'strict', realm: prog.realm });
  const strip = k => (typeof k === 'string' && k.startsWith(prefix) ? k.slice(prefix.length) : k);
  const hostCtx = {
    files,
    query: (table, filter) => query(table, filter ?? {}),
    status: (system, k) => status(system, strip(k)),
    instances,
  };
  const out = solver.tick({ kind: 'case', item: 't', world: 'w', instance: 'i-test', now,
    events: [], carry: { cv: 1, p: null, m: JSON.parse(JSON.stringify(carry)) } }, hostCtx);
  return {
    output,
    error,
    carry: out.carry.m,
    effects: out.effects,
    obligations: out.obligations,
    humanTasks: out.humanTasks,
    violations: out.decisions.composition.violations,
  };
}

export const keysOf = effects => effects.map(e => e.key);
export const NOW_ISO = NOW;
