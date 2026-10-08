// Generator for the kinetics bed group (JUDGE-PROGRAM.md §1.2 group K, X3, X8, X5, X1, X4, X7; §2.2, §3.4).
//   X3:kinetics   speech act of a lab-chat message or notebook addendum (train family; runbook is held out)
//   X8:kinetics   a table row's extracted rate against the sheet's unit statement (train family)
//   X5:kinetics   precondition (rate unit, SOP revision) against a document window  (held-out family: test-ood only)
//   X1:kinetics   injected instruction in a chat message or addendum                (held-out family: test-ood only)
//   X7:kinetics   item needed for a sub-question                                    (held-out family: test-ood only)
//   K1, K2, K3, X4:kinetics  wave-2 smoke sets (train and dev-select)
//
// Pure: the same (slice, seeds, opts, factory version, bed pin) gives the same records in the same order.
// Every choice is a salted hash of the record key: no Math.random, no clock, no network. Beds are
// imported through ctx.beds (the frozen copy); the port kit (judges/kinetics.mjs) and the tap
// (taps/kinetics.mjs) import no bed. This file never reads the held-out directory: held-out wordings and
// authored lines reach it only through `opts` (data), supplied by the assembly.
//
// opts (all optional, plain data):
//   ports        port ids to generate, default: the group's ports that apply to the slice
//   difficulties bed difficulties to draw seeds from, default [1, 2, 3, 4, 5] weighted toward 3-5
//   perWorld     { X3: n, X8: n, ... } rows per world per port (default per slice, below)
//   wordings     { X3: [{id, text}], ... } the held-out wordings of THIS slice (calib-ood, dev-ood, test-ood)
//   smokeEvery   a wave-2 smoke port uses one world in `smokeEvery` (default 12)
import { createHash } from 'node:crypto';
import { labelledQuestion, questionId } from '../lib/render.mjs';
import { optionOrder } from '../lib/balance.mjs';
import { worldHash, skeleton, skeletonBucket, spanHash } from '../lib/hash.mjs';
import { parsed, buildX3, buildX8, sheetParts, parseRate, X8_FIELD, RATE_FACTOR, UNIT_CODES, rowCells } from '../judges/kinetics.mjs';
import { alignMessages } from '../taps/kinetics.mjs';

export const group = 'kinetics';
export const ports = ['X3:kinetics', 'X8:kinetics', 'X5:kinetics', 'X1:kinetics', 'K1', 'K2', 'K3', 'X4:kinetics', 'X7:kinetics'];
export const GENERATOR_VERSION = 'kinetics@1';
const FAMILY = 'kinetics', BED = 'kinetics';

const sha = s => createHash('sha256').update(s).digest('hex');
const pick = (list, key) => list[parseInt(sha(key).slice(0, 8), 16) % list.length];
const unit = key => parseInt(sha(key).slice(0, 8), 16) / 0x100000000;
const fail = (code, message) => { const e = new Error(`${code}: ${message}`); e.code = code; return e; };

// seeds are spread over the bed's difficulties; d3-d5 carry the chat, the late facts and the traps
const DIFFICULTY_CYCLE = [1, 2, 3, 3, 4, 4, 5, 5];
export const difficultyOf = (seed, allowed = [1, 2, 3, 4, 5]) => {
  const cycle = DIFFICULTY_CYCLE.filter(d => allowed.includes(d));
  return cycle.length ? cycle[seed % cycle.length] : allowed[seed % allowed.length];
};

// Which ports a slice asks for by default (§10: wave 1 everywhere; wave-2 smoke in train and dev-select;
// the held-out families of X5, X1 and X7 only in test-ood, §3.4).
export const SLICE_PORTS = Object.freeze({
  train: ['X3', 'X8', 'K1', 'K2', 'K3', 'X4'], 'calib-in': ['X3', 'X8'], 'calib-ood': ['X3', 'X8'], 'dev-select': ['X3', 'X8', 'K1', 'K2', 'K3', 'X4'],
  'dev-ood': ['X3', 'X8'], 'test-in': ['X3', 'X8'], 'test-ood': ['X3', 'X8', 'X5', 'X1', 'X7'], 'real-reserve': [], 'e2e-reserve': [],
});
export const HELD_OUT_PORTS = Object.freeze(['X5', 'X1', 'X7']);
export const SMOKE_PORTS = Object.freeze(['K1', 'K2', 'K3', 'X4']);
// rows per world per port: the supply the assembly draws its allocation from (shortfalls are reported)
const PER_WORLD = Object.freeze({
  train: { X3: 2, X8: 1, K1: 4, K2: 2, K3: 1, X4: 2 }, 'calib-in': { X3: 2, X8: 2 }, 'calib-ood': { X3: 4, X8: 3 },
  'dev-select': { X3: 2, X8: 1, K1: 2, K2: 1, K3: 1, X4: 1 }, 'dev-ood': { X3: 4, X8: 3 }, 'test-in': { X3: 1, X8: 1 },
  'test-ood': { X3: 3, X8: 2, X5: 2, X1: 3, X7: 2 },
});

