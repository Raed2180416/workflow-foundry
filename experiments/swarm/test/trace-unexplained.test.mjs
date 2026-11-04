// Two-mistake tracer for wrong cells no single bed mistake reproduces (experiments/swarm/trace-unexplained.mjs, review minor 5).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as bed from '../../../beds/wbed/r6/index.mjs';
import { voidKeys } from '../../../beds/wbed/r6/pipeline.mjs';
import { PROPS } from '../../../beds/wbed/r6/vocab.mjs';
import { truthOf, cellTraps, _resolveAlt as resolveAlt } from '../rootcause.mjs';
import { traceCell } from '../trace-unexplained.mjs';
import { ARMS } from '../analyze-r1.mjs';

test('a row whose winner was never extracted is traced to winner-missed; a row two mistakes produce is traced to the pair', () => {
  let missed = null, pair = null;
  for (const seed of [301, 302, 303, 304]) {
    const task = bed.generate({ seed, split: 'dev', difficulty: 5 }), t = truthOf(task);
    for (const [k, truth] of t.cells) {
      const [code, p] = k.split('|'), e = t.entByCode.get(code);
      if (!missed) {
        const c = resolveAlt(t.world, t.vis.filter(d => d.id !== truth.source), t.voids, e.id, p, {});
        const row = c && { entity: code, property: p, value: c.canon / 10 ** PROPS[p].dec, source_doc_id: c.source };
        if (row && (c.canon !== truth.canon && c.source !== truth.source) && !cellTraps(t, code, p, row).exact.length) missed = { task, code, p, row };
      }
      if (!pair) for (const [v, o] of [[{ supersededKept: true }, { recencyOnly: true }], [{ retractedKept: true }, { recencyOnly: true }], [{ supersededKept: true }, { nonstdCounted: true }], [{ retractedKept: true }, { quotesCounted: true }], [{}, { recencyOnly: true, noUnitConversion: true }], [{}, { quotesCounted: true, recencyOnly: true }]]) {
        const voids = Object.keys(v).length ? voidKeys(t.world, t.vis, v) : t.voids;
        const c = resolveAlt(t.world, t.vis, voids, e.id, p, o);
        const row = c && { entity: code, property: p, value: c.canon / 10 ** PROPS[p].dec, source_doc_id: c.source };
        if (row && (c.canon !== truth.canon || c.source !== truth.source) && !cellTraps(t, code, p, row).exact.length) { pair = { task, code, p, row }; break; }
      }
    }
    if (missed && pair) break;
  }
  assert.ok(missed, 'a winner-missed case exists on these seeds');
  assert.ok(traceCell(missed.task, missed.code, missed.p, missed.row).exact.some(h => h.length === 1 && h[0] === 'winner-missed'));
  assert.ok(pair, 'a two-mistake case exists on these seeds');
  const tr = traceCell(pair.task, pair.code, pair.p, pair.row);
  assert.ok(tr.exact.length > 0 && tr.exact.every(h => h.length === 2), JSON.stringify(tr));
  // the W arm's code facts are only offered for W
  assert.ok(!traceCell(missed.task, missed.code, missed.p, missed.row, { arm: ARMS.A }).exact.flat().some(n => n.startsWith('W:')));
});
