// Scripted ($0, no model) stand-ins for the model nodes and sessions of arm A1-C (harness/codeowned.mjs). HOST-SIDE TEST
// FIXTURES: they are not agents and their scores are not capability evidence. They use only what the node itself is given
// (its system prompt and prompt; a session also its working directory, as a real session would), and write the same
// stream-json transcript shape the CLI prints, so the pipeline's accounting runs on the same code path as for real calls.
//
//   stubNodeRunner(opts)    model nodes: the ledger stub extracts requirements from the request text inside its prompt
//                           (each email address -> one send_email item quoting the request; reader variation by prompt
//                           hash); adjudication picks option 1; the mapping call maps nothing; the checker fails what it
//                           cannot see.
//   stubSessionRunner(opts) act/repair sessions: read CHECKS.json (act) or REPAIR.md (repair) in the workdir and make the
//                           writes the executable positive checks describe, through `node tool.mjs batch` (the session's
//                           own client); with skipLast the act session leaves its last check undone (exercises repair).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ADJUDICATE_SYSTEM, LEDGER_SYSTEM } from './ledger.mjs';
import { CHECKER_SYSTEM, PCMAP_SYSTEM } from './postconditions.mjs';
import { BRIEF_FILES } from './checker.mjs';

const now = () => new Date().toISOString();
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const h = s => parseInt(createHash('sha256').update(String(s)).digest('hex').slice(0, 8), 16);