// ---- masks and skeleton buckets -------------------------------------------------------------
export function masksOf(world) {
  const m = world.meta, first = n => String(n).split(' ')[0];
  const people = [...m.techs, ...m.extras, m.pi];
  return {
    names: [...new Set([...people, ...people.map(first), m.enzyme.name, m.substrate, m.inhibitor, m.reader, ...Object.values(world.bench ?? {})])].filter(Boolean),
    markers: [...new Set([m.prefix, m.studyCode, m.sopCode, m.enzyme.code, 'lab-assistant-bot', 'qc-digest@core'])].filter(Boolean),
  };
}
// the slice family a skeleton belongs to: train-like slices and test-in read the 'train' bucket, each
// OOD slice its own (§3.1, §3.3)
const BUCKET_OF_SLICE = { train: 'train', 'calib-in': 'train', 'dev-select': 'train', 'test-in': 'train', 'calib-ood': 'calib-ood', 'dev-ood': 'dev-ood', 'test-ood': 'test-ood' };
export const bucketAllows = (slice, formHash) => skeletonBucket(formHash) === BUCKET_OF_SLICE[slice];

// ---- wording -------------------------------------------------------------------------------
function wordingFor(contract, slice, key, opts) {
  const port = contract.id, held = (contract.heldoutWordings?.[slice] ?? 0) > 0;
  if (held) {
    const list = opts.wordings?.[port];
    if (!Array.isArray(list) || !list.length) throw fail('HELDOUT_WORDINGS_MISSING', `${port} in ${slice} uses the slice's held-out wordings: pass opts.wordings.${port} = [{id, text}] (the assembly reads them from the held-out store; this generator does not)`);
    const w = pick(list, `${key}|wording`);
    return { wording: 'Q0', wordingText: w.text, wordingId: w.id };
  }
  const q = pick(['Q0', 'Q1', 'Q2', 'Q3'], `${key}|wording`);
  return { wording: q, wordingText: undefined, wordingId: q };
}

// ---- one record ----------------------------------------------------------------------------
function makeRecord({ contract, slice, opts, key, state, label, slots = {}, meta }) {
  const w = wordingFor(contract, slice, key, opts);
  const optionsList = Object.keys(contract.options ?? {});
  const q = labelledQuestion(contract, { label, wording: w.wording, wordingText: w.wordingText, slots, optionOrder: optionsList.length ? optionOrder(optionsList, key) : undefined });
  return { state, questions: { [questionId(contract.id)]: q }, meta: { family: FAMILY, bed: BED, labelSource: 'generator', needsWorldKnowledge: false, wordingId: w.wordingId, ...meta } };
}

// ---- X3 ------------------------------------------------------------------------------------
const X3_LABELS = ['changes', 'proposes', 'mentions', 'confirms', 'retracts'];
function x3Candidates({ task, world, tap, masks, slice }) {
  const out = [];
  for (const sp of tap.spans.values()) {
    if (!sp.label) continue;                                       // a redirect withdraws and re-assigns: no single speech act
    const slots = { message: sp.id };
    const state = buildX3(task, slots);
    if (state.fact_owner !== sp.ownerTruth) { out.push({ dropped: 'owner-unresolved', sp }); continue; }
    const form = skeleton(state.message, masks);
    if (!bucketAllows(slice, form)) { out.push({ dropped: 'bucket', sp }); continue; }
    out.push({ sp, slots, state, form, label: sp.label });
  }
  return out;
}
// choose `n` candidates for a world: labels in a rotation set by the seed, so the pool stays balanced
function rotate(cands, labels, n, key) {
  const by = Object.fromEntries(labels.map(l => [l, cands.filter(c => c.label === l).sort((a, b) => (sha(`${key}|${a.sp.id}`) < sha(`${key}|${b.sp.id}`) ? -1 : 1))]));
  const start = parseInt(sha(`${key}|start`).slice(0, 8), 16) % labels.length;
  const picked = [];
  for (let round = 0; picked.length < n && round < 40; round++) {
    let took = false;
    for (let i = 0; i < labels.length && picked.length < n; i++) {
      const l = labels[(start + i) % labels.length], c = by[l].shift();
      if (c) { picked.push(c); took = true; }
    }
    if (!took) break;
  }
  return picked;
}

