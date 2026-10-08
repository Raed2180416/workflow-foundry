// Proofs a patch carries (DESIGN §7.1, §8 V2): all computed by code, never by the proposer.
//   tightenProof()   a tightened check implies the old one over the typed domain and rejects at least one recorded wrong output
//   mutantBattery()  mutants of a Python module's public signatures, generated from the old API check's own failure modes
//   relaxProof()     a relaxed check still kills every mutant the old one killed, except the justified class
import { checkTrace, decisionFields, enumLeaves, setAt, canonical, clone, refsIn, nodeRef } from './ir.mjs';
import { quoteInContract } from './scan.mjs';

// ---- tighten: new => old on the enumerated decision space ------------------------------------------------------------
export function tightenProof({ old, next, returns, templates = [], wrong = [], accepted = [], kit, cap = 4096 }) {
  const deps = { condition: kit.data.condition, bindOutput: kit.validate.bindOutput };
  const accepts = (check, value) => checkTrace([check], value, deps).held;
  const fields = decisionFields(returns), base = templates.length ? templates : [Object.fromEntries(Object.keys(returns?.properties ?? {}).map(k => [k, defaultOf(returns.properties[k])]))];
  let checked = 0, counterexample = null;
  outer: for (const tpl of base.slice(0, 20)) {
    const leaves = enumLeaves(returns, tpl).filter(l => l.path.length === 1 && fields.includes(l.path[0]));
    const total = leaves.reduce((n, l) => n * l.domain.length, 1);
    if (total > cap) continue;
    const walk = (i, value) => {
      if (counterexample) return;
      if (i === leaves.length) { checked++; if (accepts(next, value) && !accepts(old, value)) counterexample = value; return; }
      for (const d of leaves[i].domain) walk(i + 1, setAt(value, leaves[i].path, d));
    };
    walk(0, tpl);
    if (counterexample) break outer;
  }
  // recorded outputs: the new check must also not accept anything the old one rejected
  for (const r of [...wrong, ...accepted]) { checked++; if (accepts(next, r) && !accepts(old, r)) counterexample ??= r; }
  const rejectsWrong = wrong.filter(w => accepts(old, w) && !accepts(next, w)).length;
  const rejectsAccepted = accepted.filter(a => accepts(old, a) && !accepts(next, a)).length;
  return { implies: !counterexample, counterexample: counterexample ? '[value]' : null, checked, rejectsWrong, rejectsAccepted, ok: !counterexample && rejectsWrong >= 1 };
}
const defaultOf = s => Array.isArray(s?.enum) ? s.enum[0] : s?.type === 'boolean' ? false : s?.type === 'string' ? 'x'.repeat(s.minLength ?? 1) : s?.type === 'array' ? [] : s?.type === 'integer' || s?.type === 'number' ? (s.minimum ?? 0) : null;

