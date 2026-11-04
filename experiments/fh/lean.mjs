// FH-1 lean storage ($0; review finding m9, ROADMAP §6.6 "keep the repo lean"). Written after the result, not frozen.
// A heal attempt's kept program was stored as a full copy (runs/<label>/program/, 3.3 MB over 29 attempts). It is now stored as
// a patch against the recorded original build, and rebuilt on demand:
//   runs/<label>/patch.json  { schema, label, base, baseDigest, patchedDigest, files: { <relative path>: <full text after> | null } }
//                            only the files that differ from the original (null = the file is absent after the session);
//   runs/<label>/patch.diff  the same change as a unified diff, for reading only.
// reconstruct() copies the original, applies patch.json and checks the bundle digest of the result against the attempt's
// record.json (`patchedDigest`, the digest the gate and the grading used), so a stored patch is either exact or refused.
//   node experiments/fh/lean.mjs write [--labels a,b]      write patch.json + patch.diff for every attempt that has program/
//   node experiments/fh/lean.mjs verify                    rebuild every attempt from patch.json and check its digest
//   node experiments/fh/lean.mjs prune                     verify, then delete program/ copies whose patch verified
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, cpSync, rmSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { ROOT, subjectOf } from './grade.mjs';
import { BUILDS } from './baseline.mjs';

export const RUN_DIR = path.join(ROOT, 'research/heal-20261021/fh1/runs');
const walk = (d, base = d) => (existsSync(d) ? readdirSync(d).sort().flatMap(n => { const p = path.join(d, n); return statSync(p).isDirectory() ? walk(p, base) : [path.relative(base, p)]; }) : []);
const incidentOf = label => label.split('.')[0];

/** The original program of an attempt as a directory tree: { kind, files: Map(rel -> Buffer) }. */
export function baseTree(incident) {
  const b = BUILDS[incident];
  if (!b) throw new Error(`unknown build ${incident}`);
  if (b.spec.startsWith('program:')) {
    const dir = path.join(ROOT, b.spec.slice(8));
    return { kind: 'composed', dir, files: new Map(walk(dir).map(f => [f, readFileSync(path.join(dir, f))])) };
  }
  const file = path.join(ROOT, b.spec.slice(7));
  return { kind: 'monolith', dir: null, files: new Map([['solver.mjs', readFileSync(file)]]) };
}

/** The patch of a kept program directory against its original (pure on the two trees). */
export function diffTrees(base, kept) {
  const files = {};
  for (const [f, buf] of kept) if (!base.has(f) || !base.get(f).equals(buf)) files[f] = buf.toString('utf8');
  for (const f of base.keys()) if (!kept.has(f)) files[f] = null;
  return files;
}

export function makePatch(label) {
  const dir = path.join(RUN_DIR, label, 'program');
  if (!existsSync(dir)) throw new Error(`${label}: no program/ copy`);
  const rec = JSON.parse(readFileSync(path.join(RUN_DIR, label, 'record.json'), 'utf8'));
  const base = baseTree(incidentOf(label));
  const kept = new Map(walk(dir).map(f => [f, readFileSync(path.join(dir, f))]));
  for (const [f, buf] of kept) if (buf.includes(0)) throw new Error(`${label}: ${f} is binary`);
  const patch = { schema: 'fh1-patch/1', label, base: BUILDS[incidentOf(label)].spec, kind: base.kind, baseDigest: rec.baseDigest, patchedDigest: rec.patchedDigest, files: diffTrees(base.files, kept) };
  return patch;
}

