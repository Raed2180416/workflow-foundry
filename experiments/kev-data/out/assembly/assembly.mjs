// Wave-A development assembly (JUDGE-PROGRAM.md §2.4, §3, §4.3; JUDGE-BUILD-PLAN.json group "assembly", which is not
// built yet). Written by the wave-A dataset-build workflow (2026-10-09) as a thin, development-only stand-in so that
// every wave-A generator can be built in every slice:
//
//   - the held-out material reaches a generator only through its opts, computed here per slice from the held-out store
//     (heldout/surface.mjs: wordings of the slice, surface units of the slice with statuses admitted, pending-filter and
//     carrier; NOTE: the two-model filter has not run, so every authored OOD line is still pending-filter);
//   - the records group's OOD lines are converted from held-out surface units into its line schema (recordsLines);
//   - the supply-driven generators (kinetics, runbook, interactive) are capped per port and slice at the §4.3 sizes at the
//     20K curve point (QUOTAS), keeping pairs whole;
//   - held-out family spans of test-ood records (and bedtype's OOD spans) are registered into the build's span registry
//     while the build runs (test-ood is generated before every train-like slice, build.mjs SLICE_PRIORITY);
//   - a train-like or OOD record whose state carries a registered span is dropped and counted (rule 7: re-render or drop).
//
// Nothing here writes held-out text anywhere: opts (which reach the build manifest) carry digests only. Pure: no clock,
// no Math.random; every choice is a function of the held-out store, the slice and the inner generator's output.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { loadSurface, loadWordings, loadCities, prefillHeldoutSlots } from '../../heldout/surface.mjs';
import { hasAddressee } from '../../ports/records-notes.mjs';
import { stateHash } from '../../lib/hash.mjs';

const sha = s => createHash('sha256').update(s).digest('hex');
export const DEV_STATUSES = Object.freeze(['admitted', 'pending-filter', 'carrier']);
export const OOD = new Set(['calib-ood', 'dev-ood', 'test-ood']);
const TRAIN_LIKE = new Set(['train', 'calib-in', 'dev-select']);
const TEST = new Set(['test-in', 'test-ood']);
const FORBIDDEN_PREFILL = /\{(?:S2|city|country)\}/;

// shared state of one process (the driver sets it before each build)
export const STATE = globalThis.__KEV_WAVE_A ??= { registry: null, report: {} };
const bump = (group, slice, key, n = 1) => { const g = (STATE.report[group] ??= {}); const s = (g[slice] ??= {}); s[key] = (s[key] ?? 0) + n; };

// ---- §4.3 quotas (rows = questions) for the supply-driven generators, at the 20K curve point ---------------------------------
// hard ports 1,935 train rows (S2, X1, X3, X5, X8, I1, F1, Q4), split evenly over their train families (X1 six, X5 four, X8 two,
// Q4 two); evaluation sets per port split the same way; wave-2 smoke ports about 300 train and 100 dev-select rows.
export const QUOTAS = Object.freeze({
  kinetics: {
    train: { X3: 1935, X8: 968, K1: 300, K2: 300, K3: 300, X4: 300 },
    'calib-in': { X3: 300, X8: 150 }, 'calib-ood': { X3: 500, X8: 250 },
    'dev-select': { X3: 200, X8: 100, K1: 100, K2: 100, K3: 100, X4: 100 }, 'dev-ood': { X3: 600, X8: 300 },
    'test-in': { X3: 500, X8: 250 }, 'test-ood': { X3: 2100, X8: 1100, X5: 600, X1: 600, X7: 100 },
  },
  runbook: {
    train: { Q4: 968, X1: 323, X4: 300 },
    'calib-in': { Q4: 150, X1: 50 }, 'calib-ood': { Q4: 250, X1: 100 },
    'dev-select': { Q4: 100, X1: 33, X4: 100 }, 'dev-ood': { Q4: 300, X1: 100 },
    'test-in': { Q4: 250, X1: 83 }, 'test-ood': { Q4: 1050, X1: 192, X3: 600, X5: 600 },
  },
  interactive: {
    train: { 'Q4:gridquest': 968, 'X1:gameqa': 323, Q1: 300, Q2: 300, Q5: 300, Q6: 300, X6: 300 },
    'calib-in': { 'Q4:gridquest': 150, 'X1:gameqa': 50 }, 'calib-ood': { 'Q4:gridquest': 250, 'X1:gameqa': 100 },
    'dev-select': { 'Q4:gridquest': 100, 'X1:gameqa': 33, Q1: 100, Q2: 100, Q5: 100, Q6: 100, X6: 100 }, 'dev-ood': { 'Q4:gridquest': 300, 'X1:gameqa': 100 },
    'test-in': { 'Q4:gridquest': 250, 'X1:gameqa': 83 }, 'test-ood': { 'Q4:gridquest': 1050, 'Q4:gameqa': 600, 'X1:gameqa': 192, 'X1:gridquest': 600, 'X2:gameqa': 100 },
  },
});

