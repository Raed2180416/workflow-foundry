import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Foundry } from '../src/foundry.mjs';
import { toolDefinitions } from '../src/mcp.mjs';

test('MCP hints do not promise closed-world/additive execution for configurable adapters', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'foundry-mcp-hints-'));
  const foundry = new Foundry(directory);
  t.after(async () => { await foundry.close(); rmSync(directory, { recursive: true, force: true }); });
  const tools = new Map(toolDefinitions(foundry).map(tool => [tool.name, tool]));
  for (const name of ['foundry_run', 'foundry_run_json', 'foundry_resume', 'foundry_trial', 'foundry_trial_json']) {
    assert.equal(tools.get(name).annotations.openWorldHint, true);
    assert.equal(tools.get(name).annotations.destructiveHint, true);
    assert.equal(tools.get(name).annotations.readOnlyHint, false);
  }
  for (const name of ['foundry_validate', 'foundry_inspect', 'foundry_delivery']) assert.equal(tools.get(name).annotations.readOnlyHint, true);
});

// Surface patch 0001 (decision D15, applied with the 2026-10-21 engine bump): applying a proposal changes which program future runs execute,
// so a person must confirm every call; Claude Code prompts on each call of a tool marked anthropic/requiresUserInteraction, in every mode.
test('MCP: foundry_apply_proposal requires a person on every call; no other tool carries the mark', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'foundry-mcp-person-'));
  const foundry = new Foundry(directory);
  t.after(async () => { await foundry.close(); rmSync(directory, { recursive: true, force: true }); });
  const tools = toolDefinitions(foundry);
  const marked = tools.filter(tool => tool._meta?.['anthropic/requiresUserInteraction'] === true).map(tool => tool.name);
  assert.deepEqual(marked, ['foundry_apply_proposal']);
  assert.equal(tools.find(tool => tool.name === 'foundry_apply_proposal').annotations.readOnlyHint, false);
});
