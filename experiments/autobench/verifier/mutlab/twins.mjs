// Move 4 (ATTACK §5 "metamorphic world twins", §6): edit the INITIAL world, keep the trajectory. Pure; no I/O, no model.
//
// The relation a twin tests is metamorphic, not graded: the correct diff must be invariant modulo the edit. Each twin
// says what a correct verifier should conclude about the UNCHANGED trajectory on the twin world:
//   permute            every id-record collection reversed                    -> same verdict (stability)
//   decoy_untouched    a copy (fresh id) of a record in a collection the run   -> same verdict: whatever rule left the
//                      wrote to, but which the run never referenced              source alone leaves its copy alone
//   rename_untouched   a neutral suffix on the display name of such a record    -> same verdict
//   decoy_touched      a copy (fresh id) of a record the run acted on            -> the run is now INCOMPLETE under any
//                                                                                   attribute-based rule (closure recall)
// The official rubric still grades each twin (its assertions were fixed when the task was built, so it cannot see the
// copy); a twin whose official grade changes is reported as inconsistent and left out of the twin rates. The
// decoy_touched label is an inference (a rule over identity, order or counts would break it) and is reported as such.
import { createHash } from 'node:crypto';
import { flat, isWrite } from './mutate.mjs';

export const TWINS_VERSION = 'mutlab-twins-v1';
export const TWINS = Object.freeze({
  permute: { cls: 'stability', expect: 'same' },
  decoy_untouched: { cls: 'closure-precision', expect: 'same' },
  rename_untouched: { cls: 'stability', expect: 'same' },
  decoy_touched: { cls: 'closure-recall', expect: 'incomplete' },
});
const NAME_KEYS = ['name', 'title', 'item_name', 'accountName', 'Name', 'company', 'full_name', 'display_name', 'first_name', 'subject', 'summary'];

const clone = x => JSON.parse(JSON.stringify(x));
const rank = (seed, s) => createHash('sha256').update(`${seed}\n${s}`).digest('hex');
const isIdRecords = v => Array.isArray(v) && v.length > 0 && v.every(x => x && typeof x === 'object' && !Array.isArray(x) && 'id' in x)
  && new Set(v.map(x => JSON.stringify(x.id))).size === v.length;

/** Id-record collections of a world: [{app, coll, path, records}] (one level of nesting, like the lab differ). */
export function collectionsOf(world) {
  const out = [];
  for (const [app, colls] of Object.entries(world ?? {})) {
    if (app === 'meta' || !colls || typeof colls !== 'object' || Array.isArray(colls)) continue;
    for (const [coll, v] of Object.entries(colls)) {
      if (isIdRecords(v)) out.push({ app, coll, path: [app, coll], records: v });
      else if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [k, x] of Object.entries(v)) if (isIdRecords(x)) out.push({ app, coll: `${coll}.${k}`, path: [app, coll, k], records: x });
      }
    }
  }
  return out;
}
const at = (w, path) => path.reduce((o, k) => o?.[k], w);

/** Ids an id-record is referenced by in the run's WRITE calls (URL or body). Short numeric ids are ignored. */
export function touchedIds(world, steps) {
  const text = flat(steps).filter(x => isWrite(x.call)).map(x => (typeof x.call.arguments === 'string' ? x.call.arguments : JSON.stringify(x.call.arguments))).join('\n');
  const out = new Set();
  for (const c of collectionsOf(world)) for (const r of c.records) {
    const id = String(r.id);
    if (id.length >= 4 && !/^\d{1,3}$/.test(id) && text.includes(id)) out.add(`${c.path.join('.')}#${id}`);
  }
  return out;
}

function freshId(id, used) {
  let k = 2;
  const base = String(id);
  let c = /\d+$/.test(base) ? base.replace(/\d+$/, m => String(Number(m) + 7000 + k)) : `${base}_t${k}`;
  while (used.has(c)) { k++; c = /\d+$/.test(base) ? base.replace(/\d+$/, m => String(Number(m) + 7000 + k)) : `${base}_t${k}`; }
  return typeof id === 'number' ? Number(c) || c : c;
}

/** All twins of one seed: [{twin, cls, expect, note, world0}] (world0 is a new object; the input is unchanged). */
export function twinsOf(world0, steps, { seed }) {
  const out = [];
  const colls = collectionsOf(world0);
  const touched = touchedIds(world0, steps);
  // permute
  if (colls.some(c => c.records.length > 1)) {
    const w = clone(world0);
    for (const c of collectionsOf(w)) at(w, c.path.slice(0, -1))[c.path.at(-1)] = [...c.records].reverse();
    out.push({ twin: 'permute', ...TWINS.permute, note: `${colls.length} collections reversed`, world0: w });
  }
  // collections the run wrote to, with touched and untouched members
  const wrote = colls.map(c => ({ ...c, t: c.records.filter(r => touched.has(`${c.path.join('.')}#${r.id}`)), u: c.records.filter(r => !touched.has(`${c.path.join('.')}#${r.id}`)) }))
    .filter(c => c.t.length);
  const pick = (list, key) => [...list].sort((a, b) => (rank(seed, key(a)) < rank(seed, key(b)) ? -1 : 1))[0];
  const withU = wrote.filter(c => c.u.length);
  if (withU.length) {
    const c = pick(withU, x => x.path.join('.'));
    const src = pick(c.u, r => String(r.id));
    const w = clone(world0);
    const arr = at(w, c.path);
    const copy = clone(src);
    copy.id = freshId(src.id, new Set(arr.map(r => String(r.id))));
    arr.push(copy);
    out.push({ twin: 'decoy_untouched', ...TWINS.decoy_untouched, note: `copy of an untouched ${c.app} record`, world0: w });
    const nameKey = NAME_KEYS.find(k => typeof src[k] === 'string' && src[k].trim());
    if (nameKey) {
      const w2 = clone(world0);
      const r2 = at(w2, c.path).find(r => JSON.stringify(r.id) === JSON.stringify(src.id));
      r2[nameKey] = `${r2[nameKey]} II`;
      out.push({ twin: 'rename_untouched', ...TWINS.rename_untouched, note: `display name of an untouched ${c.app} record`, world0: w2 });
    }
  }
  if (wrote.length) {
    const c = pick(wrote, x => `t|${x.path.join('.')}`);
    const src = pick(c.t, r => `t|${r.id}`);
    const w = clone(world0);
    const arr = at(w, c.path);
    const copy = clone(src);
    copy.id = freshId(src.id, new Set(arr.map(r => String(r.id))));
    arr.push(copy);
    out.push({ twin: 'decoy_touched', ...TWINS.decoy_touched, note: `copy of a ${c.app} record the run acted on`, world0: w });
  }
  return out;
}
