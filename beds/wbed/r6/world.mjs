// The hidden world of W-bed R6 "wide research table" (W-BED §3.6): a consortium corpus of fictional research documents
// about fictional compounds. The question names a lab X and a cut-off date Y; the answer's compounds are every compound
// lab X itself tested on or after Y in a document that is not void (W-BED's "every compound tested by lab X after date
// Y"). They are not listed anywhere: the entity list must be discovered. For each, the requested properties are
// resolved under a synth-style resolution policy (void documents, errata, standard conditions, quotes, predictions,
// bounds, units, a ranking policy).
//
// The generator builds the world as structure (labs, entities, documents, claims, notices) with deliberate traps, renders
// it (render.mjs), computes the truth with the bed's own exact solver (pipeline.mjs), and re-draws on an attempt counter
// until every applicable control fails the oracle (setVerifier, as in R3).
//
// Entity roles. 'in' (the answer; sub-roles plain / abbr / former / codeonly), 'T1' lab X tested it only before Y but
// published after Y, 'T2' only quoted (mentioned) in lab X documents after Y, 'T3' tested by lab X after Y only in a
// retracted document, 'T4' only planned ("will be tested") by lab X after Y, 'T6' tested after Y by a namesake
// organisation sharing lab X's stem (d >= 4), 'bg' background. Plan candidates (compounds mentioned in a lab X research
// document published on or after Y) are exactly the 'in' and T1-T4 compounds, at most MAX_FANOUT.
import { taskRng } from '../lib/prng.mjs';
import { dayNum } from '../lib/domain.mjs';
import { personName } from '../lib/parties.mjs';
import { hooks } from '../lib/faults.mjs';
import {
  VERSION, MIN_D, MAX_D, LEVELS, PROPS, PROP_IDS, BOUND_PROPS, LAB_POOL, FORMER_NAMES, NAMESAKE_SUFFIX, NAME_PREFIX, NAME_MIDDLE,
  NAME_SUFFIX, CODE_PREFIX, KINDS, labelsFor, JOURNALS, SERVERS, CONFERENCE, REPORT_SERIES, rankKey, cmpKeys, tierOf, MAX_FANOUT,
} from './vocab.mjs';
import { renderWorld } from './render.mjs';

export { VERSION, MIN_D, MAX_D, LEVELS };

let verifier = null;
/** index.mjs installs the decisiveness check: (world) -> name of a control that passes, or null. */
export function setVerifier(fn) { verifier = fn; }

const worldCache = new Map();
export function buildWide(seed, split = 'dev', difficulty = 3) {
  const key = JSON.stringify([seed, split, difficulty]);
  if (worldCache.has(key)) return worldCache.get(key);
  if (!LEVELS[difficulty]) throw new Error(`wbed-r6: difficulty must be ${MIN_D}..${MAX_D}, got ${difficulty}`);
  if (split !== 'dev' && split !== 'test') throw new Error(`wbed-r6: split must be 'dev' or 'test', got ${split}`);
  let world = null, last = null;
  const rejects = [];
  for (let attempt = 0; attempt < 40 && !world; attempt++) {
    const w = attemptWorld({ seed, split, difficulty }, attempt);
    if (w.reject) { last = w.reject; rejects.push(w.reject); continue; }
    w.rejects = rejects;
    world = w;
  }
  if (!world) throw new Error(`wbed-r6: no valid world for seed ${seed} d${difficulty} (${last})`);
  worldCache.set(key, world);
  if (worldCache.size > 12) worldCache.delete(worldCache.keys().next().value);
  return world;
}

// ---------------------------------------------------------------------------------------------------------------------
const MANDATORY_TRAPS = d => ['retracted', 'superseded', 'nonstd', 'quote', 'prediction', 'bound', 'recency', 'erratum', 'unit',
  ...(d >= 3 ? ['concern'] : []), ...(d >= 4 ? ['outOfCorpus'] : [])];
const ABOVE_TRAPS = new Set(['retracted', 'superseded', 'nonstd', 'quote', 'prediction', 'bound']);
const OPTIONAL_TRAPS = ['retracted', 'superseded', 'nonstd', 'quote', 'prediction', 'erratum', 'unit'];

