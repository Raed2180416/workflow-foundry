// M0 item 5 (DESIGN §7): rescue the git-ignored JSONL of the P1 and C0-dev runs into the committed archive
// research/need-router-20261014/archive/, with a manifest (source path, bytes, lines, sha256) and a secret-shape scan.
// The raw run directories under experiments/runs/ stay ignored (.gitignore:13); only text JSONL is copied. SQLite
// journals (17-22 MB, raw prompts and outputs), logs and shm/wal files are listed in the manifest as not rescued.
// Archived rows are LEGACY development evidence: they predate this program's protocol (P1: 300 s per-call limit, timeouts
// booked at $0; P1 and C0 dev: 1-hour cache writes; C0 dev: inspected seeds) and are never pooled with new labels.
//   node experiments/need-router/diagnostics/rescue.mjs [--dry]
// Idempotent: a destination file that already holds the same bytes is left alone; one that differs is never overwritten.
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, ARCHIVE_DIR, rel, sha256 } from './common.mjs';

export const RESCUE_FILES = Object.freeze([
  { from: 'experiments/runs/p1/results.jsonl', to: 'p1/results.jsonl', what: 'P1 records v3: 8 arms x 12 tasks x 3 trials (research/core-20261006/REPORT.md)' },
  { from: 'experiments/runs/c0-dev/results.jsonl', to: 'c0-dev/results.jsonl', what: 'C0 dev round: records and codefix, 6 arms x 4 tasks x 2 trials (research/construction-20261006/REPORT-dev.md)' },
  { from: 'experiments/runs/c0-dev/probes.jsonl', to: 'c0-dev/probes.jsonl', what: 'C0 dev round: construction probe runs (24 rows)' },
  { from: 'experiments/runs/c0-dev/constructions.jsonl', to: 'c0-dev/constructions.jsonl', what: 'C0 dev round: the 8 construction records, with the CLI final usage per builder session' },
]);
/** Directories scanned for what is left behind (reported, never copied). */
export const NOT_RESCUED_DIRS = Object.freeze(['experiments/runs/p1', 'experiments/runs/c0-dev']);

// Credential-shaped strings (prefixed key forms, JWTs, private keys, bearer headers). Bare hex digests are not flagged.
const SECRET_SHAPES = Object.freeze([
  ['anthropic-key', /sk-ant-[A-Za-z0-9_-]{10,}/], ['api-key', /\bsk-[A-Za-z0-9]{20,}/], ['aws-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{30,}/], ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/], ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['bearer', /Bearer [A-Za-z0-9._-]{20,}/], ['oauth-token', /CLAUDE_CODE_OAUTH_TOKEN\s*[=:]\s*\S{8,}/],
]);
export function scanSecrets(text) {
  const hits = [];
  for (const [kind, re] of SECRET_SHAPES) if (re.test(text)) hits.push(kind);
  return hits;
}

const lineCount = text => text.split('\n').filter(l => l.trim()).length;

/**
 * Copy the rescue list. Returns { files: [{from, to, status, bytes, lines, sha256}], notRescued, manifest }.
 * status: copied (would-copy under dry) | identical | missing | conflict | refused-secret.
 */
export function rescue({ repo = REPO, destDir = ARCHIVE_DIR, files = RESCUE_FILES, dirs = NOT_RESCUED_DIRS, dry = false, now = new Date() } = {}) {
  const out = [];
  for (const f of files) {
    const src = path.join(repo, f.from), dst = path.join(destDir, f.to);
    if (!existsSync(src)) {
      // Not in this container: if the archive already holds it, that is fine; otherwise it is lost to this session.
      out.push({ ...f, status: existsSync(dst) ? 'identical' : 'missing', ...(existsSync(dst) ? describe(readFileSync(dst)) : {}) });
      continue;
    }
    const buf = readFileSync(src), text = buf.toString('utf8'), hits = scanSecrets(text);
    if (hits.length) { out.push({ ...f, status: 'refused-secret', secretShapes: hits, ...describe(buf) }); continue; }
    if (existsSync(dst)) {
      const same = sha256(readFileSync(dst)) === sha256(buf);
      out.push({ ...f, status: same ? 'identical' : 'conflict', ...describe(buf) });
      continue;
    }
    if (!dry) { mkdirSync(path.dirname(dst), { recursive: true }); writeFileSync(dst, buf); }
    out.push({ ...f, status: dry ? 'would-copy' : 'copied', ...describe(buf) });
  }
  const notRescued = [];
  for (const d of dirs) {
    const dir = path.join(repo, d);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (files.some(f => f.from === `${d}/${name}`)) continue;
      const st = statSync(path.join(dir, name));
      if (st.isFile()) notRescued.push({ path: `${d}/${name}`, bytes: st.size, reason: reasonNotRescued(name) });
    }
  }
  const manifest = {
    schema: 'need-router-archive/1',
    evidence: 'LEGACY', grade: 'development',
    note: 'Rows predate the need-router protocol (research/need-router-20261014/DESIGN.md §2 validity gates). Never pooled with new labels. '
      + 'P1: 300 s per-call limit, timeouts booked at $0. P1 and C0 dev: 1-hour cache writes (policy 2026-10-08.1 later set FORCE_PROMPT_CACHING_5M=1, so their dollars are not comparable with later runs). '
      + 'C0 dev: seeds 6001-6004 were inspected by the failure diagnoses and are no longer held out.',
    rescuedFrom: 'experiments/runs/ (git-ignored, .gitignore:13)',
    rescuedAt: now.toISOString().slice(0, 10),
    files: out.filter(x => x.status !== 'missing' && x.status !== 'refused-secret').map(({ to, from, what, bytes, lines, sha256: h }) => ({ path: `research/need-router-20261014/archive/${to}`, sourcePath: from, what, bytes, lines, sha256: h })),
    notRescued,
  };
  return { files: out, notRescued, manifest };
}

