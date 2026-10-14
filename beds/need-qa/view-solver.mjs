// An independent solver that reads ONLY what a model would read (task.prompt and task.inputs) and answers by parsing the
// question template and computing with plain code. It shares no generator or truth code with the subtype builders (only the
// exact-fraction primitives from core.mjs), so agreement with the oracle shows that the rendered question determines the
// truth. It is also the "20-line script" reference: need-qa is a routing anchor meant to be solvable directly, so a script
// being able to solve it is expected here and is NOT evidence for anything else (README).
import { frac, fmul, fadd, finv, fracOfDecimal, FZERO, FONE, roundHalfUpScaled, scaledToText } from './core.mjs';

const fail = (what, text) => { throw new Error(`need-qa view solver: cannot parse ${what}: ${String(text).slice(0, 160)}`); };
const questionOf = prompt => (/^Question: (.*)$/m.exec(prompt) ?? fail('question', prompt))[1];

export function solveFromView(task) {
  const { prompt, inputs } = task;
  const q = questionOf(prompt);
  if (inputs.shipments) return solveLedger(q, inputs.shipments);
  if (inputs.parcels) return solveLookup(q, inputs);
  if (inputs.calendar) return solveCalendar(q, prompt, inputs);
  if (inputs.relations) return solveConvert(q, inputs);
  return fail('inputs', JSON.stringify(Object.keys(inputs)));
}

// ---- ledger ----
function solveLedger(q, rows) {
  const m = /^Considering only shipments where (.*), (what is the (total units|number of shipments|largest units figure of a single shipment|smallest units figure of a single shipment|total value|largest value of a single shipment)|which depot has the highest total value)/.exec(q) ?? fail('ledger question', q);
  const tests = m[1].split(' and ').map(clause => {
    let k;
    if ((k = /^the (depot|grade) is not (\S+)$/.exec(clause))) return row => row[k[1]] !== k[2];
    if ((k = /^the (depot|grade) is (\S+)$/.exec(clause))) return row => row[k[1]] === k[2];
    if ((k = /^units are more than (\d+)$/.exec(clause))) return row => row.units > Number(k[1]);
    if ((k = /^units are at least (\d+)$/.exec(clause))) return row => row.units >= Number(k[1]);
    if ((k = /^units are fewer than (\d+)$/.exec(clause))) return row => row.units < Number(k[1]);
    if ((k = /^units are at most (\d+)$/.exec(clause))) return row => row.units <= Number(k[1]);
    return fail('ledger filter', clause);
  });
  const hit = rows.filter(row => tests.every(t => t(row)));
  const val = row => row.units * row.price;
  const add = xs => xs.reduce((a, b) => a + b, 0);
  const what = m[3];
  if (what === 'total units') return { answer: add(hit.map(r => r.units)) };
  if (what === 'number of shipments') return { answer: hit.length };
  if (what === 'largest units figure of a single shipment') return { answer: Math.max(...hit.map(r => r.units)) };
  if (what === 'smallest units figure of a single shipment') return { answer: Math.min(...hit.map(r => r.units)) };
  if (what === 'total value') return { answer: add(hit.map(val)) };
  if (what === 'largest value of a single shipment') return { answer: Math.max(...hit.map(val)) };
  const totals = {};
  for (const row of hit) totals[row.depot] = (totals[row.depot] ?? 0) + val(row);
  return { answer: Object.entries(totals).sort((a, b) => b[1] - a[1])[0][0] };
}

// ---- lookup ----
function solveLookup(q, { parcels, ports }) {
  const portOf = parcel => ports.find(p => p.code === parcel.port_code);
  const column = { 'port name': 'port', 'region': 'region', 'fee per crate': 'fee', 'number of dock days': 'dock_days' };
  const charge = parcel => parcel.crates * portOf(parcel).fee;
  let m;
  if ((m = /^What is the (port name|region|fee per crate|number of dock days) of the port that parcel (\S+) is routed to\?$/.exec(q))) return { answer: portOf(parcels.find(p => p.id === m[2]))[column[m[1]]] };
  if ((m = /^What is the (port name|region|fee per crate|number of dock days) of the port used by the parcel of client (\S+) whose status is (\S+)\? Exactly one parcel matches\.$/.exec(q))) {
    const hit = parcels.filter(p => p.client === m[2] && p.status === m[3]);
    return { answer: portOf(hit[0])[column[m[1]]] };
  }
  if ((m = /^What is the shipping charge for parcel (\S+)\? /.exec(q))) return { answer: charge(parcels.find(p => p.id === m[1])) };
  if ((m = /^What is the total shipping charge of all parcels of client (\S+) whose status is not (\S+?)(?: and whose port is in the region (\S+))?\? /.exec(q))) {
    const hit = parcels.filter(p => p.client === m[1] && p.status !== m[2] && (m[3] === undefined || portOf(p).region === m[3]));
    return { answer: hit.reduce((s, p) => s + charge(p), 0) };
  }
  return fail('lookup question', q);
}