// ---- held-out material per slice ----------------------------------------------------------------------------------------------
const MEMO = new Map();
const memo = (k, f) => { if (!MEMO.has(k)) MEMO.set(k, f()); return MEMO.get(k); };
export function wordingsFor(dir, slice) {
  return memo(`w|${dir}|${slice}`, () => {
    const out = {};
    for (const w of loadWordings(dir).filter(x => x.slice === slice)) (out[w.port] ??= []).push({ id: w.id, text: w.text });
    for (const l of Object.values(out)) l.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return out;
  });
}
const surface = (dir, port, slice) => memo(`s|${dir}|${port}|${slice}`, () => loadSurface(port, { dir, slice, statuses: [...DEV_STATUSES] }));
export const citiesFor = (dir, slice) => memo(`c|${dir}|${slice}`, () => loadCities(dir).filter(c => c.slice === slice).map(c => ({ city: c.city, order: c.order })));
export function heldoutDigests(dir) {
  const f = p => (existsSync(p) ? `sha256:${sha(readFileSync(p))}` : null);
  const files = ['wordings.jsonl', 'registry.json', 'cities.json', ...readdirSync(path.join(dir, 'surface')).sort().map(x => `surface/${x}`)];
  return Object.fromEntries(files.map(x => [x, f(path.join(dir, x))]));
}
export function poolDigests(dir) {
  if (!dir || !existsSync(dir)) return null;
  const files = readdirSync(dir).filter(f => /^[A-Za-z0-9]+\.jsonl$/.test(f)).sort();
  const listing = files.map(f => `${f}:${sha(readFileSync(path.join(dir, f), 'utf8'))}`);
  return { records: `sha256:${sha(listing.join('\n'))}`, X1: existsSync(path.join(dir, 'X1.jsonl')) ? `sha256:${sha(readFileSync(path.join(dir, 'X1.jsonl'), 'utf8'))}` : null };
}
const carriersOf = (dir, port, slice) => surface(dir, port, slice).filter(u => u.role === 'carrier');

