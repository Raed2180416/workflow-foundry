import { createHash } from 'node:crypto';

// Canonical JSON: sorted object keys, no whitespace. Used for task ids and hashes.
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}
export const sha256 = text => createHash('sha256').update(text).digest('hex');
export const hashOf = value => sha256(canonical(value));
// Rough token estimate used across Foundry (utf8 bytes / 4). Documented, not a tokenizer.
export const estimateTokens = value => Math.ceil(Buffer.byteLength(typeof value === 'string' ? value : canonical(value)) / 4);
