#!/usr/bin/env node
// AgentDojo frozen held-out split: the CLI (the rule itself is split-rule.mjs, frozen by the commit that added it).
//
//   node experiments/breadth/agentdojo/split.mjs --write    (once: needs the rule commit and its beacon round)
//   node experiments/breadth/agentdojo/split.mjs --check    (recomputes SPLIT.json from the recorded salt; with --beacon
//                                                           also re-fetches the round from drand and compares)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { REPO, RESEARCH, SPLIT_FILE, canon, readJson, runBridge, writeJson } from './lib.mjs';
import { SPLIT_RULE, buildSplit, roundAt, roundTime } from './split-rule.mjs';

export * from './split-rule.mjs';

/** Load SPLIT.json and verify it against the rule (recomputed from its recorded salt). */
export function loadSplit(file = SPLIT_FILE) {
  const s = readJson(file);
  const bySuite = Object.fromEntries(Object.entries(s.suites).map(([k, e]) => [k, [...e.dev, ...e.heldOut]]));
  const again = buildSplit(bySuite, { ruleCommit: s.ruleCommit, ruleCommitTime: s.ruleCommitTime, beaconRound: { round: s.beacon.round, randomness: s.beacon.randomness, signature: s.beacon.signature } });
  if (again.splitSha256 !== s.splitSha256 || canon(again.suites) !== canon(s.suites)) throw new Error('SPLIT.json does not reproduce from its salt');
  if (sha256Hex(s.beacon.signature) !== s.beacon.randomness) throw new Error('beacon randomness is not sha256(signature)');
  if (s.beacon.round !== roundAt(s.ruleCommitTime)) throw new Error('beacon round is not the one the rule names for the rule commit');
  return s;
}
const sha256Hex = hex => createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex');

export const isDev = (split, suite, userTask) => split.suites[suite]?.dev.includes(userTask) ?? false;
export const isHeldOut = (split, suite, userTask) => split.suites[suite]?.heldOut.includes(userTask) ?? false;

const git = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8' }).trim();
/** The split-rule commit: the commit that added split-rule.mjs; the working copy must equal it. */
export function ruleCommitInfo() {
  const rel = path.relative(REPO, new URL('./split-rule.mjs', import.meta.url).pathname);
  const added = git('log', '--diff-filter=A', '--format=%H %ct', '--', rel).split('\n').filter(Boolean).pop();
  if (!added) throw new Error(`${rel} is not committed: commit the rule first`);
  const [sha, ct] = added.split(' ');
  const blob = git('rev-parse', `${sha}:${rel}`);
  const now = git('hash-object', rel);
  if (blob !== now) throw new Error(`${rel} differs from the split-rule commit ${sha}: the rule cannot change after it is committed`);
  return { sha, time: Number(ct) };
}

async function fetchRound(r) {
  const res = await fetch(`${SPLIT_RULE.beacon.url}${r}`);
  if (!res.ok) throw new Error(`drand round ${r}: HTTP ${res.status}`);
  const j = await res.json();
  if (j.round !== r || sha256Hex(j.signature) !== j.randomness) throw new Error(`drand round ${r}: malformed or inconsistent`);
  return { round: j.round, randomness: j.randomness, signature: j.signature };
}

async function populationFromBridge() {
  const live = '/var/tmp/foundry-work/agentdojo-live/split';
  const out = path.join(live, 'inventory.json');
  const r = await runBridge(['inventory', '--out', out], { liveDir: live });
  if (r.code !== 0) throw new Error(`inventory failed: ${r.stderr.slice(-500)}`);
  const inv = readJson(out);
  return Object.fromEntries(Object.entries(inv.suites).map(([s, v]) => [s, v.userTasks]));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  if (cmd === '--write') {
    if (existsSync(SPLIT_FILE)) throw new Error(`${SPLIT_FILE} exists: the split is frozen once (use --check)`);
    const rule = ruleCommitInfo();
    const r = roundAt(rule.time);
    const wait = roundTime(r) - Math.floor(Date.now() / 1000);
    if (wait > 0) { console.error(`waiting ${wait + 5} s for beacon round ${r}`); await new Promise(res => setTimeout(res, (wait + 5) * 1000)); }
    const beaconRound = await fetchRound(r);
    const s = buildSplit(await populationFromBridge(), { ruleCommit: rule.sha, ruleCommitTime: rule.time, beaconRound });
    s.createdAt = new Date().toISOString();
    writeJson(SPLIT_FILE, s);
    console.log(JSON.stringify({ wrote: path.relative(REPO, SPLIT_FILE), splitSha256: s.splitSha256, counts: s.counts, round: r }));
  } else if (cmd === '--check') {
    const s = loadSplit();
    const pop = await populationFromBridge();
    const again = buildSplit(pop, { ruleCommit: s.ruleCommit, ruleCommitTime: s.ruleCommitTime, beaconRound: { round: s.beacon.round, randomness: s.beacon.randomness, signature: s.beacon.signature } });
    let ok = again.splitSha256 === s.splitSha256;
    if (process.argv.includes('--beacon')) { const b = await fetchRound(s.beacon.round); ok &&= b.randomness === s.beacon.randomness; }
    console.log(ok ? `ok: SPLIT.json reproduces (splitSha256 ${s.splitSha256})` : 'MISMATCH');
    if (!ok) process.exit(1);
  } else {
    console.error('usage: node experiments/breadth/agentdojo/split.mjs --write | --check [--beacon]');
    process.exit(2);
  }
}
export { RESEARCH };
