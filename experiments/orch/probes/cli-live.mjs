#!/usr/bin/env node
// Live meta-harness probes (research/orch-20261021/PROBES.md): Haiku 5.5 through the EXISTING Claude CLI executor
// (src/executors/claude-code.mjs runClaudeCode, unmodified: its sandbox, environment allow-list and the CLI's own
// login). Owner cap for this study: <= $1 in total; each session here is capped at $0.05 by --max-budget-usd.
// Every probe is recorded, including failures. Paid: run only on purpose.
//
//   node experiments/orch/probes/cli-live.mjs [--only L1,L2] [--out FILE]
import { mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runClaudeCode, WORK_ROOT } from '../../../src/executors/claude-code.mjs';

const args = process.argv.slice(2);
const only = (() => { const i = args.indexOf('--only'); return i >= 0 ? args[i + 1].split(',') : null; })();
const outFile = (() => { const i = args.indexOf('--out'); return i >= 0 ? args[i + 1] : null; })();
const MODEL = 'claude-haiku-5-5';   // policy/models.json (class M)
const CAP_TOTAL_USD = 1;

const procs = () => readdirSync('/proc').filter(x => /^\d+$/.test(x)).map(pid => {
  try { const s = readFileSync(`/proc/${pid}/stat`, 'utf8'), f = s.slice(s.lastIndexOf(')') + 2).split(' ');
    return { pid: Number(pid), ppid: Number(f[1]), state: f[0], cmd: readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ').trim() }; } catch { return null; }
}).filter(Boolean);
const descendants = root => { const t = procs(), out = [], q = [root]; while (q.length) { const p = q.pop(); for (const c of t.filter(x => x.ppid === p)) { if (c.state !== 'Z') out.push(c); q.push(c.pid); } } return out; };
const transcript = workdir => { try { return readFileSync(path.join(workdir, '.executor-transcript.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const summary = (r, workdir) => {
  const ev = transcript(workdir), init = ev.find(e => e.type === 'system' && e.subtype === 'init'), result = ev.findLast(e => e.type === 'result');
  return { ok: r.ok, error: r.error ? { code: r.error.code, exitCode: r.error.exitCode, stderrTail: String(r.error.stderr ?? '').slice(-300) } : null, costUsd: r.costUsd, costUnknown: r.costUnknown, costUpperUsd: r.costUpperUsd,
    streamUsage: r.streamUsage, turns: r.turns, durationMs: r.durationMs, result: String(r.result ?? '').slice(0, 200), cliVersion: init?.claude_code_version ?? null, model: init?.model ?? null,
    eventTypes: ev.map(e => (e.type === 'system' ? `system:${e.subtype}` : e.type)).slice(-12), resultEvent: result ? { subtype: result.subtype, is_error: result.is_error, terminal_reason: result.terminal_reason ?? null, total_cost_usd: result.total_cost_usd } : null,
    toolUses: (r.toolUses ?? []).map(t => `${t.name}:${JSON.stringify(t.input).slice(0, 80)}`),
    // What the CLI says about the account's limits during a session (no credential in it): kept whole, cut to 600 characters.
    rateLimitEvents: ev.filter(e => e.type === 'rate_limit_event').map(e => JSON.stringify(e).slice(0, 600)) };
};
// CLI 2.1.306 refuses a foreground `sleep` in its Bash tool (observed in the first L2/L3 run, kept in cli-live.json), so the long
// command is a python sleep; `token` is a number unique to the probe that identifies the process.
const SLEEP_PROMPT = token => `Use the Bash tool exactly once to run this command: python3 -c "import time; time.sleep(${token})" && echo slept\nAfter the command finishes, reply with the single word DONE.`;

// Run the executor and, once the marked command is running inside the session, deliver `act` (SIGTERM to the CLI, or an abort).
async function withSignal({ marker, act, budgetUsd = 0.05, timeoutMs = 180000 }) {
  const workdir = path.join(WORK_ROOT, `orch-live-${process.pid}-${Date.now()}`); mkdirSync(workdir, { recursive: true });
  const controller = new AbortController();
  let acted = null;
  const watcher = (async () => {
    const end = Date.now() + 120000;
    while (Date.now() < end && !acted) {
      const mine = descendants(process.pid);
      if (mine.some(p => p.cmd.includes(`time.sleep(${marker})`))) {
        await delay(1500);
        const cli = mine.find(p => /(^|\/)claude( |$)/.test(p.cmd.split(' ')[0]) || /\/claude-code\/|claude\.js|\bclaude -p\b/.test(p.cmd));
        acted = { atMs: Date.now(), cliPid: cli?.pid ?? null, cliCmd: cli?.cmd.slice(0, 60) ?? null, tree: mine.map(p => p.cmd.slice(0, 50)) };
        if (act === 'sigterm' && cli) { try { process.kill(cli.pid, 'SIGTERM'); } catch (e) { acted.error = e.code; } }
        if (act === 'abort') controller.abort();
        return;
      }
      await delay(100);
    }
  })();
  const t0 = Date.now();
  const r = await runClaudeCode({ model: MODEL, prompt: SLEEP_PROMPT(marker), workdir, budgetUsd, timeoutMs, tools: ['Bash'], signal: controller.signal });
  await watcher;
  await delay(1500);
  const leftovers = procs().filter(p => p.state !== 'Z' && p.cmd.includes(`time.sleep(${marker})`));
  for (const p of leftovers) { try { process.kill(p.pid, 'SIGKILL'); } catch {} }
  const s = summary(r, workdir);
  rmSync(workdir, { recursive: true, force: true });
  return { ...s, acted: acted && { afterMs: acted.atMs - t0, cliPid: acted.cliPid, cliCmd: acted.cliCmd, tree: acted.tree, error: acted.error ?? null }, leftovers: leftovers.map(p => p.cmd.slice(0, 60)) };
}

const probes = {
  L1: { title: 'baseline: one short answer, Bash available ($0.05 cap)', async run() {
    const workdir = path.join(WORK_ROOT, `orch-live-${process.pid}-${Date.now()}`); mkdirSync(workdir, { recursive: true });
    const r = await runClaudeCode({ model: MODEL, prompt: 'Reply with exactly the word PONG and nothing else. Do not use any tool.', workdir, budgetUsd: 0.05, timeoutMs: 120000, tools: ['Bash'] });
    const s = summary(r, workdir); rmSync(workdir, { recursive: true, force: true }); return s; } },
  L2: { title: 'SIGTERM to the CLI while its Bash tool runs a 30.71 s python sleep', async run() { return withSignal({ marker: '30.71', act: 'sigterm' }); } },
  L3: { title: 'executor abort (SIGKILL of the sandbox group) while Bash runs a 30.93 s python sleep', async run() { return withSignal({ marker: '30.93', act: 'abort' }); } },
  L4: { title: 'session budget below one call (--max-budget-usd 0.0001)', async run() {
    const workdir = path.join(WORK_ROOT, `orch-live-${process.pid}-${Date.now()}`); mkdirSync(workdir, { recursive: true });
    const r = await runClaudeCode({ model: MODEL, prompt: 'Use Bash to run `echo one`, then `echo two`, then reply OK.', workdir, budgetUsd: 0.0001, timeoutMs: 120000, tools: ['Bash'] });
    const s = summary(r, workdir); rmSync(workdir, { recursive: true, force: true }); return s; } },
};

const report = { model: MODEL, capTotalUsd: CAP_TOTAL_USD, at: new Date().toISOString(), probes: {}, spentKnownUsd: 0, spentUpperUsd: 0 };
for (const [id, p] of Object.entries(probes)) {
  if (only && !only.includes(id)) continue;
  if (report.spentUpperUsd + 0.05 > CAP_TOTAL_USD) { report.probes[id] = { title: p.title, skipped: 'cap' }; continue; }
  process.stderr.write(`[live] ${id} ${p.title} ... `);
  try { report.probes[id] = { title: p.title, ...(await p.run()) }; } catch (e) { report.probes[id] = { title: p.title, error: String(e.stack ?? e).slice(0, 600) }; }
  const x = report.probes[id];
  report.spentKnownUsd += x.costUsd ?? 0; report.spentUpperUsd += x.costUnknown ? (x.costUpperUsd ?? 0.05) : (x.costUsd ?? 0);
  process.stderr.write(`${x.ok ? 'ok' : x.error?.code ?? 'error'} $${x.costUsd ?? '?'}${x.costUnknown ? ` (unknown, <= $${x.costUpperUsd})` : ''}\n`);
}
const json = JSON.stringify(report, null, 1);
if (outFile) { mkdirSync(path.dirname(outFile), { recursive: true }); writeFileSync(outFile, json + '\n'); }
console.log(json);
