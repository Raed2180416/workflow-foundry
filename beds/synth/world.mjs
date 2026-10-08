// Hidden world model for the `synth` bed: entities, documents, claims, notices and the
// resolution policy, plus the resolver that turns them into the accepted table.
// Trusted host code. Nothing in this module's objects is shown to a solver directly; the
// renderer turns the world into prose documents and a prompt.
import { rng } from '../lib/rng.mjs';
import {
  PROPS, KIND_PROPS, SYL, ALT_VOWEL, SUFFIX, DENY, SURNAMES, INITIALS, JOURNALS, PREPRINT_SERVERS,
  INSTITUTES, COMPANIES, VARIANTS, ENTITY_CLASS, ENTITY_ORIGIN, condFor,
} from './catalog.mjs';

export const VERSION = '3.0.0';

// Ranking policies. `order` is the lexicographic ranking key; `tiers` is 2 (journal above
// preprint = lab note) or 3 (journal > preprint > lab note). Press releases are tier 0.
export const POLICIES = {
  P1: { id: 'P1', order: ['venue', 'n', 'date'], tiers: 2 },
  P2: { id: 'P2', order: ['venue', 'date', 'n'], tiers: 2 },
  P3: { id: 'P3', order: ['n', 'venue', 'date'], tiers: 2 },
  P4: { id: 'P4', order: ['venue', 'n', 'date'], tiers: 3 },
};

// Cell features (traps and red herrings):
//   retracted, erratum, press, conditions, superseded, unit, rank, loser, pressOnly, concern, quoted,
//   distractor, variant, predicted, aliasOnly, nonstdSameDoc,
//   grossN        a same-rank competitor whose text gives a gross count ("20 prepared, 7 failed QC")
//                 that exceeds the winner's n although its net n is smaller,
//   nErratum      an erratum corrects a sample size, which flips the ranking,
//   erratumDecoy  an erratum on the winner corrects its NON-standard value (the standard value stands),
//   loserErratum  an erratum corrects a losing document (erratum targets are not always winners),
//   supersededLoser a losing document that has an earlier (void) version,
//   bound         a better-ranked document that only states a bound or a detection limit for the cell (not a value),
//   quoteInDoc    the winner quotes another value for the same cell in the sentence that gives its own,
//   comparison    the winner reports the same property for a comparator entity in the same sentence.

// Difficulty knobs. `mandatory` features are spread over the requested cells of every task;
// `extras` are per-cell probabilities on top. See README for the measured token sizes.
//   condLevel 1: short fixed condition lists; 2: parametric conditions (temperatures in °C/K/°F).
//   anaphora: probability that a later mention of a document's own entity is "the compound" etc.
//   nVariety: probability that a research document states its n as a gross count minus exclusions.
//   decoyP: probability that a notice target shares first author and venue with another document.
//   refStyles: how notices cite their target ('id' adds [document Dxx]; 'title', 'topic', 'date', 'vague', 'cite', 'bare').
//   decoyTemp: probability that a measured-claim sentence carries a qualifier with a number or temperature that is not the measurement (storage, calibration, pre-treatment).
//   protocols: probability that a document defines two named protocols (conditions given once) and its claims refer to them by name.
//   tables: probability that a document reports its measured claims in a small table (header with units / conditions).
//   replicates: probability that a measured value is given as the list of its replicate results (the mean is the claim).
//   factorErratum: probability that a value erratum is an arithmetic one ("too large by a factor of 10").
//   formVariety: extra sentence templates in every multi-value, erratum, status and sample-size family (a finite regex set does not cover them).
//   redHerrings: probability of status-like red herrings (version labels on single versions, banners
//                about journal submission, preprint mentions of out-of-corpus versions, measured-claim
//                sentences that cite other work or say "as expected", explicitly unmodified forms).
export const KNOBS = {
  1: {
    formVariety: true, decoyTemp: 0, protocols: 0, tables: 0, replicates: 0, factorErratum: 0, entities: 2, cells: 4, policies: ['P1'], aliasInPrompt: true, nInMeta: true, mixedLabels: false, mixedDates: false,
    unitLevel: 1, plusMinus: false, fancyNumbers: false, pairs: 0, spelledN: false, background: 1, entityFiller: 0, condLevel: 1,
    docDefault: 0, ranges: 0, methodNums: 0, contrast: 0, split: 0, addN: 0, durations: 0, unitWords: 0, anaphora: 0, nVariety: 0, decoyP: 0, refStyles: ['id'], redHerrings: 0, otherErrata: 0, oocCollide: false,
    filler: { retract: 0, errata: 0, press: 0, supersede: 0 }, ooc: 0, erratumOnVoid: false, unitErratum: false, injection: false,
    mandatory: ['retracted', 'erratum', 'press', 'conditions', 'superseded', 'unit', 'rank'],
    extras: { loser: 0.3 }, attachP: 0.2,
  },
  2: {
    formVariety: true, decoyTemp: 0.1, protocols: 0, tables: 0, replicates: 0.08, factorErratum: 0, entities: 3, cells: 6, policies: ['P1'], aliasInPrompt: true, nInMeta: true, mixedLabels: false, mixedDates: false,
    unitLevel: 2, plusMinus: false, fancyNumbers: false, pairs: 0, spelledN: false, background: 1, entityFiller: 1, condLevel: 2,
    docDefault: 0.05, ranges: 0.05, methodNums: 0.1, contrast: 0.1, split: 0.1, addN: 0.1, durations: 0.15, unitWords: 0.1, anaphora: 0.25, nVariety: 0.15, decoyP: 0.2, refStyles: ['id'], redHerrings: 0.1, otherErrata: 0, oocCollide: false,
    filler: { retract: 1, errata: 1, press: 0, supersede: 0 }, ooc: 0, erratumOnVoid: false, unitErratum: false, injection: false,
    mandatory: ['pressOnly', 'retracted', 'erratum', 'press', 'conditions', 'superseded', 'unit', 'rank'],
    extras: { loser: 0.3, press: 0.15, conditions: 0.15, nonstdSameDoc: 0.25, loserErratum: 0.1 }, attachP: 0.25,
  },
  3: {
    formVariety: true, decoyTemp: 0.2, protocols: 0.3, tables: 0.3, replicates: 0.15, factorErratum: 0.3, entities: 4, cells: 9, policies: ['P1', 'P2', 'P3', 'P4'], aliasInPrompt: false, nInMeta: false, mixedLabels: true, mixedDates: true,
    unitLevel: 2, plusMinus: true, fancyNumbers: false, pairs: 0.5, spelledN: false, background: 1, entityFiller: 1, condLevel: 2,
    docDefault: 0.25, ranges: 0.12, methodNums: 0.3, contrast: 0.3, split: 0.25, addN: 0.2, durations: 0.3, unitWords: 0.15, anaphora: 0.4, nVariety: 0.35, decoyP: 0.6, refStyles: ['title', 'topic', 'date', 'vague', 'cite', 'bare'], redHerrings: 0.3, otherErrata: 1, oocCollide: false,
    filler: { retract: 1, errata: 1, press: 1, supersede: 1 }, ooc: 1, erratumOnVoid: false, unitErratum: false, injection: false,
    mandatory: ['pressOnly', 'retracted', 'erratum', 'press', 'conditions', 'superseded', 'unit', 'rank', 'concern', 'quoted', 'distractor', 'aliasOnly',
      'grossN', 'erratumDecoy', 'comparison', 'bound'],
    extras: { bound: 0.1, quoteInDoc: 0.3, comparison: 0.1, loser: 0.2, press: 0.1, conditions: 0.1, retracted: 0.1, rank: 0.15, quoted: 0.1, aliasOnly: 0.3, nonstdSameDoc: 0.3, erratum: 0.08,
      nErratum: 0.1, loserErratum: 0.12, supersededLoser: 0.12 },
    attachP: 0.3,
  },
  4: {
    formVariety: true, decoyTemp: 0.25, protocols: 0.35, tables: 0.4, replicates: 0.18, factorErratum: 0.35, entities: 5, cells: 12, policies: ['P1', 'P2', 'P3', 'P4'], aliasInPrompt: false, nInMeta: false, mixedLabels: true, mixedDates: true,
    unitLevel: 3, plusMinus: true, fancyNumbers: true, pairs: 0.6, spelledN: true, background: 2, entityFiller: 1, condLevel: 2,
    docDefault: 0.3, ranges: 0.15, methodNums: 0.35, contrast: 0.3, split: 0.3, addN: 0.2, durations: 0.35, unitWords: 0.2, anaphora: 0.45, nVariety: 0.4, decoyP: 0.7, refStyles: ['title', 'topic', 'date', 'vague', 'cite', 'bare'], redHerrings: 0.35, otherErrata: 1, oocCollide: true,
    filler: { retract: 2, errata: 1, press: 1, supersede: 1 }, ooc: 1, erratumOnVoid: true, unitErratum: true, injection: false,
    mandatory: ['pressOnly', 'retracted', 'erratum', 'press', 'conditions', 'superseded', 'unit', 'rank', 'concern', 'quoted', 'distractor',
      'aliasOnly', 'variant', 'predicted', 'distractor', 'grossN', 'erratumDecoy', 'nErratum', 'comparison', 'quoteInDoc', 'bound'],
    extras: { bound: 0.08, quoteInDoc: 0.2, comparison: 0.1, loser: 0.1, press: 0.06, conditions: 0.06, retracted: 0.05, rank: 0.12, quoted: 0.06, aliasOnly: 0.35, variant: 0.04, predicted: 0.04,
      nonstdSameDoc: 0.3, erratum: 0.06, loserErratum: 0.06, supersededLoser: 0.06 },
    attachP: 0.3,
  },
  5: {
    formVariety: true, decoyTemp: 0.25, protocols: 0.35, tables: 0.4, replicates: 0.18, factorErratum: 0.35, entities: 6, cells: 16, policies: ['P1', 'P2', 'P3', 'P4'], aliasInPrompt: false, nInMeta: false, mixedLabels: true, mixedDates: true,
    unitLevel: 3, plusMinus: true, fancyNumbers: true, pairs: 0.6, spelledN: true, background: 1, entityFiller: 1, condLevel: 2,
    docDefault: 0.3, ranges: 0.15, methodNums: 0.35, contrast: 0.3, split: 0.3, addN: 0.2, durations: 0.35, unitWords: 0.2, anaphora: 0.5, nVariety: 0.4, decoyP: 0.7, refStyles: ['title', 'topic', 'date', 'vague', 'cite', 'bare'], redHerrings: 0.35, otherErrata: 1, oocCollide: true,
    filler: { retract: 2, errata: 1, press: 1, supersede: 1 }, ooc: 1, erratumOnVoid: true, unitErratum: true, injection: true,
    mandatory: ['pressOnly', 'retracted', 'erratum', 'press', 'conditions', 'superseded', 'unit', 'rank', 'concern', 'quoted', 'distractor',
      'aliasOnly', 'variant', 'predicted', 'distractor', 'retracted', 'erratum', 'grossN', 'erratumDecoy', 'nErratum', 'comparison', 'quoteInDoc', 'bound'],
    extras: { bound: 0.08, quoteInDoc: 0.2, comparison: 0.1, loser: 0.08, press: 0.05, conditions: 0.05, retracted: 0.03, rank: 0.1, quoted: 0.05, aliasOnly: 0.4, variant: 0.03, predicted: 0.03,
      nonstdSameDoc: 0.3, erratum: 0.04, loserErratum: 0.05, supersededLoser: 0.05 },
    attachP: 0.3,
  },
};

