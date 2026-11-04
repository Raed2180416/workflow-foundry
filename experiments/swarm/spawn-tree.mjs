// Spawn tree of one Claude Code session (swarm ladder, research/swarm-20261021): which workers the lead started with
// the Agent tool, in which lead turn (batch), with which brief, what each returned, what each read, and on which models.
// Input: the parsed stream-json events of runClaudeCode's transcript (.executor-transcript.jsonl), ideally recorded with
// --forward-subagent-text so worker turns carry parent_tool_use_id. Nothing here calls a model.
//
// Output:
//   workers: [{ id, batch, description, subagentType, brief, background, result, isError, resultMeta, events, turns,
//               reads: [paths a worker's Read/Grep/Glob/Bash named], models: {model: messages}, usage, durationMs }]
//   batches: [{ index, leadMessageId, workers: [ids] }]   one per lead assistant message that started >= 1 worker
//   lead: { turns, toolUses: {name: n}, reads }           the lead's own work (parent_tool_use_id null)
//   models: {model: assistant messages}                   over the whole session (lead + workers)
//   maxConcurrent: the largest batch; criticalSteps: Kimi's metric, lead turns + per batch the slowest worker's turns
export const SPAWN_TOOLS = Object.freeze(['Agent', 'Task']);

const textOf = content => (typeof content === 'string' ? content : Array.isArray(content)
  ? content.map(c => (typeof c === 'string' ? c : c?.type === 'text' ? c.text : '')).join('') : '');

// Paths a tool use names (file tools' arguments and the words of a Bash command that look like corpus paths).
export function pathsOf(use) {
  const i = use?.input ?? {};
  const out = [];
  for (const k of ['file_path', 'path', 'pattern']) if (typeof i[k] === 'string' && (k !== 'pattern' || use.name === 'Glob')) out.push(i[k]);
  if (use?.name === 'Bash' && typeof i.command === 'string') for (const m of i.command.matchAll(/[\w./-]*D\d{3}\.txt|files\/corpus\/[\w.*/-]*/g)) out.push(m[0]);
  return out;
}

