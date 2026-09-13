import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

// Capture once alongside the statically loaded engine. An existing process keeps
// its loaded modules even if the checkout later changes. This is a compatibility
// identity, not remote attestation or a defense against a privileged host attacker.
const require = createRequire(import.meta.url);
const paths = ['engine.mjs', 'runtime.mjs', 'store.mjs', 'data.mjs', 'dataflow.mjs', 'validate.mjs', 'capabilities.mjs'];
const files = Object.fromEntries(paths.map(name => [name, createHash('sha256').update(readFileSync(new URL(name, import.meta.url))).digest('hex')]));
files['../schemas/workflow.schema.json'] = createHash('sha256').update(readFileSync(new URL('../schemas/workflow.schema.json', import.meta.url))).digest('hex');
const ajv = JSON.parse(readFileSync(require.resolve('ajv/package.json'), 'utf8'));
const descriptor = Object.freeze({ contract: 'native-engine-identity/1', node: process.version, platform: process.platform,
  architecture: process.arch, validator: `ajv@${ajv.version}`, files: Object.freeze(files) });
export const engineHash = createHash('sha256').update(JSON.stringify(descriptor)).digest('hex');
export function engineIdentity() {
  return { hash: engineHash, ...structuredClone(descriptor), scope: 'Native engine source/schema and execution platform/validator version; not remote capability or model attestation' };
}
