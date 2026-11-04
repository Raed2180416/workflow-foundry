// FH-1 review finding M6 ($0, post hoc): what did the frontier-written verifier cost? The 13 capability contracts
// (experiments/compose/capabilities.mjs, 741 lines) were written once, during COMP-1, by one Opus 5.5 (effort xhigh) subagent
// that built the whole composition harness (runtime, builder kit, reference, faults, drift, docs) in one session. Its transcript
// (Claude Code JSONL, outside the repo) records per-call usage. This reads it and bounds the contracts' share at list price.
//   node experiments/fh/architect-cost.mjs <transcript.jsonl> [--file experiments/compose/capabilities.mjs] [--out <json>]
// Caveats, stated in the output: the transcript repeats one usage block per content block of a call (deduplicated here by message
// id); its output_tokens field is the stream-start value (single digits), so output is estimated from the characters the agent
// wrote (3.5 characters per token) and thinking tokens are not counted at all; cache pricing is assumed (read 0.1x input, write
// 1.25x input, the 5-minute rate; the 1-hour rate is 2x).
import path from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PRICE = Object.freeze({ inputPerMTok: 4, outputPerMTok: 20, cacheReadMult: 0.1, cacheWriteMult: 1.25, cacheWrite1hMult: 2, charsPerToken: 3.5,
  source: 'policy/models.json claude-opus-5-5 price (R05 S38): $4 in / $20 out per MTok; cache multipliers assumed' });

/** Per-call usage (deduplicated by message id) and the tool writes of a transcript. Pure on the JSONL text. */
export function readTranscript(text) {
  const calls = new Map(), order = [], writes = [];
  for (const line of text.split('\n')) {
    let d; try { d = JSON.parse(line); } catch { continue; }
    const m = d?.message;
    if (!m || m.role !== 'assistant' || m.model === '<synthetic>') continue;
    if (!calls.has(m.id)) { calls.set(m.id, { usage: {}, at: d.timestamp ?? null, model: m.model }); order.push(m.id); }
    const c = calls.get(m.id);
    for (const [k, v] of Object.entries(m.usage ?? {})) if (typeof v === 'number') c.usage[k] = Math.max(c.usage[k] ?? 0, v);
    for (const x of m.content ?? []) if (x?.type === 'tool_use' && ['Write', 'Edit', 'MultiEdit'].includes(x.name)) {
      const inp = x.input ?? {};
      const chars = x.name === 'Write' ? String(inp.content ?? '').length : x.name === 'Edit' ? String(inp.new_string ?? '').length : (inp.edits ?? []).reduce((s, e) => s + String(e.new_string ?? '').length, 0);
      writes.push({ id: m.id, file: String(inp.file_path ?? ''), chars });
    }
  }
  return { calls: order.map(id => ({ id, ...calls.get(id) })), writes };
}

export function cost({ calls, writes }, { file, price = PRICE } = {}) {
  const sum = list => list.reduce((s, c) => { for (const [k, v] of Object.entries(c.usage)) s[k] = (s[k] ?? 0) + v; return s; }, {});
  const usd = (u, outChars, mult = price.cacheWriteMult) => ((u.input_tokens ?? 0) * price.inputPerMTok + (u.cache_read_input_tokens ?? 0) * price.inputPerMTok * price.cacheReadMult
    + (u.cache_creation_input_tokens ?? 0) * price.inputPerMTok * mult + (outChars / price.charsPerToken) * price.outputPerMTok) / 1e6;
  const all = sum(calls), allChars = writes.reduce((s, w) => s + w.chars, 0);
  const mine = writes.filter(w => w.file.endsWith(file));
  const fileChars = mine.reduce((s, w) => s + w.chars, 0);
  const firstIdx = mine.length ? calls.findIndex(c => c.id === mine[0].id) : -1;
  const upTo = firstIdx >= 0 ? sum(calls.slice(0, firstIdx + 1)) : null;
  const total = usd(all, allChars), total1h = usd(all, allChars, price.cacheWrite1hMult);
  return {
    calls: calls.length, models: [...new Set(calls.map(c => c.model))], from: calls[0]?.at ?? null, to: calls.at(-1)?.at ?? null, usage: all,
    writtenChars: allChars, fileWrites: mine.length, fileChars, fileShareOfWrittenChars: allChars ? fileChars / allChars : null,
    usd: {
      wholeSession: round(total), wholeSession1hCache: round(total1h),
      lowerBound: upTo ? round(usd(upTo, fileChars)) : null, lowerBoundNote: 'every call up to and including the first write of the file (reading SPEC-E, the bed and the oracle views), plus the file\'s own output tokens; later validation and tests not counted',
      allocated: round(total * (allChars ? fileChars / allChars : 0)), allocatedNote: 'the whole session times the file\'s share of all characters the session wrote',
      upperBound: round(total1h), upperBoundNote: 'the whole session (it also built the runtime, builder kit, reference, faults, drift and the COMP-1 docs), 1-hour cache-write rate; thinking tokens still uncounted',
    },
    price,
  };
}
const round = x => Math.round(x * 100) / 100;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const file = arg('--file', 'experiments/compose/capabilities.mjs');
  const t = readTranscript(readFileSync(process.argv[2], 'utf8'));
  const res = { transcript: path.basename(process.argv[2]), file, at: new Date().toISOString(), ...cost(t, { file }) };
  const out = arg('--out', null);
  if (out) writeFileSync(out, JSON.stringify(res, null, 1) + '\n');
  console.log(JSON.stringify(res, null, 1));
}
