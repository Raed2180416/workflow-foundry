// A scripted MCP client ($0, no model): starts the relay the way the CLI does (same command and arguments as the
// session's --mcp-config entry), performs the MCP handshake, lists the tools and issues the given tool calls in order.
// Used for gold replay, floors and mutants through the full facade path (relay -> mailbox -> host -> bed).
import { spawn } from 'node:child_process';

/** runScripted({ server: {command, args}, steps: [{name, arguments}], timeoutMs, policy }) -> { tools, results, ms }
 * policy (optional): after each call, policy({ step, result, tools, attempt }) may return a step to issue next instead of
 * moving on (a scripted reaction to an error: retry, or a renamed argument); at most `maxAttempts` per planned step. */
export function runScripted({ server, steps, timeoutMs = 120_000, protocolVersion = '2025-06-18', policy = null, maxAttempts = 3 }) {
  const t0 = Date.now();
  const c = spawn(server.command, server.args, { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } });
  let buf = '', stderr = '', nextId = 1;
  const waiting = new Map();
  c.stdout.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      const w = waiting.get(m.id); if (w) { waiting.delete(m.id); w(m); }
    }
  });
  c.stderr.on('data', d => { if (stderr.length < 20_000) stderr += d; });
  c.stdin.on('error', () => {});
  const closed = new Promise(res => c.on('close', res));
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, m => (m.error ? reject(Object.assign(new Error(m.error.message), { rpc: m.error })) : resolve(m.result)));
    c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const notify = (method, params) => c.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }) + '\n');
  const timer = setTimeout(() => c.kill('SIGKILL'), timeoutMs);
  return (async () => {
    try {
      const init = await rpc('initialize', { protocolVersion, capabilities: {}, clientInfo: { name: 'foundry-scripted', version: '1' } });
      notify('notifications/initialized');
      const { tools } = await rpc('tools/list', {});
      const results = [];
      for (const s of steps) {
        let step = s;
        for (let attempt = 1; step && attempt <= maxAttempts; attempt++) {
          const result = await rpc('tools/call', { name: step.name, arguments: step.arguments ?? {} });
          results.push(result);
          step = policy ? await policy({ step, result, tools, attempt }) : null;
        }
      }
      return { init, tools, results, ms: Date.now() - t0 };
    } finally {
      clearTimeout(timer);
      try { c.stdin.end(); } catch {}
      await Promise.race([closed, new Promise(r => setTimeout(r, 3000))]);
      try { c.kill('SIGKILL'); } catch {}
    }
  })();
}
