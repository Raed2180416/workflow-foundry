// Records of the construction ports C1, C2, C7, C8 and C9 (JUDGE-PROGRAM.md §1.2 group C, §4.3 "Wave-2 ports get a smoke set
// only"; plan group "construction-crossfamily"). The family of every record is a composer (`composer`; C9: `bed-prompts`);
// labels are the composition (labelSource `composer`; C9: the beds' family ids, `generator`), never a model.
//
// Smoke sets only: train and dev-select (about 300 and 100 rows per port). These ports have no held-out wordings, families or
// templates in the contracts, so no OOD slice is generated (the plan names none); the C ports are not part of any gate yet.
// C9 draws from the seven train beds only: kinetics and runbook prompt heads are the held-out family of X5 bedtype and must not
// reach a training file through another port.
import { createHash } from 'node:crypto';
import { labelledQuestion, questionId } from '../lib/render.mjs';
import { optionOrder } from '../lib/balance.mjs';
import { skeleton, spanHash, worldHash } from '../lib/hash.mjs';
import { kits, pairState } from '../judges/construction.mjs';
import { composeObjective, REQUIREMENT_IDS } from './crossfamily-c1.mjs';
import { composeGrounding } from './crossfamily-c2.mjs';
import { composeCall } from './crossfamily-c7.mjs';
import { composeNotes } from './crossfamily-c8.mjs';
import { isHard, permPair, TRAIN_BEDS } from './crossfamily-bedtype.mjs';

export const C_PORTS = Object.freeze(['C1', 'C2', 'C7', 'C8', 'C9']);
export const C_SLICES = Object.freeze(['train', 'dev-select']);
export const C_ROWS = Object.freeze({ C1: { train: 300, 'dev-select': 108 }, C2: { train: 300, 'dev-select': 100 }, C7: { train: 300, 'dev-select': 100 }, C8: { train: 300, 'dev-select': 100 }, C9: { train: 300, 'dev-select': 100 } });

const sha = s => createHash('sha256').update(s).digest('hex');
const hnum = s => parseInt(sha(s).slice(0, 8), 16);
const pick = (list, key) => list[hnum(key) % list.length];
const fail = (code, message) => { const e = new Error(`${code}: ${message}`); e.code = code; return e; };
const NO_MASKS = Object.freeze({ names: [], markers: [] });

function question(contract, key, label, slots = {}) {
  const w = pick(['Q0', 'Q1', 'Q2', 'Q3'], `${key}|wording`), names = Object.keys(contract.options);
  return labelledQuestion(contract, { label, wording: w, slots, optionOrder: optionOrder(names, key) });
}
const base = (slice, seed, text, extra = {}) => ({
  family: 'composer', variant: 'clean', labelSource: 'composer', needsWorldKnowledge: false, seed, wordingId: 'mixed', formId: skeleton(text),
  surface: { source: 'authored-composer', slice, lineHash: spanHash(text) }, counterfactual: null, pairId: null, masks: NO_MASKS, ...extra,
});

// ---- C1 ------------------------------------------------------------------------------------------------------------------------
function* c1(slice, seeds, rows, ctx) {
  const contract = ctx.contracts.C1, n = Math.round(rows / 12), values = contract.slots.requirement.values, ids = contract.slots.requirement.ids;
  if (ids.join() !== REQUIREMENT_IDS.join()) throw fail('C1_IDS', 'the C1 contract and the composer disagree on the requirement ids');
  for (let i = 0; i < n; i++) {
    const key = `${slice}|C1|${i}`, c = composeObjective(key), req = new Set(c.required);
    const questions = {};
    ids.forEach((id, j) => { questions[questionId('C1', id)] = question(contract, `${key}|${id}`, req.has(id) ? 'yes' : 'no', { requirement: values[j] }); });
    yield { state: kits.C1.buildState({ objective: c.objective }), questions, meta: base(slice, seeds[i], c.objective, { composed: { required: c.required, mentions: c.mentions.map(m => ({ req: m.req, kind: m.kind })) } }) };
  }
}

// ---- C2 ------------------------------------------------------------------------------------------------------------------------
function* c2(slice, seeds, rows, ctx) {
  const contract = ctx.contracts.C2, seen = new Set();
  const plan = [...Array(Math.round(rows * 0.35)).fill('grounded'), ...Array(Math.round(rows * 0.25)).fill('impossible'), ...Array(Math.round(rows * 0.20)).fill('missing')];
  const order = plan.map((kind, i) => ({ kind, i, h: sha(`${slice}|C2|order|${i}`) })).sort((a, b) => (a.h < b.h ? -1 : 1));
  let s = 0;
  for (const { kind, i } of order) {
    let c = null, key = null;
    for (let a = 0; a < 20; a++) { key = `${slice}|C2|${kind}|${i}|${a}`; c = composeGrounding(key, kind); if (!seen.has(c.objective + c.capabilities.join())) break; }
    seen.add(c.objective + c.capabilities.join());
    const seed = seeds[s++], pairId = kind === 'missing' ? `c2:${key}` : null;
    const mk = (cc, role, variant) => ({
      state: kits.C2.buildState({ objective: cc.objective, capabilities: cc.capabilities }),
      questions: { [questionId('C2')]: question(contract, `${key}|${role}`, cc.yes ? 'yes' : 'no') },
      meta: base(slice, seed, cc.objective, { variant, pairId, composed: { needs: c.needs, impossible: c.impossible, missing: role === 'twin' ? null : c.missing, kind: c.kind, lookalike: c.lookalike }, ...(pairId ? { counterfactual: { swapped: true, from: role === 'twin' ? c.missing : 'listed', to: role === 'twin' ? 'listed' : c.missing, path: 'capabilities' } } : {}) }),
    });
    yield mk(c, 'main', pairId ? 'flip' : 'clean');
    if (c.twin) yield mk({ ...c, ...c.twin }, 'twin', 'flip');
  }
}