const describe = buf => { const text = buf.toString('utf8'); return { bytes: buf.length, lines: lineCount(text), sha256: sha256(buf) }; };
function reasonNotRescued(name) {
  if (/\.sqlite(-shm|-wal)?$/.test(name)) return 'SQLite model journal (binary; raw prompts and outputs): not JSONL; stays git-ignored';
  if (/\.log$/.test(name)) return 'log (ignored by *.log): stays git-ignored';
  return 'not in the rescue list';
}

export function renderReadme(manifest) {
  const rows = manifest.files.map(f => `| \`${path.posix.relative('research/need-router-20261014/archive', f.path)}\` | ${f.lines} | ${f.bytes} | \`${f.sha256.slice(0, 16)}\` | \`${f.sourcePath}\` | ${f.what} |`);
  return [
    '# Archive: rescued JSONL of P1 and C0 dev (LEGACY, development evidence)', '',
    manifest.note, '',
    `Rescued ${manifest.rescuedAt} from \`${manifest.rescuedFrom}\` by \`experiments/need-router/diagnostics/rescue.mjs\` (M0 item 5, DESIGN §7).`,
    'Files are byte copies; `MANIFEST.json` holds the sha256 of each and what was left behind. The diagnostics D0-D6',
    '(`research/need-router-20261014/analysis/m0/REPORT.md`) read these copies, never the ignored originals.', '',
    '| file | lines | bytes | sha256 (16) | source | what |', '|---|---|---|---|---|---|', ...rows, '',
    '**Not rescued** (stay under the git-ignored `experiments/runs/`):', '',
    ...manifest.notRescued.map(n => `- \`${n.path}\` (${n.bytes} bytes): ${n.reason}`), '',
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dry = process.argv.includes('--dry');
  const res = rescue({ dry });
  for (const f of res.files) console.log(`${f.status.padEnd(14)} ${f.from} -> ${rel(path.join(ARCHIVE_DIR, f.to))}${f.lines != null ? ` (${f.lines} lines, ${f.bytes} bytes, sha256 ${f.sha256.slice(0, 16)})` : ''}${f.secretShapes ? ` SECRET SHAPES: ${f.secretShapes}` : ''}`);
  for (const n of res.notRescued) console.log(`not rescued    ${n.path} (${n.bytes} bytes): ${n.reason}`);
  const bad = res.files.filter(f => f.status === 'conflict' || f.status === 'refused-secret');
  if (bad.length) { console.error(`${bad.length} file(s) not written (conflict or secret shape)`); process.exitCode = 1; }
  else if (!dry) {
    const mf = path.join(ARCHIVE_DIR, 'MANIFEST.json');
    // Keep the original manifest (and its date) when nothing changed.
    const prev = existsSync(mf) ? JSON.parse(readFileSync(mf, 'utf8')) : null;
    const same = prev && JSON.stringify(prev.files) === JSON.stringify(res.manifest.files);
    if (!same) {
      mkdirSync(ARCHIVE_DIR, { recursive: true });
      writeFileSync(mf, JSON.stringify(res.manifest, null, 1) + '\n');
      writeFileSync(path.join(ARCHIVE_DIR, 'README.md'), renderReadme(res.manifest));
      console.log(`wrote ${rel(mf)} and README.md`);
    } else console.log('manifest unchanged');
  }
}
