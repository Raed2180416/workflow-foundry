#!/usr/bin/env node
// CI-1 review-arm runner (research/ci1-20261021/r/PREREG-CI1-R.md). One arm, one wave, K builds per item, with the wave's own frozen
// item loader, question loop and scorer (wave 1: run-arm.mjs runOne, oracle v1 recorded, v2 by experiments/ci1-posthoc/rescore.mjs;
// wave 2: run-w2.mjs runOne2, oracle v2 recorded, w2x by rescore-w2x.mjs). What is new here, and only here:
//   - account isolation (review finding 6; research/ci1-20261021/r/ACCOUNT-PROBE.md): the account variables are removed from this
//     process and every `claude -p` child runs with an empty throwaway CLAUDE_CONFIG_DIR, which removes the account address from the
//     model's context (removing the variables alone does not);
//   - records are scrubbed of non-fixture addresses BEFORE they are written; at the end the journal is checked for the account address
//     (kept in memory, never printed or written) and scrubbed in place if it is there; the summary reports both counts;
//   - a disk check before each build (finding 10): under 1.2 GB free the runner stops launching builds and exits 75 (resume later);
//   - the run refuses unless research/ci1-20261021/r/MANIFEST-R.json and the wave's own manifest both match.
//
//   CI1_BED=/var/tmp/foundry-work/ci1-20261021/bed     node experiments/ci1-r/run-r.mjs --wave 1 --arm A2b --label test-R-A2b [--k 3] ...
//   CI1_BED=/var/tmp/foundry-work/ci1-20261021/bed-w2  node experiments/ci1-r/run-r.mjs --wave 2 --arm A2b --label w2-R-A2b  [--k 3] ...
//        [--items a,b] [--concurrency 2] [--cap-usd 1.5] [--resume]
//   Development smoke (wave 1 dev split only, label dev-R-*, never scored as evidence): --wave 1 --split dev --label dev-R-... --no-manifest
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createModelPort } from '../lib/models.mjs';
import { BED } from '../ci1/bed.mjs';
import { loadBedItem, runOne, scrubAddresses } from '../ci1/run-arm.mjs';
import { loadItem2, runOne2, summaryRow } from '../ci1-w2/run-w2.mjs';
import { makeBuilderFactoryR, R_ARMS } from './builders-r.mjs';
import { stripAccountIdentity, diskStop } from './env-guard.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
export const RUNS = process.env.CI1_RUNS ?? '/var/tmp/foundry-work/ci1-20261021/runs';
export const SUMMARIES = path.join(root, 'research/ci1-20261021/runs');
export const MANIFEST_R = path.join(root, 'research/ci1-20261021/r/MANIFEST-R.json');
const sha = t => createHash('sha256').update(t).digest('hex');
const REDACTED = '<redacted-address>';
const countRedacted = t => t.split(REDACTED).length - 1;

/** Records as written: non-fixture addresses replaced (scrubAddresses), with the number of replacements this scrub made. */
export function scrubRecordText(rec) {
  const raw = JSON.stringify(rec, null, 1), text = scrubAddresses(raw);
  return { text, redacted: countRedacted(text) - countRedacted(raw) };
}
/** Replace `secret` with a same-length fixture address in every text cell of a journal; returns the number of cells changed. */
export function scrubJournal(file, secret, replacement = 'requester@example.test') {
  if (!secret || !existsSync(file)) return 0;
  const to = replacement.length === secret.length ? replacement : REDACTED;
  const db = new DatabaseSync(file);
  let n = 0;
  try {
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) for (const { name: col } of db.prepare(`PRAGMA table_info("${name}")`).all()) {
      const c = db.prepare(`SELECT count(*) AS n FROM "${name}" WHERE typeof("${col}")='text' AND instr("${col}", ?) > 0`).get(secret).n;
      if (c) { db.prepare(`UPDATE "${name}" SET "${col}" = replace("${col}", ?, ?) WHERE typeof("${col}")='text' AND instr("${col}", ?) > 0`).run(secret, to, secret); n += c; }
    }
    if (n) db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;');
  } finally { db.close(); }
  return n;
}

async function pool(jobs, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, jobs.length)) }, async () => { while (next < jobs.length) { const i = next++; await fn(jobs[i], i); } }));
}

