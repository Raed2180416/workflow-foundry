// runClaudeCode's extraArgs hook (swarm ladder, research/swarm-20261021): a closed allow-list of value-less flags that
// change what the transcript records, never what a session may do; empty by default, so every existing caller's argv
// (and every frozen arm hash that depends on it) is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runClaudeCode, checkExtraArgs, EXTRA_ARGS_ALLOWED, sandboxAvailable } from '../src/executors/claude-code.mjs';

const live = sandboxAvailable() ? false : 'user/mount/pid namespaces are not available here';

test('checkExtraArgs accepts only the allow-list and de-duplicates', () => {
  assert.deepEqual(EXTRA_ARGS_ALLOWED, ['--forward-subagent-text']);
  assert.deepEqual(checkExtraArgs(), []);
  assert.deepEqual(checkExtraArgs(['--forward-subagent-text', '--forward-subagent-text']), ['--forward-subagent-text']);
  for (const bad of [['--dangerously-skip-permissions'], ['--model', 'x'], ['--forward-subagent-text=1'], ['--allowedTools'], ['']]) {
    assert.throws(() => checkExtraArgs(bad), e => e.code === 'EXECUTOR_ARGS', JSON.stringify(bad));
  }
  assert.throws(() => checkExtraArgs('--forward-subagent-text'), e => e.code === 'EXECUTOR_ARGS', 'a string is not a list');
});

test('a refused flag never starts a session', async () => {
  await assert.rejects(runClaudeCode({ model: 'claude-haiku-5-5', prompt: 'x', workdir: '/nonexistent', extraArgs: ['--mcp-config', 'evil.json'] }), e => e.code === 'EXECUTOR_ARGS');
});

// A stand-in CLI that records its argv in the workdir and ends with a result.
const ARGV_CLI = `#!/bin/sh
cat > /dev/null
for a in "$@"; do printf '%s\\n' "$a"; done > argv.txt
echo '{"type":"system","subtype":"init","session_id":"fake"}'
echo '{"type":"result","subtype":"success","is_error":false,"result":"ok","total_cost_usd":0.001,"num_turns":1}'
`;
test('the flag is appended only when asked; the default argv is unchanged', { skip: live }, async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'foundry-xargs-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const argv = async (name, extra) => {
    const workdir = path.join(root, name); mkdirSync(workdir);
    writeFileSync(path.join(workdir, 'fake-claude'), ARGV_CLI); chmodSync(path.join(workdir, 'fake-claude'), 0o755);
    const r = await runClaudeCode({ model: 'claude-haiku-5-5', prompt: 'x', workdir, budgetUsd: 0.1, timeoutMs: 30000, binary: path.join(workdir, 'fake-claude'), ...(extra ? { extraArgs: extra } : {}) });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    return readFileSync(path.join(workdir, 'argv.txt'), 'utf8').trim().split('\n');
  };
  const base = await argv('default'), none = await argv('empty', []), fwd = await argv('forward', ['--forward-subagent-text']);
  assert.ok(!base.includes('--forward-subagent-text'));
  assert.deepEqual(none, base, 'an empty list is the default argv');
  assert.deepEqual(fwd, [...base, '--forward-subagent-text'], 'the flag is appended last and nothing else changes');
});
