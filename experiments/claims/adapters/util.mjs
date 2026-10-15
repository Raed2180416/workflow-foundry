// Shared helpers for the back-fill adapters ($0; read-only file access).
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyRow } from '../schema.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const rel = p => path.relative(ROOT, p);
export const abs = p => (path.isAbsolute(p) ? p : path.join(ROOT, p));
export const sha256 = buf => createHash('sha256').update(buf).digest('hex');
export const fileSha = p => sha256(readFileSync(abs(p)));
export const readJson = p => JSON.parse(readFileSync(abs(p), 'utf8'));
export const readJsonl = p => (existsSync(abs(p)) ? readFileSync(abs(p), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
export const exists = p => existsSync(abs(p));

/** Provenance entries (schema.mjs header). */
export const P = Object.freeze({
  copied: from => ({ kind: 'copied', from }),
  computed: rule => ({ kind: 'computed', rule }),
  code: from => ({ kind: 'code', from }),
  doc: from => ({ kind: 'doc', from }),
  missing: why => ({ kind: 'missing', why }),
  na: why => ({ kind: 'n/a', why }),
});

/** A stable row id from its identifying parts. */
export const rowId = (...parts) => sha256(parts.map(String).join('|')).slice(0, 20);

/** A fresh derived row with adapter, source files (path + sha256) and identity filled. */
export function baseRow({ adapter, files, experiment, arm, run, trial = 0, rowKind = 'task', taskKey }) {
  const r = emptyRow();
  Object.assign(r, { experiment, arm, run, trial, rowKind });
  r.task.key = taskKey;
  r.source = { adapter, files: files.map(f => ({ path: f.startsWith('/') && !f.startsWith(ROOT) ? f : rel(abs(f)), sha256: fileSha(f) })) };
  r.id = rowId(adapter, run, arm, taskKey, trial, rowKind);
  return r;
}

/** Max number of [start, end) intervals open at once (observed concurrency); null when no interval is known. */
export function observedMax(intervals) {
  const ev = [];
  for (const [s, e] of intervals) if (Number.isFinite(s) && Number.isFinite(e) && e >= s) { ev.push([s, 1], [e, -1]); }
  if (!ev.length) return null;
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0, max = 0;
  for (const [, d] of ev) { cur += d; if (cur > max) max = cur; }
  return max;
}

export const iso = ms => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
