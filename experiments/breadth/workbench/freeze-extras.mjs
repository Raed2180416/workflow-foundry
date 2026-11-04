#!/usr/bin/env node
// Freeze the WorkBench extras (rule: extras.mjs, wb-extras-v1, committed alone in its own commit before its salt existed
// and before any WorkBench model run). This script only applies the rule:
//   1. the rule commit = the commit that added extras.mjs; extras.mjs must be byte-identical to it (git blob hash);
//   2. salt = the first orchestrator autosave ("WIP:") on the salt ref strictly after the rule commit's committer time;
//   3. reuse streams: 20 held-out templates (SPLIT.json) by the rule; per template the first 10 regenerated instances
//      (seed 8860, top-up 8861..8869) whose text is new (not shipped, not sealed or companion, not earlier in the stream)
//      and whose gold replays cleanly;
//   4. fault/drift subset: 20 units of the primary sealed manifest (state-changing instances), kinds in rotation;
//   5. write the committed record (EXTRAS.json: rule, salt, stream template ids, counts, per-stream reuse exposure, kind
//      counts, manifest hashes) and the host-only manifests (instances with gold): only their sha256 is committed.
//   node experiments/breadth/workbench/freeze-extras.mjs [--salt-ref REF] [--dry-run]
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { EXTRAS_RULE, FAULT_KINDS, faultUnits, pickExtrasSalt, pickStream, streamQuota, streamTemplates } from './extras.mjs';
import { HOST_ONLY, REPO, RESEARCH, bedJson, catalogFrom, readJson, readJsonl, sha256, shippedTasks, startWorld, writeJson, writeJsonl, BENCH } from './lib.mjs';
import { regen } from './regen-gate.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const git = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8' }).trim();
const RULE_FILE = 'experiments/breadth/workbench/extras.mjs';
export const EXTRAS_JSON = path.join(RESEARCH, 'EXTRAS.json');
export const EXTRAS_DIR = path.join(HOST_ONLY, 'extras');
export const STREAMS_MANIFEST = path.join(EXTRAS_DIR, 'STREAMS.json');
export const FAULTS_MANIFEST = path.join(EXTRAS_DIR, 'FAULTS.json');
export const manifestBytes = m => JSON.stringify(m);

