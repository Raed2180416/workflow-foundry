// assemble.mjs: typed slot values -> solve.mjs (LIBRARY §5.1 S7; BUILD-ORDER step 3). The constructor never writes
// control flow: it fills a card's typed slots, and this module checks each value against the card's slot schema and
// renders it as code (JSON literals, path accessors, linted fn:pure bodies). The skeleton itself is copied verbatim.
//
//   const { source } = assemble({ parts: [{ card: loadCard('P07'), slots: {...} }], budgetUsd: 0.5 });
//
// A solver is the card fragments run in order: x = task.inputs; x = await Pxx_0(flow, task, x, S0); ...; flow.done(x).
// Slot types (L1-PATTERNS §3): enum (enum[]), schema, path, fn (fn:pure), judge, hash, int (int[a,b]), number, numbers,
// usd, choice (one of the card's options), bool, name, map ({key: fn | hash}), list (of typed objects).
// Findings carry codes. Generic type errors are SLOT_*; three slot-level errors are composition-checker codes because
// that is what they are: a hash slot that is not a literal library hash (MUTABLE_TARGET), a bounded int slot that is not a
// literal in range (UNBOUNDED), a judge tier outside policy/models.json (SLOT_TIER).
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const POLICY = JSON.parse(readFileSync(new URL('../../policy/models.json', import.meta.url), 'utf8'));
export const POLICY_MODELS = Object.freeze(POLICY.models.map(m => m.id));
export const HELPERS_SOURCE = readFileSync(new URL('./skeletons/helpers.mjs', import.meta.url), 'utf8');
export const HASH_RE = /^sha256:[0-9a-f]{64}$/;
const PATH_RE = /^(inputs|x|files)((\.[A-Za-z_$][\w$]*)|(\[\d+\]))*$/;
const NAME_RE = /^[a-z][a-z0-9-]{0,39}$/;
// Capabilities a fn:pure body may not touch (escape hatches out of "pure"); effects (fetch, fs, http) are left to the
// composition checker's EFFECT_IN_SOLVER, loops to its UNBOUNDED.
export const FORBIDDEN_IN_FN = /\b(flow|process|require|import|eval|Function|globalThis|global|constructor|__proto__|prototype|await|async|setTimeout|setInterval|setImmediate|queueMicrotask|Reflect|Proxy|WebAssembly|Atomics|SharedArrayBuffer)\b/;
const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
const sha = s => createHash('sha256').update(s).digest('hex');

