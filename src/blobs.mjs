// Data handles (engine gap 1; research/engine-20261104/DATA-HANDLES.md): a content-addressed, immutable blob store
// in the workspace, so workflows over data far larger than an inline JSON value pass references, not the data.
//
// A handle is plain JSON: {"$blob": "<sha256>", "bytes": N, "mediaType": "text/plain" | "application/json" |
// "application/x-ndjson"}. A view is a handle plus "range": [start, end] (bytes, end exclusive) or "lines": [first,
// last] (0-based, end exclusive); a view never copies bytes. Blobs are written only by host code (this store and
// capabilities), never by the code sandbox or a model. Every read verifies the blob's size and full sha256 once per
// process, so an edited or truncated blob is BLOB_CORRUPT, never silently served.
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FoundryError } from './data.mjs';

const MiB = 1024 * 1024, GiB = 1024 * MiB;
export const MEDIA_TYPES = Object.freeze(['text/plain', 'application/json', 'application/x-ndjson']);
export const BLOB_LIMITS = Object.freeze({ maxBlobBytes: GiB, maxStoreBytes: 20 * GiB, maxReadBytes: 32 * MiB });
const HEX64 = /^[0-9a-f]{64}$/;
const CHUNK = 4 * MiB;
const isCount = v => Number.isSafeInteger(v) && v >= 0;
const pair = v => Array.isArray(v) && v.length === 2 && v.every(isCount) && v[0] <= v[1];

// The exact shape check. A handle has three keys; a view adds exactly one of range or lines.
export function isHandle(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort().join(',');
  if (!['$blob,bytes,mediaType', '$blob,bytes,mediaType,range', '$blob,bytes,lines,mediaType'].includes(keys)) return false;
  if (typeof value.$blob !== 'string' || !HEX64.test(value.$blob) || !isCount(value.bytes) || !MEDIA_TYPES.includes(value.mediaType)) return false;
  if (value.range !== undefined) return pair(value.range) && value.range[1] <= value.bytes;
  if (value.lines !== undefined) return pair(value.lines);
  return true;
}
const handleOf = h => ({ $blob: h.$blob, bytes: h.bytes, mediaType: h.mediaType });

