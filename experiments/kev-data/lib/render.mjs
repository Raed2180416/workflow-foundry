// Question rendering for the Kev data factory (JUDGE-PROGRAM.md §1.0 wire form). Training records
// are built by importing the serving function itself, so serving and training match byte for byte:
// toSystemOneQuestion from src/judgment.mjs, reached through the port-kit interface
// (experiments/kev-data/judges/kit.mjs questionFromContract), which the runtime uses too.
import { toSystemOneQuestion } from '../../../src/judgment.mjs';
import { questionFromContract, fillWording, slotNames, contractOptions, LIMITS, companionContract, contractFor, judgmentRequest } from '../judges/kit.mjs';

export { toSystemOneQuestion, fillWording, slotNames, contractOptions, LIMITS, companionContract, contractFor, judgmentRequest };
export const renderQuestion = questionFromContract;

// A labelled training/evaluation question: the rendered question plus its label (one of the
// offered options) and, for soft-target rows (presence-matched unknowables, collision groups), a
// target over the options.
export function labelledQuestion(contract, { label, target, ...opts }) {
  const q = renderQuestion(contract, opts);
  const options = Object.keys(q.criteria);
  if (!options.includes(label)) throw new Error(`${contract.id}: label ${JSON.stringify(label)} is not an offered option`);
  const out = { ...q, label };
  if (target !== undefined && target !== null) {
    if (typeof target !== 'object' || Array.isArray(target)) throw new Error(`${contract.id}: target must be {option: weight}`);
    const keys = Object.keys(target);
    if (!keys.length || keys.some(k => !options.includes(k)) || !keys.every(k => Number.isFinite(target[k]) && target[k] >= 0) || !(keys.reduce((s, k) => s + target[k], 0) > 0)) {
      throw new Error(`${contract.id}: target must put non-negative weight on offered options only, with a positive sum`);
    }
    out.target = target;
  }
  return out;
}
export const uniformTarget = options => Object.fromEntries(options.map(o => [o, 1 / options.length]));

// Question ids (§2.2): the port id, or <port>~<wordingId> when a record carries several wordings
// of one port (paraphrase-consistency records). Kev never shows the id to the model.
export const questionId = (port, wordingId = null) => wordingId ? `${port}~${wordingId}` : port;
export const portOfQuestionId = qid => String(qid).split('~')[0];
// The contract a question id answers to: a port, or a port's companion question (S1_present: a
// yes/no question asked in the same record instead of a "none" option, §1.0). A companion is served
// as its own mini-contract (its own wordings and options, no criteria) and reported under its own id.
export function questionContract(qid, contracts) {
  const base = portOfQuestionId(qid);
  if (contracts?.[base]) return { port: base, reportId: base, contract: contracts[base], companion: false };
  const contract = contractFor(contracts, base);
  if (!contract) return null;
  return { port: contract.companionOf, reportId: base, companion: true, contract };
}

// A regex that matches a filling of a wording template, with whitespace normalised. Without slot specs
// a slot matches any non-empty text without braces (used to find held-out wordings in any filling).
// With a contract's slots, a slot with values matches only one of its values and a maxChars slot at
// most that many characters; a slot used twice must repeat its filling.
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const normalizeWs = s => String(s).replace(/\s+/g, ' ').trim();
export function wordingPattern(template, slotSpecs = null) {
  const text = normalizeWs(template), seen = new Set();
  let out = '', last = 0;
  for (const m of text.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
    out += escapeRe(text.slice(last, m.index)); last = m.index + m[0].length;
    const name = m[1], spec = slotSpecs?.[name];
    if (!slotSpecs) { out += '[^{}]+?'; continue; }
    if (seen.has(name)) { out += `\\k<${name}>`; continue; }
    seen.add(name);
    if (!spec) out += `(?<${name}>(?!))`;                                         // undeclared slot: never matches
    else if (spec.values?.length) out += `(?<${name}>${[...new Set(spec.values.map(normalizeWs))].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})`;
    else out += `(?<${name}>[^{}]{1,${Number.isInteger(spec.maxChars) ? spec.maxChars : 4000}}?)`;
  }
  return new RegExp(`^${out}${escapeRe(text.slice(last))}$`, 's');
}
// The question part of System One instructions (before the criteria block).
export const questionOf = instructions => String(instructions).split('\nCriteria:\n')[0];

// Kev's state rendering (kev:kev/api.py render, at 5e42a7a0): what the model reads from a JSON
// state. Exact for strings, integers, booleans, null, arrays and objects; Python prints floats with
// repr, so states should carry non-integer numbers as strings. lib/tokens.mjs counts on the real
// rendering in Python; this copy serves probes and byte estimates.
export function renderState(v, indent = 0) {
  const pad = '  '.repeat(indent);
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(x => `${pad}- ${renderState(x, indent + 1).replace(/^\s+/, '')}`).join('\n');
  return Object.entries(v).map(([k, x]) => x && typeof x === 'object' ? `${pad}${k}:\n${renderState(x, indent + 1)}` : `${pad}${k}: ${renderState(x)}`).join('\n');
}