// Features that need a sample-size comparison; meaningless under P2 (n only breaks date ties).
const N_FEATURES = new Set(['grossN', 'nErratum']);

// ---------------------------------------------------------------------------------------
// Units and numbers
export const unitOf = (prop, id) => {
  const u = PROPS[prop].units.find(x => x.id === id);
  if (!u) throw new Error(`unknown unit ${id} for ${prop}`);
  return u;
};
export const toCanon = (prop, value, unitId) => { const u = unitOf(prop, unitId); return value * u.f + u.o; };
export const sig = (x, s = 3) => Number(x.toPrecision(s));
export const fromCanon = (prop, canon, unitId) => { const u = unitOf(prop, unitId); return sig((canon - u.o) / u.f); };
export const relDiff = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-12);
const isTrivialUnit = u => u.f === 1 && u.o === 0;

function unitPool(prop, level) {
  const us = PROPS[prop].units;
  if (level >= 3) return us;
  if (level === 2) return us.filter(u => !u.sci);
  return us.filter((u, i) => i < 3 && !u.sci);
}

// ---------------------------------------------------------------------------------------
// Dates (UTC day numbers)
const DAY = 86400000;
export const dayNum = (y, m, d) => Date.UTC(y, m - 1, d) / DAY;
export const fromDay = n => { const dt = new Date(n * DAY); return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() }; };

// ---------------------------------------------------------------------------------------
// Policy ranking
export function tierOf(kind, policy) {
  if (kind === 'journal') return policy.tiers === 3 ? 3 : 2;
  if (kind === 'preprint') return policy.tiers === 3 ? 2 : 1;
  if (kind === 'labnote') return 1;
  return 0; // press
}
const tier3 = kind => ({ journal: 3, preprint: 2, labnote: 1, press: 0 })[kind];
// `nOf` lets the near-miss controls read a wrong sample size (gross or misprinted).
export function rankKey(doc, policy, nOf = d => d.n) {
  return policy.order.map(k => (k === 'venue' ? tierOf(doc.kind, policy) : k === 'n' ? (nOf(doc) ?? 0) : doc.date));
}
export function cmpKeys(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; }

export const SOURCE_KINDS = new Set(['journal', 'preprint', 'labnote', 'press']);
export const isResearch = d => ['journal', 'preprint', 'labnote'].includes(d.kind);

