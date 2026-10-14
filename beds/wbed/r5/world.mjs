// World model for W-bed R5 "legacy dump" (W-BED §3.5). An R5 task is an R4 task (the same group, children and
// intercompany layer: buildGroup at the same (seed, split, difficulty)) in which one receivables subsidiary delivers its
// invoice records as a legacy dump directory instead of its billing systems' invoice lists. The dump encodes the
// pack's R1 invoice rows (exactly R1's extract-stage invoice records: invoice, system, row, date_text, currency,
// amount_minor, status_text) in a format drawn per task from the catalogue, plus records the README excludes and a
// trailer with the record count and control totals. Every other child and every parent input stays byte-identical.
import { taskRng } from '../lib/prng.mjs';
import { isoDay, refKey as refKeyOf } from '../lib/domain.mjs';
import { normRow, trailerOf } from '../lib/legacy.mjs';
import { buildGroup } from '../r4/world.mjs';
import * as R1 from '../r1/index.mjs';
import { buildLedger } from '../r1/world.mjs';
import { formatOf } from './catalogue.mjs';
import { decodeStage, mistakesFor, rowsEqual, assertDecodes, verifyPredicate } from './decode.mjs';
import { hooks } from '../lib/faults.mjs';

// 1.0.1 (2026-10-14): no change of R5's own; groups with an R3 pack follow wbed-r3 1.1.0 through R4 1.0.1.
export const VERSION = '1.0.1';
export const MIN_D = 2, MAX_D = 5;

// Knobs per difficulty (W-BED §2.5 drift plus R5's own axis):
//   extras    records the trailer excludes (deleted, struck, void copies, re-sent, superseded versions)
//   vague     README vagueness: 0 every convention stated plainly; 1 running prose; 2 operators' notes
//   switches  schema switches in a JSON-lines dump
//   layouts   distinct header layouts across the months of a monthly-CSV dump
// and, through the catalogue rule, format difficulty: grade-2 wild formats from d3, novel formats at d5.
export const LEVELS = {
  2: { extras: 1, vague: 0, switches: 1, layouts: 2 },
  3: { extras: 2, vague: 1, switches: 1, layouts: 3 },
  4: { extras: 3, vague: 2, switches: 2, layouts: 4 },
  5: { extras: 4, vague: 2, switches: 2, layouts: 4 },
};
const EXTRA_KINDS = ['duplicate', 'before-image', 'phantom'];

/**
 * The dump layer over one R1 pack: the rows (R1's extract-stage invoices), the extra records, the trailer and the
 * encoded files, re-drawn (attempt 0, 1, ...) until every decode mistake that applies to `format` changes the rows.
 * `spec` salts the random stream; `subInfo` is {id, name, short}. Used by buildDump and, on bare R1 packs, by the tests.
 */
export function dumpLayer({ spec, L, kidTask, kidSpec, subInfo, format }) {
  const truth = R1.referenceTrace(kidTask);
  const rows = truth.extract.invoices.map(normRow);
  const lw = buildLedger(kidSpec.seed, kidSpec.split, kidSpec.difficulty);
  const dayOf = new Map(lw.invoices.map(i => [i.no, i.day]));
  const monthOf = r => isoDay(dayOf.get(r.invoice)).slice(0, 7);
  // Sources of the extra records: invoices that count (live, booked to a reconciled row), so keeping an extra changes the pack.
  const owned = new Set(truth.reconcile.customers.flatMap(c => c.source_rows));
  const counted = truth.normalise.invoices.filter(i => i.live && owned.has(i.row)).map(i => i.invoice);
  const byNo = new Map(rows.map(r => [r.invoice, r]));
  let last = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const r = taskRng('r5', 'dump', spec, attempt);
    const taken = new Set(rows.map(x => refKeyOf(x.invoice)));
    const kinds = r.shuffle(EXTRA_KINDS);
    const records = rows.map(row => ({ kind: 'row', row, month: monthOf(row) }));
    for (let i = 0; i < L.extras; i++) {
      const src = byNo.get(r.pick(counted));
      const kind = kinds[i % kinds.length];
      const row = { ...src };
      if (kind === 'before-image') {
        let a = Math.max(1, Math.round(src.amount_minor * r.float(0.8, 0.95)));
        if (a === src.amount_minor) a = src.amount_minor + 1;
        row.amount_minor = a;
      } else if (kind === 'phantom') {
        let no = null;
        for (let t = 0; t < 50 && !no; t++) {
          const cand = src.invoice.replace(/(\d+)(?!.*\d)/, d => String((Number(d) + r.int(1, 10 ** Math.min(d.length, 4) - 1)) % 10 ** d.length).padStart(d.length, '0'));
          if (!taken.has(refKeyOf(cand))) no = cand;
        }
        if (!no) continue;
        taken.add(refKeyOf(no));
        row.invoice = no;
      }
      records.splice(r.int(0, records.length), 0, { kind: 'extra', extraKind: kind, row, month: monthOf(src) });
    }
    const trailer = trailerOf(rows);
    const enc = format.encode({ records, trailer, r, L, sub: subInfo, vague: L.vague });
    const layer = { spec, attempt, L, format, rows, records, trailer, files: enc.files, params: enc.params };
    assertDecodes(layer);
    if (verifyPredicate(rows, trailer) !== null) throw new Error('wbed-r5: the truth fails its own trailer');
    // Decisiveness: every decode mistake that applies to this format must change the decoded rows.
    last = mistakesFor(format).find(m => rowsEqual(rows, decodeStage(layer, m).rows)) ?? null;
    if (!last) return layer;
  }
  throw new Error(`wbed-r5: no decisive dump for seed ${spec.seed} d${spec.difficulty} (${format.id}: ${last})`);
}

const cache = new Map();
/** The R5 world of (seed, split, difficulty): R4's world plus the dump layer over one unplanted receivables pack. */
export function buildDump(seed, split = 'dev', difficulty = 3) {
  const key = JSON.stringify([seed, split, difficulty]);
  if (cache.has(key)) return cache.get(key);
  if (!LEVELS[difficulty]) throw new Error(`wbed-r5: difficulty must be ${MIN_D}..${MAX_D}, got ${difficulty}`);
  if (split !== 'dev' && split !== 'test') throw new Error(`wbed-r5: split must be 'dev' or 'test', got ${split}`);
  const spec = { seed, split, difficulty };
  const r4 = buildGroup(seed, split, difficulty);
  const cands = r4.subs.filter(s => s.family === 'wbed-r1' && !s.planted);
  if (!cands.length) throw new Error(`wbed-r5: no unplanted receivables pack (seed ${seed} d${difficulty})`);
  const sub = taskRng('r5', 'sub', spec).pick(cands);
  const subInfo = { id: sub.id, name: sub.name, short: sub.short };
  const layer = dumpLayer({ spec, L: LEVELS[difficulty], kidTask: sub.task, kidSpec: sub.spec, subInfo, format: formatOf(spec) });
  const world = hooks.schemaDrift({ ...layer, r4, sub, subInfo }); // R8 f1 hook point (no-op in v1)
  cache.set(key, world);
  if (cache.size > 96) cache.delete(cache.keys().next().value);
  return world;
}
