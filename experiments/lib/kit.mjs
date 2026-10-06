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

export function kitFiles() {
  const files = [];
  for (const entry of KIT_ALLOW) {
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

export function buildKit({ base = '/opt/foundry-kit' } = {}) {
  const files = kitFiles();
  const h = createHash('sha256');
  for (const rel of files) h.update(rel).update('\0').update(readFileSync(path.join(root, rel))).update('\0');
  const hash = h.digest('hex').slice(0, 16), dir = path.join(base, hash);
  if (!existsSync(path.join(dir, 'KIT.json'))) {
    rmSync(dir, { recursive: true, force: true });
    for (const rel of files) { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); cpSync(path.join(root, rel), path.join(dir, rel)); }
    writeFileSync(path.join(dir, 'KIT.json'), JSON.stringify({ hash, files: files.length, builtFrom: root }, null, 1));
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
