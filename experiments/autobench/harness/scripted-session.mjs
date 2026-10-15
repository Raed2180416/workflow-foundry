// A scripted (no-model, $0) stand-in for an A1 session, for tests and the smoke run. HOST-SIDE TEST FIXTURE: it is not
// an agent and its scores are not capability evidence.
//
// Each step is one model response: { calls: [{name, arguments}] } runs `node tool.mjs batch @file` in the workdir
// exactly as the session's Bash tool would; { write: { content, append? } } writes REQUIREMENTS.md as a session's
// `cat > REQUIREMENTS.md <<'EOF'` would (a response that does not touch the world); both in one step = one response
// whose command does both. A final text-only response ends the session. The runner writes the same stream-json
// transcript shape the CLI prints (system/init, assistant per response with a message id, user tool_result with a
// timestamp, result with num_turns), so the host-side accounting runs on the same code path as for a real session.
// With honorMaxTurns (default) it stops after `maxTurns` responses, as the CLI step guard would; with
// honorMaxTurns: false it ignores the guard (a misbehaving session, to test the host-side cap).
import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LEDGER_FILE } from './foundry.mjs';

const runNode = (args, cwd) => new Promise(res => {
  const c = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let o = '', e = '';
  c.stdout.on('data', d => { o += d; }); c.stderr.on('data', d => { e += d; });
  c.on('close', code => res({ code, stdout: o, stderr: e }));
});

export function scriptedHarnessRunner(stepsFor, { honorMaxTurns = true } = {}) {
  return async args => {
    const { workdir, task, maxTurns = null } = args;
    const t0 = Date.now();
    const steps = (await stepsFor(args)) ?? [];
    const now = () => new Date().toISOString();
    const events = [{ type: 'system', subtype: 'init', session_id: `scripted-${task?.fork ?? 0}` }];
    const toolUses = [], outputs = [];
    let responses = 0, capped = false;
    for (const [i, step] of steps.entries()) {
      if (honorMaxTurns && maxTurns && responses >= maxTurns) { capped = true; break; }
      if (!step?.calls?.length && !step?.write) continue;
      responses += 1;
      const parts = [];
      if (step.write) parts.push(`cat ${step.write.append ? '>>' : '>'} ${LEDGER_FILE} <<'EOF'\n${step.write.content}\nEOF`);
      if (step.calls?.length) parts.push(`node tool.mjs batch @.step-${i}.json`);
      const command = parts.join('\n');
      const id = `msg_scripted_${String(i).padStart(3, '0')}`, toolUseId = `toolu_scripted_${String(i).padStart(3, '0')}`;
      events.push({ type: 'assistant', timestamp: now(), message: { id, role: 'assistant', content: [{ type: 'tool_use', id: toolUseId, name: 'Bash', input: { command } }] } });
      let out = '';
      if (step.write) (step.write.append ? appendFileSync : writeFileSync)(path.join(workdir, LEDGER_FILE), `${step.write.content}\n`);
      if (step.calls?.length) {
        writeFileSync(path.join(workdir, `.step-${i}.json`), JSON.stringify(step.calls));
        const r = await runNode(['tool.mjs', 'batch', `@.step-${i}.json`], workdir);
        outputs.push(r);
        out = r.stdout + r.stderr;
      }
      events.push({ type: 'user', timestamp: now(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: out.slice(0, 20_000) }] } });
      toolUses.push({ name: 'Bash', input: { command } });
    }
    if (!capped) { responses += 1; events.push({ type: 'assistant', timestamp: now(), message: { id: 'msg_scripted_final', role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } }); }
    events.push({ type: 'result', subtype: capped ? 'error_max_turns' : 'success', is_error: capped, num_turns: responses, total_cost_usd: 0, result: capped ? null : 'Done.' });
    writeFileSync(path.join(workdir, '.executor-transcript.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
    return { ok: !capped, error: capped ? { code: 'EXECUTOR_ERROR' } : null, costUsd: 0, costUnknown: false, costUpperUsd: 0, turns: responses,
      durationMs: Date.now() - t0, toolUses, outputs, label: 'scripted-harness' };
  };
}
