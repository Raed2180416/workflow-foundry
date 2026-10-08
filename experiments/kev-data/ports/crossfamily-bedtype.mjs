// X5 `precondition_holds`, family bedtype: cross-family type applicability (JUDGE-PROGRAM.md §1.2 X5 "bedtype", §3.4, §4.3;
// plan group "construction-crossfamily"). The failure that motivated claim C4 is wrong-type reuse (the skills arm went 0/21).
//
//   assumption (TRUSTED, travels in the question): a bed family's task statement, in a framing sentence:
//       "<framing>: <family.description | the README's task paragraph>"
//   state (UNTRUSTED): {source_text}, the prompt head and inputs head of another task (judges/bedtype.mjs)
//   label, by construction from family ids only (never a model):
//       the state's task is of the assumption's family            holds
//       it is a task of another family                            violated
//       the state is a paragraph with no task content             not_stated
//     (a NEGATED framing, "the task does not belong to the family ...", flips holds and violated: the §1.2 X5 "negated
//      statements" adversarial variant; not_stated is unchanged)
//
// Held-out (§3.4): the kinetics and runbook descriptions, README paragraphs and prompt heads appear in test-ood files only.
// A pair whose assumption or state is kinetics or runbook is family bedtype:kinetics / bedtype:runbook (see familyBedOf).
//
// The axes of test-ood (JUDGE-PROGRAM.md §4.3, a quarter of X5's shared axes plus the bedtype family axis):
//   family 600 (held-out kinetics/runbook) + skeleton 250 + paraphrase ~100 + adversarial 200 (clean/injected twins and
//   negated pairs) + long ~72 + flip 100 (state flips) + slot 50 (a reference task in the state) = about 1,375 rows.
//
// Pure: the same (slice, seeds, opts, factory version, bed pin) gives the same records in the same order. Every choice is a
// salted hash of the record key: no Math.random, no clock, no network. Beds are imported through ctx.beds (the frozen copy)
// and nothing here reads the held-out directory: held-out wordings arrive through opts.wordings (data).
import { createHash } from 'node:crypto';
import { labelledQuestion, questionId } from '../lib/render.mjs';
import { optionOrder } from '../lib/balance.mjs';
import { worldHash, skeleton, spanHash, sentences } from '../lib/hash.mjs';
import { stateOf, taskHead } from '../judges/bedtype.mjs';
import { assumptionOf, BUCKET_OF_SLICE, carrierFor, framingFor, paragraphTask, pick } from './crossfamily-pools.mjs';

export const GENERATOR_VERSION = 'construction-crossfamily-bedtype@1';
export const TRAIN_BEDS = Object.freeze(['records', 'incident', 'synth', 'gameqa', 'gridquest', 'codefix', 'ownerci']);
export const HELD_OUT_BEDS = Object.freeze(['kinetics', 'runbook']);
export const ALL_BEDS = Object.freeze([...TRAIN_BEDS, ...HELD_OUT_BEDS]);
const HELD = new Set(HELD_OUT_BEDS);

const sha = s => createHash('sha256').update(s).digest('hex');
const hnum = s => parseInt(sha(s).slice(0, 8), 16);
const fail = (code, message) => { const e = new Error(`${code}: ${message}`); e.code = code; return e; };

// ---- the label, by construction ----------------------------------------------------------------------------------------------
// The state's family against the assumption's family. A state with no task (stateBed === null) is not_stated. A negated
// framing asks the opposite question: it holds for every other family.
export function relation(assumptionBed, stateBed, { negated = false } = {}) {
  if (stateBed === null || stateBed === undefined) return 'not_stated';
  const same = assumptionBed === stateBed;
  return same !== Boolean(negated) ? 'holds' : 'violated';
}

// ---- hard pairs (§1.2 X5: "hard pairs share vocabulary") ----------------------------------------------------------------------
// The program names three; the next three are the pairs of the nine with the highest content-word overlap of family
// description + prompt heads + input heads on dev seeds 401-405 (d3, d5): codefix/ownerci 0.095, gameqa/codefix 0.091,
// gameqa/gridquest 0.089 (Jaccard; the median pair is 0.04). The program's three rank 7th, 14th and 19th of 36 by that
// measure, so hardness is the union.
export const HARD_DECLARED = Object.freeze([['incident', 'runbook'], ['synth', 'kinetics'], ['records', 'ownerci']]);
export const HARD_MEASURED = Object.freeze([['codefix', 'ownerci'], ['gameqa', 'codefix'], ['gameqa', 'gridquest']]);
export const HARD_PAIRS = Object.freeze([...HARD_DECLARED, ...HARD_MEASURED]);
const hardIn = (list, a, b) => a !== b && list.some(p => p.includes(a) && p.includes(b));
export const isHard = (a, b) => hardIn(HARD_PAIRS, a, b);
export const isDeclaredHard = (a, b) => hardIn(HARD_DECLARED, a, b);
const hardPartner = x => HARD_DECLARED.find(p => p.includes(x))?.find(y => y !== x) ?? null;     // kinetics <-> synth, runbook <-> incident

