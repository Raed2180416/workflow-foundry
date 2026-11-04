// DUR-1 freezes (PREREG-DUR-1 §13.1; BUILD-PLAN row 18). $0. Two freezes, each a JSON of sha256 digests checked before
// every paid step it covers (the FH-1 pattern, experiments/fh/freeze.mjs): a changed, missing or extra file stops the run.
//   F-A  (author freeze)  AUTHOR-BRIEF.md, the change-operator API and the author's gate code; covers the sealed-author
//                         session (P1) only.
//   F-B  (Fix freeze)     the preregistration, every experiments/durability file, the FH-1 heal kit, Move 0's certify and
//                         gauntlet, the contracts and drift harness, the executors, policy/models.json, the bed digest, the
//                         nine starting programs, S1-S3 and c-oss, the seed claim, the sealed bundle's hash, the power
//                         output; covers every other paid step.
//   node experiments/durability/freeze.mjs write A|B      writes research/durability-20261021/FREEZE-A.json | FREEZE.json
//   node experiments/durability/freeze.mjs check A|B      exits 1 and lists what differs
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROOT } from './changes.mjs';
import { bedDigest } from '../fh/grade.mjs';

const sha = b => createHash('sha256').update(b).digest('hex');
const RES = 'research/durability-20261021';
export const FREEZE_FILES = Object.freeze({ A: path.join(ROOT, RES, 'FREEZE-A.json'), B: path.join(ROOT, RES, 'FREEZE.json') });
export const SEALED_HASH_FILE = path.join(ROOT, RES, 'SEALED.json');      // { sha256, at } written after P1 (V-13)
export const POWER_FILE = path.join(ROOT, RES, 'POWER.json');             // power.mjs output (prereg §11)

const walk = (rel, pred = () => true) => {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [rel];
  return readdirSync(abs).sort().flatMap(f => walk(path.join(rel, f), pred)).filter(pred);
};
const code = f => /\.(mjs|js|json|sh|md)$/.test(f) && !/\/test\//.test(f) || /\/test\/.*\.test\.mjs$/.test(f);

export const FROZEN_A = Object.freeze([
  `${RES}/AUTHOR-BRIEF.md`, 'experiments/durability/author.mjs', 'experiments/durability/changes.mjs', 'experiments/durability/schedule.mjs',
  'experiments/durability/fixtures/author-api.md', 'experiments/compose/drift.mjs', 'policy/models.json', 'src/executors/claude-code.mjs',
]);
export function frozenB() {
  return [...new Set([
    `${RES}/PREREG-DUR-1.md`, `${RES}/AUTHOR-BRIEF.md`, `${RES}/SEED-CLAIMS.json`,
    ...walk('experiments/durability', code),
    ...walk('experiments/fh', f => /\.mjs$/.test(f)),
    'experiments/lib/certify.mjs', 'experiments/lib/gauntlet.mjs', 'experiments/lib/stats.mjs', 'experiments/lib/stats-builds.mjs', 'experiments/lib/stats-ebed.mjs',
    'experiments/lib/ebed-seeds.mjs', 'experiments/jit/stats.mjs', 'experiments/jit/profile.mjs', 'experiments/jit/seeds.mjs',
    'experiments/compose/capabilities.mjs', 'experiments/compose/drift.mjs', 'experiments/compose/faults.mjs', 'experiments/compose/build.mjs', 'experiments/compose/bundle.mjs', 'experiments/compose/trace.mjs',
    'experiments/ebed/build.mjs', 'experiments/ebed/smoke-service.mjs', 'experiments/ebed/agent-arm.mjs', 'experiments/agentv/arm.mjs',
    'experiments/constitution/observer.mjs', 'experiments/constitution/port.mjs', 'experiments/tracker/nversion.mjs',
    'src/executors/claude-code.mjs', 'policy/models.json', 'research/jit-20261008/SEED-LEDGER.json',
  ])].filter(f => existsSync(path.join(ROOT, f)));
}
const digestsOf = files => Object.fromEntries(files.map(f => [f, existsSync(path.join(ROOT, f)) ? sha(readFileSync(path.join(ROOT, f))) : null]));

