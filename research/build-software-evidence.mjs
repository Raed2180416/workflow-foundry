import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Original research utility. It reads pinned source text; it never imports or runs it.
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(readFileSync(resolve(root, 'research/manifests/software.json'), 'utf8'));
const entries = [
  ['C01','openai/codex','codex-rs/core/src/tools/orchestrator.rs',122,235,'Approval policy and network ownership are checked centrally before tool dispatch.'],
  ['C02','openai/codex','codex-rs/core/src/tools/orchestrator.rs',327,448,'A sandbox denial has a constrained escalation path; strict auto-review distinguishes sandboxed and unsandboxed approval.'],
  ['C03','openai/codex','codex-rs/skills/src/selection.rs',31,109,'Explicit skill selection resolves enabled canonical/discovery paths and disambiguates names.'],
  ['C04','openai/codex','codex-rs/core/src/skills.rs',121,163,'Implicit skill invocation instrumentation uses execution context and per-turn deduplication.'],
  ['C05','openai/symphony','elixir/lib/symphony_elixir/agent_runner.ex',88,171,'The runner bounds turns and re-fetches tracker state after each completed turn.'],
  ['C06','openai/symphony','elixir/lib/symphony_elixir/workflow.ex',52,113,'Workflow frontmatter and prompt body are parsed separately with explicit read and parse errors.'],
  ['C07','SWE-agent/mini-swe-agent','src/minisweagent/agents/default.py',88,157,'The small agent loop records trajectory, checks resource limits before query and handles format errors separately.'],
  ['C08','SWE-agent/mini-swe-agent','src/minisweagent/environments/local.py',24,59,'The local environment inherits process environment and recognizes a stdout submission sentinel.'],
  ['C09','SWE-agent/SWE-agent','sweagent/agent/agents.py',1062,1217,'Format, blocklist and syntax failures requery; other typed failures end with an attempted patch autosubmission.'],
  ['C10','SWE-agent/SWE-agent','sweagent/agent/reviewer.py',329,371,'The optional chooser filters candidates, may preselect, and defaults to the first candidate after invalid selection.'],
  ['C11','anthropics/claude-agent-sdk-python','src/claude_agent_sdk/_internal/transport/subprocess_cli.py',219,260,'The public Python transport discovers a bundled or installed Claude CLI.'],
  ['C12','anthropics/claude-agent-sdk-python','src/claude_agent_sdk/_internal/query.py',762,861,'Task tracking documents a turn-boundary race and a multi-input lifecycle limitation.'],
  ['B01','browser-use/browser-harness','src/browser_harness/run.py',377,409,'The CLI reads Python from stdin, establishes the daemon, and executes the submitted code.'],
  ['B02','browser-use/browser-harness','src/mcp_server.py',116,135,'MCP wrappers ensure a daemon, protect the stdio channel and convert exceptions to tool errors.'],
  ['B03','browser-use/browser-harness','src/mcp_server.py',192,280,'The MCP surface returns screenshot path metadata and exposes raw JS, CDP, upload and HTTP operations.'],
  ['B04','browser-use/browser-harness','src/browser_harness/daemon.py',578,611,'Shutdown tracks, cancels and drains stale-session recoveries with a bounded wait.'],
  ['B05','browser-use/browser-use','browser_use/agent/service.py',1035,1113,'A step refreshes context, clears previous-step outputs, requests actions, executes and finalizes evidence.'],
  ['B06','browser-use/browser-use','browser_use/agent/service.py',2730,2828,'Queued actions stop on explicit page-changing actions or observed URL/focus changes.'],
  ['B07','browser-use/browser-use','browser_use/agent/service.py',1593,1644,'An optional judge inspects the trace and attaches a verdict without replacing the agent success flag.'],
  ['B08','browser-use/browser-use','browser_use/agent/service.py',2503,2660,'The run loop bounds steps/failures, integrates pause/stop, and limits initial-action waits.'],
  ['B09','browserbase/stagehand','packages/sdk-ts/src/stagehand.ts',80,109,'Ambiguous initialization failure invalidates a claimed browser rather than returning it as reusable.'],
  ['B10','browserbase/stagehand','packages/extension/services/actService.ts',48,170,'The action service separates structured deterministic actions from instruction inference and records usage.'],
  ['B11','browserbase/stagehand','packages/extension/services/actService.ts',237,405,'Cached actions replay sequentially; failed deterministic actions can recapture a snapshot and self-heal.'],
  ['B12','browserbase/stagehand','packages/extension/services/cacheService.ts',21,76,'The public cache client delegates key computation, Redis storage and project gating to an external API.'],
  ['B13','browserbase/stagehand','packages/extension/services/cacheService.ts',191,313,'Cache read or replay failure falls back to ordinary execution and annotates the miss reason.'],
  ['B14','Skyvern-AI/skyvern','skyvern/forge/sdk/workflow/models/block.py',1505,1664,'Safe block execution records lifecycle and clears stale loop output after unsuccessful results or exceptions.'],
  ['B15','Skyvern-AI/skyvern','skyvern/forge/sdk/workflow/service.py',7090,7176,'Script-to-agent routing distinguishes uncached, non-cacheable and requires-agent blocks from failure fallback.'],
  ['B16','simular-ai/Agent-S','gui_agents/s3/agents/agent_s.py',48,94,'AgentS3 selects a non-hierarchical worker and exposes configurable reflection and trajectory retention.'],
  ['B17','simular-ai/Agent-S','gui_agents/s3/agents/worker.py',178,351,'The worker combines screenshot, reflection and previous code results; formats a single action and grounds it to executable code.'],
  ['B18','simular-ai/Agent-S','gui_agents/s3/bbon/comparative_judge.py',63,149,'Comparative judging consumes initial/final screenshots and captions; malformed verdicts leave no selected trajectory.'],
  ['S01','agentskills/agentskills','docs/specification.mdx',19,65,'Agent Skills defines required metadata and directory-name matching.'],
  ['S02','agentskills/agentskills','docs/specification.mdx',163,237,'Tool declarations are experimental; metadata, instructions and resources use progressive disclosure.'],
  ['S03','anthropics/skills','skills/skill-creator/SKILL.md',163,234,'The skill-creation recipe pairs baseline and treatment outputs, records costs and grades evidence.'],
  ['S04','anthropics/skills','skills/skill-creator/SKILL.md',335,360,'Trigger evaluation includes positive queries and difficult negative near-misses.'],
  ['S05','openai/skills','skills/.curated/gh-fix-ci/SKILL.md',29,58,'The CI repair skill scopes its implementation to GitHub Actions and identifies external-provider boundaries.'],
  ['S06','openai/skills','README.md',1,8,'The assigned skills catalog is deprecated and directs current plugin examples to openai/plugins.'],
  ['S07','openai/plugins','README.md',3,12,'Current Codex examples package skills, MCP, hooks and other surfaces through a plugin manifest and marketplace.'],
  ['S08','openai/plugins','.agents/skills/plugin-creator/references/plugin-json-spec.md',48,96,'Plugin-relative paths supplement default discovery; manifest surfaces and naming require client-specific handling.'],
  ['F01','langchain-ai/langgraph','libs/langgraph/langgraph/types.py',851,871,'Resuming an interrupt re-executes the node; ordered resume values and a checkpointer are required.'],
  ['F02','langchain-ai/langgraph','libs/langgraph/langgraph/graph/state.py',928,979,'An edge from a list waits for all listed nodes, unlike independently adding multiple incoming edges.'],
  ['F03','langchain-ai/langchain','libs/langchain_v1/langchain/agents/factory.py',840,911,'create_agent builds a compiled state graph with model, tools, middleware and structured-response strategy.'],
  ['F04','langchain-ai/langchain','libs/langchain_v1/langchain/agents/middleware/human_in_the_loop.py',405,494,'Human review batches selected tool calls, validates decision count and reconstructs the original call order.'],
  ['F05','n8n-io/n8n','packages/core/src/execution-engine/workflow-execute.ts',1798,1815,'Native retries are bounded and clamped; a resumed sub-workflow error is not retried.'],
  ['F06','n8n-io/n8n','packages/core/src/execution-engine/workflow-execute.ts',1491,1525,'A waiting execution resumes by modifying the execution stack and prior run data.'],
  ['F07','n8n-io/n8n','packages/nodes-base/nodes/ExecuteWorkflow/ExecuteWorkflow/ExecuteWorkflow.node.ts',16,39,'Execute Workflow supports explicit versioned sub-workflow bindings and passing the full data item.'],
  ['F08','n8n-io/n8n','LICENSE.md',1,35,'Root license distinguishes Enterprise files and Sustainable Use restrictions.'],
  ['P01','modelcontextprotocol/modelcontextprotocol','docs/specification/2026-07-28/server/tools.mdx',290,307,'MCP tool annotations are untrusted unless their server is trusted.'],
  ['P02','modelcontextprotocol/modelcontextprotocol','docs/specification/2026-07-28/server/tools.mdx',498,515,'Structured tool results are server data and require output-schema validation when a schema is declared.'],
  ['P03','modelcontextprotocol/modelcontextprotocol','docs/specification/2026-07-28/server/tools.mdx',738,803,'MCP distinguishes protocol errors from tool execution errors and calls for input/output validation.'],
  ['P04','modelcontextprotocol/modelcontextprotocol','docs/specification/2026-07-28/basic/patterns/cancellation.mdx',35,89,'Cancellation differs by transport and may race completed or non-cancellable work; timeouts remain bounded.'],
  ['P05','modelcontextprotocol/modelcontextprotocol','LICENSE',1,5,'MCP is transitioning contributions from MIT to Apache-2.0, with CC-BY-4.0 for non-specification documentation.'],
];