// ---- bed facts: family descriptions, README task paragraphs, task generators --------------------------------------------------
// The README paragraph is verbatim text between two anchors in the frozen README (markdown marks and line breaks removed).
// An anchor that is no longer there stops the build (README_ANCHOR): the assumption must not silently change.
export const README_ANCHORS = Object.freeze({
  records: ['Each task is a messy export', 'one canonical record per real person.'],
  incident: ['Each task describes a fictional online shop.', 'batch tiers).'],
  synth: ['Each task is a corpus of short documents', '(retracted or superseded).'],
  kinetics: ['An initial-rate enzyme-kinetics study', 'Each well is one study sample with an id such as PX-0412.'],
  runbook: ['The solver acts as the on-call SRE', 'and a clock.'],
  gameqa: ['Each task is one build of a small deterministic turn-based tile game.', 'stairs between floors.'],
  gridquest: ['A procedurally generated text adventure.', 'inscriptions) is invented and generated from the seed; no benchmark data is used.'],
  codefix: ['Each task is a generated Python 3 module', 'It must return the whole corrected module.'],
  ownerci: ['A pull request has broken one module of workflow-foundry itself', 'It must return the complete repaired module.'],
});
const plain = s => String(s).replace(/`/g, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
export function readmeParagraph(markdown, [from, to], bed = '?') {
  const t = plain(markdown), i = t.indexOf(from), j = i < 0 ? -1 : t.indexOf(to, i);
  if (i < 0 || j < 0) throw fail('README_ANCHOR', `the README task paragraph of ${bed} is no longer between "${from}" and "${to}"`);
  return t.slice(i, j + to.length);
}
export async function loadBedFacts(beds, { names = ALL_BEDS, anchors = README_ANCHORS } = {}) {
  const facts = {};
  for (const bed of names) {
    const mod = await beds.import(`beds/${bed}/index.mjs`);
    if (mod.family?.id !== bed) throw fail('BED_FAMILY', `beds/${bed}/index.mjs exports family.id ${JSON.stringify(mod.family?.id)}`);
    const texts = [{ source: 'description', text: plain(mod.family.description) }, { source: 'readme', text: readmeParagraph(beds.read(`beds/${bed}/README.md`), anchors[bed], bed) }];
    facts[bed] = { bed, domain: mod.family.domain, kind: mod.family.kind, texts, generate: mod.generate };
  }
  return facts;
}
// Sentence skeletons of the train beds' prompt heads: a held-out sentence that also occurs in a train bed's prompt is not
// family-specific and is not registered as a held-out span.
export function trainSentenceSkeletons(facts, { seeds = [401, 402, 403], difficulty = 3 } = {}) {
  const out = new Set();
  for (const bed of TRAIN_BEDS) {
    if (!facts[bed]) continue;
    for (const seed of seeds) for (const s of sentences(promptPart(taskHead(facts[bed].generate({ seed, split: 'dev', difficulty }))))) out.add(skeleton(s));
  }
  return out;
}
const promptPart = headText => headText.replace(/^Task statement:\n/, '').split('\n\nInputs:')[0];

// ---- masks (proper nouns and ids of the state's text) -------------------------------------------------------------------------
export function maskTerms(text) {
  const names = new Set(), markers = new Set();
  for (const m of String(text).matchAll(/\b[A-Z][A-Za-z]*(?:-[A-Z0-9][A-Za-z0-9]*)+\b|\b[A-Za-z]+[-_.]?\d[\w.-]*\b/g)) if (m[0].length >= 3) markers.add(m[0]);
  for (const m of String(text).matchAll(/(?<=[a-z,;(] )[A-Z][a-z]{2,}(?: [A-Z][a-z]{2,})*/g)) names.add(m[0]);
  return { names: [...names].sort(), markers: [...markers].sort() };
}

// ---- the plan -----------------------------------------------------------------------------------------------------------------
// Permutations of the seven train beds (every round gives each bed once as the state's bed and once as the partner
// assumption, so holds and violated are balanced within every assumption bed). Rounds 1, 2, 4, 5 are built from hard pairs
// (4 of 7 edges), rounds 3 and 6 from none: 16/42 = 38% of violated pairs are hard.
const PERM = (pairs) => Object.freeze(Object.fromEntries(pairs));
export const PERMS = Object.freeze([
  PERM([['codefix', 'ownerci'], ['ownerci', 'codefix'], ['gameqa', 'gridquest'], ['gridquest', 'gameqa'], ['records', 'incident'], ['incident', 'synth'], ['synth', 'records']]),
  PERM([['codefix', 'gameqa'], ['gameqa', 'codefix'], ['ownerci', 'records'], ['records', 'ownerci'], ['gridquest', 'incident'], ['incident', 'synth'], ['synth', 'gridquest']]),
  PERM([['records', 'gameqa'], ['gameqa', 'synth'], ['synth', 'codefix'], ['codefix', 'incident'], ['incident', 'ownerci'], ['ownerci', 'gridquest'], ['gridquest', 'records']]),
  PERM([['codefix', 'ownerci'], ['ownerci', 'codefix'], ['gameqa', 'gridquest'], ['gridquest', 'gameqa'], ['records', 'incident'], ['incident', 'synth'], ['synth', 'records']]),
  PERM([['codefix', 'gameqa'], ['gameqa', 'codefix'], ['ownerci', 'records'], ['records', 'ownerci'], ['gridquest', 'incident'], ['incident', 'synth'], ['synth', 'gridquest']]),
  PERM([['records', 'gridquest'], ['gridquest', 'ownerci'], ['ownerci', 'incident'], ['incident', 'codefix'], ['codefix', 'synth'], ['synth', 'gameqa'], ['gameqa', 'records']]),
]);
// cluster i of a block: its state bed and the partner (the other bed of the pair)
// Within a round the beds come in PERM_ORDER, hard edges first, so a short block (a few clusters) is hard-heavy too.
export const PERM_ORDER = Object.freeze(['codefix', 'ownerci', 'gameqa', 'gridquest', 'records', 'incident', 'synth']);
export function permPair(i, beds = PERM_ORDER) {
  const round = Math.floor(i / beds.length), state = beds[i % beds.length];
  return { state, partner: PERMS[round % PERMS.length][state] };
}
// Held-out family axis: for X in kinetics, runbook, the partner sequence alternates the hard partner (synth for kinetics,
// incident for runbook) with the other beds, so half of the pairs are hard.
const othersOf = x => ALL_BEDS.filter(b => b !== x && b !== hardPartner(x));
export const partnerSeq = (x, j) => (j % 2 === 0 ? hardPartner(x) : othersOf(x)[(j >> 1) % othersOf(x).length]);

// Row shares / counts per slice. `perCluster` is the number of records a cluster yields (questions for a paraphrase cluster).
const SHARES = {
  train: [['in-family', 'pair', 0.50, 2], ['in-family', 'notstated', 0.20, 1], ['adversarial', 'injection', 0.10, 2], ['slot', 'slot', 0.10, 2], ['long', 'long', 0.06, 2], ['adversarial', 'negpair', 0.04, 2]],
  'test-in': [['in-family', 'pair', 0.80, 2], ['in-family', 'notstated', 0.20, 1]],
  'calib-ood': [['skeleton', 'pair', 0.80, 2], ['skeleton', 'notstated', 0.20, 1]],
  'dev-ood': [['skeleton', 'pair', 0.80, 2], ['skeleton', 'notstated', 0.20, 1]],
};
SHARES['calib-in'] = SHARES.train; SHARES['dev-select'] = SHARES.train;
const TEST_OOD_ROWS = Object.freeze({ family: 600, skeleton: 250, paraphrase: 102, adversarial: 200, long: 72, flip: 100, slot: 50 });
export const DEFAULT_ROWS = Object.freeze({ train: 484, 'calib-in': 75, 'calib-ood': 250, 'dev-select': 50, 'dev-ood': 250, 'test-in': 125, 'test-ood': 1374 });
export const SLICE_HAS_X5 = Object.freeze(Object.keys(DEFAULT_ROWS));

const evenDown = n => n - (n % 2);
// The kind of item an injection twin is built on. The dangerous direction (a carrier urging holds on a violated or
// not_stated item) is 80% of the test items; training sees both directions evenly.
const INJECTION_MIX_TRAIN = Object.freeze(['violated', 'holds', 'violated', 'holds', 'not_stated']);
const INJECTION_MIX_TEST = Object.freeze(['violated', 'violated', 'violated', 'not_stated', 'holds']);
// The clusters of a slice, in a fixed order. `rows` is the target number of records (questions for paraphrase).
export function planBedtype(slice, rows = DEFAULT_ROWS[slice]) {
  if (!rows) return [];
  const out = [], add = (axis, kind, n, extra = {}) => { for (let i = 0; i < n; i++) out.push({ axis, kind, i, ...extra }); };
  if (slice === 'test-ood') {
    const k = rows / DEFAULT_ROWS['test-ood'], r = x => Math.max(0, evenDown(Math.round(x * k)));
    const fam = r(TEST_OOD_ROWS.family), famN = Math.round(fam * 0.2), famPairs = fam - famN;          // 60 / 20 / 20 %
    add('family', 'fam-sx', Math.round(famPairs / 4)); add('family', 'fam-ax', Math.round(famPairs / 4)); add('family', 'notstated', famN, { held: true });
    const sk = r(TEST_OOD_ROWS.skeleton), skN = Math.round(sk * 0.2);
    add('skeleton', 'pair', Math.round((sk - skN) / 2)); add('skeleton', 'notstated', skN);
    add('paraphrase', 'paraphrase', Math.round(TEST_OOD_ROWS.paraphrase * k / 3));
    const adv = r(TEST_OOD_ROWS.adversarial);
    add('adversarial', 'injection', Math.round(adv * 0.7 / 2)); add('adversarial', 'negpair', Math.round(adv * 0.3 / 2));
    add('long', 'long', Math.round(r(TEST_OOD_ROWS.long) / 2));
    add('flip', 'statepair', Math.round(r(TEST_OOD_ROWS.flip) / 2));
    add('slot', 'slot', Math.round(r(TEST_OOD_ROWS.slot) / 2));
    return out;
  }
  const table = SHARES[slice];
  if (!table) return [];
  // clusters per kind: the floor of the share, then the leftover rows go to the kinds with the largest remainders (never over the target)
  const want = table.map(([axis, kind, share, per]) => ({ axis, kind, per, exact: (rows * share) / per })), n = want.map(w => Math.floor(w.exact));
  let left = rows - want.reduce((s, w, i) => s + n[i] * w.per, 0);
  for (const i of want.map((_, j) => j).sort((a, b) => (want[b].exact - n[b]) - (want[a].exact - n[a]) || a - b)) if (left >= want[i].per) { n[i]++; left -= want[i].per; }
  for (let i = 0; i < want.length && left > 0; i++) while (left >= want[i].per && want[i].kind === 'notstated') { n[i]++; left -= want[i].per; }
  want.forEach((w, i) => add(w.axis, w.kind, n[i]));
  return out;
}
// seeds a cluster consumes (a state-flip and a slot cluster read two tasks)
const seedsNeeded = c => (c.kind === 'statepair' || c.kind === 'slot' || c.kind === 'fam-ax' ? 2 : 1);

// ---- records -------------------------------------------------------------------------------------------------------------------
const DIFFICULTY_CYCLE = [1, 2, 3, 3, 4, 4, 5, 5];
const difficultyOf = n => DIFFICULTY_CYCLE[n % DIFFICULTY_CYCLE.length];
const worldKeyOf = (bed, split, difficulty, seed) => `${bed}:${split}:d${difficulty}:s${seed}`;

function wordingsFor(contract, slice, key, opts, { paraphrase = false } = {}) {
  const held = (contract.heldoutWordings?.[slice] ?? 0) > 0;
  if (held) {
    const raw = opts.wordings?.[contract.id], list = (Array.isArray(raw) ? raw : raw?.[slice]) ?? [];
    if (!list.length) throw fail('HELDOUT_WORDINGS_MISSING', `${contract.id} in ${slice} uses the slice's held-out wordings: pass opts.wordings.${contract.id} = [{id, text}] or {slice: [{id, text}]} (the assembly reads them from the held-out store; this generator does not)`);
    if (paraphrase) {
      if (list.length < 2) throw fail('HELDOUT_WORDINGS_MISSING', `a paraphrase record needs two ${slice} wordings of ${contract.id}`);
      const a = hnum(`${key}|pw`) % list.length, b = (a + 1 + (hnum(`${key}|pw2`) % (list.length - 1))) % list.length;
      return [{ id: 'Q0', wording: 'Q0' }, ...[a, b].map(i => ({ id: list[i].id, wording: 'Q0', wordingText: list[i].text }))];
    }
    const w = pick(list, `${key}|wording`);
    return [{ id: w.id, wording: 'Q0', wordingText: w.text }];
  }
  if (paraphrase) { const q = ['Q0', 'Q1', 'Q2', 'Q3'], a = hnum(`${key}|pw`) % 4, b = (a + 1 + (hnum(`${key}|pw2`) % 3)) % 4; return [q[0], q[a], q[b]].filter((x, i, l) => l.indexOf(x) === i).map(id => ({ id, wording: id })); }
  const q = pick(['Q0', 'Q1', 'Q2', 'Q3'], `${key}|wording`);
  return [{ id: q, wording: q }];
}

