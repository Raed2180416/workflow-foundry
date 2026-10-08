// Pins the gate closure (DESIGN §1.2): the strict lint, acceptance grading and run verdict files, at the blob ids they have in
// commit 13f7664, copied next to the three modules they import so every import path and every hash matches git.
//
//   node experiments/heal/pin-gate.mjs --write   (re)create pinned/src/*.mjs and pins.json from git; refuses on any mismatch
//   node experiments/heal/pin-gate.mjs --check   verify pinned/ and pins.json (and the kit) without git
//
// Library: verifyPinned(), loadGate(). The gate comes from the pinned copy; the live src/lint.mjs is used only when the pinned
// copy is absent AND the live file has exactly the pinned blob id AND it imports cleanly (a changing src/ never moves the gate).
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { HEAL_DIR, REPO, KIT_DIR, KIT_COMMIT, GATE_COMMIT, TRACKED, PINS_FILE, blobOf, kitFiles, readPins } from './kit.mjs';

export const PINNED_DIR = path.join(HEAL_DIR, 'pinned');
// The three gate files (from GATE_COMMIT) and their only dependencies (byte-identical in the kit and at GATE_COMMIT).
export const GATE_FILES = ['src/lint.mjs', 'src/acceptance.mjs', 'src/verdict.mjs'];
export const DEP_FILES = ['src/data.mjs', 'src/dataflow.mjs', 'src/models/policy.mjs'];
const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

export function writePins() {
  const tree = Object.fromEntries(git('ls-tree', '-r', KIT_COMMIT, '--format=%(objectname) %(path)', '--', ...TRACKED).trim().split('\n').map(l => { const i = l.indexOf(' '); return [l.slice(i + 1), l.slice(0, i)]; }));
  const have = kitFiles(KIT_DIR), bad = [...new Set([...Object.keys(tree), ...Object.keys(have)])].filter(f => tree[f] !== have[f]);
  if (bad.length) throw new Error(`the kit at ${KIT_DIR} is not ${KIT_COMMIT}: ${bad.slice(0, 8).join(', ')}`);
  let kitHash = null; try { kitHash = JSON.parse(readFileSync(path.join(KIT_DIR, 'KIT.json'), 'utf8')).hash; } catch { /* bare copy */ }
  const gateBlob = f => git('rev-parse', `${GATE_COMMIT}:${f}`).trim();
  const gate = {}, copies = {};
  for (const f of [...GATE_FILES, ...DEP_FILES]) {
    gate[f] = gateBlob(f);
    const dest = path.join(PINNED_DIR, f); mkdirSync(path.dirname(dest), { recursive: true });
    // Gate files come from git; dependencies come from the kit once their blob is proven equal to git's.
    if (DEP_FILES.includes(f)) { if (have[f] !== gate[f]) throw new Error(`${f}: kit ${have[f]} differs from ${GATE_COMMIT} ${gate[f]}`); writeFileSync(dest, readFileSync(path.join(KIT_DIR, f))); }
    else writeFileSync(dest, execFileSync('git', ['-C', REPO, 'show', `${GATE_COMMIT}:${f}`], { maxBuffer: 16 * 1024 * 1024 }));
    copies[`pinned/${f}`] = blobOf(dest);
    if (copies[`pinned/${f}`] !== gate[f]) throw new Error(`${f}: pinned copy ${copies[`pinned/${f}`]} != ${gate[f]}`);
  }
  const pins = { schema: 'heal-pins/1', kit: { dir: KIT_DIR, kitHash, commit: KIT_COMMIT, files: have }, gate: { commit: GATE_COMMIT, files: gate, copies } };
  writeFileSync(PINS_FILE, JSON.stringify(pins, null, 1) + '\n');
  return pins;
}

export function verifyPinned({ pins = readPins() } = {}) {
  const problems = [];
  for (const [rel, blob] of Object.entries(pins.gate.copies)) {
    const file = path.join(HEAL_DIR, rel);
    if (!existsSync(file)) problems.push(`${rel}: missing`); else if (blobOf(file) !== blob) problems.push(`${rel}: blob ${blobOf(file)} != pinned ${blob}`);
  }
  return { ok: !problems.length, problems, commit: pins.gate.commit };
}

let gateCache;
export async function loadGate({ pins = readPins() } = {}) {
  if (gateCache) return gateCache;
  const pinned = verifyPinned({ pins });
  let base, source;
  if (pinned.ok) { base = path.join(PINNED_DIR, 'src'); source = 'pinned'; }
  else {
    // Fallback: the live files, only if every one of them has its pinned blob id; otherwise there is no gate.
    const live = Object.entries(pins.gate.files).filter(([f]) => !existsSync(path.join(REPO, f)) || blobOf(path.join(REPO, f)) !== pins.gate.files[f]);
    if (live.length) throw Object.assign(new Error(`HEAL_GATE_UNPINNED: ${pinned.problems.slice(0, 3).join('; ')}; live files differ: ${live.map(([f]) => f).join(', ')}`), { code: 'HEAL_GATE_UNPINNED', pinned });
    base = path.join(REPO, 'src'); source = 'live-identical';
  }
  const imp = f => import(pathToFileURL(path.join(base, f)).href);
  const [lint, acceptance, verdict] = await Promise.all(['lint.mjs', 'acceptance.mjs', 'verdict.mjs'].map(imp));
  const liveStatus = await (async () => {
    const file = path.join(REPO, 'src/lint.mjs');
    try { await import(pathToFileURL(file).href); return { importable: true, sameBlobAsPin: blobOf(file) === pins.gate.files['src/lint.mjs'] }; }
    catch (error) { return { importable: false, error: String(error.message ?? error).slice(0, 200) }; }
  })();
  gateCache = { source, commit: pins.gate.commit, blobs: pins.gate.files, live: liveStatus, lintProfile: lint.LINT_PROFILE, LINT_RULES: lint.LINT_RULES,
    lintWorkflow: lint.lintWorkflow, assessWorkflow: acceptance.assessWorkflow, gradeAcceptance: acceptance.gradeAcceptance, strongEntries: acceptance.strongEntries,
    isStrong: acceptance.isStrong, flowsOf: acceptance.flowsOf, verdictOf: verdict.verdictOf };
  return gateCache;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.argv.includes('--write')) { const p = writePins(); console.log(JSON.stringify({ wrote: PINS_FILE, kitFiles: Object.keys(p.kit.files).length, gate: p.gate.files }, null, 1)); }
  else { console.log(JSON.stringify({ pinned: verifyPinned() }, null, 1)); }
}