async function main() {
  const { values: a } = parseArgs({ options: { wave: { type: 'string' }, arm: { type: 'string' }, label: { type: 'string' }, k: { type: 'string' }, items: { type: 'string' },
    concurrency: { type: 'string' }, 'cap-usd': { type: 'string' }, resume: { type: 'boolean' }, 'no-manifest': { type: 'boolean' }, split: { type: 'string' } } });
  const wave = Number(a.wave), splitName = a.split ?? 'test';
  if (splitName === 'dev' && (wave !== 1 || !a.label?.startsWith('dev-R-'))) throw new Error('--split dev: wave 1 only, label dev-R-*');
  if (splitName === 'test' && a['no-manifest']) throw new Error('--no-manifest is for the dev smoke only');
  if (![1, 2].includes(wave) || !R_ARMS.includes(a.arm) || !a.label) throw new Error(`usage: --wave 1|2 --arm ${R_ARMS.join('|')} --label NAME`);
  if (wave === 2 && (!a.label.startsWith('w2-R-') || path.basename(BED) !== 'bed-w2')) throw new Error('wave 2: label w2-R-*, CI1_BED=…/bed-w2');
  if (wave === 1 && (!(splitName === 'test' ? a.label.startsWith('test-R-') : true) || path.basename(BED) !== 'bed')) throw new Error('wave 1: label test-R-*, CI1_BED=…/bed');
  const split = JSON.parse(readFileSync(path.join(root, wave === 1 ? 'research/ci1-20261021/SPLIT.json' : 'research/ci1-20261021/w2/SPLIT-W2.json'), 'utf8'));
  let ids = split[splitName];
  if (!ids) throw new Error(`no ${splitName} split`);
  if (a.items) { const want = a.items.split(','); const bad = want.filter(x => !ids.includes(x)); if (bad.length) throw new Error(`not in the wave-${wave} ${splitName} split: ${bad.join(', ')}`); ids = want; }
  // freezes: the review manifest and the wave's own (bed, oracles, frozen arm code)
  const manifests = {};
  if (!a['no-manifest']) {
    const { checkManifestR } = await import('./manifest-r.mjs');
    const badR = checkManifestR(MANIFEST_R);
    if (badR.length) throw new Error(`MANIFEST-R does not match (${badR.slice(0, 5).join('; ')}): refusing to run`);
    manifests.r = sha(readFileSync(MANIFEST_R));
    if (wave === 1) { const { checkManifest } = await import('../ci1/manifest.mjs'); const f = path.join(root, 'research/ci1-20261021/MANIFEST.json'); const bad = checkManifest(f); if (bad.length) throw new Error(`MANIFEST does not match (${bad.slice(0, 5).join('; ')})`); manifests.wave = sha(readFileSync(f)); }
    else { const { checkManifestW2, MANIFEST_W2 } = await import('../ci1-w2/manifest-w2.mjs'); const bad = checkManifestW2(MANIFEST_W2); if (bad.length) throw new Error(`MANIFEST-W2 does not match (${bad.slice(0, 5).join('; ')})`); manifests.wave = sha(readFileSync(MANIFEST_W2)); }
  }
  // account isolation, before any port exists
  const secret = process.env.CLAUDE_CODE_USER_EMAIL ?? null;
  const removed = stripAccountIdentity();
  const configDir = mkdtempSync(path.join(tmpdir(), 'ci1-claude-config-'));
  process.env.CLAUDE_CONFIG_DIR = configDir;
  const K = Number(a.k ?? 3), concurrency = Number(a.concurrency ?? 2), capUsd = Number(a['cap-usd'] ?? 1.5);
  const outDir = path.join(RUNS, a.label), recDir = path.join(outDir, 'records'), faultDir = path.join(outDir, 'faults');
  mkdirSync(recDir, { recursive: true }); mkdirSync(faultDir, { recursive: true });
  const model = 'claude-haiku-5-5', journalFile = path.join(outDir, 'journal.sqlite');
  const { port, db } = createModelPort({ journalFile, allowedModels: [model], maxBudgetUsdPerCall: 0.5, timeoutMs: 600000 });
  const factory = makeBuilderFactoryR(a.arm, { port, model });
  const items = new Map(ids.map(id => [id, wave === 1 ? loadBedItem(id) : loadItem2(id)]));
  const jobs = ids.flatMap(id => Array.from({ length: K }, (_, k) => ({ id, k })));
  const recFile = j => path.join(recDir, `${j.id}-k${j.k}.json`);
  let spent = 0, redacted = 0;
  for (const j of jobs) if (existsSync(recFile(j))) spent += JSON.parse(readFileSync(recFile(j), 'utf8')).cost.usd;
  for (const f of readdirSync(faultDir)) spent += JSON.parse(readFileSync(path.join(faultDir, f), 'utf8')).cost?.usd ?? 0;
  let fault = null; const skipped = [];
  const started = new Date().toISOString();
  try {
    await pool(jobs, concurrency, async j => {
      if (fault) return;
      if (a.resume && existsSync(recFile(j))) return;
      if (spent >= capUsd) { skipped.push(`${j.id}-k${j.k}`); return; }
      const disk = diskStop('/var/tmp');
      if (disk) { fault = 'DISK_FLOOR'; process.stderr.write(`${a.arm} ${j.id} k${j.k}: not started: ${disk}\n`); return; }
      const run = wave === 1 ? runOne : runOne2;
      const rec = await run(items.get(j.id), { arm: a.arm, builder: factory(items.get(j.id)), k: j.k, label: a.label });
      rec.isolation = { accountVariablesRemoved: removed, emptyCliConfigDir: true };
      spent += rec.cost.usd;
      const { text, redacted: n } = scrubRecordText(rec); redacted += n;
      if (rec.environmentFault) { fault = rec.environmentFault; writeFileSync(path.join(faultDir, `${j.id}-k${j.k}-${Date.now()}.json`), text); process.stderr.write(`${a.arm} ${j.id} k${j.k}: ENVIRONMENT FAULT ${fault}; not scored\n`); return; }
      writeFileSync(recFile(j), text);
      process.stderr.write(`${a.arm} ${j.id} k${j.k}: ${rec.outcome} pass=${rec.pass} worlds=${rec.worlds.filter(w => w.pass).length}/${rec.worlds.length} $${rec.cost.usd.toFixed(4)} tok=${rec.cost.tokens} ${Math.round(rec.wallMs / 1000)}s${n ? ` redacted=${n}` : ''}\n`);
    });
  } finally { db.close(); rmSync(configDir, { recursive: true, force: true }); }
  const journalAccountCells = scrubJournal(journalFile, secret);
  const recs = jobs.map(j => existsSync(recFile(j)) ? JSON.parse(readFileSync(recFile(j), 'utf8')) : null).filter(Boolean);
  const summary = { wave, review: 'CI-1 review arms (PREREG-CI1-R)', evidence: splitName === 'dev' ? 'development smoke (not evidence)' : 'held out, not sealed (PREREG-CI1-R)', oracle: wave === 1 ? 'v1 recorded (v2 by rescore.mjs)' : 'v2 recorded (w2x by rescore-w2x.mjs)', arm: a.arm, label: a.label, split: splitName, model, K, items: ids,
    manifestSha256: manifests.wave ?? null, manifestRSha256: manifests.r ?? null, isolation: { accountVariablesRemoved: removed, emptyCliConfigDir: true },
    privacy: { recordAddressesRedactedThisRun: redacted, journalCellsWithAccountAddressScrubbed: journalAccountCells },
    started, finished: new Date().toISOString(), capUsd, spentUsd: Math.round(spent * 1e6) / 1e6, notRun: skipped, environmentFault: fault, records: recs.map(summaryRow) };
  mkdirSync(path.join(SUMMARIES, a.label), { recursive: true });
  writeFileSync(path.join(SUMMARIES, a.label, 'summary.json'), `${scrubAddresses(JSON.stringify(summary, null, 1))}\n`);
  const n = summary.records.length, p = summary.records.filter(r => r.pass).length;
  process.stdout.write(`${a.arm} ${a.label}: ${p}/${n} builds pass; $${summary.spentUsd}; fault=${fault}; redacted=${redacted}; journal account cells=${journalAccountCells}\n`);
  if (fault) process.exitCode = 75;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`${error.code ?? 'ERROR'}: ${error.message}\n`); process.exitCode = 1; });
