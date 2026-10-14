// need-qa subtype (a) "ledger": an aggregate over a filtered generated table.
// size scales the number of rows (and depots); steps scales the number of filters and the derived value (units x price).
//   steps 1: 1 categorical filter                      measure: sum / count / max / min of units
//   steps 2: 2 categorical filters                     same measures
//   steps 3: 1 categorical + 1 numeric threshold       same measures
//   steps 4: 2 categorical + 1 threshold               value (units x price): sum or max, else a units measure
//   steps 5: 2 categorical + 1 threshold               total value, or "which depot has the highest total value"
import { ROWS, uniqueNames, itemNames, uniqueInts, sum, composePrompt, FORM } from './core.mjs';

const N_DEPOTS = [3, 3, 4, 5, 6];

const PHRASE = {
  depot: { eq: v => `the depot is ${v}`, ne: v => `the depot is not ${v}` },
  grade: { eq: v => `the grade is ${v}`, ne: v => `the grade is not ${v}` },
  units: { gt: v => `units are more than ${v}`, ge: v => `units are at least ${v}`, lt: v => `units are fewer than ${v}`, le: v => `units are at most ${v}` },
};
const test = (op, a, b) => (op === 'eq' ? a === b : op === 'ne' ? a !== b : op === 'gt' ? a > b : op === 'ge' ? a >= b : op === 'lt' ? a < b : a <= b);
const select = (rows, filters) => rows.filter(row => filters.every(f => test(f.op, row[f.col], f.val)));
const value = row => row.units * row.price;

const MEASURE_PHRASE = {
  sumUnits: 'total units',
  count: 'number of shipments',
  maxUnits: 'largest units figure of a single shipment',
  minUnits: 'smallest units figure of a single shipment',
  sumValue: "total value (a shipment's value is units × price)",
  maxValue: "largest value of a single shipment (a shipment's value is units × price)",
  argmaxValue: "which depot has the highest total value (a shipment's value is units × price)",
};

/** Evaluate a measure over selected rows. Returns { kind, value } or null when undefined (empty selection, tie). */
function measure(name, rows) {
  if (name === 'count') return rows.length ? { kind: 'int', value: String(rows.length) } : null;
  if (!rows.length) return null;
  if (name === 'sumUnits') return { kind: 'int', value: String(sum(rows.map(r => r.units))) };
  if (name === 'maxUnits') return { kind: 'int', value: String(Math.max(...rows.map(r => r.units))) };
  if (name === 'minUnits') return { kind: 'int', value: String(Math.min(...rows.map(r => r.units))) };
  if (name === 'sumValue') return { kind: 'int', value: String(sum(rows.map(value))) };
  if (name === 'maxValue') return { kind: 'int', value: String(Math.max(...rows.map(value))) };
  if (name === 'argmaxValue' || name === 'argmaxUnits') {
    const per = new Map();
    for (const row of rows) per.set(row.depot, (per.get(row.depot) ?? 0) + (name === 'argmaxValue' ? value(row) : row.units));
    const ranked = [...per.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length < 2 || ranked[0][1] === ranked[1][1]) return null;   // a tie has no unique answer
    return { kind: 'text', value: ranked[0][0] };
  }
  throw new Error(`need-qa ledger: unknown measure ${name}`);
}

