// Relative path rules for /files and job parameters, shared by daemon and client so the client
// refuses locally what the daemon would refuse remotely. The daemon additionally checks realpaths
// (symlink escapes) because only it can see the filesystem.
//
// A path is a '/'-joined list of 1..32 segments. Every segment matches NAME_RE: it starts with a
// letter or digit (so no dotfiles, no '.'/'..', no leading '-' that a CLI could read as a flag)
// and continues with [A-Za-z0-9._@+=,-]. No backslashes, NUL, percent signs, spaces, drive letters
// or empty segments. The first segment names the top directory (data, runs or logs).

export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._@+=,-]{0,254}$/;
export const TOPS = Object.freeze(['data', 'runs', 'logs']);
export const MAX_DEPTH = 32;
export const MAX_LEN = 1024;

export class RelPathError extends Error {
  constructor(reason, detail) { super(`invalid path: ${reason}${detail ? ` (${detail})` : ''}`); this.code = 'BAD_PATH'; this.reason = reason; }
}

// `decode: true` treats the input as a raw URL path tail and percent-decodes each segment first, so
// '%2e%2e', '%2F' and '%5C' are judged by what they decode to.
export function parseRelPath(input, { tops = TOPS, decode = false } = {}) {
  if (typeof input !== 'string' || input.length === 0) throw new RelPathError('empty');
  if (input.length > MAX_LEN * 3) throw new RelPathError('too_long');
  if (input.includes('\0')) throw new RelPathError('nul');
  if (input.includes('\\')) throw new RelPathError('backslash');
  if (input.startsWith('/')) throw new RelPathError('absolute');
  if (/^[A-Za-z]:/.test(input)) throw new RelPathError('drive_letter');
  const raw = input.split('/');
  if (raw.length > MAX_DEPTH) throw new RelPathError('too_deep');
  const segments = raw.map(seg => {
    let s = seg;
    if (decode) {
      try { s = decodeURIComponent(seg); } catch { throw new RelPathError('bad_encoding'); }
    }
    if (s.length === 0) throw new RelPathError('empty_segment');
    if (s.includes('\0')) throw new RelPathError('nul');
    if (s.includes('/') || s.includes('\\')) throw new RelPathError('encoded_separator');
    if (s === '.' || s === '..') throw new RelPathError('dot_segment');
    if (s.startsWith('.')) throw new RelPathError('hidden');
    if (!NAME_RE.test(s)) throw new RelPathError('bad_name', s.slice(0, 40));
    return s;
  });
  const rel = segments.join('/');
  if (rel.length > MAX_LEN) throw new RelPathError('too_long');
  if (!tops.includes(segments[0])) throw new RelPathError('outside_roots', `first segment must be one of ${tops.join(', ')}`);
  return { rel, segments };
}

export function isRelPath(input, opts) {
  try { parseRelPath(input, opts); return true; } catch { return false; }
}