const verified = new Set();
const evidence = entries.map(([id, repository, path, startLine, endLine, finding]) => {
  const receipt = manifest.find(row => row.repository === repository);
  if (!receipt?.commit || !receipt.outcome.startsWith('cloned-')) throw new Error(`Unacquired source: ${repository}`);
  const directory = realpathSync(receipt.directory);
  if (!verified.has(repository)) {
    const actual = execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (actual !== receipt.commit) throw new Error(`Revision drift: ${repository}`);
    verified.add(repository);
  }
  const sourcePath = realpathSync(resolve(directory, path));
  if (!sourcePath.startsWith(directory + sep)) throw new Error(`Source escapes checkout: ${path}`);
  const source = readFileSync(sourcePath, 'utf8');
  const lines = source.split('\n');
  if (startLine < 1 || endLine > lines.length || endLine < startLine) throw new Error(`Invalid span: ${id}`);
  return { id, repository, commit: receipt.commit, acquiredAt: receipt.acquiredAt,
    path, startLine, endLine, sourceSha256: createHash('sha256').update(source).digest('hex'),
    url: `https://github.com/${repository}/blob/${receipt.commit}/${path}#L${startLine}-L${endLine}`,
    kind: 'source-inspection', upstreamExecuted: false, finding };
});

const directory = resolve(root, 'research/dossiers');
mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, 'software-browser-evidence.json'), JSON.stringify({
  schemaVersion: 1, observedAt: '2026-09-13', scope: 'software-browser-skills', evidence
}, null, 2) + '\n');
writeFileSync(resolve(directory, 'software-browser-evidence.md'),
  '# Software/browser source evidence\n\nGenerated by `node research/build-software-evidence.mjs`. These are source inspections, not execution results. Full revision and source digests are in the adjacent JSON registry.\n\n' +
  evidence.map(e => `## ${e.id}\n\n${e.finding}\n\n[${e.repository}: ${e.path}, lines ${e.startLine}–${e.endLine}](${e.url})\n`).join('\n'));
console.log(JSON.stringify({ verifiedRepositories: verified.size, evidenceSpans: evidence.length, upstreamCodeExecuted: false }));