export class BlobStore {
  #verified = new Set();
  #lineStarts = new Map();
  #total = null;
  // directory: the workspace's .foundry directory (Store.directory). Blobs live in <directory>/blobs/<aa>/<sha256>.
  constructor(directory, limits = {}) {
    this.root = path.join(directory, 'blobs');
    this.limits = { ...BLOB_LIMITS, ...limits };
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    if (lstatSync(this.root).isSymbolicLink()) throw new FoundryError('STATE_PATH', 'The blob directory must not be a symlink');
  }
  pathOf(hash) {
    if (!HEX64.test(hash)) throw new FoundryError('BLOB_HANDLE', 'A blob id is a sha256 in lower-case hex');
    return path.join(this.root, hash.slice(0, 2), hash);
  }
  totalBytes() {
    if (this.#total === null) {
      let total = 0;
      for (const dir of readdirSync(this.root)) {
        const sub = path.join(this.root, dir);
        if (!statSync(sub).isDirectory()) continue;
        for (const f of readdirSync(sub)) if (HEX64.test(f)) total += statSync(path.join(sub, f)).size;
      }
      this.#total = total;
    }
    return this.#total;
  }
  // Store bytes and return their handle. Idempotent: the same bytes give the same handle and are stored once.
  put(data, mediaType) {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    if (!MEDIA_TYPES.includes(mediaType)) throw new FoundryError('BLOB_HANDLE', `mediaType must be one of ${MEDIA_TYPES.join(', ')}`);
    if (bytes.length > this.limits.maxBlobBytes) throw new FoundryError('BLOB_TOO_LARGE', `A blob of ${bytes.length} bytes exceeds the ${this.limits.maxBlobBytes}-byte limit`);
    if (mediaType === 'application/json') { try { JSON.parse(bytes.toString('utf8')); } catch { throw new FoundryError('BLOB_HANDLE', 'application/json blob content is not valid JSON'); } }
    const hash = createHash('sha256').update(bytes).digest('hex'), file = this.pathOf(hash);
    if (existsSync(file)) { this.verify({ $blob: hash, bytes: bytes.length, mediaType }); return { $blob: hash, bytes: bytes.length, mediaType }; }
    if (this.totalBytes() + bytes.length > this.limits.maxStoreBytes) throw new FoundryError('BLOB_QUOTA', `Storing ${bytes.length} more bytes would pass the ${this.limits.maxStoreBytes}-byte store quota`);
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    try { writeFileSync(temp, bytes, { mode: 0o400, flag: 'wx' }); renameSync(temp, file); }
    catch (error) { rmSync(temp, { force: true }); throw error; }
    this.#total += bytes.length; this.#verified.add(hash);
    return { $blob: hash, bytes: bytes.length, mediaType };
  }
  // Check the stored file is exactly the blob the handle names: present, the stated size, the stated sha256.
  verify(handle) {
    if (!isHandle(handle)) throw new FoundryError('BLOB_HANDLE', 'Not a blob handle or view');
    const file = this.pathOf(handle.$blob);
    let fd;
    try { fd = openSync(file, 'r'); } catch { throw new FoundryError('BLOB_MISSING', `Blob ${handle.$blob.slice(0, 12)}… is not in this workspace`); }
    try {
      const size = fstatSync(fd).size;
      if (size !== handle.bytes) throw new FoundryError('BLOB_CORRUPT', `Blob ${handle.$blob.slice(0, 12)}… is ${size} bytes, not ${handle.bytes}`);
      if (this.#verified.has(handle.$blob)) return true;
      const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(Math.min(CHUNK, Math.max(1, size)));
      for (let at = 0; at < size;) { const n = readSync(fd, buffer, 0, Math.min(buffer.length, size - at), at); if (n <= 0) break; hash.update(buffer.subarray(0, n)); at += n; }
      if (hash.digest('hex') !== handle.$blob) throw new FoundryError('BLOB_CORRUPT', `Blob ${handle.$blob.slice(0, 12)}… does not match its sha256`);
      this.#verified.add(handle.$blob); return true;
    } finally { closeSync(fd); }
  }
  // Byte offsets where each line starts (a final newline does not start an empty line), cached per blob.
  lineStarts(handle) {
    if (this.#lineStarts.has(handle.$blob)) return this.#lineStarts.get(handle.$blob);
    this.verify(handle);
    const starts = handle.bytes ? [0] : [], fd = openSync(this.pathOf(handle.$blob), 'r'), buffer = Buffer.allocUnsafe(CHUNK);
    try {
      for (let at = 0; at < handle.bytes;) {
        const n = readSync(fd, buffer, 0, Math.min(CHUNK, handle.bytes - at), at);
        for (let i = 0; i < n; i++) if (buffer[i] === 10 && at + i + 1 < handle.bytes) starts.push(at + i + 1);
        at += n;
      }
    } finally { closeSync(fd); }
    this.#lineStarts.set(handle.$blob, starts); return starts;
  }
  // The byte range a handle or view covers.
  rangeOf(view) {
    if (view.range) return view.range;
    if (!view.lines) return [0, view.bytes];
    const starts = this.lineStarts(view), [first, last] = view.lines;
    if (last > starts.length) throw new FoundryError('BLOB_RANGE', `Lines [${first}, ${last}) pass the blob's ${starts.length} lines`);
    return [first === last ? 0 : starts[first], first === last ? 0 : (last < starts.length ? starts[last] : view.bytes)];
  }
  // Read a handle or view: as "text", "json" (the whole range parsed) or "lines" (an array of lines; NDJSON lines are
  // parsed). Never more than maxBytes (default and ceiling: the store's maxReadBytes).
  read(view, { as = 'text', maxBytes = this.limits.maxReadBytes } = {}) {
    if (!['text', 'json', 'lines'].includes(as)) throw new FoundryError('BLOB_HANDLE', 'as must be text, json or lines');
    this.verify(view);
    const [start, end] = this.rangeOf(view), cap = Math.min(maxBytes, this.limits.maxReadBytes);
    if (end - start > cap) throw new FoundryError('BLOB_READ_LIMIT', `Reading ${end - start} bytes exceeds the ${cap}-byte read limit; read a smaller view`);
    const buffer = Buffer.allocUnsafe(end - start), fd = openSync(this.pathOf(view.$blob), 'r');
    try { for (let at = 0; at < buffer.length;) { const n = readSync(fd, buffer, at, buffer.length - at, start + at); if (n <= 0) break; at += n; } }
    finally { closeSync(fd); }
    const text = buffer.toString('utf8');
    if (as === 'text') return text;
    if (as === 'json') { try { return JSON.parse(text); } catch { throw new FoundryError('BLOB_HANDLE', 'The blob range is not valid JSON'); } }
    const lines = text.length ? text.replace(/\n$/, '').split('\n') : [];
    if (view.mediaType !== 'application/x-ndjson') return lines;
    return lines.map((line, i) => { try { return JSON.parse(line); } catch { throw new FoundryError('BLOB_HANDLE', `NDJSON line ${i} of the range is not valid JSON`); } });
  }
  // Cut a text or NDJSON blob into views of at most maxLines lines and maxBytes bytes, at line boundaries only.
  split(handle, { maxLines = Infinity, maxBytes = Infinity } = {}) {
    if (handle.range || handle.lines) throw new FoundryError('BLOB_HANDLE', 'Split a whole blob, not a view');
    if (!(maxLines >= 1) || !(maxBytes >= 1)) throw new FoundryError('BLOB_HANDLE', 'maxLines and maxBytes must be at least 1');
    const starts = this.lineStarts(handle), views = [];
    const endOf = i => (i < starts.length ? starts[i] : handle.bytes);
    for (let first = 0; first < starts.length;) {
      let last = first + 1;
      if (endOf(last) - starts[first] > maxBytes) throw new FoundryError('BLOB_RANGE', `Line ${first} alone is longer than maxBytes ${maxBytes}`);
      while (last < starts.length && last - first < maxLines && endOf(last + 1) - starts[first] <= maxBytes) last += 1;
      views.push({ ...handleOf(handle), lines: [first, last] }); first = last;
    }
    return views;
  }
}
