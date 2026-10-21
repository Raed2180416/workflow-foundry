// n8n-sim: runs the ORIGINAL n8n workflow graph on stand-in nodes against a seeded local world (research/ci1-20261021/DOSSIER.md §4 item 1).
//
// What is real: the graph (nodes, connections, branch order by canvas position), every node parameter, every condition, every field
// mapping and every expression and Code-node body, all read from the definition at run time. What is a shim: the node implementations,
// written from n8n's documented parameters, not from n8n's source, and the connectors (Sheets, Gmail, Slack, Telegram, Discord, SMTP,
// webhook response) bound to a world. The result is "the original graph under shim semantics": a deterministic reference behaviour,
// not a claim about what real n8n does (assumptions are listed in ASSUMPTIONS below and in the result doc).
//
// SAFETY: expressions and Code-node bodies are untrusted corpus text and ARE evaluated (node:vm, per-call timeout). This module must
// only run corpus workflows inside src/sandbox.mjs (fresh user/net/mount/pid namespaces, read-only allowlisted root, no network, no
// home, no corpus, no credentials): experiments/ci1/sim/run.mjs does that. Host-side imports are for first-party fixtures in tests.
//
// Self-contained on purpose (the sandbox sees no node_modules): no imports except node built-ins; Luxon comes from the bundle prelude
// (globalThis.luxon, experiments/ci1/sim/vendor/luxon-3.5.0).
export const SIM_VERSION = 'n8n-sim/1';
export const ASSUMPTIONS = [
  'executionOrder v1 for every workflow: depth-first, children ordered by canvas position (y, then x); a node with several inputs waits for all inputs that receive data, and runs with what it has when nothing else is left',
  'a single-input node fed by two parents runs once per arriving batch',
  'Google Sheets read/lookup runs once per input item (n8n v4 behaviour) unless the node has executeOnce',
  'Google Sheets update/appendOrUpdate change the FIRST row whose matching column equals the item value (string comparison)',
  'Gmail and SMTP sends are recorded per recipient; Gmail attribution text is not appended',
  'times: $now is the world clock in the workflow timezone (settings.timezone, else the binding zone, else UTC)',
  'Code nodes run in a vm context; returned objects are JSON round-tripped (Dates and DateTimes become ISO strings)',
  'paired items: $("X").item follows the item lineage; without lineage it falls back to the only item of X, else the item at the same index',
];

