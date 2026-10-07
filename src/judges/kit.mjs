// Port-kit interface (JUDGE-PROGRAM.md §2.1, §8.4 W2). A port kit turns a bed task into the state a
// judgment port reads and renders the port's typed question from its frozen contract. The Kev data
// factory (experiments/kev-data) and the runtime import the same kit, so the state a model is
// trained on and the state it is served are built by one function, and the question is rendered by
// one call to toSystemOneQuestion (src/judgment.mjs). This file is the interface and the shared
// checks only; the per-bed kits (src/judges/<bed>.mjs) are written by the bed groups.
//
// Contract shape: see experiments/kev-data/spec/ports.json and experiments/kev-data/README.md.
import { toSystemOneQuestion } from '../judgment.mjs';
import { checkData, FoundryError } from '../data.mjs';

export const KIT_INTERFACE_VERSION = 1;

// §2.3 rule 2: exact key names a state may never carry, at any depth. Descriptive keys such as
// source_kind, node_kind and author_role are allowed (the metadata-only baseline tests them).
export const FORBIDDEN_STATE_KEYS = Object.freeze(['truth', 'label', 'tag', 'kind', 'tpl', 'template', 'seed', 'split',
  'difficulty', 'answer', 'gold', 'correct', 'polarity', 'mode', 'cls', 'role']);
const FORBIDDEN = new Set(FORBIDDEN_STATE_KEYS);

// JudgmentPort limits (src/ports.mjs judgmentRequest).
export const LIMITS = Object.freeze({ minOptions: 2, maxOptions: 64, maxCriteria: 32, maxQuestionChars: 4000, maxOptionChars: 200 });

const SLOT = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
export const slotNames = template => [...new Set([...String(template).matchAll(SLOT)].map(m => m[1]))];

// Slots are filled from trusted code knowledge (system names, directions, assumptions of a kept
// workflow), never from task text. Every placeholder must be filled; no value may itself contain a
// placeholder, so a filled wording is unambiguous.
export function fillWording(template, slots = {}) {
  if (typeof template !== 'string' || !template.trim()) throw new FoundryError('PORT_CONTRACT', 'A wording must be a non-empty string');
  for (const name of slotNames(template)) {
    const v = slots[name];
    if (typeof v !== 'string' || !v.trim()) throw new FoundryError('PORT_SLOT', `Slot {${name}} needs a non-empty string value`);
    if (/[{}]/.test(v)) throw new FoundryError('PORT_SLOT', `Slot {${name}} must not contain braces`);
  }
  return template.replace(SLOT, (_, name) => slots[name]);
}

// Every key path whose last segment is a forbidden name.
export function findForbiddenKeys(state) {
  const hits = [];
  const walk = (v, path) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, i]));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
      if (FORBIDDEN.has(k)) hits.push({ path: [...path, k].join('.'), key: k });
      walk(x, [...path, k]);
    }
  };
  walk(state, []);
  return hits;
}

// A port state is a plain JSON object of observed facts with no forbidden key.
export function assertPortState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new FoundryError('PORT_STATE', 'A port state is a JSON object');
  checkData(state, { maxBytes: 4 * 1024 * 1024 });
  const bad = findForbiddenKeys(state);
  if (bad.length) throw new FoundryError('PORT_STATE_FORBIDDEN_KEY', `State carries forbidden key(s): ${bad.map(b => b.path).join(', ')}`, { keys: bad });
  return state;
}

// The options of a question in contract order, with their descriptions. Fixed-option ports carry
// their options in the contract; variable-option ports (candidate ids, register ids, legal actions,
// function names) take them per record within the contract's optionSource bounds.
export function contractOptions(contract, { options, optionDescriptions } = {}) {
  if (contract.options) {
    if (options && JSON.stringify([...options].sort()) !== JSON.stringify(Object.keys(contract.options).sort())) {
      throw new FoundryError('PORT_OPTIONS', `${contract.id} has fixed options; a record may not change them`);
    }
    return { names: Object.keys(contract.options), descriptions: contract.options };
  }
  const src = contract.optionSource;
  if (!src) throw new FoundryError('PORT_CONTRACT', `${contract.id} has neither options nor optionSource`);
  if (!Array.isArray(options)) throw new FoundryError('PORT_OPTIONS', `${contract.id} has variable options; pass options`);
  if (options.length < Math.max(LIMITS.minOptions, src.min ?? 2) || options.length > Math.min(LIMITS.maxOptions, src.max)) {
    throw new FoundryError('PORT_OPTIONS', `${contract.id} takes ${src.min ?? 2}-${src.max} options, got ${options.length}`);
  }
  const re = src.pattern ? new RegExp(src.pattern) : null;
  if (new Set(options).size !== options.length || !options.every(o => typeof o === 'string' && o.length > 0 && o.length <= LIMITS.maxOptionChars && (!re || re.test(o)))) {
    throw new FoundryError('PORT_OPTIONS', `${contract.id} options must be unique strings matching ${src.pattern ?? 'any'}`);
  }
  const descriptions = optionDescriptions ?? {};
  if (Object.keys(descriptions).some(k => !options.includes(k))) throw new FoundryError('PORT_OPTIONS', `${contract.id} has descriptions for options it does not offer`);
  if (src.describedBy && options.some(o => typeof descriptions[o] !== 'string' || !descriptions[o].trim())) {
    throw new FoundryError('PORT_OPTIONS', `${contract.id} options must each carry a description (${src.describedBy})`);
  }
  return { names: options, descriptions };
}

