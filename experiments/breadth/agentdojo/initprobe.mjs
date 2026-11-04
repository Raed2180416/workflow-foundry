#!/usr/bin/env node
// The $0 session-configuration probe (PLAN §5.1 "init check"): every arm's CLI session is started on the first N dev units
// in hashed order inside a NETWORK NAMESPACE (session.mjs `offline`): the CLI starts, connects the MCP relay and prints its
// init event, and the session is killed at once; no model request can leave the box, so nothing is spent. The init event
// must list exactly the arm's tools on a connected relay, no plugin, skill or slash command, the arm's model, and effort
// active (session.mjs initProblems). Writes research/breadth-20261021/agentdojo/init-probe.json (fingerprints only).
//
//   node experiments/breadth/agentdojo/initprobe.mjs [--limit 3] [--out FILE]
import path from 'node:path';
import { RESEARCH, sha256, writeJson } from './lib.mjs';
import { ARMS, DEFAULTS, devUnits, orderUnits, runUnits } from './run.mjs';
import { HARDENED_FLAGS, SESSION_ENV, SESSION_SETTINGS } from './session.mjs';
import { loadSplit } from './split.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };

export async function initProbe({ limit = 3, stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) } = {}) {
  const split = loadSplit();
  const units = orderUnits(devUnits(), split.salt).slice(0, limit);
  const out = { kind: 'agentdojo-init-probe', version: 1, at: new Date().toISOString(), evidence: '$0: offline (network namespace) CLI start on dev units; no model request',
    flags: HARDENED_FLAGS, settings: SESSION_SETTINGS, childEnv: SESSION_ENV, units: units.map(u => u.id), arms: {} };
  for (const armName of Object.keys(ARMS)) {
    const { summary, results } = await runUnits({ units, armName, offline: true, capUsd: 5, outDir: null, runId: `ad-initprobe-${stamp}-${armName}`, maxTurns: DEFAULTS.maxTurns,
      maxRequests: DEFAULTS.maxRequests, timeoutMin: 3, concurrency: 1, log: () => {} });
    out.arms[armName] = { model: ARMS[armName].model, effort: ARMS[armName].effort, initOk: summary.initOk, n: summary.n, envFaults: summary.envFaults, spentUsd: summary.cost.spentUsd,
      cli: summary.provenance.cli, systemPromptSha256: [...new Set(results.map(r => r.systemPromptSha256))],
      sessions: results.map(r => ({ unit: r.key, error: r.sessionError, init: r.init })), live: summary.live };
  }
  out.pass = Object.values(out.arms).every(a => a.initOk === a.n && a.n === units.length && a.spentUsd === 0);
  out.sha256 = sha256(JSON.stringify(out.arms));
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const res = await initProbe({ limit: Number(arg('limit', 3)) });
  const file = arg('out', path.join(RESEARCH, 'init-probe.json'));
  writeJson(file, res);
  console.log(JSON.stringify({ pass: res.pass, arms: Object.fromEntries(Object.entries(res.arms).map(([k, a]) => [k, `${a.initOk}/${a.n} init ok, $${a.spentUsd}`])), out: file }));
  if (!res.pass) process.exit(1);
}
