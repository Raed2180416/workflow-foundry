// Measure the agent cost of building and verifying R-bench item harnesses from Claude Code subagent transcripts.
// Usage: node research/replicate-20261008/harness-cost.mjs <workflow-subagent-dir> [--json out.json]
// The directory holds agent-*.jsonl transcripts plus agent-*.meta.json ({description: "harness:<item>" | "verify:<item>" | ...}).
//
// What is measured and what is not:
// - Input-side tokens (uncached input, cache writes, cache reads) come from each assistant message's usage block, one per
//   message id. They are complete.
// - Output tokens are NOT usable from the transcripts: the recorded usage is a streaming snapshot (a few hundred tokens for a
//   45-minute build). Output is therefore estimated from the visible assistant content (text + tool-call inputs) at 3.5
//   characters per token. Hidden reasoning is not in the transcript, so output and dollars are LOWER BOUNDS.
// - Dollars are list-price yardsticks (this project runs on a subscription; the weekly allowance is the binding limit).
//   Prices: policy/models.json (Sonnet 5.5 $2/$10, Opus 5.5 $4/$20 per MTok); cache reads $0.20/MTok for both and cache
//   writes 1.25x input (claude-api skill model table, cached 2026-10-06).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PRICE = {
  'claude-sonnet-5-5': { in: 2, cacheWrite: 2.5, cacheRead: 0.2, out: 10 },
  'claude-opus-5-5': { in: 4, cacheWrite: 5, cacheRead: 0.2, out: 20 },
  'claude-haiku-5-5': { in: 0.1, cacheWrite: 0.125, cacheRead: 0.01, out: 0.5 },
};
const CHARS_PER_TOKEN = 3.5;

export function measureAgent(jsonlPath) {
  const usage = new Map();
  let first = Infinity, last = -Infinity, visibleChars = 0, toolUses = 0;
  const models = new Set();
  for (const line of readFileSync(jsonlPath, 'utf8').split('\n')) {
    if (!line) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.timestamp) { const t = Date.parse(o.timestamp); if (t < first) first = t; if (t > last) last = t; }
    const m = o.message;
    if (o.type !== 'assistant' || !m) continue;
    if (m.model) models.add(m.model);
    if (m.usage) usage.set(m.id ?? o.uuid, m.usage);
    for (const c of m.content ?? []) {
      if (c.type === 'text') visibleChars += c.text.length;
      else if (c.type === 'tool_use') { visibleChars += JSON.stringify(c.input).length; toolUses++; }
    }
  }
  let input = 0, cacheWrite = 0, cacheRead = 0;
  for (const u of usage.values()) { input += u.input_tokens ?? 0; cacheWrite += u.cache_creation_input_tokens ?? 0; cacheRead += u.cache_read_input_tokens ?? 0; }
  const model = [...models][0] ?? null;
  const outputLowerBound = Math.round(visibleChars / CHARS_PER_TOKEN);
  const p = PRICE[model];
  const usdInput = p ? (input * p.in + cacheWrite * p.cacheWrite + cacheRead * p.cacheRead) / 1e6 : null;
  const usdOutputLowerBound = p ? outputLowerBound * p.out / 1e6 : null;
  return {
    model, wallMinutes: +((last - first) / 60000).toFixed(1), start: new Date(first).toISOString(), end: new Date(last).toISOString(),
    modelCalls: usage.size, toolUses, inputTokens: input, cacheWriteTokens: cacheWrite, cacheReadTokens: cacheRead, outputTokensLowerBound: outputLowerBound,
    usdInput: usdInput == null ? null : +usdInput.toFixed(2), usdOutputLowerBound: usdOutputLowerBound == null ? null : +usdOutputLowerBound.toFixed(2),
    usdLowerBound: usdInput == null ? null : +(usdInput + usdOutputLowerBound).toFixed(2),
  };
}

export function measureDir(dir) {
  const agents = [];
  for (const f of readdirSync(dir).filter(n => n.endsWith('.meta.json')).sort()) {
    const meta = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    const jsonl = path.join(dir, f.replace(/\.meta\.json$/, '.jsonl'));
    try { agents.push({ description: meta.description, phase: meta.workflowPhase, ...measureAgent(jsonl) }); } catch { /* transcript missing */ }
  }
  const items = {};
  for (const a of agents) {
    const m = /^(harness|verify):(.+)$/.exec(a.description ?? '');
    if (!m) continue;
    const it = (items[m[2]] ??= { harness: null, verify: null });
    it[m[1]] = a;
  }
  const perItem = Object.entries(items).map(([id, { harness: h, verify: v }]) => ({
    id,
    buildMinutes: h?.wallMinutes ?? null, verifyMinutes: v?.wallMinutes ?? null,
    agentMinutes: +((h?.wallMinutes ?? 0) + (v?.wallMinutes ?? 0)).toFixed(1),
    inputSideTokensM: +(((h ? h.inputTokens + h.cacheWriteTokens + h.cacheReadTokens : 0) + (v ? v.inputTokens + v.cacheWriteTokens + v.cacheReadTokens : 0)) / 1e6).toFixed(1),
    usdBuildLowerBound: h?.usdLowerBound ?? null, usdVerifyLowerBound: v?.usdLowerBound ?? null,
    usdLowerBound: +((h?.usdLowerBound ?? 0) + (v?.usdLowerBound ?? 0)).toFixed(2),
  }));
  const n = perItem.length || 1;
  const summary = {
    items: perItem.length,
    meanAgentMinutes: +(perItem.reduce((s, r) => s + r.agentMinutes, 0) / n).toFixed(1),
    meanUsdLowerBound: +(perItem.reduce((s, r) => s + r.usdLowerBound, 0) / n).toFixed(2),
    totalAgentMinutes: +perItem.reduce((s, r) => s + r.agentMinutes, 0).toFixed(1),
    totalUsdLowerBound: +perItem.reduce((s, r) => s + r.usdLowerBound, 0).toFixed(2),
  };
  return { agents, perItem, summary };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node harness-cost.mjs <workflow-subagent-dir> [--json out.json]'); process.exit(2); }
  const out = measureDir(dir);
  const j = process.argv.indexOf('--json');
  if (j > 0) writeFileSync(process.argv[j + 1], JSON.stringify({ measuredAt: new Date().toISOString(), source: dir, priceNote: 'list-price lower bounds; see header of harness-cost.mjs', ...out }, null, 1) + '\n');
  console.log(JSON.stringify(out.perItem, null, 1));
  console.log(JSON.stringify(out.summary));
}
