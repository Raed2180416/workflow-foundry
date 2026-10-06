// Load bed families (beds/<id>/index.mjs, or sealed ones through beds/sealed/loader.mjs) and
// render tasks for arms. Arms only ever receive the rendered task, never the oracle.
import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { canonical, sha256 } from '../../beds/lib/canonical.mjs';

const root = path.resolve(new URL('../..', import.meta.url).pathname);
const cache = new Map();

export async function loadFamily(id) {
  if (cache.has(id)) return cache.get(id);
  let mod;
  if (id.startsWith('sealed-')) {
    const { loadSealed } = await import(pathToFileURL(path.join(root, 'beds/sealed/loader.mjs')).href);
    mod = await loadSealed(Number(id.slice('sealed-'.length)));
  } else {
    const file = path.join(root, 'beds', id, 'index.mjs');
    if (!existsSync(file)) throw new Error(`Unknown bed family ${id}`);
    mod = await import(pathToFileURL(file).href);
  }
  for (const name of ['family', 'outputSchema', 'generate', 'oracle', 'referenceSolve', 'badControls']) {
    if (!(name in mod)) throw new Error(`Bed ${id} does not export ${name}`);
  }
  cache.set(id, mod);
  return mod;
}

export async function makeTasks(familyId, { split = 'dev', seeds, difficulty = 3 }) {
  const fam = await loadFamily(familyId);
  return seeds.map(seed => {
    const task = fam.generate({ seed, split, difficulty });
    return { familyId, task, taskKey: `${familyId}:${split}:d${difficulty}:s${seed}`, taskHash: sha256(canonical(task)) };
  });
}

// What a solver sees: the prompt, the inputs (as a JSON file) and any task files.
export function solverView(task) {
  const files = { 'inputs.json': JSON.stringify(task.inputs ?? {}, null, 2) };
  for (const [rel, content] of Object.entries(task.files ?? {})) files[`files/${rel}`] = content;
  return { prompt: task.prompt, files };
}

// Inline rendering for single-call arms (no tools): prompt + inputs as canonical JSON + files.
export function inlineRender(task) {
  const parts = [task.prompt, '', '## inputs.json', '```json', JSON.stringify(task.inputs ?? {}, null, 1), '```'];
  for (const [rel, content] of Object.entries(task.files ?? {})) parts.push('', `## files/${rel}`, '```', content, '```');
  return parts.join('\n');
}

export async function score(familyId, task, output) {
  const fam = await loadFamily(familyId);
  try { return fam.oracle(task, output); }
  catch (error) { return { pass: false, score: 0, details: { oracleError: String(error?.message ?? error) } }; }
}
