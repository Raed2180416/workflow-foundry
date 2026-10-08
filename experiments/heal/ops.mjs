// PATCH OPERATIONS (DESIGN §7.1): a closed set of typed edits on the workflow IR. A model proposes ops as data; this module
// validates them, compiles them to a candidate workflow on the frozen schema, and records the proofs/waivers they carry.
// There is NO operation for deleting a check or node, weakening acceptance, loosening a gate, declassifying labels, changing
// the input schema, adding tools, or lowering escalation: scan.mjs rejects any such change in any form (V2).
import { clone, canonical, digest, refsIn, nodeRef, isRef, cloneGroups } from './ir.mjs';

export const MAX_OPS = 6;
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/, IDENT = /^[a-z][a-z0-9_]{0,40}$/, REF = /^(input|item|nodes)(\.[A-Za-z0-9_-]+)+$/;
const CLASSES = ['S', 'M', 'L', 'F'];

// ---- field validators --------------------------------------------------------------------------------------------------
const V = {
  id: x => typeof x === 'string' && ID.test(x), ident: x => typeof x === 'string' && IDENT.test(x), ref: x => typeof x === 'string' && REF.test(x),
  int: (lo, hi) => x => Number.isInteger(x) && x >= lo && x <= hi, text: n => x => typeof x === 'string' && x.trim().length > 0 && x.length <= n,
  oneOf: list => x => list.includes(x), ids: x => Array.isArray(x) && x.length <= 12 && x.every(V.ident),
  json: n => x => { if (typeof x !== 'string' || x.length > n) return false; try { JSON.parse(x); return true; } catch { return false; } },
  strs: n => x => Array.isArray(x) && x.length <= 12 && x.every(s => typeof s === 'string' && s.length <= n),
};
const where = { node: V.id, in: V.id };   // `in`: the map/loop that holds a body node

// op -> { fields: {name: [validator, required]}, review, kind }.  kind: guard | fix | relax | allocator | debt | probe
export const OPS = Object.freeze({
  add_evidence_field: { kind: 'guard', fields: { ...req(where), field: [V.ident, 1], maxLength: [V.int(16, 600), 1], instruction: [V.text(1200), 1], source: [V.ref, 1] } },
  k_sample_agreement: { kind: 'allocator', fields: { ...req(where), k: [V.oneOf([2, 3]), 1], compare: [V.ids, 0], onDisagree: [V.oneOf(['escalate', 'fail']), 1] } },
  escalate_class: { kind: 'allocator', fields: { ...req(where), class: [V.oneOf(CLASSES), 1], maxClass: [V.oneOf(CLASSES), 0], justification: [V.text(600), 1] } },
  add_check: { kind: 'guard', fields: { ...req(where), conditionJson: [V.json(4000), 1] } },
  tighten_check: { kind: 'guard', fields: { ...req(where), index: [V.int(0, 50), 1], conditionJson: [V.json(4000), 1] } },
  relax_check: { kind: 'relax', fields: { ...req(where), target: [V.oneOf(['check', 'source']), 1], index: [V.int(0, 50), 0], conditionJson: [V.json(4000), 0], source: [V.text(60000), 0],
    justificationQuote: [V.text(600), 1], excerptId: [V.text(80), 1], battery: [V.oneOf(['python-signature']), 0], justifiedClass: [V.oneOf(['default-value-changed']), 0], falsePositiveRuns: [V.strs(80), 0] } },
  patch_code_node: { kind: 'fix', fields: { node: [V.id, 1], source: [V.text(60000), 1], assertionTrial: [V.text(120), 1], assertionPath: [V.text(80), 1], assertionEqualsJson: [V.json(400), 1] } },
  edit_instructions: { kind: 'fix', fields: { ...req(where), mode: [V.oneOf(['append', 'replace_sentence']), 1], old: [V.text(1200), 0], text: [typeof_text(1200), 1] } },
  add_probe: { kind: 'probe', fields: { probeKind: [V.oneOf(['fragility', 'value_coverage', 'documented_legal_edit']), 1], specJson: [V.json(4000), 1] } },
  gate_verify: { kind: 'debt', fields: { node: [V.id, 1] } },
  gate_failed_count: { kind: 'debt', fields: { node: [V.id, 1] } },
  gate_continuation: { kind: 'debt', fields: { node: [V.id, 1] } },
  strengthen_acceptance: { kind: 'debt', fields: { via: [V.oneOf(['verify', 'check']), 1], node: [V.id, 0], conditionJson: [V.json(4000), 0] } },
});
function req(spec) { return Object.fromEntries(Object.entries(spec).map(([k, f]) => [k, [f, k === 'node' ? 1 : 0]])); }
function typeof_text(n) { return x => typeof x === 'string' && x.length <= n; }   // may be empty (a sentence removal)

