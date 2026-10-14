// M4b independent recount (PROOF-LEDGER K6): the committed out/M4b-enumeration.json against a second implementation that
// imports neither enumerate.mjs, card-types.mjs nor m4b.mjs. It reads card.json, the positive fixtures and the W-bed
// beds (generate, outputSchema) and carries its own hand-written precise table for P01, P12, P20 and P54 (from the
// skeletons: P01 lines 8-16, P12 5-10, P20 8-14, P54 7-14), its own list-site count, goal check and temporal pairs.
// Modelled on the M4 verifier's scratch recount. $0: no model, Jev or network call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const LIB = new URL('../', import.meta.url), ROOT = new URL('../../../', import.meta.url);
const ANY_D = { k: 'declared' }, ANY_U = { k: 'unchecked' }, U = bs => ({ k: 'union', bs });
const ADAPT = ['P01', 'P12', 'P20', 'P54'];
const PREC = {
  P01: { need: 0, out: ANY_D }, P54: { need: 0, out: ANY_U }, P12: { need: 1, out: ANY_U },
  P20: { need: 0, out: U([{ type: 'object', required: ['result', 'tries'], properties: { result: ANY_D, tries: { type: 'integer' } }, additionalProperties: false },
    { type: 'object', required: ['result', 'review'], properties: { result: { type: 'null' }, review: { type: 'object', required: ['problem', 'tries'], properties: { problem: {}, tries: { type: 'integer' } }, additionalProperties: false } }, additionalProperties: false }]) },
};
function loadCards() {
  const dir = new URL('cards/', LIB);
  const raw = readdirSync(dir).filter(d => /^P\d\d$/.test(d) && existsSync(new URL(`${d}/card.json`, dir))).map(d => JSON.parse(readFileSync(new URL(`${d}/card.json`, dir), 'utf8'))).filter(c => c.tier === 'S');
  return raw.map(c => {
    if (PREC[c.id]) return { id: c.id, ...PREC[c.id], temporal: c.temporal || [] };
    const names = [...new Set((c.fragment.in.match(/[A-Z][A-Z0-9_]+/g) || []).filter(n => c.slots.some(s => s.name === n)))];
    const o = c.fragment.out, keys = [...new Set([...(o.required || []), ...Object.keys(o.properties || {})])];
    return { id: c.id, need: names.filter(n => c.slots.find(s => s.name === n).type === 'path').length,
      out: { ...o, type: 'object', properties: Object.fromEntries(keys.map(k => [k, o.properties?.[k] ?? {}])), additionalProperties: false }, temporal: c.temporal || [] };
  }).sort((a, b) => (a.id < b.id ? -1 : 1));
}
const isAny = s => s === ANY_D || s === ANY_U;
function sites(s, mode) {
  if (s === ANY_D) return Infinity;
  if (s === ANY_U) return mode === 'checked' ? 0 : Infinity;
  if (s?.k === 'union') return Math.max(...s.bs.map(b => sites(b, mode)));
  if (!s || typeof s !== 'object') return Infinity;
  const t = s.type ? [].concat(s.type) : null;
  if (!t && !s.properties && !s.items && !s.enum && s.const === undefined && s.additionalProperties === undefined) return Infinity;
  let n = 0;
  if ((t || []).includes('array')) n += 1 + (s.items ? sites(s.items, mode) : Infinity);
  if ((t || []).includes('object') || s.properties) {
    for (const v of Object.values(s.properties || {})) n += sites(v, mode);
    if (s.additionalProperties !== false) n += (s.additionalProperties && typeof s.additionalProperties === 'object') ? (sites(s.additionalProperties, mode) ? Infinity : 0) : Infinity;
  }
  return n;
}
const tt = s => (s && s.type ? [].concat(s.type) : null);
const meet = (a, b) => !a || !b || a.some(x => b.includes(x) || (x === 'integer' && b.includes('number')) || (x === 'number' && b.includes('integer')));
function compat(s, goal) {
  if (isAny(s)) return true;
  if (s?.k === 'union') return s.bs.some(b => compat(b, goal));
  const keys = Object.keys(s.properties || {});
  for (const k of goal.required || []) if (!keys.includes(k) && s.additionalProperties === false) return false;
  if (goal.additionalProperties === false) for (const k of s.required || []) if (!(k in (goal.properties || {}))) return false;
  for (const k of keys) if (goal.properties?.[k] && !isAny(s.properties[k]) && !meet(tt(s.properties[k]), tt(goal.properties[k]))) return false;
  return meet(tt(s), tt(goal));
}
const carries = s => isAny(s) || (s?.k === 'union' && s.bs.some(carries)) || (!!s && typeof s === 'object' && Object.values(s.properties || {}).some(carries));
function counter(cards) {
  const pairs = [['P58', 'P60']];
  for (const c of cards) for (const r of c.temporal) { for (const b of r.before || []) pairs.push([c.id, b]); for (const a of r.after || []) pairs.push([a, c.id]); }
  const bad = seq => pairs.some(([a, b]) => { const la = seq.lastIndexOf(a), fb = seq.indexOf(b); return la >= 0 && fb >= 0 && fb < la; });
  return (input, goal, { mode = 'existential', alphabet = null, preserve = [], strict = false } = {}) => {
    const by = [0, 0, 0, 0];
    const rec = (seq, x) => {
      for (const c of cards) {
        if (alphabet && !alphabet.includes(c.id)) continue;
        const first = !seq.length;
        if (c.need > 0) {
          if (strict && (first ? !ADAPT.includes(c.id) : !carries(x))) continue;
          if ((first ? sites(input, mode) : sites(input, mode) + sites(x, mode)) < c.need) continue;
        }
        const s = [...seq, c.id];
        if (bad(s)) continue;
        const out = preserve.includes(c.id) ? (first ? input : x) : c.out;
        if (compat(out, goal)) by[s.length - 1]++;
        if (s.length < 4) rec(s, out);
      }
    };
    rec([], input);
    return by;
  };
}
const schemaOf = v => (Array.isArray(v) ? { type: 'array', items: v.length && v.every(x => typeof x === typeof v[0] && Array.isArray(x) === Array.isArray(v[0]) && x !== null) ? schemaOf(v[0]) : {} }
  : v && typeof v === 'object' ? { type: 'object', required: Object.keys(v), properties: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, schemaOf(x)])), additionalProperties: false }
  : typeof v === 'number' ? { type: Number.isInteger(v) ? 'integer' : 'number' } : typeof v === 'string' ? { type: 'string' } : typeof v === 'boolean' ? { type: 'boolean' } : {});