export function extrasRuleCommit() {
  const lines = git('log', '--diff-filter=A', '--format=%H %ct', '--', RULE_FILE).split('\n').filter(Boolean);
  if (!lines.length) throw new Error('extras.mjs has no adding commit (commit the rule first)');
  const [sha, ct] = lines.at(-1).split(' ');
  const committed = git('rev-parse', `${sha}:${RULE_FILE}`), now = git('hash-object', RULE_FILE);
  if (committed !== now) throw new Error(`extras.mjs changed since the rule commit ${sha.slice(0, 12)} (${committed} != ${now})`);
  return { sha, epoch: Number(ct), blob: committed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dry = argv.includes('--dry-run');
  const rule = extrasRuleCommit();
  const saltRef = opt('salt-ref', EXTRAS_RULE.saltSource.ref);
  const salt = pickExtrasSalt(git('log', '--format=%H %ct %s', saltRef).split('\n').filter(Boolean), rule.epoch);
  if (!salt) { console.error('no autosave after the extras-rule commit yet: the salt does not exist; nothing frozen'); process.exit(2); }
  const split = readJson(path.join(RESEARCH, 'SPLIT.json'));
  const sealed = readJson(path.join(HOST_ONLY, 'sealed/MANIFEST.json'));
  if (sha256(JSON.stringify(sealed)) !== split.sealed.manifestSha256) throw new Error('sealed manifest hash differs from SPLIT.json');
  const companion = existsSync(path.join(HOST_ONLY, 'sealed/COMPANION.json')) ? readJson(path.join(HOST_ONLY, 'sealed/COMPANION.json')) : { instances: [] };
  const shipped = await shippedTasks({ cwd: EXTRAS_DIR });

  // 1. streams
  const templates = streamTemplates(split.heldOutTemplates, salt.sha);
  const excluded = new Set([...shipped.map(t => t.task), ...sealed.instances.map(t => t.task), ...companion.instances.map(t => t.task)]);
  const seeds = [EXTRAS_RULE.streams.seed, ...EXTRAS_RULE.streams.topUpSeeds];
  const rowsBySeed = [], clean = new Set();
  let picks = null;
  for (const seed of seeds) {
    const g = await regen(seed, 'streams');
    const rows = readJsonl(g.file).filter(r => templates.includes(r.template_id));
    const dir = path.join(EXTRAS_DIR, 'work');
    const inFile = path.join(dir, `gold-${seed}.jsonl`), outFile = path.join(dir, `gold-${seed}-v.jsonl`);
    writeJsonl(inFile, rows.map(r => ({ id: r.id, key: r.id, actions: r.outcome })));
    await bedJson(['replay', '--tasks', g.file, '--in', inFile, '--out', outFile], { cwd: dir });
    for (const v of readJsonl(outFile)) if (v.executes && v.correct && v.equivalent_raw) clean.add(v.id);
    rowsBySeed.push([seed, rows]);
    picks = Object.fromEntries(templates.map(t => [t, pickStream(t, rowsBySeed, excluded, clean)]));
    if (Object.values(picks).every(p => p.taken.length >= EXTRAS_RULE.streams.perStream)) break;
  }
  const short = Object.entries(picks).filter(([, p]) => p.taken.length < EXTRAS_RULE.streams.perStream).map(([t]) => t);
  const streams = templates.map(t => ({ template_id: t, domain: t.split('/')[0], instances: picks[t].taken.map(i => ({ id: i.id, seed: i.seed, domain: i.domain, template_id: i.template_id,
    base_template: i.base_template, chosen_template: i.chosen_template, task: i.task, domains: i.domains, outcome: i.outcome })) }));
  const streamManifest = { bed: split.bed, rule: EXTRAS_RULE.version, salt: salt.sha, role: 'reuse streams (held out; regenerated, H2-ext by construction)', streams };
  const streamSha = sha256(manifestBytes(streamManifest));

  // 2. fault/drift units
  const liveDir = path.join(BENCH, 'live', `freeze-extras-${Date.now()}`);
  const world = startWorld(liveDir);
  await world.ready;
  const catalog = await catalogFrom(world);
  await world.close();
  rmSync(liveDir, { recursive: true, force: true });
  const writeTools = new Set(catalog.bedTools.filter(t => t.write).map(t => t.bedName));
  const units = faultUnits(sealed.instances, salt.sha, writeTools);
  const faultManifest = { bed: split.bed, rule: EXTRAS_RULE.version, salt: salt.sha, role: 'fault/drift subset (held out; paired with the same sealed instances run clean)', sealedManifestSha256: split.sealed.manifestSha256, units };
  const faultSha = sha256(manifestBytes(faultManifest));

  const record = {
    rule: EXTRAS_RULE.version, bed: split.bed, ruleFile: RULE_FILE, ruleCommit: rule.sha, ruleCommitEpoch: rule.epoch, ruleBlob: rule.blob,
    salt: { sha: salt.sha, epoch: salt.epoch, subject: salt.subject, ref: saltRef, secondsAfterRule: salt.epoch - rule.epoch },
    splitSha256: split.splitSha256,
    streams: { n: streams.length, perStream: EXTRAS_RULE.streams.perStream, quotaPerDomain: streamQuota(split.heldOutTemplates), templates,
      seedsUsed: [...new Set(streams.flatMap(s => s.instances.map(i => i.seed)))].sort(), short,
      skipped: Object.values(picks).reduce((a, p) => ({ textDuplicate: a.textDuplicate + p.skipped.textDuplicate, goldNotClean: a.goldNotClean + p.skipped.goldNotClean }), { textDuplicate: 0, goldNotClean: 0 }),
      reuseExposure: Object.fromEntries(templates.map(t => [t, { n: picks[t].taken.length, distinctGold: picks[t].distinctGold, differFromFirst: picks[t].differFromFirst, emptyGold: picks[t].taken.filter(i => !i.outcome.length).length }])),
      manifestSha256: streamSha, manifestLocation: 'host-only: /var/tmp/foundry-work/benches/workbench/host-only/extras/STREAMS.json; content never committed' },
    faults: { n: units.length, kinds: Object.fromEntries(FAULT_KINDS.map(k => [k, units.filter(u => u.fault.kind === k).length])),
      manifestSha256: faultSha, manifestLocation: 'host-only: /var/tmp/foundry-work/benches/workbench/host-only/extras/FAULTS.json; content never committed' },
    access: 'Both sets are held out: no dev work reads them; their runs happen after the portfolio dev gate (PLAN §4.3 T1-1 Extras), with --sealed-ack.',
  };
  record.extrasSha256 = sha256(JSON.stringify({ rule: record.rule, salt: salt.sha, templates, streamsManifestSha256: streamSha, faultsManifestSha256: faultSha }));
  if (dry) { console.log(JSON.stringify({ ...record, streams: { ...record.streams, reuseExposure: undefined } }, null, 1)); process.exit(0); }
  if (existsSync(EXTRAS_JSON)) {
    const prev = readJson(EXTRAS_JSON);
    if (prev.extrasSha256 !== record.extrasSha256) throw new Error(`EXTRAS.json already frozen with different extras (${prev.extrasSha256} != ${record.extrasSha256}); refusing to overwrite`);
  }
  writeJson(STREAMS_MANIFEST, streamManifest);
  writeJson(FAULTS_MANIFEST, faultManifest);
  if (sha256(manifestBytes(readJson(STREAMS_MANIFEST))) !== streamSha || sha256(manifestBytes(readJson(FAULTS_MANIFEST))) !== faultSha) throw new Error('manifest round-trip hash differs');
  writeJson(EXTRAS_JSON, record);
  console.log(JSON.stringify({ extrasSha256: record.extrasSha256, salt: salt.sha, streams: { n: streams.length, short, seedsUsed: record.streams.seedsUsed }, faults: record.faults }, null, 1));
}
