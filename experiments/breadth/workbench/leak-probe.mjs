#!/usr/bin/env node
// BG-8 leakage probe, from inside ($0; PLAN §5.4): gold, sealed manifests, verdicts and run records must be unreachable
//   (a) from an arm session's sandbox (the exact mask the CLI session gets: src/executors/claude-code.mjs maskSteps with
//       the facade's kept directory), probed with `sh` in place of `claude`; the A arms have no built-in tools at all
//       (--tools ""), so this is the view a future arm with a shell would have;
//   (b) from the bed's own code-execution path, the `python` tool (src/sandbox.mjs), including the network;
//   (c) through the world tools: the relay only forwards catalog tool names (checked by the facade tests).
//   node experiments/breadth/workbench/leak-probe.mjs [--out research/breadth-20261021/workbench/LEAK-PROBE.json]
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_HIDDEN, DEFAULT_KEEP_RO, UNSHARE_ARGS, executorEnv, maskSteps, sandboxAvailable, sandboxScript, splitReady } from '../../../src/executors/claude-code.mjs';
import { runPythonTool } from '../facade/python-tool.mjs';
import { BENCH, CLONE, HOST_ONLY, REPO, RESEARCH, VENV_PY, writeJson } from './lib.mjs';

const argv = process.argv.slice(2);
const out = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : path.join(RESEARCH, 'LEAK-PROBE.json');

/** Paths no arm may see (gold, manifests, verdicts, the repository, other sessions, credentials' home). */
export const SECRET_PATHS = Object.freeze([
  path.join(HOST_ONLY, 'sealed/MANIFEST.json'), path.join(HOST_ONLY, 'sealed/COMPANION.json'), path.join(HOST_ONLY, 'parity'), path.join(HOST_ONLY, 'runs'), HOST_ONLY,
  path.join(CLONE, 'data/processed/tasks_and_outcomes/email_tasks_and_outcomes.csv'), path.join(CLONE, 'data/results/item_level_results.csv.gz'), CLONE, VENV_PY,
  path.join(REPO, 'research/breadth-20261021/workbench/SPLIT.json'), path.join(REPO, 'beds'), REPO, '/root/.claude', '/home/user', path.join(BENCH, 'work'),
]);

function sessionView(workdir, keepDir) {
  // a file is visible when it exists; a directory when it lists anything (hidden roots are empty private tmpfs masks)
  const probe = `for p in ${SECRET_PATHS.map(p => `'${p}'`).join(' ')}; do if [ -f "$p" ]; then echo "VISIBLE $p"; elif [ -d "$p" ] && [ -n "$(ls -A "$p" 2>/dev/null)" ]; then echo "VISIBLE $p"; fi; done; ls -A '${keepDir}' | sed 's/^/KEPT /'; echo PROBE_DONE`;
  const script = sandboxScript(maskSteps({ workdir, hidden: DEFAULT_HIDDEN, keepRo: [...DEFAULT_KEEP_RO, keepDir] }), workdir, ['sh', '-c', probe]);
  return new Promise(resolve => {
    const c = spawn('unshare', [...UNSHARE_ARGS, 'sh', '-c', script], { env: executorEnv({ env: process.env, hidden: DEFAULT_HIDDEN }), stdio: ['ignore', 'pipe', 'pipe'] });
    let so = '', se = '';
    c.stdout.on('data', d => { so += d; }); c.stderr.on('data', d => { se += d; });
    c.on('close', code => resolve({ code, stdout: so, ready: splitReady(se).ready }));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!sandboxAvailable()) { console.error('no user/mount/pid namespaces: the probe cannot run'); process.exit(2); }
  const live = path.join(BENCH, 'live', `leak-probe-${Date.now()}`);
  const workdir = path.join(live, 'w'), keepDir = path.join(live, 'facade-bin');
  mkdirSync(workdir, { recursive: true }); mkdirSync(keepDir, { recursive: true });
  writeFileSync(path.join(keepDir, 'tools.json'), '[]'); writeFileSync(path.join(keepDir, 'mcp-relay.mjs'), '// stand-in');
  const s = await sessionView(workdir, keepDir);
  const visible = s.stdout.split('\n').filter(l => l.startsWith('VISIBLE ')).map(l => l.slice(8));
  const kept = s.stdout.split('\n').filter(l => l.startsWith('KEPT ')).map(l => l.slice(5));
  const pyCode = `import os, socket
paths = ${JSON.stringify(SECRET_PATHS)}
seen = [p for p in paths if os.path.isfile(p) or (os.path.isdir(p) and os.listdir(p))]
net = 'blocked'
try:
    socket.create_connection(('1.1.1.1', 443), timeout=3); net = 'OPEN'
except Exception as e:
    net = 'blocked: ' + type(e).__name__
try:
    socket.getaddrinfo('pypi.org', 443); dns = 'OPEN'
except Exception as e:
    dns = 'blocked: ' + type(e).__name__
print({'seen': seen, 'net': net, 'dns': dns, 'cwd_list': sorted(os.listdir('/'))})`;
  const py = await runPythonTool({ code: pyCode }, { timeoutMs: 30_000 });
  let pyOut = null; try { pyOut = JSON.parse(py.text.trim().replaceAll("'", '"')); } catch { pyOut = { raw: py.text.slice(0, 2000) }; }
  rmSync(live, { recursive: true, force: true });
  const res = { probe: 'BG-8 leakage from inside ($0)', at: new Date().toISOString(), secretPaths: SECRET_PATHS.map(p => p.replace(REPO, '<repo>')),
    session: { sandboxReady: s.ready, exit: s.code, done: s.stdout.includes('PROBE_DONE'), visible, keptDirListing: kept, pass: s.ready && s.stdout.includes('PROBE_DONE') && visible.length === 0 },
    pythonTool: { isError: py.isError, seen: pyOut?.seen ?? null, network: pyOut?.net ?? null, dns: pyOut?.dns ?? null, root: pyOut?.cwd_list ?? null,
      pass: !py.isError && Array.isArray(pyOut?.seen) && pyOut.seen.length === 0 && String(pyOut?.net).startsWith('blocked') && String(pyOut?.dns).startsWith('blocked') },
    worldTools: 'covered by experiments/breadth/test/facade.test.mjs (unknown tool names, planted links and oversize requests are refused; the relay holds only the tool list)' };
  res.pass = res.session.pass && res.pythonTool.pass;
  writeJson(out, res);
  console.log(JSON.stringify({ pass: res.pass, session: { visible, kept, ready: s.ready }, python: res.pythonTool }, null, 1));
}