const open = s => (s && typeof s === 'object' ? (({ additionalProperties, ...r }) => ({ ...r, ...(r.properties ? { properties: Object.fromEntries(Object.entries(r.properties).map(([k, y]) => [k, open(y)])) } : {}), ...(r.items ? { items: open(r.items) } : {}) }))(s) : s);

test('M4b independent recount: 18 distinct problems x 7 settings agree with the committed result; hand-checked W-bed bounds', async t => {
  const url = new URL('research/jit-20261008/design/library/out/M4b-enumeration.json', ROOT);
  if (!existsSync(url)) return t.skip('no committed M4b result yet');
  const J = JSON.parse(readFileSync(url, 'utf8'));
  const cards = loadCards(), count = counter(cards), sum = a => a.reduce((x, y) => x + y, 0);
  const tasks = cards.map(c => { const fx = JSON.parse(readFileSync(new URL(`cards/${c.id}/fixtures/positive.json`, LIB), 'utf8')); return { id: `fixture:${c.id}`, input: schemaOf(fx.task.inputs), goal: open(schemaOf(fx.expect.output)) }; });
  for (const r of ['r1', 'r2', 'r3']) {
    const m = await import(new URL(`beds/wbed/${r}/index.mjs`, ROOT).href);
    const x = m.generate({ seed: 373, split: 'dev', difficulty: 3 });
    tasks.push({ id: x.id, input: schemaOf(x.inputs), goal: m.outputSchema });
  }
  const settings = {
    rule: [{}, row => row.total], poly: [{ alphabet: ADAPT }, row => row.bounds.polymorphicOnly.total], polyChecked: [{ alphabet: ADAPT, mode: 'checked' }, row => row.bounds.polymorphicOnlyChecked.total],
    checked: [{ mode: 'checked' }, row => row.diagnostics.checked.total], preserve: [{ preserve: ['P01', 'P54'] }, row => row.diagnostics.preserveP01P54.total],
    checkedPreserve: [{ mode: 'checked', preserve: ['P01', 'P54'] }, row => row.diagnostics.checkedPreserve.total], strict: [{ strict: true }, row => row.bounds.strictOthers.total],
  };
  assert.equal(tasks.length, 18);
  for (const x of tasks) {
    const row = J.rows.find(y => y.id === x.id);
    assert.ok(row, x.id);
    for (const [k, [o, pick]] of Object.entries(settings)) assert.equal(sum(count(x.input, x.goal, o)), pick(row), `${x.id} ${k}`);
  }
  const wb = tasks.at(-1);
  assert.deepEqual(count(wb.input, wb.goal, { alphabet: ADAPT }), [2, 9, 36, 144]);
  assert.deepEqual(count(wb.input, wb.goal, { alphabet: ADAPT, mode: 'checked' }), [2, 8, 28, 100]);
});
