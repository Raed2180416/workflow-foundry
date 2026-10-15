// Scripted ($0, no model) stand-ins for the model call and sessions of arm A0+SR (harness/secondreader.mjs). HOST-SIDE TEST
// FIXTURES: they are not agents and their scores are not capability evidence. Each uses only what its node is given (the
// reader its prompt; a session its working directory, as a real session would) and writes the stream-json transcript
// shape the CLI prints, so the pipeline's accounting runs on the same code path as for real calls.
//
//   stubNodeRunner(opts)    the reader: one unmet item per email address of the request that neither the changes nor the
//                           write calls show (quote = the address, source = request); apps_checked = the connected apps.
//   stubSessionRunner(opts) act: one read step (opts.act(workdir) -> calls overrides it); repair: reads REVIEW.md and sends one
//                           email per address in its "still needed" lines (opts.repair(reviewText) -> calls overrides it).
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FILES, READER_SYSTEM } from './secondreader.mjs';

const now = () => new Date().toISOString();
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const between = (s, a, b) => { const i = s.indexOf(a); if (i < 0) return ''; const j = s.indexOf(b, i + a.length); return s.slice(i + a.length, j < 0 ? undefined : j); };

export function transcript(workdir, steps, finalText, { capped = false, model = 'stub' } = {}) {
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

/** The scripted reader's reply, from its prompt only. */
export function stubReview(prompt) {
  const request = between(prompt, '<request>\n', '\n</request>');
  const done = `${between(prompt, '<changes>', '</changes>')}\n${between(prompt, '<write_calls>', '</write_calls>')}`.toLowerCase();
  const connected = (/Connected apps: ([^\n]*)/.exec(between(prompt, '<records_before_the_work>', '</records_before_the_work>'))?.[1] ?? '').split(',').map(s => s.trim()).filter(s => s && s !== '(none)');
  const addrs = [...new Set(request.match(EMAIL) ?? [])].filter(a => !done.includes(a.toLowerCase()));
  return { apps_checked: connected, unmet: addrs.map(a => ({ requirement: `email ${a} as the request asks`, quote: a, source: 'request', status: 'missing', evidence: `no new message to ${a}`, fix: `send an email to ${a}` })) };
}

/** Reader stand-in. opts.replies.reader(prompt) overrides the reply; opts.seen collects every input; opts.fault returns that
 * error code instead of a reply (an environment fault, for tests). */
export function stubNodeRunner({ replies = {}, seen = null, fault = null } = {}) {
  return async args => {
    const { workdir, systemPrompt, prompt, task } = args;
    seen?.push({ node: task?.name ?? null, system: systemPrompt, prompt, model: args.model, tools: args.tools, maxTurns: args.maxTurns });
    const role = systemPrompt === READER_SYSTEM ? 'reader' : 'unknown';
    if (fault) { transcript(workdir, [], '', { model: args.model ?? 'stub' }); return { ok: false, error: { code: fault }, result: null, costUsd: 0, costUnknown: false, costUpperUsd: 0, turns: 1, durationMs: 1, toolUses: [], label: 'stub-node' }; }
    const reply = replies[role] ? replies[role](prompt, args) : role === 'reader' ? stubReview(prompt) : {};
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
const fetch = (method, url, body = null, params = null) => ({ name: 'api_fetch', arguments: JSON.stringify({ method, url, params: params === null ? null : JSON.stringify(params), body: body === null ? null : JSON.stringify(body) }) });
/** A Gmail send as a session would write it. */
export const sendEmail = (to, subject, text) => fetch('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { raw: Buffer.from(`To: ${to}\r\nSubject: ${subject}\r\n\r\n${text}`, 'utf8').toString('base64url') });
export const readMessages = () => fetch('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/messages', null, { maxResults: 10 });

/**
 * Act/repair stand-in: each entry of the call list is one world step (`node tool.mjs batch @file`, the session's own client).
 * opts.act(workdir) -> [[calls], ...] (default: one read step); opts.repair(reviewText) -> [[calls], ...] (default: one email
 * per address in REVIEW.md's "still needed" lines). extraResponses adds text-free responses; honours maxTurns like the guard.
 */
export function stubSessionRunner({ act = null, repair = null, seen = null, extraResponses = 0, honorMaxTurns = true } = {}) {
  return async args => {
    const { workdir, task, maxTurns = null, systemPrompt, prompt } = args;
    const files = existsSync(workdir) ? ['tool.mjs', 'tools.json', FILES.review, FILES.records].filter(f => existsSync(path.join(workdir, f))) : [];
    seen?.push({ node: task?.name ?? null, system: systemPrompt, prompt, model: args.model, tools: args.tools, maxTurns, budgetUsd: args.budgetUsd, timeoutMs: args.timeoutMs, binary: args.binary ?? null, files, args });
    const t0 = Date.now();
    let plan;
    if (task?.name === 'repair') {
      let review = '';
      try { review = readFileSync(path.join(workdir, FILES.review), 'utf8'); } catch { /* none */ }
      plan = repair ? repair(review) : [[...new Set(review.split('\n').filter(l => /still needed/.test(l)).flatMap(l => l.match(EMAIL) ?? []))].map(a => sendEmail(a, 'Follow-up', 'Hello, as requested.'))].filter(s => s.length);
    } else plan = act ? act(workdir) : [[readMessages()]];
    const steps = [];
    const budget = honorMaxTurns && maxTurns ? maxTurns : Infinity;
    let capped = false;
    for (let i = 0; i < extraResponses; i++) { if (steps.length >= budget) { capped = true; break; } steps.push({ command: 'ls', out: 'tool.mjs tools.json' }); }
    for (const [i, calls] of plan.entries()) {
      if (capped || steps.length >= budget) { capped = true; break; }
      const f = path.join(workdir, `.stub-step-${task?.name ?? 'x'}-${i}.json`);
      writeFileSync(f, JSON.stringify(calls));
      const at = now();
      const r = await runNode(['tool.mjs', 'batch', `@${path.basename(f)}`], workdir);
      steps.push({ command: `node tool.mjs batch @${path.basename(f)}`, out: r.stdout + r.stderr, at, done: now() });
    }
    if (!capped && steps.length >= budget) capped = true;
    const n = transcript(workdir, steps, 'Done.', { capped, model: args.model ?? 'stub' });
    return { ok: !capped, error: capped ? { code: 'EXECUTOR_ERROR' } : null, result: capped ? null : 'Done.', costUsd: 0, costUnknown: false, costUpperUsd: 0, turns: n, durationMs: Date.now() - t0,
      toolUses: steps.map(s => ({ name: 'Bash', input: { command: s.command } })), label: 'stub-session' };
  };
}