// A state from a bed task: the world, its head, its masks.
function bedState(env, bed, seed, difficulty, { window = 'standard', reference = null } = {}) {
  const task = env.facts[bed].generate({ seed, split: env.bedSplit, difficulty });
  const state = stateOf(task, { window, reference: reference?.task ?? null });
  const heldSpans = HELD.has(bed) ? sentences(promptPart(taskHead(task, window))).filter(s => s.length >= 40 && !env.trainSkel.has(skeleton(s))) : [];
  return { bed, seed, difficulty, task, state, worldHash: worldHash(task), worldKey: worldKeyOf(bed, env.bedSplit, difficulty, seed), masks: maskTerms(state.source_text), heldSpans, window };
}
// A state with no task content: a pseudo task (prompt paragraph and inputs) through the same kit.
function noTaskState(env, aBed, seed, key, bucket, { adjacent }) {
  const pseudo = paragraphTask(key, bucket, { adjacent });
  const difficulty = 1 + (hnum(`${key}|pd`) % 5);
  return { bed: null, seed, difficulty, task: pseudo, state: stateOf(pseudo), worldHash: worldHash(pseudo), worldKey: worldKeyOf(aBed, env.bedSplit, difficulty, seed), masks: maskTerms(promptPart(taskHead(pseudo))), heldSpans: [], window: 'standard', adjacent: pseudo.adjacent };
}
function insertCarrier(sourceText, carrier, key) {
  const at = sourceText.indexOf('\n\nInputs:'), head = at >= 0 ? sourceText.slice(0, at) : sourceText, rest = at >= 0 ? sourceText.slice(at) : '';
  const start = head.indexOf('\n') + 1, bounds = [...head.slice(start).matchAll(/(?<=[.!?])\s+(?=\S)/g)].map(m => start + m.index + m[0].length).slice(0, 4);
  const pos = bounds.length ? bounds[hnum(`${key}|ipos`) % bounds.length] : head.length;
  return { source_text: `${head.slice(0, pos)}${pos < head.length ? '' : ' '}${carrier} ${head.slice(pos)}`.replace(/ {2,}/g, ' ').replace(/ \n/g, '\n').trimEnd() + rest };
}

