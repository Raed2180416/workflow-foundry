// Host-side step and usage accounting for AutomationBench sessions (experiments/autobench; PREREG-AB-v1 §4 H3, §8 L5).
// Runs AFTER a session, on files the host captured: the CLI's stream-json transcript (written by the executor from the
// stdout it read itself, after the session ended) and the bridge's host-only call log (calls.jsonl). Nothing here is
// visible to, or influenced by, the session while it runs. Used for both arms (A0 and A1).
//
// The official loop (verifiers MultiTurnEnv, max_turns = 50) counts MODEL RESPONSES: a rollout ends after 50 responses
// and the tool calls of response 50 never run, so at most 49 tool-calling responses take effect. Here one model
// response is one API response, i.e. one distinct assistant message id in the stream (stream-json repeats a message
// once per content block, so events are grouped by id). The CLI's own `num_turns` is NOT that count: in CLI 2.1.300 it
// is the number of tool results + 1 (parallel tool calls in one response count several times; measured on the
// raw-Haiku subset60 transcripts, num_turns - responses ranged -1..3). It is reported beside the exact count.
import { readFileSync, existsSync } from 'node:fs';

export const MUTATING = Object.freeze(['POST', 'PUT', 'PATCH', 'DELETE']);
/** A Bash command that may reach the world (the official tools are only reachable through the client): any use of the
 * client other than `list`. Deliberately broad; used only as conservative evidence. */
export const WORLD_COMMAND = /tool\.mjs(?!\s+list\b)/;

export const parseStream = text => String(text ?? '').split('\n').filter(Boolean)
  .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(e => e && typeof e === 'object');
export const readStream = file => (existsSync(file) ? parseStream(readFileSync(file, 'utf8')) : []);
export const readCalls = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

/** The session's model responses in order: [{ index (1-based), id, toolUseIds, commands, text }]. An assistant event
 * without a message id counts as its own response (never merged). Sub-agent messages would count too (they are model
 * calls); with the Bash-only tool set there are none. */
export function sessionResponses(events) {
  const order = [], byId = new Map();
  for (const e of events) {
    if (e?.type !== 'assistant' || !e.message) continue;
    const id = typeof e.message.id === 'string' && e.message.id ? e.message.id : `noid-${order.length}`;
    let r = byId.get(id);
    if (!r) { r = { index: order.length + 1, id, toolUseIds: [], commands: [], text: false, subagent: Boolean(e.parent_tool_use_id) }; byId.set(id, r); order.push(r); }
    for (const c of Array.isArray(e.message.content) ? e.message.content : []) {
      if (c?.type === 'tool_use' && !r.toolUseIds.includes(c.id)) { r.toolUseIds.push(c.id); r.commands.push({ name: c.name, command: c.name === 'Bash' ? String(c.input?.command ?? '') : null }); }
      else if (c?.type === 'text' && String(c.text ?? '').trim()) r.text = true;
    }
  }
  return order;
}

/** Tool results with their wall-clock time, sorted: [{ ms, response }] (response = index of the issuing response). */
function toolResultTimes(events, responses) {
  const owner = new Map(responses.flatMap(r => r.toolUseIds.map(t => [t, r.index])));
  const out = [];
  for (const e of events) {
    if (e?.type !== 'user' || !Array.isArray(e.message?.content)) continue;
    const ms = Date.parse(e.timestamp);
    if (!Number.isFinite(ms)) continue;
    for (const c of e.message.content) if (c?.type === 'tool_result' && owner.has(c.tool_use_id)) out.push({ ms, response: owner.get(c.tool_use_id) });
  }
  return out.sort((a, b) => a.ms - b.ms);
}

