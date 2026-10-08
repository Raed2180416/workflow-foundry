import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { REPO } from '../kit.mjs';
import { skipReason } from './helpers.mjs';

const CLI = path.join(REPO, 'experiments/heal/heal.mjs');
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: REPO, timeout: 100000 });

test('the CLI prints its usage and exits 2 without --run and --workflow', () => {
  const r = run();
  assert.equal(r.status, 2); assert.match(r.stderr, /usage: heal.mjs --run/);
});

test('the CLI refuses an unknown run and a sealed family before touching any journal', { skip: skipReason }, () => {
  const r = run('--run', 'no-such-run', '--workflow', 'research/construction-20261006/artifacts/F-haiku-codefix-k1/workflow.json', '--budget-usd', '0');
  assert.equal(r.status, 1); assert.match(r.stderr, /HEAL_TRIAL_UNKNOWN/);
});

test('the CLI localises the codefix incident offline and prints a heal-run record without task text', { skip: skipReason }, () => {
  const r = run('--run', 'F-haiku/codefix:test:d3:s6001/0', '--workflow', 'research/construction-20261006/artifacts/F-haiku-codefix-k1/workflow.json', '--budget-usd', '0', '--no-vacuity',
    '--runs', '/var/tmp/foundry-work/heal-scratch/cli-runs', '--state', '/var/tmp/foundry-work/heal-scratch/cli-state', '--lineage-file', '/var/tmp/foundry-work/heal-scratch/cli-lineage.jsonl');
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.schema, 'heal-run/1'); assert.equal(out.fidelity.identical, true); assert.equal(out.localisation.root.node, 'check1');
  assert.equal(out.mode.live, false); assert.equal(out.mode.promote, false); assert.equal(out.budget.spentUsd, 0);
  assert.equal(out.head.version, 1, 'a dry run promotes nothing');
  assert.ok(!/def main|patched_source":/.test(r.stdout.replace(/"allowed"[^]*?\]/, '')), 'no source or task text in the record');
});