export const FORBIDDEN_OP_NAMES = Object.freeze(['delete_check', 'delete_node', 'remove_check', 'remove_node', 'weaken_acceptance', 'relax_acceptance', 'declassify', 'set_oracle', 'disable_gate', 'lower_escalation', 'add_tool', 'change_input_schema']);
// Which ops each defect class may use (DESIGN §7.1 "Fixes"); model variance may only touch allocation.
export const ALLOWED_BY_CLASS = Object.freeze({
  UNGUARDED_GLOBAL_READ: ['add_evidence_field', 'k_sample_agreement', 'escalate_class', 'edit_instructions', 'add_check', 'add_probe'],
  UNGUARDED_ITEM_READ: ['add_evidence_field', 'k_sample_agreement', 'escalate_class', 'edit_instructions', 'add_check', 'tighten_check', 'add_probe'],
  CHECK_ESCAPE_HATCH: ['tighten_check', 'add_check', 'add_evidence_field', 'k_sample_agreement', 'escalate_class', 'add_probe'],
  OVERSTRICT_CHECK: ['relax_check', 'edit_instructions', 'add_probe'],
  CODE_NODE_SENSITIVE: ['patch_code_node', 'add_check', 'add_probe'],
  'model-variance': ['k_sample_agreement', 'escalate_class'],
  'lint-debt': ['gate_verify', 'gate_failed_count', 'gate_continuation', 'strengthen_acceptance'],
});
export const allowedOpsFor = (classes, { allocatorOnly = false } = {}) => allocatorOnly ? ALLOWED_BY_CLASS['model-variance'] : [...new Set(classes.flatMap(c => ALLOWED_BY_CLASS[c] ?? []))];

export function validateOp(op) {
  const problems = [];
  if (!op || typeof op !== 'object' || Array.isArray(op)) return ['op must be an object'];
  if (FORBIDDEN_OP_NAMES.includes(op.op)) return [`HEAL_FORBIDDEN_OP: ${op.op} does not exist`];
  const spec = OPS[op.op];
  if (!spec) return [`HEAL_OP_UNKNOWN: ${String(op.op).slice(0, 40)}`];
  for (const k of Object.keys(op)) if (k !== 'op' && !spec.fields[k]) problems.push(`${k}: not a field of ${op.op}`);
  for (const [k, [check, required]] of Object.entries(spec.fields)) {
    if (op[k] === undefined || op[k] === null) { if (required) problems.push(`${k}: required`); continue; }
    if (!check(op[k])) problems.push(`${k}: invalid`);
  }
  return problems;
}

// ---- IR access ---------------------------------------------------------------------------------------------------------
export class OpError extends Error { constructor(code, message, op) { super(message); this.code = code; this.op = op; } }
const fail = (code, message, op) => { throw new OpError(code, message, op); };
export const locusIdOf = op => op.in ? `${op.in}/${op.node}` : op.node;
function target(wf, op) {
  const holder = op.in ? wf.nodes.find(n => n.id === op.in)?.body : wf;
  const node = holder?.nodes?.find(n => n.id === op.node);
  if (!node) fail('HEAL_OP_INVALID', `no node ${locusIdOf(op)}`, op);
  return node;
}
const agent = (n, op) => { if (n.kind !== 'agent') fail('HEAL_OP_INVALID', `${locusIdOf(op)} is a ${n.kind}, not an agent`, op); return n; };
const condition = (json, op) => {
  const c = JSON.parse(json), ok = x => x && typeof x === 'object' && (['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains'].includes(x.op) ? 'left' in x && 'right' in x : x.op === 'exists' ? 'value' in x
    : ['all', 'any'].includes(x.op) ? Array.isArray(x.conditions) && x.conditions.length > 0 && x.conditions.every(ok) : x.op === 'not' ? ok(x.condition) : false);
  if (!ok(c)) fail('HEAL_OP_INVALID', 'conditionJson is not a structured condition', op);
  return c;
};
const nextClass = (order, cls) => order[order.indexOf(cls) + 1] ?? null;

