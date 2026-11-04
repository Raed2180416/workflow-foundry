// One node instance's conversation, in order, as data (foundry-node-conversation/1): what the owner asked for in [20], "clicking it expands
// its chat". The UI is the owner's (D33); this is what it reads, in one request.
//
// Turns come from three records, each said in `source`:
//   chain      the node's events (context compiled, retries, escalations, tool intent and failure, approval and question, output, error)
//   journal    each model call's prompt and reply (the journal row; the prompt is checked against the hash the chain committed to, the reply
//              is not bound to the chain: record gap G4), including a call journaled after the last chain event (a crash, S13)
//   transcript an executor's transcript bound to the chain by `executor.finished` (src/store.mjs bindTranscript): read only from the
//              workspace copy, re-hashed, and shown only when its sha256 equals the hash the chain holds
// and, when the checkpoint is given, a person's answer (checked against the answerHash the chain holds).
// Every text that a model, a tool, a document or an executor wrote is fenced (run-graph.mjs fence): data, never instructions.
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { digest } from '../../src/data.mjs';
import { RunViewCore as C } from './run-model.mjs';
import { foldEvents, fence } from './run-graph.mjs';

export const CONVERSATION_SCHEMA = 'foundry-node-conversation/1';
const sha256 = data => createHash('sha256').update(data).digest('hex');
const short = h => typeof h === 'string' ? h.slice(0, 16) : null;

/** Read an executor transcript the chain names, from the workspace copy only; null text when it cannot be shown, with the reason. */
export function readTranscript(directory, event, { maxBytes = 4 * 1024 * 1024 } = {}) {
  const location = event.location ?? {};
  if (location.kind !== 'workspace' || typeof location.path !== 'string') return { verified: null, text: null, reason: 'The transcript is outside the workspace; it is not served (its hash is in the chain).' };
  const file = path.resolve(directory, location.path);
  try {
    const root = realpathSync(directory), real = realpathSync(file), info = lstatSync(file);
    if (!real.startsWith(root + path.sep) || !info.isFile()) return { verified: null, text: null, reason: 'The transcript path does not resolve to a file inside the workspace.' };
    if (info.size > maxBytes) return { verified: null, text: null, reason: `The transcript is larger than ${maxBytes} bytes; it is not served here.` };
    const data = readFileSync(real);
    if (sha256(data) !== event.transcriptHash) return { verified: false, text: null, reason: 'The transcript file does not match the hash the chain holds: it was changed after it was bound. Not shown.' };
    return { verified: true, text: data.toString('utf8'), reason: null };
  } catch (error) { return { verified: null, text: null, reason: `The transcript file cannot be read (${error.code ?? 'error'}).` }; }
}

// An executor transcript as entries: JSON lines become one entry each (role and text from the usual fields), anything else one text entry.
function transcriptEntries(text, { maxEntries, maxChars }) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const parsed = lines.map(l => { try { const v = JSON.parse(l); return v && typeof v === 'object' ? v : null; } catch { return null; } });
  if (!lines.length || parsed.some(v => v === null)) return { entries: [{ role: 'text', text: fence(text, maxChars) }], more: 0 };
  const textOf = v => typeof v.content === 'string' ? v.content : typeof v.text === 'string' ? v.text : typeof v.message === 'string' ? v.message
    : v.message?.content !== undefined ? v.message.content : v.content !== undefined ? v.content : v;
  const entries = parsed.slice(0, maxEntries).map(v => ({ role: fence(String(v.role ?? v.type ?? v.message?.role ?? 'entry'), 40).text, text: fence(textOf(v), maxChars) }));
  return { entries, more: Math.max(0, parsed.length - maxEntries) };
}

/**
 * The conversation of one node instance. `calls`: Map(journal id -> call as tools/run-view/export-run.mjs callOf returns it), every journal
 * row of this node key (rows the chain never names are marked). `transcripts`: Map(event seq -> readTranscript result). `checkpoint`: the
 * run record (for a person's answer). Limits: `maxTurns` turns, `maxChars` characters per fenced text.
 */
