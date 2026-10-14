// need-qa subtype (d) "convert": unit conversion with stated factors, in exact rational arithmetic.
// The relations form a tree of invented units rooted at the asked-for unit; each row states "1 <from> = <factor> <to>"
// and may be used in either direction, so some hops need the reciprocal. size scales the inventory rows and the number
// of (partly irrelevant) relations; steps scales the work:
//   steps 1: one item's quantity, one relation
//   steps 2: one item's quantity, two chained relations
//   steps 3: total of the items of one kind (units in a mix, chains up to 2 hops)
//   steps 4: ... that also have a status other than S
//   steps 5: ... and a quantity threshold, chains up to 3 hops, always 2 decimals
import { ROWS, uniqueNames, itemNames, frac, fmul, fadd, finv, fracOfDecimal, FZERO, FONE, roundHalfUpScaled, floorScaled, nearTie, scaledToText, composePrompt, roundingPhrase, FORM } from './core.mjs';

const UNIT_POOL = ['brell', 'quor', 'pim', 'dax', 'tolm', 'vess', 'krun', 'harn', 'miv', 'sool', 'prax', 'yenn', 'glim', 'torv'];
const N_UNITS = [4, 5, 6, 8, 10];
const FACTORS = ['2', '3', '4', '5', '6', '8', '10', '12', '0.5', '0.25', '2.5', '1.5', '0.75', '1.25', '3.2', '0.4', '0.8', '1.2', '7.5', '0.2'];
const KINDS = ['dye', 'ore', 'resin', 'seed'];
const STATUSES = ['ok', 'damaged', 'reserved'];