const agreeSource = (names, fields) => `// heal: k-sample agreement over ${names.length} independent reads of one node
const FIELDS = ${JSON.stringify(fields)};
const norm = v => Array.isArray(v) ? v.map(norm).map(x => JSON.stringify(x)).sort() : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, norm(v[k])])) : v;
const key = o => JSON.stringify(norm(FIELDS.length ? Object.fromEntries(FIELDS.map(f => [f, o?.[f]])) : o));
export default function main(input) {
  const reads = ${JSON.stringify(names.map((_, i) => 'abc'[i]))}.map(n => input[n]);
  const groups = new Map();
  for (const r of reads) { const k = key(r); const g = groups.get(k) ?? { n: 0, v: r }; g.n++; groups.set(k, g); }
  const best = [...groups.values()].sort((a, b) => b.n - a.n)[0];
  const disagreements = FIELDS.length ? FIELDS.filter(f => new Set(reads.map(r => JSON.stringify(norm(r?.[f])))).size > 1) : (groups.size > 1 ? ['*'] : []);
  return { agreed: best.n >= 2, unanimous: groups.size === 1, value: best.v, disagreements };
}
`;

// ---- apply: one function per op; each mutates the cloned workflow and returns what it touched ------------------------
const APPLY = {
  add_evidence_field(wf, op) {
    const n = agent(target(wf, op), op);
    if (!(n.context?.inputs ?? []).some(i => i.ref === op.source)) fail('HEAL_OP_INVALID', `source ${op.source} is not a context input of ${locusIdOf(op)}`, op);
    if (n.returns?.properties?.[op.field]) fail('HEAL_OP_INVALID', `field ${op.field} already exists`, op);
    n.returns = { ...n.returns, properties: { ...n.returns.properties, [op.field]: { type: 'string', minLength: 8, maxLength: op.maxLength } }, required: [...(n.returns.required ?? []), op.field] };
    n.instructions = `${n.instructions}\n${op.instruction.trim()}`;
    n.checks = [...(n.checks ?? []), { op: 'contains', left: { $ref: op.source }, right: { $ref: `output.${op.field}` } }];
    return { touched: [locusIdOf(op)] };
  },
  // The ORIGINAL id moves to the final pick node, so every downstream reference, `needs` and check keeps working untouched; the
  // original read becomes reader 1 (same prompt, so its recorded calls still replay) and siblings get a distinct reader tag (P-2).
  k_sample_agreement(wf, op, env) {
    const holder = op.in ? wf.nodes.find(n => n.id === op.in)?.body : wf, n = holder?.nodes?.find(x => x.id === op.node);
    if (!n) fail('HEAL_OP_INVALID', `no node ${locusIdOf(op)}`, op);
    agent(n, op);
    const reads = ['a', 'b', 'c'].slice(0, op.k), s1 = `${op.node}__s1`, sibs = Array.from({ length: op.k - 1 }, (_, i) => `${op.node}__s${i + 2}`), agree = `${op.node}__agree`;
    if ([s1, ...sibs, agree].some(id => holder.nodes.some(x => x.id === id))) fail('HEAL_OP_INVALID', `${op.node} already has a k-sample structure`, op);
    // An explicit onCheckFail "escalate" is the runtime default; a copy with no checks would only trip ESCALATION_WITHOUT_CHECKS, so the
    // copies drop the redundant setting (behaviour-neutral: the default is the same).
    const dup = (extra = {}) => { const c = { ...clone(n), ...extra }; if (c.escalation?.onCheckFail === 'escalate' && !(c.checks ?? []).length) { const { onCheckFail, maxResamples, ...rest } = c.escalation; c.escalation = rest; } return c; };
    const first = { ...dup(), id: s1, description: `Independent read 1 of ${op.k} of ${op.node}.` };
    const created = [first];
    sibs.forEach((id, i) => created.push({ ...dup(), id, description: `Independent read ${i + 2} of ${op.k} of ${op.node}.`, instructions: `${n.instructions}\n\nIndependent reader ${i + 2} of ${op.k}: read the input afresh and answer on your own.` }));
    created.push({ id: agree, kind: 'code', lang: 'js', needs: [s1, ...sibs], description: `Agreement of ${op.k} independent reads of ${op.node}.`,
      args: Object.fromEntries([s1, ...sibs].map((id, i) => [reads[i], { $ref: `nodes.${id}` }])), source: agreeSource([s1, ...sibs], op.compare ?? []), timeoutMs: 20000 });
    const cls = n.model.class ?? env.classOf?.(n.model.id), top = n.model.maxClass ?? cls;
    let pickNeeds = [agree];
    const args = { agree: { $ref: `nodes.${agree}` } };
    if (op.onDisagree === 'escalate') {
      const esc = `${op.node}__esc`, to = top !== cls ? top : nextClass(env.classOrder, cls);
      if (!to) fail('HEAL_OP_INVALID', `${op.node} has no stronger class to escalate to`, op);
      created.push({ ...dup(), id: esc, needs: [...new Set([...(n.needs ?? []), agree])], description: `Stronger read of ${op.node} when the independent reads disagree.`, model: { class: to, maxClass: to },
        when: { op: 'eq', left: { $ref: `nodes.${agree}.agreed` }, right: false } });
      pickNeeds = [agree, esc]; args.esc = { $ref: `nodes.${esc}`, default: null };
    } else {
      const ok = `${op.node}__ok`;
      created.push({ id: ok, kind: 'assert', needs: [agree], description: `The independent reads of ${op.node} must agree.`, checks: [{ op: 'eq', left: { $ref: `nodes.${agree}.agreed` }, right: true }] });
      pickNeeds = [agree, ok];
    }
    created.push({ id: op.node, kind: 'code', lang: 'js', needs: pickNeeds, join: 'all_resolved', description: `The agreed (or escalated) value of ${op.node}.`, args,
      source: `export default function main(input) { return input.esc ?? input.agree.value; }\n`, timeoutMs: 10000 });
    const at = holder.nodes.indexOf(n);
    holder.nodes.splice(at, 1, ...created);
    wf.budget = { ...wf.budget, maxSteps: Math.max(wf.budget.maxSteps, wf.nodes.length * 4) };
    // The escalated read starts above the workflow default by design of this operation: the justification travels with the proposal.
    const waivers = op.onDisagree === 'escalate' ? [{ code: 'CLASS_ABOVE_DEFAULT_UNJUSTIFIED', node: `${op.node}__esc`, justification: `escalated read of ${op.node}, run only when the independent reads disagree` }] : [];
    return { touched: [locusIdOf(op)], created: created.map(c => c.id).filter(id => id !== op.node), waivers };
  },
  escalate_class(wf, op, env) {
    const n = agent(target(wf, op), op), cls = n.model.class ?? env.classOf?.(n.model.id);
    if (!cls || CLASSES.indexOf(op.class) <= CLASSES.indexOf(cls)) fail('HEAL_OP_INVALID', `${locusIdOf(op)} already starts at ${cls}; class must go up`, op);
    const top = [op.maxClass ?? op.class, n.model.maxClass ?? cls, op.class].sort((a, b) => CLASSES.indexOf(b) - CLASSES.indexOf(a))[0];
    const { id, ...rest } = n.model;   // an explicit model id would pin the old class
    n.model = { ...rest, class: op.class, maxClass: top };
    return { touched: [locusIdOf(op)], waivers: [{ code: 'CLASS_ABOVE_DEFAULT_UNJUSTIFIED', node: locusIdOf(op), justification: op.justification }] };
  },
  add_check(wf, op) {
    const n = target(wf, op), c = condition(op.conditionJson, op);
    if (n.kind === 'agent') { n.checks = [...(n.checks ?? []), c]; return { touched: [locusIdOf(op)] }; }
    if (op.in) fail('HEAL_OP_INVALID', 'a code node inside a body cannot get an assert node', op);
    const id = `${op.node}__assert`;
    if (wf.nodes.some(x => x.id === id)) fail('HEAL_OP_INVALID', `${id} exists`, op);
    wf.nodes.push({ id, kind: 'assert', needs: [op.node], description: `Added check on ${op.node}.`, checks: [c] });
    return { touched: [op.node], created: [id] };
  },
  tighten_check(wf, op) {
    const n = agent(target(wf, op), op), old = n.checks?.[op.index];
    if (!old) fail('HEAL_OP_INVALID', `${locusIdOf(op)} has no check ${op.index}`, op);
    const next = condition(op.conditionJson, op);
    n.checks = n.checks.map((c, i) => i === op.index ? next : c);
    return { touched: [locusIdOf(op)], proofs: [{ type: 'tighten', node: locusIdOf(op), index: op.index, old, new: next, returns: n.returns }] };
  },
  relax_check(wf, op) {
    const n = target(wf, op);
    let before, after;
    if (op.target === 'check') {
      agent(n, op);
      if (!op.conditionJson || op.index === undefined || !n.checks?.[op.index]) fail('HEAL_OP_INVALID', 'relax_check on a condition needs index and conditionJson', op);
      before = n.checks[op.index]; after = condition(op.conditionJson, op); n.checks = n.checks.map((c, i) => i === op.index ? after : c);
    } else {
      if (!['code', 'verify'].includes(n.kind) || typeof n.source !== 'string' || !op.source) fail('HEAL_OP_INVALID', 'relax_check on source needs a code node and source', op);
      before = n.source; after = op.source;
      const group = cloneGroups(wf).find(g => g.includes(op.node)) ?? [op.node];
      for (const id of group) { const m = wf.nodes.find(x => x.id === id); if (m && m.source === before) m.source = after; }   // a clone group is one locus
    }
    return { touched: op.target === 'source' ? (cloneGroups(wf).find(g => g.includes(op.node)) ?? [op.node]) : [locusIdOf(op)], proofs: [{ type: 'relax', node: locusIdOf(op), target: op.target, before, after, quote: op.justificationQuote, excerptId: op.excerptId, battery: op.battery ?? null,
      justifiedClass: op.justifiedClass ?? null, falsePositiveRuns: op.falsePositiveRuns ?? [], lang: n.lang ?? null }] };
  },
  patch_code_node(wf, op) {
    const n = wf.nodes.find(x => x.id === op.node);
    if (!n || !(n.kind === 'code' || (n.kind === 'verify' && n.method === 'code'))) fail('HEAL_OP_INVALID', `no code node ${op.node}`, op);
    const before = n.source, group = cloneGroups(wf).find(g => g.includes(op.node)) ?? [op.node];
    for (const id of group) { const m = wf.nodes.find(x => x.id === id); if (m.source === before) m.source = op.source; }
    return { touched: group, proofs: [{ type: 'patch', node: op.node, before, after: op.source, lang: n.lang, assertion: { trial: op.assertionTrial, path: op.assertionPath, equals: JSON.parse(op.assertionEqualsJson) } }] };
  },
  edit_instructions(wf, op) {
    const n = agent(target(wf, op), op);
    if (op.mode === 'append') { if (!op.text.trim()) fail('HEAL_OP_INVALID', 'append needs text', op); n.instructions = `${n.instructions}\n${op.text.trim()}`; }
    else {
      if (!op.old || !n.instructions.includes(op.old)) fail('HEAL_OP_INVALID', 'replace_sentence: the quoted sentence is not in the instructions verbatim', op);
      if (n.instructions.split(op.old).length > 2) fail('HEAL_OP_INVALID', 'replace_sentence: the quoted sentence occurs more than once', op);
      n.instructions = n.instructions.replace(op.old, () => op.text);
    }
    return { touched: [locusIdOf(op)] };
  },
  add_probe(wf, op) { return { touched: [], probes: [{ kind: op.probeKind, spec: JSON.parse(op.specJson) }] }; },
  gate_verify(wf, op) {
    const n = wf.nodes.find(x => x.id === op.node);
    if (n?.kind !== 'verify') fail('HEAL_OP_INVALID', `${op.node} is not a verify node`, op);
    n.gate = true; return { touched: ['@acceptance', op.node] };
  },
  gate_failed_count(wf, op) {
    const n = wf.nodes.find(x => x.id === op.node);
    if (n?.kind !== 'map' || n.failure !== 'collect') fail('HEAL_OP_INVALID', `${op.node} is not a collecting map`, op);
    wf.acceptance = [...wf.acceptance, { op: 'eq', left: { $ref: `nodes.${op.node}.failed` }, right: 0 }]; return { touched: ['@acceptance', op.node] };
  },
  gate_continuation(wf, op) {
    const n = wf.nodes.find(x => x.id === op.node);
    if (n?.onError !== 'continue') fail('HEAL_OP_INVALID', `${op.node} does not continue on error`, op);
    wf.acceptance = [...wf.acceptance, { op: 'not', condition: { op: 'exists', value: { $ref: `nodes.${op.node}.error` } } }]; return { touched: ['@acceptance', op.node] };
  },
  strengthen_acceptance(wf, op, env) {
    let c;
    if (op.via === 'verify') {
      const n = wf.nodes.find(x => x.id === op.node);
      if (n?.kind !== 'verify' || n.gate === false || n.independence === 'same-model') fail('HEAL_OP_INVALID', `${op.node} is not a gating independent verify`, op);
      c = { op: 'eq', left: { $ref: `nodes.${op.node}.pass` }, right: true };
    } else {
      if (!op.conditionJson) fail('HEAL_OP_INVALID', 'via check needs conditionJson', op);
      c = condition(op.conditionJson, op);
      if (env.isStrong && !env.isStrong(c)) fail('HEAL_OP_INVALID', 'the condition is a presence test: a wrong answer would also satisfy it', op);
    }
    wf.acceptance = [...wf.acceptance, c]; return { touched: ['@acceptance', ...(op.node ? [op.node] : [])] };
  },
};