function transcript(workdir, steps, finalText, { capped = false, model = 'stub' } = {}) {
  const events = [{ type: 'system', subtype: 'init', session_id: 'stub' }];
  steps.forEach((s, i) => {
    events.push({ type: 'assistant', timestamp: s.at ?? now(), message: { id: `msg_stub_${i}`, model, content: [{ type: 'tool_use', id: `toolu_stub_${i}`, name: 'Bash', input: { command: s.command } }] } });
    events.push({ type: 'user', timestamp: s.done ?? now(), message: { content: [{ type: 'tool_result', tool_use_id: `toolu_stub_${i}`, content: String(s.out ?? '').slice(0, 2000) }] } });
  });
  if (!capped) events.push({ type: 'assistant', timestamp: now(), message: { id: 'msg_stub_final', model, content: [{ type: 'text', text: finalText }] } });
  const n = steps.length + (capped ? 0 : 1);
  events.push({ type: 'result', subtype: capped ? 'error_max_turns' : 'success', is_error: capped, num_turns: n, total_cost_usd: 0, result: capped ? null : finalText });
  writeFileSync(path.join(workdir, '.executor-transcript.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
  return n;
}

const between = (s, a, b) => { const i = s.indexOf(a); if (i < 0) return ''; const j = s.indexOf(b, i + a.length); return s.slice(i + a.length, j < 0 ? undefined : j); };

/** The ledger a scripted reader writes from the request text in its prompt. */
export function stubLedger(prompt) {
  const request = between(prompt, '<request>\n', '\n</request>');
  const reader = h(prompt) % 3;
  const quotes = [...request.matchAll(/["“]([^"”\n]{4,80})["”]/g)].map(m => m[1]);
  const addrs = [...new Set(request.match(EMAIL) ?? [])];
  const sentences = request.split(/(?<=[.!?])\s+/);
  const reqs = addrs.map((a, i) => ({ id: `R${i + 1}`, polarity: 'positive', action: 'send_email', app: 'gmail', target: a, statement: (sentences.find(s => s.includes(a)) ?? `email ${a}`).slice(0, 200), source: 'request',
    fields: [{ name: 'to', quote: a, source: 'request' }, ...quotes.slice(0, 1).map(q => ({ name: 'body', quote: q, source: 'request' }))] }));
  // Reader variation: one reader misses the last item (union restores it); one proposes a negative with no cited rule
  // (code must drop it).
  // A channel post when the request speaks of one and the records list a channel (exercises the channel checks).
  const ch = /slack|channel|post\b|announce/i.test(request) ? /\[slack:channel_list:([^\]]+)\][^\n]*"name":"([^"]+)"/.exec(prompt) : null;
  if (ch) reqs.push({ id: `R${reqs.length + 1}`, polarity: 'positive', action: 'post_message', app: 'slack', target: `#${ch[2]}`, statement: `post an update in #${ch[2]}`, source: 'request', fields: quotes.slice(0, 1).map(q => ({ name: 'text', quote: q, source: 'request' })) });
  if (reader === 1 && reqs.length > 1) reqs.pop();
  if (reader === 2) reqs.push({ id: 'RX', polarity: 'negative', action: 'send_email', app: 'gmail', target: 'anyone else', statement: 'do not email anyone else', source: 'request', fields: [], rule_quote: null });
  const date = /\b(20\d\d-\d\d-\d\d)\b/.exec(request)?.[1] ?? null;
  return { today: date ? { value: date, source: 'request', quote: date } : null, requirements: reqs, conflicts: [] };
}

/** Model-node stand-in. opts.replies: optional {role: (prompt) => object} overrides; opts.seen collects every input. */
export function stubNodeRunner({ replies = {}, seen = null } = {}) {
  return async args => {
    const { workdir, systemPrompt, prompt, task } = args;
    seen?.push({ node: task?.name ?? null, system: systemPrompt, prompt, model: args.model, tools: args.tools, maxTurns: args.maxTurns });
    const role = systemPrompt === LEDGER_SYSTEM ? 'ledger' : systemPrompt === ADJUDICATE_SYSTEM ? 'adjudicate' : systemPrompt === PCMAP_SYSTEM ? 'pcmap' : systemPrompt === CHECKER_SYSTEM ? 'checker' : 'unknown';
    let reply;
    if (replies[role]) reply = replies[role](prompt, args);
    else if (role === 'ledger') reply = stubLedger(prompt);
    else if (role === 'adjudicate') reply = { decisions: [...prompt.matchAll(/### Point (\d+)/g)].map(m => ({ point: Number(m[1]), option: 1, why: 'stub: first option' })) };
    else if (role === 'pcmap') reply = { checks: [] };
    else if (role === 'checker') reply = { verdicts: [...prompt.matchAll(/### (P\d+):/g)].map(m => ({ id: m[1], pass: false, why: 'stub checker: cannot judge' })) };
    else reply = {};
    const text = typeof reply === 'string' ? reply : '```json\n' + JSON.stringify(reply) + '\n```';
    const n = transcript(workdir, [], text, { model: args.model ?? 'stub' });
    return { ok: true, error: null, result: text, costUsd: 0, costUnknown: false, costUpperUsd: 0, turns: n, durationMs: 1, toolUses: [], label: 'stub-node' };
  };
}

const runNode = (args, cwd) => new Promise(res => {
  const c = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let o = '', e = '';
  c.stdout.on('data', d => { o += d; }); c.stderr.on('data', d => { e += d; });
  c.on('close', code => res({ code, stdout: o, stderr: e }));
});
const b64url = s => Buffer.from(s, 'utf8').toString('base64url');
/** The write a positive check describes, as the session would make it (no grading data: the check is the brief's). */
export function writeFor(pc) {
  const P = pc.params ?? {};
  const fetch = (method, url, body) => ({ name: 'api_fetch', arguments: JSON.stringify({ method, url, params: null, body: JSON.stringify(body) }) });
  if (pc.type === 'gmail_sent') return fetch('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { raw: b64url(`To: ${P.to.join(', ')}${P.cc?.length ? `\r\nCc: ${P.cc.join(', ')}` : ''}\r\nSubject: ${(P.subject ?? []).join(' ') || 'Update'}\r\n\r\n${['Hello,', ...(P.body ?? [])].join('\n')}`) });
  if (pc.type === 'slack_posted') return fetch('POST', 'https://slack.com/api/chat.postMessage', { channel: P.channel.id ?? P.channel.name, text: ['Update:', ...(P.text ?? [])].join(' ') });
  if (pc.type === 'record_field' && P.ptr.startsWith('salesforce:')) { const [, type, id] = P.ptr.split(':'); return fetch('PATCH', `https://yourinstance.salesforce.com/services/data/v61.0/sobjects/${type}/${id}`, { [P.field]: P.value }); }
  return null;
}

/** Act/repair stand-in: one batch of the writes its brief's checks describe; honours maxTurns like the CLI guard unless
 * honorMaxTurns is false; extraResponses adds text-free Bash responses (to exercise the response cap). */
export function stubSessionRunner({ skipLast = false, honorMaxTurns = true, extraResponses = 0, seen = null } = {}) {
  return async args => {
    const { workdir, task, maxTurns = null, systemPrompt, prompt } = args;
    seen?.push({ node: task?.name ?? null, system: systemPrompt, prompt, model: args.model, tools: args.tools, maxTurns, files: existsSync(workdir) ? null : null });
    const t0 = Date.now();
    let checks = [];
    try { checks = JSON.parse(readFileSync(path.join(workdir, BRIEF_FILES.checks), 'utf8')); } catch { checks = []; }
    let todo = checks.filter(c => ['gmail_sent', 'slack_posted', 'record_field'].includes(c.type));
    if (task?.name === 'repair') {
      let failing = '';
      try { failing = readFileSync(path.join(workdir, BRIEF_FILES.repair), 'utf8'); } catch { /* none */ }
      todo = todo.filter(c => new RegExp(`\\b${c.id}\\b`).test(failing));
    } else if (skipLast && todo.length > 1) todo = todo.slice(0, -1);
    const steps = [];
    let capped = false;
    const budget = honorMaxTurns && maxTurns ? maxTurns : Infinity;
    for (let i = 0; i < extraResponses; i++) { if (steps.length >= budget) { capped = true; break; } steps.push({ command: `cat ${BRIEF_FILES.inventory} | head -5`, out: 'ok' }); }
    const calls = todo.map(c => writeFor(c)).filter(Boolean);
    if (calls.length && !capped) {
      if (steps.length >= budget) capped = true;
      else {
        writeFileSync(path.join(workdir, '.stub-step.json'), JSON.stringify(calls));
        const at = now();
        const r = await runNode(['tool.mjs', 'batch', '@.stub-step.json'], workdir);
        steps.push({ command: 'node tool.mjs batch @.stub-step.json', out: r.stdout + r.stderr, at, done: now() });
      }
    }
    if (!capped && steps.length >= budget) capped = true;
    const n = transcript(workdir, steps, 'Done.', { capped, model: args.model ?? 'stub' });
    return { ok: !capped, error: capped ? { code: 'EXECUTOR_ERROR' } : null, result: capped ? null : 'Done.', costUsd: 0, costUnknown: false, costUpperUsd: 0, turns: n, durationMs: Date.now() - t0,
      toolUses: steps.map(s => ({ name: 'Bash', input: { command: s.command } })), label: 'stub-session' };
  };
}
