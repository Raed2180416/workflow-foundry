// WorkBench on the breadth facade: paths, the bed's context declaration, the catalog, and one task-run through the
// full facade path (bed world -> host mailbox -> MCP relay -> agent) for scripted ($0) or model agents.
// Acquisition and pins: research/breadth-20261021/workbench/ACQUISITION.md (D16).
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBedCommand, startBedServer } from '../facade/bed-process.mjs';
import { startFacadeHost, trajectoryFromCalls } from '../facade/host.mjs';
import { PYTHON_TOOL } from '../facade/python-tool.mjs';
import { runScripted } from '../facade/scripted-client.mjs';
import { NODE_BIN, relayMcpConfig } from '../facade/session.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../../..');
export const BENCH = process.env.FOUNDRY_WORKBENCH_ROOT ?? '/var/tmp/foundry-work/benches/workbench';
export const CLONE = path.join(BENCH, 'src');
export const VENV_PY = path.join(BENCH, 'venv/bin/python');
export const BED_PY = path.join(HERE, 'bed.py');
export const RELAY = path.resolve(HERE, '../facade/mcp-relay.mjs');
export const PINNED_SHA = '49c7dfd00c03d384ec59ea57374f50b766aa5613';
export const SERVER_NAME = 'workbench';
export const RESEARCH = path.join(REPO, 'research/breadth-20261021/workbench');
/** Host-only outputs (sealed manifests, per-row verdicts of runs, journals): outside the repository. */
export const HOST_ONLY = path.join(BENCH, 'host-only');

export const sha256 = s => createHash('sha256').update(s).digest('hex');
export const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
export const readJsonl = p => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
export function writeJson(p, obj) { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(obj, null, 1) + '\n'); }
export function writeJsonl(p, rows) { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')); }

// --- context declaration (AM-9 date, C7 identity) ----------------------------------------------------------------------
// The official structured-outputs system prompt of the published runs (src/evals/inference.py datetime_prefix from
// HARDCODED_CURRENT_TIME 2023-11-30T00:00:00; src/evals/agent.py ACT_WITHOUT_CONFIRMATION_SUFFIX; the published
// Haiku 4.5 / Sonnet 4.6 runs' _meta.json: structured_outputs true, act_without_confirmation true, tool_selection all).
export const OFFICIAL_DATETIME_PREFIX = "Today's date is Thursday, 2023-11-30 and the current time is 00:00:00. Remember the current date and time when completing tasks. Meetings must not start before 9am or end after 6pm.";
export const OFFICIAL_ACT_SUFFIX = 'Do not ask for confirmation before executing actions. Execute actions immediately and continue until the task is fully complete. Do not stop after a search or lookup step.';
export const OFFICIAL_SYSTEM_PROMPT = `${OFFICIAL_DATETIME_PREFIX} ${OFFICIAL_ACT_SUFFIX}`;
export const DATE_NOTE = "Any other date shown in your session context belongs to the machine running you, not to this task: use the date above.";
export const SYNTHETIC_IDENTITY = 'Session identity (synthetic, the same for every arm): you act for the user of this workspace. Any account name or e-mail address that appears elsewhere in your context belongs to the machine operator, not to the user or to anyone in this task; never use it in a tool call.';
export const TOOLS_NOTE = 'Your tools are the workspace tools (calendar, email, analytics, project management, customer relationship manager, company directory) and `python`, a sandboxed calculator with no access to the workspace. When the task is done, stop and reply with a short final message.';
export const MAX_ITERATIONS = 20; // src/evals/agent.py run_agent_structured max_iterations
export const MAX_EXECUTION_S = 600; // src/evals/agent.py max_execution_time

/** The arm's system prompt: the official text, then the declared context (identical for every arm), then the bed card
 * (identical for every arm when present; PLAN §5.2 "Information"). */
export function systemPrompt({ card = null } = {}) {
  return [OFFICIAL_SYSTEM_PROMPT, '', DATE_NOTE, SYNTHETIC_IDENTITY, TOOLS_NOTE, ...(card ? ['', card] : [])].join('\n');
}

// --- bed commands --------------------------------------------------------------------------------------------------
export function bedCommand(args, { cwd, timeoutMs } = {}) {
  return runBedCommand({ python: VENV_PY, script: BED_PY, args: ['--root', CLONE, ...args], cwd: cwd ?? path.join(BENCH, 'work'), timeoutMs });
}
export async function bedJson(args, opts) {
  const r = await bedCommand(args, opts);
  if (r.code !== 0) throw new Error(`bed ${args[0]} failed (${r.code}): ${r.stderr.slice(-1500)}`);
  return r.lines;
}
export function startWorld(cwd) {
  return startBedServer({ python: VENV_PY, script: BED_PY, args: ['--root', CLONE, 'serve'], cwd });
}

/** All shipped tasks with gold (host-only data; the listing never reaches an agent). */
export async function shippedTasks({ cwd } = {}) { return bedJson(['tasks'], { cwd }); }

/** The session catalog: WorkBench's 27 tools (tool_selection "all": five toolkits + company directory) + python. */
export async function catalogFrom(world) {
  const r = await world.request({ op: 'catalog' });
  const bedTools = r.tools.map(t => ({ name: t.mcpName, bedName: t.name, description: t.description, inputSchema: t.inputSchema, write: t.write }));
  return { bedTools, mcpTools: [...bedTools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })), PYTHON_TOOL] };
}

