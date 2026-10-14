// Pre-execution features for the need router: what is known about a task family BEFORE any model works on it. $0.
// Code features only: the task's shape (experiments/library/index.mjs shapeOf, LIBRARY §4.2), its input size, the output
// schema's size, and the owner-declared fields (volume N, value V, hard requirements). Nothing here reads an oracle,
// a reference solution, a label, a bed version or the family id: the router sees `features[family]` and nothing else
// (WHITELIST; tests assert it).
//   node experiments/need-router/features.mjs [--families records,kinetics,...] [--seeds 601-603] [--difficulty 3] [--json out]
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTasks, loadFamily } from '../lib/beds.mjs';
import { shapeOf } from '../library/index.mjs';

export const WHITELIST = Object.freeze(['logInputTokens', 'logSchemaLeaves', 'itemLists', 'maxListLength', 'freeText', 'multiSource',
  'conventionsInProse', 'effectVerbs', 'timeWords', 'humanWords', 'verifiable', 'promptWords']);

/** Leaves of a JSON schema (properties, items, combinators), a size measure of the required output. */
export function schemaLeaves(s, depth = 0) {
  if (!s || typeof s !== 'object' || depth > 12) return 0;
  let n = 0;
  if (s.properties) for (const v of Object.values(s.properties)) n += schemaLeaves(v, depth + 1);
  if (s.items) n += schemaLeaves(Array.isArray(s.items) ? { anyOf: s.items } : s.items, depth + 1);
  for (const k of ['anyOf', 'oneOf', 'allOf']) if (Array.isArray(s[k])) for (const v of s[k]) n += schemaLeaves(v, depth + 1);
  return n || 1;
}

/** Features of one rendered task (whitelisted keys only). */
export function taskFeatures(task, outputSchema) {
  const sh = shapeOf(task);
  const tokens = Math.ceil(Buffer.byteLength(JSON.stringify(task.inputs ?? {}) + Object.values(task.files ?? {}).join('\n') + String(task.prompt ?? '')) / 4);
  return {
    logInputTokens: Math.log10(1 + tokens), logSchemaLeaves: Math.log10(1 + schemaLeaves(outputSchema)),
    itemLists: sh.itemLists.count, maxListLength: Math.log10(1 + sh.itemLists.maxLength), freeText: sh.freeText.count, multiSource: sh.multiSource.pairs,
    conventionsInProse: Number(sh.conventionsInProse), effectVerbs: sh.effectVerbs.length, timeWords: sh.timeWords.length, humanWords: sh.humanWords.length,
    verifiable: Number(sh.verifiable), promptWords: Math.log10(1 + (String(task.prompt ?? '').match(/\S+/g) ?? []).length),
  };
}

/** A family's features: the median of its example tasks' features (the router sees examples, never evaluation tasks). */
export async function familyFeatures(familyId, { seeds = [601, 602, 603], difficulty = 3, split = 'dev' } = {}) {
  const fam = await loadFamily(familyId);
  const tasks = await makeTasks(familyId, { split, seeds, difficulty });
  const rows = tasks.map(t => taskFeatures(t.task, fam.outputSchema));
  const med = xs => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
  return Object.fromEntries(WHITELIST.map(k => [k, +med(rows.map(r => r[k])).toFixed(4)]));
}

export const CENSUS_FAMILIES = ['records', 'kinetics', 'incident', 'synth', 'codefix', 'ownerci', 'wbed-r0', 'wbed-r1', 'wbed-r2', 'wbed-r3', 'wbed-r3p', 'wbed-r4', 'wbed-r5', 'wbed-r6'];

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const fams = arg('--families', CENSUS_FAMILIES.join(',')).split(',');
  const [s0, s1] = arg('--seeds', '601-603').split('-').map(Number);
  const seeds = Array.from({ length: (s1 ?? s0) - s0 + 1 }, (_, i) => s0 + i);
  const out = {};
  for (const d of arg('--difficulty', '3').split(',').map(Number)) for (const f of fams) {
    try { out[`${f}@d${d}`] = await familyFeatures(f, { seeds, difficulty: d }); }
    catch (e) { out[`${f}@d${d}`] = { error: String(e?.message ?? e).slice(0, 200) }; }
    console.log(`${(`${f}@d${d}`).padEnd(16)} ${JSON.stringify(out[`${f}@d${d}`])}`);
  }
  const j = arg('--json', null);
  if (j) writeFileSync(j, JSON.stringify(out, null, 1));
}
