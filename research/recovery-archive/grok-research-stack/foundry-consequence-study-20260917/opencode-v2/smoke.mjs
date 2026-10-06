import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { OpenCodeV2FreeProvider } from '/home/raed/Projects/workflow-foundry/src/opencode-v2-free.mjs';
const base = path.dirname(new URL(import.meta.url).pathname);
// A completed or attempted network inference consumes the single authorized probe.
for (const entry of readdirSync(base).filter(name => name.startsWith('tiny-probe-'))) {
  const dir = path.join(base, entry);
  for (const child of readdirSync(dir).filter(name => name.startsWith('opencode-v2-'))) {
    const transport = JSON.parse(readFileSync(path.join(dir, child, 'transport.json'), 'utf8'));
    if (transport.forwarded > 0) throw new Error('The one authorized live inference probe has already been consumed');
  }
}
const directory = path.join(base, `tiny-probe-${randomUUID()}`); mkdirSync(directory, { mode: 0o700 });
const prompt = 'Return exactly this JSON object and nothing else: {"ok":true}';
try {
  const provider = new OpenCodeV2FreeProvider({ model: 'opencode/big-pickle', timeoutMs: 90000, maxOutputTokens: 512 });
  const response = await provider.generate({ prompt, directory });
  const answer = JSON.parse(response.text);
  if (JSON.stringify(answer) !== '{"ok":true}') throw new Error('Tiny synthetic JSON response differed');
  const result = { status: 'PASS', directory, text: response.text, evidence: response.evidence };
  writeFileSync(path.join(directory, 'RESULT.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify(result));
} catch (error) {
  const result = { status: 'FAIL', directory, code: error.code, message: error.message, receipts: error.receipts };
  writeFileSync(path.join(directory, 'RESULT.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify(result)); process.exitCode = 1;
}