function attemptWorld(spec, attempt) {
  const d = spec.difficulty, L = LEVELS[d];
  const r = taskRng('r6', 'world', spec, attempt);
  const reject = reason => ({ reject: reason });
  const tier = tierOf(spec.split, d);

  // ---- time: cut-off Y, register snapshot, rename day
  const Y = dayNum(2025, 2, 1) + r.int(0, 170);
  const snapshot = Y - r.int(60, 200);
  const LO = Y - 720, HI = Y + 360;
  const used = new Set();
  const fresh = (lo, hi) => {
    lo = Math.max(lo, LO); hi = Math.min(hi, HI);
    if (hi < lo) return null;
    for (let k = 0; k < 60; k++) { const x = r.int(lo, hi); if (!used.has(x)) { used.add(x); return x; } }
    for (let x = lo; x <= hi; x++) if (!used.has(x)) { used.add(x); return x; }
    return null;
  };

  // ---- labs
  const pool = r.shuffle(LAB_POOL).slice(0, L.labs);
  const labs = pool.map((p, i) => ({ id: `L${i + 1}`, stem: p.stem, name: p.name, abbr: p.abbr, short: p.short, former: null, renamedOn: null, isX: i === 0, namesake: false }));
  const X = labs[0];
  if (L.alias >= 2) { X.former = r.pick(FORMER_NAMES); X.renamedOn = Y - r.int(120, 400); }
  let NS = null;
  if (L.namesake) {
    const ns = r.pick(NAMESAKE_SUFFIX);
    NS = { id: `L${labs.length + 1}`, stem: X.stem, name: ns.name(X.stem), abbr: ns.abbr(X.stem), short: `the ${ns.name(X.stem)}`, former: null, renamedOn: null, isX: false, namesake: true };
    labs.push(NS);
  }
  const others = labs.filter(l => !l.isX && !l.namesake);

  // ---- policy and requested properties (at least one property that has a bound form)
  const policy = r.pick(L.policies);
  let props;
  for (let k = 0; k < 20; k++) { props = r.sample(PROP_IDS, L.props); if (props.some(p => BOUND_PROPS.includes(p))) break; }
  if (!props.some(p => BOUND_PROPS.includes(p))) return reject('no-bound-prop');
  const nonReq = PROP_IDS.filter(p => !props.includes(p));

  // ---- entities
  const names = new Set(), codes = new Set();
  const newName = () => {
    for (let k = 0; k < 200; k++) {
      const n = r.pick(NAME_PREFIX) + r.pick(NAME_MIDDLE) + r.pick(NAME_SUFFIX);
      if ([...names].some(x => x.includes(n) || n.includes(x))) continue;
      names.add(n); return n;
    }
    return null;
  };
  const newCode = () => {
    for (let k = 0; k < 200; k++) { const c = `${r.pick(CODE_PREFIX)}-${r.int(100, 9999)}`; if (!codes.has(c)) { codes.add(c); return c; } }
    return null;
  };
  const nearKinds = ['T1', 'T2', 'T3', 'T4'];
  for (let k = 4; k < L.near; k++) nearKinds.push(r.pick(['T1', 'T2', 'T3', 'T4']));
  const roles = [...Array(L.inScope).fill('in'), ...nearKinds, ...(L.namesake ? ['T6'] : [])];
  while (roles.length < L.entities) roles.push('bg');
  const entities = roles.map((role, i) => ({ id: `E${String(i + 1).padStart(2, '0')}`, role, sub: role === 'in' ? 'plain' : null, name: newName(), code: newCode(), registeredBy: null, registeredOn: null }));
  if (entities.some(e => !e.name || !e.code)) return reject('names');
  const inScope = entities.filter(e => e.role === 'in');
  const subs = [...(L.alias >= 1 ? ['abbr'] : []), ...(L.alias >= 2 ? ['former'] : []), ...(d >= 3 ? ['codeonly'] : [])];
  r.shuffle(inScope).slice(0, subs.length).forEach((e, i) => { e.sub = subs[i]; });
  const byRole = role => entities.filter(e => e.role === role);
  const candidates = entities.filter(e => ['in', 'T1', 'T2', 'T3', 'T4'].includes(e.role));
  if (candidates.length > MAX_FANOUT) return reject('fanout');

  // ---- documents
  const docs = [];
  let seq = 0;
  const author = () => { const p = personName(r, 'en'); return `${p.given[0]}. ${p.family}`; };
  const authorsOf = () => Array.from({ length: r.int(1, 4) }, author);
  const styleFor = () => (L.styles.length === 1 ? 'both' : r.chance(0.4) ? 'both' : r.chance(0.55) ? 'name' : 'code');
  const venueOf = kind => (kind === 'journal' || kind === 'review' ? r.pick(JOURNALS) : kind === 'preprint' ? r.pick(SERVERS) : kind === 'conference' ? CONFERENCE : kind === 'techreport' ? REPORT_SERIES : 'internal');
  const researchKinds = tier === 'novel-dev' ? ['journal', 'preprint', 'labnote', 'conference'] : tier === 'novel-test' ? ['journal', 'preprint', 'labnote', 'techreport'] : ['journal', 'preprint', 'labnote'];
  const tierOfKind = kind => KINDS[kind].tier;
  const addDoc = fields => {
    const doc = { key: `k${++seq}`, id: null, kind: 'journal', label: null, venue: null, pubDay: null, lab: null, affil: 'full', authors: authorsOf(),
      title: null, primary: null, testDay: null, testEnd: null, testForm: 'on', docN: null, claims: [], quotes: [], predictions: [], plans: [],
      styles: {}, supersedes: null, supersedeForm: null, target: null, notice: null, role: 'bg', ...fields };
    doc.label = doc.label ?? r.pick(labelsFor(doc.kind, d));
    doc.venue = doc.venue ?? venueOf(doc.kind);
    docs.push(doc);
    return doc;
  };
  const mention = (doc, e, style) => { if (!doc.styles[e.id]) doc.styles[e.id] = style ?? styleFor(); };
  const drawCanon = (p, avoid = []) => {
    const [lo, hi] = PROPS[p].range;
    for (let k = 0; k < 50; k++) { const v = r.int(lo, hi); if (avoid.every(a => Math.abs(a - v) > Math.max(2, Math.round(0.03 * Math.abs(a))))) return v; }
    return null;
  };
  const unitFor = (p, forceNonCanon = false) => {
    const us = PROPS[p].units.slice(0, Math.min(L.units, PROPS[p].units.length));
    if (forceNonCanon && us.length > 1) return r.pick(us.slice(1)).id;
    return (us.length > 1 && r.chance(0.45) ? r.pick(us.slice(1)) : us[0]).id;
  };
  const setTest = (doc, rel) => {
    // rel 'after': test on/after Y (doc published >= test + 10); 'before': test before Y; 'any'
    const pub = doc.pubDay;
    let t;
    if (rel === 'after') { if (pub - 10 < Y) return false; t = r.int(Y, pub - 10); }
    else if (rel === 'before') { const hi = Math.min(pub - 10, Y - 1); t = r.int(Math.min(hi - 5, Math.max(LO - 120, pub - 400)), hi); }
    else t = r.int(pub - 300, pub - 10);
    doc.testDay = t;
    const form = r.pick(['on', 'on', 'between', 'week']);
    doc.testForm = form;
    if (form === 'between') {
      const end = t + r.int(2, 14);
      // a range never straddles the cut-off and never runs past publication
      if ((t < Y && end >= Y) || end > pub - 1) doc.testForm = 'on'; else doc.testEnd = end;
    }
    // "the week beginning" a date never straddles the cut-off (a test in that week is on/after the date either way)
    if (form === 'week' && t < Y && t + 6 >= Y) doc.testForm = 'on';
    if (tier !== 'dev' && r.chance(0.45)) doc.testForm = tier === 'novel-dev' ? 'log' : 'relative';
    if (doc.testForm === 'relative') doc.relVisit = { day: t - r.int(3, 40) };
    if (L.decoyDates && r.chance(0.6)) doc.receivedDay = t - r.int(5, 60);
    return true;
  };
  const claim = (doc, e, p, canon, { cond = 'std', kind = 'own', n = r.int(2, 12), unit = unitFor(p) } = {}) => {
    const c = { e: e.id, p, canon, unit, n, nExplicit: true, cond, kind, form: r.int(0, 1) };
    doc.claims.push(c);
    mention(doc, e);
    return c;
  };
  const docNOf = doc => { if (doc.docN == null && L.docN && r.chance(L.docN)) doc.docN = r.int(3, 10); };

  // ---- establishing documents (lab X, tested on or after Y)
  const xAffil = e => (e.sub === 'abbr' ? 'abbr' : e.sub === 'former' ? 'former' : L.alias >= 1 && r.chance(0.3) ? 'abbr' : 'full');
  const xDocs = [];
  for (const e of inScope) {
    const nDocs = e.sub === 'plain' && r.chance(0.3) ? 2 : 1;
    for (let k = 0; k < nDocs; k++) {
      const kind = e.sub === 'former' ? 'labnote' : r.pick(researchKinds);
      const pubDay = fresh(Y + 20, HI);
      if (pubDay == null) return reject('days');
      const doc = addDoc({ kind, pubDay, lab: X.id, affil: k === 0 ? xAffil(e) : (e.sub === 'abbr' ? 'abbr' : e.sub === 'former' ? 'former' : 'full'), role: 'establish', primary: e.id });
      if (!setTest(doc, 'after')) return reject('test-day');
      mention(doc, e, e.sub === 'codeonly' ? 'code' : undefined);
      // the establishing measurement: never a standard-condition claim of a requested property (cells stay controlled)
      const how = r.pick(['nonreq', 'nonreq', 'nonstd', 'bound']);
      if (how === 'nonreq') { const p = r.pick(nonReq); claim(doc, e, p, drawCanon(p)); }
      else if (how === 'nonstd') { const p = r.pick(props); claim(doc, e, p, drawCanon(p), { cond: 'nonstd' }); }
      else { const p = r.pick(props.filter(x => BOUND_PROPS.includes(x))); claim(doc, e, p, drawCanon(p), { kind: 'bound' }); }
      if (r.chance(0.5)) { const p = r.pick(nonReq); if (!doc.claims.some(c => c.p === p)) claim(doc, e, p, drawCanon(p)); }
      docNOf(doc);
      xDocs.push(doc);
    }
  }
  // the code-only compound is also named (by name only) in another lab X document after Y: a planner that does not map
  // names to codes lists it twice
  for (const e of inScope.filter(x => x.sub === 'codeonly')) {
    const host = r.pick(xDocs.filter(x => x.primary !== e.id && x.affil === 'full'));
    if (!host) return reject('codeonly-host');
    const p = r.pick(props);
    host.quotes.push({ e: e.id, p, canon: drawCanon(p), unit: unitFor(p), lab: r.pick(others).id, n: r.int(2, 9) });
    host.styles[e.id] = 'name';
  }

  // ---- near-miss candidates
  const otherLabDocWithClaim = (e, opts = {}) => {
    // a surviving other-lab document with a standard claim of a requested property (so a wrongly included compound
    // produces rows)
    const pubDay = fresh(LO, HI);
    if (pubDay == null) return null;
    const doc = addDoc({ kind: r.pick(researchKinds), pubDay, lab: r.pick(others).id, role: 'bg', primary: e.id, ...opts });
    setTest(doc, 'any');
    const p = r.pick(props);
    claim(doc, e, p, drawCanon(p));
    docNOf(doc);
    return doc;
  };
  for (const e of entities.filter(x => ['T1', 'T2', 'T3', 'T4', 'T6'].includes(x.role))) {
    if (!otherLabDocWithClaim(e)) return reject('days');
    if (e.role === 'T1') {
      const pubDay = fresh(Y + 20, HI);
      const doc = addDoc({ kind: r.pick(researchKinds), pubDay, lab: X.id, affil: L.alias >= 1 && r.chance(0.3) ? 'abbr' : 'full', role: 'near', primary: e.id });
      setTest(doc, 'before');
      if (doc.testDay >= Y) return reject('t1');
      const p = r.pick(props);
      claim(doc, e, p, drawCanon(p));
      docNOf(doc);
    } else if (e.role === 'T2') {
      const host = r.pick(xDocs);
      const p = r.pick(props);
      host.quotes.push({ e: e.id, p, canon: drawCanon(p), unit: unitFor(p), lab: r.pick(others).id, n: r.int(2, 9) });
      mention(host, e);
    } else if (e.role === 'T3') {
      const pubDay = fresh(Y + 20, HI - 30);
      if (pubDay == null) return reject('days');
      const doc = addDoc({ kind: r.pick(['journal', 'preprint']), pubDay, lab: X.id, affil: 'full', role: 'near-void', primary: e.id });
      if (!setTest(doc, 'after')) return reject('t3');
      const p = r.pick(props);
      claim(doc, e, p, drawCanon(p));
      const nt = addDoc({ kind: 'retraction', pubDay: fresh(pubDay + 10, HI), lab: null, target: doc.key, role: 'notice', notice: { reason: r.int(0, 3) } });
      if (nt.pubDay == null) return reject('days');
      nt.venue = doc.venue;
    } else if (e.role === 'T4') {
      const host = r.pick(xDocs);
      host.plans.push(e.id);
      mention(host, e);
    } else if (e.role === 'T6') {
      const pubDay = fresh(Y + 20, HI);
      const doc = addDoc({ kind: r.pick(researchKinds), pubDay, lab: NS.id, affil: 'full', role: 'namesake', primary: e.id });
      if (!setTest(doc, 'after')) return reject('t6');
      const p = r.pick(props);
      claim(doc, e, p, drawCanon(p));
    }
  }
  // establishing documents also quote other candidates' values (mentions only)
  for (const doc of xDocs) {
    if (r.chance(0.4)) {
      const e = r.pick(candidates.filter(x => x.id !== doc.primary && x.role !== 'T3'));
      const p = r.pick(PROP_IDS);
      doc.quotes.push({ e: e.id, p, canon: drawCanon(p), unit: unitFor(p), lab: r.pick(others).id, n: r.int(2, 9) });
      mention(doc, e);
    }
  }

  // ---- cells: per in-scope compound and requested property, a winner, losers and traps
  const cellKeys = inScope.flatMap(e => props.map(p => ({ e, p })));
  const trapsOf = new Map(cellKeys.map(c => [`${c.e.id}|${c.p}`, new Set()]));
  for (const t of MANDATORY_TRAPS(d)) {
    const eligible = cellKeys.filter(c => t !== 'bound' || BOUND_PROPS.includes(c.p));
    const free = eligible.filter(c => trapsOf.get(`${c.e.id}|${c.p}`).size === 0);
    const c = r.pick(free.length ? free : eligible);
    trapsOf.get(`${c.e.id}|${c.p}`).add(t);
  }
  for (const c of cellKeys) if (r.chance(0.15)) trapsOf.get(`${c.e.id}|${c.p}`).add(r.pick(OPTIONAL_TRAPS));
  const truthCells = [];
  const research = kinds => kinds.filter(k => KINDS[k].research);
  for (const { e, p } of cellKeys) {
    const traps = trapsOf.get(`${e.id}|${p}`);
    const built = buildCell({ r, e, p, traps, policy, researchKinds: research(researchKinds), fresh, others, LO, HI, L, addDoc, claim, setTest, docNOf, drawCanon, unitFor, tierOfKind, labs });
    if (built.reject) return reject(built.reject);
    truthCells.push(built);
  }

  // ---- background research documents (other labs, or lab X published before Y), reviews, notices, memos
  const bgEntities = entities.filter(x => x.role === 'bg');
  const bgDoc = () => {
    const isX = r.chance(0.15);
    const pubDay = isX ? fresh(LO, Y - 1) : fresh(LO, HI);
    if (pubDay == null) return null;
    const lab = isX ? X.id : r.pick([...others, ...(NS && r.chance(0.2) ? [NS] : [])]).id;
    // lab X documents published before its rename carry the former name (d >= 4)
    const affil = isX && X.former && pubDay < X.renamedOn ? 'former' : isX && L.alias >= 1 && r.chance(0.3) ? 'abbr' : 'full';
    const doc = addDoc({ kind: r.pick(researchKinds), pubDay, lab, affil, role: 'bg' });
    setTest(doc, 'any');
    // primary: a background compound, or a near-miss/in-scope one with claims that do not touch the cells
    const pickE = r.chance(0.75) ? r.pick(bgEntities) : r.pick(entities.filter(x => x.role !== 'T6'));
    // lab X documents never test a near-miss compound, and nothing published on/after Y by lab X is background
    const e = (isX && pickE.role !== 'bg' && pickE.role !== 'in') || (lab === NS?.id && pickE.role !== 'bg') ? r.pick(bgEntities) : pickE;
    doc.primary = e.id;
    const nClaims = r.int(1, 3);
    for (let k = 0; k < nClaims; k++) {
      const p = r.pick(PROP_IDS);
      if (doc.claims.some(c => c.e === e.id && c.p === p)) continue;
      const touchesCell = e.role === 'in' && props.includes(p);
      claim(doc, e, p, drawCanon(p), { cond: touchesCell || r.chance(0.2) ? 'nonstd' : 'std' });
    }
    if (r.chance(0.35)) {
      const q = r.pick(entities.filter(x => x.id !== e.id));
      const p = r.pick(PROP_IDS);
      doc.quotes.push({ e: q.id, p, canon: drawCanon(p), unit: unitFor(p), lab: r.pick(labs.filter(l => l.id !== lab)).id, n: r.int(2, 9) });
      mention(doc, q);
    }
    if (r.chance(0.15)) { const p = r.pick(PROP_IDS); doc.predictions.push({ e: e.id, p, canon: drawCanon(p), unit: unitFor(p), n: null }); }
    docNOf(doc);
    return doc;
  };
  for (let k = 0; k < L.reviews; k++) {
    const pubDay = fresh(LO, HI);
    const doc = addDoc({ kind: 'review', pubDay, lab: r.pick(others).id, role: 'review' });
    const qs = r.sample(entities, r.int(3, 6));
    doc.primary = qs[0].id;
    for (const q of qs) { const p = r.pick(PROP_IDS); doc.quotes.push({ e: q.id, p, canon: drawCanon(p), unit: unitFor(p), lab: r.pick(labs).id, n: r.int(2, 9) }); mention(doc, q); }
  }
  // background void documents (some mention only out-of-scope compounds) and background errata
  const notice = (kind, target, extra = {}) => {
    const tgt = docs.find(x => x.key === target);
    const pubDay = fresh(tgt.pubDay + 7, HI);
    if (pubDay == null) return null;
    const doc = addDoc({ kind, pubDay, lab: null, target, role: 'notice', venue: tgt.venue, ...extra });
    return doc;
  };
  const fill = L.docs;
  let guard = 0;
  while (docs.length < fill - 3 && guard++ < 2000) {
    const doc = bgDoc();
    if (!doc) break;
    const roll = r.next();
    if (roll < 0.05 && doc.claims.length && doc.pubDay < HI - 20) { if (!notice('retraction', doc.key, { notice: { reason: r.int(0, 3) } })) break; }
    else if (roll < 0.09 && doc.claims.length && doc.pubDay < HI - 20) {
      const c = r.pick(doc.claims);
      const to = drawCanon(c.p, [c.canon]);
      if (!notice('erratum', doc.key, { notice: { e: c.e, p: c.p, from: c.canon, to, unit: c.unit } })) break;
      c.printed = c.canon; c.canon = to;
    } else if (roll < 0.12 && doc.kind === 'preprint' && doc.pubDay < HI - 40) {
      // lab X background documents stay before Y (nothing lab X publishes on/after Y is background)
      const v2Day = fresh(doc.pubDay + 20, doc.lab === X.id ? Y - 1 : HI);
      if (v2Day == null) continue;
      const v2 = addDoc({ kind: 'preprint', pubDay: v2Day, lab: doc.lab, affil: doc.affil, supersedes: doc.key, supersedeForm: 'v2', role: 'bg', primary: doc.primary, venue: doc.venue });
      setTest(v2, 'any');
      const e = entities.find(x => x.id === doc.primary);
      const p = r.pick(nonReq);
      claim(v2, e, p, drawCanon(p), { cond: 'nonstd' });
    }
  }
  // d4+: errata to void documents (they change nothing)
  if (d >= 4) {
    const voidish = docs.filter(x => x.role === 'trap-retracted' || x.role === 'trap-v1');
    for (const v of r.sample(voidish, Math.min(2, voidish.length))) {
      const c = v.claims[0];
      if (!c || v.pubDay > HI - 20) continue;
      const to = drawCanon(c.p, [c.canon]);
      if (!notice('erratum', v.key, { notice: { e: c.e, p: c.p, from: c.canon, to, unit: c.unit, toVoid: true } })) return reject('days');
      c.printed = c.canon; c.canon = to;
    }
  }
  // concerns on random research documents (they void nothing)
  for (let k = 0; k < L.concerns; k++) {
    const t = r.pick(docs.filter(x => KINDS[x.kind].research && x.claims.length && x.pubDay < HI - 20 && x.role !== 'near-void'));
    if (t && !notice('concern', t.key, { notice: {} })) return reject('days');
  }
  // consortium notices: membership list (d >= 3), the rename (d >= 4), a meeting notice (d2 filler)
  const office = (body, day) => addDoc({ kind: 'office', pubDay: fresh(day, day + 30), lab: null, role: 'office', venue: 'Consortium office', office: body, authors: ['Consortium office'] });
  if (L.alias >= 1) office({ type: 'members' }, Y - r.int(100, 400));
  if (L.alias >= 2) office({ type: 'rename' }, X.renamedOn + r.int(1, 20));
  if (!L.alias) office({ type: 'meeting' }, Y - r.int(30, 300));
  while (docs.length < fill && guard++ < 4000) if (!bgDoc()) break;
  if (docs.some(x => x.pubDay == null)) return reject('days');

  // ---- register (snapshot before Y): lab X registered some in-scope compounds and every T1 compound
  const regDay = () => snapshot - r.int(10, 500);
  const inNotByX = new Set(r.sample(inScope, Math.max(2, Math.round(inScope.length * 0.35))).map(e => e.id));
  for (const e of entities) {
    if (e.role === 'in') {
      if (inNotByX.has(e.id)) { if (r.chance(0.5)) { e.registeredBy = r.pick(others).id; e.registeredOn = regDay(); } }
      else { e.registeredBy = X.id; e.registeredOn = regDay(); }
    } else if (e.role === 'T1') { e.registeredBy = X.id; e.registeredOn = regDay(); }
    else if (r.chance(0.7)) { e.registeredBy = r.pick(labs.filter(l => !l.namesake)).id; e.registeredOn = regDay(); }
  }
  // every unregistered compound is named with its code ("name (CODE)") in at least one document
  for (const e of entities.filter(x => !x.registeredBy)) {
    const ds = docs.filter(x => x.styles[e.id]);
    if (!ds.length) continue;
    if (!ds.some(x => x.styles[e.id] === 'both')) {
      const host = ds.find(x => !(x.primary === e.id && e.sub === 'codeonly' && x.role === 'establish')) ?? null;
      if (!host) return reject('mapping');
      host.styles[e.id] = 'both';
    }
  }
  // the code-only compound keeps its code-only establishing documents
  for (const e of inScope.filter(x => x.sub === 'codeonly')) for (const doc of docs.filter(x => x.role === 'establish' && x.primary === e.id)) doc.styles[e.id] = 'code';

  // ---- ids in random order
  r.shuffle(docs).forEach((doc, i) => { doc.id = `D${String(i + 1).padStart(3, '0')}`; });
  docs.sort((a, b) => a.id.localeCompare(b.id));
  const byKey = new Map(docs.map(x => [x.key, x]));

  let world = { spec, attempt, L, tier, Y, snapshot, policy, props, labs, X: X.id, NS: NS?.id ?? null, entities, docs, byKey, truthCells };
  world = hooks.schemaDrift(world); // R8 f1 hook point (no-op in v1)
  world.render = renderWorld(world, taskRng('r6', 'render', spec, attempt));
  if (verifier) {
    const bad = verifier(world);
    if (bad) return reject(`control-passes:${bad}`);
  }
  return world;
}

