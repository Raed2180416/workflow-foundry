import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { OpenCodeV2FreeProvider } from '../../workflow-foundry/src/opencode-v2-free.mjs';

const root = new URL('opencode-v2/native-client-postfix-prime/', import.meta.url);
mkdirSync(root, { recursive: false });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const input = {
  at: new Date().toISOString(), model: 'opencode/big-pickle', timeoutMs: 90000, maxOutputTokens: 64,
  prompt: 'Return exactly this JSON object and nothing else: {"probe":"native-client"}',
  sourceSha256: sha(readFileSync(new URL('../../workflow-foundry/src/opencode-v2-free.mjs', import.meta.url))),
  purpose: 'One legitimate installed-OpenCode invocation after restoring its genuinely emitted native client headers through the fixed bridge. No forged identity, alternate account, credential, retry, or other access workaround.',
  previousPublicRequests: 1, previousCompletions: 0,
};
writeFileSync(new URL('PRECOMMIT.json', root), JSON.stringify(input, null, 2), { flag: 'wx' });
let outcome;
try {
  const provider = new OpenCodeV2FreeProvider({ model: input.model, timeoutMs: input.timeoutMs, maxOutputTokens: input.maxOutputTokens });
  const response = await provider.generate({ prompt: input.prompt, directory: fileURLToPath(root) });
  const value = JSON.parse(response.text);
  if (JSON.stringify(value) !== '{"probe":"native-client"}') throw new Error('Unexpected probe response');
  outcome = { success: true, input, response };
} catch (error) {
  outcome = { success: false, input, error: { code: error.code ?? 'PROBE_FAILED', name: error.name, message: error.message, receipts: error.receipts ?? null } };
}
outcome.finishedAt = new Date().toISOString();
writeFileSync(new URL('RESULTS.json', root), JSON.stringify(outcome, null, 2), { flag: 'wx' });
console.log(JSON.stringify(outcome, null, 2));
if (!outcome.success) process.exitCode = 1;