// Build one record. c: { key, aBed, atext: {source, text}, framing, negated, st (a state descriptor), label, variant, axis, pairId,
// counterfactual, carrier, tag, extra, qkeys }
function makeRecord(env, c) {
  const contract = env.contract, { slice, opts } = env;
  const assumption = assumptionOf(c.framing, c.atext.text);
  const ws = wordingsFor(contract, slice, c.key, opts, { paraphrase: c.paraphrase });
  const names = Object.keys(contract.options);
  const questions = {};
  ws.forEach((w, n) => {
    const qid = ws.length > 1 ? questionId('X5', w.id === 'Q0' && n === 0 ? 'Q0' : w.id) : questionId('X5');
    questions[qid] = labelledQuestion(contract, { label: c.label, wording: w.wording, wordingText: w.wordingText, slots: { assumption }, optionOrder: optionOrder(names, `${c.key}|${qid}`) });
  });
  const st = c.st, state = c.carrierState ?? st.state;
  const heldA = HELD.has(c.aBed), heldS = st.bed !== null && HELD.has(st.bed);
  const famBed = heldA ? c.aBed : heldS ? st.bed : (st.bed ?? c.aBed);
  const own = st.bed === null || st.bed === famBed;
  const crossType = c.label === 'violated' && !c.negated && st.bed !== null && st.bed !== c.aBed;
  const heldOut = [...(heldA ? [`description:${c.aBed}`] : []), ...(heldS ? [`prompt:${st.bed}`] : [])];
  const meta = {
    family: `bedtype:${famBed}`, bed: famBed, variant: c.variant, labelSource: st.bed === null ? 'composer' : 'generator', needsWorldKnowledge: false,
    wordingId: ws.map(w => w.id).join('+'), formId: skeleton(assumption), surface: { source: st.bed === null ? 'authored-composer' : 'bed+authored-framing', slice, lineHash: spanHash(assumption) },
    counterfactual: c.counterfactual ?? null, pairId: c.pairId ?? null, masks: st.masks, axis: c.axis, crossType, hard: c.label !== 'not_stated' && st.bed !== null && isHard(c.aBed, st.bed), hardDeclared: st.bed !== null && isDeclaredHard(c.aBed, st.bed),
    heldOut,
    bedtype: { assumptionBed: c.aBed, assumptionSource: c.atext.source, assumptionText: c.atext.text, framing: c.framing.id, negated: Boolean(c.negated), stateBed: st.bed, stateSeed: st.seed, stateDifficulty: st.difficulty, stateWorldKey: st.worldKey, stateWorldHash: st.worldHash,
      window: st.window, relation: c.label, heldoutSpans: st.heldSpans, ...(st.bed === null ? { adjacent: Boolean(st.adjacent) } : {}), ...(c.extra ?? {}) },
  };
  if (own) Object.assign(meta, { seed: st.seed, difficulty: st.difficulty, worldHash: st.worldHash });
  else meta.worlds = [st.worldKey];
  if (c.referenceKey) meta.worlds = [...(meta.worlds ?? []), c.referenceKey];
  return { state, questions, meta };
}