// ---- mutants of a Python module's public signatures --------------------------------------------------------------------
// Classes: renamed, reordered, removed, added, default_count (all must stay caught), default_value (the one a justification can name).
const DEF = /^(\s*)def\s+([A-Za-z_]\w*)\((.*)\)(\s*->\s*[^:]+)?:\s*$/;
function splitParams(text) {
  const out = []; let depth = 0, cur = '';
  for (const ch of text) { if ('([{'.includes(ch)) depth++; if (')]}'.includes(ch)) depth--; if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch; }
  if (cur.trim()) out.push(cur);
  return out.map(s => s.trim());
}
export function mutantBattery(moduleSource, { maxFunctions = 3 } = {}) {
  const src = String(moduleSource).split('\n'), out = [];
  let used = 0;
  src.forEach((line, i) => {
    const m = DEF.exec(line);
    if (!m || used >= maxFunctions) return;
    const [, indent, name, rawParams, ret = ''] = m;
    if (name.startsWith('_') && name !== '__init__') return;
    const params = splitParams(rawParams), real = params.filter(p => !/^(self|cls)\b/.test(p) && !p.startsWith('*'));
    if (!real.length) return;
    used++;
    const emit = (cls, text) => { const copy = [...src]; copy[i] = text; out.push({ id: `${cls}:${name}:${i + 1}`, class: cls, line: i + 1, text: copy.join('\n') }); };
    const build = (n, ps) => `${indent}def ${n}(${ps.join(', ')})${ret}:`;
    emit('renamed', build(`${name}_renamed`, params));
    if (real.length >= 2) { const idx = params.indexOf(real[0]), jdx = params.indexOf(real[1]), ps = [...params]; [ps[idx], ps[jdx]] = [ps[jdx], ps[idx]]; emit('reordered', build(name, ps)); }
    emit('removed', build(name, params.filter(p => p !== real.at(-1))));
    emit('added', build(name, [...params, 'extra_zz=None']));
    const defaulted = real.filter(p => p.includes('='));
    if (defaulted.length) {
      const last = defaulted.at(-1);
      emit('default_count', build(name, params.map(p => p === last ? p.split('=')[0].trim() : p)));
      const [pn, pv] = last.split('=').map(s => s.trim());
      const bumped = /^-?\d+$/.test(pv) ? String(Number(pv) + 1) : /^['"].*['"]$/.test(pv) ? `${pv.slice(0, -1)}x${pv.slice(-1)}` : pv === 'None' ? '0' : pv === 'True' ? 'False' : pv === 'False' ? 'True' : `(${pv})`;
      emit('default_value', build(name, params.map(p => p === last ? `${pn}=${bumped}` : p)));
    }
  });
  return out;
}

// Resolve a code node's `args` against recorded outputs and the run input, the way the runtime does.
export function resolveArgs(node, outputs, input, resolve) { return resolve(node.args ?? {}, { input, nodes: outputs }); }

// Does a mutant get flagged by the check as an API change? (compile errors are not kills: the mutant just does not parse.)
const flagged = r => !r.compile_error && Array.isArray(r.problems) && r.problems.some(p => /signature changed|public name removed/.test(p));

export async function runCheck({ kit, node, args, candidate, timeoutMs = 30000 }) {
  const input = { ...args, candidate };
  const { value } = await kit.sandbox.runCode({ lang: node.lang, source: node.source, input, timeoutMs });
  return value;
}

// The classes a justification may name, and the mutant class each one covers.
const JUSTIFIABLE = { 'default-value-changed': 'default_value' };

// Relaxation proof: the new source kills every mutant the old one killed, except mutants of the justified class.
export async function relaxProof({ proof, kit, node, args, moduleSource, taskTexts }) {
  const out = { quoteFound: quoteInContract(proof.quote, taskTexts), battery: proof.battery, mutants: [], violations: [], ok: false };
  if (proof.target !== 'source' || proof.battery !== 'python-signature' || proof.lang !== 'python') { out.violations.push('no mutant battery exists for this check; owner review only'); return out; }
  const battery = mutantBattery(moduleSource);
  if (!battery.length) { out.violations.push('the module has no public signature to mutate'); return out; }
  for (const m of battery) {
    const oldNode = { ...node, source: proof.before }, newNode = { ...node, source: proof.after };
    const [o, n] = await Promise.all([runCheck({ kit, node: oldNode, args, candidate: m.text }), runCheck({ kit, node: newNode, args, candidate: m.text })]);
    if (o.compile_error) continue;
    const row = { id: m.id, class: m.class, oldKills: flagged(o), newKills: flagged(n), justified: JUSTIFIABLE[proof.justifiedClass] === m.class };
    out.mutants.push(row);
    if (row.oldKills && !row.newKills && !row.justified) out.violations.push(`mutant ${m.id} was caught by the old check and is accepted by the new one`);
  }
  if (!out.mutants.some(m => m.oldKills)) out.violations.push('the old check kills no mutant: the battery proves nothing');
  out.ok = out.quoteFound && out.violations.length === 0;
  if (!out.quoteFound) out.violations.unshift('the quoted justification is not in the task contract');
  return out;
}
