// Scripted ($0, no model) stand-ins for the model nodes and sessions of arm A1-C v2 (harness/v2/codeowned.mjs): v1's
// stand-ins (harness/codeowned-stubs.mjs) re-pointed to v2. HOST-SIDE TEST FIXTURES: not agents, and their scores are not
// capability evidence. The model-node stand-in is v1's (the v2 nodes keep v1's system prompts). The session stand-in is
// v1's, except that it passes the session environment (args.env: AB_GATE_DIR when the pre-send lint is on) to the client
// it runs, as the CLI's Bash tool would, and can append text to the messages it sends and resend a refused call (to
// exercise the lint end to end).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stubLedger, stubNodeRunner, writeFor } from '../codeowned-stubs.mjs';
import { BRIEF_FILES } from './checker.mjs';

export { stubLedger, stubNodeRunner, writeFor };

const now = () => new Date().toISOString();
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

const runNode = (args, cwd, env = {}) => new Promise(res => {
  const c = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let o = '', e = '';
  c.stdout.on('data', d => { o += d; }); c.stderr.on('data', d => { e += d; });
  c.on('close', code => res({ code, stdout: o, stderr: e }));
});
const b64url = s => Buffer.from(s, 'utf8').toString('base64url');

/** v1's write for a check, with `appendText` added to a message's body. */
export function writeForV2(pc, { appendText = '' } = {}) {
  const P = pc.params ?? {};
  if (!appendText) return writeFor(pc);
  const fetch = (method, url, body) => ({ name: 'api_fetch', arguments: JSON.stringify({ method, url, params: null, body: JSON.stringify(body) }) });
  if (pc.type === 'gmail_sent') return fetch('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { raw: b64url(`To: ${P.to.join(', ')}${P.cc?.length ? `\r\nCc: ${P.cc.join(', ')}` : ''}\r\nSubject: ${(P.subject ?? []).join(' ') || 'Update'}\r\n\r\n${['Hello,', ...(P.body ?? []), appendText].join('\n')}`) });
  if (pc.type === 'slack_posted') return fetch('POST', 'https://slack.com/api/chat.postMessage', { channel: P.channel.id ?? P.channel.name, text: ['Update:', ...(P.text ?? []), appendText].join(' ') });
  return writeFor(pc);
}

/** Act/repair stand-in (v1's), with: env passed to the client; appendText / appendLeftOut; perCall (one step per write);
 * resendOnGate (a call the lint refused is run again unchanged). */
export function stubSessionRunner({ skipLast = false, honorMaxTurns = true, extraResponses = 0, seen = null, appendText = '', appendLeftOut = false, perCall = false, resendOnGate = false } = {}) {
  return async args => {
    const { workdir, task, maxTurns = null, systemPrompt, prompt } = args;
    seen?.push({ node: task?.name ?? null, system: systemPrompt, prompt, model: args.model, tools: args.tools, maxTurns, env: args.env ?? null, keepRo: args.keepRo ?? null });
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
    // appendLeftOut: the message carries the first value its check leaves out (exercises the lint; read from CHECKS.json).
    const calls = todo.map(c => writeForV2(c, { appendText: appendLeftOut ? (c.params?.bodyNot?.[0] ?? appendText) : appendText })).filter(Boolean);
    const groups = perCall ? calls.map(c => [c]) : calls.length ? [calls] : [];
    let k = 0;
    for (const g of groups) {
      if (capped) break;
      if (steps.length >= budget) { capped = true; break; }
      const f = `.stub-step-${k++}.json`;
      writeFileSync(path.join(workdir, f), JSON.stringify(g));
      const at = now();
      const r = await runNode(['tool.mjs', 'batch', `@${f}`], workdir, args.env ?? {});
      steps.push({ command: `node tool.mjs batch @${f}`, out: r.stdout + r.stderr, at, done: now() });
      if (resendOnGate && /HARNESS GATE/.test(r.stderr)) {
        if (steps.length >= budget) { capped = true; break; }
        const at2 = now();
        const r2 = await runNode(['tool.mjs', 'batch', `@${f}`], workdir, args.env ?? {});
        steps.push({ command: `node tool.mjs batch @${f}`, out: r2.stdout + r2.stderr, at: at2, done: now() });
      }
    }
    if (!capped && steps.length >= budget) capped = true;
    const n = transcript(workdir, steps, 'Done.', { capped, model: args.model ?? 'stub' });
    return { ok: !capped, error: capped ? { code: 'EXECUTOR_ERROR' } : null, result: capped ? null : 'Done.', costUsd: 0, costUnknown: false, costUpperUsd: 0, turns: n, durationMs: Date.now() - t0,
      toolUses: steps.map(s => ({ name: 'Bash', input: { command: s.command } })), label: 'stub-session' };
  };
}