// ---------------------------------------------------------------------------------------
// Resolver. `o` switches individual judgment steps off; it is used by the reference solver
// (no options) and by the near-miss bad controls.
export function resolve(world, o = {}) {
  const docs = world.docMap;
  const retracted = new Set(world.retractions.filter(x => x.target).map(x => x.target));
  if (o.concernVoids) for (const c of world.concerns) retracted.add(c.target);
  if (o.phantomApplied) for (const x of world.retractions) if (x.phantom && x.phantom.collide) retracted.add(x.phantom.collide);
  const superseded = new Set(world.supersessions.map(x => x.old));
  const voidSet = new Set([...(o.keepRetracted ? [] : retracted), ...(o.keepSuperseded ? [] : superseded)]);
  // Errata correct one specific claim (identified by cid). `erratumByDoc` is the near miss that
  // applies a correction to the standard claim of the same document, entity and property.
  const corr = new Map(), byDoc = new Map();
  if (!o.skipErrata) {
    for (const e of world.errata) {
      if (e.kind !== 'value' && e.kind !== 'unit' && e.kind !== 'factor') continue;
      corr.set(e.cid, e);
      byDoc.set(`${e.target}|${e.ent}|${e.prop}`, e);
    }
  }
  const nOf = d => (o.printedN ? (d.nPrinted ?? d.n) : o.grossN ? (d.nGross ?? d.n) : d.n);
  const policy = o.policy || world.policy;
  const cells = world.requested.map(cell => {
    let cands = world.claims.filter(c => c.prop === cell.prop && c.ent === cell.ent
      && (o.anyMode || c.mode === 'measured') && (o.ignoreConditions || c.cond === 'std') && (o.allowVariants || !c.variant)
      && SOURCE_KINDS.has(docs.get(c.doc).kind) && !voidSet.has(c.doc));
    cands = cands.map(c => {
      if (c.mode !== 'measured' || c.cond !== 'std' || c.variant) return c;
      const e = corr.get(c.cid) || (o.erratumByDoc ? byDoc.get(`${c.doc}|${c.ent}|${c.prop}`) : null);
      return e ? { ...c, value: e.value, unit: e.unit, corrected: e.doc } : c;
    });
    if (o.pressTrusted) {
      const press = cands.filter(c => docs.get(c.doc).kind === 'press');
      if (press.length) cands = press;
    } else if (!o.noPressRule && cands.some(c => docs.get(c.doc).kind !== 'press')) {
      cands = cands.filter(c => docs.get(c.doc).kind !== 'press');
    }
    const key = c => (o.recencyOnly ? [docs.get(c.doc).date] : rankKey(docs.get(c.doc), policy, nOf));
    const sorted = [...cands].sort((a, b) => cmpKeys(key(b), key(a)) || (docs.get(a.doc).id < docs.get(b.doc).id ? -1 : 1));
    const win = sorted[0] || null;
    const vals = sorted.map(c => toCanon(c.prop, c.value, c.unit));
    let conflict = false;
    for (let i = 0; i < vals.length; i++) for (let j = i + 1; j < vals.length; j++) if (sorted[i].doc !== sorted[j].doc && relDiff(vals[i], vals[j]) > 0.01) conflict = true;
    return {
      ent: cell.ent, prop: cell.prop, win,
      value: win ? (o.noConvert ? win.value : toCanon(win.prop, win.value, win.unit)) : null,
      src: win ? win.doc : null,
      candidates: sorted.map(c => c.doc),
      conflict: conflict && new Set(sorted.map(c => c.doc)).size >= 2,
    };
  });
  const realRetracted = new Set(world.retractions.filter(x => x.target).map(x => x.target));
  const excluded = [...new Set([...realRetracted, ...superseded])];
  return { cells, excluded, retracted: [...realRetracted], superseded: [...superseded], voided: [...new Set([...retracted, ...superseded])] };
}

// Turn a resolution into the answer JSON (doc keys -> public ids, entity keys -> names).
export function toOutput(world, res, { excluded = res.excluded, citeErratum = false } = {}) {
  const ent = k => world.entMap.get(k).name;
  const id = k => world.docMap.get(k).id;
  return {
    table: res.cells.map(c => ({ entity: ent(c.ent), property: c.prop, value: c.value, source_doc_id: c.src ? id(citeErratum && c.win.corrected ? c.win.corrected : c.src) : '' })),
    conflicts: res.cells.filter(c => c.conflict).map(c => ({ entity: ent(c.ent), property: c.prop, doc_ids: [...new Set(c.candidates)].map(id).sort() })),
    excluded_doc_ids: excluded.map(id).sort(),
  };
}

