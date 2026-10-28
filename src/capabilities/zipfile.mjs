// A minimal ZIP reader and writer for trace artifacts (ARCHITECTURE.md §2.5, I7): the UI trace is unpacked in memory, every held secret is
// redacted from every entry, the result is checked clean and written back, all before the artifact gets its final name. Supported: the
// archives Playwright writes (stored or deflated entries, no encryption, no ZIP64, no multi-disk). Anything else is refused, never
// passed through unread (a trace that cannot be scanned is not exported).
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';
import { fail } from './common.mjs';

const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;
const MAX_ENTRIES = 10000, MAX_TOTAL = 512 * 1024 * 1024;

/** Entries of a ZIP archive: [{ name, data }]. */
export function readZip(buffer) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65535); i--) if (buffer.readUInt32LE(i) === EOCD) { end = i; break; }
  if (end < 0) fail('ZIP_UNSUPPORTED', 'Not a ZIP archive (no end of central directory)');
  const count = buffer.readUInt16LE(end + 10), size = buffer.readUInt32LE(end + 12), offset = buffer.readUInt32LE(end + 16);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff || buffer.readUInt16LE(end + 4) !== 0) fail('ZIP_UNSUPPORTED', 'ZIP64 and multi-disk archives are not supported');
  if (count > MAX_ENTRIES || offset + size > end) fail('ZIP_UNSUPPORTED', 'The central directory is out of bounds');
  const entries = [];
  let at = offset, total = 0;
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(at) !== CENTRAL) fail('ZIP_UNSUPPORTED', 'Malformed central directory');
    const flags = buffer.readUInt16LE(at + 8), method = buffer.readUInt16LE(at + 10), compressed = buffer.readUInt32LE(at + 20), length = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28), extraLength = buffer.readUInt16LE(at + 30), commentLength = buffer.readUInt16LE(at + 32), local = buffer.readUInt32LE(at + 42);
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    if (flags & 0x1) fail('ZIP_UNSUPPORTED', 'Encrypted ZIP entries are not supported');
    if (buffer.readUInt32LE(local) !== LOCAL) fail('ZIP_UNSUPPORTED', 'Malformed local header');
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28), raw = buffer.subarray(start, start + compressed);
    if (start + compressed > buffer.length) fail('ZIP_UNSUPPORTED', 'An entry is out of bounds');
    total += length;
    if (total > MAX_TOTAL) fail('ZIP_UNSUPPORTED', 'The archive expands beyond the supported size');
    if (method !== 0 && method !== 8) fail('ZIP_UNSUPPORTED', `Compression method ${method} is not supported`);
    let data;
    try { data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: Math.max(1, length) }); } catch { fail('ZIP_UNSUPPORTED', `Entry ${name.slice(0, 60)} does not inflate to its recorded size`); }
    if (data.length !== length || (crc32(data) >>> 0) !== buffer.readUInt32LE(at + 16)) fail('ZIP_UNSUPPORTED', `Entry ${name.slice(0, 60)} does not match its recorded size or checksum`);
    entries.push({ name, data });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** A ZIP archive of [{ name, data }] (deflated entries, fixed timestamps so the same content gives the same bytes). */
export function writeZip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8'), body = deflateRawSync(data), crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body); centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
