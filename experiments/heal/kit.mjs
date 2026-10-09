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

// ---- policy drift ------------------------------------------------------------------------------------------------------------------
// The recorded C0/P1 evidence was made under one policy, and model ids may only come from the owner file. "The owner file still
// agrees with the frozen kit" is therefore judged on what can change a model choice or a replay, not on bytes:
//   - `policyVersion` and `notes` are prose (a bumped version or a new note changes no call);
//   - a provider key that no file of the frozen kit mentions cannot change a call the kit makes. Today that is `childEnv`, which the
//     engine lane added to claude-cli on 2026-10-08 for the `claude -p` child environment.
//   - a top-level policy key that no file of the frozen kit mentions (today `judgmentModels`, added with Jev on 2026-10-09, 38f74fd);
//   - a whole provider entry whose name no file of the frozen kit mentions AND that no `models[]` entry (live or frozen) names as its
//     provider (today `typesafe-systemone`, Jev's systemone-http provider). The second condition matters: the kit looks a generative
//     model's provider up by the name in `models[].provider`, so a provider can be read without its name appearing in any source.
// Each exemption is proved, not assumed: it holds only while no file of the frozen kit's src/ contains the string (experiments/lib/
// models.mjs is outside the kit and does not count), and it lapses the moment one does. Each one is reported in `ignored` with its
// proof. This is the owner's Q6 decision of 2026-10-09 (research/heal-20261008/DESIGN.md, note of that date); it is reversible by
// emptying the two lists below.
// Anything else (a model id, class, price, digest, decoding, provider invocation, class order, escalation, a generative model added
// to models[]) is blocking drift.
// The run itself always uses the kit's own policy of record (below), so its policy hash, its replay keys and its call costs stay
// those of the recorded runs (the 2026-10-08 flags lower the reported cost per call; synthesis rule R3 makes those costs incomparable).
export const PROSE_FIELDS = Object.freeze(['policyVersion', 'notes']);
export const PROVIDER_KEYS_UNREAD_BY_KIT = Object.freeze(['childEnv']);
export const TOP_LEVEL_KEYS_UNREAD_BY_KIT = Object.freeze(['judgmentModels']);
export const PROVIDERS_UNREAD_BY_KIT = Object.freeze(['typesafe-systemone']);
const stable = v => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x));
const diffPaths = (a, b, at = '') => {
  const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  if (obj(a) && obj(b)) return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().flatMap(k => diffPaths(a[k], b[k], at ? `${at}.${k}` : k));
  return stable(a) === stable(b) ? [] : [at || '(root)'];
};
const unmentioned = (kitSources, s) => !kitSources.some(text => text.includes(s));
const proof = s => `no kit source mentions "${s}"`;
export function policyDrift(live, frozen, { kitSources = [] } = {}) {
  const L = structuredClone(live), F = structuredClone(frozen), ignored = [];
  for (const k of PROSE_FIELDS) { if (stable(L[k]) !== stable(F[k])) ignored.push(k); delete L[k]; delete F[k]; }
  for (const key of PROVIDER_KEYS_UNREAD_BY_KIT) {
    if (!unmentioned(kitSources, key)) continue;                     // the kit reads it: any difference stays blocking
    for (const name of new Set([...Object.keys(L.providers ?? {}), ...Object.keys(F.providers ?? {})])) {
      const a = L.providers?.[name], b = F.providers?.[name];
      if (stable(a?.[key]) !== stable(b?.[key])) ignored.push(`providers.${name}.${key}: ${proof(key)}`);
      if (a) delete a[key]; if (b) delete b[key];
    }
  }
  for (const key of TOP_LEVEL_KEYS_UNREAD_BY_KIT) {
    if (!unmentioned(kitSources, key)) continue;
    if (stable(L[key]) !== stable(F[key])) ignored.push(`${key}: ${proof(key)}`);
    delete L[key]; delete F[key];
  }
  const namedByModels = new Set([...(L.models ?? []), ...(F.models ?? [])].map(m => m?.provider));
  for (const name of PROVIDERS_UNREAD_BY_KIT) {
    if (!unmentioned(kitSources, name) || namedByModels.has(name)) continue;
    if (stable(L.providers?.[name]) !== stable(F.providers?.[name])) ignored.push(`providers.${name}: ${proof(name)}; no models[] entry names it`);
    if (L.providers) delete L.providers[name]; if (F.providers) delete F.providers[name];
  }
  const blocking = diffPaths(L, F);
  return { bytesIdentical: false, blocking, ignored, ok: blocking.length === 0 };
}
// Every file of the frozen kit's src/ (not only .mjs: the proof is "no file contains the string").
export const kitSourceTexts = kitDir => walk(path.join(kitDir, 'src')).map(f => readFileSync(f, 'utf8'));

let cached;
export async function loadKit({ kitDir = KIT_DIR, pins = readPins(), verify = true } = {}) {
  if (cached && cached.dir === kitDir) return cached;
  const check = verifyKit({ kitDir, pins });
  if (verify && !check.ok) throw Object.assign(new Error(`HEAL_KIT_MISMATCH: ${kitDir} is not the frozen kit (${check.reason ?? [...check.mismatched, ...check.missing, ...check.extra].slice(0, 5).join(', ')})`), { code: 'HEAL_KIT_MISMATCH', check });
  const imp = rel => import(pathToFileURL(path.join(kitDir, rel)).href);
  const [foundry, port, journal, policy, store, data, validate, scripted, cli, ctx, sandbox, caps] = await Promise.all(['src/foundry.mjs', 'src/models/port.mjs', 'src/journal.mjs',
    'src/models/policy.mjs', 'src/store.mjs', 'src/data.mjs', 'src/validate.mjs', 'src/models/providers/scripted.mjs', 'src/models/providers/claude-cli.mjs', 'src/context.mjs',
    'src/sandbox.mjs', 'src/capabilities.mjs'].map(imp));
  // The owner file is checked against the kit's policy of record; the run uses the policy of record (see "policy drift" above).
  const ownerFile = path.join(REPO, 'policy/models.json'), recordFile = path.join(kitDir, 'policy/models.json');
  let drift;
  if (!existsSync(ownerFile)) drift = { bytesIdentical: false, blocking: ['(owner policy file missing)'], ignored: [], ok: false };
  else {
    drift = policyDrift(JSON.parse(readFileSync(ownerFile, 'utf8')), JSON.parse(readFileSync(recordFile, 'utf8')), { kitSources: kitSourceTexts(kitDir) });
    drift.bytesIdentical = blobOf(ownerFile) === blobOf(recordFile);
  }
  const policyIdentical = drift.ok;
  if (verify && !policyIdentical) throw Object.assign(new Error(`HEAL_POLICY_DRIFT: policy/models.json differs from the frozen kit policy in: ${drift.blocking.join(', ')}`), { code: 'HEAL_POLICY_DRIFT', drift });
  const owner = policy.loadPolicy(recordFile).policy;
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
    dir: kitDir, check, kitHash: check.kitHash ?? pins.kit.kitHash, commit: pins.kit.commit, pins, ownerPolicy: owner, ownerPolicyHash: policy.policyHash(owner), policyIdentical, policyDrift: drift,
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
