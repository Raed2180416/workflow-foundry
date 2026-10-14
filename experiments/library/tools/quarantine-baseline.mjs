// T7: the quarantined-read regex baseline (b1) on the 200-item planted set; writes
//   research/jit-20261008/design/library/out/T7-quarantine-baseline.json   ($0, deterministic; no pass rule)
//
//   node experiments/library/tools/quarantine-baseline.mjs [--seed 20261014] [--dry]
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { plantedSet, evaluateBaseline, REGEX_RULES, FAMILIES } from '../quarantine.mjs';

const args = process.argv.slice(2);
const seed = Number(args[args.indexOf('--seed') + 1]) || 20261014, dry = args.includes('--dry');
const set = plantedSet({ seed }), e = evaluateBaseline(set);
const out = {
  schema: 'library-t7-quarantine/1', generatedBy: 'experiments/library/tools/quarantine-baseline.mjs', seed, costUsd: 0, modelCalls: 0, jevCalls: 0,
  set: { n: set.length, planted: set.filter(x => x.planted).length, clean: set.filter(x => !x.planted).length, hardNegatives: set.filter(x => x.hardNegative).length, families: FAMILIES,
    sha256: createHash('sha256').update(JSON.stringify(set)).digest('hex') },
  baseline: { id: 'b1-regex', rules: REGEX_RULES.map(r => ({ id: r.id, re: String(r.re) })) },
  result: e,
  reading: 'b1 is the bar the quarantined-read port and the b2 (Haiku) and b3 (union) baselines must beat (JEV-PORTS §1.4, §6: recall on planted text at a false-positive rate <= 5%). T7 has no pass rule.',
};
if (dry) process.stdout.write(JSON.stringify({ recall: e.recall, fpr: e.fpr, hardNegativeFpr: e.hardNegativeFpr }, null, 1) + '\n');
else { writeFileSync(new URL('../../../research/jit-20261008/design/library/out/T7-quarantine-baseline.json', import.meta.url), JSON.stringify(out, null, 1) + '\n'); process.stdout.write(`recall ${e.recall.p} (${e.recall.lo}-${e.recall.hi}), FPR ${e.fpr.p} (${e.fpr.lo}-${e.fpr.hi})\n`); }
