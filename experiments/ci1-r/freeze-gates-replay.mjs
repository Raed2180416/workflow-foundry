#!/usr/bin/env node
// Retrospective replay ($0) of the two freeze-time gates the CI-1 review asks for (finding 2), on both waves, from committed files only:
//   1. ambiguity probe: two cheap builds per item before the freeze; an item is flagged for reading against its description when BOTH
//      fail in the same way (same first failing world, same reason signature). Replayed with the A0 builds k0 and k1 that the frozen
//      oracle of each wave scored (wave 1: oracle v1, runs/test-A0; wave 2: oracle v2, runs/w2-A0), i.e. what the bed author would have
//      seen had those two builds been run before the freeze (cost then: 2 one-shot builds per item, about $0.012).
//   2. oracle false-negative probe (fn-probe.mjs; research/ci1-20261021/r/fn-probe.json): items where a must-pass rewrite of the
//      reference fails the oracle frozen for that wave (v1 for wave 1, v2 for wave 2), excluding the strict-maybe settings rewrite.
// Truth: the items whose failing builds root-causing classed as an oracle defect or an ambiguous description (RESULT-CI1.md §5.2 and
// §9.2). Precision is reported too: a flagged item with a genuine shared builder error is a false alarm for "artefact", though still
// worth reading.
//   node experiments/ci1-r/freeze-gates-replay.mjs [--out research/ci1-20261021/r/freeze-gates-replay.json]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const R = p => JSON.parse(readFileSync(path.join(root, 'research/ci1-20261021', p), 'utf8'));
/** Root-caused artefact items (RESULT-CI1.md §5.2 wave 1, §9.2 wave 2): item -> class of the artefact. */
export const ARTEFACTS = Object.freeze({
  1: { 14177: 'oracle (defects 3, 5)', 16312: 'ambiguous description', 16364: 'oracle (defect 1)', 17545: 'ambiguous description', 17807: 'oracle (defect 5)', 17811: 'oracle (defect 4)', 17878: 'oracle (defect 2)' },
  2: { 17771: 'oracle (address case) + ambiguous (log name)', 19014: 'oracle (settings row) + ambiguous (clientId)', 18797: 'oracle (shared first name)', 20090: 'oracle (appointment ID)', 19187: 'ambiguous (Date column)', 17175: 'ambiguous (apostrophe)' },
});
/** The oracle defect classes root-causing found (RESULT-CI1.md §4.1, §9.2), the item where each bit, and the probe rewrite that
 *  exercises the class (null: description-specific, no generic rewrite). The probe flags a class when its rewrite fails the oracle
 *  frozen for that wave on at least one item, before any build. */
export const DEFECT_CLASSES = Object.freeze({
  1: [{ cls: 'greeting the addressee by name counted as a leak (v1 change 1)', item: '16364', rewrite: 'greet-by-name' },
    { cls: 'a categorical cell identified a row (v1 change 2)', item: '17878', rewrite: 'category-legend' },
    { cls: 'reference wording carried facts the description never asked for (v1 change 3)', item: '14177', rewrite: null },
    { cls: 'numeric d/m/y dates did not count (v1 change 4)', item: '17811', rewrite: 'dmy-dates' },
    { cls: 'a number before a prose comma was dropped (v1 change 5)', item: '17807', rewrite: 'number-comma' }],
  2: [{ cls: 'an address in a sheet cell differing only in case', item: '17771', rewrite: 'address-case-cells' },
    { cls: 'a settings-sheet value counted as a leak', item: '19014', rewrite: 'settings-mention' },
    { cls: 'a categorical name word identified another row', item: '18797', rewrite: 'category-legend' },
    { cls: 'an answer message required a value the description does not ask for', item: '20090', rewrite: null }],
});
/** A failure reason without values: recipients and channels kept, numbers, quoted values and row dumps removed. */
export const signature = reason => String(reason ?? '')
  .replace(/reference row \{.*?\}( \(first differing columns: ([^)]*)\))?/, (_, __, cols) => `reference row (${cols ?? ''})`)
  .replace(/"[^"]*"/g, '"…"').replace(/\[[^\]]*\]/g, '[…]').replace(/-?\d+(\.\d+)?/g, 'N').slice(0, 200);
