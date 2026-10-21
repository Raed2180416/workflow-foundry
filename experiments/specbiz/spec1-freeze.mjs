// SPEC-1 / INTENT-1 preregistration's frozen-file table (research/intent-20261021/PREREG-SPEC1.md). `node spec1-freeze.mjs`
// prints `<sha256>  <path>` for every file a paid row rests on (pack, truth, prompts, code, bed, policy); preregCheck()
// (called by spec1.mjs before any paid session) refuses unless the prereg says **Status: FROZEN** and every listed file
// still has its listed sha256. Code the engine bump may touch (src/) is stamped into every result at launch instead.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
export const PREREG_FILE = path.join(ROOT, 'research/intent-20261021/PREREG-SPEC1.md');
export const FROZEN = Object.freeze([
  // the pack (renderer, content, committed seed-1 pack) and the truth
  ...['spec-units', 'content', 'carriers', 'precedent', 'render', 'owner-sim', 'truth-e8', 'predicates', 'attribute'].map(f => `experiments/specbiz/${f}.mjs`),
  'research/intent-20261021/specbiz-pack-seed1/pack-truth.json', 'research/intent-20261021/truth-e8-seed1.json', 'research/intent-20261021/rater2-labels.json',
  'research/intent-20261021/corpus-prior.json', 'research/need-router-20261014/tracker-e8/gold.json',
  // the SPEC-1 code and prompts
  ...['spec1-arms', 'ask-service', 'ledger-review', 'pack-agent', 'spec1', 'spec1-freeze', 'score'].map(f => `experiments/specbiz/${f}.mjs`),
  'experiments/tracker/extract.mjs', 'experiments/tracker/ledger.mjs',
  // the B1L-H and AGENTV-E8 machinery, imported read-only
  'experiments/ebed/build.mjs', 'experiments/ebed/smoke-service.mjs', 'experiments/ebed/agent-arm.mjs',
  'experiments/agentv/arm.mjs', 'experiments/agentv/validator.mjs', 'experiments/agentv/run.mjs',
  'research/enterprise-20261014/BED-CONTRACT-v1.1.md', 'beds/ebed/host/README.md',
  // the bed (E8 and its host and oracle); SPEC-E is the renderer's input and the S-perfect arm's spec
  'beds/ebed/e8/index.mjs', 'beds/ebed/e8/world.mjs', 'beds/ebed/e8/transition.mjs', 'beds/ebed/e8/actors.mjs', 'beds/ebed/e8/systems.mjs', 'beds/ebed/e8/spec/SPEC-E.md',
  'beds/ebed/host/host.mjs', 'beds/ebed/host/output.mjs', 'beds/ebed/host/mocks.mjs', 'beds/ebed/host/sandbox-arm.mjs', 'beds/ebed/oracle/grade.mjs', 'beds/ebed/oracle/view.mjs', 'beds/ebed/oracle/policy.mjs',
  // the S-perfect comparators (existing rows, not re-run)
  'research/enterprise-20261014/runs/regrade-oracle2-b1lh-e8-1/result.json', 'research/enterprise-20261014/runs/regrade-oracle2-b1lh-e8-2/result.json',
  'research/enterprise-20261014/runs/regrade-oracle2-b1lh-e8-3/result.json',
  'research/enterprise-20261014/runs/grade-s12-b1lh-e8-1/result.json',
  'research/enterprise-20261014/runs/agentv-e8-s12/result.json',
  // policy and prices
  'policy/models.json', 'research/need-router-20261014/prereg/stages.json',
]);
/** Engine files stamped (sha256) into every result at launch: an engine bump between freeze and run shows up there. */
export const STAMPED = Object.freeze(['src/executors/claude-code.mjs', 'src/executors/openai-chat.mjs', 'src/models/port.mjs', 'src/models/policy.mjs',
  'src/models/providers/claude-cli.mjs', 'src/journal.mjs', 'beds/lib/canonical.mjs']);

const shaOf = f => createHash('sha256').update(readFileSync(path.join(ROOT, f))).digest('hex');
export const stamps = (files = STAMPED) => Object.fromEntries(files.map(f => [f, existsSync(path.join(ROOT, f)) ? shaOf(f) : null]));

/** The table rows: `<sha256>  <path>`. */
export const table = () => FROZEN.map(f => `${existsSync(path.join(ROOT, f)) ? shaOf(f) : 'MISSING'.padEnd(64)}  ${f}`);

/** Throws unless the prereg is FROZEN and every listed sha256 matches the file on disk. */
export function preregCheck(file = PREREG_FILE) {
  if (!existsSync(file)) throw new Error(`no preregistration at ${file}`);
  const text = readFileSync(file, 'utf8');
  if (!/^\*\*Status: FROZEN/m.test(text)) throw new Error('PREREG-SPEC1.md is a draft: the orchestrator must freeze it (**Status: FROZEN**) before any paid SPEC-1 / INTENT-1 row');
  const rows = [...text.matchAll(/^([0-9a-f]{64})  (\S+)$/gm)].map(m => ({ sha: m[1], file: m[2] }));
  if (!rows.length) throw new Error('PREREG-SPEC1.md lists no frozen files');
  const listed = new Set(rows.map(r => r.file)), missing = FROZEN.filter(f => !listed.has(f));
  if (missing.length) throw new Error(`PREREG-SPEC1.md does not list every frozen file: ${missing.join(', ')}`);
  const bad = rows.filter(r => !existsSync(path.join(ROOT, r.file)) || shaOf(r.file) !== r.sha);
  if (bad.length) throw new Error(`frozen files changed since the prereg: ${bad.map(r => r.file).join(', ')}`);
  return { sha256: createHash('sha256').update(text).digest('hex'), files: rows.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(table().join('\n'));
