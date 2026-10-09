import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

// Capture once alongside the statically loaded engine. An existing process keeps
// its loaded modules even if the checkout later changes. This is a compatibility
// identity, not remote attestation or a defense against a privileged host attacker.
const require = createRequire(import.meta.url);
// Every module whose semantics a run depends on: execution, validation, context compilation,
// verdicts, sandboxing, model policy/replay keys and the journal, plus the trace contracts.
const paths = ['engine.mjs', 'runtime.mjs', 'store.mjs', 'run-rows.mjs', 'data.mjs', 'dataflow.mjs', 'validate.mjs', 'lint.mjs', 'acceptance.mjs', 'capabilities.mjs',
  'context.mjs', 'verdict.mjs', 'audit.mjs', 'sandbox.mjs', 'children.mjs', 'schema-subset.mjs', 'models/port.mjs', 'models/policy.mjs', 'journal.mjs',
  '../schemas/workflow.schema.json', '../schemas/identity.schema.json', '../schemas/decision.schema.json'];
const files = Object.fromEntries(paths.map(name => [name, createHash('sha256').update(readFileSync(new URL(name, import.meta.url))).digest('hex')]));
const ajv = JSON.parse(readFileSync(require.resolve('ajv/package.json'), 'utf8'));
const descriptor = Object.freeze({ contract: 'native-engine-identity/1', node: process.version, platform: process.platform,
  architecture: process.arch, validator: `ajv@${ajv.version}`, files: Object.freeze(files) });
export const engineHash = createHash('sha256').update(JSON.stringify(descriptor)).digest('hex');
export function engineIdentity() {
  return { hash: engineHash, ...structuredClone(descriptor), scope: 'Native engine source/schema and execution platform/validator version; not remote capability or model attestation' };
}