// ---------------------------------------------------------------------------------------------------------------------
// One cell: the winner (the truth), losers that rank below it, and the trap documents that rank above it but must
// not count (void, non-standard, quoted, predicted, a bound) or that only a mistaken rule would pick.
function buildCell(ctx) {
  const { r, e, p, traps, policy, researchKinds, fresh, others, HI, L, addDoc, claim, setTest, docNOf, drawCanon, unitFor, tierOfKind } = ctx;
  const truth = drawCanon(p);
  if (truth == null) return { reject: 'canon' };
  const values = [truth];
  const val = () => { const v = drawCanon(p, values); if (v != null) values.push(v); return v; };
  const above = [...traps].filter(t => ABOVE_TRAPS.has(t));
  const needRecency = traps.has('recency');
  const lab = () => r.pick(others).id;

  for (let tries = 0; tries < 30; tries++) {
    // winner attributes: lower-ranked kinds and middling n leave room above for traps
    const wKind = above.length ? r.pick(researchKinds.filter(k => tierOfKind(k) >= 1).concat(policy === 'P3' ? ['journal'] : [])) : r.pick(researchKinds);
    const wN = above.length && policy !== 'P2' ? r.int(3, 7) : r.int(2, 12);
    const wDay = r.int(ctx.LO + 200, HI - 60);
    const wKey = rankKey(policy, tierOfKind(wKind), wN, wDay);
    const plans = [];
    const tryAttrs = (rel, kinds) => {
      for (let k = 0; k < 40; k++) {
        const kind = r.pick(kinds), n = r.int(2, 12), day = r.int(ctx.LO + 30, HI - 25);
        const cmp = cmpKeys(rankKey(policy, tierOfKind(kind), n, day), wKey);
        if (rel === 'above' && cmp < 0) return { kind, n, day };
        if (rel === 'below' && cmp > 0) return { kind, n, day };
        if (rel === 'below-newer' && cmp > 0 && day > wDay) return { kind, n, day };
      }
      return null;
    };
    let ok = true;
    for (const t of above) {
      const a = tryAttrs('above', t === 'superseded' ? researchKinds.filter(k => k === 'preprint') : researchKinds);
      if (!a) { ok = false; break; }
      plans.push({ t, ...a });
    }
    const nLosers = 1 + (r.chance(L.extraLosers) ? 1 : 0);
    for (let k = 0; ok && k < nLosers; k++) { const a = tryAttrs(k === 0 && needRecency ? 'below-newer' : 'below', researchKinds); if (!a) ok = false; else plans.push({ t: k === 0 && needRecency ? 'loser-recency' : 'loser', ...a }); }
    if (!ok) continue;
    // reserve the days (all unique in the task); retry with new attributes on a clash
    const days = [wDay, ...plans.map(x => x.day)];
    if (new Set(days).size !== days.length) continue;
    const got = days.map(x => fresh(x, x));
    if (got.some(x => x == null)) continue;

    // ---- build the documents
    const docOf = (kind, day, role) => {
      const doc = addDoc({ kind, pubDay: day, lab: lab(), role, primary: e.id });
      setTest(doc, 'any');
      return doc;
    };
    const winner = docOf(wKind, wDay, 'winner');
    const wUnit = unitFor(p, traps.has('unit'));
    const wc = claim(winner, e, p, truth, { n: wN, unit: wUnit });
    let erratum = null;
    if (traps.has('erratum')) {
      const printed = val();
      wc.printed = printed;
      erratum = { from: printed, to: truth };
    }
    docNOf(winner);
    if (winner.docN != null && r.chance(0.5)) { winner.docN = wN; wc.nExplicit = false; }
    const loserDocs = [];
    for (const pl of plans) {
      if (pl.t === 'loser' || pl.t === 'loser-recency') {
        const doc = docOf(pl.kind, pl.day, 'loser');
        const v = val();
        claim(doc, e, p, v, { n: pl.n });
        docNOf(doc);
        loserDocs.push(doc);
        continue;
      }
      const doc = docOf(pl.kind, pl.day, `trap-${pl.t}`);
      const v = val();
      switch (pl.t) {
        case 'retracted': claim(doc, e, p, v, { n: pl.n }); doc.role = 'trap-retracted'; break;
        case 'superseded': claim(doc, e, p, v, { n: pl.n }); doc.role = 'trap-v1'; break;
        case 'nonstd': claim(doc, e, p, v, { n: pl.n, cond: 'nonstd' }); break;
        case 'bound': claim(doc, e, p, v, { n: pl.n, kind: 'bound' }); break;
        case 'quote': doc.quotes.push({ e: e.id, p, canon: v, unit: unitFor(p), lab: r.pick(ctx.labs.filter(l => l.id !== doc.lab && !l.namesake)).id, n: pl.n }); addOwnFiller(ctx, doc, p); break;
        case 'prediction': doc.predictions.push({ e: e.id, p, canon: v, unit: unitFor(p), n: pl.n }); doc.docN = pl.n; addOwnFiller(ctx, doc, p); break;
        default: throw new Error(pl.t);
      }
      if (pl.t !== 'prediction') docNOf(doc);
      if (pl.t === 'retracted') {
        const nt = addDoc({ kind: 'retraction', pubDay: fresh(pl.day + 7, HI), lab: null, target: doc.key, role: 'notice', venue: doc.venue, notice: { reason: r.int(0, 3) } });
        if (nt.pubDay == null) return { reject: 'days' };
      }
      if (pl.t === 'superseded') {
        const journal = r.chance(0.4);
        const v2 = addDoc({ kind: journal ? 'journal' : 'preprint', pubDay: fresh(pl.day + 10, HI), lab: doc.lab, affil: doc.affil, supersedes: doc.key, supersedeForm: journal ? 'journal' : 'v2', role: 'trap-v2', primary: e.id, venue: journal ? null : doc.venue });
        if (v2.pubDay == null) return { reject: 'days' };
        if (journal) v2.venue = r.pick(JOURNALS);
        setTest(v2, 'any');
        // the new version drops this measurement; it reports another property under a non-standard condition
        const q = r.pick(PROP_IDS.filter(x => x !== p));
        claim(v2, e, q, drawCanon(q), { cond: 'nonstd' });
      }
    }
    if (erratum) {
      const nt = addDoc({ kind: 'erratum', pubDay: fresh(wDay + 7, HI), lab: null, target: winner.key, role: 'notice', venue: winner.venue, notice: { e: e.id, p, from: erratum.from, to: erratum.to, unit: wUnit } });
      if (nt.pubDay == null) return { reject: 'days' };
    }
    if (traps.has('concern')) {
      const nt = addDoc({ kind: 'concern', pubDay: fresh(wDay + 7, HI), lab: null, target: winner.key, role: 'notice', venue: winner.venue, notice: {} });
      if (nt.pubDay == null) return { reject: 'days' };
    }
    if (traps.has('outOfCorpus')) {
      // a retraction of a different, out-of-corpus article that shares the winner's title (author and year differ)
      const nt = addDoc({ kind: 'retraction', pubDay: fresh(wDay + 7, HI), lab: null, target: null, role: 'notice', venue: winner.venue, notice: { reason: r.int(0, 3), titleOf: winner.key, outOfCorpus: true } });
      if (nt.pubDay == null) return { reject: 'days' };
    }
    return { e: e.id, p, canon: truth, winner: winner.key, traps: [...traps], losers: loserDocs.map(x => x.key) };
  }
  return { reject: `cell-${p}` };
}

function addOwnFiller(ctx, doc, p) {
  // a quoting or predicting trap document still reports one measurement of its own (another property, non-standard)
  const { r, e, claim, drawCanon } = ctx;
  const q = r.pick(PROP_IDS.filter(x => x !== p));
  claim(doc, e, q, drawCanon(q), { cond: 'nonstd' });
}

// ---------------------------------------------------------------------------------------------------------------------
// World accessors shared by the pipeline, controls and tests.
export const labOf = (world, id) => world.labs.find(l => l.id === id);
export const entityOf = (world, id) => world.entities.find(e => e.id === id);
export const isResearch = doc => KINDS[doc.kind].research;
export const tierOfDoc = doc => KINDS[doc.kind].tier;
/** Compounds a document tests itself: own measurements of any property and condition, bounds included. */
export const testsOf = doc => new Set(doc.claims.map(c => c.e));
/** The value a claim prints (before any erratum). */
export const printedCanon = c => (c.printed ?? c.canon);
