#!/usr/bin/env node
// $0 configuration probe per arm (PLAN §5.1 "init check"): each arm's exact session (sandbox, hardened flags, the
// WorkBench relay as the only MCP server, its system prompt) is started inside a network namespace with no route, so
// the CLI prints its `system/init` event and its model request cannot leave the machine. The fingerprint (tools, MCP
// server status, skills, plugins, slash commands, agents, model, permission mode, CLI version) becomes the arm's frozen
// expectation; model runs refuse any session whose init differs (CONFIG_MISMATCH).
//   node experiments/breadth/workbench/probe-init.mjs [--arms A-H,A-S,A-O,H45] [--out FILE]
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fingerprintHash } from '../facade/init-check.mjs';
import { runFacadeSession } from '../facade/session.mjs';
import { ARMS, armModel } from './arms.mjs';
import { BENCH, HOST_ONLY, RESEARCH, SERVER_NAME, catalogFrom, materializeFacadeBin, relayMcpConfigFor, sha256, startWorld, systemPrompt, writeJson } from './lib.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const arms = opt('arms', Object.keys(ARMS).join(',')).split(',');
const out = opt('out', path.join(RESEARCH, 'INIT-PROBE.json'));

const live = path.join(BENCH, 'live', `init-probe-${Date.now()}`);
mkdirSync(live, { recursive: true });
const world = startWorld(path.join(live, 'world'));
await world.ready;
const catalog = await catalogFrom(world);
await world.close();
const facadeBin = materializeFacadeBin(path.join(live, 'facade-bin'), catalog.mcpTools);
const sp = systemPrompt();
const results = {};
for (const arm of arms) {
  const a = armModel(arm);
  const workdir = path.join(live, 'w', arm);
  mkdirSync(workdir, { recursive: true });
  const mcpConfig = relayMcpConfigFor(facadeBin, path.join(workdir, '.facade'));
  const r = await runFacadeSession({ model: a.model, effort: a.effort, prompt: 'Configuration probe (offline): no task.', workdir, keepRo: [path.dirname(facadeBin.relayScript)],
    mcpConfig, builtinTools: a.builtinTools, budgetUsd: 0.01, maxTurns: 1, systemPrompt: sp, offline: true, timeoutMs: 90_000 });
  mkdirSync(path.join(HOST_ONLY, 'init-probe'), { recursive: true });
  writeJson(path.join(HOST_ONLY, 'init-probe', `${arm}.json`), { init: r.init, error: r.error }); // raw event stays host-only
  const fp = r.initFingerprint;
  results[arm] = { model: a.model, effort: a.effort, ok: Boolean(fp), offline: true, costUsd: r.costUsd, error: r.error?.code ?? null,
    stderrTail: r.error ? String(r.error.stderr ?? '').slice(-300) : null, fingerprint: fp, fingerprintSha256: fp ? fingerprintHash(fp) : null,
    mcpToolCount: fp?.tools?.filter(t => t.startsWith(`mcp__${SERVER_NAME}__`)).length ?? null, builtinToolCount: fp?.tools?.filter(t => !t.startsWith('mcp__')).length ?? null };
  console.error(`[init-probe] ${arm}: ${fp ? `tools ${fp.tools.length}, mcp ${JSON.stringify(fp.mcpServers)}, skills ${fp.skills?.length}, plugins ${fp.plugins?.length}, slash ${fp.slashCommands?.length}` : `no init (${r.error?.code})`}`);
}
rmSync(live, { recursive: true, force: true });
writeJson(out, { probe: 'offline init (network namespace, no route): $0', at: new Date().toISOString(), systemPromptSha256: sha256(sp), arms: results });
console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { ok: v.ok, mcpToolCount: v.mcpToolCount, builtinToolCount: v.builtinToolCount, error: v.error, mcpServers: v.fingerprint?.mcpServers }])), null, 1));
