// Assemble the held-out material from the authored sources (see pools.mjs for the format):
// parse, lint, dedup, skeleton-slice, select quotas, build the span registry. Pure in the authored
// directory (no clock, no randomness, no network), so a rebuild reproduces every file byte for byte.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadSpec } from '../lib/contracts.mjs';
import { SpanRegistry, defaultMasks } from '../lib/leakage.mjs';
import { COUNTRY_ORDER, lookup, COUNTRIES } from './gazetteer.mjs';
import { x8Items } from './x8.mjs';
import { RULES, hardness } from './hardness.mjs';
import { WORDING_PORTS, buildWordings, parseWordings } from './wordings.mjs';
import {
  AuthorError, CARRIER_PORTS, NS_KINDS, OOD_SLICES, POOLS, PRESENCE_MATCHED, QUOTA, SELECTION, WAVE1_UNKNOWABLE, X5_KINDS, X8_KINDS, REGISTERS,
  byHash, hash8, jaccard, lintEntry, makeUnit, ngramSet, normText, oodSliceOfHash, parseSource, placeholdersOf, selectQuota, skeletonOf,
} from './pools.mjs';

const stemLabel = f => f.replace(/\.txt$/, '').split(/[.\-_]/)[0];
const listTxt = dir => (existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.txt')).sort() : []);
let ROOT = '.';
const readEntries = (dir, file) => parseSource(readFileSync(path.join(dir, file), 'utf8'), { file: path.relative(ROOT, path.join(dir, file)) });
export const S5_KINDS = Object.freeze(['journal', 'preprint', 'labnote', 'press', 'erratum', 'retraction', 'concern']);
export const Q2_LABELS = Object.freeze(['cued', 'plain']);
const KIND_OF_PORT = { R1: 'date', R2: 'status', R3: 'sign', R4: 'stamp' };
export const HELDOUT_SURFACE_PORTS = Object.freeze([...WORDING_PORTS, 'S5', 'Q2']);

export function loadAuthored(authoredDir) {
  ROOT = authoredDir;
  const A = { pools: {}, x5pairs: [], x5ns: [], x5bank: [], x8: [], nondeciding: {}, carriers: {}, cities: [], s5: [], q2: {}, wordings: {} };
  for (const port of ['R1', 'R2', 'R3', 'R4', 'X1']) {
    const dir = path.join(authoredDir, port); A.pools[port] = {};
    for (const f of listTxt(dir)) (A.pools[port][stemLabel(f)] ??= []).push(...readEntries(dir, f));
  }
  const x5 = path.join(authoredDir, 'X5');
  for (const f of listTxt(x5)) (f.startsWith('pairs') ? A.x5pairs : f.startsWith('not_stated') ? A.x5ns : f.startsWith('assumptions') ? A.x5bank : (() => { throw new AuthorError('AUTHOR_FILE', `X5/${f}: expected pairs*.txt, not_stated*.txt or assumptions*.txt`); })()).push(...readEntries(x5, f));
  const x8 = path.join(authoredDir, 'X8');
  for (const f of listTxt(x8)) A.x8.push(...readEntries(x8, f));
  for (const [dirName, target] of [['nondeciding', A.nondeciding], ['carriers', A.carriers], ['wordings', A.wordings]]) {
    const dir = path.join(authoredDir, dirName);
    for (const f of listTxt(dir)) (target[stemLabel(f)] ??= []).push(...readEntries(dir, f));
  }
  const cdir = authoredDir; for (const f of listTxt(cdir).filter(x => x.startsWith('cities'))) A.cities.push(...readEntries(cdir, f));
  const s5 = path.join(authoredDir, 'S5'); for (const f of listTxt(s5)) A.s5.push(...readEntries(s5, f));
  const q2 = path.join(authoredDir, 'Q2'); for (const f of listTxt(q2)) (A.q2[stemLabel(f)] ??= []).push(...readEntries(q2, f));
  return A;
}

// ---- builders ---------------------------------------------------------------------------------------------
function dupChecks(units, errors, { sameLabelThreshold = 0.5, crossLabelThreshold = 0.85, label = 'pool' } = {}) {
  const seenText = new Map(), seenSkel = new Map();
  for (const u of units) {
    const t = normText(u.text) + (u.assumption ? `\u0000${normText(u.assumption)}` : '');
    if (seenText.has(t)) errors.push(`${u.source}: ${label} duplicates ${seenText.get(t)}`); else seenText.set(t, u.source);
    const k = `${u.role}:${u.skeleton}`;
    if (seenSkel.has(k) && !(u.pairId && seenSkel.get(k).pairId === u.pairId)) {
      const o = seenSkel.get(k);
      errors.push(`${u.source}: ${label} skeleton equals ${o.source}${o.label !== u.label ? ` (different labels ${o.label}/${u.label}: masked collision)` : ''}`);
    } else seenSkel.set(k, u);
  }
  const grams = units.map(u => ngramSet(u.text, 4)), index = new Map();
  grams.forEach((g, i) => { for (const x of g) { const l = index.get(x) ?? []; l.push(i); index.set(x, l); } });
  grams.forEach((g, i) => {
    const hit = new Map();
    for (const x of g) for (const j of index.get(x)) if (j > i) hit.set(j, true);
    for (const j of hit.keys()) {
      if (units[i].pairId && units[i].pairId === units[j].pairId) continue;
      const jac = jaccard(g, grams[j]), same = units[i].label === units[j].label;
      if (jac >= (same ? sameLabelThreshold : crossLabelThreshold)) errors.push(`${units[i].source}: near-duplicate (${(jac * 100) | 0}% 4-gram overlap) of ${units[j].source}`);
    }
  });
}

export function selectPool(port, units, errors, stats) {
  const decisive = units.filter(u => u.role === 'decisive');
  const labels = POOLS[port].labels;
  stats[port] = {};
  // local probe-hard proxy (hardness.mjs): a tie-break that biases which authored lines fill a slice
  const proxy = RULES[port] ? hardness(port, decisive) : null;
  if (proxy) for (const u of decisive) u.proxy = proxy.get(u.id);
  const hardOpts = proxy ? { prefer: u => u.proxy?.hard === true, preferShare: 0.5 } : {};
  const apply = (cands, label, slice, opts) => {
    const live = cands.filter(u => u.status !== 'rejected');
    const forced = live.filter(u => u.status === 'admitted' || u.tagMap?.tu);      // top-up lines (tag tu=1|2) replace the tail of the hash order
    const r = selectQuota(live, QUOTA[slice], { ...hardOpts, ...opts, forced });
    const chosen = new Set(r.selected);
    for (const u of live) if (u.status !== 'admitted') u.status = chosen.has(u) ? 'pending-filter' : 'reserve';
    stats[port][label] ??= {}; stats[port][label][slice] = { authored: cands.length, selected: r.selected.length, reserve: live.length - r.selected.length, shortfall: r.shortfall, classes: r.counts,
      ...(proxy ? { proxyHard: r.selected.filter(u => u.proxy?.hard).length } : {}) };
    if (r.shortfall > 0) errors.push(`${port}/${label}/${slice}: ${live.length} usable lines for a quota of ${QUOTA[slice]} (author ${r.shortfall} more, or relax the class mix ${JSON.stringify(r.counts)})`);
  };
  if (port === 'X8') {
    for (const slice of OOD_SLICES) apply(decisive.filter(u => u.slice === slice), 'units', slice, SELECTION.X8);
    return;
  }
  for (const label of labels) {
    const base = decisive.filter(u => u.label === label);
    let opts = {};
    if (port === 'R4') opts = SELECTION.R4;
    if (port === 'X1') opts = label === 'yes' ? SELECTION.X1yes : SELECTION.X1no;
    if (port === 'X5' && label === 'not_stated') opts = SELECTION.X5notStated;
    for (const slice of OOD_SLICES) {
      const cands = base.filter(u => u.slice === slice);
      if (port === 'X5' && label === 'violated') {
        // mirror the pair selection: a pair is selected as one. A status the two-model filter set
        // (admitted / rejected; filter.mjs decides a pair as one) is never overwritten here: an unfiltered
        // twin follows its holds unit's selection, and a filter-rejected holds unit's twin leaves the pool.
        const holds = decisive.filter(u => u.label === 'holds' && u.slice === slice);
        const byPair = new Map(holds.map(u => [u.pairId, u]));
        for (const u of cands) {
          const h = byPair.get(u.pairId);
          if (!h || u.status === 'admitted' || u.status === 'rejected') continue;
          u.status = h.status === 'admitted' ? 'pending-filter' : h.status === 'rejected' ? 'reserve' : h.status;
        }
        stats[port][label] ??= {}; stats[port][label][slice] = { authored: cands.length, selected: cands.filter(u => u.status !== 'reserve' && u.status !== 'rejected').length, reserve: cands.filter(u => u.status === 'reserve').length, shortfall: 0, classes: {} };
        continue;
      }
      apply(cands, label, slice, opts);
    }
  }
}

// Build everything. Returns {wordings, surface, cities, registry, errors, stats}.
export function assemble(authoredDir, { spec = loadSpec(), masks = defaultMasks(), lenient = false } = {}) {
  const A = loadAuthored(authoredDir), errors = [], stats = {}, contracts = spec.contracts, surface = {};
  for (const p of HELDOUT_SURFACE_PORTS) surface[p] = [];
  const systemsOf = p => contracts[p === 'X5' || p === 'X8' ? 'R1' : p].slots?.system?.values ?? [];

  // wordings
  const wordings = [];
  for (const port of WORDING_PORTS) {
    const r = buildWordings(port, A.wordings[port] ?? [], contracts[port]);
    wordings.push(...r.wordings); errors.push(...r.errors);
  }
  // cities
  const cities = [];
  for (const e of A.cities) {
    const cc = Object.keys(e.meta.tags)[0], city = e.fields[0], where = `${e.file}:${e.lineNo}`;
    if (!COUNTRIES[cc]) { errors.push(`${where}: unknown country code ${cc}`); continue; }
    const found = lookup(city);
    if (found.length !== 1 || found[0] !== cc) errors.push(`${where}: ${city} maps to [${found.join(',')}] in the gazetteer, not exactly ${cc}`);
    if (!COUNTRY_ORDER[cc]) errors.push(`${where}: ${cc} has no customary order in the bed's rule (use US or a day-first country)`);
    // a held-out entity list is sliced like the lines (by the skeleton hash of the name), so a consumer can keep
    // test-OOD cities out of calib-OOD and dev-OOD items, and each name is registered in one slice (§2.3 rule 7)
    cities.push({ city, cc, country: COUNTRIES[cc], order: COUNTRY_ORDER[cc], slice: oodSliceOfHash(skeletonOf(city, masks)) });
  }
  if (new Set(cities.map(c => c.city.toLowerCase())).size !== cities.length) errors.push('cities: duplicate city');

  // decisive R1-R4, X1
  for (const port of ['R1', 'R2', 'R3', 'R4', 'X1']) {
    const pool = POOLS[port], systems = systemsOf(port);
    for (const label of Object.keys(A.pools[port])) if (!pool.labels.includes(label) && !(pool.extraLabels ?? []).includes(label)) errors.push(`${port}: unknown label file ${label}`);
    for (const label of [...pool.labels, ...(pool.extraLabels ?? [])]) for (const e of A.pools[port][label] ?? []) {
      const es = lintEntry(port, label, e, { systems }); errors.push(...es);
      const know = label === 'know';
      const u = makeUnit(port, know ? null : label, e, { systems, masks, role: know ? 'know' : null });
      Object.assign(u, know ? { label: null, labels: ['dmy', 'mdy'], role: 'knowledge', status: 'pending-filter', filter: null } : { role: 'decisive', status: 'reserve', filter: null });
      if (port === 'X1') u.sourceKind = e.meta.tags.k;
      surface[port].push(u);
    }
    dupChecks(surface[port], errors, { label: port });
  }
  // X5
  {
    // The assumption bank is sliced like every authored line: an assumption belongs to the OOD slice of its own
    // skeleton hash and is only paired with situation lines of that slice, so no assumption phrasing (X5's
    // gating template axis is "authored assumption and conventions lines", §3.3) is shared across slices.
    const systems = systemsOf('X5'), raw = [], bank = {};
    for (const e of A.x5bank) {
      errors.push(...lintEntry('X5', 'bank', e, { systems }));
      const t = e.meta.tags; ((bank[`${t.K}/${t.V}`] ??= {})[oodSliceOfHash(skeletonOf(e.fields[0], masks))] ??= []).push(e.fields[0]);
    }
    const fromBank = (K, V, slice, key, where) => {
      const list = bank[`${K}/${V}`]?.[slice];
      if (!list?.length) { errors.push(`${where}: no ${slice} assumption in the bank for K=${K} V=${V} (author one whose skeleton falls in ${slice})`); return ''; }
      return list[parseInt(hash8(key), 16) % list.length];
    };
    for (const e of A.x5pairs) {
      errors.push(...lintEntry('X5', 'pair', e, { systems }));
      const t = e.meta.tags, h = hash8(e.fields[0]), where = `${e.file}:${e.lineNo}`;
      const text = e.fields[0], slice = oodSliceOfHash(skeletonOf(text, masks));
      const a1 = e.fields[1] ?? fromBank(t.K, t.V, slice, `${text}|H`, where), a2 = e.fields[2] ?? fromBank(t.K, t.W, slice, `${text}|V`, where);
      for (const [label, assumption, av] of [['holds', a1, t.V], ['violated', a2, t.W]]) {
        const u = makeUnit('X5', label, { ...e, fields: [text] }, { systems, masks });
        Object.assign(u, { id: `X5-${label}-${h}`, role: 'decisive', status: 'reserve', filter: null, pairId: `X5-P-${h}`, assumption, kind: t.K, value: t.V, assumptionValue: av, ns: null });
        raw.push(u);
      }
    }
    for (const e of A.x5ns) {
      errors.push(...lintEntry('X5', 'not_stated', e, { systems }));
      const text = e.fields[0], t = e.meta.tags, ph = placeholdersOf(text), assumption = e.fields[1] ?? fromBank(t.K, t.V, oodSliceOfHash(skeletonOf(text, masks)), `${text}|N`, `${e.file}:${e.lineNo}`);
      if (t.ns === 'other-system' && !(ph.includes('S2') && ph.includes('S'))) errors.push(`${e.file}:${e.lineNo}: other-system needs {S} (a non-deciding mention) and {S2} (the other system's sentence)`);
      if (t.ns === 'other-convention' && (!ph.includes('S') || !t.about || t.about === t.K || !X5_KINDS[t.about])) errors.push(`${e.file}:${e.lineNo}: other-convention needs {S} and about=<a kind other than K=${t.K}>`);
      if (t.ns === 'absent-system' && (ph.includes('S') || !ph.includes('S2'))) errors.push(`${e.file}:${e.lineNo}: absent-system names {S2} only, never {S}`);
      const u = makeUnit('X5', 'not_stated', { ...e, fields: [text] }, { systems, masks });
      Object.assign(u, { id: `X5-not_stated-${hash8(`${text}\u0000${assumption}`)}`, role: 'decisive', status: 'reserve', filter: null, pairId: null, assumption, kind: t.K, value: t.V, ns: t.ns, about: t.about ?? null });
      raw.push(u);
    }
    surface.X5.push(...raw);
    dupChecks(surface.X5, errors, { label: 'X5' });
  }
  // X8
  {
    const systems = systemsOf('X8');
    for (const e of A.x8) {
      errors.push(...lintEntry('X8', null, e, { systems }));
      const u = makeUnit('X8', 'units', e, { systems, masks });
      Object.assign(u, { id: `X8-${hash8(e.fields[0])}`, label: null, role: 'decisive', status: 'reserve', filter: null, kind: e.meta.tags.K, value: e.meta.tags.V });
      try { u.items = x8Items(u, { cities }); } catch (err) { errors.push(`${u.source}: ${err.message}`); u.items = []; }
      surface.X8.push(u);
    }
    dupChecks(surface.X8, errors, { label: 'X8' });
  }
  for (const port of ['R1', 'R2', 'R3', 'R4', 'X1', 'X5', 'X8']) selectPool(port, surface[port], errors, stats);

  // non-deciding lines (presence-matched unknowables)
  for (const port of WAVE1_UNKNOWABLE) {
    const systems = systemsOf(port);
    for (const e of A.nondeciding[port] ?? []) {
      const t = e.meta.tags, ph = placeholdersOf(e.fields[0]), where = `${e.file}:${e.lineNo}`;
      errors.push(...lintEntry(port, null, e, { systems, nondeciding: true, slots: ['S', 'S2', 'token', 'w0', 'w1', 'field'] }));
      if (!PRESENCE_MATCHED.includes(t.ns)) errors.push(`${where}: non-deciding line needs ns=${PRESENCE_MATCHED.join('|')}`);
      if (t.ns === 'other-system' && !ph.includes('S2')) errors.push(`${where}: other-system lines name {S2}`);
      if (t.ns === 'other-system' && ph.includes('S')) errors.push(`${where}: other-system lines do not name {S}`);
      if (t.ns === 'other-convention' && (!ph.includes('S') || !t.about || t.about === KIND_OF_PORT[port] || !X5_KINDS[t.about])) errors.push(`${where}: other-convention lines name {S} and about=<a kind other than ${KIND_OF_PORT[port]}>`);
      const u = makeUnit(port, 'nondeciding', e, { systems, masks });
      Object.assign(u, { id: `${port}-N-${hash8(e.fields[0])}`, label: null, role: 'nondeciding', status: 'pending-filter', filter: null, ns: t.ns, about: t.about ?? null });
      surface[port].push(u);
    }
    dupChecks(surface[port].filter(u => u.role === 'nondeciding'), errors, { label: `${port} nondeciding` });
  }
  // carriers (injection text urging a wrong option, re-targeted per port)
  for (const [port, options] of Object.entries(CARRIER_PORTS)) {
    const systems = contracts.R1.slots.system.values;
    for (const e of A.carriers[port] ?? []) {
      const t = e.meta.tags, where = `${e.file}:${e.lineNo}`;
      if (!options.includes(t.t)) errors.push(`${where}: carrier target t=${t.t} is not an option of ${port}`);
      if (!e.meta.register) errors.push(`${where}: missing register code`);
      for (const f of e.fields) { const bare = f.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, ''); if (/[{}]/.test(bare)) errors.push(`${where}: stray brace`); for (const p of placeholdersOf(f)) if (!['S', 'token', 'field'].includes(p)) errors.push(`${where}: placeholder {${p}} not allowed in a carrier`); if (f.length < 12 || f.length > 600) errors.push(`${where}: carrier length`); }
      const u = makeUnit(port, 'carrier', e, { systems, masks });
      Object.assign(u, { id: `${port}-C-${hash8(`${t.t}|${e.fields[0]}`)}`, label: null, role: 'carrier', target: t.t, status: 'carrier', filter: null });
      surface[port].push(u);
    }
    dupChecks(surface[port].filter(u => u.role === 'carrier'), errors, { label: `${port} carriers`, sameLabelThreshold: 0.85, crossLabelThreshold: 0.85 });
  }
  // S5 unseen type names
  for (const e of A.s5) {
    const kind = e.meta.tags.kind, [type_label, venue, title] = e.fields, where = `${e.file}:${e.lineNo}`;
    if (!S5_KINDS.includes(kind)) errors.push(`${where}: S5 kind must be one of ${S5_KINDS.join('|')}`);
    if (e.fields.length !== 3) errors.push(`${where}: S5 entry is kind=<option>@@type label@@venue@@title`);
    const sk = skeletonOf(type_label, masks);
    const u = { id: `S5-U-${hash8(type_label)}`, port: 'S5', role: 'type-name', label: kind, text: type_label, type_label, venue, title, register: null, regCode: null, tags: Object.keys(e.meta.tags).sort(), tagMap: { ...e.meta.tags }, hard: [], systems: [],
      features: { words: type_label.split(/\s+/).length }, skeleton: sk, slice: oodSliceOfHash(sk), source: `${e.file}:${e.lineNo}`, status: 'pending-filter', filter: null };
    surface.S5.push(u);
  }
  { const seen = new Map(); for (const u of surface.S5) { const k = u.skeleton; if (seen.has(k)) errors.push(`${u.source}: S5 type label repeats ${seen.get(k)}`); else seen.set(k, u.source); } }
  // Q2 cues
  for (const label of Object.keys(A.q2)) {
    if (!Q2_LABELS.includes(label)) { errors.push(`Q2: unknown label file ${label}`); continue; }
    for (const e of A.q2[label]) {
      const sk = skeletonOf(e.fields[0], masks);
      surface.Q2.push({ id: `Q2-${label}-${hash8(e.fields[0])}`, port: 'Q2', role: 'cue', label, text: e.fields[0], register: null, regCode: null, tags: [], tagMap: {}, hard: Object.keys(e.meta.tags).filter(t => ['neg', 'ctr', 'wr', 'cmp'].includes(t)), systems: [],
        features: { words: e.fields[0].split(/\s+/).length }, skeleton: sk, slice: oodSliceOfHash(sk), source: `${e.file}:${e.lineNo}`, status: 'pending-filter', filter: null });
    }
  }
  { const seen = new Map(); for (const u of surface.Q2) { if (seen.has(u.skeleton)) errors.push(`${u.source}: Q2 cue repeats ${seen.get(u.skeleton)}${seen.get(u.skeleton).includes(u.label) ? '' : ' (different label: masked collision)'}`); else seen.set(u.skeleton, `${u.source}:${u.label}`); } }

  for (const port of Object.keys(surface)) surface[port].sort((a, b) => (a.role < b.role ? -1 : a.role > b.role ? 1 : (a.label ?? '') < (b.label ?? '') ? -1 : (a.label ?? '') > (b.label ?? '') ? 1 : byHash(a, b)));
  const registry = buildRegistry({ surface, wordings, cities }, masks);
  errors.push(...registrySliceConflicts(registry));
  if (errors.length && !lenient) { const e = new AuthorError('AUTHOR_LINT', `${errors.length} problem(s):\n  ${errors.slice(0, 60).join('\n  ')}${errors.length > 60 ? `\n  ... ${errors.length - 60} more` : ''}`); e.errors = errors; throw e; }
  return { wordings, surface, cities, registry, errors, stats, contractsHash: spec.hash };
}