function unifiedDiff(label, patch) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'fh-lean-'));
  try {
    const a = path.join(tmp, 'a'), b = path.join(tmp, 'b');
    mkdirSync(a, { recursive: true }); mkdirSync(b, { recursive: true });
    const base = baseTree(incidentOf(label));
    for (const f of Object.keys(patch.files)) {
      if (base.files.has(f)) { mkdirSync(path.dirname(path.join(a, f)), { recursive: true }); writeFileSync(path.join(a, f), base.files.get(f)); }
      if (patch.files[f] !== null) { mkdirSync(path.dirname(path.join(b, f)), { recursive: true }); writeFileSync(path.join(b, f), patch.files[f]); }
    }
    try { return execFileSync('diff', ['-ruN', 'a', 'b'], { cwd: tmp, encoding: 'utf8', maxBuffer: 64 << 20 }); }
    catch (e) { if (e.status === 1) return e.stdout; throw e; }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** Rebuild an attempt's kept program into `dest` from patch.json; returns { spec, digest, ok }. Throws on a digest mismatch. */
export function reconstruct(label, dest, { check = true } = {}) {
  const patch = JSON.parse(readFileSync(path.join(RUN_DIR, label, 'patch.json'), 'utf8'));
  const base = baseTree(incidentOf(label));
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  if (base.kind === 'composed') cpSync(base.dir, dest, { recursive: true });
  else writeFileSync(path.join(dest, 'solver.mjs'), base.files.get('solver.mjs'));
  for (const [f, text] of Object.entries(patch.files)) {
    const p = path.join(dest, f);
    if (!path.resolve(p).startsWith(path.resolve(dest) + path.sep)) throw new Error(`${label}: patch path escapes: ${f}`);
    if (text === null) rmSync(p, { force: true });
    else { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, text); }
  }
  const spec = base.kind === 'composed' ? `program:${dest}` : `solver:${path.join(dest, 'solver.mjs')}`;
  const digest = subjectOf(spec).digest;
  if (check && digest !== patch.patchedDigest) throw new Error(`${label}: rebuilt digest ${digest} != recorded ${patch.patchedDigest}`);
  return { spec, digest, ok: digest === patch.patchedDigest, kind: base.kind };
}

export const withProgram = () => readdirSync(RUN_DIR).filter(d => existsSync(path.join(RUN_DIR, d, 'program'))).sort();
export const withPatch = () => readdirSync(RUN_DIR).filter(d => existsSync(path.join(RUN_DIR, d, 'patch.json'))).sort();

function verifyAll(labels = withPatch()) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'fh-lean-verify-'));
  const out = [];
  try {
    for (const l of labels) {
      let r; try { r = reconstruct(l, path.join(tmp, l)); } catch (e) { r = { ok: false, error: String(e.message).slice(0, 200) }; }
      // the copy, where it still exists, must rebuild to the same files too
      out.push({ label: l, ok: r.ok, digest: r.digest ?? null, error: r.error ?? null });
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  if (mode === 'write') {
    const labels = arg('--labels', null)?.split(',') ?? withProgram();
    for (const l of labels) {
      const p = makePatch(l);
      writeFileSync(path.join(RUN_DIR, l, 'patch.json'), JSON.stringify(p, null, 1) + '\n');
      writeFileSync(path.join(RUN_DIR, l, 'patch.diff'), unifiedDiff(l, p));
      console.log(`${l}: ${Object.keys(p.files).length} file(s) differ (${Object.entries(p.files).map(([f, t]) => `${f}${t === null ? ' (deleted)' : ''}`).join(', ')})`);
    }
  } else if (mode === 'verify' || mode === 'prune') {
    const res = verifyAll();
    for (const r of res) console.log(`${r.label}: ${r.ok ? 'ok' : `FAIL ${r.error ?? r.digest}`}`);
    const bad = res.filter(r => !r.ok);
    if (bad.length) { console.error(`${bad.length} patch(es) do not rebuild to the recorded digest; nothing pruned`); process.exit(1); }
    if (mode === 'prune') for (const r of res) { const d = path.join(RUN_DIR, r.label, 'program'); if (existsSync(d)) { rmSync(d, { recursive: true, force: true }); console.log(`${r.label}: program/ copy removed`); } }
  } else { console.error('usage: lean.mjs write|verify|prune'); process.exit(2); }
}