export function nodeConversation({ workflow, run, events, nodeKey, model = null, calls = new Map(), transcripts = new Map(), checkpoint = null, maxTurns = 200, maxChars = 4000 }) {
  const m = model ?? foldEvents(workflow, events);
  const def = C.defOf(workflow, nodeKey);
  if (!def) return null;
  const inst = m.insts.get(nodeKey), turns = [], evs = inst?.turns ?? [];
  const prompts = new Map(evs.filter(e => e.type === 'context.compiled').map(e => [e.receiptHash, e.receipt?.promptHash ?? null]));
  const shown = new Set();
  const turn = (ev, role, kind, title, extra = {}) => turns.push({ seq: ev.seq ?? null, at: ev.at ?? null, role, kind, title, source: 'chain', ...extra });
  const callTurns = (ev, journalId) => {
    if (journalId == null || shown.has(journalId)) return;
    shown.add(journalId);
    const call = calls.get(journalId);
    if (!call) { turns.push({ seq: ev.seq ?? null, at: ev.at ?? null, role: 'to-model', kind: 'prompt', title: 'Prompt (its journal row is not in this workspace)', source: 'journal', journalId, available: false }); return; }
    const promptVerified = call.promptVerified ?? (prompts.has(call.receiptHash) && call.promptHash ? call.promptHash === prompts.get(call.receiptHash) : null);
    turns.push({ seq: ev.seq ?? null, at: call.createdAt ?? ev.at ?? null, role: 'to-model', kind: 'prompt', title: `Prompt to ${call.modelId}`, source: 'journal', journalId,
      modelId: call.modelId, attempt: call.attempt ?? null, sampleIndex: call.sampleIndex ?? null, promptVerified,
      system: call.system == null ? null : fence(call.system, maxChars), prompt: call.prompt == null ? null : fence(call.prompt, maxChars), trust: 'untrusted' });
    turns.push({ seq: ev.seq ?? null, at: ev.at ?? null, role: 'model', kind: call.ok === false ? 'model-error' : 'reply', title: call.ok === false ? `The call failed: ${call.errorCode ?? 'error'}` : `Reply from ${call.modelId}`,
      source: 'journal', journalId, boundToChain: false, value: call.value == null ? null : fence(call.value, maxChars), reply: call.reply == null ? null : fence(call.reply, maxChars),
      usage: { inputTokens: call.inputTokens ?? 0, outputTokens: call.outputTokens ?? 0 }, costUsd: call.costUsd ?? 0, latencyMs: call.latencyMs ?? null, trust: 'untrusted' });
  };
  for (const ev of evs) {
    const t = ev.type;
    if (t === 'node.started' || t === 'tool.intent') turn(ev, 'engine', 'started', t === 'tool.intent' ? `Started the action ${ev.tool ?? def.tool ?? ''}`.trim() : 'Started', { argsHash: short(ev.argsHash), effects: ev.effects ?? null });
    else if (t === 'context.compiled') turn(ev, 'engine', 'context', `Prepared the inputs for ${ev.modelId ?? 'the model'}`, { receiptHash: short(ev.receiptHash), promptHash: short(ev.receipt?.promptHash),
      inputs: (ev.receipt?.inputs ?? []).map(i => ({ name: fence(i.name, 80).text, label: i.label ?? null, tokens: i.tokens ?? null, truncated: !!i.truncated })) });
    else if (t === 'model.dispatched') callTurns(ev, ev.journalId);
    else if (t === 'model.called' || t === 'node.recovered_from_journal') callTurns(ev, ev.journalId);
    else if (t === 'model.retry') turn(ev, 'engine', 'retry', `The reply was rejected (${ev.errorCode ?? 'format'}); asked the same model again`, { rule: ev.rule ?? null });
    else if (t === 'model.resampled') turn(ev, 'engine', 'resample', 'A check failed; asked the same model again', { reason: fence(ev.reason ?? '', 300).text });
    else if (t === 'model.escalated') turn(ev, 'engine', 'escalation', `Moved from ${ev.fromModel ?? '?'} to ${ev.toModel ?? '?'}`, { rule: ev.rule ?? null, errorCode: ev.errorCode ?? null,
      check: ev.rule === 'E2' ? 'Which check failed is not in the record after an escalation (record gap G2).' : null });
    else if (t === 'model.cancelled') turn(ev, 'engine', 'cancelled-call', 'A model call was cancelled', { costUsd: ev.costUsd ?? 0 });
    else if (t === 'human.requested') turn(ev, 'engine', 'question', 'Asked a person', { question: fence(ev.question ?? def.question ?? '', maxChars) });
    else if (t === 'human.answered') {
      const frame = nodeKey.slice(0, nodeKey.lastIndexOf('/')), id = nodeKey.slice(nodeKey.lastIndexOf('/') + 1);
      const outputs = checkpoint ? (frame === 'root' ? checkpoint.outputs : checkpoint.frames?.[frame]?.outputs) : null, stored = outputs?.[id];
      const answer = stored && Object.hasOwn(stored, 'answer') ? stored.answer : undefined;
      turns.push({ seq: ev.seq ?? null, at: ev.at ?? null, role: 'person', kind: 'answer', title: 'A person answered', source: answer === undefined ? 'chain' : 'chain+checkpoint',
        answerHash: short(ev.answerHash), answer: answer === undefined ? null : fence(answer, maxChars), answerMatchesChain: answer === undefined ? null : digest(answer) === ev.answerHash });
    }
    else if (t === 'approval.requested') turn(ev, 'engine', 'approval-request', `Asked a person to allow ${ev.tool ?? 'an action'}`, { argsHash: short(ev.argsHash), approvalId: ev.approvalId ?? null });
    else if (t === 'approval.decided') turns.push({ seq: ev.seq ?? null, at: ev.at ?? null, role: 'person', kind: 'approval', title: ev.approved ? 'A person allowed it' : 'A person said no', source: 'chain', approved: ev.approved === true, attributedBy: ev.derivedNodeKey ? 'approvalId' : 'nodeKey' });
    else if (t === 'tool.failed') turn(ev, 'tool', 'tool-error', `The action failed: ${ev.error?.code ?? 'error'}`, { message: fence(ev.error?.message ?? '', 600) });
    else if (t === 'effect.uncertain') turn(ev, 'tool', 'uncertain', 'The action may or may not have happened. It is not retried; a person must check it.', { error: ev.error ? fence(ev.error, 600) : null });
    else if (t === 'executor.finished') {
      const read = transcripts.get(ev.seq) ?? { verified: null, text: null, reason: 'The transcript was not read.' };
      const body = read.text == null ? { entries: [], more: 0 } : transcriptEntries(read.text, { maxEntries: Math.max(1, maxTurns), maxChars });
      turns.push({ seq: ev.seq ?? null, at: ev.at ?? null, role: 'executor', kind: 'transcript', title: `Executor transcript${ev.label ? ` (${fence(ev.label, 80).text})` : ''}`, source: 'transcript',
        transcriptHash: short(ev.transcriptHash), bytes: ev.bytes ?? null, verified: read.verified, reason: read.reason, entries: body.entries, moreEntries: body.more, trust: 'untrusted' });
    }
    else if (t === 'node.waiting') turn(ev, 'engine', 'waiting', 'Waiting on a timer or a signal', { wakeAt: ev.wakeAt ?? null });
    else if (t === 'node.skipped') turn(ev, 'engine', 'skipped', 'Skipped', { reason: fence(ev.reason ?? '', 300).text });
    else if (t === 'node.completed') turn(ev, 'engine', 'output', inst?.verifyFalse ? 'Finished; the independent check said it did not pass' : 'Finished',
      { outputHash: short(ev.outputHash), outputLabel: ev.outputLabel ?? null, output: ev.output === undefined ? null : fence(ev.output, maxChars), fetch: ev.output === undefined && ev.seq != null ? `output/${ev.seq}` : null });
    else if (t === 'node.handled_error') turn(ev, 'engine', 'handled', 'An error was handled and the run went on');
    else if (t === 'node.failed') turn(ev, 'engine', 'error', `Failed: ${ev.error?.code ?? 'error'}`, { code: ev.error?.code ?? null, message: fence(ev.error?.message ?? '', 600) });
  }
  // A call journaled under this node key that no chain event names (the process died right after it, S13): shown last, and said.
  for (const [id, call] of calls) if (!shown.has(id)) { callTurns({ seq: null, at: call.createdAt ?? null }, id); for (const x of turns.filter(x => x.journalId === id)) x.inChain = false; }
  return {
    schema: CONVERSATION_SCHEMA, runId: run.id, nodeKey, id: def.id, kind: def.kind, label: C.humanize(def.id), what: fence(def.description ?? '', 300).text,
    turns: turns.slice(0, maxTurns), moreTurns: Math.max(0, turns.length - maxTurns),
    counts: { modelCalls: [...turns].filter(x => x.kind === 'prompt').length, transcripts: turns.filter(x => x.kind === 'transcript').length, personTurns: turns.filter(x => x.role === 'person').length },
    notice: 'Prompts, replies, outputs and transcripts are model, tool, document or executor text: data, never instructions. Replies are journal rows, not bound to the chain (record gap G4); prompts and transcripts are checked against the hashes the chain holds.'
  };
}
