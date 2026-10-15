// MEM-0 cache share (MEMORY-ROUTING-RECURSION §3.2, §5 row 2; F17): the per-arm prompt-cache read share has the gateway
// Ledger's formula, sums usage per arm, and prints per mode for a label-run output directory. $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Ledger } from '../../lib/services.mjs';
import { addUsage, cacheReadShare, cacheShareCell, perArm, zeroUsage } from '../cache-share.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('cache share: the Ledger formula over summed usage; null without prompt tokens', () => {
  const calls = [{ inputTokens: 100, outputTokens: 7, cacheReadTokens: 2700, cacheWriteTokens: 1200 }, { inputTokens: 3, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, { inputTokens: 'x' }];
  const ledger = new Ledger({ capUsd: 1, label: 'parity' });
  for (const u of calls) ledger.charge({ costUsd: 0, usage: u });
  const u = calls.reduce((acc, c) => addUsage(acc, c), zeroUsage());
  assert.deepEqual(u, { inputTokens: 103, outputTokens: 8, cacheReadTokens: 2700, cacheWriteTokens: 1200 });
  assert.equal(cacheReadShare(u), ledger.cacheReadShare());
  assert.equal(cacheReadShare(u), 0.6745);
  assert.equal(cacheReadShare(zeroUsage()), null); assert.equal(cacheReadShare(null), null);
  assert.equal(cacheShareCell(u), '67.5% of 4,003'); assert.equal(cacheShareCell(zeroUsage()), '–');
});

test('cache share per arm (mode) from label-run rows and builds; the CLI prints it', t => {
  const rows = [{ mode: 'direct-H', tokens: { inputTokens: 900, cacheReadTokens: 0, cacheWriteTokens: 100 } }, { mode: 'agent-H', tokens: { inputTokens: 10, cacheReadTokens: 800, cacheWriteTokens: 190 } },
    { mode: 'agent-H', tokens: null }, { tokens: { inputTokens: 5 } }];
  const by = perArm(rows);
  assert.deepEqual(Object.keys(by), ['agent-H', 'direct-H']);
  assert.equal(by['agent-H'].cacheReadShare, 0.8); assert.equal(by['direct-H'].cacheReadShare, 0);
  const dir = mkdtempSync(path.join(tmpdir(), 'cache-share-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, 'rows.jsonl'), rows.slice(0, 2).map(r => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(path.join(dir, 'builds.final.jsonl'), JSON.stringify({ mode: 'construct-H', tokens: { inputTokens: 50, cacheReadTokens: 150, cacheWriteTokens: 0 } }) + '\n');
  const r = spawnSync(process.execPath, [path.join(HERE, '../cache-share.mjs'), dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /agent-H +cache read share 80\.0% of 1,000/); assert.match(r.stdout, /construct-H +cache read share 75\.0% of 200/); assert.match(r.stdout, /direct-H +cache read share 0\.0% of 1,000/);
});