// ---- records: held-out surface units -> records-notes line schema ---------------------------------------------------------------
const R_KIND = { R1: 'order', R2: 'flag', R3: 'side', R4: 'stamp' };
const X5_ASSERTS = { date: 'R1', status: 'R2', sign: 'R3', stamp: 'R4' };
const R_SYSTEMS = { R1: ['BRIGHTDESK', 'ATLAS', 'VENDEX'], R2: null, R3: null, R4: null };
export function recordsLines(dir, slice, contracts, counts = {}) {
  return memo(`rl|${dir}|${slice}`, () => {
    const out = [], cities = loadCities(dir), c = k => { counts[k] = (counts[k] ?? 0) + 1; };
    const push = l => { out.push({ slice, group: 'ood', ...l }); c(`line:${l.port}:${l.kind}`); };
    for (const port of ['R1', 'R2', 'R3', 'R4']) {
      const allSystems = contracts[port].slots?.system?.values ?? [];
      for (const u of surface(dir, port, slice)) {
        if (u.role === 'carrier') {
          if (FORBIDDEN_PREFILL.test(u.text)) { c(`drop:${port}:carrier:prefill-slot`); continue; }
          push({ id: u.id, port, kind: 'carrier', group: 'carrier', label: u.target, text: u.text, filter: 'carrier' });
        } else if (u.role === 'nondeciding') {
          if (FORBIDDEN_PREFILL.test(u.text)) { c(`drop:${port}:nondeciding:prefill-slot`); continue; }
          push({ id: u.id, port, kind: 'nondeciding', label: null, text: u.text, filter: u.status });
        } else if (u.role === 'decisive' || u.role === 'knowledge') {
          const labels = u.role === 'knowledge' ? (u.labels ?? []) : [u.label];
          const eligible = (u.systems ?? allSystems).filter(s => allSystems.includes(s) && (!R_SYSTEMS[port] || R_SYSTEMS[port].includes(s)));
          const perSystem = /\{S2\}/.test(u.text) || eligible.length < allSystems.length;
          for (const label of labels) for (const sys of perSystem ? eligible : [null]) {
            let filled;
            try { filled = prefillHeldoutSlots(u, { cities, order: port === 'R1' ? label : null, system: sys, salt: `${slice}|${label}` }); }
            catch { c(`drop:${port}:${u.role}:prefill-failed`); continue; }
            if (FORBIDDEN_PREFILL.test(filled.text)) { c(`drop:${port}:${u.role}:prefill-left`); continue; }
            push({ id: `${u.id}${sys ? `@${sys}` : ''}${u.role === 'knowledge' ? `:${label}` : ''}`, port, kind: u.role === 'knowledge' ? 'knowledge' : R_KIND[port], label, system: sys,
              order: port === 'R1' ? label : null, windowed: port === 'R4' ? /\{w0\}/.test(filled.text) : null, text: filled.text, filter: u.status,
              needsWorldKnowledge: u.role === 'knowledge' || Boolean(filled.values.city), features: u.features ?? null });
          }
        }
      }
    }
    // X5: the assumption clauses (the question side) of the slice's units; carriers urge an option
    const seen = new Set();
    for (const u of surface(dir, 'X5', slice)) {
      if (u.role === 'carrier') {
        if (FORBIDDEN_PREFILL.test(u.text)) { c('drop:X5:carrier:prefill-slot'); continue; }
        push({ id: u.id, port: 'X5', kind: 'carrier', group: 'carrier', label: u.target, text: u.text, filter: 'carrier' });
        continue;
      }
      if (u.role !== 'decisive' || !u.assumption) continue;
      const asserts = X5_ASSERTS[u.kind], value = u.assumptionValue ?? u.value;
      if (!asserts || !value) { c('drop:X5:assumption:no-kind'); continue; }
      if (FORBIDDEN_PREFILL.test(u.assumption)) { c('drop:X5:assumption:prefill-slot'); continue; }
      const k = `${asserts}|${value}|${u.assumption}`;
      if (seen.has(k)) continue;
      seen.add(k);
      push({ id: `X5-asm-${sha(k).slice(0, 10)}`, port: 'X5', group: 'authored', kind: 'assumption', assertsPort: asserts, label: value, text: u.assumption, filter: u.status });
    }
    // X1: memo lines (records family): positive / hard-negative (addressee words) / benign
    for (const u of surface(dir, 'X1', slice)) {
      if (u.role !== 'decisive') continue;
      if (/\{[A-Za-z_][A-Za-z0-9_]*\}/.test(u.text)) { c('drop:X1:slot'); continue; }
      // the store labels X1 lines yes/no only; records' class mix also draws decoys (a 'no' memo that looks like a marker): the
      // negatives without an addressee word are split benign/decoy by a hash of the line id, so no class starves the OOD slice
      const kind = u.label === 'yes' ? 'positive' : hasAddressee(u.text) ? 'hard-negative' : parseInt(sha(`x1class|${u.id}`).slice(0, 8), 16) % 2 ? 'decoy' : 'benign';
      push({ id: u.id, port: 'X1', group: 'authored', kind, label: u.label, family: null, role: kind, addressee: hasAddressee(u.text), sourceKind: u.sourceKind ?? null, text: u.text, filter: u.status });
    }
    return out;
  });
}

// ---- per-group slice opts -----------------------------------------------------------------------------------------------------
export function sliceOpts(group, slice, opts, ctx) {
  const dir = ctx.heldoutDir, ood = OOD.has(slice), base = { ...(opts.inner ?? {}) };
  if (ood) base.wordings = wordingsFor(dir, slice);
  const pools = opts.poolDigests ?? null;
  switch (group) {
    case 'records-notes': {
      base.pools = { dir: ctx.poolsDir, digest: pools?.records };
      base.builtin = opts.inner?.builtin ?? ['carriers'];
      if (ood) { const counts = (STATE.recordsLineCounts ??= {})[slice] ??= {}; base.lines = recordsLines(dir, slice, ctx.contracts, counts); base.cities = citiesFor(dir, slice); }
      return base;
    }
    case 'kinetics': return base;
    case 'runbook': {
      const trainPool = readJsonl(path.join(ctx.poolsDir, 'X1.jsonl')).filter(l => l.family === 'runbook');
      const own = ood ? surface(dir, 'X1', slice).filter(u => u.role === 'decisive').map(u => ({ id: u.id, text: u.text, label: u.label, sourceKind: RUNBOOK_SOURCE_KIND[u.sourceKind] ?? 'text', slice, family: 'runbook', filter: u.status })) : [];
      base.lines = [...trainPool, ...own];
      if (ood) {
        const car = carriersOf(dir, 'Q4', slice);
        base.carriers = { normal: car.filter(u => u.target === 'as_expected').map(u => u.text), alarm: car.filter(u => u.target === 'drifted').map(u => u.text) };
      }
      return base;
    }
    case 'interactive': {
      base.pools = { dir: ctx.poolsDir, digest: pools?.X1 };
      if (ood) base.lines = [...surface(dir, 'X1', slice).filter(u => u.role === 'decisive'), ...carriersOf(dir, 'Q4', slice)];
      return base;
    }
    case 'failures-code': {
      if (ood) base.lines = carriersOf(dir, 'F1', slice).map(u => ({ id: u.id, port: 'F1', role: 'carrier', slice, target: u.target, text: u.text }));
      return base;
    }
    case 'construction-crossfamily': return base;
    default: throw new Error(`no assembly for group ${group}`);
  }
}
// the held-out store's short source kinds (heldout/pools.mjs X1_KINDS) -> the runbook kit's source_kind vocabulary ('text' otherwise)
const RUNBOOK_SOURCE_KIND = Object.freeze({ log: 'log line', ticket: 'ticket comment', comment: 'ticket comment' });
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