// ---- calendar: plain day-by-day stepping, no offset arithmetic ----
function solveCalendar(q, prompt, { calendar, festivals }) {
  const { months, weekdays } = calendar;
  const base = /Day 1 of the first month of year (\d+) is a (\S+)\./.exec(prompt) ?? fail('calendar anchor', prompt);
  const Y0 = Number(base[1]);
  const leap = /Every year divisible by 4 has one extra day/.test(prompt);
  const restMatch = /(\S+) and (\S+) are rest days/.exec(prompt);
  const rest = restMatch ? [restMatch[1], restMatch[2]] : [];
  const festivalsCount = /A festival day listed in "festivals" is never a business day/.test(prompt);
  const festSet = new Set(festivals.map(f => `${f.month}|${f.day}`));
  const len = (y, mi) => months[mi].days + (leap && mi === months.length - 1 && y % 4 === 0 ? 1 : 0);
  const parse = text => { const k = /^(\S+) (\d+), year (\d+)$/.exec(text) ?? fail('date', text); return { y: Number(k[3]), mi: months.findIndex(x => x.month === k[1]), d: Number(k[2]) }; };
  const show = ({ y, mi, d }) => `${months[mi].month} ${d}, year ${y}`;
  const tomorrow = ({ y, mi, d }) => (d < len(y, mi) ? { y, mi, d: d + 1 } : mi < months.length - 1 ? { y, mi: mi + 1, d: 1 } : { y: y + 1, mi: 0, d: 1 });
  const same = (a, b) => a.y === b.y && a.mi === b.mi && a.d === b.d;
  // weekday index of a date: walk from the anchor day
  const weekdayIndex = date => {
    let cur = { y: Y0, mi: 0, d: 1 }, wd = weekdays.indexOf(base[2]);
    while (!same(cur, date)) { cur = tomorrow(cur); wd = (wd + 1) % weekdays.length; }
    return wd;
  };
  const isBusiness = date => !rest.includes(weekdays[weekdayIndex(date)]) && !(festivalsCount && festSet.has(`${months[date.mi].month}|${date.d}`));
  let m;
  if ((m = /^What is the date (\d+) days after (.+?)\? The start date counts as day 0\.$/.exec(q))) {
    let cur = parse(m[2]);
    for (let i = 0; i < Number(m[1]); i++) cur = tomorrow(cur);
    return { answer: show(cur) };
  }
  if ((m = /^Which day of the week is the date (\d+) days after (.+?)\? /.exec(q))) {
    let cur = parse(m[2]);
    for (let i = 0; i < Number(m[1]); i++) cur = tomorrow(cur);
    return { answer: weekdays[weekdayIndex(cur)] };
  }
  if ((m = /^Starting on (.+?), what is the date of the (\d+)(?:st|nd|rd|th) business day after it\?/.exec(q))) {
    let cur = parse(m[1]), left = Number(m[2]);
    while (left > 0) { cur = tomorrow(cur); if (isBusiness(cur)) left--; }
    return { answer: show(cur) };
  }
  if ((m = /^How many business days are there from (.+?) to (.+?), counting both ends/.exec(q))) {
    let cur = parse(m[1]), count = 0;
    const end = parse(m[2]);
    for (;;) { if (isBusiness(cur)) count++; if (same(cur, end)) break; cur = tomorrow(cur); }
    return { answer: count };
  }
  return fail('calendar question', q);
}

// ---- convert: breadth-first search over the relation graph with exact fractions ----
function solveConvert(q, { relations, inventory }) {
  const edges = relations.flatMap(rel => { const f = fracOfDecimal(String(rel.factor)); return [{ a: rel.from, b: rel.to, mult: f }, { a: rel.to, b: rel.from, mult: finv(f) }]; });   // 1 a = f b, so q a = q*f b
  const toward = (unit, target) => {
    const seen = new Map([[unit, FONE]]);
    const queue = [unit];
    while (queue.length) {
      const u = queue.shift();
      if (u === target) return seen.get(u);
      for (const e of edges) if (e.a === u && !seen.has(e.b)) { seen.set(e.b, fmul(seen.get(u), e.mult)); queue.push(e.b); }
    }
    return fail('conversion path', `${unit} -> ${target}`);
  };
  const dpOf = text => (/Round half up to (a whole number|1 decimal place|2 decimal places)\./.exec(text) ?? fail('rounding', text))[1];
  const dp = { 'a whole number': 0, '1 decimal place': 1, '2 decimal places': 2 }[dpOf(q)];
  let m, target, rows;
  if ((m = /^How many (\S+) is the quantity recorded for (.+?)\? Convert it using the relations\./.exec(q))) { target = m[1]; rows = inventory.filter(r => r.item === m[2]); }
  else if ((m = /^What is the total quantity of all items of kind (\S+?)(?: whose status is not (\S+?))?(?: and whose recorded quantity is (more than|at least) (\d+))?, expressed in (\S+)\? /.exec(q))) {
    target = m[5];
    rows = inventory.filter(r => r.kind === m[1] && (m[2] === undefined || r.status !== m[2]) && (m[3] === undefined || (m[3] === 'more than' ? r.qty > Number(m[4]) : r.qty >= Number(m[4]))));
  } else return fail('convert question', q);
  const total = rows.reduce((acc, r) => fadd(acc, fmul(frac(BigInt(r.qty)), toward(r.unit, target))), FZERO);
  return { answer: Number(scaledToText(roundHalfUpScaled(total, dp), dp)) };
}