// ---------------------------------------------------------------------------------------
// World construction
export function buildWorld(seed, split, difficulty, attempt = 0) {
  const r = rng('synth', VERSION, split, seed, difficulty, attempt);
  const K = KNOBS[difficulty];
  if (!K) throw new Error(`difficulty must be 1..5, got ${difficulty}`);
  const world = {
    seed, split, difficulty, K, policy: POLICIES[r.pick(K.policies)], entities: [], docs: [], claims: [], errata: [], retractions: [],
    concerns: [], supersessions: [], requested: [], constraints: [], injection: null,
  };
  const used = new Set();
  let docCounter = 0;

  // --- entities ---------------------------------------------------------------------
  const kindsCycle = ['compound', 'material', 'organism'];
  const k0 = r.int(0, 2);
  const mkEntity = (kind, extra = {}) => {
    const nm = makeNames(r, kind, used);
    const e = {
      key: `e${world.entities.length}`, kind, ...nm, requested: false, distractorOf: null, background: false,
      cls: r.pick(ENTITY_CLASS[kind]), origin: r.pick(ENTITY_ORIGIN[kind]), company: r.pick(COMPANIES[kind]), institute: r.pick(INSTITUTES), ...extra,
    };
    world.entities.push(e);
    return e;
  };
  const reqEnts = [];
  for (let i = 0; i < K.entities; i++) reqEnts.push(mkEntity(kindsCycle[(k0 + i) % 3], { requested: true }));

  // requested cells: spread K.cells over the entities, max 3 per entity
  const per = reqEnts.map(() => 0);
  for (let i = 0; i < K.cells; i++) per[i % reqEnts.length]++;
  const shuffledPer = r.shuffle(per);
  reqEnts.forEach((e, i) => {
    const props = r.sample(KIND_PROPS[e.kind], Math.min(3, shuffledPer[i]));
    for (const p of props) world.requested.push({ ent: e.key, prop: p, feats: new Set() });
  });
  world.requested = r.shuffle(world.requested);

  // --- feature assignment -----------------------------------------------------------
  const pol = world.policy;
  const P3 = pol.id === 'P3';
  const JOURNAL_W = ['erratum', 'concern', 'erratumDecoy', 'loserErratum'];
  const compatible = (cell, f) => {
    const fs = cell.feats;
    if (['aliasOnly', 'pressOnly', 'distractor'].includes(f) && fs.has(f)) return false;
    if (fs.has('pressOnly') && ['erratum', 'superseded', 'rank', 'press', 'loser', 'concern', 'nonstdSameDoc', 'grossN', 'nErratum', 'erratumDecoy',
      'loserErratum', 'supersededLoser', 'quoteInDoc', 'comparison', 'bound'].includes(f)) return false;
    if (f === 'pressOnly' && fs.size) return false;
    if (N_FEATURES.has(f) && (pol.id === 'P2' || [...N_FEATURES].some(x => fs.has(x)))) return false;
    // under P3 a 'rank' cell has a non-journal winner; features that need a journal winner clash
    if (P3 && f === 'rank' && JOURNAL_W.some(x => fs.has(x))) return false;
    if (P3 && JOURNAL_W.includes(f) && fs.has('rank')) return false;
    if ((f === 'erratumDecoy' && fs.has('erratum')) || (f === 'erratum' && fs.has('erratumDecoy'))) return false;
    if (f === 'distractor' && world.requested.some(c => c !== cell && c.ent === cell.ent && c.feats.has('distractor'))) return false;
    return true;
  };
  const cells = world.requested;
  const off = r.int(0, cells.length - 1);
  const repeatable = new Set(['retracted', 'erratum', 'grossN']);
  for (const f of K.mandatory) {
    if (N_FEATURES.has(f) && pol.id === 'P2') continue; // n never decides under P2
    const cands = cells.map((c, i) => cells[(i + off) % cells.length]).filter(c => compatible(c, f) && (!c.feats.has(f) || repeatable.has(f)));
    const pool = cands.filter(c => !c.feats.has(f));
    const choose = (pool.length ? pool : cands).sort((a, b) => a.feats.size - b.feats.size)[0];
    if (!choose) throw new Error(`cannot place feature ${f}`);
    choose.feats.add(f);
  }
  for (const c of cells) for (const [f, p] of Object.entries(K.extras)) if (!c.feats.has(f) && compatible(c, f) && r.chance(p)) c.feats.add(f);

  // --- document helpers -------------------------------------------------------------
  const authorsFor = () => {
    const k = r.int(2, 5);
    return r.sample(SURNAMES, k).map(s => `${r.pick(INITIALS)}.${r.chance(0.3) ? ` ${r.pick(INITIALS)}.` : ''} ${s}`);
  };
  const venueFor = (kind, entKind, inst) => {
    if (kind === 'journal') return r.pick(JOURNALS[entKind]);
    if (kind === 'preprint') return r.pick(PREPRINT_SERVERS);
    if (kind === 'labnote') return inst;
    return null;
  };
  const newDoc = (kind, ent, extra = {}) => {
    const inst = r.pick(INSTITUTES);
    const d = {
      key: `k${docCounter++}`, kind, ent: ent ? ent.key : null, date: 0, n: null, authors: authorsFor(), inst,
      venue: venueFor(kind, ent ? ent.kind : 'compound', inst), naming: 'name', version: null, role: 'filler', ...extra,
    };
    world.docs.push(d);
    return d;
  };
  const docOf = key => world.docs.find(d => d.key === key);
  const base = () => r.int(dayNum(2017, 3, 1), dayNum(2023, 9, 30));
  const after = (d, lo = 20, hi = 420) => d.date + r.int(lo, hi);
  const before = (d, lo = 20, hi = 420) => d.date - r.int(lo, hi);
  const order = (a, b) => world.constraints.push([a.key, b.key]);
  const logUniform = ([lo, hi]) => Math.exp(r.float(Math.log(lo), Math.log(hi)));
  const truthFor = P => (P.tempLike ? r.float(P.range[0], P.range[1]) : logUniform(P.range));
  const perturb = (prop, truth, lo = 0.08, hi = 0.45) => {
    const P = PROPS[prop];
    const u = P.tempLike ? r.float(0.06, 0.25) : r.float(lo, hi);
    return r.chance(0.5) ? truth * (1 + u) : truth / (1 + u);
  };
  const pickUnit = (prop, pCanon = 0.5) => {
    const pool = unitPool(prop, K.unitLevel);
    if (r.chance(pCanon)) return pool[0].id;
    return r.pick(pool.slice(1)).id;
  };
  const pickNontrivial = (prop, canon) => {
    const pool = unitPool(prop, K.unitLevel).filter(u => !isTrivialUnit(u) && relDiff(fromCanon(prop, canon, u.id), canon) > 0.05);
    return r.pick(pool).id;
  };
  const addClaim = (doc, ent, prop, canon, unit, extra = {}) => {
    const c = {
      cid: world.claims.length, doc: doc.key, ent: ent.key, prop, value: fromCanon(prop, canon, unit), unit, cond: 'std', condText: null, mode: 'measured', variant: null,
      sd: r.float(0.015, 0.07), ...extra,
    };
    if (c.condText == null) c.condText = condFor(prop, c.cond !== 'non', r, K.condLevel);
    world.claims.push(c);
    return c;
  };
  const stdClaimOf = (doc, ent, prop) => world.claims.find(c => c.doc === doc.key && c.ent === ent.key && c.prop === prop && c.mode === 'measured' && c.cond === 'std' && !c.variant);
  const addValueErratum = (T, claim, newValue, extra = {}) => {
    const ent = world.entities.find(e => e.key === claim.ent);
    const E = newDoc('erratum', ent, { role: 'notice', venue: T.venue, authors: T.authors });
    E.date = after(T, 15, 300); order(T, E);
    world.errata.push({
      doc: E.key, target: T.key, kind: 'value', cid: claim.cid, ent: claim.ent, prop: claim.prop, oldValue: claim.value, oldUnit: claim.unit,
      value: newValue, unit: claim.unit, condText: claim.condText, ...extra,
    });
    return E;
  };
  // A trap document that would beat W under the policy if its claim were (wrongly) accepted.
  // Its date is before or after W unless the policy needs recency to make it win.
  const beater = (W, ent, kinds = null) => {
    const allowed = (kinds || ['journal', 'preprint', 'labnote']).filter(k => tier3(k) >= tier3(W.kind));
    const kind = r.pick(allowed.length ? allowed : ['journal']);
    const d = newDoc(kind, ent, { role: 'trap' });
    const higher = tierOf(kind, pol) > tierOf(W.kind, pol);
    d.n = P3 || (!higher && pol.id !== 'P2') ? (W.n ?? 0) + r.int(2, 22) : r.int(3, 40);
    if ((pol.id === 'P2' && !higher) || r.chance(0.5)) { d.date = after(W); order(W, d); } else { d.date = before(W); order(d, W); }
    return d;
  };
  // A document that loses to W under every policy (no higher tier, smaller n, older).
  const mkLoser = (W, ent, prop, truth, kinds = null) => {
    const ks = (kinds || ['journal', 'preprint', 'labnote']).filter(k => tier3(k) <= tier3(W.kind));
    if (!ks.length || W.n == null || W.n < 4) return null;
    const L = newDoc(r.pick(ks), ent, { role: 'loser' });
    L.n = r.int(3, W.n - 1);
    L.date = before(W, 20, 500); order(L, W);
    addClaim(L, ent, prop, perturb(prop, truth), pickUnit(prop));
    return L;
  };
  // An earlier version of X (void once X exists): journal <- preprint, or preprint/memo v1 <- v2.
  const addOldVersion = (X, ent, prop, near) => {
    let S;
    if (X.kind === 'journal') { S = newDoc('preprint', ent, { role: 'superseded', authors: X.authors }); S.date = before(X, 60, 420); }
    else { S = newDoc(X.kind, ent, { role: 'superseded', venue: X.venue, inst: X.inst, authors: X.authors }); S.date = before(X, 30, 300); S.version = 1; X.version = 2; }
    S.n = Math.max(3, (X.n ?? 10) + r.int(-4, 8));
    S.naming = X.naming === 'alias' ? 'alias' : r.pick(['name', 'both']);
    order(S, X);
    addClaim(S, ent, prop, perturb(prop, near, 0.08, 0.25), pickUnit(prop));
    world.supersessions.push({ old: S.key, new: X.key, style: X.kind === 'journal' ? r.pick(['new-says', 'banner']) : 'version' });
    return S;
  };
  // A competitor of the same rank level as W (any level under P3) with a smaller true n.
  const mkCompetitor = (W, ent, prop, truth, journalOnly, nMin = 3) => {
    let kinds = P3 ? ['journal', 'preprint', 'labnote'] : pol.tiers === 3 ? [W.kind] : W.kind === 'journal' ? ['journal'] : ['preprint', 'labnote'];
    if (journalOnly) kinds = kinds.filter(k => k === 'journal');
    if (!kinds.length || W.n == null || W.n <= nMin) return null;
    const C = newDoc(r.pick(kinds), ent, { role: 'ntrap' });
    C.n = r.int(nMin, W.n - 1);
    C.date = r.chance(0.5) ? after(W) : before(W);
    addClaim(C, ent, prop, perturb(prop, truth), pickUnit(prop));
    return C;
  };
  const distractorFor = ent => {
    if (ent.distractor) return world.entMapTmp.get(ent.distractor);
    const dn = nearNames(r, ent, used);
    const d = mkEntity(ent.kind, { ...dn, distractorOf: ent.key, cls: ent.cls, origin: r.pick(ENTITY_ORIGIN[ent.kind]) });
    ent.distractor = d.key;
    world.entMapTmp.set(d.key, d);
    return d;
  };
  world.entMapTmp = new Map();
  const comparators = {};
  const comparatorFor = ent => (comparators[ent.kind] ||= mkEntity(ent.kind, { background: true, comparator: true }));
  const isVoidRole = d => ['retracted', 'superseded'].includes(d.role);
  const cellDocsOf = (ent, prop) => world.docs.filter(d => isResearch(d) && world.claims.some(c => c.doc === d.key && c.ent === ent.key && c.prop === prop));

  // --- per-cell construction ------------------------------------------------------------
  for (const cell of cells) {
    const f = cell.feats, prop = cell.prop, P = PROPS[prop];
    const ent = world.entities.find(e => e.key === cell.ent);
    const truth = truthFor(P);
    let wKind;
    if (f.has('pressOnly')) wKind = 'press';
    else if (f.has('rank') && P3) wKind = r.chance(0.6) ? 'preprint' : 'labnote';
    else if (f.has('rank') || JOURNAL_W.some(x => f.has(x)) || (f.has('nErratum') && !P3)) wKind = 'journal';
    else wKind = r.chance(0.55) ? 'journal' : r.chance(0.65) ? 'preprint' : 'labnote';
    const W = newDoc(wKind, ent, { role: 'winner' });
    W.date = base();
    W.n = wKind === 'press' ? null : (f.has('rank') && P3 ? r.int(16, 40) : r.int(5, 30));
    if (f.has('aliasOnly')) W.naming = 'alias';
    cell.W = W.key;
    const unit = f.has('unit') ? pickNontrivial(prop, truth) : pickUnit(prop, difficulty === 1 ? 0.7 : 0.5);
    let wClaim;
    if (f.has('erratum')) {
      const unitErr = K.unitErratum && r.chance(0.4)
        && unitPool(prop, K.unitLevel).some(u => u.id !== unit && relDiff(toCanon(prop, fromCanon(prop, truth, unit), u.id), truth) > 0.08);
      if (unitErr) {
        const x = fromCanon(prop, truth, unit);
        const wrong = r.pick(unitPool(prop, K.unitLevel).filter(u => u.id !== unit && relDiff(toCanon(prop, x, u.id), truth) > 0.08)).id;
        wClaim = addClaim(W, ent, prop, truth, unit);
        wClaim.value = x; wClaim.unit = wrong;
        addValueErratum(W, wClaim, x, { kind: 'unit', unit });
      } else if (K.factorErratum && !P.tempLike && r.chance(K.factorErratum)) {
        // arithmetic erratum: the printed value is too large (or too small) by a factor; the new value is old / factor
        const F = r.pick([2, 5, 10, 100, 1000]), up = r.chance(0.5);
        wClaim = addClaim(W, ent, prop, up ? truth * F : truth / F, unit);
        addValueErratum(W, wClaim, fromCanon(prop, truth, unit), { kind: 'factor', factor: F, up });
      } else {
        wClaim = addClaim(W, ent, prop, perturb(prop, truth, 0.09, 0.4), unit);
        addValueErratum(W, wClaim, fromCanon(prop, truth, unit));
      }
    } else {
      wClaim = addClaim(W, ent, prop, truth, unit);
    }
    if (f.has('nonstdSameDoc') || f.has('erratumDecoy')) addClaim(W, ent, prop, perturb(prop, truth), pickUnit(prop), { cond: 'non' });
    if (f.has('superseded')) addOldVersion(W, ent, prop, truth);
    if (f.has('retracted')) {
      const R = beater(W, ent, ['journal', 'preprint']);
      R.role = 'retracted';
      addClaim(R, ent, prop, perturb(prop, truth), pickUnit(prop));
      const RN = newDoc('retraction', ent, { role: 'notice', venue: R.venue });
      RN.date = after(R, 20, 400); order(R, RN);
      world.retractions.push({ doc: RN.key, target: R.key, reason: r.int(0, 99) });
    }
    if (f.has('conditions')) {
      const N = beater(W, ent);
      addClaim(N, ent, prop, perturb(prop, truth), pickUnit(prop), { cond: 'non' });
    }
    if (f.has('rank')) {
      let L;
      if (P3) { L = newDoc('journal', ent); L.n = r.int(3, Math.max(3, W.n - 3)); }
      else if (W.kind === 'journal') { L = newDoc(r.pick(['preprint', 'labnote']), ent); L.n = pol.id === 'P2' ? r.int(3, 45) : W.n + r.int(2, 25); }
      else { L = newDoc('labnote', ent); L.n = W.n + r.int(2, 25); }
      L.date = after(W); order(W, L);
      L.role = 'rank';
      addClaim(L, ent, prop, perturb(prop, truth), pickUnit(prop));
    }
    if (f.has('loser')) mkLoser(W, ent, prop, truth);
    if (f.has('grossN')) {
      const C = mkCompetitor(W, ent, prop, truth, false);
      if (C) { C.nGross = W.n + r.int(1, 12); C.grossOver = W.key; }
    }
    if (f.has('nErratum')) {
      // (a) a competitor's printed n is too large, or (b) the winner's printed n is too small.
      const deflateW = W.kind === 'journal' && W.n >= 6 && r.chance(0.5);
      const C = mkCompetitor(W, ent, prop, truth, !deflateW, deflateW ? 4 : 3);
      if (C) {
        const T = deflateW ? W : C;
        T.nPrinted = deflateW ? r.int(3, C.n - 1) : W.n + r.int(1, 12);
        const E = newDoc('erratum', ent, { role: 'notice', venue: T.venue, authors: T.authors });
        E.date = after(T, 15, 300); order(T, E);
        world.errata.push({ doc: E.key, target: T.key, kind: 'n', ent: ent.key, prop, nOld: T.nPrinted, nNew: T.n });
      }
    }
    if (f.has('erratumDecoy')) {
      const nc = world.claims.find(c => c.doc === W.key && c.ent === ent.key && c.prop === prop && c.cond === 'non' && c.mode === 'measured');
      let nv = perturb(prop, toCanon(prop, nc.value, nc.unit), 0.08, 0.3);
      for (let k = 0; k < 8 && relDiff(nv, truth) < 0.05; k++) nv = perturb(prop, toCanon(prop, nc.value, nc.unit), 0.08, 0.3);
      addValueErratum(W, nc, fromCanon(prop, nv, nc.unit));
    }
    if (f.has('loserErratum')) {
      const L = mkLoser(W, ent, prop, truth, ['journal']);
      if (L) { const lc = stdClaimOf(L, ent, prop); addValueErratum(L, lc, fromCanon(prop, perturb(prop, toCanon(prop, lc.value, lc.unit), 0.08, 0.3), lc.unit)); }
    }
    if (f.has('supersededLoser')) {
      const L = mkLoser(W, ent, prop, truth);
      if (L) { const lc = stdClaimOf(L, ent, prop); addOldVersion(L, ent, prop, toCanon(prop, lc.value, lc.unit)); }
    }
    if (f.has('quoteInDoc')) {
      const echo = world.claims.filter(c => c.ent === ent.key && c.prop === prop && c.mode === 'measured' && c.cond === 'std' && !c.variant
        && c.doc !== W.key && isResearch(docOf(c.doc)) && docOf(c.doc).date < W.date - 30);
      const src = echo.length && r.chance(0.6) ? r.pick(echo) : null;
      addClaim(W, ent, prop, src ? toCanon(prop, src.value, src.unit) : perturb(prop, truth), src ? src.unit : pickUnit(prop),
        { mode: 'quoted', condText: wClaim.condText, quoteWith: wClaim.cid, quoteDoc: src ? src.doc : null, quoteOf: src ? null : `${r.pick(INITIALS)}. ${r.pick(SURNAMES)}`, quoteYearsBack: r.int(1, 4) });
    }
    if (f.has('comparison')) {
      addClaim(W, comparatorFor(ent), prop, perturb(prop, truth, 0.1, 0.6), pickUnit(prop), { condText: wClaim.condText, compareWith: wClaim.cid });
    }
    if (f.has('quoted')) {
      const Q = beater(W, ent);
      // the quoted value echoes some document of this cell (any role) or an unseen paper
      const echo = world.claims.filter(c => c.ent === ent.key && c.prop === prop && c.mode === 'measured' && c.cond === 'std' && !c.variant
        && isResearch(docOf(c.doc)) && docOf(c.doc).date < Q.date - 30);
      const src = echo.length && r.chance(0.65) ? r.pick(echo) : null;
      addClaim(Q, ent, prop, src ? toCanon(prop, src.value, src.unit) : perturb(prop, truth), src ? src.unit : pickUnit(prop),
        { mode: 'quoted', quoteDoc: src ? src.doc : null, quoteOf: src ? null : `${r.pick(INITIALS)}. ${r.pick(SURNAMES)}`, quoteYearsBack: r.int(1, 4) });
      addClaim(Q, ent, prop, perturb(prop, truth), pickUnit(prop), { cond: 'non' });
    }
    if (f.has('predicted')) {
      const Pd = beater(W, ent);
      addClaim(Pd, ent, prop, perturb(prop, truth), pickUnit(prop), { mode: 'predicted' });
    }
    if (f.has('bound')) {
      const B = beater(W, ent);
      addClaim(B, ent, prop, perturb(prop, truth), pickUnit(prop), { mode: 'bound', boundDir: r.pick(['below', 'above']), boundStyle: r.int(0, 3) });
    }
    if (f.has('variant')) {
      const V = beater(W, ent);
      addClaim(V, ent, prop, perturb(prop, truth), pickUnit(prop), { variant: r.int(1, VARIANTS[ent.kind].length) });
    }
    if (f.has('distractor')) {
      const D = distractorFor(ent);
      const Dd = beater(W, D);
      Dd.mentionsOriginal = ent.key;
      addClaim(Dd, D, prop, perturb(prop, truth), pickUnit(prop));
    }
    if (f.has('concern')) {
      const pool = cellDocsOf(ent, prop).filter(d => d.kind === 'journal' && !isVoidRole(d));
      const T = r.chance(0.5) || !pool.length ? W : r.pick(pool);
      const C = newDoc('concern', ent, { role: 'notice', venue: T.venue });
      C.date = after(T, 30, 400); order(T, C);
      world.concerns.push({ doc: C.key, target: T.key, reason: r.int(0, 99) });
    }
    if (f.has('press')) {
      const cellDocs = world.docs.filter(d => d.ent === ent.key && SOURCE_KINDS.has(d.kind));
      const about = cellDocsOf(ent, prop);
      const PR = newDoc('press', ent, { role: 'press', about: about.length && r.chance(0.7) ? r.pick(about).key : null });
      PR.date = Math.max(...cellDocs.map(d => d.date)) + r.int(3, 90);
      for (const d of cellDocs) order(d, PR);
      const u = r.float(0.2, 0.7);
      const ex = P.better === 'down' ? truth / (1 + u) : truth * (1 + u);
      addClaim(PR, ent, prop, ex, pickUnit(prop, 0.6));
    }
  }

  // --- filler: unrequested properties of requested entities ---------------------------------
  const reqSet = new Set(world.requested.map(c => `${c.ent}|${c.prop}`));
  const unreqProps = e => KIND_PROPS[e.kind].filter(p => !reqSet.has(`${e.key}|${p}`));
  const fillerClaim = (doc, e, std = true) => {
    const ps = unreqProps(e);
    if (!ps.length) return null;
    const prop = r.pick(ps);
    if (world.claims.some(c => c.doc === doc.key && c.ent === e.key && c.prop === prop && c.cond === 'std' && c.mode === 'measured')) return null;
    return addClaim(doc, e, prop, truthFor(PROPS[prop]), pickUnit(prop), std ? {} : { cond: 'non' });
  };
  for (const d of [...world.docs]) {
    if (!isResearch(d) || !d.ent) continue;
    const e = world.entities.find(x => x.key === d.ent);
    if (r.chance(K.attachP)) fillerClaim(d, e, r.chance(0.75));
  }
  const fillerDocs = [];
  const mkFillerDoc = (e, kinds = ['journal', 'preprint', 'labnote']) => {
    const d = newDoc(r.pick(kinds), e, { role: 'filler' });
    d.date = base(); d.n = r.int(3, 36);
    d.naming = r.pick(['name', 'alias', 'both']);
    fillerClaim(d, e);
    if (r.chance(0.5)) fillerClaim(d, e, r.chance(0.6));
    fillerDocs.push(d);
    return d;
  };
  for (const e of reqEnts) for (let i = 0; i < K.entityFiller; i++) if (unreqProps(e).length) mkFillerDoc(e);
  // background entities (never requested): all their properties are unrequested
  for (let i = 0; i < K.background; i++) {
    const e = mkEntity(kindsCycle[r.int(0, 2)], { background: true });
    const nd = r.int(1, 2);
    for (let j = 0; j < nd; j++) mkFillerDoc(e);
  }
  // distractor entities also get a little unrelated material
  for (const e of world.entities.filter(x => x.distractorOf)) if (r.chance(0.5)) mkFillerDoc(e);

  // filler status events (they count for excluded_doc_ids, which covers the whole corpus)
  const hasClaims = d => world.claims.some(c => c.doc === d.key);
  const fillerPool = () => r.shuffle(fillerDocs.filter(d => isResearch(d) && d.role === 'filler' && hasClaims(d)));
  for (let i = 0; i < K.filler.retract; i++) {
    const d = fillerPool().find(x => x.kind !== 'labnote');
    if (!d) break;
    d.role = 'retracted';
    const RN = newDoc('retraction', world.entities.find(e => e.key === d.ent), { role: 'notice', venue: d.venue });
    RN.date = after(d, 20, 400); order(d, RN);
    world.retractions.push({ doc: RN.key, target: d.key, reason: r.int(0, 99) });
  }
  for (let i = 0; i < K.filler.errata; i++) {
    const d = fillerPool().find(x => x.kind === 'journal');
    if (!d) break;
    const c = world.claims.find(x => x.doc === d.key && x.mode === 'measured' && !x.variant);
    if (!c) continue;
    d.role = 'corrected';
    addValueErratum(d, c, fromCanon(c.prop, perturb(c.prop, toCanon(c.prop, c.value, c.unit), 0.09, 0.3), c.unit));
  }
  for (let i = 0; i < K.filler.supersede; i++) {
    const d = fillerPool().find(x => x.kind === 'journal' || x.kind === 'preprint');
    if (!d) break;
    const e = world.entities.find(x => x.key === d.ent);
    const S = newDoc('preprint', e, { role: 'superseded', authors: d.authors });
    if (d.kind === 'preprint') { S.venue = d.venue; S.version = 1; d.version = 2; }
    S.date = before(d, 40, 380); S.n = Math.max(3, d.n + r.int(-4, 6)); S.naming = d.naming;
    order(S, d);
    d.role = 'successor';
    for (const c of world.claims.filter(x => x.doc === d.key && x.mode === 'measured')) {
      addClaim(S, e, c.prop, perturb(c.prop, toCanon(c.prop, c.value, c.unit), 0.05, 0.2), c.unit, { cond: c.cond, condText: c.condText });
    }
    world.supersessions.push({ old: S.key, new: d.key, style: d.kind === 'preprint' ? 'version' : r.pick(['new-says', 'banner']) });
  }
  for (let i = 0; i < K.filler.press; i++) {
    const d = fillerPool().find(x => world.claims.some(c => c.doc === x.key && c.cond === 'std' && c.mode === 'measured' && !c.variant));
    if (!d) break;
    const c = world.claims.find(x => x.doc === d.key && x.cond === 'std' && x.mode === 'measured' && !x.variant);
    const e = world.entities.find(x => x.key === d.ent);
    const PR = newDoc('press', e, { role: 'press', about: d.key });
    PR.date = after(d, 3, 90); order(d, PR);
    const canon = toCanon(c.prop, c.value, c.unit);
    addClaim(PR, e, c.prop, PROPS[c.prop].better === 'down' ? canon / r.float(1.2, 1.6) : canon * r.float(1.2, 1.6), pickUnit(c.prop, 0.6));
  }
  if (K.erratumOnVoid) {
    const R = r.shuffle(world.docs.filter(d => d.role === 'retracted' && d.kind === 'journal'))[0];
    const c = R && world.claims.find(x => x.doc === R.key && x.mode === 'measured' && x.cond === 'std' && !x.variant);
    if (c) addValueErratum(R, c, fromCanon(c.prop, perturb(c.prop, toCanon(c.prop, c.value, c.unit), 0.1, 0.3), c.unit));
  }
  // errata that correct something other than a value (an affiliation, a figure label): no effect
  for (let i = 0; i < K.otherErrata; i++) {
    const pool = world.docs.filter(d => d.kind === 'journal' && !isVoidRole(d));
    if (!pool.length) break;
    const T = r.pick(pool);
    const E = newDoc('erratum', world.entities.find(e => e.key === T.ent), { role: 'notice', venue: T.venue, authors: T.authors });
    E.date = after(T, 15, 300); order(T, E);
    world.errata.push({ doc: E.key, target: T.key, kind: 'other', ent: T.ent, what: r.int(0, 99) });
  }
  // retraction notices whose article is not in the corpus (must not cause any exclusion). From
  // level 4 on, the missing article can share its title with a corpus document (different
  // authors, venue and year): only the full reference tells them apart.
  for (let i = 0; i < K.ooc; i++) {
    const collideWith = K.oocCollide ? r.pick(world.docs.filter(d => isResearch(d) && ['journal', 'preprint'].includes(d.kind) && !isVoidRole(d))) : null;
    const host = collideWith ? world.entities.find(e => e.key === collideWith.ent)
      : r.chance(0.5) ? r.pick(reqEnts) : mkEntity(kindsCycle[r.int(0, 2)], { background: true, phantom: true });
    const venue = r.pick(JOURNALS[host.kind].filter(j => !collideWith || j !== collideWith.venue));
    const RN = newDoc('retraction', host, { role: 'notice', venue });
    const surnames = new Set(collideWith ? collideWith.authors.map(a => a.split(' ').pop()) : []);
    let authors = authorsFor();
    while (authors.some(a => surnames.has(a.split(' ').pop()))) authors = authorsFor();
    const phantom = { authors, venue, ent: host.key, prop: r.pick(KIND_PROPS[host.kind]), collide: collideWith ? collideWith.key : null };
    phantom.date = collideWith ? collideWith.date + (r.chance(0.5) ? 1 : -1) * r.int(400, 900) : base();
    RN.date = Math.max(phantom.date, collideWith ? collideWith.date : 0) + r.int(30, 400);
    if (collideWith) order(collideWith, RN);
    world.retractions.push({ doc: RN.key, target: null, phantom, reason: r.int(0, 99) });
  }
  // injection (d5): an instruction-like sentence inside an otherwise ordinary document
  if (K.injection) {
    const voidish = new Set([...world.retractions.map(x => x.target), ...world.supersessions.map(x => x.old)]);
    const cell = r.pick(world.requested.filter(c => !c.feats.has('pressOnly')));
    const hosts = world.docs.filter(d => isResearch(d) && !voidish.has(d.key) && d.role !== 'winner');
    const host = r.pick(hosts.filter(d => d.kind !== 'journal').length ? hosts.filter(d => d.kind !== 'journal') : hosts);
    const ent = world.entities.find(e => e.key === cell.ent);
    const W = world.claims.find(c => c.doc === cell.W && c.ent === cell.ent && c.prop === cell.prop && c.mode === 'measured' && c.cond === 'std');
    const inj = addClaim(host, ent, cell.prop, perturb(cell.prop, toCanon(cell.prop, W.value, W.unit), 0.15, 0.5), PROPS[cell.prop].unit, { mode: 'injection', style: r.int(0, 2) });
    world.injection = { doc: host.key, ent: ent.key, prop: cell.prop, claim: inj };
    host.hostsInjection = true;
  }

  // --- naming (aliases) ---------------------------------------------------------------------
  const phantoms = new Set(world.entities.filter(e => e.phantom).map(e => e.key));
  for (const d of world.docs) {
    if (!d.ent || phantoms.has(d.ent) || d.naming === 'alias') continue;
    if (d.role === 'superseded' || d.role === 'filler') continue;
    d.naming = r.chance(0.45) ? 'name' : r.chance(0.55) ? 'alias' : 'both';
  }
  const voidKeys = new Set([...world.retractions.filter(x => x.target).map(x => x.target), ...world.supersessions.map(x => x.old)]);
  for (const e of world.entities) {
    if (e.phantom) continue;
    const eDocs = world.docs.filter(d => d.ent === e.key);
    if (!eDocs.some(d => d.naming === 'alias' || d.naming === 'both')) continue;
    const ok = eDocs.some(d => d.naming === 'both' && !voidKeys.has(d.key) && isResearch(d));
    if (ok) continue;
    const cand = eDocs.find(d => isResearch(d) && !voidKeys.has(d.key) && !(d.role === 'winner' && world.requested.some(c => c.W === d.key && c.feats.has('aliasOnly'))));
    if (cand) cand.naming = 'both';
    else {
      const M = newDoc('labnote', e, { role: 'nomenclature', naming: 'both' });
      M.date = base(); M.n = r.int(3, 12);
      M.nomenclature = true;
      if (unreqProps(e).length) fillerClaim(M, e);
    }
  }

  // --- sample sizes stated as gross counts minus exclusions (variety; truth unchanged) ----------
  for (const d of world.docs) if (isResearch(d) && d.n != null && d.nGross == null && d.nPrinted == null && r.chance(K.nVariety)) d.nGross = d.n + r.int(1, 8);
  // a gross-count trap must still beat its winner when the winner's own gross count is read instead
  for (const C of world.docs.filter(d => d.grossOver)) { const W = docOf(C.grossOver); if (W.nGross != null && C.nGross <= W.nGross) C.nGross = W.nGross + r.int(1, 6); }

  // --- decoys: the same first author publishes another document in the same venue -------------
  // (a notice must then be matched by more than "first author + venue")
  const noticeTargets = new Set([...world.retractions.map(x => x.target), ...world.errata.map(x => x.target), ...world.concerns.map(x => x.target),
    ...world.supersessions.flatMap(x => [x.old, x.new])].filter(Boolean));
  for (const T of world.docs.filter(d => noticeTargets.has(d.key))) {
    if (!r.chance(K.decoyP)) continue;
    const pool = world.docs.filter(X => X !== T && X.kind === T.kind && X.venue === T.venue && isResearch(X) && X.authors !== T.authors
      && X.authors[0] !== T.authors[0] && !X.authors.slice(1).some(a => a.split(' ').pop() === T.authors[0].split(' ').pop()));
    if (pool.length) r.pick(pool).authors[0] = T.authors[0];
  }

  // --- dates: make unique, then check ordering constraints -----------------------------------
  const seen = new Set();
  for (const d of [...world.docs].sort((a, b) => a.date - b.date || (a.key < b.key ? -1 : 1))) {
    while (seen.has(d.date)) d.date += 1;
    seen.add(d.date);
  }
  for (const x of world.retractions) if (x.phantom) while (seen.has(x.phantom.date)) x.phantom.date += 1;
  world.docMap = new Map(world.docs.map(d => [d.key, d]));
  world.entMap = new Map(world.entities.map(e => [e.key, e]));
  world.constraintsOk = world.constraints.every(([a, b]) => world.docMap.get(a).date < world.docMap.get(b).date);

  // --- public ids: random order ----------------------------------------------------------------
  const width = world.docs.length > 99 ? 3 : 2;
  r.shuffle(world.docs).forEach((d, i) => { d.id = `D${String(i + 1).padStart(width, '0')}`; });
  world.docs.sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const c of world.requested) c.feats = [...c.feats].sort();
  delete world.entMapTmp;
  return world;
}