export function buildConvert(r, { size, steps }) {
  const n = ROWS[size - 1];
  const used = new Set();
  const [company] = uniqueNames(r, 1, used);
  const units = r.sample(UNIT_POOL, N_UNITS[size - 1]);
  const root = units[0];
  const maxDepth = steps >= 5 ? 3 : steps >= 2 ? 2 : 1;

  // edges[child] = { parent, factor (string), childPerParent: boolean }
  const depth = { [root]: 0 };
  const edges = {};
  const attach = (child, parent) => {
    depth[child] = depth[parent] + 1;
    edges[child] = { parent, factor: r.pick(FACTORS), childPerParent: r.chance(0.5) };
  };
  for (let i = 1; i <= maxDepth && i < units.length; i++) attach(units[i], units[i - 1]);    // a spine so the deepest hop count exists
  for (let i = maxDepth + 1; i < units.length; i++) attach(units[i], r.pick(units.slice(0, i).filter(u => depth[u] < maxDepth)));
  const relations = r.shuffle(units.slice(1).map(child => {
    const e = edges[child];
    return e.childPerParent ? { from: child, factor: Number(e.factor), to: e.parent } : { from: e.parent, factor: Number(e.factor), to: child };
  }));

  // multiplier turning one `unit` into the root; `flip` names a child whose edge is read the wrong way round (near-miss)
  const multiplier = (unit, flip = null) => {
    let m = FONE;
    for (let u = unit; u !== root; u = edges[u].parent) {
      const f = fracOfDecimal(edges[u].factor);
      const up = edges[u].childPerParent ? f : finv(f);
      m = fmul(m, u === flip ? finv(up) : up);
    }
    return m;
  };

  const kinds = KINDS.slice(0, size <= 2 ? 3 : 4);
  const names = itemNames(r, n);
  const statuses = size <= 2 ? STATUSES.slice(0, 2) : STATUSES;
  const eligible = units.filter(u => depth[u] <= maxDepth);
  // a majority kind and status keep the filtered selection large enough even in a six-row table
  const focus = r.pick(kinds);
  const bias = steps >= 3 ? 0.65 : 0;
  const rows = names.map(item => ({ item, kind: r.chance(bias) ? focus : r.pick(kinds), status: r.chance(bias) ? statuses[0] : r.pick(statuses), qty: r.int(2, 120), unit: r.pick(eligible) }));
  const total = (selection, { flip = null, dp, floor = false }) => {
    const f = selection.reduce((acc, row) => fadd(acc, fmul(frac(BigInt(row.qty)), multiplier(row.unit, flip))), FZERO);
    return { f, text: scaledToText((floor ? floorScaled : roundHalfUpScaled)(f, dp), dp) };
  };
  const dp = steps === 5 ? 2 : r.pick([0, 1, 2]);

  let question, selection, filters = [];
  if (steps <= 2) {
    const candidates = rows.filter(row => depth[row.unit] === steps);
    if (!candidates.length) return null;
    const row = r.pick(candidates);
    selection = [row];
    question = `How many ${root} is the quantity recorded for ${row.item}? Convert it using the relations. ${roundingPhrase(dp)}`;
  } else {
    const kind = focus;
    filters = [{ name: 'kind', test: x => x.kind === kind }];
    let clause = `of kind ${kind}`;
    if (steps >= 4) { const s = r.pick(statuses.slice(1)); filters.push({ name: 'status', test: x => x.status !== s }); clause += ` whose status is not ${s}`; }
    if (steps >= 5) {
      const pool = rows.filter(x => filters.every(f => f.test(x)));
      if (pool.length < 3) return null;
      const op = r.pick(['gt', 'ge']);
      const lows = pool.map(x => x.qty).sort((a, b) => a - b);
      const limit = lows[r.int(0, Math.floor(lows.length / 3))];   // planted: a row sits exactly on the boundary, most rows stay
      filters.push({ name: 'qty', test: x => (op === 'gt' ? x.qty > limit : x.qty >= limit), flipped: x => (op === 'gt' ? x.qty >= limit : x.qty > limit) });
      clause += ` and whose recorded quantity is ${op === 'gt' ? 'more than' : 'at least'} ${limit}`;
    }
    selection = rows.filter(x => filters.every(f => f.test(x)));
    if (selection.length < 3 || new Set(selection.map(x => x.unit)).size < 2) return null;
    question = `What is the total quantity of all items ${clause}, expressed in ${root}? ${roundingPhrase(dp)}`;
  }

  const exact = total(selection, { dp });
  if (nearTie(exact.f, dp)) return null;
  const truth = { kind: 'round', value: exact.text, dp };
  const used_edges = [...new Set(selection.flatMap(row => { const out = []; for (let u = row.unit; u !== root; u = edges[u].parent) out.push(u); return out; }))];

  const candidates = [];
  for (const flip of used_edges) candidates.push({ name: 'one-relation-read-backwards', text: total(selection, { dp, flip }).text });
  filters.forEach((flt, i) => {
    const variants = [[`ignored-${flt.name}-filter`, () => true]];
    if (flt.flipped) variants.unshift(['boundary-off-by-one', flt.flipped]);
    for (const [name, replacement] of variants) {
      const kept = rows.filter(x => filters.every((g, j) => (j === i ? replacement(x) : g.test(x))));
      if (kept.length) candidates.push({ name, text: total(kept, { dp }).text });
    }
  });
  candidates.push({ name: 'truncated-not-rounded', text: total(selection, { dp, floor: true }).text });
  const near = [];
  for (const c of candidates) if (c.text !== truth.value && !near.some(x => x.truth.value === c.text)) near.push({ name: c.name, truth: { kind: 'round', value: c.text, dp } });
  if (!near.length) return null;

  const intro = `Trade units of the ${company} market. inputs.json has "relations" (each row says that 1 <from> equals <factor> <to>; a relation can be used in either direction) and "inventory" (one row per item: item, kind, status, qty, unit).`;
  return {
    prompt: composePrompt(intro, question, FORM.number),
    inputs: { relations, inventory: rows },
    truth, near, alternatives: [],
    derived: true,
  };
}
