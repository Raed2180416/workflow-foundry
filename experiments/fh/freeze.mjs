// FH-1 freeze ($0): the sha256 of every file the preregistration freezes (research/heal-20261021/PREREG-FH1.md §6), written once
// before the first paid call and checked by the plan runner before every paid step (a changed file stops the run).
//   node experiments/fh/freeze.mjs write [--commit <sha>]     writes research/heal-20261021/fh1/FREEZE.json
//   node experiments/fh/freeze.mjs check                      exits 1 and lists the files that differ
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROOT, bedDigest } from './grade.mjs';

export const FREEZE_FILE = path.join(ROOT, 'research/heal-20261021/fh1/FREEZE.json');
const BASELINE_DIR = 'research/heal-20261021/fh1/baseline';
export const FROZEN = Object.freeze([
  'research/heal-20261021/PREREG-FH1.md',
  'experiments/fh/grade.mjs', 'experiments/fh/baseline.mjs', 'experiments/fh/heal.mjs', 'experiments/fh/analyse.mjs', 'experiments/fh/ensemble.mjs',
  'experiments/fh/freeze.mjs', 'experiments/fh/baseline-table.mjs', 'experiments/fh/test/fh.test.mjs',
  'experiments/compose/capabilities.mjs', 'experiments/compose/bundle.mjs', 'experiments/compose/build.mjs', 'experiments/compose/trace.mjs',
  'experiments/tracker/nversion.mjs', 'experiments/ebed/build.mjs', 'experiments/ebed/smoke-service.mjs',
  'src/executors/claude-code.mjs', 'policy/models.json',
  'research/heal-20261021/fh1/plan-A.txt', 'research/heal-20261021/fh1/plan-B.txt', 'research/heal-20261021/fh1/plan-C.txt',
  'research/heal-20261021/fh1/ensemble-signatures.json', 'research/heal-20261021/fh1/verifiers.json',
]);
const sha = b => createHash('sha256').update(b).digest('hex');
export const frozenFiles = () => [...FROZEN, ...(existsSync(path.join(ROOT, BASELINE_DIR)) ? readdirSync(path.join(ROOT, BASELINE_DIR)).filter(f => f.endsWith('.json')).sort().map(f => `${BASELINE_DIR}/${f}`) : [])];
export const digests = () => Object.fromEntries(frozenFiles().map(f => [f, existsSync(path.join(ROOT, f)) ? sha(readFileSync(path.join(ROOT, f))) : null]));

/** Compare the frozen digests with the files now. { ok, changed: [file], missing: [file] } */
export function checkFreeze(file = FREEZE_FILE) {
  if (!existsSync(file)) return { ok: false, reason: 'FREEZE.json missing', changed: [], missing: [] };
  const want = JSON.parse(readFileSync(file, 'utf8'));
  const have = digests();
  const changed = Object.keys(want.files).filter(f => have[f] !== want.files[f]);
  const extra = Object.keys(have).filter(f => !(f in want.files));
  const bed = bedDigest() === want.bedDigest;
  return { ok: !changed.length && !extra.length && bed, changed, extra, bedDigest: bed ? 'same' : `${want.bedDigest} -> ${bedDigest()}` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === 'write') {
    const files = digests();
    const missing = Object.entries(files).filter(([, v]) => v === null).map(([f]) => f);
    if (missing.length) { console.error(`cannot freeze, missing: ${missing.join(', ')}`); process.exit(1); }
    writeFileSync(FREEZE_FILE, JSON.stringify({ experiment: 'FH-1', at: new Date().toISOString(), bedDigest: bedDigest(), files }, null, 1) + '\n');
    console.log(`FREEZE.json: ${Object.keys(files).length} files, bed ${bedDigest()}`);
  } else if (mode === 'check') {
    const c = checkFreeze();
    console.log(JSON.stringify(c));
    process.exit(c.ok ? 0 : 1);
  } else { console.error('usage: freeze.mjs write|check'); process.exit(2); }
}
