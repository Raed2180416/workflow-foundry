#!/usr/bin/env node
// Freeze the WorkBench held-out split (rule: split.mjs, wb-split-v1, committed in its own commit before any salt existed
// and before any model run). This script only applies the rule:
//   1. the rule commit = the commit that added split.mjs; split.mjs must be byte-identical to it (git blob hash);
//   2. salt = pickSalt(the salt ref's log, the rule commit's committer time): the first orchestrator autosave after it;
//   3. split the 69 pinned templates (29 dev, 40 held out);
//   4. sealed instances, per split.mjs: WorkBench's own generators (seed 8850, top-up 8851..8859; H2-ext selection) when
//      seed control verifies AND regeneration changes the answers (bed-level answer-changed share >= 0.8); otherwise the
//      shipped instances of the held-out templates (H4) by ascending sha256(salt + instance id). When the shipped set is
//      primary, the regenerated selection is frozen beside it as the fresh companion set for the contamination check
//      (PLAN §5.5 item 2: shipped vs regenerated difference in differences); it is not the primary sealed set;
//   5. write the committed record (SPLIT.json: template lists, counts, hashes) and the host-only manifests (instances
//      with gold, outside the repository); only their sha256 is committed.
//   node experiments/breadth/workbench/freeze-split.mjs [--salt-ref REF] [--dry-run]
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { answerChange, regen } from './regen-gate.mjs';
import { HOST_ONLY, REPO, RESEARCH, bedJson, readJson, readJsonl, sha256, shippedTasks, writeJson, writeJsonl } from './lib.mjs';
import { SPLIT_RULE, domainOf, pickSalt, sealedQuota, shippedSealedPick, splitTemplates, templateIdsSha256 } from './split.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const git = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8' }).trim();
const SPLIT_FILE = 'experiments/breadth/workbench/split.mjs';
export const SPLIT_JSON = path.join(RESEARCH, 'SPLIT.json');
export const SEALED_DIR = path.join(HOST_ONLY, 'sealed');
export const SEALED_MANIFEST = path.join(SEALED_DIR, 'MANIFEST.json');
export const SEALED_COMPANION = path.join(SEALED_DIR, 'COMPANION.json');

/** Canonical bytes of a manifest (what its committed sha256 covers). */
export const manifestBytes = m => JSON.stringify(m);

export function ruleCommit() {
  const lines = git('log', '--diff-filter=A', '--format=%H %ct', '--', SPLIT_FILE).split('\n').filter(Boolean);
  if (!lines.length) throw new Error('split.mjs has no adding commit (commit the rule first)');
  const [sha, ct] = lines.at(-1).split(' ');
  const committed = git('rev-parse', `${sha}:${SPLIT_FILE}`), now = git('hash-object', SPLIT_FILE);
  if (committed !== now) throw new Error(`split.mjs changed since the rule commit ${sha.slice(0, 12)} (${committed} != ${now})`);
  return { sha, epoch: Number(ct), blob: committed };
}

export function saltFrom(ref, ruleEpoch) {
  const lines = git('log', '--format=%H %ct %s', ref).split('\n').filter(Boolean);
  return pickSalt(lines, ruleEpoch);
}

/** H2-ext selection for one held-out template from regenerated rows (seeds in order, generator order within a seed). */
export function pickRegenerated(templateId, rowsBySeed, shippedTexts, cleanIds, quota) {
  const taken = [], skipped = { textDuplicate: 0, goldNotClean: 0 };
  for (const [seed, rows] of rowsBySeed) {
    for (const r of rows) {
      if (taken.length >= quota) break;
      if (r.template_id !== templateId) continue;
      if (shippedTexts.has(r.task) || taken.some(t => t.task === r.task)) { skipped.textDuplicate++; continue; }
      if (!cleanIds.has(r.id)) { skipped.goldNotClean++; continue; }
      taken.push({ ...r, seed });
    }
    if (taken.length >= quota) break;
  }
  return { taken, skipped };
}

