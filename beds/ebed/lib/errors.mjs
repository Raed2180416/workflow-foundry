// Error type shared by the E-bed oracle-side libraries (beds/ebed/lib). Every refusal carries a stable `code` so oracle
// code and tests can tell a spec error (a malformed table, an unknown zone) from a semantic refusal (a UNIQUE table with
// two hits, an edition that cannot be resolved). Libraries never fall back silently: anything they cannot evaluate
// exactly is thrown with a code (AGENTS: adapters reject unsupported semantics rather than flattening them).

export class EbedLibError extends Error {
  constructor(code, message, detail) {
    super(`${code}: ${message}`);
    this.name = 'EbedLibError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

export const fail = (code, message, detail) => { throw new EbedLibError(code, message, detail); };

/**
 * Deep-freeze a plain JSON-like value in place and return it. Calendars and decision tables are memoised by object
 * identity, so they are frozen on first use: a later mutation throws (ESM is strict mode) instead of being ignored.
 */
export function freezeDeep(v, seen = new Set()) {
  if (v && typeof v === 'object' && !seen.has(v)) { seen.add(v); Object.freeze(v); for (const k of Object.keys(v)) freezeDeep(v[k], seen); }
  return v;
}

/** Run `fn`; return the EbedLibError code it throws, or null. Other errors propagate (they are bugs). */
export function codeOf(fn) {
  try { fn(); return null; } catch (e) { if (e instanceof EbedLibError) return e.code; throw e; }
}
