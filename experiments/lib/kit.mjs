// Build the read-only Foundry kit that construction-time builders (and executors that run
// workflows) see inside their sandbox. Built from an ALLOWLIST so beds/ (oracles), experiments/,
// research/ and tests/ can never leak into it. The kit is content-addressed: /opt/foundry-kit/<hash>.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(new URL('../..', import.meta.url).pathname);
export const KIT_ALLOW = ['package.json', 'bin', 'src', 'schemas', 'policy', 'skills', 'web', 'node_modules'];
// Top-level directories that must never enter a kit (oracles, experiment code, research data).
const DENY_TOP = new Set(['beds', 'experiments', 'research', 'tests', 'corpus', 'evals', '.foundry', '.git']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = path.join(dir, name), st = statSync(p);
    if (st.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

// The B1 builders' kit: only their construction skill (the counterpart of skills/micro-harness for plain scripts).
export const SCRIPT_KIT_ALLOW = ['skills/script-harness'];

export function kitFiles(allow = KIT_ALLOW) {
  const files = [];
  for (const entry of allow) {
    const abs = path.join(root, entry);
    if (!existsSync(abs)) continue;
    for (const f of statSync(abs).isDirectory() ? walk(abs) : [abs]) {
      const rel = path.relative(root, f);
      if (DENY_TOP.has(rel.split(path.sep)[0])) throw new Error(`kit allowlist would include a denied path: ${rel}`);
      files.push(rel);
    }
  }
  return files;
}

const digestOf = (from, files) => {
  const h = createHash('sha256');
  for (const rel of files) h.update(rel).update('\0').update(readFileSync(path.join(from, rel))).update('\0');
  return h.digest('hex').slice(0, 16);
};
// A kit directory is reused only if it still holds exactly its files with its content hash: a kit an earlier session
// could write to (before executors mounted it read-only) is rebuilt, never trusted.
export function kitIntact(dir, files, hash) {
  try {
    const present = walk(dir).map(f => path.relative(dir, f)).filter(rel => rel !== 'KIT.json').sort();
    const expected = [...files].sort();
    return present.length === expected.length && present.every((rel, i) => rel === expected[i]) && digestOf(dir, files) === hash;
  } catch { return false; }
}

// The content hash a kit built now would have (no files are copied).
export const kitHash = ({ allow = KIT_ALLOW } = {}) => digestOf(root, kitFiles(allow));

export function buildKit({ base = '/opt/foundry-kit', allow = KIT_ALLOW } = {}) {
  const files = kitFiles(allow);
  const hash = digestOf(root, files), dir = path.join(base, hash);
  if (!existsSync(path.join(dir, 'KIT.json')) || !kitIntact(dir, files, hash)) {
    rmSync(dir, { recursive: true, force: true });
    for (const rel of files) { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); cpSync(path.join(root, rel), path.join(dir, rel)); }
    writeFileSync(path.join(dir, 'KIT.json'), JSON.stringify({ hash, files: files.length, allow, builtFrom: root }, null, 1));
  }
  return { hash, dir, files: files.length };
}

// Literal-leak scan (DESIGN §6): does the kit contain strings unique to a bed family?
export function scanKit(dir, needles) {
  const hits = [];
  for (const f of walk(dir)) {
    const text = readFileSync(f, 'utf8');
    for (const n of needles) if (n && text.includes(n)) hits.push({ file: path.relative(dir, f), needle: n });
  }
  return hits;
}
