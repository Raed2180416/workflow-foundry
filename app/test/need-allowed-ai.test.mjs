// The need judge obeys the workspace's Allowed AI setting, as a model builder does (the ROUTER-1 need router merged into the
// onboarding surface, 2026-11-04). $0: no model is called, and a refused judge opens no journal. node --test app/test/need-allowed-ai.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeNeedJudge } from '../cli.mjs';
import { saveSettings } from '../onboarding/settings.mjs';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli.mjs');
const REQUEST = 'every Friday send my boss a summary of what the Platform team finished';

test('makeNeedJudge refuses a model the workspace does not allow, before any port or journal exists', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'need-ai-'));
  try {
    for (const name of ['haiku', 'mercury']) {
      await assert.rejects(makeNeedJudge(name, { workspace: dir }), e => e.code === 'NEED_JUDGE_NOT_ALLOWED' && /Allowed AI: none/.test(e.message), name);
    }
    saveSettings(dir, { allowedAI: 'mercury' });
    await assert.rejects(makeNeedJudge('haiku', { workspace: dir }), e => e.code === 'NEED_JUDGE_NOT_ALLOWED' && /Allowed AI: mercury/.test(e.message));
    await assert.rejects(makeNeedJudge('opus', { workspace: dir }), e => e.code === 'NEED_JUDGE_CHOICE');
    assert.equal(existsSync(path.join(dir, 'need-journal.sqlite')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: need --judge and mcp --need-judge refuse without Allowed AI (exit 2, no journal); the code-only hint still answers at $0', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'need-ai-cli-'));
  const env = { PATH: process.env.PATH, HOME: dir, FOUNDRY_HOME: dir, NODE_NO_WARNINGS: '1' };
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args, '--workspace', dir], { encoding: 'utf8', env, timeout: 60_000, input: '' });
  try {
    const judged = cli('need', REQUEST, '--judge', 'haiku');
    assert.equal(judged.status, 2, judged.stderr);
    assert.match(judged.stderr, /Settings say no AI may judge your requests with haiku/);
    const hint = cli('need', REQUEST);
    assert.equal(hint.status, 0, hint.stderr);
    assert.match(hint.stdout, /decided by/);
    const mcp = cli('mcp', '--need-judge', 'mercury');
    assert.equal(mcp.status, 2, mcp.stderr);
    assert.match(mcp.stderr, /Settings say no AI may judge your requests with mercury/);
    assert.equal(existsSync(path.join(dir, 'need-journal.sqlite')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