const L = () => { const l = globalThis.luxon; if (!l?.DateTime) throw new Error('n8n-sim needs globalThis.luxon (bundle prelude)'); return l; };
class NodeError extends Error { constructor(node, message) { super(`${node}: ${message}`); this.node = node; this.code = 'NODE_ERROR'; } }
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const get = (o, path) => {
  if (path === undefined || path === null || path === '') return undefined;
  const parts = String(path).replace(/\[(\d+)\]/g, '.$1').replace(/\["([^"]+)"\]|\['([^']+)'\]/g, (_, a, b) => `.${a ?? b}`).split('.').filter(p => p !== '');
  let v = o;
  for (const p of parts) { if (v === null || v === undefined) return undefined; v = v[p]; }
  return v;
};
const set = (o, path, value, dot = true) => {
  if (!dot) { o[path] = value; return o; }
  const parts = String(path).split('.');
  let t = o;
  for (const p of parts.slice(0, -1)) { if (!isObj(t[p])) t[p] = {}; t = t[p]; }
  t[parts.at(-1)] = value;
  return o;
};
const unset = (o, path) => { const parts = String(path).split('.'); let t = o; for (const p of parts.slice(0, -1)) { if (!isObj(t?.[p])) return; t = t[p]; } if (t) delete t[parts.at(-1)]; };
const splitList = s => Array.isArray(s) ? s : String(s ?? '').split(',').map(x => x.trim()).filter(Boolean);
const stripHtml = s => String(s ?? '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim();
const addrList = v => (Array.isArray(v) ? v : String(v ?? '').split(/[,;]/)).map(x => String(x).trim()).filter(Boolean).map(x => (/<([^>]+)>/.exec(x)?.[1] ?? x).trim().toLowerCase());
const slug = v => String(v ?? '').toLowerCase().replace(/^#/, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
const rlValue = v => isObj(v) && v.__rl ? v.value : v;
const rlName = v => isObj(v) && v.__rl ? (v.cachedResultName || v.value) : v;

// ------------------------------------------------------------------------------------------------ expression extensions (n8n's)
function installExtensions(ctxGlobal, DateTime) {
  const def = (proto, name, fn) => { if (!Object.hasOwn(proto, name)) Object.defineProperty(proto, name, { value: fn, configurable: true, writable: true }); };
  const S = ctxGlobal.String.prototype, A = ctxGlobal.Array.prototype, N = ctxGlobal.Number.prototype, O = ctxGlobal.Object;
  def(S, 'isEmpty', function () { return this.length === 0; }); def(S, 'isNotEmpty', function () { return this.length > 0; });
  def(S, 'toNumber', function () { const n = Number(String(this).replace(/,/g, '')); if (Number.isNaN(n)) throw new Error('cannot convert to number'); return n; });
  def(S, 'toInt', function () { return parseInt(this, 10); }); def(S, 'toFloat', function () { return parseFloat(this); });
  def(S, 'toBoolean', function () { return !['false', 'no', '0', ''].includes(String(this).trim().toLowerCase()); });
  def(S, 'toDateTime', function () { const d = DateTime.fromISO(String(this), { setZone: true }); return d.isValid ? d : DateTime.fromJSDate(new Date(String(this))); });
  def(S, 'toDate', function () { return new Date(String(this)); });
  def(S, 'extractEmail', function () { return /[\w.+-]+@[\w-]+\.[\w.-]+/.exec(this)?.[0]; });
  def(S, 'extractDomain', function () { const s = String(this); const m = /@([\w.-]+)/.exec(s) ?? /^(?:https?:\/\/)?(?:www\.)?([^/:?#]+)/.exec(s); return m?.[1]; });
  def(S, 'extractUrl', function () { return /https?:\/\/[^\s"'<>]+/.exec(this)?.[0]; });
  def(S, 'isEmail', function () { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(this); });
  def(S, 'isNumeric', function () { return this.trim() !== '' && !Number.isNaN(Number(this)); });
  def(S, 'isUrl', function () { return /^https?:\/\/\S+$/.test(this); });
  def(S, 'toTitleCase', function () { return String(this).toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase()); });
  def(S, 'toSentenceCase', function () { const s = String(this).toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); });
  def(S, 'capitalize', function () { return String(this).charAt(0).toUpperCase() + String(this).slice(1); });
  def(S, 'toSnakeCase', function () { return String(this).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); });
  def(S, 'removeTags', function () { return String(this).replace(/<[^>]*>/g, ''); });
  def(S, 'removeMarkdown', function () { return String(this).replace(/[*_`#>]/g, ''); });
  def(S, 'replaceSpecialChars', function () { return String(this).normalize('NFKD').replace(/[̀-ͯ]/g, ''); });
  def(S, 'urlEncode', function () { return encodeURIComponent(this); }); def(S, 'urlDecode', function () { return decodeURIComponent(this); });
  def(S, 'quote', function (q = '"') { return `${q}${this}${q}`; });
  def(S, 'parseJson', function () { return JSON.parse(this); });
  def(S, 'base64Encode', function () { return Buffer.from(String(this)).toString('base64'); });
  def(A, 'first', function () { return this[0]; }); def(A, 'last', function () { return this[this.length - 1]; });
  def(A, 'isEmpty', function () { return this.length === 0; }); def(A, 'isNotEmpty', function () { return this.length > 0; });
  def(A, 'pluck', function (...f) { return this.map(x => f.length === 1 ? x?.[f[0]] : Object.fromEntries(f.map(k => [k, x?.[k]]))); });
  def(A, 'unique', function (...f) { const seen = new Set(); return this.filter(x => { const k = JSON.stringify(f.length ? f.map(k2 => x?.[k2]) : x); if (seen.has(k)) return false; seen.add(k); return true; }); });
  def(A, 'removeDuplicates', A.unique);
  def(A, 'sum', function () { return this.reduce((s, x) => s + Number(x), 0); });
  def(A, 'average', function () { return this.length ? this.reduce((s, x) => s + Number(x), 0) / this.length : 0; });
  def(A, 'max', function () { return Math.max(...this.map(Number)); }); def(A, 'min', function () { return Math.min(...this.map(Number)); });
  def(A, 'compact', function () { return this.filter(x => x !== null && x !== undefined && x !== ''); });
  def(A, 'chunk', function (n) { const out = []; for (let i = 0; i < this.length; i += n) out.push(this.slice(i, i + n)); return out; });
  def(A, 'difference', function (o) { return this.filter(x => !o.includes(x)); }); def(A, 'intersection', function (o) { return this.filter(x => o.includes(x)); });
  def(A, 'union', function (o) { return [...new Set([...this, ...o])]; });
  def(A, 'smartJoin', function (k, v) { return Object.fromEntries(this.map(x => [x?.[k], x?.[v]])); });
  def(A, 'toJsonString', function () { return JSON.stringify(this); });
  def(N, 'round', function (d = 0) { const f = 10 ** d; return Math.round(this * f) / f; });
  def(N, 'floor', function () { return Math.floor(this); }); def(N, 'ceil', function () { return Math.ceil(this); });
  def(N, 'isEven', function () { return this % 2 === 0; }); def(N, 'isOdd', function () { return Math.abs(this % 2) === 1; });
  def(N, 'toBoolean', function () { return this !== 0; }); def(N, 'format', function (loc, opts) { return new Intl.NumberFormat(loc, opts).format(this); });
  def(N, 'toDateTime', function (fmt) { return fmt === 's' ? DateTime.fromSeconds(Number(this)) : DateTime.fromMillis(Number(this)); });
  def(N, 'isInteger', function () { return Number.isInteger(this); });
  // Object extensions only on plain objects' prototype of the EXPRESSION realm (Code nodes get a realm without extensions, as in n8n).
  const OP = O.prototype;
  def(OP, 'isEmpty', function () { return O.keys(this).length === 0; }); def(OP, 'isNotEmpty', function () { return O.keys(this).length > 0; });
  def(OP, 'hasField', function (k) { return O.hasOwn(this, k); });
  def(OP, 'removeField', function (k) { const c = { ...this }; delete c[k]; return c; });
  def(OP, 'toJsonString', function () { return JSON.stringify(this); });
  def(OP, 'keepFieldsContaining', function (s) { return O.fromEntries(O.entries(this).filter(([, v]) => String(v).includes(s))); });
}
function installDateExtensions(DateTime) {
  const P = DateTime.prototype;
  const def = (name, fn) => { if (!Object.hasOwn(P, name)) Object.defineProperty(P, name, { value: fn, configurable: true, writable: true }); };
  def('format', function (f) { return this.toFormat(f); });
  def('beginningOf', function (u = 'week') { return this.startOf(u); });
  def('endOfMonth', function () { return this.endOf('month'); });
  def('isBetween', function (a, b) { const x = this.toMillis(); const A = toDT(a, DateTime).toMillis(), B = toDT(b, DateTime).toMillis(); return x > Math.min(A, B) && x < Math.max(A, B); });
  def('isInLast', function (n = 0, unit = 'minutes') { const now = DateTime.now(); return this >= now.minus({ [unit]: n }) && this <= now; });
  def('extract', function (u = 'week') { return u === 'week' ? this.weekNumber : this.get(u); });
  def('toDateTime', function () { return this; });
  const plus = P.plus, minus = P.minus;
  Object.defineProperty(P, 'plus', { value: function (a, u) { return typeof a === 'number' ? plus.call(this, { [u ?? 'milliseconds']: a }) : plus.call(this, a); }, configurable: true, writable: true });
  Object.defineProperty(P, 'minus', { value: function (a, u) { return typeof a === 'number' ? minus.call(this, { [u ?? 'milliseconds']: a }) : minus.call(this, a); }, configurable: true, writable: true });
}
function toDT(v, DateTime, zone) {
  if (v && typeof v === 'object' && typeof v.toMillis === 'function') return v;
  if (v instanceof Date) return DateTime.fromJSDate(v, { zone });
  if (typeof v === 'number') return DateTime.fromMillis(v > 1e11 ? v : v * 1000, { zone });
  const s = String(v ?? '');
  let d = DateTime.fromISO(s, { zone, setZone: /([+-]\d\d:?\d\d|Z)$/.test(s) });
  if (!d.isValid) d = DateTime.fromRFC2822(s, { zone });
  if (!d.isValid) d = DateTime.fromSQL(s, { zone });
  if (!d.isValid) { const t = Date.parse(s); if (Number.isFinite(t)) d = DateTime.fromMillis(t, { zone }); }
  return d;
}

// ------------------------------------------------------------------------------------------------ the engine
export function createSim({ vm, crypto }) {
  const { DateTime, Duration, Interval } = L();
  installDateExtensions(DateTime);

  function run(workflow, world, binding = {}, opts = {}) {
    const zone = workflow.settings?.timezone || binding.zone || 'UTC';
    const now = DateTime.fromISO(world.now, { zone: 'utc' }).setZone(zone);
    if (!now.isValid) throw new Error(`world ${world.id}: now is not an ISO date-time`);
    const nodes = (workflow.nodes ?? []).filter(n => !String(n.type).endsWith('stickyNote'));
    const byName = new Map(nodes.map(n => [n.name, n]));
    const outEdges = new Map(); // name -> [[{node, index}] per output]
    const inCount = new Map();  // name -> set of input indexes that are connected
    for (const [src, conns] of Object.entries(workflow.connections ?? {})) {
      if (!byName.has(src)) continue;
      const outs = (conns?.main ?? []).map(list => (list ?? []).filter(t => byName.has(t.node)));
      outEdges.set(src, outs);
      for (const list of outs) for (const t of list) { if (!inCount.has(t.node)) inCount.set(t.node, new Set()); inCount.get(t.node).add(t.index ?? 0); }
    }
    const pos = name => { const p = byName.get(name)?.position ?? [0, 0]; return [p[1] ?? 0, p[0] ?? 0]; };
    // ---- world state (mutable copy)
    const W = { sheets: clone(world.sheets ?? {}), inbox: clone(world.inbox ?? []), seen: clone(world.seen ?? {}), staticData: clone(world.staticData ?? {}) };
    const effects = [], trace = [], runs = new Map(); // name -> [{output: [[items]]}]
    let idCounter = 0, steps = 0;
    const genId = p => `${p}${String(++idCounter).padStart(6, '0')}`;
    const maxSteps = opts.maxSteps ?? 5000;
    // ---- two vm realms: expressions (with n8n's extension methods) and Code nodes (plain, as in n8n). Both see a frozen clock (the
    // world's now), a seeded Math.random and the workflow zone as Luxon's default zone, so a rerun is byte-identical.
    const nowMs = now.toMillis();
    L().Settings.now = () => nowMs;
    L().Settings.defaultZone = zone;
    let seed = 0x9e3779b9 ^ [...String(world.id ?? '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
    const rand = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const makeRealm = extended => {
      const ctx = vm.createContext({ DateTime, Duration, Interval, console: { log() {}, info() {}, warn() {}, error() {}, debug() {} }, Buffer: { from: (s, e) => Buffer.from(s, e) } });
      vm.runInContext(`(() => { const D = Date; const fixed = ${nowMs};
        class FrozenDate extends D { constructor(...a) { if (a.length === 0) super(fixed); else super(...a); } static now() { return fixed; } }
        globalThis.Date = FrozenDate; })();`, ctx);
      const G = vm.runInContext('globalThis', ctx);
      G.Math.random = rand;
      if (extended) installExtensions(G, DateTime);
      return { ctx, G, toCtx: v => v === undefined ? undefined : G.JSON.parse(JSON.stringify(v)) };
    };
    const RE = makeRealm(true), RC = makeRealm(false);
    const scripts = new Map();
    const script = (src, label) => { let s = scripts.get(src); if (!s) { try { s = new vm.Script(src, { filename: label }); } catch (e) { throw new Error(`syntax error in ${label}: ${e.message}`); } scripts.set(src, s); } return s; };
    // Default realm for helpers built below (expressions); Code nodes swap in RC.
    let ctx = RE.ctx, G = RE.G, toCtx = RE.toCtx;
    const inRealm = (R, fn) => { const prev = [ctx, G, toCtx]; [ctx, G, toCtx] = [R.ctx, R.G, R.toCtx]; try { return fn(); } finally { [ctx, G, toCtx] = prev; } };
    const nodeOut = (name, runIndex = -1, output = 0) => { const r = runs.get(name); if (!r?.length) return null; return (r.at(runIndex) ?? r.at(-1)).output?.[output] ?? []; };
    function dataApi(nodeName, items, itemIndex, extra = {}) {
      const cur = items[itemIndex];
      const ref = name => {
        if (!byName.has(name)) throw new Error(`Referenced node doesn't exist: ${name}`);
        const executed = runs.has(name);
        const all = (branch = 0, runIndex = -1) => executed ? toCtx((nodeOut(name, runIndex, branch) ?? []).map(i => ({ json: i.json }))) : G.Array();
        const pick = () => {
          if (!executed) throw new Error(`Node ${name} has not run yet`);
          const lin = cur?.lin?.[name];
          if (lin) return lin;
          const out = nodeOut(name) ?? [];
          if (out.length === 1) return out[0];
          return out[itemIndex] ?? out[0];
        };
        return { all, first: (b = 0, r = -1) => all(b, r)[0], last: (b = 0, r = -1) => { const a = all(b, r); return a[a.length - 1]; },
          get item() { const p = pick(); return p ? toCtx({ json: p.json }) : undefined; },
          itemMatching: i => { const it = cur?.lin?.[name] ?? (nodeOut(name) ?? [])[i]; return it ? toCtx({ json: it.json }) : undefined; },
          pairedItem: () => { const p = pick(); return p ? toCtx({ json: p.json }) : undefined; },
          get json() { const p = pick(); return p ? toCtx(p.json) : undefined; },
          isExecuted: executed, params: toCtx(byName.get(name).parameters ?? {}),
          get context() { return toCtx(nodeCtx.get(name) ?? {}); } };
      };
      const input = { all: () => toCtx(items.map(i => ({ json: i.json }))), first: () => items[0] ? toCtx({ json: items[0].json }) : undefined,
        last: () => items.length ? toCtx({ json: items.at(-1).json }) : undefined, get item() { return cur ? toCtx({ json: cur.json }) : undefined; },
        get params() { return toCtx(byName.get(nodeName)?.parameters ?? {}); } };
      const legacyNode = new Proxy({}, { get: (_, name) => { const out = nodeOut(String(name)) ?? []; const it = out[itemIndex] ?? out[0]; return { json: it ? toCtx(it.json) : undefined, parameter: toCtx(byName.get(String(name))?.parameters ?? {}), context: toCtx(nodeCtx.get(String(name)) ?? {}) }; } });
      const prev = extra.prevNode ?? null;
      return { $json: cur ? toCtx(cur.json) : undefined, $binary: toCtx({}), $input: input, $: ref, $node: legacyNode, $items: (name, b = 0, r = -1) => name ? ref(name).all(b, r) : input.all(),
        $item: i => ({ $json: items[i] ? toCtx(items[i].json) : undefined }),
        $now: now, $today: now.startOf('day'), $workflow: toCtx({ id: workflow.id ?? 'sim', name: workflow.name ?? 'sim', active: true }),
        $execution: toCtx({ id: `sim-${world.id}`, mode: 'production', resumeUrl: 'http://sim.invalid/resume' }), $runIndex: extra.runIndex ?? 0, $itemIndex: itemIndex,
        $prevNode: toCtx({ name: prev, outputIndex: 0, runIndex: 0 }), $vars: toCtx({}), $env: new Proxy({}, { get: () => { throw new Error('access to env vars denied'); } }),
        $parameter: toCtx(byName.get(nodeName)?.parameters ?? {}), $position: itemIndex, $thisItemIndex: itemIndex, $thisRunIndex: extra.runIndex ?? 0,
        $if: (c, a, b) => (c ? a : b), $ifEmpty: (v, d) => (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length) ? d : v),
        $min: (...a) => Math.min(...a), $max: (...a) => Math.max(...a), $jmespath: () => { throw new Error('$jmespath is not supported by n8n-sim'); },
        $getWorkflowStaticData: k => { W.staticData[k] ??= {}; return W.staticData[k]; } };
    }
    function evalExpr(src, nodeName, items, itemIndex, extra) {
      Object.assign(G, dataApi(nodeName, items, itemIndex, extra));
      try { return script(`(${src}\n)`, `${nodeName}:expression`).runInContext(ctx, { timeout: 1000 }); }
      catch (e) { throw new NodeError(nodeName, `expression failed: ${e.message} [${String(src).slice(0, 120)}]`); }
    }
    const render = v => v === undefined || v === null ? '' : typeof v === 'object' ? (typeof v.toISO === 'function' ? v.toISO() : JSON.stringify(v)) : String(v);
    function evalParam(v, nodeName, items, itemIndex, extra) {
      if (typeof v === 'string' && v.startsWith('=')) {
        const body = v.slice(1);
        const whole = /^\s*\{\{([\s\S]*?)\}\}\s*$/.exec(body);
        if (whole && !whole[1].includes('}}') && (body.match(/\{\{/g) ?? []).length === 1) {
          const r = evalExpr(whole[1], nodeName, items, itemIndex, extra);
          if (r === undefined || typeof r === 'function') return undefined;
          if (r && typeof r === 'object' && typeof r.toISO === 'function') return r.toISO();
          return JSON.parse(JSON.stringify(r ?? null, (k, x) => (x && typeof x === 'object' && typeof x.toISO === 'function' ? x.toISO() : x)) ?? 'null');
        }
        return body.replace(/\{\{([\s\S]*?)\}\}/g, (_, x) => render(evalExpr(x, nodeName, items, itemIndex, extra)));
      }
      if (Array.isArray(v)) return v.map(x => evalParam(x, nodeName, items, itemIndex, extra));
      if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, evalParam(x, nodeName, items, itemIndex, extra)]));
      return v;
    }
    const nodeCtx = new Map();
    // ---- run one node
    function execNode(node, inputs, extra) {
      const name = node.name, type = String(node.type), base = type.split('.').pop(), ver = Number(node.typeVersion ?? 1), P = node.parameters ?? {};
      let items = inputs[0] ?? [];
      if (node.executeOnce && items.length > 1) items = items.slice(0, 1);
      const param = (key, i = 0, dflt) => { const raw = get(P, key); const v = raw === undefined ? dflt : evalParam(raw, name, items, i, extra); return v === undefined ? dflt : v; };
      const pass = (srcItems = items) => srcItems.map(it => ({ json: clone(it.json), lin: { ...(it.lin ?? {}) } }));
      const derive = (json, from) => ({ json, lin: { ...(from?.lin ?? {}) } });
      const fx = e => effects.push({ node: name, ...e });
      const H = { name, base, ver, P, items, inputs, param, pass, derive, fx, extra };
      if (node.disabled) return [pass()];
      const impl = NODES[base];
      if (!impl) throw new NodeError(name, `node type ${type} is not simulated`);
      return impl(H);
    }
    const condEval = (H, conds, i, { ignoreCase = false, loose = false } = {}) => evalConditionsV2(H, conds, i, { ignoreCase, loose });
    // n8n filter (If v2, Filter v2, Switch v3) conditions
    function evalConditionsV2(H, condParam, i, flags) {
      const c = condParam ?? {}; const list = c.conditions ?? []; const comb = c.combinator ?? 'and';
      const opt = c.options ?? {}; const caseSensitive = flags.ignoreCase ? false : opt.caseSensitive !== false; const loose = flags.loose || opt.typeValidation === 'loose';
      const results = list.map(cond => {
        const left = evalParam(cond.leftValue, H.name, H.items, i, H.extra), right = evalParam(cond.rightValue, H.name, H.items, i, H.extra);
        return compareV2(H.name, cond.operator ?? {}, left, right, { caseSensitive, loose });
      });
      return comb === 'or' ? results.some(Boolean) : results.every(Boolean);
    }
    function compareV2(nodeName, op, l, r, { caseSensitive, loose }) {
      const type = op.type ?? 'string', o = op.operation ?? 'equals';
      const empty = v => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length);
      if (o === 'exists') return l !== undefined && l !== null;
      if (o === 'notExists') return l === undefined || l === null;
      if (o === 'empty') return empty(l);
      if (o === 'notEmpty') return !empty(l);
      const conv = (v, side) => {
        if (v === undefined || v === null) return v;
        if (type === 'number') { if (typeof v === 'number') return v; if (loose || side === 'right') { const n = Number(String(v).trim()); if (String(v).trim() !== '' && !Number.isNaN(n)) return n; if (side === 'right' && !loose) return n; } throw new NodeError(nodeName, `Wrong type: '${String(v).slice(0, 40)}' is a ${typeof v} but was expecting a number`); }
        if (type === 'boolean') { if (typeof v === 'boolean') return v; if (loose || side === 'right') { const s = String(v).trim().toLowerCase(); if (['true', '1', 'yes'].includes(s)) return true; if (['false', '0', 'no', ''].includes(s)) return false; } throw new NodeError(nodeName, `Wrong type: '${String(v).slice(0, 40)}' is a ${typeof v} but was expecting a boolean`); }
        if (type === 'dateTime') { const d = toDT(v, DateTime, zone); if (!d.isValid) throw new NodeError(nodeName, `Wrong type: '${String(v).slice(0, 40)}' is not a date`); return d.toMillis(); }
        if (type === 'string') { if (typeof v === 'string') return caseSensitive ? v : v.toLowerCase(); if (loose || side === 'right') { const s = typeof v === 'object' ? JSON.stringify(v) : String(v); return caseSensitive ? s : s.toLowerCase(); } throw new NodeError(nodeName, `Wrong type: '${String(v).slice(0, 40)}' is a ${typeof v} but was expecting a string`); }
        if (type === 'array') { if (Array.isArray(v)) return v; if (loose && typeof v === 'string') { try { const p = JSON.parse(v); if (Array.isArray(p)) return p; } catch {} } if (side === 'right') return v; throw new NodeError(nodeName, 'Wrong type: expecting an array'); }
        return v;
      };
      if (type === 'boolean' && (o === 'true' || o === 'false')) { const b = conv(l, 'left'); return o === 'true' ? b === true : b === false; }
      if (type === 'array') {
        const a = conv(l, 'left') ?? [];
        const n = Number(r);
        switch (o) {
          case 'contains': return a.some(x => caseSensitive || typeof x !== 'string' ? x === r || String(x) === String(r) : String(x).toLowerCase() === String(r).toLowerCase());
          case 'notContains': return !a.some(x => x === r || String(x) === String(r));
          case 'lengthEquals': return a.length === n; case 'lengthNotEquals': return a.length !== n;
          case 'lengthGt': return a.length > n; case 'lengthLt': return a.length < n; case 'lengthGte': return a.length >= n; case 'lengthLte': return a.length <= n;
          default: throw new NodeError(nodeName, `array operator ${o} is not simulated`);
        }
      }
      const a = conv(l, 'left'), b = op.singleValue ? undefined : conv(r, 'right');
      switch (o) {
        case 'equals': return a === b || (a !== undefined && a !== null && b !== undefined && b !== null && String(a) === String(b) && type !== 'string');
        case 'notEquals': return !(a === b);
        case 'contains': return typeof a === 'string' && a.includes(String(b)); case 'notContains': return !(typeof a === 'string' && a.includes(String(b)));
        case 'startsWith': return typeof a === 'string' && a.startsWith(String(b)); case 'notStartsWith': return !(typeof a === 'string' && a.startsWith(String(b)));
        case 'endsWith': return typeof a === 'string' && a.endsWith(String(b)); case 'notEndsWith': return !(typeof a === 'string' && a.endsWith(String(b)));
        case 'regex': case 'notRegex': { const m = /^\/(.*)\/([gimusy]*)$/.exec(String(r)); const re = m ? new RegExp(m[1], m[2]) : new RegExp(String(r)); const t = re.test(String(l ?? '')); return o === 'regex' ? t : !t; }
        case 'gt': case 'after': return a > b; case 'lt': case 'before': return a < b;
        case 'gte': case 'afterOrEquals': return a >= b; case 'lte': case 'beforeOrEquals': return a <= b;
        default: throw new NodeError(nodeName, `operator ${type}.${o} is not simulated`);
      }
    }
    // If v1 / Switch v1-v2 style comparisons
    function compareV1(kind, op, a, b) {
      switch (kind) {
        case 'number': { const x = Number(a), y = Number(b); switch (op) { case 'equal': return x === y; case 'notEqual': return x !== y; case 'smaller': return x < y; case 'smallerEqual': return x <= y; case 'larger': return x > y; case 'largerEqual': return x >= y; case 'isEmpty': return a === undefined || a === null || a === ''; case 'isNotEmpty': return !(a === undefined || a === null || a === ''); } break; }
        case 'boolean': { const t = v => v === true || v === 'true'; switch (op) { case 'equal': return t(a) === t(b); case 'notEqual': return t(a) !== t(b); } break; }
        case 'dateTime': { const x = toDT(a, DateTime, zone).toMillis(), y = toDT(b, DateTime, zone).toMillis(); if (op === 'after') return x > y; if (op === 'before') return x < y; break; }
        default: { const x = a === undefined || a === null ? '' : String(a), y = b === undefined || b === null ? '' : String(b); switch (op) { case 'equal': return x === y; case 'notEqual': return x !== y; case 'contains': return x.includes(y); case 'notContains': return !x.includes(y); case 'startsWith': return x.startsWith(y); case 'notStartsWith': return !x.startsWith(y); case 'endsWith': return x.endsWith(y); case 'notEndsWith': return !x.endsWith(y); case 'isEmpty': return x === ''; case 'isNotEmpty': return x !== ''; case 'regex': case 'notRegex': { const m = /^\/(.*)\/([gimusy]*)$/.exec(y); const t = (m ? new RegExp(m[1], m[2]) : new RegExp(y)).test(x); return op === 'regex' ? t : !t; } } }
      }
      throw new Error(`If v1 operation ${kind}.${op} is not simulated`);
    }
    // ---- sheets
    const sheetName = (H, i) => {
      const bound = binding.sheets?.[H.name];
      if (bound) return bound;
      const doc = rlValue(H.param('documentId', i)), sh = rlValue(H.param('sheetName', i));
      const key = `${doc}|${sh}`;
      if (binding.sheetKeys?.[key]) return binding.sheetKeys[key];
      throw new NodeError(H.name, `no world sheet is bound for ${key}`);
    };
    const sheetOf = (H, name) => { const s = W.sheets[name]; if (!s) throw new NodeError(H.name, `world sheet ${name} does not exist`); return s; };
    const cellEq = (a, b) => String(a ?? '').trim() === String(b ?? '').trim();
    const NODES = {
      // ---------------- triggers (the started trigger gets the world event; others never run)
      manualTrigger: () => [[{ json: {}, lin: {} }]], start: () => [[{ json: {}, lin: {} }]],
      scheduleTrigger: H => { const d = now; return [[{ json: { timestamp: d.toISO(), 'Readable date': d.toFormat('MMMM d yyyy, h:mm:ss a'), 'Readable time': d.toFormat('h:mm:ss a'), 'Day of week': d.toFormat('cccc'), Year: d.toFormat('yyyy'), Month: d.toFormat('MMMM'), 'Day of month': d.toFormat('dd'), Hour: d.toFormat('HH'), Minute: d.toFormat('mm'), Second: d.toFormat('ss'), Timezone: `${zone} (UTC${d.toFormat('ZZ')})` }, lin: {} }]]; },
      cron: () => [[{ json: {}, lin: {} }]], interval: () => [[{ json: {}, lin: {} }]],
      webhook: () => { const e = world.event ?? {}; return [[{ json: { headers: e.headers ?? {}, params: e.params ?? {}, query: e.query ?? {}, body: e.body ?? {}, webhookUrl: 'http://sim.invalid/webhook', executionMode: 'production' }, lin: {} }]]; },
      formTrigger: () => { const e = world.event ?? {}; return [[{ json: { ...e, submittedAt: e.submittedAt ?? now.toISO(), formMode: 'production' }, lin: {} }]]; },
      gmailTrigger: () => [[...(Array.isArray(world.event) ? world.event : [world.event ?? {}])].map(e => ({ json: clone(e), lin: {} }))],
      telegramTrigger: () => [[{ json: clone(world.event ?? {}), lin: {} }]],
      googleSheetsTrigger: () => [[...(Array.isArray(world.event) ? world.event : [world.event ?? {}])].map(e => ({ json: clone(e), lin: {} }))],
      emailReadImap: () => [[...(Array.isArray(world.event) ? world.event : [world.event ?? {}])].map(e => ({ json: clone(e), lin: {} }))],
      // ---------------- flow
      noOp: H => [H.pass()], wait: H => [H.pass()],
      stopAndError: H => { const msg = H.P.errorType === 'errorObject' ? JSON.stringify(H.param('errorObject', 0)) : H.param('errorMessage', 0, 'stopped'); throw Object.assign(new NodeError(H.name, String(msg)), { stop: true }); },
      if: H => {
        const t = [], f = [];
        H.items.forEach((it, i) => {
          let ok;
          if (H.ver >= 2) ok = condEval(H, get(H.P, 'conditions'), i, { ignoreCase: H.P.options?.ignoreCase === true, loose: H.P.looseTypeValidation === true || H.P.options?.looseTypeValidation === true });
          else {
            const c = H.P.conditions ?? {}, res = [];
            for (const kind of ['boolean', 'dateTime', 'number', 'string']) for (const [k, cond] of (c[kind] ?? []).entries()) {
              const a = evalParam(cond.value1, H.name, H.items, i, H.extra), b = evalParam(cond.value2, H.name, H.items, i, H.extra);
              res.push(compareV1(kind, cond.operation ?? (kind === 'boolean' || kind === 'number' || kind === 'string' ? 'equal' : 'after'), a, b)); void k;
            }
            ok = (H.P.combineOperation ?? 'all') === 'any' ? res.some(Boolean) : res.every(Boolean);
          }
          (ok ? t : f).push(H.derive(clone(it.json), it));
        });
        return [t, f];
      },
      filter: H => {
        const kept = [], dropped = [];
        H.items.forEach((it, i) => {
          let ok;
          if (H.ver >= 2) ok = condEval(H, get(H.P, 'conditions'), i, { ignoreCase: H.P.options?.ignoreCase === true, loose: H.P.options?.looseTypeValidation === true || H.P.looseTypeValidation === true });
          else { const c = H.P.conditions ?? {}, res = []; for (const kind of ['boolean', 'dateTime', 'number', 'string']) for (const cond of (c[kind] ?? [])) res.push(compareV1(kind, cond.operation ?? 'equal', evalParam(cond.value1, H.name, H.items, i, H.extra), evalParam(cond.value2, H.name, H.items, i, H.extra))); ok = (H.P.combineConditions ?? 'AND') === 'OR' ? res.some(Boolean) : res.every(Boolean); }
          (ok ? kept : dropped).push(H.derive(clone(it.json), it));
        });
        return H.P.options?.allowFallthrough ? [kept, dropped] : [kept];
      },
      switch: H => {
        if (H.ver >= 3) {
          const mode = H.P.mode ?? 'rules';
          if (mode === 'expression') { const n = Number(H.P.numberOutputs ?? 4); const outs = Array.from({ length: n }, () => []); H.items.forEach((it, i) => { const k = Number(H.param('output', i)); if (!(k >= 0 && k < n)) throw new NodeError(H.name, `output ${k} is not allowed`); outs[k].push(H.derive(clone(it.json), it)); }); return outs; }
          const rules = H.P.rules?.values ?? H.P.rules?.rules ?? []; const opt = H.P.options ?? {};
          const fb = opt.fallbackOutput ?? 'none'; const n = rules.length + (fb === 'extra' ? 1 : 0);
          const outs = Array.from({ length: Math.max(n, 1) }, () => []);
          H.items.forEach((it, i) => {
            const hit = [];
            for (const [k, rule] of rules.entries()) { if (condEval(H, rule.conditions, i, { ignoreCase: opt.ignoreCase === true, loose: opt.looseTypeValidation === true || H.P.looseTypeValidation === true })) { hit.push(k); if (!opt.allMatchingOutputs) break; } }
            if (!hit.length) { if (fb === 'extra') hit.push(rules.length); else if (fb !== 'none' && fb !== undefined && Number.isInteger(Number(fb)) && Number(fb) >= 0) hit.push(Number(fb)); }
            for (const k of hit) outs[k].push(H.derive(clone(it.json), it));
          });
          return outs;
        }
        // v1, v2
        const mode = H.P.mode ?? 'rules';
        if (mode === 'expression') { const outs = [[], [], [], []]; H.items.forEach((it, i) => { const k = Number(H.param('output', i)); outs[k]?.push(H.derive(clone(it.json), it)); }); return outs; }
        const dataType = H.P.dataType ?? 'number', rules = H.P.rules?.rules ?? [], fb = Number(H.P.fallbackOutput ?? -1);
        const outs = [[], [], [], []];
        H.items.forEach((it, i) => {
          const v1 = H.param('value1', i);
          let out = -1;
          for (const rule of rules) { const v2 = evalParam(rule.value2, H.name, H.items, i, H.extra); if (compareV1(dataType, rule.operation ?? 'equal', v1, v2)) { out = Number(rule.output ?? 0); break; } }
          if (out < 0 && fb >= 0) out = fb;
          if (out >= 0) outs[out].push(H.derive(clone(it.json), it));
        });
        return outs;
      },
      merge: H => mergeNode(H),
      splitInBatches: H => {
        const st = nodeCtx.get(H.name);
        const size = Number(H.param('batchSize', 0, H.ver >= 3 ? 1 : 10)) || 1;
        if (H.ver >= 3) {
          if (!st || st.done || H.P.options?.reset === true && H.extra.fromOutside) {
            const all = H.pass(); const s = { queue: all.slice(size), processed: [], done: false, noItemsLeft: all.length <= size, currentRunIndex: 0 };
            nodeCtx.set(H.name, s);
            if (!all.length) { s.done = true; return [[], []]; }
            return [[], all.slice(0, size)];
          }
          st.processed.push(...H.pass()); st.currentRunIndex++;
          if (st.queue.length) { const next = st.queue.splice(0, size); st.noItemsLeft = st.queue.length === 0; return [[], next]; }
          st.done = true; st.noItemsLeft = true; return [st.processed, []];
        }
        // v1/v2: one output; the flow loops back and checks $node[...].context.noItemsLeft
        if (!st || st.done || (H.P.options?.reset === true && H.extra.fromOutside)) { const all = H.pass(); const s = { queue: all.slice(size), done: all.length <= size, noItemsLeft: all.length <= size, currentRunIndex: 0 }; nodeCtx.set(H.name, s); return [all.slice(0, size)]; }
        if (!st.queue.length) { st.done = true; st.noItemsLeft = true; return [[]]; }
        const next = st.queue.splice(0, size); st.noItemsLeft = st.queue.length === 0; st.done = st.noItemsLeft; st.currentRunIndex++; return [next];
      },
      // ---------------- data
      set: H => {
        const out = [];
        H.items.forEach((it, i) => {
          const dot = H.P.options?.dotNotation !== false;
          let base;
          if (H.ver >= 3) {
            const mode = H.P.mode ?? 'manual';
            let fields = {};
            if (mode === 'raw') { let j = H.param('jsonOutput', i, '{}'); if (typeof j === 'string') { try { j = JSON.parse(j); } catch (e) { throw new NodeError(H.name, `jsonOutput is not JSON: ${e.message}`); } } fields = j ?? {}; }
            const include = H.ver >= 3.3 ? (H.P.includeOtherFields ? (H.P.include ?? 'all') : 'none') : (H.P.include ?? 'all');
            const src = clone(it.json);
            if (include === 'all') base = src; else if (include === 'none') base = {};
            else if (include === 'selected') { base = {}; for (const f of splitList(H.P.includeFields)) set(base, f, get(src, f), dot); }
            else if (include === 'except') { base = src; for (const f of splitList(H.P.excludeFields)) unset(base, f); }
            else base = {};
            if (mode === 'raw') { for (const [k, v] of Object.entries(fields)) set(base, k, v, dot); }
            else if (H.ver >= 3.3 || H.P.assignments) {
              for (const a of H.P.assignments?.assignments ?? []) {
                const nm = evalParam(a.name, H.name, H.items, i, H.extra); let v = evalParam(a.value, H.name, H.items, i, H.extra);
                v = convertType(H.name, a.type ?? 'string', v, H.P.options?.ignoreConversionErrors);
                set(base, nm, v, dot);
              }
            } else {
              for (const f of H.P.fields?.values ?? []) {
                const t = (f.type ?? 'stringValue').replace('Value', ''); const raw = f[f.type ?? 'stringValue'] ?? f.stringValue;
                set(base, evalParam(f.name, H.name, H.items, i, H.extra), convertType(H.name, t, evalParam(raw, H.name, H.items, i, H.extra), H.P.options?.ignoreConversionErrors), dot);
              }
            }
          } else {
            base = H.P.keepOnlySet ? {} : clone(it.json);
            for (const kind of ['boolean', 'number', 'string']) for (const f of H.P.values?.[kind] ?? []) {
              let v = evalParam(f.value, H.name, H.items, i, H.extra);
              if (kind === 'number') v = Number(v ?? 0); if (kind === 'boolean') v = v === true || v === 'true';
              set(base, evalParam(f.name, H.name, H.items, i, H.extra), v, dot);
            }
          }
          out.push(H.derive(base, it));
        });
        return [out];
      },
      renameKeys: H => [H.items.map((it, i) => { const j = clone(it.json); for (const k of H.P.keys?.key ?? []) { const v = get(j, k.currentKey); if (v !== undefined) { unset(j, k.currentKey); set(j, k.newKey, v); } } void i; return H.derive(j, it); })],
      code: H => codeNode(H), function: H => codeNode(H, 'function'), functionItem: H => codeNode(H, 'functionItem'),
      splitOut: H => {
        const fields = splitList(H.param('fieldToSplitOut', 0)); const inc = H.P.include ?? 'noOtherFields'; const dest = H.P.options?.destinationFieldName;
        const out = [];
        H.items.forEach(it => {
          const lists = fields.map(f => { const v = get(it.json, f); return v === undefined ? [] : Array.isArray(v) ? v : isObj(v) ? Object.values(v) : [v]; });
          const n = Math.max(0, ...lists.map(l => l.length));
          for (let k = 0; k < n; k++) {
            let j = {};
            if (inc === 'allOtherFields') { j = clone(it.json); for (const f of fields) unset(j, f); }
            if (inc === 'selectedOtherFields') for (const f of splitList(H.P.fieldsToInclude)) set(j, f, clone(get(it.json, f)));
            fields.forEach((f, fi) => { const el = lists[fi][k]; if (isObj(el) && fields.length === 1 && !dest) j = { ...j, ...clone(el) }; else set(j, dest || f.split('.').at(-1), clone(el)); });
            out.push(H.derive(j, it));
          }
        });
        return [out];
      },
      aggregate: H => {
        if ((H.P.aggregate ?? 'aggregateIndividualFields') === 'aggregateAllItemData') {
          const dest = H.P.destinationFieldName ?? 'data', inc = H.P.include ?? 'allFields';
          const data = H.items.map(it => { if (inc === 'specifiedFields') return Object.fromEntries(splitList(H.P.fieldsToInclude).map(f => [f, clone(get(it.json, f))])); if (inc === 'allFieldsExcept') { const j = clone(it.json); for (const f of splitList(H.P.fieldsToExclude)) unset(j, f); return j; } return clone(it.json); });
          return [[H.derive({ [dest]: data }, H.items[0])]];
        }
        const j = {};
        for (const f of H.P.fieldsToAggregate?.fieldToAggregate ?? []) {
          const key = f.renameField ? f.outputFieldName : String(f.fieldToAggregate).split('.').at(-1);
          let vals = H.items.map(it => clone(get(it.json, f.fieldToAggregate)));
          if (!H.P.options?.keepMissing) vals = vals.filter(v => v !== undefined && v !== null);
          if (H.P.options?.mergeLists) vals = vals.flat();
          j[key] = vals;
        }
        return [[H.derive(j, H.items[0])]];
      },
      itemLists: H => {
        const op = H.P.operation ?? 'splitOutItems';
        if (op === 'splitOutItems') return NODES.splitOut({ ...H, P: { ...H.P, fieldToSplitOut: H.P.fieldToSplitOut } });
        if (op === 'aggregateItems') return NODES.aggregate(H);
        if (op === 'removeDuplicates') return NODES.removeDuplicates({ ...H, ver: 1 });
        if (op === 'sort') return NODES.sort(H); if (op === 'limit') return NODES.limit(H); if (op === 'summarize') return NODES.summarize(H);
        throw new NodeError(H.name, `itemLists ${op} is not simulated`);
      },
      sort: H => {
        const type = H.P.type ?? 'simple';
        const arr = H.pass();
        if (type === 'random') throw new NodeError(H.name, 'random sort is not deterministic');
        if (type === 'code') { const fn = script(`(function(a,b){${H.P.code}})`, `${H.name}:sort`).runInContext(ctx, { timeout: 1000 }); return [arr.sort((a, b) => fn(toCtx(a.json), toCtx(b.json)))]; }
        const keys = H.P.sortFieldsUi?.sortField ?? [];
        const cmp = (x, y) => (x === y ? 0 : x === undefined || x === null ? 1 : y === undefined || y === null ? -1 : typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y)));
        return [arr.sort((a, b) => { for (const k of keys) { const r = cmp(get(a.json, k.fieldName), get(b.json, k.fieldName)); if (r) return k.order === 'descending' ? -r : r; } return 0; })];
      },
      limit: H => { const n = Number(H.param('maxItems', 0, 1)); const a = H.pass(); return [(H.P.keep ?? 'firstItems') === 'lastItems' ? a.slice(Math.max(0, a.length - n)) : a.slice(0, n)]; },
      removeDuplicates: H => {
        const op = H.P.operation ?? 'removeDuplicateInputItems';
        if (H.ver >= 2 && op === 'removeItemsRepeatedInPreviousExecutions') {
          const scope = H.P.options?.scope ?? 'node'; const key = scope === 'workflow' ? '__workflow' : H.name;
          const seen = new Set((W.seen[key] ?? []).map(String)); const out = [];
          H.items.forEach((it, i) => { const v = String(H.param('dedupeValue', i)); if (!seen.has(v)) { seen.add(v); out.push(H.derive(clone(it.json), it)); } });
          W.seen[key] = [...seen]; return [out];
        }
        if (H.ver >= 2 && op === 'clearDeduplicationHistory') { W.seen = {}; return [H.pass()]; }
        const compare = H.P.compare ?? 'allFields'; const seen = new Set(); const out = [];
        for (const it of H.items) {
          let k;
          if (compare === 'selectedFields') k = JSON.stringify(splitList(H.P.fieldsToCompare?.fields?.map?.(f => f.fieldName) ?? H.P.fieldsToCompare).map(f => get(it.json, f)));
          else if (compare === 'allFieldsExcept') { const j = clone(it.json); for (const f of splitList(H.P.fieldsToExclude?.fields?.map?.(f => f.fieldName) ?? H.P.fieldsToExclude)) unset(j, f); k = JSON.stringify(j); }
          else k = JSON.stringify(it.json);
          if (!seen.has(k)) { seen.add(k); out.push(H.derive(clone(it.json), it)); }
        }
        return [out];
      },
      summarize: H => {
        const specs = H.P.fieldsToSummarize?.values ?? [{ aggregation: 'count', field: '' }];
        const by = splitList(H.P.fieldsToSplitBy);
        const groups = new Map();
        for (const it of H.items) { const k = JSON.stringify(by.map(f => get(it.json, f) ?? null)); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
        const prefix = { append: 'appended', average: 'average', concatenate: 'concatenated', count: 'count', countUnique: 'unique_count', max: 'max', min: 'min', sum: 'sum' };
        const outRows = [];
        for (const [k, members] of groups) {
          const j = {}; JSON.parse(k).forEach((v, i) => { if (v !== null) j[by[i]] = v; });
          for (const s of specs) {
            const vals = members.map(it => get(it.json, s.field)).filter(v => s.includeEmpty || (v !== undefined && v !== null && v !== ''));
            const nums = vals.map(Number);
            let r;
            switch (s.aggregation ?? 'count') {
              case 'append': r = clone(vals); break; case 'concatenate': r = vals.map(String).join(s.separateBy === 'other' ? (s.customSeparator ?? '') : s.separateBy === 'newline' ? '\n' : s.separateBy === 'comma' || s.separateBy === undefined ? ',' : s.separateBy); break;
              case 'average': r = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null; break; case 'count': r = vals.length; break;
              case 'countUnique': r = new Set(vals.map(v => JSON.stringify(v))).size; break; case 'max': r = nums.length ? Math.max(...nums) : null; break;
              case 'min': r = nums.length ? Math.min(...nums) : null; break; case 'sum': r = nums.reduce((a, b) => a + b, 0); break;
              default: throw new NodeError(H.name, `aggregation ${s.aggregation} is not simulated`);
            }
            j[`${prefix[s.aggregation ?? 'count']}_${s.field}`] = r;
          }
          outRows.push(H.derive(j, members[0]));
        }
        if (H.P.options?.outputFormat === 'singleItem') return [[H.derive(Object.fromEntries(outRows.map((r, i) => [String(i), r.json])), H.items[0])]];
        return [outRows];
      },
      dateTime: H => {
        const out = [];
        H.items.forEach((it, i) => {
          const j = clone(it.json);
          if (H.ver >= 2) {
            const op = H.P.operation ?? 'getCurrentDate';
            const outField = (f, d) => H.param('outputFieldName', i, d) ?? d;
            const tz = H.P.options?.timezone;
            const dt = v => { let d = toDT(v, DateTime, zone); if (tz) d = d.setZone(tz); return d; };
            if (op === 'getCurrentDate') { const d = H.P.includeTime === false ? now.startOf('day') : now; set(j, outField(0, 'currentDate'), (tz ? d.setZone(tz) : d).toISO()); }
            else if (op === 'addToDate' || op === 'subtractFromDate') { const d = dt(H.param('magnitude', i)); const n = Number(H.param('duration', i, 0)); const u = H.P.timeUnit ?? 'days'; set(j, outField(0, 'newDate'), (op === 'addToDate' ? d.plus({ [u]: n }) : d.minus({ [u]: n })).toISO()); }
            else if (op === 'formatDate') { const d = dt(H.param('date', i)); const f = H.P.format === 'custom' ? H.param('customFormat', i) : (H.P.format ?? 'MM/dd/yyyy'); set(j, outField(0, 'formattedDate'), d.toFormat(f)); }
            else if (op === 'getTimeBetweenDates') { const a = dt(H.param('startDate', i)), b = dt(H.param('endDate', i)); const units = H.P.units ?? ['day']; const diff = b.diff(a, units.map(u => `${u}s`)).toObject(); set(j, outField(0, 'timeDifference'), Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v]))); }
            else if (op === 'extractDate') { const d = dt(H.param('date', i)); set(j, outField(0, 'datePart'), d.get(H.P.part ?? 'month')); }
            else if (op === 'roundDate') { const d = dt(H.param('date', i)); const u = H.P.toNearest ?? 'day'; set(j, outField(0, 'roundedDate'), ((H.P.mode ?? 'roundDown') === 'roundDown' ? d.startOf(u) : d.endOf(u)).toISO()); }
            else throw new NodeError(H.name, `dateTime ${op} is not simulated`);
          } else {
            const action = H.P.action ?? 'format', prop = H.P.dataPropertyName ?? 'data';
            const d = toDT(H.param('value', i), DateTime, zone);
            if (action === 'format') { const f = H.P.toFormat ?? 'MM/DD/YYYY'; const lf = H.P.custom ? f : f.replace(/YYYY/g, 'yyyy').replace(/DD/g, 'dd'); set(j, prop, d.toFormat(H.P.custom ? H.P.toFormat : lf)); }
            else { const n = Number(H.param('duration', i, 0)); const u = H.P.timeUnit ?? 'days'; set(j, prop, ((H.P.operation ?? 'add') === 'add' ? d.plus({ [u]: n }) : d.minus({ [u]: n })).toISO()); }
          }
          out.push(H.derive(j, it));
        });
        return [out];
      },
      compareDatasets: H => {
        const A = H.inputs[0] ?? [], B = H.inputs[1] ?? []; const pairs = H.P.mergeByFields?.values ?? [];
        const key = (it, side) => JSON.stringify(pairs.map(p => String(get(it.json, side === 0 ? p.field1 : p.field2) ?? '')));
        const bBy = new Map(); for (const it of B) bBy.set(key(it, 1), it);
        const aKeys = new Set(A.map(it => key(it, 0)));
        const onlyA = [], same = [], diff = [], onlyB = [];
        const skip = new Set(splitList(H.P.options?.skipFields));
        const strip = j => { const c = clone(j); for (const f of skip) unset(c, f); return c; };
        for (const it of A) { const o = bBy.get(key(it, 0)); if (!o) onlyA.push(H.derive(clone(it.json), it)); else if (JSON.stringify(strip(it.json)) === JSON.stringify(strip(o.json))) same.push(H.derive(clone(it.json), it)); else diff.push(H.derive({ keys: Object.fromEntries(pairs.map(p => [p.field1, get(it.json, p.field1)])), same: {}, different: {}, input1: clone(it.json), input2: clone(o.json) }, it)); }
        for (const it of B) if (!aKeys.has(key(it, 1))) onlyB.push(H.derive(clone(it.json), it));
        return [onlyA, same, diff, onlyB];
      },
      respondToWebhook: H => {
        const w = H.P.respondWith ?? (H.ver >= 1.1 ? 'firstIncomingItem' : 'firstIncomingItem');
        let body;
        if (w === 'json') { body = H.param('responseBody', 0); if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* text */ } } }
        else if (w === 'text') body = H.param('responseBody', 0);
        else if (w === 'allIncomingItems') body = H.items.map(it => clone(it.json));
        else if (w === 'firstIncomingItem') body = clone(H.items[0]?.json ?? {});
        else if (w === 'noData') body = null;
        else if (w === 'redirect') body = { redirect: H.param('redirectURL', 0) };
        else throw new NodeError(H.name, `respondWith ${w} is not simulated`);
        const code = Number(H.P.options?.responseCode ?? 200);
        H.fx({ kind: 'respond', code, body: clone(body ?? null) });
        return [H.pass()];
      },
      // ---------------- connectors
      googleSheets: H => {
        const op = H.P.operation ?? (H.ver >= 4 ? 'read' : 'read');
        const out = [];
        const rowsOut = (name, rows) => rows.map(r => ({ ...clone(r) }));
        if (['read', 'getAll', 'lookup'].includes(op)) {
          const n = H.items.length || 1;
          for (let i = 0; i < n; i++) {
            const name = sheetName(H, i); const s = sheetOf(H, name);
            let rows = s.rows.map((r, k) => ({ row_number: k + 2, ...r }));
            const filters = H.P.filtersUI?.values ?? (op === 'lookup' ? [{ lookupColumn: H.P.lookupColumn, lookupValue: H.P.lookupValue }] : []);
            if (filters.length) {
              const evald = filters.map(f => ({ col: evalParam(f.lookupColumn, H.name, H.items, i, H.extra), val: evalParam(f.lookupValue, H.name, H.items, i, H.extra) }));
              const combine = (H.P.combineFilters ?? H.P.options?.combineFilters ?? 'AND').toUpperCase();
              rows = rows.filter(r => { const t = evald.map(f => cellEq(r[f.col], f.val)); return combine === 'OR' ? t.some(Boolean) : t.every(Boolean); });
              const all = H.P.options?.returnAllMatches ?? H.P.options?.returnFirstMatch;
              const firstOnly = all === 'returnFirstMatch' || all === false || (op === 'lookup' && H.P.options?.returnAllMatches !== true && all !== 'returnAllMatches');
              if (firstOnly) rows = rows.slice(0, 1);
            }
            for (const r of rowsOut(name, rows)) out.push(H.derive(r, H.items[i]));
          }
          H.fx({ kind: 'sheet.read', sheet: sheetName(H, 0), count: out.length });
          return [out];
        }
        if (op === 'clear') { const name = sheetName(H, 0); const s = sheetOf(H, name); s.rows = []; H.fx({ kind: 'sheet.clear', sheet: name }); return [H.pass()]; }
        if (op === 'delete') {
          const name = sheetName(H, 0); const s = sheetOf(H, name);
          const start = Number(H.param('startIndex', 0, 2)), count = Number(H.param('numberToDelete', 0, 1));
          const doomed = new Set(); for (let r = start; r < start + count; r++) doomed.add(r - 2);
          s.rows = s.rows.filter((_, k) => !doomed.has(k)); H.fx({ kind: 'sheet.delete', sheet: name, start, count }); return [H.pass()];
        }
        H.items.forEach((it, i) => {
          const name = sheetName(H, i); const s = sheetOf(H, name);
          const cols = H.P.columns ?? {};
          let row;
          const mapping = cols.mappingMode ?? (H.P.dataMode === 'autoMapInputData' ? 'autoMapInputData' : cols.value ? 'defineBelow' : 'autoMapInputData');
          if (mapping === 'defineBelow') { row = {}; for (const [k, v] of Object.entries(cols.value ?? {})) { const val = evalParam(v, H.name, H.items, i, H.extra); if (val !== undefined && val !== null) row[k] = val; } }
          else if (H.P.fieldsUi?.fieldValues) { row = {}; for (const f of H.P.fieldsUi.fieldValues) row[evalParam(f.fieldId ?? f.column, H.name, H.items, i, H.extra)] = evalParam(f.fieldValue, H.name, H.items, i, H.extra); }
          else {
            row = {};
            const extra = H.P.options?.handlingExtraData ?? (s.columns?.length ? 'ignoreIt' : 'insertInNewColumn');
            for (const [k, v] of Object.entries(it.json)) if (k !== 'row_number' && (extra === 'insertInNewColumn' || (s.columns ?? []).includes(k))) row[k] = clone(v);
          }
          for (const [k, v] of Object.entries(row)) if (v && typeof v === 'object') row[k] = JSON.stringify(v);
          const matchCol = (cols.matchingColumns ?? [])[0] ?? H.param('columnToMatchOn', i) ?? H.P.columnToMatchOn;
          const cols0 = s.columns ?? [];
          const addCols = r => { for (const k of Object.keys(r)) if (!cols0.includes(k)) cols0.push(k); s.columns = cols0; };
          if (op === 'append') { s.rows.push(row); addCols(row); H.fx({ kind: 'sheet.append', sheet: name, row: clone(row) }); out.push(H.derive(clone(row), it)); return; }
          if (op === 'update' || op === 'appendOrUpdate') {
            const key = row[matchCol] ?? H.param('valueToMatchOn', i) ?? (matchCol === 'row_number' ? it.json.row_number : undefined);
            const idx = matchCol === 'row_number' ? (Number(key) - 2 >= 0 && Number(key) - 2 < s.rows.length ? Number(key) - 2 : -1) : s.rows.findIndex(r => cellEq(r[matchCol], key));
            delete row.row_number;
            if (idx >= 0) { Object.assign(s.rows[idx], row); H.fx({ kind: 'sheet.update', sheet: name, key: String(key), row: clone(row) }); out.push(H.derive(clone({ ...s.rows[idx] }), it)); }
            else if (op === 'appendOrUpdate') { s.rows.push(row); addCols(row); H.fx({ kind: 'sheet.append', sheet: name, row: clone(row) }); out.push(H.derive(clone(row), it)); }
            else out.push(H.derive(clone(row), it));
            return;
          }
          throw new NodeError(H.name, `Google Sheets ${op} is not simulated`);
        });
        return [out];
      },
      gmail: H => {
        const op = H.P.operation ?? 'send';
        const out = [];
        if (op === 'getAll') {
          const limit = H.P.returnAll ? Infinity : Number(H.param('limit', 0, 50));
          const f = H.P.filters ?? {};
          let msgs = W.inbox.filter(m => (!f.readStatus || f.readStatus === 'both' || (f.readStatus === 'unread' ? !m.read : m.read)) && (!f.labelIds?.length || f.labelIds.every(l => (m.labelIds ?? []).includes(l))));
          const q = f.q ? String(evalParam(f.q, H.name, H.items, 0, H.extra)) : '';
          for (const term of q.split(/\s+/).filter(Boolean)) { const [k, v] = term.includes(':') ? term.split(':') : [null, term]; msgs = msgs.filter(m => k === 'from' ? String(m.From ?? m.from ?? '').toLowerCase().includes(v.toLowerCase()) : k === 'subject' ? String(m.Subject ?? '').toLowerCase().includes(v.toLowerCase()) : k === 'is' ? (v === 'unread' ? !m.read : true) : JSON.stringify(m).toLowerCase().includes(v.toLowerCase())); }
          for (const m of msgs.slice(0, limit)) out.push({ json: clone(m), lin: {} });
          return [out];
        }
        if (['addLabels', 'removeLabels', 'markAsRead', 'markAsUnread'].includes(op)) {
          H.items.forEach((it, i) => { const id = H.param('messageId', i); const m = W.inbox.find(x => x.id === id); if (m) { if (op === 'markAsRead') m.read = true; if (op === 'markAsUnread') m.read = false; const labels = H.param('labelIds', i, []); if (op === 'addLabels') m.labelIds = [...new Set([...(m.labelIds ?? []), ...labels])]; if (op === 'removeLabels') m.labelIds = (m.labelIds ?? []).filter(l => !labels.includes(l)); } H.fx({ kind: `mail.${op}`, id: String(id) }); out.push(H.derive({ id, labelIds: m?.labelIds ?? [] }, it)); });
          return [out];
        }
        H.items.forEach((it, i) => {
          const o = H.P.options ?? {};
          let to, subject;
          if (op === 'reply') { const id = H.param('messageId', i); const m = W.inbox.find(x => x.id === id); to = addrList(m?.From ?? m?.from ?? ''); subject = `Re: ${m?.Subject ?? m?.subject ?? ''}`; }
          else if (op === 'send') { to = addrList(H.param('sendTo', i)); subject = String(H.param('subject', i, '')); }
          else throw new NodeError(H.name, `Gmail ${op} is not simulated`);
          const msg = H.param('message', i, ''); const html = (H.P.emailType ?? 'html') === 'html';
          const cc = addrList(evalParam(o.ccList, H.name, H.items, i, H.extra)), bcc = addrList(evalParam(o.bccList, H.name, H.items, i, H.extra));
          if (!to.length && !cc.length && !bcc.length) throw new NodeError(H.name, 'no recipient');
          H.fx({ kind: 'mail', service: 'gmail', op, to, cc, bcc, subject, body: html ? stripHtml(msg) : String(msg ?? '') });
          out.push(H.derive({ id: genId('msg'), threadId: genId('thr'), labelIds: ['SENT'] }, it));
        });
        return [out];
      },
      emailSend: H => {
        const out = [];
        H.items.forEach((it, i) => {
          const to = addrList(H.param('toEmail', i)), cc = addrList(H.param('ccEmail', i) ?? H.param('options.ccEmail', i)), bcc = addrList(H.param('bccEmail', i) ?? H.param('options.bccEmail', i));
          const fmt = H.P.emailFormat ?? (H.ver >= 2 ? 'html' : null);
          const text = fmt === 'text' || (fmt === null && H.P.text !== undefined) ? String(H.param('text', i, '')) : fmt === 'both' ? String(H.param('text', i, '')) : stripHtml(H.param('html', i, ''));
          H.fx({ kind: 'mail', service: 'smtp', op: 'send', to, cc, bcc, subject: String(H.param('subject', i, '')), body: text });
          out.push(H.derive({ accepted: [...to, ...cc, ...bcc], messageId: `<${genId('smtp')}@sim>` }, it));
        });
        return [out];
      },
      slack: H => {
        const op = H.P.operation ?? 'post'; if (!['post', 'send'].includes(op)) throw new NodeError(H.name, `Slack ${op} is not simulated`);
        const out = [];
        H.items.forEach((it, i) => {
          const sel = H.P.select ?? 'channel';
          const rl = sel === 'user' ? H.param('user', i) : (H.param('channelId', i) ?? H.param('channel', i));
          const raw = rlValue(rl);
          const channel = binding.channels?.[H.name] ?? `#${slug(rlName(rl))}`;
          let text = String(H.param('text', i, '') ?? '');
          if ((H.P.messageType ?? 'text') === 'block') { const b = H.param('blocksUi', i); const s = typeof b === 'string' ? b : JSON.stringify(b ?? {}); text = [text, ...[...s.matchAll(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map(m => JSON.parse(`"${m[1]}"`))].filter(Boolean).join('\n'); }
          H.fx({ kind: 'chat', service: 'slack', channel, text });
          out.push(H.derive({ ok: true, channel: raw, message: { ts: genId('ts'), text } }, it));
        });
        return [out];
      },
      telegram: H => {
        const out = [];
        H.items.forEach((it, i) => {
          const raw = H.param('chatId', i); const channel = binding.channels?.[H.name] ?? `#${slug(raw)}`;
          const text = String(H.param('text', i, '') ?? '');
          const fmt = H.P.additionalFields?.parse_mode; const plain = fmt === 'HTML' ? stripHtml(text) : text;
          H.fx({ kind: 'chat', service: 'telegram', channel, text: plain });
          out.push(H.derive({ ok: true, result: { message_id: ++idCounter, chat: { id: raw }, text: plain } }, it));
        });
        return [out];
      },
      discord: H => {
        const out = [];
        H.items.forEach((it, i) => {
          const channel = binding.channels?.[H.name] ?? `#${slug(rlValue(H.param('channelId', i)) ?? 'discord')}`;
          const text = String(H.param('content', i) ?? H.param('text', i) ?? '');
          H.fx({ kind: 'chat', service: 'discord', channel, text });
          out.push(H.derive({ id: genId('dc'), content: text }, it));
        });
        return [out];
      },
    };
    function convertType(nodeName, t, v, ignore) {
      try {
        switch (t) {
          case 'number': { if (v === null || v === undefined || v === '') return v === '' ? null : v; const n = typeof v === 'number' ? v : Number(v); if (Number.isNaN(n)) throw new Error(`'${String(v).slice(0, 30)}' cannot be converted to a number`); return n; }
          case 'boolean': return typeof v === 'boolean' ? v : v === null || v === undefined ? v : ['true', '1', 'yes'].includes(String(v).toLowerCase());
          case 'array': return typeof v === 'string' ? JSON.parse(v) : v;
          case 'object': return typeof v === 'string' ? JSON.parse(v) : v;
          case 'string': return v === null || v === undefined ? v : typeof v === 'object' ? JSON.stringify(v) : String(v);
          default: return v;
        }
      } catch (e) { if (ignore) return v; throw new NodeError(nodeName, e.message); }
    }
    function mergeNode(H) {
      const a = H.inputs[0] ?? [], b = H.inputs[1] ?? [];
      const mode = H.P.mode ?? (H.ver >= 2 ? 'append' : 'append');
      const clash = H.P.options?.clashHandling?.values ?? {};
      const combine = (x, y) => {
        const pref = clash.resolveClash ?? 'preferLast';
        const deep = (clash.mergeMode ?? 'deepMerge') === 'deepMerge';
        const mergeObj = (p, q) => { if (!deep) return { ...p, ...q }; const out = clone(p); for (const [k, v] of Object.entries(q)) out[k] = isObj(out[k]) && isObj(v) ? mergeObj(out[k], v) : clone(v); return out; };
        if (pref === 'preferInput1') return { json: mergeObj(y.json, x.json), lin: { ...(y.lin ?? {}), ...(x.lin ?? {}) } };
        if (pref === 'addSuffix') { const j = {}; for (const [k, v] of Object.entries(x.json)) j[`${k}_1`] = clone(v); for (const [k, v] of Object.entries(y.json)) j[`${k}_2`] = clone(v); return { json: j, lin: { ...(x.lin ?? {}), ...(y.lin ?? {}) } }; }
        return { json: mergeObj(x.json, y.json), lin: { ...(x.lin ?? {}), ...(y.lin ?? {}) } };
      };
      if (H.ver >= 2) {
        if (mode === 'append') { const n = Number(H.P.numberInputs ?? 2); const all = []; for (let k = 0; k < n; k++) all.push(...(H.inputs[k] ?? [])); return [H.pass(all)]; }
        if (mode === 'chooseBranch') { const out = H.P.output ?? (H.ver >= 3 ? 'specifiedInput' : 'input1'); if (out === 'empty') return [[{ json: {}, lin: {} }]]; const k = out === 'input2' ? 1 : out === 'input1' ? 0 : Number(H.P.useDataOfInput ?? 1) - 1; return [H.pass(H.inputs[k] ?? [])]; }
        const by = H.ver >= 3 ? (mode === 'combine' ? (H.P.combineBy ?? 'combineByFields') : mode) : (mode === 'combine' ? (H.P.combinationMode ?? 'mergeByFields') : mode);
        if (['combineByPosition', 'mergeByPosition'].includes(by)) { const n = H.P.options?.includeUnpaired ? Math.max(a.length, b.length) : Math.min(a.length, b.length); const out = []; for (let k = 0; k < n; k++) out.push(a[k] && b[k] ? combine(a[k], b[k]) : clone(a[k] ?? b[k])); return [out]; }
        if (['combineAll', 'multiplex'].includes(by)) { const out = []; for (const x of a) for (const y of b) out.push(combine(x, y)); return [out]; }
        if (['combineByFields', 'mergeByFields'].includes(by)) {
          let pairs;
          if (H.ver >= 3 && H.P.fieldsToMatchString !== undefined && !H.P.advanced) pairs = splitList(H.P.fieldsToMatchString).map(f => ({ field1: f, field2: f }));
          else pairs = H.P.mergeByFields?.values ?? (H.P.fieldsToMatchString ? splitList(H.P.fieldsToMatchString).map(f => ({ field1: f, field2: f })) : []);
          const join = H.P.joinMode ?? 'keepMatches', outFrom = H.P.outputDataFrom ?? 'both';
          const key = (it, s) => JSON.stringify(pairs.map(p => String(get(it.json, s ? p.field2 : p.field1) ?? '')));
          const bBy = new Map(); for (const y of b) { const k = key(y, 1); if (!bBy.has(k)) bBy.set(k, []); bBy.get(k).push(y); }
          const aKeys = new Set(a.map(x => key(x, 0)));
          const out = [];
          if (join === 'keepMatches') { for (const x of a) for (const y of bBy.get(key(x, 0)) ?? []) out.push(outFrom === 'input1' ? clone(x) : outFrom === 'input2' ? clone(y) : combine(x, y)); }
          else if (join === 'keepNonMatches') { if (outFrom !== 'input2') for (const x of a) if (!bBy.has(key(x, 0))) out.push(clone(x)); if (outFrom !== 'input1') for (const y of b) if (!aKeys.has(key(y, 1))) out.push(clone(y)); }
          else if (join === 'keepEverything') { for (const x of a) { const m = bBy.get(key(x, 0)); if (m) for (const y of m) out.push(combine(x, y)); else out.push(clone(x)); } for (const y of b) if (!aKeys.has(key(y, 1))) out.push(clone(y)); }
          else if (join === 'enrichInput1') { for (const x of a) { const m = bBy.get(key(x, 0)); if (m) for (const y of m) out.push(combine(x, y)); else out.push(clone(x)); } }
          else if (join === 'enrichInput2') { const aBy = new Map(a.map(x => [key(x, 0), x])); for (const y of b) { const x = aBy.get(key(y, 1)); out.push(x ? combine(x, y) : clone(y)); } }
          return [out];
        }
        throw new NodeError(H.name, `Merge ${mode}/${by} is not simulated`);
      }
      // v1
      if (mode === 'append') return [H.pass([...a, ...b])];
      if (mode === 'passThrough') return [H.pass((H.P.output ?? 'input1') === 'input1' ? a : b)];
      if (mode === 'wait') return [[]];
      if (mode === 'mergeByIndex') { const n = (H.P.join ?? 'left') === 'inner' ? Math.min(a.length, b.length) : (H.P.join ?? 'left') === 'outer' ? Math.max(a.length, b.length) : a.length; const out = []; for (let k = 0; k < n; k++) out.push(a[k] && b[k] ? combine(a[k], b[k]) : clone(a[k] ?? b[k])); return [out]; }
      if (mode === 'multiplex') { const out = []; for (const x of a) for (const y of b) out.push(combine(x, y)); return [out]; }
      if (['mergeByKey', 'keepKeyMatches', 'removeKeyMatches'].includes(mode)) {
        const k1 = H.P.propertyName1, k2 = H.P.propertyName2; const bBy = new Map(b.map(y => [String(get(y.json, k2)), y]));
        if (mode === 'keepKeyMatches') return [a.filter(x => bBy.has(String(get(x.json, k1)))).map(clone)];
        if (mode === 'removeKeyMatches') return [a.filter(x => !bBy.has(String(get(x.json, k1)))).map(clone)];
        return [a.map(x => { const y = bBy.get(String(get(x.json, k1))); return y ? combine(x, y) : clone(x); })];
      }
      throw new NodeError(H.name, `Merge v1 ${mode} is not simulated`);
    }
    function codeNode(H, legacy = null) {
      const lang = H.P.language ?? 'javaScript'; if (lang !== 'javaScript') throw new NodeError(H.name, `Code language ${lang} is not simulated`);
      const src = legacy ? (H.P.functionCode ?? '') : (H.P.jsCode ?? '');
      const each = legacy === 'functionItem' || (!legacy && (H.P.mode ?? 'runOnceForAllItems') === 'runOnceForEachItem');
      const runOnce = (itemIndex, bind) => inRealm(RC, () => {
        Object.assign(G, dataApi(H.name, H.items, itemIndex, H.extra), typeof bind === 'function' ? bind() : bind);
        const wrapped = `(async () => {\n${src}\n})()`;
        let p;
        try { p = script(wrapped, `${H.name}:code`).runInContext(ctx, { timeout: 2000 }); } catch (e) { throw new NodeError(H.name, `code failed: ${e.message}`); }
        return p;
      });
      const norm = (r, itemIndex) => {
        let v = r;
        if (v === undefined || v === null) return [];
        v = JSON.parse(JSON.stringify(v, (k, x) => (x && typeof x === 'object' && typeof x.toISO === 'function' ? x.toISO() : x)));
        const arr = Array.isArray(v) ? v : [v];
        return arr.map((x, k) => {
          const j = isObj(x) && isObj(x.json) ? x.json : isObj(x) && 'json' in x ? (x.json ?? {}) : x;
          if (!isObj(j)) throw new NodeError(H.name, `code returned a non-object item ${JSON.stringify(j)?.slice(0, 60)}`);
          let from;
          if (isObj(x) && x.pairedItem !== undefined) { const pi = Array.isArray(x.pairedItem) ? x.pairedItem[0] : x.pairedItem; from = H.items[typeof pi === 'number' ? pi : pi?.item ?? 0]; }
          else if (itemIndex !== null) from = H.items[itemIndex];
          else if (arr.length === H.items.length) from = H.items[k];
          else if (H.items.length === 1) from = H.items[0];
          return { json: j, lin: { ...(from?.lin ?? {}) } };
        });
      };
      return (async () => {
        if (each) {
          const out = [];
          for (let i = 0; i < H.items.length; i++) {
            const r = await runOnce(i, () => { const itemObj = toCtx({ json: H.items[i].json }); return legacy === 'functionItem' ? { item: itemObj.json } : { item: itemObj }; });
            if (legacy === 'functionItem') out.push(...norm({ json: r ?? RC.G.item }, i)); else out.push(...norm(r, i));
          }
          return [out];
        }
        const r = await runOnce(0, () => ({ items: toCtx(H.items.map(it => ({ json: it.json }))) }));
        return [norm(r, null)];
      })().catch(e => { throw e instanceof NodeError ? e : new NodeError(H.name, `code failed: ${e.message}`); });
    }
    // ---- the scheduler (executionOrder v1)
    async function go() {
      const triggerName = binding.trigger ?? nodes.find(n => /Trigger$|^webhook$|^start$|^cron$|^interval$/.test(String(n.type).split('.').pop()))?.name;
      const trig = byName.get(triggerName);
      if (!trig) throw new Error(`trigger ${triggerName} not found`);
      const stack = [{ name: trig.name, inputs: [[]], from: null, fromOutside: true }];
      const waiting = new Map(); // name -> inputs array (multi-input nodes)
      const multi = name => { const b = String(byName.get(name).type).split('.').pop(); return b === 'merge' || b === 'compareDatasets'; };
      while (stack.length || waiting.size) {
        if (!stack.length) { const [name, inputs] = waiting.entries().next().value; waiting.delete(name); stack.push({ name, inputs, from: null }); }
        const job = stack.pop();
        if (++steps > maxSteps) throw new Error(`more than ${maxSteps} node executions`);
        const node = byName.get(job.name);
        const runIndex = (runs.get(job.name) ?? []).length;
        let outputs;
        const settings = { onError: node.onError ?? (node.continueOnFail ? 'continueRegularOutput' : 'stopWorkflow') };
        try { outputs = await execNode(node, job.inputs, { runIndex, prevNode: job.from, fromOutside: job.fromOutside }); }
        catch (e) {
          if (settings.onError === 'stopWorkflow' || e.stop) throw e;
          const errItem = { json: { error: String(e.message) }, lin: {} };
          outputs = settings.onError === 'continueErrorOutput' ? [[], [errItem]] : [[errItem]];
          if (settings.onError === 'continueErrorOutput') { const n = (outEdges.get(job.name) ?? []).length; outputs = Array.from({ length: Math.max(n, 2) }, (_, k) => (k === n - 1 ? [errItem] : [])); }
        }
        outputs = outputs.map(list => list ?? []);
        if (node.alwaysOutputData && outputs.every(l => !l.length)) outputs[0] = [{ json: {}, lin: {} }];
        // lineage: every output item records itself under this node's name
        for (const list of outputs) for (const it of list) it.lin = { ...(it.lin ?? {}), [job.name]: it };
        (runs.get(job.name) ?? runs.set(job.name, []).get(job.name)).push({ output: outputs });
        trace.push({ node: job.name, in: job.inputs.map(l => (l ?? []).length), out: outputs.map(l => l.length) });
        const children = [];
        (outEdges.get(job.name) ?? []).forEach((list, outIndex) => { const data = outputs[outIndex] ?? []; if (!data.length) return; for (const t of list) children.push({ t, data }); });
        children.sort((x, y) => { const [ya, xa] = pos(x.t.node), [yb, xb] = pos(y.t.node); return ya - yb || xa - xb; });
        const pushes = [];
        for (const { t, data } of children) {
          const copy = data.map(it => ({ json: clone(it.json), lin: it.lin }));
          if (multi(t.node)) {
            const want = [...(inCount.get(t.node) ?? new Set([0]))];
            const w = waiting.get(t.node) ?? Array.from({ length: Math.max(...want) + 1 }, () => null);
            w[t.index ?? 0] = [...(w[t.index ?? 0] ?? []), ...copy];
            if (want.every(k => w[k] !== null)) { waiting.delete(t.node); pushes.push({ name: t.node, inputs: w.map(x => x ?? []), from: job.name }); }
            else waiting.set(t.node, w);
          } else pushes.push({ name: t.node, inputs: [copy], from: job.name });
        }
        for (const p of pushes.reverse()) stack.push(p);
      }
    }
    return go().then(() => ({ ok: true, effects, trace, sheets: W.sheets, seen: W.seen, staticData: W.staticData, steps }),
      e => ({ ok: false, error: { node: e.node ?? null, message: String(e.message).slice(0, 500) }, effects, trace, sheets: W.sheets, steps }));
  }
  return { run };
}