// ---- the wrapper ------------------------------------------------------------------------------------------------------------------
const portOfQid = q => q.split('~')[0].replace(/_present$/, '');
const rowsByPort = r => { const m = {}; for (const q of Object.keys(r.questions)) { const p = portOfQid(q); m[p] = (m[p] ?? 0) + 1; } return m; };
export async function* wrap(inner, group, slice, seeds, opts, ctx, { onFirst = null } = {}) {
  const o = sliceOpts(group, slice, opts ?? {}, ctx);
  if (onFirst && !STATE[`first|${group}`]) { STATE[`first|${group}`] = true; await onFirst(ctx); }
  const quota = QUOTAS[group]?.[slice] ?? null, used = {}, pairsKept = new Set(), reg = STATE.registry, askedInSlice = new Set();
  const keyOf = (port, fam) => (quota && quota[`${port}:${fam}`] !== undefined ? `${port}:${fam}` : port);
  const full = () => quota && Object.entries(quota).every(([k, n]) => (used[k] ?? 0) >= n);
  for await (const r of inner.records(slice, seeds, o, ctx)) {
    const fam = r.meta?.family, rows = rowsByPort(r), pair = r.meta?.pairId ?? null;
    if (quota) {
      const keys = Object.keys(rows).map(p => keyOf(p, fam));
      const room = keys.every(k => quota[k] === undefined || (used[k] ?? 0) < quota[k]);
      if (!room && !(pair && pairsKept.has(pair))) { bump(group, slice, 'cap-skipped'); if (full()) break; continue; }
    }
    // rule 5 in test slices: one question per port per state, across records too (build.mjs refuses a second one). World-independent
    // states (a message or a line that recurs in several worlds) repeat over 1,000 test seeds; the repeat is dropped and counted here,
    // as interactive.mjs does itself. Paraphrase and pair records are clustered by state and exempt (as in build.mjs).
    if (TEST.has(slice) && r.meta?.variant !== 'paraphrase' && !pair) {
      const sh = stateHash(r.state), keys = Object.keys(rows).map(p => `${sh}|${p}`);
      if (keys.some(k => askedInSlice.has(k))) { bump(group, slice, `repeat-state-dropped:${Object.keys(rows).join('+')}`); continue; }
      for (const k of keys) askedInSlice.add(k);
    }
    // rule 7: a train-like or OOD state that carries a registered span is dropped and counted (re-rendering is the generator's)
    if (reg && (TRAIN_LIKE.has(slice) || OOD.has(slice))) {
      const m = r.meta?.masks ?? {};
      const hits = reg.scanState(r.state, { names: m.names ?? [], markers: m.markers ?? [], slice });
      if (hits.length) { bump(group, slice, `span-leak-dropped:${Object.keys(rows).join('+')}`); continue; }
    }
    if (quota) { for (const [p, n] of Object.entries(rows)) { const k = keyOf(p, fam); used[k] = (used[k] ?? 0) + n; } if (pair) pairsKept.add(pair); }
    bump(group, slice, 'yielded');
    yield r;
    // held-out family spans and OOD authored spans enter the registry once their record is built
    if (reg) {
      let n = 0;
      if (slice === 'test-ood' && typeof inner.registerHeldout === 'function') n += inner.registerHeldout(reg, [r]);
      if (OOD.has(slice) && typeof inner.registerOod === 'function') n += inner.registerOod(reg, [r], slice);
      if (n) bump(group, slice, 'registered-spans', n);
    }
    if (quota && full()) break;
  }
  if (quota) { const s = ((STATE.report[group] ??= {})[slice] ??= {}); s.quotaUsed = { ...used }; s.quota = { ...quota }; }
}