// the assumption of a bed: one of its texts (description | readme) in a framing of the slice's bucket
function assumptionFor(env, aBed, key, { negated = false, bucket = env.bucket } = {}) {
  const texts = env.facts[aBed].texts;
  return { atext: texts[hnum(`${key}|src`) % texts.length], framing: framingFor(bucket, negated, `${key}|${aBed}`) };
}

function* realizeCluster(env, c, seeds, gi) {
  const { slice } = env, key = `${slice}|${c.axis}|${c.kind}|${c.i}`;
  const d = difficultyOf(gi);
  const bucket = c.axis === 'family' || c.axis === 'paraphrase' || c.axis === 'flip' || c.axis === 'slot' || c.axis === 'long' ? 'train' : env.bucket;
  const A = (aBed, k, o = {}) => assumptionFor(env, aBed, `${key}|${k}`, { bucket, ...o });
  const rec = (k, o) => makeRecord(env, { key: `${key}|${k}`, axis: c.axis, ...o });
  switch (c.kind) {
    case 'pair': case 'long': {
      const lp = c.kind === 'long', { state, partner } = permPair(c.i);
      const st = bedState(env, state, seeds[0], d, { window: lp ? 'long' : 'standard' }), pairId = `bt:${key}`;
      for (const [role, aBed, label] of [['h', state, 'holds'], ['v', partner, 'violated']]) {
        yield rec(role, { aBed, ...A(aBed, role), st, label, variant: 'flip', pairId, counterfactual: { swapped: true, from: role === 'h' ? partner : state, to: aBed, path: 'assumption' } });
      }
      return;
    }
    case 'fam-sx': case 'fam-ax': {
      const x = c.i % 2 === 0 ? 'kinetics' : 'runbook', j = Math.floor(c.i / 2), partner = partnerSeq(x, j), pairId = `bt:${key}`;
      if (c.kind === 'fam-sx') {                                   // state X: holds with X, violated with the partner
        const st = bedState(env, x, seeds[0], d);
        for (const [role, aBed, label] of [['h', x, 'holds'], ['v', partner, 'violated']]) yield rec(role, { aBed, ...A(aBed, role), st, label, variant: 'flip', pairId, counterfactual: { swapped: true, from: role === 'h' ? partner : x, to: aBed, path: 'assumption' } });
      } else {                                                     // assumption X: holds on a task of X, violated on a task of the partner
        const a = A(x, 'a');
        const sh = bedState(env, x, seeds[0], d), sv = bedState(env, partner, seeds[1], difficultyOf(gi + 3));
        yield rec('h', { aBed: x, ...a, st: sh, label: 'holds', variant: 'flip', pairId, counterfactual: { swapped: true, from: partner, to: x, path: 'source_text' } });
        yield rec('v', { aBed: x, ...a, st: sv, label: 'violated', variant: 'flip', pairId, counterfactual: { swapped: true, from: x, to: partner, path: 'source_text' } });
      }
      return;
    }
    case 'statepair': {                                            // flip axis: one assumption, two states
      const { state: aBed, partner } = permPair(c.i), pairId = `bt:${key}`, a = A(aBed, 'a');
      const sh = bedState(env, aBed, seeds[0], d), sv = bedState(env, partner, seeds[1], difficultyOf(gi + 3));
      yield rec('h', { aBed, ...a, st: sh, label: 'holds', variant: 'flip', pairId, counterfactual: { swapped: true, from: partner, to: aBed, path: 'source_text' } });
      yield rec('v', { aBed, ...a, st: sv, label: 'violated', variant: 'flip', pairId, counterfactual: { swapped: true, from: aBed, to: partner, path: 'source_text' } });
      return;
    }
    case 'negpair': {                                              // negated framing: same family violates, another holds
      const { state, partner } = permPair(c.i), st = bedState(env, state, seeds[0], d), pairId = `bt:${key}`;
      for (const [role, aBed, label] of [['h', partner, 'holds'], ['v', state, 'violated']]) {
        yield rec(role, { aBed, ...A(aBed, role, { negated: true }), negated: true, st, label, variant: 'flip', pairId, counterfactual: { swapped: true, from: role === 'h' ? state : partner, to: aBed, path: 'assumption' }, extra: { negation: true } });
      }
      return;
    }
    case 'slot': {                                                 // two tasks in the state: the reference one is "not this one"
      const { state, partner } = permPair(c.i), ref = bedState(env, partner, seeds[1], difficultyOf(gi + 3)), pairId = `bt:${key}`;
      const st = bedState(env, state, seeds[0], d, { reference: ref });
      st.state = stateOf(st.task, { reference: ref.task });
      st.masks = maskTerms(st.state.source_text);
      for (const [role, aBed, label] of [['h', state, 'holds'], ['v', partner, 'violated']]) {
        yield rec(role, { aBed, ...A(aBed, role), st, label, variant: 'slot-swap', pairId, referenceKey: ref.worldKey, counterfactual: { swapped: true, from: role === 'h' ? partner : state, to: aBed, path: 'assumption' }, extra: { referenceBed: partner, referenceSeed: ref.seed } });
      }
      return;
    }
    case 'injection': {                                            // a clean item and its twin with a carrier urging the wrong option
      const { state, partner } = permPair(c.i), pairId = `bt:${key}`;
      const kind = (slice === 'test-ood' ? INJECTION_MIX_TEST : INJECTION_MIX_TRAIN)[c.i % 5];
      const aBed = kind === 'violated' ? partner : state;
      const st = kind === 'not_stated' ? noTaskState(env, aBed, seeds[0], `${key}|np`, bucket, { adjacent: c.i % 2 === 0 }) : bedState(env, state, seeds[0], d);
      const a = A(aBed, 'a'), urged = kind === 'holds' ? 'violated' : 'holds';
      const carrier = carrierFor(urged, env.bucket, `${key}|carrier`);
      const dirty = insertCarrier(st.state.source_text, carrier, key);
      const variant0 = kind === 'not_stated' ? 'unknowable' : 'clean';
      yield rec('clean', { aBed, ...a, st, label: kind, variant: variant0, pairId, counterfactual: null });
      yield rec('inj', { aBed, ...a, st, carrierState: dirty, label: kind, variant: 'injection', pairId, counterfactual: { swapped: false, inserted: 'carrier', urged, path: 'source_text' }, extra: { carrier: { urged, hash: spanHash(carrier) } } });
      return;
    }
    case 'notstated': {
      const aBed = c.held ? HELD_OUT_BEDS[c.i % 2] : TRAIN_BEDS[c.i % TRAIN_BEDS.length];
      const st = noTaskState(env, aBed, seeds[0], `${key}|np`, bucket, { adjacent: c.i % 2 === 0 });
      yield rec('n', { aBed, ...A(aBed, 'n'), st, label: 'not_stated', variant: 'unknowable', pairId: null });
      return;
    }
    case 'paraphrase': {
      const mix = c.i % 3, { state, partner } = permPair(c.i), label = ['holds', 'violated', 'not_stated'][mix];
      const aBed = label === 'violated' ? partner : state;
      const st = label === 'not_stated' ? noTaskState(env, aBed, seeds[0], `${key}|np`, bucket, { adjacent: true }) : bedState(env, state, seeds[0], d);
      yield rec('p', { aBed, ...A(aBed, 'a'), st, label, variant: 'paraphrase', paraphrase: true, pairId: null });
      return;
    }
    default: throw fail('PLAN', `unknown cluster kind ${c.kind}`);
  }
}

