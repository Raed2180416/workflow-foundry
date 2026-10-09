#!/usr/bin/env node
// Writes PREREG.json: the declared acceptance rule, thresholds and the sha256 of every file that defines the evaluator and the per-item normalisations.
// Re-run it to verify: `node prereg.mjs --check` exits 1 if a hashed file changed after the freeze.
import fs from 'node:fs';
import crypto from 'node:crypto';
const here = rel => new URL(rel, import.meta.url);
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(here(f))).digest('hex');
const files = ['lib/conformance.mjs', ...['galaxy', 'n8n12679', 'n8n20281', 'ha', 'gha'].flatMap(a => [`normalisation/${a}.mjs`, `adapters/${a}.mjs`]), 'census/lib.mjs', 'census/census.mjs'];
const body = {
  note: 'Frozen after the dev-seed iteration described in README "Honest limits": the I-tier normalisations were developed while looking at dev seeds 0-27 results, so every figure is in-sample for the declared normalisation. No held-out seed (>= 7001) was run.',
  frozenOn: '2026-10-09',
  acceptanceRule: 'a design is accepted iff, on every evaluation case of a battery, fitness >= tau and precision >= tau; a design is accepted overall iff accepted on every seed it was run on',
  tau: 1, tauSensitivities: [0.95, 'share-of-cases-exact >= 0.9'],
  alignment: 'per case and stream: bag matching with time tolerance for timestamped streams, longest-common-subsequence for untimed streams (order mode auto / bag / seq declared per tier); unit-cost log and model moves',
  fitness: 'matched / |expected|', precision: 'matched / |observed|',
  tiers: { G: 'item-agnostic: text normalisation only (quotes, whitespace), +-1 s where timed, raw keys', I: 'item-declared normalisation, one file per item under normalisation/' },
  seeds: { galaxy: '0-4', n8n12679: '0-4', n8n20281: '0-4', ha: '0-9', gha: '0-27' },
  census: { thetas: [0.15, 0.25, 0.35], primaryTheta: 0.25, minNodes: 5, lineageRelaxed: '2 x theta', primaryOracleCriterion: '>=3 members with oracle.kind != none' },
  killRules: { row17: 'evaluator misclassifies more designs than oracle v1 (29), or cannot express a pilot\'s effects', row33: 'fewer than 10 families with >=3 variants and shipped oracles' },
  sha256: Object.fromEntries(files.map(f => [f, sha(f)])),
};
if (process.argv.includes('--check')) {
  const old = JSON.parse(fs.readFileSync(here('PREREG.json'), 'utf8'));
  const bad = Object.entries(old.sha256).filter(([f, h]) => sha(f) !== h).map(([f]) => f);
  console.log(bad.length ? `CHANGED after freeze: ${bad.join(', ')}` : 'all frozen files unchanged'); process.exit(bad.length ? 1 : 0);
}
fs.writeFileSync(here('PREREG.json'), JSON.stringify(body, null, 1) + '\n');
console.log('wrote PREREG.json');
