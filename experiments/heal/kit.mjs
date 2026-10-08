// Frozen runtime for auto-heal (research/heal-20261008/DESIGN.md §1.2). Replay, counterfactuals and every verification run
// import the FROZEN construction kit the C0 runs used, never the live src/ (a concurrent workflow is changing it).
//
//   verifyKit()   every file of the kit's src/ schemas/ policy/ skills/ bin/ must have the git blob id recorded in pins.json
//                 (which pin-gate.mjs wrote from `git ls-tree 880c6b9`); refuses to load otherwise.
//   loadKit()     the verified kit's runtime pieces, plus journal-copy and session-policy helpers.
//
// Nothing here spends: a port is built from a mode and a provider table that the caller chooses.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HEAL_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HEAL_DIR, '../..');
export const KIT_DIR = process.env.HEAL_KIT_DIR ?? '/opt/foundry-kit/7e8f0f83153c5efb';
export const KIT_COMMIT = '880c6b9';           // the P1 freeze; the C0 runs used the same src
export const GATE_COMMIT = '13f7664';          // where the strict lint, acceptance and verdict files are pinned
export const TRACKED = ['src', 'schemas', 'policy', 'skills', 'bin'];
export const PINS_FILE = path.join(HEAL_DIR, 'pins.json');
export const WORK_ROOT = process.env.HEAL_WORK_ROOT ?? '/var/tmp/foundry-work/heal';

