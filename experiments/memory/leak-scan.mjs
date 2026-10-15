// X1 leak scan (research/architecture-20261014/MEMORY-ROUTING-RECURSION.md §3.2 "Memory tests", rule R9; MEM-0, $0): no
// truth-domain bytes under any sandbox, workdir or prompt. Truth domain = oracle verdicts, labels and held-out material
// (§3.2 "Who sees what"). The scan looks, under every root, for truth files by name (the library's evidence rows, which
// carry oracle verdicts, and its judgment ledger, which carries labels) and, in every file and every prompt text, for
// truth bytes (needles: a reference answer in its usual serialisations, a planted label). Symbolic links are listed, never
// followed. It reports hits; it never fixes anything.
//   node experiments/memory/leak-scan.mjs <dir>... [--needles needles.json]   (needles.json: a JSON array of strings)
// Exit 1 when anything is found.
import { readdirSync, lstatSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical } from '../../beds/lib/canonical.mjs';

export const TRUTH_FILE_NAMES = Object.freeze(['evidence.jsonl', 'judgments.jsonl']);
export const MIN_NEEDLE = 32;   // shorter strings occur by chance in task text; a truth value that short cannot be scanned for
const MAX_FILE_BYTES = 64 * 1024 * 1024;

/** The serialisations of each truth value a leak would carry (canonical, compact, indented JSON; a string as itself), at least `min` characters. */
export function truthNeedles(values, { min = MIN_NEEDLE } = {}) {
  const out = new Set();
  for (const v of values) {
    if (typeof v === 'string') { out.add(v); continue; }
    for (const s of [canonical(v), JSON.stringify(v), JSON.stringify(v, null, 1), JSON.stringify(v, null, 2)]) if (typeof s === 'string') out.add(s);
  }
  return [...out].filter(s => s.length >= min);
}

/**
 * scanLeaks({ roots, prompts?: {label: text}, needles?: [string], fileNames? }) ->
 *   { ok, hits: [{ kind: 'file' | 'bytes' | 'prompt' | 'unreadable', where, needle? }], files, bytes, symlinks, needles, prompts }
 */
export function scanLeaks({ roots = [], prompts = {}, needles = [], fileNames = TRUTH_FILE_NAMES } = {}) {
  const hits = [], bufs = needles.map(n => Buffer.from(n)), names = new Set(fileNames);
  let files = 0, bytes = 0, symlinks = 0;
  const walk = p => {
    let st; try { st = lstatSync(p); } catch { return; }
    if (st.isSymbolicLink()) { symlinks++; return; }
    if (st.isDirectory()) { for (const n of readdirSync(p).sort()) walk(path.join(p, n)); return; }
    if (!st.isFile()) return;
    files++; bytes += st.size;
    if (names.has(path.basename(p))) hits.push({ kind: 'file', where: p });
    if (!bufs.length) return;
    if (st.size > MAX_FILE_BYTES) { hits.push({ kind: 'unreadable', where: p, why: `over ${MAX_FILE_BYTES} bytes` }); return; }
    const buf = readFileSync(p);
    bufs.forEach((b, i) => { if (buf.includes(b)) hits.push({ kind: 'bytes', where: p, needle: i }); });
  };
  for (const r of roots) if (existsSync(r)) walk(path.resolve(r));
  for (const [label, text] of Object.entries(prompts)) needles.forEach((n, i) => { if (String(text).includes(n)) hits.push({ kind: 'prompt', where: label, needle: i }); });
  return { ok: !hits.length, hits, files, bytes, symlinks, needles: needles.length, prompts: Object.keys(prompts).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), i = argv.indexOf('--needles');
  const needles = i >= 0 ? JSON.parse(readFileSync(argv[i + 1], 'utf8')) : [];
  const roots = argv.filter((a, k) => !(i >= 0 && (k === i || k === i + 1)));
  if (!roots.length) { console.error('usage: node experiments/memory/leak-scan.mjs <dir>... [--needles needles.json]'); process.exit(2); }
  const r = scanLeaks({ roots, needles });
  console.log(JSON.stringify({ ...r, hits: r.hits.slice(0, 200), hitCount: r.hits.length }, null, 1));
  process.exit(r.ok ? 0 : 1);
}
