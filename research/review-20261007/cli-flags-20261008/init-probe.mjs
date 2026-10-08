// What does each flag change in what the CLI builds? One trivial Haiku 5.5 call per variant through the policy's own invocation, with the
// output switched to stream-json so the `system/init` event is visible. Records the init facts and the usage; nothing else is kept (the
// event stream carries session ids and local paths). 4 calls, about $0.001. The prompt text itself was not inspected.
//   node research/review-20261007/cli-flags-20261008/init-probe.mjs [outfile.json]
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPolicy } from '../../../src/models/policy.mjs';
import { ClaudeCliProvider, claudeChildEnv } from '../../../src/models/providers/claude-cli.mjs';

const out = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'init-probe.json');
const { policy } = loadPolicy();
const entry = policy.models.find(m => m.id === 'claude-haiku-5-5'), provider = new ClaudeCliProvider({ policy, maxBudgetUsd: 0.02 });
const schema = { type: 'object', additionalProperties: false, required: ['n'], properties: { n: { type: 'number' } } };
const NE = 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', CACHE = 'FORCE_PROMPT_CACHING_5M';
const variants = { off: { [NE]: null, [CACHE]: null }, nonessentialOnly: { [NE]: '1', [CACHE]: null }, cacheOnly: { [NE]: null, [CACHE]: '1' }, on: { [NE]: '1', [CACHE]: '1' } };
const rows = [];
for (const [variant, childEnv] of Object.entries(variants)) {
  const args = provider.args({ modelEntry: entry, system: `Return JSON only. nonce-${variant}`, schema, decoding: { reasoning: 'none' } }).map(a => a === 'json' ? 'stream-json' : a).concat(['--verbose']);
  const cwd = mkdtempSync(path.join(tmpdir(), 'foundry-claude-'));
  const r = spawnSync(provider.binary, args, { cwd, env: claudeChildEnv(process.env, childEnv, 0), input: 'Return n = 7.', encoding: 'utf8', timeout: 60000 });
  rmSync(cwd, { recursive: true, force: true });
  const events = r.stdout.trim().split('\n').map(l => JSON.parse(l));
  const init = events.find(e => e.type === 'system' && e.subtype === 'init'), res = events.find(e => e.type === 'result');
  rows.push({ variant, childEnv, plugins: init.plugins.map(p => p.name), tools: init.tools, agents: init.agents, hasScratchpadPath: 'scratchpad_path' in init, hasUiInvalidateEvent: events.some(e => e.subtype === 'ui_invalidate'),
    cacheWriteTokens: res.usage.cache_creation_input_tokens, cacheReadTokens: res.usage.cache_read_input_tokens, outputTokens: res.usage.output_tokens, costUsd: res.total_cost_usd, answer: res.structured_output });
  console.log(JSON.stringify(rows.at(-1)));
}
writeFileSync(out, JSON.stringify({ probedAt: new Date().toISOString(), rows }, null, 2) + '\n');
