// Persistent per-arm workspace (E-BED §2.2; BED-CONTRACT-v1.1 §3.1): a directory (≤ 50 MB) that survives across calls
// for arms that keep scripts or indices (agent-H-ws). Not graded; journaled as a content-addressed snapshot after every
// call (manifest of path -> sha256, blobs in the journal's blob store), so a resumed stream restores it to the last
// committed wake-up and a replay can check it. Symbolic links and special files are refused (they could reach outside).
//
// The host empties the directory before the first live call (and restores a snapshot on resume), so it first *claims*
// it (review finding 6): a directory that is not empty and carries no host marker is refused untouched, and so is one
// whose marker names another arm or world. The marker (`.ebed-host-workspace`) is host-owned: never snapshotted,
// never removed by a restore.
import { readdirSync, lstatSync, readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { sha256, hashOf } from '../../lib/canonical.mjs';

export const WORKSPACE_MAX_BYTES = 50 * 1024 * 1024;
export const WORKSPACE_MARKER = '.ebed-host-workspace';

export class Workspace {
  constructor({ dir, maxBytes = WORKSPACE_MAX_BYTES }) {
    if (!dir) throw new Error('workspace needs a directory');
    this.dir = path.resolve(dir);
    this.maxBytes = maxBytes;
    mkdirSync(this.dir, { recursive: true });
  }

  /**
   * Claim the directory for one (arm, world): refuse it if it holds anything without a marker of this host, or a marker
   * of another arm or world; otherwise write the marker. Returns { fresh } (true when the directory was empty).
   */
  claim({ arm, world }) {
    const want = { host: 'ebed-host', arm, world };
    const markerPath = path.join(this.dir, WORKSPACE_MARKER);
    const others = readdirSync(this.dir).filter(n => n !== WORKSPACE_MARKER);
    let marker = null;
    if (existsSync(markerPath)) {
      const st = lstatSync(markerPath);
      if (!st.isFile()) throw new Error(`workspace ${this.dir}: ${WORKSPACE_MARKER} is not a regular file`);
      try { marker = JSON.parse(readFileSync(markerPath, 'utf8')); } catch { marker = null; }
      if (!marker || marker.host !== want.host || marker.arm !== arm || marker.world !== world) {
        throw new Error(`workspace ${this.dir} belongs to another run (${JSON.stringify(marker)?.slice(0, 200)}); refusing to empty it`);
      }
    } else if (others.length) {
      throw new Error(`workspace ${this.dir} is not empty and was not created by the host (${others.slice(0, 5).join(', ')}); refusing to empty it`);
    }
    if (!marker) writeFileSync(markerPath, JSON.stringify(want) + '\n');
    return { fresh: !others.length };
  }

  /** Walk the directory: { files: { relPath: sha256 }, bytes, problems }. The host marker is not part of it. */
  scan() {
    const files = {}, problems = [];
    let bytes = 0;
    const walk = rel => {
      const abs = path.join(this.dir, rel);
      for (const name of readdirSync(abs).sort()) {
        if (!rel && name === WORKSPACE_MARKER) continue;
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
    for (const name of existsSync(this.dir) ? readdirSync(this.dir) : []) if (name !== WORKSPACE_MARKER) rmSync(path.join(this.dir, name), { recursive: true, force: true });
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
