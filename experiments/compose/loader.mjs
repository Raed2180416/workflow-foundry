// Loader for builder-written composed programs (research/composition-20261021/HARNESS.md §2.3). $0. Imports nothing:
// bundle.mjs inlines it into the solver.mjs the sandbox runs, and passes `node:vm` in.
//
// Each module file (and the parent) is evaluated in its own vm context: it cannot import anything, cannot see another
// module's code or variables, and reaches the platform only through the ctx object the runtime gives it, built inside
// its own context over a JSON-string bridge (no object of the runtime's realm is handed to module code). This is a
// boundary against a builder's shortcuts (importing a sibling, sharing a global), not a security boundary against
// deliberate escape: the whole program still runs inside the OS sandbox (beds/ebed/host/sandbox-arm.mjs), and the
// harness re-verifies every effect's attribution against the trusted manifest from the journal (trace.mjs).

/** Constructs a module file may not use (best-effort static scan; the vm context enforces the rest). */
export const FORBIDDEN = Object.freeze([
  [/(^|[^.\w$])import\s*[\s{*'"(]/m, 'import (modules cannot import anything; use ctx.call to reach another module)'],
  [/(^|[^.\w$])require\s*\(/, 'require'],
  [/(^|[^.\w$])process\s*\./, 'process'],
  [/(^|[^.\w$])globalThis\b/, 'globalThis'],
  [/(^|[^.\w$])eval\s*\(/, 'eval'],
  [/(^|[^.\w$])Function\s*\(/, 'Function constructor'],
  [/(^|[^\w$])export\s*\{/, 'export { ... } lists (export each function or const directly)'],
  [/(^|[^\w$])export\s*\*/, 'export * from'],
  [/(^|[^\w$])export\s+default\b/, 'export default (export named functions: step, onEvent, tick)'],
  [/(^|[^\w$])export\s+(async\s+)?class\b/, 'export class'],
  [/(^|[^\w$])export\s+(let|var)\b/, 'export let/var (state lives in the runtime, not in module variables)'],
]);

const stripComments = src => src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

/** Static problems of one module source ([] when loadable). */
export function sourceProblems(src) {
  if (typeof src !== 'string') return ['source: not a string'];
  if (src.length > 400_000) return ['source: larger than 400 KB'];
  const s = stripComments(src);
  return FORBIDDEN.filter(([re]) => re.test(s)).map(([, what]) => `uses ${what}`);
}

/** Turn `export function f` / `export const x` into plain declarations and append an exports probe. */
export function scriptOf(src) {
  const body = src.replace(/(^|[^\w$])export\s+(async\s+)?function(\s*\*)?\s+/g, (m, a, asy, star) => `${a}${asy ?? ''}function${star ?? ''} `)
    .replace(/(^|[^\w$])export\s+const\s+/g, '$1const ');
  return `${body}\n;({ step: typeof step === 'function' ? step : undefined, onEvent: typeof onEvent === 'function' ? onEvent : undefined, tick: typeof tick === 'function' ? tick : undefined });\n`;
}

// Built inside each context: the module's ctx over a JSON-string bridge, so only primitives cross the boundary.
const SHIM = `(function (bridge) {
  const call = (op, args) => {
    const r = JSON.parse(bridge(op, JSON.stringify(args === undefined ? null : args)));
    if (r.err) { const e = new Error(r.err.message); e.code = r.err.code; throw e; }
    return r.ok === undefined ? undefined : r.ok;
  };
  const quiet = () => {};
  globalThis.console = { log: quiet, info: quiet, warn: quiet, error: quiet, debug: quiet };
  return function makeCtx(metaJson, who) {
    const meta = JSON.parse(metaJson);
    let files;
    return {
      module: meta.module, key: meta.key, state: meta.state, now: meta.now,
      get files() { if (files === undefined) files = call('files', [who]); return files; },
      query: (table, filter) => call('query', [who, table, filter === undefined ? {} : filter]),
      status: (system, key) => call('status', [who, system, key]),
      instances: filter => call('instances', [who, filter === undefined ? {} : filter]),
      call: (module, key, input) => call('call', [who, module, key, input === undefined ? null : input]),
      deliver: event => call('deliver', [who, event]),
      ownerOf: event => call('ownerOf', [who, event]),
      emit: (...effects) => call('emit', [who, effects]),
    };
  };
})`;

/**
 * loadProgram({ vm, manifest, sources }) → { parent, modules, realm, problems }. `sources` maps manifest file paths to
 * module source text. A program with problems (static or load errors) is not runnable.
 */
export function loadProgram({ vm, manifest, sources }) {
  const problems = [];
  const contexts = {}, makers = {}, exportsOf = {};
  const handlers = {};                         // who -> current handler set (set per call by the runtime's makeCtx)
  const entries = [['parent', manifest.parent], ...Object.entries(manifest.modules)];
  for (const [who, decl] of entries) {
    const src = sources[decl.file];
    if (typeof src !== 'string') { problems.push(`${who}: file ${decl.file} is missing`); continue; }
    const sp = sourceProblems(src);
    if (sp.length) { problems.push(...sp.map(p => `${decl.file}: ${p}`)); continue; }
    const bridge = (op, json) => {
      try {
        const [w, ...args] = JSON.parse(json);
        const h = handlers[w];
        if (!h) throw new Error(`no active call for ${w}`);
        const v = h[op](...args);
        return JSON.stringify({ ok: v === undefined ? null : v });
      } catch (e) { return JSON.stringify({ err: { message: String(e?.message ?? e).slice(0, 2000), code: e?.code ?? null } }); }
    };
    try {
      const context = vm.createContext({});
      makers[who] = vm.runInContext(SHIM, context, { filename: `${who}-shim.js` })(bridge);
      exportsOf[who] = vm.runInContext(scriptOf(src), context, { filename: decl.file, timeout: 5000 });
      contexts[who] = context;
      const fns = who === 'parent' ? ['tick'] : ['step', 'onEvent'];
      if (!fns.some(f => typeof exportsOf[who][f] === 'function')) problems.push(`${decl.file}: exports none of ${fns.join(', ')}`);
    } catch (e) { problems.push(`${decl.file}: does not load: ${String(e?.message ?? e).slice(0, 300)}`); }
  }
  const realmJSON = {};
  for (const who of Object.keys(contexts)) realmJSON[who] = vm.runInContext('JSON', contexts[who]);
  const realm = {
    toRealm: (who, v) => (v === undefined ? undefined : realmJSON[who] ? realmJSON[who].parse(JSON.stringify(v)) : JSON.parse(JSON.stringify(v))),
    makeCtx: (who, meta, h) => {
      // Handlers take the caller as their first argument (the shim passes `who`): drop it.
      handlers[who] = Object.fromEntries(Object.entries(h).map(([k, f]) => [k, (_w, ...a) => f(...a)]));
      return makers[who](JSON.stringify(meta), who);
    },
  };
  const modules = {};
  for (const id of Object.keys(manifest.modules)) if (exportsOf[id]) modules[id] = { step: exportsOf[id].step, onEvent: exportsOf[id].onEvent };
  return { parent: exportsOf.parent ? { tick: exportsOf.parent.tick } : null, modules, realm, problems };
}