function plan(r, steps, rows, depots, grades) {
  const categorical = () => {
    const col = r.pick(['depot', 'grade']);
    return col === 'depot' ? { col, op: 'eq', val: r.pick(depots) } : { col, op: 'eq', val: r.pick(grades) };
  };
  const cat1 = categorical();
  let filters, measureName;
  if (steps === 1) { filters = [cat1]; measureName = r.pick(['sumUnits', 'count', 'maxUnits', 'minUnits']); }
  else if (steps === 2) {
    const other = cat1.col === 'depot' ? { col: 'grade', op: r.pick(['eq', 'ne']), val: r.pick(grades) } : { col: 'depot', op: r.pick(['eq', 'ne']), val: r.pick(depots) };
    filters = [cat1, other]; measureName = r.pick(['sumUnits', 'count', 'maxUnits', 'minUnits']);
  } else {
    const cats = [{ col: 'depot', op: r.pick(['eq', 'eq', 'ne']), val: r.pick(depots) }];
    if (steps >= 4) cats.push({ col: 'grade', op: 'ne', val: r.pick(grades) });
    else if (r.chance(0.5)) cats.splice(0, 1, cat1);
    const pool = select(rows, cats);
    if (pool.length < 3) return null;
    const threshold = { col: 'units', op: r.pick(['gt', 'ge', 'lt', 'le']), val: r.pick(pool).units };   // planted: some row sits exactly on the boundary
    filters = [...cats, threshold];
    if (steps === 3) measureName = r.pick(['sumUnits', 'count', 'maxUnits', 'minUnits']);
    else if (steps === 4) measureName = r.pick(['sumValue', 'sumValue', 'maxValue', 'sumUnits']);
    else if (r.chance(0.4)) { filters = [cats[1], threshold]; measureName = 'argmaxValue'; }
    else measureName = 'sumValue';
  }
  return { filters, measureName };
}

function neighbours(filters, measureName) {
  const out = [];
  filters.forEach((f, i) => {
    if (f.col === 'units') out.push({ name: 'boundary-off-by-one', filters: filters.map((g, j) => (j === i ? { ...g, op: { gt: 'ge', ge: 'gt', lt: 'le', le: 'lt' }[g.op] } : g)), measureName });
  });
  for (let i = filters.length - 1; i >= 0; i--) out.push({ name: `dropped-${filters[i].col}-filter`, filters: filters.filter((_, j) => j !== i), measureName });
  filters.forEach((f, i) => { if (f.op === 'ne') out.push({ name: `read-not-as-is-${f.col}`, filters: filters.map((g, j) => (j === i ? { ...g, op: 'eq' } : g)), measureName }); });
  const swap = { sumValue: 'sumUnits', maxValue: 'maxUnits', argmaxValue: 'argmaxUnits' }[measureName];
  if (swap) out.push({ name: 'forgot-price', filters, measureName: swap });
  return out;
}

export function buildLedger(r, { size, steps }) {
  const n = ROWS[size - 1];
  const used = new Set();
  const [company] = uniqueNames(r, 1, used);
  const depots = uniqueNames(r, N_DEPOTS[size - 1], used);
  const grades = size <= 3 ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'D'];
  const items = itemNames(r, Math.min(6, n));
  const ids = uniqueInts(r, n, 1000, 9999);
  const rows = ids.map(id => ({ id: `S-${id}`, depot: r.pick(depots), grade: r.pick(grades), item: r.pick(items), units: r.int(10, 400), price: r.int(3, 60) }));

  const p = plan(r, steps, rows, depots, grades);
  if (!p) return null;
  const chosen = select(rows, p.filters);
  const truth = measure(p.measureName, chosen);
  if (!truth || chosen.length < (steps >= 4 ? 3 : 2)) return null;

  const near = [];
  for (const v of neighbours(p.filters, p.measureName)) {
    const t = measure(v.measureName, select(rows, v.filters));
    if (t && t.value !== truth.value && !near.some(x => x.truth.value === t.value)) near.push({ name: v.name, truth: t });
  }
  if (!near.length) return null;

  const alternatives = truth.kind === 'text' ? depots.filter(d => d !== truth.value).map(d => ({ kind: 'text', value: d })) : [];
  const argmax = p.measureName === 'argmaxValue';
  const clause = p.filters.map(f => PHRASE[f.col][f.op](f.val)).join(' and ');
  const question = `Considering only shipments where ${clause}, ${argmax ? `${MEASURE_PHRASE.argmaxValue}?` : `what is the ${MEASURE_PHRASE[p.measureName]}?`}`;
  const intro = `Shipment ledger for the ${company} freight depots. inputs.json has one table, "shipments", with one row per shipment: id, depot, grade, item, units (units shipped) and price (credits per unit).`;
  return {
    prompt: composePrompt(intro, question, argmax ? FORM.text : FORM.number),
    inputs: { shipments: rows },
    truth, near, alternatives,
    derived: !argmax,
  };
}
