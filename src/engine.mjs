import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

// Capture once alongside the statically loaded engine. An existing process keeps
// its loaded modules even if the checkout later changes. This is a compatibility
// identity, not remote attestation or a defense against a privileged host attacker.
const require = createRequire(import.meta.url);
// Every module whose semantics a run depends on: execution, validation, context compilation,
// verdicts, sandboxing, model policy/replay keys and the journal, plus the trace contracts, and
// the lineage that declares which earlier engines' runs this one may resume.
const paths = ['engine.mjs', 'runtime.mjs', 'store.mjs', 'run-rows.mjs', 'data.mjs', 'dataflow.mjs', 'validate.mjs', 'lint.mjs', 'acceptance.mjs', 'capabilities.mjs',
  'context.mjs', 'verdict.mjs', 'audit.mjs', 'sandbox.mjs', 'children.mjs', 'schema-subset.mjs', 'models/port.mjs', 'models/policy.mjs', 'journal.mjs', 'state.mjs',
  'signals.mjs', 'principals.mjs', '../schemas/workflow.schema.json', '../schemas/identity.schema.json', '../schemas/decision.schema.json', 'engine-lineage.json'];
const sha256 = data => createHash('sha256').update(data).digest('hex');
const files = Object.fromEntries(paths.map(name => [name, sha256(readFileSync(new URL(name, import.meta.url)))]));
const ajv = JSON.parse(readFileSync(require.resolve('ajv/package.json'), 'utf8'));
const platform = Object.freeze({ contract: 'native-engine-identity/1', node: process.version, platform: process.platform,
  architecture: process.arch, validator: `ajv@${ajv.version}` });
// The descriptor's key order is part of the hash: contract, node, platform, architecture, validator, files.
const hashOf = fileMap => sha256(JSON.stringify({ ...platform, files: fileMap }));
const descriptor = Object.freeze({ ...platform, files: Object.freeze(files) });
export const engineHash = hashOf(files);

// Engine compatibility ranges (research/engine-20261021/ENGINE-BUMP.md §1; Temporal's versioning idea, at release granularity).
// The lineage is checked-in engine source (hashed above), written by the maintainer when a release is cut: this engine's version,
// the oldest predecessor version whose runs it resumes, and each predecessor's exact file map. A malformed lineage is a broken
// engine: the import fails, as a syntax error would.
const lineage = JSON.parse(readFileSync(new URL('engine-lineage.json', import.meta.url), 'utf8'));
const HEX64 = /^[0-9a-f]{64}$/;
{
  const bad = message => { throw new Error(`src/engine-lineage.json: ${message}`); };
  if (lineage?.contract !== 'foundry-engine-lineage/1') bad('contract must be foundry-engine-lineage/1');
  if (!Number.isSafeInteger(lineage.version) || lineage.version < 1) bad('version must be a positive integer');
  if (!Number.isSafeInteger(lineage.resumesFrom) || lineage.resumesFrom < 1 || lineage.resumesFrom > lineage.version) bad('resumesFrom must be an integer in [1, version]');
  if (!Array.isArray(lineage.predecessors)) bad('predecessors must be a list');
  const seen = new Set();
  for (const p of lineage.predecessors) {
    if (!Number.isSafeInteger(p?.version) || p.version < 1 || p.version >= lineage.version || seen.has(p.version)) bad('each predecessor needs a distinct version below this one');
    seen.add(p.version);
    if (!p.files || typeof p.files !== 'object' || Array.isArray(p.files) || !Object.keys(p.files).length || Object.values(p.files).some(h => !HEX64.test(h))) bad(`predecessor ${p.version} needs its file map (name -> sha256)`);
  }
}
export const engineVersion = lineage.version, engineResumesFrom = lineage.resumesFrom;
// A predecessor is known on this host only: its file map with this host's node, platform, architecture and validator. A run created
// under another Node version or validator is not recognised (ENGINE_DRIFT, as before): a platform change is not a declared migration.
const predecessors = new Map(lineage.predecessors.map(p => [hashOf(p.files), Object.freeze({ version: p.version, source: p.source ?? null })]));

/** What this engine knows about a recorded engine hash: itself, a predecessor (with whether its runs may resume here), or null. */
export function engineOf(hash) {
  if (hash === engineHash) return { version: engineVersion, current: true, resumable: true };
  const known = predecessors.get(hash);
  return known ? { version: known.version, source: known.source, current: false, resumable: known.version >= engineResumesFrom } : null;
}
export function engineIdentity() {
  return { hash: engineHash, version: engineVersion, resumesFrom: engineResumesFrom, ...structuredClone(descriptor),
    scope: 'Native engine source/schema and execution platform/validator version; not remote capability or model attestation' };
}
