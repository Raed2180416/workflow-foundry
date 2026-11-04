#!/usr/bin/env node
// CI-1 review-arm freeze (research/ci1-20261021/r/PREREG-CI1-R.md): sha256 of the review arms' code, the blind cards, the analysis and
// oracle definitions the preregistration names, and the two earlier manifests (which cover the beds, the oracles and the frozen arm
// code). Written and committed BEFORE the first review-arm builder call; run-r.mjs refuses to run when any file differs.
//   node experiments/ci1-r/manifest-r.mjs build | check
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
export const MANIFEST_R = path.join(root, 'research/ci1-20261021/r/MANIFEST-R.json');
const sha = f => createHash('sha256').update(readFileSync(f)).digest('hex');
export const FROZEN_R = Object.freeze([
  'research/ci1-20261021/r/PREREG-CI1-R.md',
  'research/ci1-20261021/MANIFEST.json', 'research/ci1-20261021/w2/MANIFEST-W2.json',
  'experiments/ci1-r/env-guard.mjs', 'experiments/ci1-r/retrieve-r.mjs', 'experiments/ci1-r/builders-r.mjs', 'experiments/ci1-r/run-r.mjs',
  'experiments/ci1-r/run-detached-r.sh', 'experiments/ci1-r/r-run.sh', 'experiments/ci1-r/library/pattern-hints-blind.json', 'experiments/ci1-r/write-blind-cards.mjs',
  // the scorers and the analysis the preregistration names (the corrected oracle is v2 + the declared w2x transforms, fixed here)
  'experiments/ci1-posthoc/oracle-v2.mjs', 'experiments/ci1-posthoc/rescore.mjs', 'experiments/ci1-posthoc/rescore-w2x.mjs',
  'experiments/ci1-w2/bed2.mjs', 'experiments/ci1-w2/pooled.mjs', 'experiments/ci1/report.mjs',
  'experiments/ci1/builders.mjs', 'experiments/ci1/prompt.mjs', 'experiments/ci1/retrieve.mjs', 'experiments/ci1/run-arm.mjs', 'experiments/ci1-w2/run-w2.mjs',
]);
export function buildManifestR() {
  return { schema: 'foundry.ci1.manifest-r/1', created: new Date().toISOString(), files: Object.fromEntries(FROZEN_R.map(f => [f, sha(path.join(root, f))])) };
}
/** [] when every frozen file matches, else one line per difference. */
export function checkManifestR(file = MANIFEST_R) {
  if (!existsSync(file)) return [`${path.relative(root, file)} missing`];
  const m = JSON.parse(readFileSync(file, 'utf8')), bad = [];
  for (const [f, h] of Object.entries(m.files)) { const p = path.join(root, f); if (!existsSync(p)) bad.push(`${f} missing`); else if (sha(p) !== h) bad.push(`${f} changed`); }
  for (const f of FROZEN_R) if (!(f in m.files)) bad.push(`${f} not in the manifest`);
  return bad;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  if (cmd === 'build') { const m = buildManifestR(); writeFileSync(MANIFEST_R, `${JSON.stringify(m, null, 1)}\n`); console.log(`MANIFEST-R sha256 ${sha(MANIFEST_R)} (${Object.keys(m.files).length} files)`); }
  else if (cmd === 'check') { const bad = checkManifestR(); console.log(bad.length ? bad.join('\n') : 'MANIFEST-R matches'); process.exitCode = bad.length ? 1 : 0; }
  else console.log('usage: manifest-r.mjs build|check');
}
