#!/usr/bin/env node
// SOP-Bench dev/sealed split (research/sopbench-20261021/SPLIT.json). Per SOP, a seeded permutation of the upstream
// task ids (0-based rows of test_set_with_outputs.csv): the first 5 are BUILD rows (what a builder may see), the next
// `repair` rows are REPAIR rows (dev rows a frozen-before-sealed workflow may be repaired on), the rest are SEALED.
// repair = min(15, max(0, floor(n / 4) - 5)), so dev rows are at most 20 and never more than a quarter of an SOP.
// No label or row content steers the split; each row's content hash is recorded so a changed dataset is detected.
//
//   node experiments/sopbench/split.mjs --write         (creates SPLIT.json; refuses to overwrite an existing split)
//   node experiments/sopbench/split.mjs --check         (recomputes from the pinned clone and compares)
// The bridge (bridge.py load_split/allowed_rows) and run.mjs (assertRows) refuse sealed rows unless --sealed is given
// with a freeze file that names this split's sha256.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { RESEARCH, SPLIT_FILE, UPSTREAM_PIN, bridgeOk, canon, readJson, shaCanon, shuffled, writeJson } from './lib.mjs';
import { WORK_ROOT } from '../../src/executors/claude-code.mjs';

export const SEED = 'sopbench-20261021-split-v1';
export const BUILD = 5;
export const repairCount = n => Math.min(15, Math.max(0, Math.floor(n / 4) - BUILD));

export function splitOne(name, n, seed = SEED) {
  const perm = shuffled(Array.from({ length: n }, (_, i) => i), `${seed}:${name}`);
  const r = repairCount(n);
  const sort = a => [...a].sort((x, y) => x - y);
  return { build: sort(perm.slice(0, BUILD)), repair: sort(perm.slice(BUILD, BUILD + r)), sealed: sort(perm.slice(BUILD + r)) };
}

export function makeSplit(rows, { seed = SEED, createdAt = new Date().toISOString().slice(0, 10) } = {}) {
  const sops = {};
  for (const [name, info] of Object.entries(rows).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const s = splitOne(name, info.n, seed);
    sops[name] = { n: info.n, outputColumns: info.output_columns, testFileSha256: info.testFileSha256, rowsSha256: shaCanon(info.rowHashes),
      ...s, buildSha256: shaCanon(s.build), repairSha256: shaCanon(s.repair), sealedSha256: shaCanon(s.sealed) };
  }
  const lists = Object.fromEntries(Object.entries(sops).map(([k, e]) => [k, { build: e.build, repair: e.repair, sealed: e.sealed }]));
  return {
    kind: 'sopbench-split', version: 1, createdAt, seed,
    method: 'per SOP: mulberry32(sha256(seed + ":" + sop)) Fisher-Yates permutation of row ids 0..n-1; build = first 5, repair = next min(15, max(0, floor(n/4) - 5)), sealed = rest; each list sorted ascending',
    upstream: UPSTREAM_PIN, splitSha256: shaCanon(lists), sops,
  };
}

/** Load and verify SPLIT.json (each list against its hash, the lists against splitSha256). */
export function loadSplit(file = SPLIT_FILE) {
  const s = readJson(file);
  for (const [name, e] of Object.entries(s.sops)) for (const k of ['build', 'repair', 'sealed']) {
    if (shaCanon(e[k]) !== e[`${k}Sha256`]) throw new Error(`SPLIT ${name}.${k}: list does not match its sha256`);
  }
  const lists = Object.fromEntries(Object.entries(s.sops).map(([k, e]) => [k, { build: e.build, repair: e.repair, sealed: e.sealed }]));
  if (shaCanon(lists) !== s.splitSha256) throw new Error('SPLIT: splitSha256 does not match the lists');
  return s;
}

/** The dev rows of an SOP in the order a run uses them: build rows first, then repair rows. */
export const devRows = (split, sop) => [...split.sops[sop].build, ...split.sops[sop].repair];

/** Refuse sealed rows unless sealed=true with a freeze file naming this split (the bridge checks again). */
export function assertRows(split, sop, rows, { sealed = false, freeze = null } = {}) {
  const e = split.sops[sop];
  if (!e) throw new Error(`${sop} is not in the split`);
  if (sealed) {
    if (!freeze || !existsSync(freeze)) throw new Error('--sealed needs --freeze <file>');
    const f = JSON.parse(readFileSync(freeze, 'utf8'));
    if (f.kind !== 'sopbench-freeze' || f.splitSha256 !== split.splitSha256 || !(f.sops ?? []).includes(sop)) throw new Error(`freeze file does not freeze ${sop} on this split`);
    return;
  }
  const dev = new Set([...e.build, ...e.repair]);
  const bad = rows.filter(r => !dev.has(r));
  if (bad.length) throw new Error(`${sop}: row(s) ${bad.slice(0, 5).join(',')} are sealed; sealed rows need --sealed --freeze`);
}

async function rowsFromClone() {
  const live = path.join(WORK_ROOT, 'sopbench', 'split-rows');
  const r = await bridgeOk(['rows'], { liveDir: live, withSplit: false });
  return JSON.parse(r.stdout.split('\n').filter(l => l.startsWith('{')).pop());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  if (arg === '--write') {
    if (existsSync(SPLIT_FILE)) throw new Error(`${SPLIT_FILE} exists: a split is frozen once (rerun --check)`);
    const s = makeSplit(await rowsFromClone());
    writeJson(SPLIT_FILE, s);
    console.log(`wrote ${path.relative(process.cwd(), SPLIT_FILE)} splitSha256=${s.splitSha256}`);
  } else if (arg === '--check') {
    const s = loadSplit();
    const again = makeSplit(await rowsFromClone(), { createdAt: s.createdAt });
    const same = canon(again) === canon(s);
    console.log(same ? `ok: SPLIT.json reproduces from the pinned clone (splitSha256 ${s.splitSha256})` : 'MISMATCH: SPLIT.json does not reproduce');
    if (!same) process.exit(1);
  } else {
    console.error('usage: node experiments/sopbench/split.mjs --write | --check');
    process.exit(2);
  }
}
export { RESEARCH };