// Compile ops against a base workflow. `env`: { classOrder, classOf(id), isStrong, allowed:Set|null, locus:Set|null }.
// Returns the candidate (version + 1) and everything the verifier needs; `errors` carries stable HEAL_* codes, never throws.
export function compileOps(base, ops, env = {}) {
  const errors = [], applied = [], proofs = [], waivers = [], probes = [], created = [];
  if (!Array.isArray(ops) || !ops.length) return { workflow: null, errors: [{ code: 'HEAL_OP_INVALID', message: 'a proposal needs at least one op' }] };
  if (ops.length > MAX_OPS) return { workflow: null, errors: [{ code: 'HEAL_OP_INVALID', message: `at most ${MAX_OPS} ops per proposal` }] };
  const wf = clone(base), touched = new Set();
  for (const [i, op] of ops.entries()) {
    const problems = validateOp(op);
    if (problems.length) { errors.push({ code: problems[0].startsWith('HEAL_') ? problems[0].split(':')[0] : 'HEAL_OP_INVALID', op: i, message: problems.join('; ') }); continue; }
    if (env.allowed && !env.allowed.has(op.op)) { errors.push({ code: 'HEAL_OP_NOT_ALLOWED', op: i, message: `${op.op} is not allowed for this defect class` }); continue; }
    const id = OPS[op.op].kind === 'probe' ? null : OPS[op.op].kind === 'debt' ? '@acceptance' : op.op === 'patch_code_node' ? op.node : locusIdOf(op);
    if (env.locus && id && !env.locus.has(id) && !(id === '@acceptance' && env.locus.has('@acceptance'))) { errors.push({ code: 'HEAL_LOCUS_EXCEEDED', op: i, message: `${id} is outside the locus ${[...env.locus].join(', ')}` }); continue; }
    try {
      const r = APPLY[op.op](wf, op, env);
      applied.push(op); for (const t of r.touched ?? []) touched.add(t);
      created.push(...(r.created ?? [])); proofs.push(...(r.proofs ?? [])); waivers.push(...(r.waivers ?? [])); probes.push(...(r.probes ?? []));
    } catch (error) {
      if (error instanceof OpError) errors.push({ code: error.code, op: i, message: error.message }); else throw error;
    }
  }
  if (errors.length) return { workflow: null, errors, applied };
  wf.version = base.version + 1;
  return { workflow: wf, errors, applied, proofs, waivers, probes, touched: [...touched], created, candidateHash: digest(wf), opsHash: digest(ops) };
}

