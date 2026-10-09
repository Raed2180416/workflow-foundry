// Typed hand-offs between stages (W-BED §2.1 `stages`). A contract is a JSON schema in the portable subset
// (no pattern / oneOf / uniqueItems / $ref / format; beds/CONTRACT.md) with an id. The validator is the records bed's
// (beds/records/score.mjs `validate`), imported unchanged, so every W-bed rung rejects malformed hand-offs and outputs
// by the same rule.
import { validate } from '../../records/score.mjs';
import { hashOf } from './prng.mjs';

export { validate };

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Plain-data copy of a caller-supplied value (accessors, proxies and prototypes cannot show the validator one value
 *  and the scorer another). undefined when the value is not plain data. */
export function snapshot(value) {
  try { return structuredClone(value); } catch { return undefined; }
}

export function contract(id, schema) {
  return Object.freeze({
    id, schema, hash: hashOf(schema).slice(0, 16),
    /** [] when `value` satisfies the contract, else up to 32 error strings. */
    check(value) {
      const v = snapshot(value);
      if (v === undefined) return ['$: not plain JSON-like data'];
      return validate(schema, v);
    },
  });
}

// Shared building blocks.
export const int = { type: 'integer' };
export const str = (maxLength = 200) => ({ type: 'string', maxLength });
export const bool = { type: 'boolean' };
export const arr = (items, maxItems = 5000, extra = {}) => ({ type: 'array', items, maxItems, ...extra });
export const obj = (properties, required = Object.keys(properties), extra = {}) => ({ type: 'object', required, properties, ...extra });
export const nullable = s => ({ ...s, type: [].concat(s.type, 'null') });

/** True when every own key of `value` is declared by the object schema (contracts are closed at the top level). */
export function closedKeys(schema, value) {
  if (!value || typeof value !== 'object') return true;
  return Object.keys(value).every(k => own(schema.properties ?? {}, k));
}