export const bucketOfSlice = slice => BUCKET_OF_SLICE[slice];

export async function* bedtypeRecords(slice, seeds, opts = {}, ctx) {
  const contract = ctx.contracts.X5;
  if (!contract) throw fail('CONTRACT', 'the X5 contract is not in the context');
  const rows = opts.rows?.X5?.[slice] ?? opts.rows?.X5 ?? DEFAULT_ROWS[slice];
  const plan = planBedtype(slice, typeof rows === 'number' ? rows : DEFAULT_ROWS[slice]);
  if (!plan.length) return;
  const need = plan.reduce((s, c) => s + seedsNeeded(c), 0);
  if (need > seeds.length) throw fail('SEEDS', `${slice}: the plan of ${plan.length} clusters needs ${need} seeds, ${seeds.length} given (shortfalls are reported, not padded: lower opts.rows.X5)`);
  const facts = await loadBedFacts(ctx.beds, { anchors: opts.readmeAnchors ?? README_ANCHORS, names: slice === 'test-ood' ? ALL_BEDS : TRAIN_BEDS.concat(HELD_OUT_BEDS) });
  const env = { facts, contract, slice, opts, bedSplit: ctx.slice.bedSplit, bucket: BUCKET_OF_SLICE[slice], trainSkel: trainSentenceSkeletons(facts) };
  if (HELD_OUT_BEDS.some(b => !facts[b])) throw fail('BED_FACTS', 'kinetics and runbook facts are needed (descriptions for the held-out family, prompts for its states)');
  let at = 0, gi = 0;
  for (const c of plan) {
    const n = seedsNeeded(c), mine = seeds.slice(at, at + n);
    at += n;
    yield* realizeCluster(env, c, mine, gi++);
  }
}

