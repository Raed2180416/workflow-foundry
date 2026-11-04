// Freeze guards for the C2 reuse experiments (review of C2-2, finding 8: c22.mjs's freeze counted stream records only,
// although the admission outcome comes from the history runs). c22.mjs is frozen and stays as it is; drivers written
// after the review (c23.mjs) use these helpers, which refuse a freeze when ANY record file that feeds a result already
// holds a record, and audit a frozen file set against the code now on disk.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readJsonl, sha256 } from './lib.mjs';

/** Records already present in each file: { [file]: count } (a missing file counts 0). */
export function recordsBeforeFreeze(files) {
  return Object.fromEntries(files.map(f => [f, readJsonl(f).length]));
}

/** Throws unless every file that feeds a result is empty or absent. Returns the per-file counts (all 0). */
export function assertNoRecordsBeforeFreeze(files) {
  const counts = recordsBeforeFreeze(files);
  const held = Object.entries(counts).filter(([, n]) => n > 0);
  if (held.length) throw new Error(`refusing to freeze: records already exist (${held.map(([f, n]) => `${path.basename(f)} ${n}`).join(', ')})`);
  return counts;
}

/**
 * Audit a freeze's code hashes against the files now on disk. For a changed file, `appendOnly` says whether the frozen
 * version is a line prefix of the current one (code added after the frozen text, nothing above it changed), with the
 * prefix length in bytes. code: { relPath: sha256 } as in FREEZE-*.json; base: the directory relPath is relative to.
 */
export function auditFrozenCode(code, base) {
  const out = { unchanged: [], changed: [] };
  for (const [rel, frozen] of Object.entries(code)) {
    const f = path.join(base, rel);
    if (!existsSync(f)) { out.changed.push({ file: rel, missing: true, appendOnly: false }); continue; }
    const text = readFileSync(f, 'utf8');
    if (sha256(text) === frozen) { out.unchanged.push(rel); continue; }
    let prefixBytes = null;
    for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) if (sha256(text.slice(0, i + 1)) === frozen) { prefixBytes = Buffer.byteLength(text.slice(0, i + 1)); break; }
    out.changed.push({ file: rel, appendOnly: prefixBytes !== null, prefixBytes, bytes: Buffer.byteLength(text) });
  }
  return out;
}