// ---- mechanical proposals from lint findings (DESIGN §7.4): no model involved ------------------------------------------
const REPAIR_OP = { 'gate-verify': 'gate_verify', 'gate-failed-count': 'gate_failed_count', 'gate-continuation': 'gate_continuation' };
export function mechanicalOps(lint, workflow) {
  const ops = [], needsProposer = [];
  for (const f of lint.findings.filter(x => x.severity === 'error')) {
    const op = REPAIR_OP[f.repair?.action];
    if (op && f.node) ops.push({ op, node: f.node });
  }
  if (lint.findings.some(f => f.code === 'ACCEPTANCE_EXISTENCE_ONLY')) {
    const gating = new Set(ops.filter(o => o.op === 'gate_verify').map(o => o.node));
    const verify = workflow.nodes.find(n => n.kind === 'verify' && n.independence !== 'same-model' && (n.gate !== false || gating.has(n.id)));
    if (verify) ops.push({ op: 'strengthen_acceptance', via: 'verify', node: verify.id });
    else needsProposer.push('ACCEPTANCE_EXISTENCE_ONLY');
  }
  return { ops, needsProposer, locus: new Set(['@acceptance']) };
}

export const reviewReasons = (ops, { costRatio = 1 } = {}) => [
  ...ops.filter(o => o.op === 'relax_check').map(() => 'relax_check: a relaxation is owner-reviewed'),
  ...ops.filter(o => o.op === 'escalate_class' && o.class === 'F').map(() => 'escalate_class F: raising a node to the frontier class is owner-reviewed'),
  ...(costRatio > 1.25 ? [`cost ratio ${costRatio.toFixed(2)} > 1.25`] : []),
];
