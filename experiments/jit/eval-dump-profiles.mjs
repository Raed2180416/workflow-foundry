// eval-dump-profiles.mjs: does an input profile let a compiled dump decoder refuse every dump format it was not compiled
// for and serve the dumps of its own format? (W-BED-R5-NOTES item 12; FLOW-V3-SLICE2.md §12.) $0: no model call; reads only
// beds/wbed/r5 (dev split), never beds/sealed/. Development evidence: the presets were chosen on these seeds.
//
// A decoder callee for format F is called with the dump's file map: {prompt: a fixed template, inputs: {files}}. Per format,
// its profile is learned on the first `--learn` dumps at the learning difficulty (d3, as a stream compiles from its d3
// tasks; d5 for the formats that occur only at d5), then checked on
//   held:   the other dumps of F at that difficulty (a refusal is a false refusal: missed reuse),
//   drift:  the dumps of F at d4 (README vagueness and record mix move; a refusal is drift detection, not an error),
//   others: every dump of every other format, the d5 novel formats included (a pass is wrong reuse).
//
//   node experiments/jit/eval-dump-profiles.mjs [--seeds 301-390] [--novel 301-330] [--learn 6] [--json out.json]
import { writeFileSync } from 'node:fs';
import { buildDump } from '../../beds/wbed/r5/world.mjs';
import { learnProfile, checkProfile, PARAMS, PARAMS_V2, PARAMS_V3, TOLERANT_CHECK, STRUCTURE_CHECK, SIZE_FEATURES } from './profile.mjs';

export const PROMPT = 'Decode the legacy dump in inputs.files into invoice rows and its trailer, as the README there describes.';
export const CONFIGS = Object.freeze([
  { id: 'v1-size', params: PARAMS, check: { ignore: SIZE_FEATURES } },
  { id: 'v2-tolerant', params: PARAMS_V2, check: TOLERANT_CHECK },
  { id: 'v3-tolerant', params: PARAMS_V3, check: TOLERANT_CHECK },
  { id: 'v3-structure', params: PARAMS_V3, check: STRUCTURE_CHECK },
]);
const range = s => { const [a, b] = String(s).split('-').map(Number); return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i); };

// The callee task of one dump: its file map (names relative to the dump directory).
export function dumpTask(seed, split, d) {
  const w = buildDump(seed, split, d);
  return { format: w.format.id, tier: w.format.tier, seed, d, task: { prompt: PROMPT, inputs: { files: { ...w.files } } } };
}

export function evaluate(dumps, { learn = 6, configs = CONFIGS } = {}) {
  const rows = [], totals = Object.fromEntries(configs.map(c => [c.id, { falseRefusals: 0, held: 0, driftRefused: 0, drift: 0, wrongPasses: 0, others: 0 }]));
  for (const format of [...new Set(dumps.map(x => x.format))].sort()) {
    const at = d => dumps.filter(x => x.format === format && x.d === d);
    const pool = at(3).length >= learn + 2 ? at(3) : at(5).length >= learn + 2 ? at(5) : null;
    if (!pool) { rows.push({ format, n: dumps.filter(x => x.format === format).length, scored: false }); continue; }
    const train = pool.slice(0, learn), held = pool.slice(learn), drift = pool[0].d === 3 ? at(4) : [], others = dumps.filter(x => x.format !== format);
    const row = { format, scored: true, learnD: pool[0].d, learn, held: held.length, drift: drift.length, others: others.length, configs: {} };
    for (const c of configs) {
      const p = learnProfile(train.map(x => x.task), c.params), novel = x => checkProfile(p, x.task, c.check).novel;
      const fr = held.filter(novel), dr = drift.filter(novel), wp = others.filter(x => !novel(x));
      row.configs[c.id] = { falseRefusals: fr.length, driftRefused: dr.length, wrongPasses: wp.length, wrongPassFormats: [...new Set(wp.map(x => x.format))].sort() };
      const t = totals[c.id];
      t.falseRefusals += fr.length; t.held += held.length; t.driftRefused += dr.length; t.drift += drift.length; t.wrongPasses += wp.length; t.others += others.length;
    }
    rows.push(row);
  }
  return { rows, totals };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const seeds = range(arg('--seeds', '301-390')), novel = range(arg('--novel', '301-330')), learn = Number(arg('--learn', '6'));
  const dumps = [];
  for (const d of [3, 4]) for (const s of seeds) dumps.push(dumpTask(s, 'dev', d));
  for (const s of novel) dumps.push(dumpTask(s, 'dev', 5));
  const { rows, totals } = evaluate(dumps, { learn });
  const ids = CONFIGS.map(c => c.id);
  console.log(`dumps ${dumps.length} (d3/d4 seeds ${seeds[0]}-${seeds.at(-1)}, d5 ${novel[0]}-${novel.at(-1)}), learn ${learn}; cells: false refusals/held, drift refused/d4, wrong passes/others`);
  console.log(['format', 'learn on', ...ids].join(' | '));
  for (const r of rows) {
    if (!r.scored) { console.log(`${r.format} | ${r.n} dumps | (too few to score)`); continue; }
    console.log([r.format, `d${r.learnD}`, ...ids.map(i => { const c = r.configs[i]; return `${c.falseRefusals}/${r.held}, ${c.driftRefused}/${r.drift}, ${c.wrongPasses}/${r.others}${c.wrongPassFormats.length ? ` (${c.wrongPassFormats.join(',')})` : ''}`; })].join(' | '));
  }
  console.log(['total', '', ...ids.map(i => { const t = totals[i]; return `${t.falseRefusals}/${t.held}, ${t.driftRefused}/${t.drift}, ${t.wrongPasses}/${t.others}`; })].join(' | '));
  const json = arg('--json', null);
  if (json) writeFileSync(json, JSON.stringify({ seeds: [seeds[0], seeds.at(-1)], novel: [novel[0], novel.at(-1)], learn, rows, totals }, null, 1));
}
