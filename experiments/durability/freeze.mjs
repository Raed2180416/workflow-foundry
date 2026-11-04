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

export const PREREG = `${RES}/PREREG-DUR-1.md`;
/**
 * F-A: the author's files, the run entry points it goes through (run.mjs, heal-adapter.mjs for the metered session), and the
 * preregistration itself: since 2026-11-04 the prereg is FROZEN before P1 (§13.1 as amended), so the author cannot run on
 * a changed prereg.
 */
export const FROZEN_A = Object.freeze([
  `${RES}/AUTHOR-BRIEF.md`, PREREG, 'experiments/durability/author.mjs', 'experiments/durability/changes.mjs', 'experiments/durability/schedule.mjs',
  'experiments/durability/run.mjs', 'experiments/durability/heal-adapter.mjs', 'experiments/durability/dur1-chain.sh',
  'experiments/durability/fixtures/author-api.md', 'experiments/compose/drift.mjs', 'policy/models.json', 'src/executors/claude-code.mjs',
]);

/**
 * Every repository module the paid run executes: the static import closure (relative specifiers of `from '...'` and of
 * literal `import('...')`) of every non-test module under experiments/durability, which includes the chain's entry point
 * run.mjs, paid.mjs and the contract worker. Files written at run time (transition copies, contract readings, candidate
 * programs) are not repository files; the bed is pinned by its digest, the programs by theirs.
 */
export function executedFiles() {
  const seen = new Set();
  const visit = rel => {
    if (seen.has(rel)) return;
    const abs = path.join(ROOT, rel);
    if (!existsSync(abs) || !statSync(abs).isFile()) return;
    seen.add(rel);
    if (!/\.m?js$/.test(rel)) return;
    const src = readFileSync(abs, 'utf8');
    for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) visit(path.relative(ROOT, path.resolve(path.dirname(abs), m[1])));
  };
  for (const f of walk('experiments/durability', f => /\.mjs$/.test(f) && !/\/test\//.test(f))) visit(f);
  return [...seen].sort();
}
/** Files the run READS at run time (data, prompts, texts it copies into workspaces), beyond its modules. */
export const READ_FILES = Object.freeze(['policy/models.json', 'research/jit-20261008/SEED-LEDGER.json', `${RES}/AUTHOR-BRIEF.md`, `${RES}/SEED-CLAIMS.json`, `${RES}/POWER.json`,
  'experiments/durability/fixtures/sealed-stub.json', 'experiments/durability/fixtures/author-api.md', 'experiments/durability/dur1-chain.sh', 'experiments/compose/capabilities.mjs', 'experiments/compose/drift.mjs']);
export function frozenB() {
  return [...new Set([...executedFiles(), ...READ_FILES,
    `${RES}/PREREG-DUR-1.md`, `${RES}/AUTHOR-BRIEF.md`, `${RES}/SEED-CLAIMS.json`,
    ...walk('experiments/durability', code),
    ...walk('experiments/fh', f => /\.mjs$/.test(f)),
    'experiments/lib/certify.mjs', 'experiments/lib/gauntlet.mjs', 'experiments/lib/stats.mjs', 'experiments/lib/stats-builds.mjs', 'experiments/lib/stats-ebed.mjs',
    'experiments/lib/ebed-seeds.mjs', 'experiments/jit/stats.mjs', 'experiments/jit/profile.mjs', 'experiments/jit/seeds.mjs',
    'experiments/compose/capabilities.mjs', 'experiments/compose/drift.mjs', 'experiments/compose/faults.mjs', 'experiments/compose/build.mjs', 'experiments/compose/bundle.mjs', 'experiments/compose/trace.mjs',
    'experiments/ebed/build.mjs', 'experiments/ebed/smoke-service.mjs', 'experiments/ebed/agent-arm.mjs', 'experiments/agentv/arm.mjs',
    'experiments/constitution/observer.mjs', 'experiments/constitution/port.mjs', 'experiments/tracker/nversion.mjs',
    'src/executors/claude-code.mjs', 'policy/models.json', 'research/jit-20261008/SEED-LEDGER.json',
  ])].filter(f => existsSync(path.join(ROOT, f))).sort();
}

/**
 * The digests recorded in the preregistration's Appendix D (a fenced `freeze-digests` block of "<sha256>  <path>" lines),
 * or null when it has none. F-B refuses to write unless every file of frozenB() other than the prereg has exactly the
 * digest the frozen prereg records (§13.1 as amended 2026-11-04).
 */
export function preregDigests(text = readFileSync(path.join(ROOT, PREREG), 'utf8')) {
  const m = text.match(/```freeze-digests\n([\s\S]*?)```/);
  if (!m) return null;
  return Object.fromEntries(m[1].trim().split('\n').filter(l => /^[0-9a-f]{64}\s+\S/.test(l)).map(l => { const [h, ...p] = l.trim().split(/\s+/); return [p.join(' '), h]; }));
}
/** The Appendix D block for the current tree: every frozenB() file except the prereg itself. */
export function digestBlock() {
  const files = frozenB().filter(f => f !== PREREG);
  return files.map(f => `${sha(readFileSync(path.join(ROOT, f)))}  ${f}`).join('\n');
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
  if (stage === 'B') {
    // The frozen prereg's Appendix D must hold every file's digest unchanged (nothing moved between F-A and F-B).
    const want = preregDigests();
    if (!want) throw new Error('DUR1_FREEZE: the prereg has no Appendix D digests (it must be FROZEN first)');
    const differs = Object.entries(files).filter(([f]) => f !== PREREG).filter(([f, h]) => want[f] !== h).map(([f]) => f);
    const gone = Object.keys(want).filter(f => !(f in files));
    if (differs.length || gone.length) throw new Error(`DUR1_FREEZE: F-B differs from the frozen prereg's Appendix D: ${[...differs, ...gone.map(f => `${f} (missing)`)].slice(0, 12).join(', ')}`);
  }
  const pd = preregDigests();
  const out = { experiment: 'DUR-1', stage, at: new Date().toISOString(), commit, ...extra, ...(pd ? { preregBlock: sha(JSON.stringify(pd)), preregFiles: Object.keys(pd).length } : {}), files };
  writeFileSync(FREEZE_FILES[stage], JSON.stringify(out, null, 1) + '\n');
  return out;
}

/** Check a freeze: { ok, changed, missing, extra, ... }. */
export async function checkFreeze(stage, { file = FREEZE_FILES[stage] } = {}) {
  if (!existsSync(file)) return { ok: false, reason: `FREEZE ${stage} missing (${path.relative(ROOT, file)})`, changed: [], extra: [] };
  const want = JSON.parse(readFileSync(file, 'utf8'));
  const have = stage === 'A' ? digestsOf(FROZEN_A) : digestsOf(frozenB());
  const changed = Object.keys(want.files).filter(f => have[f] !== want.files[f]);
  if (stage === 'A' && want.preregBlock) { const d = preregDigests(); if (!d || sha(JSON.stringify(d)) !== want.preregBlock) changed.push(`${PREREG} (Appendix D)`); }
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
  } else if (mode === 'digests') {
    console.log(digestBlock());
  } else if (mode === 'check') {
    const c = await checkFreeze(stage);
    console.log(JSON.stringify(c));
    process.exit(c.ok ? 0 : 1);
  } else { console.error('usage: freeze.mjs write|check A|B, or freeze.mjs digests (the Appendix D block)'); process.exit(2); }
}