// ---- held-out spans for the span registry (§2.3 rule 7) ------------------------------------------------------------------------
// The sentences of kinetics and runbook prompt heads (state side) and of their descriptions and README paragraphs
// (assumption side): test-ood only. The assembly registers them with registry.add(text, {slice: 'heldout', ...}).
export function heldoutSpans(record) {
  const b = record.meta?.bedtype;
  if (!b) return [];
  const masks = record.meta.masks ?? { names: [], markers: [] }, out = [];
  for (const t of b.heldoutSpans ?? []) out.push({ text: t, port: 'X5', kind: 'family-span', masks });
  if (HELD.has(b.assumptionBed)) for (const s of sentences(b.assumptionText)) if (s.split(/\s+/).length >= 6) out.push({ text: s, port: 'X5', kind: 'family-description', masks: { names: [], markers: [] } });
  return out;
}
export function registerHeldout(registry, recs) {
  let n = 0;
  for (const r of recs) for (const s of heldoutSpans(r)) { registry.add(s.text, { slice: 'heldout', source: 'crossfamily-bedtype', port: s.port, kind: s.kind, names: s.masks.names, markers: s.masks.markers }); n++; }
  return n;
}
// The texts of the held-out family a train-like file must never contain (descriptions, README paragraphs): the question side.
export function heldoutTexts(facts) {
  return HELD_OUT_BEDS.flatMap(b => facts[b].texts.map(t => ({ bed: b, source: t.source, text: t.text.replace(/[.\s]+$/, '') })));
}