/** The rule's choice of the primary sealed set. */
export function choosePrimary({ seedControl, regenerated }) {
  return Boolean(seedControl && regenerated && regenerated.bedLabel === 'H2-ext' && !regenerated.short.length);
}

async function regeneratedSelection({ heldOut, quotaOf, totalQuota, shipped }) {
  const seeds = [SPLIT_RULE.sealed.seed, ...SPLIT_RULE.sealed.topUpSeeds];
  const rowsBySeed = [];
  const shippedTextsBy = new Map();
  for (const t of shipped) { if (!shippedTextsBy.has(t.template_id)) shippedTextsBy.set(t.template_id, new Set()); shippedTextsBy.get(t.template_id).add(t.task); }
  let picks = null;
  for (const seed of seeds) {
    const g = await regen(seed, 'sealed');
    const rows = readJsonl(g.file);
    // evaluator-level clean-replay check of every candidate's gold (bed replay: executes, is_correct(gold, gold), and the
    // independent full-state replay equals it)
    const dir = path.join(SEALED_DIR, 'work');
    const inFile = path.join(dir, `gold-${seed}.jsonl`), outFile = path.join(dir, `gold-${seed}-v.jsonl`);
    writeJsonl(inFile, rows.map(r => ({ id: r.id, key: r.id, actions: r.outcome })));
    await bedJson(['replay', '--tasks', g.file, '--in', inFile, '--out', outFile], { cwd: dir });
    const clean = new Set(readJsonl(outFile).filter(v => v.executes && v.correct && v.equivalent_raw).map(v => v.id));
    rowsBySeed.push([seed, rows, clean]);
    const cleanAll = new Set(rowsBySeed.flatMap(([, , c]) => [...c]));
    picks = Object.fromEntries(heldOut.map(id => [id, pickRegenerated(id, rowsBySeed.map(([s, r]) => [s, r]), shippedTextsBy.get(id), cleanAll, quotaOf[id])]));
    if (Object.entries(picks).every(([id, p]) => p.taken.length >= quotaOf[id])) break;
  }
  const short = Object.entries(picks).filter(([id, p]) => p.taken.length < quotaOf[id]).map(([id]) => id);
  const instances = Object.values(picks).flatMap(p => p.taken);
  const ac = answerChange(instances, shipped);
  const templateLabels = Object.fromEntries(heldOut.map(id => [id, (ac.perTemplate[id]?.answerChanged ?? 0) >= SPLIT_RULE.sealed.h2ExtTemplateMin ? 'H2-ext' : 'H4']));
  const share = instances.length ? ac.answerChanged / instances.length : 0;
  const shippedGold = new Set(shipped.map(s => `${s.template_id}\u0000${JSON.stringify(s.outcome)}`));
  return { source: 'regenerated (H2-ext selection)', seedsUsed: [...new Set(instances.map(i => i.seed))].sort(), short, n: instances.length, quota: totalQuota, answerChanged: ac.answerChanged,
    answerChangedShare: Math.round(share * 1000) / 1000, bedLabel: share >= SPLIT_RULE.sealed.h2ExtBedShare ? 'H2-ext' : 'H4', templateLabels,
    skipped: Object.values(picks).reduce((a, p) => ({ textDuplicate: a.textDuplicate + p.skipped.textDuplicate, goldNotClean: a.goldNotClean + p.skipped.goldNotClean }), { textDuplicate: 0, goldNotClean: 0 }),
    instances: instances.map(i => ({ id: i.id, seed: i.seed, domain: i.domain, template_id: i.template_id, base_template: i.base_template, chosen_template: i.chosen_template, task: i.task, domains: i.domains, outcome: i.outcome,
      answerChanged: !shippedGold.has(`${i.template_id}\u0000${JSON.stringify(i.outcome)}`) })) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dry = argv.includes('--dry-run');
  const rule = ruleCommit();
  const saltRef = opt('salt-ref', SPLIT_RULE.saltSource.ref);
  const salt = saltFrom(saltRef, rule.epoch);
  if (!salt) { console.error('no autosave after the rule commit yet: the salt does not exist; nothing frozen'); process.exit(2); }
  const shipped = await shippedTasks({ cwd: path.join(HOST_ONLY, 'regen') });
  const templateIds = [...new Set(shipped.map(t => t.template_id))].sort();
  if (templateIdsSha256(templateIds) !== SPLIT_RULE.population.templateIdsSha256) throw new Error('template population differs from the pinned one');
  if (sha256([...shipped.map(t => t.id)].sort().join('\n')) !== SPLIT_RULE.population.instanceIdsSha256) throw new Error('instance population differs from the pinned one');
  const { dev, heldOut, order } = splitTemplates(templateIds, salt.sha);
  if (dev.length !== SPLIT_RULE.expected.dev || heldOut.length !== SPLIT_RULE.expected.heldOut) throw new Error(`split sizes ${dev.length}/${heldOut.length}`);
  const devSet = new Set(dev);
  const devInstances = shipped.filter(t => devSet.has(t.template_id)).map(t => t.id).sort();
  const heldOutShipped = shipped.filter(t => !devSet.has(t.template_id)).map(t => t.id).sort();

  const gate = existsSync(path.join(RESEARCH, 'REGEN-GATE.json')) ? readJson(path.join(RESEARCH, 'REGEN-GATE.json')) : null;
  const seedControl = Boolean(gate?.seedControlVerified);
  const quotaOf = Object.fromEntries(heldOut.map(id => [id, sealedQuota(id)]));
  const totalQuota = Object.values(quotaOf).reduce((a, b) => a + b, 0);
  const byId = new Map(shipped.map(t => [t.id, t]));
  const shippedIds = heldOut.flatMap(tid => shippedSealedPick(shipped.filter(t => t.template_id === tid).map(t => t.id), tid, salt.sha));
  const shippedSet = { source: 'shipped (H4)', n: shippedIds.length, quota: totalQuota, bedLabel: 'H4', instances: shippedIds.map(id => byId.get(id)) };
  const regenerated = seedControl ? await regeneratedSelection({ heldOut, quotaOf, totalQuota, shipped }) : null;
  const h2 = choosePrimary({ seedControl, regenerated });
  const sealed = h2 ? regenerated : shippedSet;
  const companion = h2 ? null : regenerated;

  const manifest = { bed: SPLIT_RULE.bed, rule: SPLIT_RULE.version, salt: salt.sha, role: 'primary sealed set', heldOutTemplates: heldOut, ...sealed };
  const manifestSha = sha256(manifestBytes(manifest));
  const companionManifest = companion ? { bed: SPLIT_RULE.bed, rule: SPLIT_RULE.version, salt: salt.sha, role: 'fresh companion set (contamination check); not the primary sealed set', heldOutTemplates: heldOut, ...companion } : null;
  const companionSha = companionManifest ? sha256(manifestBytes(companionManifest)) : null;
  const strata = {};
  for (const i of manifest.instances) { const d = domainOf(i.template_id); strata[d] = (strata[d] ?? 0) + 1; }
  const record = {
    rule: SPLIT_RULE.version, bed: SPLIT_RULE.bed, ruleFile: SPLIT_FILE, ruleCommit: rule.sha, ruleCommitEpoch: rule.epoch, ruleBlob: rule.blob,
    salt: { sha: salt.sha, epoch: salt.epoch, subject: salt.subject, ref: saltRef, secondsAfterRule: salt.epoch - rule.epoch },
    population: SPLIT_RULE.population,
    counts: { devTemplates: dev.length, heldOutTemplates: heldOut.length, devInstancesShipped: devInstances.length, heldOutInstancesShipped: heldOutShipped.length,
      perDomain: Object.fromEntries(Object.entries(order).map(([d, ids]) => [d, { templates: ids.length, dev: ids.filter(x => devSet.has(x)).length, heldOut: ids.filter(x => !devSet.has(x)).length }])) },
    devTemplates: dev, heldOutTemplates: heldOut, orderWithinDomain: order,
    devInstancesSha256: sha256(devInstances.join('\n')), heldOutShippedInstancesSha256: sha256(heldOutShipped.join('\n')),
    seedControlVerified: seedControl,
    sealed: { source: sealed.source, bedLabel: sealed.bedLabel, n: sealed.n, quota: sealed.quota, perDomain: strata,
      why: h2 ? 'seed control verified and regeneration changed the answers' : regenerated
        ? `seed control verified, but regeneration changed the answers of only ${regenerated.answerChanged}/${regenerated.n} (${regenerated.answerChangedShare}) H2-ext-selected instances, below the rule's ${SPLIT_RULE.sealed.h2ExtBedShare}: the shipped instances (H4) are the sealed set`
        : 'seed control not verified: the shipped instances (H4) are the sealed set',
      manifestSha256: manifestSha, manifestBytes: Buffer.byteLength(manifestBytes(manifest)), manifestLocation: 'host-only: /var/tmp/foundry-work/benches/workbench/host-only/sealed/MANIFEST.json; content never committed' },
    regeneratedSelection: regenerated ? { role: h2 ? 'primary sealed set' : 'fresh companion set (contamination check, PLAN §5.5 item 2); not the primary sealed set; its use needs its own arm runs and is decided with the portfolio dev gate',
      n: regenerated.n, answerChanged: regenerated.answerChanged, answerChangedShare: regenerated.answerChangedShare, bedLabel: regenerated.bedLabel, seedsUsed: regenerated.seedsUsed, short: regenerated.short,
      skipped: regenerated.skipped, templatesLabelledH2ext: Object.values(regenerated.templateLabels).filter(l => l === 'H2-ext').length, templateLabels: regenerated.templateLabels,
      manifestSha256: h2 ? manifestSha : companionSha, manifestLocation: h2 ? 'MANIFEST.json' : 'host-only: /var/tmp/foundry-work/benches/workbench/host-only/sealed/COMPANION.json; content never committed' } : null,
    access: 'Dev work (kit iteration, bed card, screens, probe battery, F-kit dev looks, the Haiku 4.5 parity anchor) uses dev templates only. The shipped instances of held-out templates are public (H4) and are the sealed set; they are not used for dev. Sealed runs happen once, after the portfolio dev gate.',
  };
  record.splitSha256 = sha256(JSON.stringify({ rule: record.rule, salt: record.salt.sha, dev, heldOut, sealedManifestSha256: manifestSha, companionManifestSha256: companionSha }));
  if (dry) { console.log(JSON.stringify({ ...record, orderWithinDomain: undefined, devTemplates: dev.length, heldOutTemplates: heldOut.length, regeneratedSelection: record.regeneratedSelection && { ...record.regeneratedSelection, templateLabels: undefined } }, null, 1)); process.exit(0); }
  if (existsSync(SPLIT_JSON)) {
    const prev = readJson(SPLIT_JSON);
    if (prev.splitSha256 !== record.splitSha256) throw new Error(`SPLIT.json already frozen with a different split (${prev.splitSha256} != ${record.splitSha256}); refusing to overwrite`);
  }
  writeJson(SEALED_MANIFEST, manifest);
  if (sha256(manifestBytes(readJson(SEALED_MANIFEST))) !== manifestSha) throw new Error('manifest round-trip hash differs');
  if (companionManifest) { writeJson(SEALED_COMPANION, companionManifest); if (sha256(manifestBytes(readJson(SEALED_COMPANION))) !== companionSha) throw new Error('companion round-trip hash differs'); }
  writeJson(SPLIT_JSON, record);
  console.log(JSON.stringify({ splitSha256: record.splitSha256, salt: salt.sha, dev: dev.length, heldOut: heldOut.length, sealed: record.sealed,
    regenerated: record.regeneratedSelection && { ...record.regeneratedSelection, templateLabels: undefined } }, null, 1));
}