// ---- C7 ------------------------------------------------------------------------------------------------------------------------
function* c7(slice, seeds, rows, ctx) {
  const contract = ctx.contracts.C7, seen = new Set();
  for (let i = 0; i < rows; i++) {
    const label = i % 2 === 0 ? 'gaming' : 'legitimate';
    let call = null;
    for (let a = 0; a < 40; a++) { call = composeCall(`${slice}|C7|${i}|${a}`, label); if (!seen.has(JSON.stringify([call.tool, call.input]))) break; }
    seen.add(JSON.stringify([call.tool, call.input]));
    const state = kits.C7.buildState({ tool: call.tool, input: call.input });
    yield { state, questions: { [questionId('C7')]: question(contract, `${slice}|C7|${i}`, label) }, meta: base(slice, seeds[i], JSON.stringify(call.input)) };
  }
}

// ---- C8 ------------------------------------------------------------------------------------------------------------------------
function* c8(slice, seeds, rows, ctx) {
  const contract = ctx.contracts.C8, seen = new Set();
  for (let i = 0; i < rows; i++) {
    const label = i % 2 === 0 ? 'leaky' : 'general';
    let c = null;
    for (let a = 0; a < 20; a++) { c = composeNotes(`${slice}|C8|${i}|${a}`, label); if (!seen.has(c.notes)) break; }
    seen.add(c.notes);
    yield { state: kits.C8.buildState({ notes: c.notes }), questions: { [questionId('C8')]: question(contract, `${slice}|C8|${i}`, label) }, meta: base(slice, seeds[i], c.notes, { composed: { roles: c.lines.map(l => l.role) } }) };
  }
}

// ---- C9 ------------------------------------------------------------------------------------------------------------------------
async function* c9(slice, seeds, rows, ctx) {
  const contract = ctx.contracts.C9, split = ctx.slice.bedSplit, mods = {}, seen = new Set();
  for (const b of TRAIN_BEDS) mods[b] = await ctx.beds.import(`beds/${b}/index.mjs`);
  const difficulty = i => [1, 2, 3, 3, 4, 4, 5, 5][i % 8], wk = (b, d, s) => `${b}:${split}:d${d}:s${s}`;
  // a bed whose prompt never changes (incident) has one same-family state: a few records in train, none in dev-select
  const constant = new Set();
  for (const b of TRAIN_BEDS) if (new Set([401, 402, 403].map(sd => mods[b].generate({ seed: sd, split, difficulty: 3 }).prompt.slice(0, 1400))).size === 1) constant.add(b);
  const quota = { n: slice === 'train' ? 3 : 0 };
  let at = 0, diff = 0;
  for (let i = 0; i < rows; i++) {
    const same = i % 2 === 0, j = Math.floor(i / 2), label = same ? 'same' : 'different';
    // a same-family pair of a bed whose prompt never changes (incident) can only give a handful of distinct states: the next bed takes over
    for (let o = 0; o < (same ? TRAIN_BEDS.length : 1); o++) {
      const bedA = same ? TRAIN_BEDS[(j + o) % TRAIN_BEDS.length] : permPair(j).state, bedB = same ? bedA : permPair(j).partner;
      if (same && constant.has(bedA) && quota.n-- <= 0) continue;
      if (at + 2 > seeds.length) throw fail('SEEDS', `${slice}: C9 needs 2 seeds per record, ${seeds.length} given`);
      const sa = seeds[at++], sb = seeds[at++], da = difficulty(diff++), db = difficulty(diff++);
      const ta = mods[bedA].generate({ seed: sa, split, difficulty: da }), tb = mods[bedB].generate({ seed: sb, split, difficulty: db });
      const flip = hnum(`${slice}|C9|${i}|side`) % 2 === 0, pair = flip ? { a: ta, b: tb } : { a: tb, b: ta }, worlds = flip ? [wk(bedA, da, sa), wk(bedB, db, sb)] : [wk(bedB, db, sb), wk(bedA, da, sa)];
      let rec = null;
      for (let a = 0; a < 8 && !rec; a++) {
        const state = kits.C9.buildState(pair), q = { [questionId('C9')]: question(contract, `${slice}|C9|${i}|${o}|${a}`, label) }, k = JSON.stringify([state, q]);
        if (!seen.has(k)) { seen.add(k); rec = { state, questions: q }; }
      }
      if (!rec) continue;
      yield { ...rec, meta: { ...base(slice, sa, rec.state.task_a), family: 'bed-prompts', labelSource: 'generator', formId: skeleton(`${rec.state.task_a}\n${rec.state.task_b}`), worlds, c9: { bedA: flip ? bedA : bedB, bedB: flip ? bedB : bedA, hard: !same && isHard(bedA, bedB), worldHashes: [worldHash(pair.a), worldHash(pair.b)] } } };
      break;
    }
  }
}

export async function* cRecords(port, slice, seeds, opts, ctx) {
  if (!C_SLICES.includes(slice)) return;
  const rows = opts.rows?.[port]?.[slice] ?? (typeof opts.rows?.[port] === 'number' ? opts.rows[port] : C_ROWS[port][slice]);
  const need = port === 'C9' ? rows * 2 : port === 'C2' ? Math.round(rows * 0.8) : port === 'C1' ? Math.round(rows / 12) : rows;
  if (need > seeds.length) throw fail('SEEDS', `${slice}: ${port} needs about ${need} seeds, ${seeds.length} given`);
  const gen = { C1: c1, C2: c2, C7: c7, C8: c8, C9: c9 }[port];
  yield* gen(slice, seeds, rows, ctx);
}
export { pairState };