/** Digests of the starting programs, S1-S3 and c-oss (their bundled sources), the bed, the sealed bundle and power output. */
export async function extraDigests() {
  const { programVersion, LINEAGES, REF_SOLVERS } = await import('./arms.mjs');
  const programs = {};
  for (const [id, spec] of Object.entries({ ...LINEAGES, ...REF_SOLVERS })) programs[id] = programVersion(spec, { id }).digest;
  programs['c-oss'] = sha(readFileSync(path.join(ROOT, 'beds/ebed/e8/controls.mjs'))).slice(0, 16);
  return {
    bedDigest: bedDigest(),
    programs,
    sealed: existsSync(SEALED_HASH_FILE) ? JSON.parse(readFileSync(SEALED_HASH_FILE, 'utf8')).sha256 : null,
    power: existsSync(POWER_FILE) ? sha(readFileSync(POWER_FILE)) : null,
  };
}

/** Write a freeze. B requires the sealed bundle hash and the power output to exist (they are part of what is frozen). */
export async function writeFreeze(stage, { commit = null, allowMissingSealed = false } = {}) {
  const files = stage === 'A' ? digestsOf(FROZEN_A) : digestsOf(frozenB());
  const missing = Object.entries(files).filter(([, v]) => v === null).map(([f]) => f);
  if (missing.length) throw new Error(`DUR1_FREEZE: cannot freeze ${stage}, missing: ${missing.join(', ')}`);
  const extra = stage === 'B' ? await extraDigests() : { bedDigest: bedDigest() };
  if (stage === 'B' && !extra.sealed && !allowMissingSealed) throw new Error('DUR1_FREEZE: F-B needs the sealed bundle hash (SEALED.json, after P1)');
  if (stage === 'B' && !extra.power) throw new Error('DUR1_FREEZE: F-B needs POWER.json (node experiments/durability/power.mjs > POWER.json)');
  const out = { experiment: 'DUR-1', stage, at: new Date().toISOString(), commit, ...extra, files };
  writeFileSync(FREEZE_FILES[stage], JSON.stringify(out, null, 1) + '\n');
  return out;
}

/** Check a freeze: { ok, changed, missing, extra, ... }. */
export async function checkFreeze(stage, { file = FREEZE_FILES[stage] } = {}) {
  if (!existsSync(file)) return { ok: false, reason: `FREEZE ${stage} missing (${path.relative(ROOT, file)})`, changed: [], extra: [] };
  const want = JSON.parse(readFileSync(file, 'utf8'));
  const have = stage === 'A' ? digestsOf(FROZEN_A) : digestsOf(frozenB());
  const changed = Object.keys(want.files).filter(f => have[f] !== want.files[f]);
  const extra = Object.keys(have).filter(f => !(f in want.files));
  const problems = [];
  if (bedDigest() !== want.bedDigest) problems.push(`bed ${want.bedDigest} -> ${bedDigest()}`);
  if (stage === 'B') {
    const x = await extraDigests();
    for (const [id, d] of Object.entries(want.programs ?? {})) if (x.programs[id] !== d) problems.push(`program ${id} ${d} -> ${x.programs[id]}`);
    if (want.sealed !== x.sealed) problems.push(`sealed bundle hash ${want.sealed} -> ${x.sealed}`);
    if (want.power !== x.power) problems.push(`power output ${want.power} -> ${x.power}`);
  }
  return { ok: !changed.length && !extra.length && !problems.length, changed, extra, problems };
}

/** A synchronous gate for paid sessions (heal-adapter's checkFreeze hook): the result of the last async check, refreshed per step. */
export function freezeGate(result) { return () => result; }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, stage = 'B'] = process.argv.slice(2);
  if (!['A', 'B'].includes(stage)) { console.error('stage must be A or B'); process.exit(2); }
  if (mode === 'write') {
    const commitIx = process.argv.indexOf('--commit');
    const r = await writeFreeze(stage, { commit: commitIx > 0 ? process.argv[commitIx + 1] : null });
    console.log(`FREEZE ${stage}: ${Object.keys(r.files).length} files, bed ${r.bedDigest}${r.sealed ? `, sealed ${r.sealed.slice(0, 16)}` : ''}`);
  } else if (mode === 'check') {
    const c = await checkFreeze(stage);
    console.log(JSON.stringify(c));
    process.exit(c.ok ? 0 : 1);
  } else { console.error('usage: freeze.mjs write|check A|B'); process.exit(2); }
}