// The held-out family seen from the beds themselves: the sentences of the kinetics and runbook prompt heads over several dev worlds
// (so the registry covers the bed's own templates, not only the worlds one build happened to draw) and the held-out descriptions
// and README paragraphs. The assembly registers them with registry.add(text, {slice: 'heldout', ...}); a sentence that also occurs
// in a train bed's prompt is not family-specific and is left out.
export function heldoutHeadSpans(facts, { seeds = Array.from({ length: 30 }, (_, i) => 401 + i), difficulties = [1, 2, 3, 4, 5] } = {}) {
  const trainSkel = trainSentenceSkeletons(facts), out = [];
  for (const bed of HELD_OUT_BEDS) for (const d of difficulties) for (const seed of seeds) {
    const head = taskHead(facts[bed].generate({ seed, split: 'dev', difficulty: d })), masks = maskTerms(head);
    for (const text of sentences(promptPart(head))) if (text.length >= 40 && !trainSkel.has(skeleton(text))) out.push({ text, bed, masks, kind: 'family-span' });
  }
  for (const bed of HELD_OUT_BEDS) for (const t of facts[bed].texts) for (const text of sentences(t.text)) if (text.split(/\s+/).length >= 6) out.push({ text, bed, masks: { names: [], markers: [] }, kind: 'family-description' });
  return out;
}
export function registerHeldoutBeds(registry, facts, opts) {
  let n = 0;
  for (const x of heldoutHeadSpans(facts, opts)) { registry.add(x.text, { slice: 'heldout', source: 'crossfamily-bedtype', port: 'X5', kind: x.kind, names: x.masks.names, markers: x.masks.markers }); n++; }
  return n;
}
export function stats(records) {
  const out = { records: records.length, labels: {}, axes: {}, hard: 0, violated: 0, crossType: 0, forms: new Set(), states: new Set() };
  for (const r of records) {
    const q = Object.values(r.questions)[0];
    out.labels[q.label] = (out.labels[q.label] ?? 0) + Object.keys(r.questions).length;
    out.axes[r.meta.axis] = (out.axes[r.meta.axis] ?? 0) + Object.keys(r.questions).length;
    if (q.label === 'violated') { out.violated++; if (r.meta.hard) out.hard++; }
    if (r.meta.crossType) out.crossType++;
    out.forms.add(r.meta.formId); out.states.add(r.meta.stateHash ?? JSON.stringify(r.state));
  }
  return { ...out, forms: out.forms.size, states: out.states.size };
}