// The span-skeleton registry (§2.3 rule 7): hashes only, never text. Every authored line, assumption,
// carrier, type name, cue and wording is registered with the slice it belongs to.
export function buildRegistry({ surface, wordings, cities = [] }, masks = defaultMasks()) {
  const reg = new SpanRegistry([], { masks });
  const add = (text, slice, port, kind, source) => { if (text && String(text).trim()) reg.add(text, { slice, source, port, kind }); };
  for (const [port, units] of Object.entries(surface)) {
    for (const u of units) {
      if (u.role === 'type-name') add(u.type_label, u.slice, port, 'type-label', `heldout:${u.id}`);
      else if (u.role === 'decisive' && port === 'X8') add(u.text, u.slice, port, 'conventions', `heldout:${u.id}`);
      else add(u.text, u.slice, port, u.role === 'carrier' ? 'carrier' : u.role === 'nondeciding' ? 'nondeciding' : u.role === 'cue' ? 'cue' : 'line', `heldout:${u.id}`);
      if (u.assumption) add(u.assumption, u.slice, port, 'assumption', `heldout:${u.id}`);
    }
  }
  for (const w of wordings) add(w.text, w.slice, w.port, 'wording', `heldout:${w.port}/${w.id}`);
  for (const c of cities) add(c.city, c.slice, 'R1', 'entity', `heldout:city-${hash8(c.city)}`);
  return reg;
}
// A registered skeleton belongs to one OOD slice: the same masked form in two slices would leak one slice's
// material into the other (and make the build's cross-slice span check contradict itself).
export function registrySliceConflicts(registry) {
  const bySkel = new Map();
  for (const e of registry.entries()) (bySkel.get(e.hash) ?? bySkel.set(e.hash, new Map()).get(e.hash)).set(e.slice, e);
  return [...bySkel.entries()].filter(([, m]) => m.size > 1)
    .map(([h, m]) => `registry: skeleton ${h.slice(7, 19)} is registered in ${[...m.keys()].sort().join(' and ')} (${[...m.values()].map(e => `${e.port}/${e.kind} ${e.source}`).join('; ')})`);
}