export function lintFn(src) {
  if (typeof src !== 'string' || !src.trim()) return { code: 'SLOT_TYPE', detail: 'fn:pure must be source text' };
  if (!/^\s*(\(|[A-Za-z_$][\w$]*\s*=>|function\b)/.test(src)) return { code: 'SLOT_SYNTAX', detail: 'fn:pure must be an arrow function or function expression' };
  try { new vm.Script(`(${src}\n)`); } catch (e) { return { code: 'SLOT_SYNTAX', detail: String(e.message).slice(0, 200) }; }
  try { if (typeof vm.runInNewContext(`(${src}\n)`, Object.create(null), { timeout: 1000 }) !== 'function') return { code: 'SLOT_SYNTAX', detail: 'not a function' }; } catch (e) { return { code: 'SLOT_SYNTAX', detail: String(e.message).slice(0, 200) }; }
  const m = src.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""').match(FORBIDDEN_IN_FN);
  if (m) return { code: 'SLOT_FORBIDDEN', detail: `fn:pure uses ${m[1]}` };
  return null;
}

// Check one slot value against its definition. Returns findings [{code, slot, detail}].
export function checkSlot(def, value, at = def.name) {
  const out = [], bad = (code, detail) => out.push({ code, slot: at, detail });
  const t = def.type;
  if (t === 'enum') {
    if (!Array.isArray(value) || !value.length || value.some(v => typeof v !== 'string' || !v)) bad('SLOT_TYPE', 'enum[] must be a non-empty list of strings');
    else if (new Set(value).size !== value.length) bad('SLOT_TYPE', 'enum[] has duplicates');
    else if ((def.min && value.length < def.min) || (def.max && value.length > def.max)) bad('SLOT_TYPE', `enum[] length outside [${def.min ?? 1}, ${def.max ?? '∞'}]`);
  } else if (t === 'schema') { if (!isObj(value)) bad('SLOT_TYPE', 'schema must be an object'); }
  else if (t === 'path') { if (typeof value !== 'string' || !PATH_RE.test(value)) bad('SLOT_TYPE', 'path must be inputs.<a>.<b> | x.<a> | files.<name>'); }
  else if (t === 'fn') { const e = lintFn(value); if (e) bad(e.code, e.detail); }
  else if (t === 'hash') { if (typeof value !== 'string' || !HASH_RE.test(value)) bad('MUTABLE_TARGET', 'a call target must be a literal library hash (sha256:…)'); }
  else if (t === 'int') {
    const [lo, hi] = def.range ?? [-Infinity, Infinity];
    if (!Number.isInteger(value) || value < lo || value > hi) bad(def.bound ? 'UNBOUNDED' : 'SLOT_TYPE', `int[${lo},${hi}] literal required`);
  } else if (t === 'number' || t === 'usd') {
    const [lo, hi] = def.range ?? (t === 'usd' ? [0.001, 5] : [-Infinity, Infinity]);
    if (typeof value !== 'number' || !Number.isFinite(value) || value < lo || value > hi) bad('SLOT_TYPE', `${t} in [${lo},${hi}] required`);
  } else if (t === 'numbers') {
    const [lo, hi] = def.range ?? [-Infinity, Infinity];
    if (!Array.isArray(value) || (def.length && value.length !== def.length) || value.some(v => typeof v !== 'number' || v < lo || v > hi)) bad('SLOT_TYPE', `numbers[${def.length ?? ''}] in [${lo},${hi}] required`);
    else if (def.ascending && value.some((v, i) => i && v < value[i - 1])) bad('SLOT_TYPE', 'numbers must ascend');
  } else if (t === 'choice') { if (!def.options.includes(value)) bad('SLOT_TYPE', `one of ${def.options.join(' | ')}`); }
  else if (t === 'bool') { if (typeof value !== 'boolean') bad('SLOT_TYPE', 'bool required'); }
  else if (t === 'name') { if (typeof value !== 'string' || !NAME_RE.test(value)) bad('SLOT_TYPE', 'name must match [a-z][a-z0-9-]{0,39}'); }
  else if (t === 'judge') {
    if (!isObj(value)) bad('SLOT_TYPE', 'judge spec must be an object');
    else {
      const fields = def.fields ?? ['tiers', 'system', 'prompt', 'schema'];
      if (!Array.isArray(value.tiers) || !value.tiers.length) bad('SLOT_TYPE', 'judge.tiers must be a non-empty list');
      else for (const m of value.tiers) if (!POLICY_MODELS.includes(m)) bad('SLOT_TIER', `tier ${m} is not in policy/models.json`);
      if (typeof value.system !== 'string') bad('SLOT_TYPE', 'judge.system must be text');
      if (fields.includes('prompt')) { const e = lintFn(value.prompt); if (e) bad(e.code, `judge.prompt: ${e.detail}`); }
      else if (value.prompt != null) bad('SLOT_TYPE', 'judge.prompt is built by the skeleton for this slot');
      if (fields.includes('schema')) { if (!isObj(value.schema)) bad('SLOT_TYPE', 'judge.schema must be an object'); }
      else if (value.schema != null) bad('SLOT_TYPE', 'judge.schema is built by the skeleton for this slot');
      if (value.check != null) { const e = lintFn(value.check); if (e) bad(e.code, `judge.check: ${e.detail}`); }
      if (value.samples != null && !(Number.isInteger(value.samples) && value.samples >= 1 && value.samples <= 5)) bad('UNBOUNDED', 'judge.samples must be an int in [1,5]');
      for (const k of Object.keys(value)) if (!['tiers', 'system', 'prompt', 'schema', 'check', 'samples'].includes(k)) bad('SLOT_TYPE', `judge.${k} is not a judge field`);
    }
  } else if (t === 'map') {
    if (!isObj(value) || !Object.keys(value).length) bad('SLOT_TYPE', 'map must be a non-empty object');
    else for (const [k, v] of Object.entries(value)) {
      if (typeof v === 'string' && v.startsWith('sha256:') || def.values?.length === 1 && def.values[0] === 'hash') out.push(...checkSlot({ type: 'hash' }, v, `${at}.${k}`));
      else out.push(...checkSlot({ type: 'fn' }, v, `${at}.${k}`));
    }
  } else if (t === 'list') {
    if (!Array.isArray(value)) bad('SLOT_TYPE', 'list required');
    else {
      if ((def.min && value.length < def.min) || (def.max && value.length > def.max)) bad(def.bound ? 'UNBOUNDED' : 'SLOT_TYPE', `list length outside [${def.min ?? 0}, ${def.max ?? '∞'}]`);
      value.forEach((item, i) => {
        if (!isObj(item)) { bad('SLOT_TYPE', `${at}[${i}] must be an object`); return; }
        for (const [k, sub] of Object.entries(def.item)) {
          const need = sub.required === true || (sub.requiredWhen && Object.entries(sub.requiredWhen).every(([f, v]) => item[f] === v));
          if (item[k] == null) { if (need) bad('SLOT_MISSING', `${at}[${i}].${k}`); continue; }
          out.push(...checkSlot({ ...sub, name: k }, item[k], `${at}[${i}].${k}`));
        }
        for (const k of Object.keys(item)) if (!(k in def.item)) bad('SLOT_UNKNOWN', `${at}[${i}].${k}`);
      });
    }
  } else bad('SLOT_TYPE', `unknown slot type ${t}`);
  return out;
}

// All slots of one card instance: missing, unknown, and per-slot findings. Defaults are applied first.
export function checkSlots(card, slots = {}) {
  const findings = [], values = withDefaults(card, slots);
  for (const def of card.slots) {
    if (values[def.name] == null) { if (def.required) findings.push({ code: 'SLOT_MISSING', slot: def.name, detail: `${card.id}.${def.name} is required` }); continue; }
    findings.push(...checkSlot(def, values[def.name]));
  }
  for (const k of Object.keys(slots)) if (!card.slots.some(d => d.name === k)) findings.push({ code: 'SLOT_UNKNOWN', slot: k, detail: `${card.id} has no slot ${k}` });
  return findings.map(f => ({ card: card.id, ...f }));
}
export const withDefaults = (card, slots = {}) => Object.fromEntries(card.slots.map(d => [d.name, slots[d.name] !== undefined ? slots[d.name] : d.default ?? null]));

// ---- rendering (values are assumed checked) ----
const lit = v => JSON.stringify(v);
const renderPath = p => {
  const [root, ...rest] = p.split(/(?=[.[])/);
  const base = root === 'x' ? 'x' : root === 'files' ? 'task.files' : 'task.inputs';
  return `((task, x) => ${base}${rest.join('')})`;
};
export function renderValue(def, v) {
  if (v == null) return 'null';
  switch (def.type) {
    case 'fn': return `(${v}\n)`;
    case 'path': return renderPath(v);
    case 'judge': return `{ tiers: ${lit(v.tiers)}, system: ${lit(v.system)}${v.prompt != null ? `, prompt: (${v.prompt}\n)` : ''}${v.schema != null ? `, schema: ${lit(v.schema)}` : ''}${v.check != null ? `, check: (${v.check}\n)` : ''}${v.samples != null ? `, samples: ${v.samples}` : ''} }`;
    case 'map': return `{ ${Object.entries(v).map(([k, x]) => `${lit(k)}: ${typeof x === 'string' && x.startsWith('sha256:') ? lit(x) : `(${x}\n)`}`).join(', ')} }`;
    case 'list': return `[\n${v.map(item => `    { ${Object.entries(item).filter(([, x]) => x != null).map(([k, x]) => `${k}: ${renderValue({ ...def.item[k], name: k }, x)}`).join(', ')} }`).join(',\n')}\n  ]`;
    default: return lit(v);
  }
}
export const renderSlots = (card, values) => `{\n${card.slots.map(d => `  ${d.name}: ${renderValue(d, values[d.name])}`).join(',\n')}\n}`;

// The skeleton's fragment, renamed per instance: `export default async function P07(` -> `async function P07_0(`.
export function fragmentOf(card, i) {
  const re = new RegExp(`export default async function ${card.id}\\(`);
  if (!re.test(card.skeleton)) throw new Error(`assemble: ${card.id}/skeleton.mjs must contain "export default async function ${card.id}(flow, task, x, S)"`);
  return card.skeleton.replace(re, `async function ${card.id}_${i}(`);
}

// parts: [{card (loadCard result), slots}]. Throws SLOT_INVALID with the findings unless { force: true } (used by the
// checker's mutant tests, which want the findings, not a refusal).
export function assemble({ parts, budgetUsd = 0.5, autoFlag = null, force = false } = {}) {
  if (!Array.isArray(parts) || !parts.length) throw new Error('assemble: at least one part');
  const findings = parts.flatMap(p => checkSlots(p.card, p.slots).map(f => ({ part: parts.indexOf(p), ...f })));
  if (findings.length && !force) { const e = new Error(`assemble: ${findings.length} slot finding(s): ${findings.slice(0, 3).map(f => `${f.code} ${f.card}.${f.slot}`).join('; ')}`); e.code = 'SLOT_INVALID'; e.findings = findings; throw e; }
  const flag = autoFlag ?? parts.some(p => p.card.flow?.autoFlag);
  const helpers = HELPERS_SOURCE.replace(/^export /gm, '');
  const body = [
    `// solve.mjs assembled by experiments/library/assemble.mjs from L1 cards ${parts.map(p => `${p.card.id}@v${p.card.version ?? 1}`).join(', ')}.`,
    `// Skeletons are copied verbatim; slot values are rendered by code from typed, checked values.`,
    `import { createFlow } from './tools/flow.mjs';`, '', '// ---- helpers (skeletons/helpers.mjs) ----', helpers,
    ...parts.map((p, i) => `// ---- ${p.card.id} skeleton (sha256 ${p.card.skeletonSha256.slice(0, 16)}) ----\n${fragmentOf(p.card, i)}`),
    ...parts.map((p, i) => `const S${i} = ${renderSlots(p.card, withDefaults(p.card, p.slots))};`),
    '', `const flow = createFlow({ budgetUsd: ${lit(budgetUsd)}${flag ? ', autoFlag: true' : ''} });`, 'const task = flow.input();', 'let x = task.inputs;',
    ...parts.map((p, i) => `x = await ${p.card.id}_${i}(flow, task, x, S${i});`), 'flow.done(x);', '',
  ];
  const source = body.join('\n');
  return { source, sha256: sha(source), findings, cards: parts.map(p => ({ id: p.card.id, version: p.card.version ?? 1, skeletonSha256: p.card.skeletonSha256 })) };
}

// Replace symbolic references ("@child:<name>") in slot values by the hashes a runner registered.
export function resolveRefs(value, refs) {
  if (typeof value === 'string' && value.startsWith('@child:')) { const h = refs[value.slice(7)]; if (!h) throw new Error(`assemble: unknown child ${value}`); return h; }
  if (Array.isArray(value)) return value.map(v => resolveRefs(v, refs));
  if (isObj(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, refs)]));
  return value;
}
