import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const cli = new URL('../bin/foundry.mjs', import.meta.url);
function invoke(args) {
  const workspace = mkdtempSync(path.join(tmpdir(), 'foundry-cli-provider-'));
  try {
    const result = spawnSync(process.execPath, [cli.pathname, ...args, '--workspace', workspace], {
      env: { PATH: '/usr/bin:/bin', HOME: workspace, NODE_NO_WARNINGS: '1' },
      encoding: 'utf8', timeout: 5000, maxBuffer: 100000,
    });
    assert.equal(result.error, undefined);
    return result;
  } finally { rmSync(workspace, { recursive: true, force: true }); }
}

test('CLI documents the explicit pinned-v2 generation route', () => {
  const result = invoke(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--agent opencode-v2-free --model opencode\/big-pickle/);
});

test('CLI refuses implicit model selection before any provider request', () => {
  for (const agent of ['opencode-free', 'opencode-v2-free']) {
    const result = invoke(['generate', '--task', 'Offline routing test', '--agent', agent]);
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stderr).error.code, 'MODEL_ID');
  }
});

test('CLI reaches the v2 constructor and rejects an unverified model without network', () => {
  const result = invoke(['generate', '--task', 'Offline routing test', '--agent', 'opencode-v2-free', '--model', 'invalid/no-provider']);
  assert.equal(result.status, 1);
  const error = JSON.parse(result.stderr).error;
  assert.equal(error.code, 'MODEL_ID');
  assert.match(error.message, /verified opencode\/big-pickle/);
});

test('CLI does not use an unknown agent or silently fall back', () => {
  const result = invoke(['generate', '--task', 'Offline routing test', '--agent', 'unknown', '--model', 'opencode/big-pickle']);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stderr).error.code, 'GENERATOR_PROVIDER');
});
