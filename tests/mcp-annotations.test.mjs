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
