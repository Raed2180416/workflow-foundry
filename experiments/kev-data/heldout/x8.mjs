// X8 items from an authored conventions line (JUDGE-PROGRAM.md §1.2 X8, §3.3 "X8 | authored
// conventions lines"). The authored part is the conventions sentence; the row, the field and the two
// extracted values are built here by code, so the label (consistent / inconsistent) is a property of
// the construction (generator truth), never of a model. Each conventions line yields a flip twin:
// the same row and line with the right value (consistent) and the near-miss value (inconsistent),
// so the line alone cannot predict the label.
//   date   convention V in dmy | mdy | ymd; field birth_date; value an ISO date; the near-miss swaps
//          day and month (day <= 12, month <= 12, day != month, so it is always a different date)
//   sign   convention V same | opposite; field balance (master sign: positive = the counterparty
//          owes us); the near-miss flips the sign
//   status convention V void | live; field migrate (yes | no); the near-miss inverts it
import { fillText, pick, pickIndex, slotsFor } from './fill.mjs';

const FIRST = ['Daniel', 'Amara', 'Lucas', 'Mei', 'Omar', 'Sofia', 'Jonas', 'Priya', 'Mateo', 'Hana', 'Tomas', 'Leila', 'Noah', 'Ines', 'Viktor', 'Aiko', 'Rafael', 'Greta', 'Samir', 'Nadia', 'Felix', 'Zoe', 'Ibrahim', 'Clara', 'Dmitri', 'Esme', 'Kofi', 'Anya', 'Hugo', 'Maya'];
const LAST = ['Okafor', 'Lindqvist', 'Marchetti', 'Tanaka', 'Haddad', 'Novak', 'Pereira', 'Brandt', 'Kowalski', 'Moreau', 'Adeyemi', 'Fischer', 'Castillo', 'Ivanova', 'Byrne', 'Sato', 'Rossi', 'Dubois', 'Nguyen', 'Larsen', 'Costa', 'Weber', 'Yilmaz', 'Hughes', 'Santos', 'Berg', 'Khan', 'Moretti', 'Olsen', 'Vega'];
const pad2 = n => String(n).padStart(2, '0');

function rowOf(system, parts, key) {
  const fmt = pickIndex(`${key}:fmt`, 4);
  const { id, name, cells } = parts;
  if (fmt === 0) return `${system} | ${id} | ${name} | ${cells.join(' | ')}`;
  if (fmt === 1) return `${system};${id};${name};${cells.join(';')}`;
  if (fmt === 2) return `${id}, ${name}, ${cells.join(', ')} [${system}]`;
  return `sys=${system} id=${id} name=${name.replace(', ', ' ')} ${cells.join(' ')}`;
}

export function x8Items(unit, { salt = '', cities = [] } = {}) {
  const key = `${unit.id}:${salt}`, { K, V } = unit.tagMap ?? {};
  if (!['date', 'sign', 'status'].includes(K)) throw new Error(`X8 unit ${unit.id}: unknown kind ${K}`);
  const slots = slotsFor(unit, { cities, salt }), S = slots.S;
  const conventions = fillText(unit.text, slots);
  const id = 1000 + pickIndex(`${key}:id`, 8999), name = `${pick(LAST, `${key}:l`)}, ${pick(FIRST, `${key}:f`)}`;
  const mk = (cells, field, good, bad, nearMiss) => ['consistent', 'inconsistent'].map(label => ({
    label, field, conventions, source_line: rowOf(S, { id, name, cells }, key), extracted_value: label === 'consistent' ? good : bad,
    near_miss: label === 'consistent' ? null : nearMiss }));
  if (K === 'date') {
    let d = 1 + pickIndex(`${key}:d`, 12), m = 1 + pickIndex(`${key}:m`, 12);
    if (d === m) m = (m % 12) + 1;
    const y = 1950 + pickIndex(`${key}:y`, 53), sep = pick(['/', '.', '-'], `${key}:sep`);
    const printed = V === 'dmy' ? `${pad2(d)}${sep}${pad2(m)}${sep}${y}` : V === 'mdy' ? `${pad2(m)}${sep}${pad2(d)}${sep}${y}` : `${y}${sep}${pad2(m)}${sep}${pad2(d)}`;
    const acct = `acct ${3000 + pickIndex(`${key}:a`, 6999)}`;
    return mk([printed, acct], 'birth_date', `${y}-${pad2(m)}-${pad2(d)}`, `${y}-${pad2(d)}-${pad2(m)}`, 'day-month-swap');
  }
  if (K === 'sign') {
    const mag = (50 + pickIndex(`${key}:b`, 99000)) / 100, neg = pickIndex(`${key}:neg`, 2) === 1;
    const fixed = x => x.toFixed(2), withComma = x => { const [i, f] = x.toFixed(2).split('.'); return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${f}`; };
    const printed = (neg ? '-' : '') + (pickIndex(`${key}:c`, 2) ? withComma(mag) : fixed(mag));
    const signed = (neg ? -mag : mag), master = V === 'same' ? signed : -signed;
    return mk([`balance ${printed}`, 'open'], 'balance', fixed(master), fixed(-master), 'sign-flipped');
  }
  const token = slots.token, good = V === 'void' ? 'no' : 'yes';
  return mk([`status ${token}`, `since ${2012 + pickIndex(`${key}:s`, 12)}`], 'migrate', good, good === 'yes' ? 'no' : 'yes', 'flag-flipped');
}