const firstSig = r => (r.firstFailure ? `${r.firstFailure.world ?? ''}|${signature((r.firstFailure.reasons ?? [r.firstFailure.error])[0])}` : null);

export function ambiguityFlags(summary) {
  const by = new Map();
  for (const r of summary.records.filter(x => x.k < 2)) { if (!by.has(r.item)) by.set(r.item, []); by.get(r.item).push(r); }
  return [...by].filter(([, rs]) => rs.length === 2 && rs.every(r => !r.pass) && firstSig(rs[0]) === firstSig(rs[1])).map(([item, rs]) => ({ item, signature: firstSig(rs[0]) }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values: a } = parseArgs({ options: { out: { type: 'string' } } });
  const fn = R('r/fn-probe.json');
  const out = { replay: 'CI-1 freeze-gate replay ($0, committed files only)', waves: {} };
  for (const wave of [1, 2]) {
    const items = wave === 1 ? R('SPLIT.json').test : R('w2/SPLIT-W2.json').test;
    const amb = ambiguityFlags(R(`runs/${wave === 1 ? 'test-A0' : 'w2-A0'}/summary.json`));
    const oracle = wave === 1 ? 'v1' : 'v2';
    const fnItems = [...new Set(fn.failures.filter(f => f.wave === wave && f.oracle === oracle && f.rewrite !== 'settings-mention').map(f => f.item))];
    const fnSettings = [...new Set(fn.failures.filter(f => f.wave === wave && f.oracle === oracle && f.rewrite === 'settings-mention').map(f => f.item))];
    const truth = Object.keys(ARTEFACTS[wave]);
    const ambItems = amb.map(x => x.item), union = [...new Set([...ambItems, ...fnItems])];
    const score = flagged => ({ flagged: flagged.length, artefactsFlagged: truth.filter(t => flagged.includes(t)).sort(), artefactsMissed: truth.filter(t => !flagged.includes(t)).sort(),
      falseAlarms: flagged.filter(f => !truth.includes(f)).sort() });
    const classes = DEFECT_CLASSES[wave].map(c => { const hits = c.rewrite ? [...new Set(fn.failures.filter(f => f.wave === wave && f.oracle === oracle && f.rewrite === c.rewrite).map(f => f.item))].sort() : [];
      return { ...c, flaggedOnItems: hits, flagged: hits.length > 0, flaggedOnItsOwnItem: hits.includes(c.item) }; });
    out.waves[wave] = { items: items.length, artefactItems: truth.length, frozenOracle: oracle, oracleDefectClasses: classes,
      ambiguityProbe: { ...score(ambItems), signatures: amb }, fnProbe: score(fnItems), fnProbeSettingsMention: fnSettings.sort(), both: score(union) };
    const w = out.waves[wave];
    console.log(`wave ${wave} (${items.length} items, ${truth.length} artefact items, oracle ${oracle})`);
    for (const k of ['ambiguityProbe', 'fnProbe', 'both']) console.log(`  ${k.padEnd(15)} flags ${String(w[k].flagged).padStart(2)}: artefacts ${w[k].artefactsFlagged.length}/${truth.length} [${w[k].artefactsFlagged.join(', ')}], missed [${w[k].artefactsMissed.join(', ')}], other flagged [${w[k].falseAlarms.join(', ')}]`);
    console.log(`  settings-mention (read against the description): [${fnSettings.join(', ')}]`);
    for (const c of w.oracleDefectClasses) console.log(`  class ${c.flagged ? 'FLAGGED' : 'missed '} ${c.flaggedOnItsOwnItem ? '(on its item)' : '             '} ${c.cls} [${c.item}] via ${c.rewrite ?? '-'}: ${c.flaggedOnItems.length} items`);
  }
  if (a.out) writeFileSync(a.out, `${JSON.stringify(out, null, 1)}\n`);
}