/**
 * auditSession({ events, calls, maxSteps, fallbackTurns }) -> the session's step accounting and cap violations.
 * World step -> response: a bridge step completes (calls.jsonl `t`) before the command that issued it returns, and
 * after the previous response's tool results were recorded (the next model call needs them), so the issuing response
 * is the owner of the first tool result recorded at or after the step's time. A step with no later tool result (the
 * session was cut while a command ran) is attributed to the last response.
 * Violations (H3, applied host-side): more than maxSteps model responses, or a world step issued by response >= maxSteps
 * (the official loop never runs the calls of response maxSteps). Without a transcript the runner-reported turn count is
 * the only evidence and the mapping is 'none'.
 */
export function auditSession({ events = [], calls = [], maxSteps = 50, fallbackTurns = null } = {}) {
  const responses = sessionResponses(events);
  const results = events.filter(e => e?.type === 'result');
  const last = results.at(-1) ?? null;
  const numTurns = typeof last?.num_turns === 'number' ? last.num_turns : null;
  const toolResponses = responses.filter(r => r.toolUseIds.length).length;
  const modelResponses = responses.length || numTurns || fallbackTurns || 0;
  const times = toolResultTimes(events, responses);
  const mapping = responses.length && times.length ? 'timestamps' : 'none';
  const stepResponse = calls.map(s => {
    if (mapping === 'none' || typeof s.t !== 'number') return null;
    const ms = s.t * 1000;
    const hit = times.find(x => x.ms >= ms);
    return hit ? hit.response : responses.at(-1).index;
  });
  const worldCommandResponses = responses.filter(r => r.commands.some(c => c.command !== null && WORLD_COMMAND.test(c.command))).map(r => r.index);
  const violations = [];
  if (modelResponses > maxSteps) violations.push(`model responses ${modelResponses} > ${maxSteps}`);
  const late = stepResponse.filter(i => i !== null && i >= maxSteps).length;
  if (late) violations.push(`${late} world step(s) issued by response >= ${maxSteps}`);
  // Without a timestamp mapping, a world command in a response >= maxSteps is the conservative evidence.
  if (mapping === 'none' && worldCommandResponses.some(i => i >= maxSteps)) violations.push(`world command in response >= ${maxSteps}`);
  return {
    modelResponses, toolResponses, textOnlyResponses: responses.filter(r => !r.toolUseIds.length).length,
    numTurns, resultEvents: results.length, resultSubtype: last?.subtype ?? null, stopReason: last?.subtype === 'error_max_turns' ? 'max_turns' : null,
    sessionToolUses: responses.reduce((s, r) => s + r.toolUseIds.length, 0),
    parallelToolResponses: responses.filter(r => r.toolUseIds.length > 1).length,
    subagentResponses: responses.filter(r => r.subagent).length,
    worldCommandResponses: worldCommandResponses.length, mapping,
    maxWorldResponse: stepResponse.reduce((m, i) => (i !== null && i > m ? i : m), 0) || null,
    unmappedWorldSteps: stepResponse.filter(i => i === null).length,
    // The harness makes no model call outside the session; anything it ever adds is counted here and in the cap.
    extraModelCalls: 0,
    violations,
  };
}

/** World usage from the bridge's call log: steps, calls, reads (non-mutating api_fetch), searches, writes (api_fetch
 * with a mutating method; some APIs read with POST, so this is "mutating-method calls"), helpers, invalid calls. */
export function worldUsage(calls = []) {
  const u = { worldSteps: calls.length, worldCalls: 0, reads: 0, searches: 0, writes: 0, helpers: 0, invalid: 0 };
  for (const step of calls) {
    for (const c of step.calls ?? []) {
      u.worldCalls += 1;
      if (c.name === 'api_fetch') {
        let a = null;
        try { a = JSON.parse(c.arguments); } catch {}
        if (!a || typeof a !== 'object') { u.invalid += 1; continue; }
        if (MUTATING.includes(String(a.method ?? 'GET').toUpperCase())) u.writes += 1; else u.reads += 1;
      } else if (c.name === 'api_search') u.searches += 1;
      else if (c.name === 'base64_encode') u.helpers += 1;
      else u.invalid += 1;
    }
  }
  return u;
}