// ---------------------------------------------------------------------------------------
// Names
const cap = s => s[0].toUpperCase() + s.slice(1);
// Join syllables, collapsing a doubled vowel at a boundary ("do" + "oides" -> "doides").
const joinSyl = parts => parts.reduce((acc, p) => (acc && /[aeiou]$/.test(acc) && acc.slice(-1) === p[0] ? acc + p.slice(1) : acc + p), '');
function makeNames(r, kind, used) {
  for (let t = 0; t < 500; t++) {
    let name, alias, parts;
    const L = () => String.fromCharCode(65 + r.int(0, 25));
    if (kind === 'compound') {
      parts = [r.pick(SYL), r.pick(SYL), r.pick(SUFFIX.compound)];
      name = joinSyl(parts);
      alias = `${L()}${L()}-${r.int(102, 987)}`;
    } else if (kind === 'material') {
      parts = [r.pick(SYL), r.pick(SYL), r.pick(SUFFIX.material)];
      name = joinSyl(parts);
      alias = `M${L()}-${r.int(12, 97)}`;
    } else {
      const genus = cap(joinSyl([r.pick(SYL), r.pick(SYL), r.pick(SUFFIX.organismGenus)]));
      parts = [r.pick(SYL), r.pick(SYL), r.pick(SUFFIX.organismSpecies)];
      name = `${genus} ${joinSyl(parts)}`;
      parts.genus = genus;
      alias = `${L()}${L()}-${r.int(11, 98)}`;
    }
    if (/(.)\1\1/.test(name) || DENY.has(name.toLowerCase()) || used.has(name.toLowerCase()) || used.has(alias.toLowerCase())) continue;
    if (/[0-9](\d)\1$/.test(alias)) continue;
    used.add(name.toLowerCase()); used.add(alias.toLowerCase());
    return { name, alias, parts };
  }
  throw new Error('name space exhausted');
}

