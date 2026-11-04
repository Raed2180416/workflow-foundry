#!/usr/bin/env node
// CI-1 pooled analysis (PREREG-CI1-W2 §4, secondary, labelled): wave 1 under oracle v2 (post hoc verdicts from
// runs/<wave-1 label>/rescore-v2.json) + wave 2 (oracle v2 is its frozen primary oracle), one item set, per arm; paired contrasts by item.
//   node experiments/ci1-w2/pooled.mjs A0=test-A0+w2-A0 A2=test-A2+w2-A2 ... [--pairs A2:A0,A2:A1c] [--exclude 16312,17545]
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUMMARIES, armStats, paired, table } from '../ci1/report.mjs';

/** Records of one label with oracle v2 verdicts: a wave-1 label takes them from its rescore file, a wave-2 label already has them. */
export function v2Records(label) {
  const s = JSON.parse(readFileSync(path.join(SUMMARIES, label, 'summary.json'), 'utf8'));
  const rf = path.join(SUMMARIES, label, 'rescore-v2.json');
  if (label.startsWith('w2-')) return s.records;
  if (!existsSync(rf)) throw new Error(`${label}: no rescore-v2.json (run experiments/ci1-posthoc/rescore.mjs)`);
  const by = new Map(JSON.parse(readFileSync(rf, 'utf8')).rows.map(x => [`${x.item}-k${x.k}`, x.v2]));
  return s.records.map(r => ({ ...r, pass: by.get(`${r.item}-k${r.k}`) ?? r.pass }));
}
export function pooledSummary(arm, labels, exclude = []) {
  const records = labels.flatMap(v2Records).filter(r => !exclude.includes(r.item));
  return { arm, label: labels.join('+'), split: 'pooled', model: null, K: 3, records };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = n => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
  const exclude = opt('--exclude')?.split(',') ?? [];
  const specs = args.filter((x, i) => x.includes('=') && !['--pairs', '--exclude'].includes(args[i - 1]));
  const sums = specs.map(s => { const [arm, l] = s.split('='); return pooledSummary(arm, l.split('+'), exclude); });
  console.log(table(sums.map(s => armStats(s))));
  for (const [x, y] of (opt('--pairs') ?? '').split(',').filter(Boolean).map(p => p.split(':'))) {
    const a = sums.find(s => s.arm === x), b = sums.find(s => s.arm === y);
    const p = paired(a, b);
    console.log(`${x} - ${y}: ${(100 * p.diff).toFixed(1)} points (95% CI ${(100 * p.ci.lo).toFixed(1)} to ${(100 * p.ci.hi).toFixed(1)}), items ${p.items}, sign test +${p.sign.pos}/-${p.sign.neg} p=${p.sign.p.toFixed(3)}; ${x} better on [${p.flips.aOnly.join(', ')}], ${y} better on [${p.flips.bOnly.join(', ')}]`);
  }
}
