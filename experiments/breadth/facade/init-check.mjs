// Init-event configuration check (PLAN §5.1 "init check"): the runner reads the CLI's `system/init` event (tools,
// MCP servers and their status, skills, plugins, slash commands, agents, model, permission mode) and refuses a session
// whose configuration differs from its arm's frozen one. The system prompt is not in the event: its sha256 (the text
// the runner passed) is part of the arm configuration instead.
import { createHash } from 'node:crypto';

const sha256 = s => createHash('sha256').update(s).digest('hex');
const names = xs => (Array.isArray(xs) ? xs.map(x => (typeof x === 'string' ? x : x?.name ?? JSON.stringify(x))).sort() : null);

/** The comparable part of an init event. */
export function initFingerprint(init) {
  if (!init) return null;
  return {
    cliVersion: init.claude_code_version ?? null,
    model: init.model ?? null,
    permissionMode: init.permissionMode ?? null,
    tools: names(init.tools),
    mcpServers: Array.isArray(init.mcp_servers) ? init.mcp_servers.map(s => ({ name: s.name, status: s.status })).sort((a, b) => (a.name < b.name ? -1 : 1)) : null,
    slashCommands: names(init.slash_commands),
    skills: names(init.skills),
    plugins: names(init.plugins),
    agents: names(init.agents),
    outputStyle: init.output_style ?? null,
    apiKeySource: init.apiKeySource ?? null,
  };
}

export const fingerprintHash = fp => sha256(JSON.stringify(fp));

/** Compare an observed fingerprint with the expected (frozen) one. Fields absent from `expected` are not checked.
 * Returns [] when they agree, else a list of "field: expected X, saw Y". */
export function compareFingerprint(expected, observed) {
  if (!observed) return ['no init event'];
  const out = [];
  for (const [k, v] of Object.entries(expected ?? {})) {
    if (v === undefined) continue;
    const a = JSON.stringify(v), b = JSON.stringify(observed[k] ?? null);
    if (a !== b) out.push(`${k}: expected ${a.slice(0, 300)}, saw ${b.slice(0, 300)}`);
  }
  return out;
}

/** The expected fingerprint of an arm, from its declared parts (what the runner can know before the CLI starts).
 * cliVersion, agents and outputStyle are filled from the arm's frozen offline init probe (probe-init.mjs). */
export function armExpectation({ model, mcpServers, tools, frozen = {} }) {
  return { model, permissionMode: 'bypassPermissions', tools: [...tools].sort(), mcpServers: mcpServers.map(n => ({ name: n, status: 'connected' })).sort((a, b) => (a.name < b.name ? -1 : 1)),
    slashCommands: frozen.slashCommands ?? [], skills: frozen.skills ?? [], plugins: frozen.plugins ?? [],
    ...(frozen.cliVersion ? { cliVersion: frozen.cliVersion } : {}), ...(frozen.agents ? { agents: frozen.agents } : {}), ...(frozen.outputStyle ? { outputStyle: frozen.outputStyle } : {}) };
}