export const blobOfBytes = b => createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
export const blobOf = file => blobOfBytes(readFileSync(file));
export const sha256 = x => createHash('sha256').update(x).digest('hex');
export const walk = dir => readdirSync(dir).sort().flatMap(n => { const p = path.join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
export const readPins = (file = PINS_FILE) => JSON.parse(readFileSync(file, 'utf8'));
export const inside = (dir, root) => path.resolve(dir) === path.resolve(root) || path.resolve(dir).startsWith(path.resolve(root) + path.sep);

export function kitFiles(kitDir = KIT_DIR) {
  return Object.fromEntries(TRACKED.flatMap(d => existsSync(path.join(kitDir, d)) ? walk(path.join(kitDir, d)) : [])
    .map(f => [path.relative(kitDir, f).split(path.sep).join('/'), blobOf(f)]));
}

// Compare a kit directory with the recorded pins. `ok` is the only thing a caller needs; the lists say why not.
export function verifyKit({ kitDir = KIT_DIR, pins = readPins() } = {}) {
  const want = pins.kit.files;
  if (!existsSync(kitDir)) return { ok: false, kitDir, reason: 'KIT_MISSING', mismatched: [], missing: [], extra: [] };
  const have = kitFiles(kitDir);
  const mismatched = Object.keys(want).filter(f => have[f] !== undefined && have[f] !== want[f]);
  const missing = Object.keys(want).filter(f => have[f] === undefined), extra = Object.keys(have).filter(f => want[f] === undefined);
  let kitHash = null;
  try { kitHash = JSON.parse(readFileSync(path.join(kitDir, 'KIT.json'), 'utf8')).hash; } catch { /* a bare copy has no KIT.json */ }
  return { ok: !mismatched.length && !missing.length && !extra.length, kitDir, kitHash, commit: pins.kit.commit, files: Object.keys(have).length, mismatched, missing, extra };
}

// The policy the experiments ran with: the owner file at policy/models.json (the only source of model ids), restricted to the
// listed ids. Same construction as experiments/lib/models.mjs subsetPolicy, on the kit's validator.
const freeze = v => { if (v && typeof v === 'object') { for (const c of Object.values(v)) freeze(c); Object.freeze(v); } return v; };

let cached;
export async function loadKit({ kitDir = KIT_DIR, pins = readPins(), verify = true } = {}) {
  if (cached && cached.dir === kitDir) return cached;
  const check = verifyKit({ kitDir, pins });
  if (verify && !check.ok) throw Object.assign(new Error(`HEAL_KIT_MISMATCH: ${kitDir} is not the frozen kit (${check.reason ?? [...check.mismatched, ...check.missing, ...check.extra].slice(0, 5).join(', ')})`), { code: 'HEAL_KIT_MISMATCH', check });
  const imp = rel => import(pathToFileURL(path.join(kitDir, rel)).href);
  const [foundry, port, journal, policy, store, data, validate, scripted, cli, ctx, sandbox, caps] = await Promise.all(['src/foundry.mjs', 'src/models/port.mjs', 'src/journal.mjs',
    'src/models/policy.mjs', 'src/store.mjs', 'src/data.mjs', 'src/validate.mjs', 'src/models/providers/scripted.mjs', 'src/models/providers/claude-cli.mjs', 'src/context.mjs',
    'src/sandbox.mjs', 'src/capabilities.mjs'].map(imp));
  const ownerFile = path.join(REPO, 'policy/models.json');
  const policyIdentical = existsSync(ownerFile) && blobOf(ownerFile) === blobOf(path.join(kitDir, 'policy/models.json'));
  if (verify && !policyIdentical) throw Object.assign(new Error('HEAL_POLICY_DRIFT: policy/models.json differs from the frozen kit policy'), { code: 'HEAL_POLICY_DRIFT' });
  const owner = policy.loadPolicy(ownerFile).policy;
  const sessionPolicy = ids => {
    const missing = ids.filter(id => !owner.models.some(m => m.id === id));
    if (missing.length) throw new Error(`model ids not in the owner policy: ${missing.join(', ')}`);
    const models = owner.models.filter(m => ids.includes(m.id)), used = new Set(models.map(m => m.provider));
    return freeze(policy.validatePolicy(structuredClone({ ...owner, policyVersion: `${owner.policyVersion}+only:${[...ids].sort().join(',')}`, models,
      providers: Object.fromEntries(Object.entries(owner.providers).filter(([n]) => used.has(n))) })));
  };
  // A throwaway copy of a recorded journal (VACUUM INTO from a read-only handle): replay and injection only ever touch copies.
  const copyJournal = (source, dest) => {
    mkdirSync(path.dirname(dest), { recursive: true }); rmSync(dest, { force: true });
    const src = new DatabaseSync(source, { readOnly: true });
    try { src.exec(`VACUUM INTO '${dest.replaceAll("'", "''")}'`); } finally { src.close(); }
    const db = new DatabaseSync(dest);
    db.exec('PRAGMA busy_timeout=5000;');
    return { db, journal: new journal.Journal(db), file: dest };
  };
  const emptyJournal = file => {
    mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file); db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    return { db, journal: new journal.Journal(db), file };
  };
  cached = {
    dir: kitDir, check, kitHash: check.kitHash ?? pins.kit.kitHash, commit: pins.kit.commit, pins, ownerPolicy: owner, ownerPolicyHash: policy.policyHash(owner), policyIdentical,
    Foundry: foundry.Foundry, ModelPort: port.ModelPort, Journal: journal.Journal, Store: store.Store, ScriptedProvider: scripted.ScriptedProvider,
    ClaudeCliProvider: cli.ClaudeCliProvider, policy, data, validate, context: ctx, sandbox, createRegistry: caps.createDefaultRegistry, sessionPolicy, copyJournal, emptyJournal,
    digest: data.digest, canonical: data.canonical, policyHash: policy.policyHash,
    // Schema + dataflow + model-policy validation with the kit's default capability registry (what Foundry.save enforces).
    validateWorkflow: (workflow, modelPolicy) => validate.validateWorkflow(workflow, { registry: caps.createDefaultRegistry(), modelPolicy }),
  };
  return cached;
}

export const sealedRefusal = ({ family = '', split = '' } = {}) => /^sealed/.test(family) || /^sealed/.test(split);
export function assertNotSealed(subject) {
  if (sealedRefusal(subject)) throw Object.assign(new Error(`HEAL_SEALED_REFUSED: ${subject.family ?? ''}/${subject.split ?? ''} is sealed; heal never reads sealed families or splits`), { code: 'HEAL_SEALED_REFUSED' });
}
