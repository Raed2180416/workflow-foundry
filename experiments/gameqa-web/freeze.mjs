#!/usr/bin/env node
// Freeze manifest for GQA-1 (research/gameqa-20261021/FREEZE.json).
//   node experiments/gameqa-web/freeze.mjs              check: print the current hashes and whether they match the freeze
//   node experiments/gameqa-web/freeze.mjs --bed        write the bed section (the build, the injected-bug set, the spec, the
//                                                       driver and the oracle). Done once, before any model call.
//   node experiments/gameqa-web/freeze.mjs --arms       add the arms section (arm code, prompts, template, runner, model policy).
//                                                       Done once, at the preregistration, before the first comparative paid call.
//   node experiments/gameqa-web/freeze.mjs --amend ID   append a dated amendment with the arms manifest as it now stands (the
//                                                       PREREG's Amendments section must already describe ID). Paid runs then
//                                                       need the arm files to match the LATEST amendment; earlier sections stay.
// A section that is already written is never overwritten: a change after the freeze is a deviation, recorded as such.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeManifest } from '../../beds/gameqa-web/oracle.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const FREEZE_FILE = path.join(ROOT, 'research/gameqa-20261021/FREEZE.json');
export const ARM_FILES = Object.freeze(['experiments/gameqa-web/arms.mjs', 'experiments/gameqa-web/qa-lib.mjs', 'experiments/gameqa-web/expr.mjs',
  'experiments/gameqa-web/prompts.mjs', 'experiments/gameqa-web/template.json', 'experiments/gameqa-web/run.mjs',
  'experiments/gameqa-web/reference-checks.json', 'experiments/gameqa-web/funnel.mjs', 'experiments/gameqa-web/analyze.mjs', 'experiments/gameqa-web/chain.sh', 'experiments/gameqa-web/regress.mjs', 'experiments/lib/models.mjs', 'policy/models.json',
  'experiments/gameqa-web/transport.mjs',
  'research/gameqa-20261021/PREREG-GQA-1.md']);
const sha = buf => createHash('sha256').update(buf).digest('hex');

export function armsManifest() {
  const files = Object.fromEntries(ARM_FILES.map(f => [f, existsSync(path.join(ROOT, f)) ? sha(readFileSync(path.join(ROOT, f))) : null]));
  return { files, sha256: sha(JSON.stringify(files)) };
}
export function truthSetHash() {
  // The injected-bug set: ids, classes, flags and reference repros, independent of JSON formatting.
  const t = JSON.parse(readFileSync(path.join(ROOT, 'beds/gameqa-web/truth/bugs.json'), 'utf8'));
  return sha(JSON.stringify({ build: t.build, bugs: t.bugs.map(({ id, flag, class: c, acceptClasses, depth, reference }) => ({ id, flag, class: c, acceptClasses, depth, reference })) }));
}
const head = () => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return null; } };

export function checkFreeze() {
  if (!existsSync(FREEZE_FILE)) return { frozen: false };
  const f = JSON.parse(readFileSync(FREEZE_FILE, 'utf8'));
  const bed = freezeManifest(), arms = armsManifest();
  // The binding arms section is the latest amendment when there is one (an amendment never rewrites an earlier section).
  const ref = f.amendments?.length ? f.amendments.at(-1) : f.arms;
  return { frozen: true, bedMatches: f.bed?.sha256 === bed.sha256, truthMatches: f.bed?.truthSet === truthSetHash(),
    armsFrozen: Boolean(f.arms), armsSection: f.amendments?.length ? `amendment ${ref.id}` : 'arms', armsMatch: ref ? ref.sha256 === arms.sha256 : null,
    changedArmFiles: ref ? Object.keys(arms.files).filter(k => ref.files[k] !== arms.files[k]) : [] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] ?? '';
  const cur = existsSync(FREEZE_FILE) ? JSON.parse(readFileSync(FREEZE_FILE, 'utf8')) : {};
  if (mode === '--bed') {
    if (cur.bed) { console.error('bed section already frozen: refusing to overwrite'); process.exit(2); }
    const m = freezeManifest();
    cur.bed = { at: new Date().toISOString(), gitHead: head(), sha256: m.sha256, truthSet: truthSetHash(), files: m.files,
      note: 'Bed frozen before any model call of GQA-1: build B1 (12 injected faults), the public spec, the hidden truth, the driver and the oracle.' };
    writeFileSync(FREEZE_FILE, `${JSON.stringify(cur, null, 1)}\n`);
  } else if (mode === '--arms') {
    if (!cur.bed) { console.error('freeze the bed first'); process.exit(2); }
    if (cur.arms) { console.error('arms section already frozen: refusing to overwrite'); process.exit(2); }
    const m = armsManifest();
    const missing = Object.keys(m.files).filter(f => !m.files[f]);
    if (missing.length) { console.error(`arm files missing: ${missing.join(', ')}`); process.exit(2); }
    cur.arms = { at: new Date().toISOString(), gitHead: head(), sha256: m.sha256, files: m.files };
    writeFileSync(FREEZE_FILE, `${JSON.stringify(cur, null, 1)}\n`);
  } else if (mode === '--amend') {
    const id = process.argv[3];
    if (!cur.arms) { console.error('nothing to amend: the arms are not frozen'); process.exit(2); }
    if (!/^A\d+$/.test(id ?? '')) { console.error('usage: freeze.mjs --amend A<n>'); process.exit(2); }
    if ((cur.amendments ?? []).some(x => x.id === id)) { console.error(`amendment ${id} already frozen: refusing to overwrite`); process.exit(2); }
    const prereg = readFileSync(path.join(ROOT, 'research/gameqa-20261021/PREREG-GQA-1.md'), 'utf8');
    if (!new RegExp(`^### ${id}\\b`, 'm').test(prereg)) { console.error(`PREREG-GQA-1.md has no "### ${id}" amendment entry`); process.exit(2); }
    const m = armsManifest();
    const missing = Object.keys(m.files).filter(f => !m.files[f]);
    if (missing.length) { console.error(`arm files missing: ${missing.join(', ')}`); process.exit(2); }
    (cur.amendments ??= []).push({ id, at: new Date().toISOString(), gitHead: head(), sha256: m.sha256, files: m.files });
    writeFileSync(FREEZE_FILE, `${JSON.stringify(cur, null, 1)}\n`);
  } else if (mode) { console.error('usage: freeze.mjs [--bed|--arms|--amend A<n>]'); process.exit(2); }
  console.log(JSON.stringify({ bed: freezeManifest().sha256, truthSet: truthSetHash(), arms: armsManifest().sha256, ...checkFreeze() }, null, 1));
}
