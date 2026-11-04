// Capability type vocabulary (`foundry-nodecap-types/1`), ARCHITECTURE.md §3.6: `object.verb` names with an effect ceiling, the taint a
// member of the type carries, and optionally the type that verifies it. A requirement `{type}` matches a member of that type or a subtype
// (`contact.search` matches `contact.search.fuzzy`). Owner policy; a fixture lives at experiments/nodecap/fixtures/types.json.
import { readFileSync } from 'node:fs';
import { checkData, clone } from '../data.mjs';
import { validateData } from '../validate.mjs';
import { digest, EFFECTS } from './common.mjs';

const TYPE = '^[a-z][a-z0-9-]{0,40}(\\.[a-z][a-z0-9-]{0,40}){1,3}$';
export const typesSchema = { type: 'object', additionalProperties: false, required: ['schema', 'types'], properties: {
  schema: { const: 'foundry-nodecap-types/1' },
  types: { type: 'object', maxProperties: 500, propertyNames: { pattern: TYPE }, additionalProperties: { type: 'object', additionalProperties: false, required: ['effectCeiling', 'outputTaint'], properties: {
    effectCeiling: { enum: EFFECTS }, outputTaint: { enum: ['trusted', 'untrusted'] }, verifiedBy: { type: 'string', pattern: TYPE }, summary: { type: 'string', maxLength: 200 } } } } } };
export function checkTypes(types) { checkData(types); validateData(typesSchema, types, 'nodecap type vocabulary', { trustedSchema: true }); return clone(types); }
export const loadTypes = file => checkTypes(JSON.parse(readFileSync(file, 'utf8')));
export const typesDigest = types => `sha256:${digest(types)}`;
/** 2 exact, 1 subtype, 0 no match. */
export const typeMatch = (memberType, required) => memberType === required ? 2 : String(memberType).startsWith(`${required}.`) ? 1 : 0;
/** The declared entry of a type or its nearest declared ancestor. */
export function typeInfo(types, type) {
  for (let t = type; t.includes('.'); t = t.slice(0, t.lastIndexOf('.'))) if (types?.types?.[t]) return types.types[t];
  return null;
}
