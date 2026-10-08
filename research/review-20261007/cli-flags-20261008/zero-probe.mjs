// Review probe (2026-10-08): does the value "0" really switch a childEnv flag OFF, as policy/models.json says ("or "0" to switch it
// off")? Some CLIs treat any non-empty value as set. One trivial Haiku 5.5 call per variant through the policy's own invocation,
// stream-json output so the `system/init` event is visible; the same facts as init-probe.mjs are kept (nothing else: the event stream
// carries session ids and local paths). Readout: the builtin telemetry plugin is loaded only when CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
// is off (init-probe.json), and a cold cache write is priced at 2x the input price (1-hour tier) unless FORCE_PROMPT_CACHING_5M is on
// (1.25x). 3 calls (absent = control, "0", "1"), about $0.0007. Development/diagnostic evidence.
//   node research/review-20261007/cli-flags-20261008/zero-probe.mjs [outfile.json]
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPolicy } from '../../../src/models/policy.mjs';
import { ClaudeCliProvider, claudeChildEnv } from '../../../src/models/providers/claude-cli.mjs';

const out = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'zero-probe.json');
const { policy } = loadPolicy();
const entry = policy.models.find(m => m.id === 'claude-haiku-5-5'), provider = new ClaudeCliProvider({ policy, maxBudgetUsd: 0.02 });
const schema = { type: 'object', additionalProperties: false, required: ['n'], properties: { n: { type: 'number' } } };
const NE = 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', CACHE = 'FORCE_PROMPT_CACHING_5M';
const variants = { absent: { [NE]: null, [CACHE]: null }, zero: { [NE]: '0', [CACHE]: '0' }, one: { [NE]: '1', [CACHE]: '1' } };
const { inputPerMTok, outputPerMTok } = entry.price;
const rows = [];
for (const [variant, childEnv] of Object.entries(variants)) {
  const nonce = `${variant}-${process.hrtime.bigint()}`;
  const args = provider.args({ modelEntry: entry, system: `Return JSON only. nonce-${nonce}`, schema, decoding: { reasoning: 'none' } }).map(a => a === 'json' ? 'stream-json' : a).concat(['--verbose']);
  const cwd = mkdtempSync(path.join(tmpdir(), 'foundry-claude-'));
  const r = spawnSync(provider.binary, args, { cwd, env: claudeChildEnv(process.env, childEnv, 0), input: 'Return n = 7.', encoding: 'utf8', timeout: 60000 });
  rmSync(cwd, { recursive: true, force: true });
  const events = r.stdout.trim().split('\n').map(l => JSON.parse(l));
  const init = events.find(e => e.type === 'system' && e.subtype === 'init'), res = events.find(e => e.type === 'result');
  const u = res.usage, base = (u.input_tokens * inputPerMTok + u.cache_read_input_tokens * 0.1 * inputPerMTok + u.output_tokens * outputPerMTok) / 1e6;
  // The cache-write multiplier the reported cost implies (2 = 1-hour tier, 1.25 = 5-minute tier).
  const writeMultiplier = u.cache_creation_input_tokens ? +((res.total_cost_usd - base) / (u.cache_creation_input_tokens * inputPerMTok / 1e6)).toFixed(3) : null;
  rows.push({ variant, childEnv, plugins: init.plugins.map(p => p.name), telemetryPluginLoaded: init.plugins.some(p => p.name === 'cc-plugin-telemetry'),
    cacheWriteTokens: u.cache_creation_input_tokens, cacheReadTokens: u.cache_read_input_tokens, outputTokens: u.output_tokens, costUsd: res.total_cost_usd, writeMultiplier, answer: res.structured_output });
  console.log(JSON.stringify(rows.at(-1)));
}
writeFileSync(out, JSON.stringify({ probedAt: new Date().toISOString(), engine: (await provider.engineVersion()), rows }, null, 2) + '\n');