// ---- X8 ------------------------------------------------------------------------------------
// wrong unit factors a careless extraction applies (the bed's near-miss for kinetics: RATE_FACTOR)
function wrongUnits(u) {
  const [conc, time] = u.split('/'), same = UNIT_CODES.filter(c => c !== u);
  const sameConc = same.filter(c => c.startsWith(`${conc}/`)), sameTime = same.filter(c => c.endsWith(`/${time}`));
  return { sameConc, sameTime, ignored: u === 'uM/s' ? [] : ['uM/s'], all: same };
}
const fmtValue = v => String(Number(v.toPrecision(4)));
function x8Candidates({ task, world, shown, masks, slice, seed }) {
  const out = [], p = parsed(task);
  const trapDocs = new Set(world.traps.filter(t => t.type === 'units').map(t => t.doc));
  for (const doc of world.docs) {
    if (!['mdtable', 'csv', 'semicolon'].includes(doc.format) || !['header', 'preamble'].includes(doc.unitPlacement) || doc.mixedRowUnits || trapDocs.has(doc.index)) continue;
    const sheet = p.sheets.find(s => s.author === doc.author && s.date === doc.date);
    if (!sheet) continue;
    const parts = sheetParts(sheet);
    for (const key of doc.series) for (const id of world.seriesByKey[key].wells) {
      const w = world.wellById[id];
      if (w.status === 'reread' || !shown[id] || w.typo) continue;
      const row = parts.rows.find(r => r.id === id);
      if (!row) continue;
      const printed = shown[id].rawRate, cell = rowCells(sheet.format, row.line);
      if (!Number.isFinite(printed) || parseRate(cell.rate) !== printed) continue;           // the kit's parse must agree with the bed's printed value
      out.push({ id, doc, sheet, printed, key: `${seed}|${id}` });
    }
  }
  return out;
}
function makeX8(c, { task, slice, contracts, opts, seed, difficulty, wh, masks, wantConsistent, flip = false }) {
  const trueUnit = c.doc.rateUnit, value = c.printed / RATE_FACTOR[trueUnit];
  let extracted, wrong = null;
  if (wantConsistent) extracted = fmtValue(value);
  else {
    const w = wrongUnits(trueUnit), r = unit(`${c.key}|wrong`);
    const pool = r < 0.35 && w.sameConc.length ? w.sameConc : r < 0.7 && w.sameTime.length ? w.sameTime : r < 0.85 && w.ignored.length ? w.ignored : w.all;
    wrong = pick(pool, `${c.key}|wrongunit`);
    extracted = fmtValue(c.printed / RATE_FACTOR[wrong]);
  }
  const slots = { sample: c.id, field: X8_FIELD, value: extracted };
  const state = buildX8(task, slots), form = skeleton(state.conventions, masks);
  if (!bucketAllows(slice, form)) return null;
  const key = `${slice}|X8|${seed}|${c.id}`;
  const rec = makeRecord({ contract: contracts.X8, slice, opts, key, state, label: wantConsistent ? 'consistent' : 'inconsistent', slots: { field: state.field, value: state.extracted_value },
    meta: { seed, difficulty, worldHash: wh, variant: 'clean', formId: form, surface: { source: 'bed', slice, lineHash: spanHash(state.conventions) },
      masks, kit: { port: 'X8', slots }, x8: { sheet: c.sheet.id, format: c.sheet.format, rateUnit: trueUnit, wrongUnit: wrong, printed: c.printed, difficulty } } });
  return rec;
}

// ---- generator -----------------------------------------------------------------------------
export async function* records(slice, seeds, opts = {}, ctx) {
  const def = ctx.slice, contracts = ctx.contracts;
  const K = await ctx.beds.import('beds/kinetics/index.mjs');
  const wanted = (opts.ports ?? SLICE_PORTS[slice] ?? []).map(p => String(p).split(':')[0]);
  const perWorld = { ...(PER_WORLD[slice] ?? {}), ...(opts.perWorld ?? {}) };
  for (const port of wanted) if (HELD_OUT_PORTS.includes(port) && slice !== 'test-ood') throw fail('HELDOUT_FAMILY', `${port}:kinetics is a held-out family (test-ood only, §3.4); it is not generated in ${slice}`);
  if (!wanted.length) return;
  const diffs = opts.difficulties ?? [1, 2, 3, 4, 5];
  const smokeEvery = opts.smokeEvery ?? 12;
  for (const seed of seeds) {
    const difficulty = difficultyOf(seed, diffs);
    const task = K.generate({ seed, split: def.bedSplit, difficulty });
    const { world, shown } = K._internals(task);
    const wh = worldHash(task), masks = masksOf(world);
    const base = { seed, difficulty, worldHash: wh };
    if (wanted.includes('X3') && perWorld.X3) {
      const tap = alignMessages({ task, world });
      const cands = x3Candidates({ task, world, tap, masks, slice }).filter(c => !c.dropped);
      for (const c of rotate(cands, X3_LABELS, perWorld.X3, `${slice}|X3|${seed}`)) {
        const key = `${slice}|X3|${seed}|${c.sp.id}`;
        yield makeRecord({ contract: contracts.X3, slice, opts, key, state: c.state, label: c.label,
          meta: { ...base, variant: 'clean', formId: c.form, surface: { source: 'bed', slice, lineHash: spanHash(c.state.message) }, masks,
            kit: { port: 'X3', slots: c.slots }, x3: { role: c.sp.role, factType: c.sp.factType, fact: c.sp.fact } } });
      }
    }
    if (wanted.includes('X8') && perWorld.X8) {
      const cands = x8Candidates({ task, world, shown, masks, slice, seed }).sort((a, b) => (sha(a.key) < sha(b.key) ? -1 : 1));
      let made = 0;
      for (const c of cands) {
        if (made >= perWorld.X8) break;
        const rec = makeX8(c, { task, slice, contracts, opts, seed, difficulty, wh, masks, wantConsistent: unit(`${slice}|${c.key}|label`) < 0.5 });
        if (rec) { made++; yield rec; }
      }
    }
  }
}