/** Paths a tool use writes: Write/Edit/NotebookEdit targets and, best effort, a Bash command's redirection and tee targets. */
export function writesOf(use) {
  const i = use?.input ?? {};
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(use?.name)) return [i.file_path ?? i.notebook_path].filter(x => typeof x === 'string');
  if (use?.name !== 'Bash' || typeof i.command !== 'string') return [];
  const out = [], clean = s => s.replace(/^['"]|['"]$/g, '');
  for (const m of i.command.matchAll(/(?:^|[^0-9&<>])>{1,2}\s*([^\s;&|<>()]+)/g)) if (!/^&|^\/dev\//.test(m[1])) out.push(clean(m[1]));
  for (const m of i.command.matchAll(/\btee\s+(?:-a\s+)?([^\s;&|<>()]+)/g)) out.push(clean(m[1]));
  return out;
}

/** Corpus document ids (D001 …) a list of paths names explicitly (a glob or directory names none). */
export const docIdsOf = paths => [...new Set(paths.flatMap(p => [...String(p).matchAll(/\bD(\d{3})\.txt\b/g)].map(m => `D${m[1]}`)))].sort();

export function parseSpawnTree(events = []) {
  const workers = new Map(), batches = [], leadToolUses = {}, leadReads = [], leadWrites = [], models = {};
  const leadMessages = new Set();
  const order = [];
  for (const e of events) {
    if (e?.type === 'assistant' && e.message) {
      const parent = e.parent_tool_use_id ?? null;
      const model = e.message.model ?? null;
      const mid = e.message.id ?? null;
      if (parent === null) {
        if (mid && !leadMessages.has(mid)) { leadMessages.add(mid); if (model) models[model] = (models[model] ?? 0) + 1; }
        for (const c of e.message.content ?? []) {
          if (c?.type !== 'tool_use') continue;
          leadToolUses[c.name] = (leadToolUses[c.name] ?? 0) + 1;
          if (SPAWN_TOOLS.includes(c.name)) {
            let b = batches.find(x => x.leadMessageId === mid && mid !== null);
            if (!b) { b = { index: batches.length, leadMessageId: mid, workers: [] }; batches.push(b); }
            b.workers.push(c.id);
            workers.set(c.id, { id: c.id, batch: b.index, description: c.input?.description ?? null, subagentType: c.input?.subagent_type ?? null,
              brief: String(c.input?.prompt ?? ''), background: !!c.input?.run_in_background, result: null, isError: null, resultMeta: null,
              events: 0, turns: 0, msgIds: new Set(), reads: [], writes: [], models: {}, usage: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }, durationMs: null, startMs: null, endMs: null,
              report: null, usageByMsg: new Map() });
            order.push(c.id);
          } else { leadReads.push(...pathsOf(c)); leadWrites.push(...writesOf(c)); }
        }
      } else {
        const w = workers.get(parent);
        if (!w) continue;
        w.events += 1;
        if (mid && !w.msgIds.has(mid)) { w.msgIds.add(mid); w.turns += 1; if (model) { w.models[model] = (w.models[model] ?? 0) + 1; models[model] = (models[model] ?? 0) + 1; } }
        if (mid && e.message.usage) w.usageByMsg.set(mid, e.message.usage);
        for (const c of e.message.content ?? []) if (c?.type === 'tool_use') { w.reads.push(...pathsOf(c)); w.writes.push(...writesOf(c)); }
      }
    } else if (e?.type === 'user' && e.message) {
      const parent = e.parent_tool_use_id ?? null;
      if (parent !== null) { const w = workers.get(parent); if (w) w.events += 1; continue; }
      for (const c of Array.isArray(e.message.content) ? e.message.content : []) {
        if (c?.type !== 'tool_result') continue;
        const w = workers.get(c.tool_use_id);
        if (!w) continue;
        w.result = textOf(c.content);
        w.isError = !!c.is_error;
        w.report = reportOf(w.result);
        const meta = e.tool_use_result && typeof e.tool_use_result === 'object' ? e.tool_use_result : null;
        if (meta) {
          w.resultMeta = { status: meta.status ?? null, totalDurationMs: meta.totalDurationMs ?? null, totalTokens: meta.totalTokens ?? null, totalToolUseCount: meta.totalToolUseCount ?? null,
            agentId: meta.agentId ?? null, resolvedModel: meta.resolvedModel ?? null, toolStats: meta.toolStats ?? null };
          if (Number.isFinite(meta.totalDurationMs)) w.durationMs = meta.totalDurationMs;
          if (meta.resolvedModel) w.models[meta.resolvedModel] ??= 0;
        }
        const end = Date.parse(e.timestamp ?? '');
        if (Number.isFinite(end)) { w.endMs = end; if (Number.isFinite(w.durationMs)) w.startMs = end - w.durationMs; }
      }
    }
  }
  const list = order.map(id => {
    const w = workers.get(id);
    for (const u of w.usageByMsg.values()) { w.usage.in += u.input_tokens ?? 0; w.usage.out += u.output_tokens ?? 0; w.usage.cacheRead += u.cache_read_input_tokens ?? 0; w.usage.cacheWrite += u.cache_creation_input_tokens ?? 0; }
    const { msgIds, usageByMsg, ...rest } = w;
    return { ...rest, reads: [...new Set(rest.reads)], writes: [...new Set(rest.writes)], docsRead: docIdsOf(rest.reads) };
  });
  const turnsOf = id => list.find(w => w.id === id)?.turns ?? 0;
  const criticalSteps = leadMessages.size + batches.reduce((s, b) => s + Math.max(0, ...b.workers.map(turnsOf)), 0);
  const result = [...events].reverse().find(e => e?.type === 'result') ?? null;
  const timed = list.filter(w => Number.isFinite(w.startMs) && Number.isFinite(w.endMs));
  return { workers: list, batches: batches.map(b => ({ ...b, size: b.workers.length })), lead: { turns: leadMessages.size, toolUses: leadToolUses, reads: [...new Set(leadReads)], writes: [...new Set(leadWrites)], docsRead: docIdsOf(leadReads) },
    models, maxConcurrent: Math.max(0, ...batches.map(b => b.workers.length)), criticalSteps,
    timing: { workerMsSum: timed.reduce((s, w) => s + w.durationMs, 0), workerMsUnion: unionMs(timed.map(w => [w.startMs, w.endMs])), overlapMax: maxOverlap(timed.map(w => [w.startMs, w.endMs])),
      slowestWorkerMs: Math.max(0, ...timed.map(w => w.durationMs)), sessionMs: result?.duration_ms ?? null },
    stats: result?.subagent_stats ?? null };
}

// The subagent's own report inside the harness hand-back frame ("... The report follows:\n  <indented report>\nagentId: …"),
// de-indented; the raw text when there is no frame.
export function reportOf(text) {
  if (typeof text !== 'string') return null;
  const i = text.indexOf('The report follows:\n');
  if (i < 0) return text;
  let body = text.slice(i + 'The report follows:\n'.length);
  const j = body.search(/\nagentId: [\w-]+/);
  if (j >= 0) body = body.slice(0, j);
  return body.split('\n').map(l => (l.startsWith('  ') ? l.slice(2) : l)).join('\n').trim();
}
/** Total length of the union of [start, end] intervals (ms). */
export function unionMs(intervals) {
  const xs = intervals.filter(([a, b]) => b >= a).sort((p, q) => p[0] - q[0]);
  let total = 0, cur = null;
  for (const [a, b] of xs) { if (!cur || a > cur[1]) { if (cur) total += cur[1] - cur[0]; cur = [a, b]; } else cur[1] = Math.max(cur[1], b); }
  return cur ? total + cur[1] - cur[0] : 0;
}
/** The largest number of intervals open at one instant. */
export function maxOverlap(intervals) {
  const pts = intervals.flatMap(([a, b]) => [[a, 1], [b, -1]]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  let open = 0, best = 0;
  for (const [, d] of pts) { open += d; best = Math.max(best, open); }
  return best;
}

/** Read a transcript file's events (bad lines skipped). */
export function readEvents(text) {
  return String(text ?? '').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