// The System One question for one port: the wording (Q0-Q3, or a held-out wording passed as text)
// with slots filled, the contract's criteria, and the options in the given order. This is the only
// rendering path, shared by the factory (experiments/kev-data/lib/render.mjs) and the runtime.
export function questionFromContract(contract, { wording = 'Q0', wordingText, slots = {}, options, optionDescriptions, optionOrder } = {}) {
  if (!contract || typeof contract.id !== 'string') throw new FoundryError('PORT_CONTRACT', 'A port contract is required');
  const text = wordingText ?? contract.wordings?.[wording];
  if (typeof text !== 'string') throw new FoundryError('PORT_CONTRACT', `${contract.id} has no wording ${wording}`);
  const question = fillWording(text, slots);
  if (question.length > LIMITS.maxQuestionChars) throw new FoundryError('PORT_CONTRACT', `${contract.id} question exceeds ${LIMITS.maxQuestionChars} characters`);
  const criteria = contract.criteria ?? [];
  if (!Array.isArray(criteria) || criteria.length > LIMITS.maxCriteria) throw new FoundryError('PORT_CONTRACT', `${contract.id} has more than ${LIMITS.maxCriteria} criteria`);
  const { names, descriptions } = contractOptions(contract, { options, optionDescriptions });
  let ordered = names;
  if (optionOrder) {
    if (optionOrder.length !== names.length || new Set(optionOrder).size !== names.length || !optionOrder.every(o => names.includes(o))) {
      throw new FoundryError('PORT_OPTIONS', `${contract.id} option order must be a permutation of its options`);
    }
    ordered = optionOrder;
  }
  if (ordered.length < LIMITS.minOptions || ordered.length > LIMITS.maxOptions) throw new FoundryError('PORT_OPTIONS', `${contract.id} needs 2-64 options`);
  return toSystemOneQuestion({ question, criteria, options: ordered, optionDescriptions: descriptions });
}

// definePortKit({ bed, contracts: {portId: contract}, buildState(task, slots) }) -> a frozen kit with
//   buildState(task, slots) -> state      (checked: JSON object, no forbidden key)
//   questions(port, slots, opts) -> { [port]: System One question }   (Q0 unless opts.wording)
// Per-bed kits export the result as `kit`.
export function definePortKit({ bed, contracts, buildState }) {
  if (typeof bed !== 'string' || !/^[a-z][a-z0-9-]*$/.test(bed)) throw new FoundryError('PORT_KIT', 'A port kit names its bed');
  if (!contracts || typeof contracts !== 'object' || !Object.keys(contracts).length) throw new FoundryError('PORT_KIT', 'A port kit binds at least one port contract');
  if (typeof buildState !== 'function') throw new FoundryError('PORT_KIT', 'A port kit needs buildState(task, slots)');
  for (const [id, c] of Object.entries(contracts)) if (c?.id !== id) throw new FoundryError('PORT_KIT', `Contract key ${id} does not match its id`);
  const ports = Object.freeze(Object.keys(contracts));
  return Object.freeze({
    bed, ports, interfaceVersion: KIT_INTERFACE_VERSION,
    buildState(task, slots = {}) { return assertPortState(buildState(task, slots)); },
    questions(port, slots = {}, opts = {}) {
      const contract = contracts[port];
      if (!contract) throw new FoundryError('PORT_KIT', `Kit ${bed} has no port ${port}`);
      return { [port]: questionFromContract(contract, { ...opts, slots }) };
    },
  });
}
