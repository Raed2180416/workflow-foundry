#!/usr/bin/env node
// Engine compatibility ranges (research/engine-20261021/ENGINE-BUMP.md §1): the maintainer's release helper. Read-only.
//
//   node tools/engine-lineage.mjs                 this engine: hash, version, resumesFrom and its predecessor entry (to freeze)
//   node tools/engine-lineage.mjs --check HASH    what this engine knows about a recorded engine hash (a run's engineHash)
//
// Cutting engine version N+1: (1) before changing anything, run this on version N and copy its `predecessor` object into
// src/engine-lineage.json `predecessors`; (2) set `version` to N+1 and `resumesFrom` to the oldest version whose runs N+1 may
// resume after review (N+1 itself when it may not resume any); (3) list the changes. A run's chain then records engine.migrated
// when it resumes across versions; anything outside the range stays ENGINE_DRIFT.
import { engineIdentity, engineOf } from '../src/engine.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--check');
if (at >= 0) {
  const hash = args[at + 1] ?? '';
  if (!/^[0-9a-f]{64}$/.test(hash)) { console.error('--check needs a 64-hex engine hash'); process.exit(2); }
  console.log(JSON.stringify({ hash, known: engineOf(hash) }, null, 1));
} else {
  const id = engineIdentity();
  console.log(JSON.stringify({ hash: id.hash, version: id.version, resumesFrom: id.resumesFrom,
    platform: { node: id.node, platform: id.platform, architecture: id.architecture, validator: id.validator },
    predecessor: { version: id.version, source: 'commit <sha> (<date>)', files: id.files } }, null, 1));
}
