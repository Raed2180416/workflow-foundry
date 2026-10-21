// The OT-0 preregistration's frozen-file table (research/org-20261021/PREREG-OT0.md). `node freeze.mjs` prints the table
// of sha256s for the files a paid OT-0 row rests on; `preregCheck()` (called by build-wc.mjs and run-agents.mjs before
// any paid session) refuses unless the prereg is marked FROZEN and every listed file still has its listed sha256.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
export const PREREG_FILE = path.join(ROOT, 'research/org-20261021/PREREG-OT0.md');
export const FROZEN = Object.freeze([
  'research/org-20261021/PREDICTION.md',
  'experiments/constitution/schema/constitution-v0.schema.json',
  'experiments/constitution/instances/v1.json', 'experiments/constitution/instances/v2.json', 'experiments/constitution/instances/v3-planted.json',
  'experiments/constitution/builder/CONSTITUTION-ARM.md',
  ...['constitution', 'registry', 'overlay', 'port', 'shield', 'guard', 'observer', 'auditor', 'arms', 'run', 'build-wc', 'run-agents', 'validity'].map(f => `experiments/constitution/${f}.mjs`),
  // E8 and the arms' machinery, imported read-only (frozen for COMP-1 as well)
  'beds/ebed/e8/index.mjs', 'beds/ebed/e8/world.mjs', 'beds/ebed/e8/transition.mjs', 'beds/ebed/e8/actors.mjs', 'beds/ebed/e8/spec/SPEC-E.md',
  'beds/ebed/host/host.mjs', 'beds/ebed/host/actors.mjs', 'beds/ebed/oracle/grade.mjs', 'beds/ebed/oracle/view.mjs',
  'experiments/ebed/agent-arm.mjs', 'experiments/ebed/build.mjs', 'experiments/ebed/smoke-service.mjs', 'experiments/agentv/arm.mjs',
  'research/enterprise-20261014/runs/b1lh-e8-1/solver.mjs', 'research/enterprise-20261014/runs/b1nh-e8-2/solver.mjs', 'research/enterprise-20261014/runs/b1nh-e8-3/solver.mjs',
  'policy/models.json',
  // the session runtime of the paid arms (engine v2's patch series changes these: the freeze names the version the rows ran on)
  'src/executors/claude-code.mjs', 'src/executors/openai-chat.mjs', 'src/models/policy.mjs', 'src/models/providers/claude-cli.mjs',
]);
const shaOf = f => createHash('sha256').update(readFileSync(path.join(ROOT, f))).digest('hex');

/** The table rows: `<sha256>  <path>`. */
export const table = () => FROZEN.map(f => `${existsSync(path.join(ROOT, f)) ? shaOf(f) : 'MISSING'.padEnd(64)}  ${f}`);

/** Throws unless PREREG-OT0.md is FROZEN and every listed sha256 matches the file on disk. */
export function preregCheck(file = PREREG_FILE) {
  if (!existsSync(file)) throw new Error(`no preregistration at ${file}`);
  const text = readFileSync(file, 'utf8');
  if (!/^\*\*Status: FROZEN/m.test(text)) throw new Error('PREREG-OT0.md is a draft: the owner must freeze it (Status: FROZEN) before any paid OT-0 row');
  const rows = [...text.matchAll(/^([0-9a-f]{64})  (\S+)$/gm)].map(m => ({ sha: m[1], file: m[2] }));
  if (!rows.length) throw new Error('PREREG-OT0.md lists no frozen files');
  const bad = rows.filter(r => !existsSync(path.join(ROOT, r.file)) || shaOf(r.file) !== r.sha);
  if (bad.length) throw new Error(`frozen files changed since the prereg: ${bad.map(r => r.file).join(', ')}`);
  return { sha256: createHash('sha256').update(text).digest('hex'), files: rows.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(table().join('\n'));
