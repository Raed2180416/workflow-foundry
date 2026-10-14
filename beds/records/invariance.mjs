// Output-invariance relations and the witness tag of the `records` bed (ATTACK-20261014 §3 M1; PROOF-LEDGER K3, K4).
// Host code beside the oracle: no system component sees it. Each relation reads the task's prompt and inputs and, where it
// says so, the output the solver gave on the original task (never the hidden world). Contract: beds/lib/metamorphic.mjs.
// Why each relation holds for a correct answer (spec sections of inputs.spec):
//   shuffle-rows    identity (s.3), conflicts (s.4: ordered by update date) and every other rule are per row or per
//                   group of rows; no rule reads the position of a line. The prompt's "ordered by row id" is rewritten.
//   duplicate-row   a copy of one line under a fresh row id (unused, above the smallest row id of the copied row's person,
//                   inserted at its place in row-id order): it links to exactly what the copied row links to and supplies
//                   the same values at the same update date, so the person set and every field are unchanged; the
//                   copied row's person gains the new row id in source_rows; a void row's copy is void.
//   drop-singleton  remove the only row of a person the original answer lists with one source row: no rule links a
//                   singleton's row to another row, so the answer loses exactly that person.
// Known blind spot (M1 kill mode, ATTACK §3): a convention misread (a date order, a status meaning) or a threshold
// under-merge is the same on every variant, so these relations cannot see it.
import { rngOf, permute, variantTask, compareKeyed, sameValue, sortedInts, shapeViolation, witnessDescriptor } from '../lib/metamorphic.mjs';

const FIELDS = ['given_name', 'family_name', 'birth_date', 'country', 'phone_e164', 'amount_usd'];
const rowIdOf = line => Number(line.match(/\d+/)?.[0]);
const exportLines = task => String(task.inputs?.export ?? '').split('\n').filter(l => l.trim() !== '');
const recordsOf = out => (out && typeof out === 'object' && Array.isArray(out.records) ? out.records.filter(r => r && typeof r === 'object') : null);

function withExport(task, lines, { count = null, unordered = false } = {}) {
  let prompt = task.prompt;
  if (count != null) prompt = prompt.replace(/holds \d+ rows/, `holds ${count} rows`);
  if (unordered) prompt = prompt.replace('ordered by row id', 'in no particular order');
  return variantTask(task, { prompt, inputs: { ...task.inputs, export: lines.join('\n') } });
}

// Records keyed by entity_id; source rows as a set; the six value fields exactly.
export function compareRecords(expected, got) {
  const E = recordsOf(expected), G = recordsOf(got);
  if (!E) return shapeViolation('original', 'no records list');
  if (!G) return shapeViolation('variant', 'no records list');
  return compareKeyed(E, G, 'entity_id', (e, g) => {
    const v = [];
    const es = sortedInts(e.source_rows), gs = sortedInts(g.source_rows);
    if (!sameValue(es, gs)) v.push({ level: 'source-rows', expected: es, got: gs });
    for (const f of FIELDS) if (!sameValue(e[f], g[f])) v.push({ level: 'fields', field: f, expected: e[f] ?? null, got: g[f] ?? null });
    return v;
  });
}

export const invariance = Object.freeze([
  {
    id: 'shuffle-rows', kind: 'invariant',
    text: 'Permute the export lines (seeded). No rule reads a line\'s position, so the master list is unchanged.',
    make(task, { seed }) {
      const lines = exportLines(task);
      if (lines.length < 2) return { skip: 'fewer than two export lines' };
      return { task: withExport(task, permute(lines, rngOf(seed, 'records', 'shuffle-rows')), { unordered: true }), info: { lines: lines.length } };
    },
    check: (orig, variant) => compareRecords(orig, variant),
  },
  {
    id: 'duplicate-row', kind: 'transform', needsOutput: true,
    text: 'Copy one export line under a fresh row id (seeded). The person set and every field are unchanged; the copied row\'s person gains the new id in source_rows.',
    make(task, { seed, output }) {
      const lines = exportLines(task), ids = lines.map(rowIdOf);
      if (!lines.length || ids.some(x => !Number.isInteger(x))) return { skip: 'export lines without a leading row id' };
      const r = rngOf(seed, 'records', 'duplicate-row'), i = r.int(0, lines.length - 1), rowId = ids[i];
      // The new id must stay above the smallest row id of the copied row's person (so entity_id cannot change) and keep
      // the id width of the export; it is placed where row-id order puts it.
      const rec = (recordsOf(output) ?? []).find(x => Array.isArray(x.source_rows) && x.source_rows.includes(rowId));
      const floor = Math.max(rowId, Number.isInteger(rec?.entity_id) ? rec.entity_id : rowId);
      const width = String(Math.max(...ids)).length, top = 10 ** width - 1, used = new Set(ids);
      const free = [];
      for (let x = floor + 1; x <= top && free.length < 5000; x++) if (!used.has(x)) free.push(x);
      if (!free.length) return { skip: 'no free row id of the export\'s width above the copied row' };
      const newId = free[r.int(0, free.length - 1)];
      const copy = lines[i].replace(String(rowId), String(newId));
      const at = ids.findIndex(x => x > newId);
      const out = [...lines];
      out.splice(at < 0 ? lines.length : at, 0, copy);
      return { task: withExport(task, out, { count: out.length }), info: { rowId, newId, entity: rec?.entity_id ?? null } };
    },
    check(orig, variant, info) {
      const E = recordsOf(orig);
      if (!E) return shapeViolation('original', 'no records list');
      const expected = { records: E.map(x => (Array.isArray(x.source_rows) && x.source_rows.includes(info.rowId) ? { ...x, source_rows: [...x.source_rows, info.newId] } : x)) };
      return compareRecords(expected, variant);
    },
  },
  {
    id: 'drop-singleton', kind: 'transform', needsOutput: true,
    text: 'Remove the only row of one person that the original answer lists with a single source row (seeded). The answer loses exactly that person.',
    make(task, { seed, output }) {
      const lines = exportLines(task), ids = new Set(lines.map(rowIdOf));
      const singles = (recordsOf(output) ?? []).filter(x => Array.isArray(x.source_rows) && x.source_rows.length === 1 && ids.has(x.source_rows[0]) && Number.isInteger(x.entity_id))
        .sort((a, b) => a.entity_id - b.entity_id);
      if (!singles.length) return { skip: 'the original answer has no single-row person' };
      const pick = singles[rngOf(seed, 'records', 'drop-singleton').int(0, singles.length - 1)], rowId = pick.source_rows[0];
      const out = lines.filter(l => rowIdOf(l) !== rowId);
      return { task: withExport(task, out, { count: out.length }), info: { rowId, entity: pick.entity_id } };
    },
    check(orig, variant, info) {
      const E = recordsOf(orig);
      if (!E) return shapeViolation('original', 'no records list');
      return compareRecords({ records: E.filter(x => x.entity_id !== info.entity) }, variant);
    },
  },
]);

// Witness (M1 b): none. The answer's only checkable structure is its partition (source rows exist in the export, no row in
// two people, entity_id = the smallest of them), which every misread convention or under-merge keeps.
export const witness = witnessDescriptor('none', [], 'structural partition only (source rows exist, disjoint, entity_id = min): not a semantic witness');
export const witnessOf = () => witness;
export const witnessCheck = () => [];