/** The session's MCP config: the relay as the only server, reading its tool list and the session mailbox. */
export const relayMcpConfigFor = (facadeBin, mailbox) => relayMcpConfig({ serverName: SERVER_NAME, relayScript: facadeBin.relayScript, toolsFile: facadeBin.toolsFile, mailbox });

/** The relay's read-only directory for a run: the relay script and the tool list. */
export function materializeFacadeBin(dir, mcpTools) {
  mkdirSync(dir, { recursive: true });
  copyFileSync(RELAY, path.join(dir, 'mcp-relay.mjs'));
  writeFileSync(path.join(dir, 'tools.json'), JSON.stringify(mcpTools, null, 1));
  return { relayScript: path.join(dir, 'mcp-relay.mjs'), toolsFile: path.join(dir, 'tools.json') };
}

/**
 * One task-run through the facade. agent(ctx) runs the agent (scripted client or a model session) and returns its
 * raw result; ctx = { mcpConfig, workdir, facadeBin, server }. Returns { trajectory, snapshot, facade, agentResult }.
 * The world is reset first; the snapshot is taken after the agent ends, before the next reset.
 */
export async function runTaskThroughFacade({ task, seed = 0, world, catalog, facadeBin, workRoot, hostDir, agent, python = true, keepWorkdir = false }) {
  const workdir = path.join(workRoot, task.id.replace(/[^A-Za-z0-9_.-]/g, '_'));
  rmSync(workdir, { recursive: true, force: true });
  mkdirSync(workdir, { recursive: true });
  rmSync(hostDir, { recursive: true, force: true });
  mkdirSync(hostDir, { recursive: true });
  const reset = await world.request({ op: 'reset', task: task.id, seed });
  if (reset.kind !== 'reset') throw new Error(`reset failed: ${JSON.stringify(reset).slice(0, 300)}`);
  const mailbox = path.join(workdir, '.facade');
  const host = startFacadeHost({ mailbox, hostDir, catalog: catalog.bedTools, bed: world, python });
  const mcpConfig = relayMcpConfigFor(facadeBin, mailbox);
  let agentResult = null, agentError = null;
  try { agentResult = await agent({ mcpConfig, workdir, facadeBin, server: mcpConfig.mcpServers[SERVER_NAME] }); }
  catch (e) { agentError = e; }
  const facade = await host.stop();
  const snap = await world.request({ op: 'snapshot' });
  const trajectory = trajectoryFromCalls(path.join(hostDir, 'calls.jsonl'));
  writeJson(path.join(hostDir, 'snapshot.json'), { resetDigest: reset.digest, digest: snap.digest, digests: snap.digests });
  if (!keepWorkdir) rmSync(workdir, { recursive: true, force: true });
  if (agentError) throw agentError;
  return { trajectory, snapshot: snap.digests, facade, agentResult };
}

/** A scripted agent: the given MCP steps through a real relay process, as the CLI would issue them. */
export const scriptedAgent = steps => async ({ server }) => runScripted({ server: { command: server.command, args: server.args }, steps });

/** Action strings -> MCP steps (the bed parses; host side only). */
export async function stepsFor(world, actions) {
  if (!actions.length) return [];
  const r = await world.request({ op: 'parse', actions });
  if (r.kind !== 'parse') throw new Error(`parse failed: ${JSON.stringify(r).slice(0, 300)}`);
  return r.steps;
}

/** Grade facade trajectories host-side, in a separate bed process. rows: [{id, actions, error, live}]. */
export async function gradeTrajectories(rows, { tasksFile, dir }) {
  mkdirSync(dir, { recursive: true });
  const inFile = path.join(dir, `traj-${process.pid}-${Date.now()}.jsonl`), outFile = path.join(dir, `verdicts-${process.pid}-${Date.now()}.jsonl`);
  writeJsonl(inFile, rows);
  await bedJson(['grade', '--tasks', tasksFile, '--in', inFile, '--out', outFile], { cwd: dir });
  const v = readJsonl(outFile);
  rmSync(inFile, { force: true }); rmSync(outFile, { force: true });
  return v;
}

export { NODE_BIN };
