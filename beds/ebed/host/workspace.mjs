// Persistent per-arm workspace (E-BED §2.2; BED-CONTRACT-v1.1 §3.1): a directory (≤ 50 MB) that survives across calls
// for arms that keep scripts or indices (agent-H-ws). Not graded; journaled as a content-addressed snapshot after every
// call (manifest of path -> sha256, blobs in the journal's blob store), so a resumed stream restores it to the last
// committed wake-up and a replay can check it. Symbolic links and special files are refused (they could reach outside).
import { readdirSync, lstatSync, readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { sha256, hashOf } from '../../lib/canonical.mjs';

export const WORKSPACE_MAX_BYTES = 50 * 1024 * 1024;

export class Workspace {
  constructor({ dir, maxBytes = WORKSPACE_MAX_BYTES }) {
    if (!dir) throw new Error('workspace needs a directory');
    this.dir = path.resolve(dir);
    this.maxBytes = maxBytes;
    mkdirSync(this.dir, { recursive: true });
  }

  /** Walk the directory: { files: { relPath: sha256 }, bytes, problems }. */
  scan() {
    const files = {}, problems = [];
    let bytes = 0;
    const walk = rel => {
      const abs = path.join(this.dir, rel);
      for (const name of readdirSync(abs).sort()) {
        const r = rel ? `${rel}/${name}` : name;
        const st = lstatSync(path.join(this.dir, r));
        if (st.isSymbolicLink()) { problems.push(`symlink ${r}`); continue; }
        if (st.isDirectory()) { walk(r); continue; }
        if (!st.isFile()) { problems.push(`special file ${r}`); continue; }
        bytes += st.size;
        if (bytes <= this.maxBytes) files[r] = sha256(readFileSync(path.join(this.dir, r)));
      }
    };
    walk('');
    return { files, bytes, problems };
  }

  /** Snapshot into `journal`'s blob store. Returns { digest, bytes, files, manifest, oversize, problems }. */
  snapshot(journal) {
    const { files, bytes, problems } = this.scan();
    const oversize = bytes > this.maxBytes;
    if (!oversize) for (const [rel, digest] of Object.entries(files)) journal.putBlob(digest, readFileSync(path.join(this.dir, rel)));
    return { digest: hashOf(files), bytes, files: Object.keys(files).length, manifest: files, oversize, problems };
  }

  /** Make the directory hold exactly `manifest` (blobs from `journal`). */
  restore(manifest, journal) {
    for (const name of existsSync(this.dir) ? readdirSync(this.dir) : []) rmSync(path.join(this.dir, name), { recursive: true, force: true });
    for (const [rel, digest] of Object.entries(manifest)) {
      const blob = journal.getBlob(digest);
      if (!blob) throw new Error(`workspace restore: blob ${digest} missing for ${rel}`);
      const abs = path.join(this.dir, rel);
      if (!abs.startsWith(this.dir + path.sep)) throw new Error(`workspace restore: path escapes ${rel}`);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, blob);
    }
  }
}