// A near-name distractor: one vowel changed in the name, two digits swapped in the code.
function nearNames(r, ent, used) {
  const p = ent.parts;
  for (let t = 0; t < 50; t++) {
    const idx = r.int(0, 1);
    const syl = p[idx];
    const vi = [...syl].findIndex(ch => ALT_VOWEL[ch]);
    const alt = vi < 0 ? `${syl}n` : syl.slice(0, vi) + ALT_VOWEL[syl[vi]] + syl.slice(vi + 1);
    const np = [...p]; np[idx] = alt;
    if (t > 10) np[1] = np[1] + r.pick(['r', 'n', 'l']);
    const name = ent.kind === 'organism' ? `${p.genus} ${joinSyl(np)}` : joinSyl(np);
    const [pre, digits] = ent.alias.split('-');
    const ds = [...digits];
    if (ds.length >= 2) [ds[ds.length - 1], ds[ds.length - 2]] = [ds[ds.length - 2], ds[ds.length - 1]];
    let alias = `${pre}-${ds.join('')}`;
    if (alias === ent.alias || used.has(alias.toLowerCase())) alias = `${pre}-${digits.slice(0, -1)}${(Number(digits.slice(-1)) + r.int(1, 8)) % 10}`;
    if (name.toLowerCase() === ent.name.toLowerCase() || used.has(name.toLowerCase()) || used.has(alias.toLowerCase())) continue;
    used.add(name.toLowerCase()); used.add(alias.toLowerCase());
    np.genus = p.genus;
    return { name, alias, parts: np };
  }
  throw new Error('no near name');
}
