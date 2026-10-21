// The OT-0 preregistration's frozen-file table (research/org-20261021/PREREG-OT0.md). `node freeze.mjs` prints the table
// of sha256s for the files a paid OT-0 row rests on; `preregCheck()` (called by build-wc.mjs and run-agents.mjs before
// any paid session) refuses unless the prereg is marked FROZEN and every listed file still has its listed sha256, or the
// sha256 an adopted amendment beside it (PREREG-OT0-AMEND-<n>.md, bound to the prereg's own sha256) superseded it with.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
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

/**
 * The adopted amendments beside a prereg (`<name>-AMEND-<n>.md`, in n order). An amendment supersedes frozen rows only
 * through its own text: it must be marked `**Status: ADOPTED`, name the sha256 of the prereg it amends
 * (`amends <path> <sha256>`), and each `supersedes <old> -> <new>  <path>` row must name a frozen path whose expected
 * sha256 (the table's, or an earlier amendment's) is <old>. Anything else throws. Returns [{ file, sha256, rows }].
 */
export function amendmentsOf(file, preregSha) {
  const dir = path.dirname(file), stem = path.basename(file, '.md');
  const re = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-AMEND-(\\d+)\\.md$`);
  return readdirSync(dir).map(f => ({ f, m: f.match(re) })).filter(x => x.m).sort((a, b) => Number(a.m[1]) - Number(b.m[1])).map(({ f }) => {
    const text = readFileSync(path.join(dir, f), 'utf8');
    if (!/^\*\*Status: ADOPTED/m.test(text)) throw new Error(`${f} is not adopted (Status: ADOPTED): a draft amendment cannot change the frozen table`);
    const amends = [...text.matchAll(/^amends (\S+) ([0-9a-f]{64})$/gm)];
    if (amends.length !== 1 || amends[0][2] !== preregSha) throw new Error(`${f} does not amend this prereg (it must name its sha256 ${preregSha} once)`);
    const rows = [...text.matchAll(/^supersedes (\S+) -> (\S+)  (\S+)$/gm)].map(m => ({ old: m[1], sha: m[2], file: m[3] }));
    if (!rows.length) throw new Error(`${f} supersedes no row`);
    for (const r of rows) if (!/^[0-9a-f]{64}$/.test(r.old) || !/^[0-9a-f]{64}$/.test(r.sha)) throw new Error(`${f}: the row for ${r.file} needs two sha256s (old -> new)`);
    return { file: path.relative(ROOT, path.join(dir, f)), sha256: createHash('sha256').update(text).digest('hex'), rows };
  });
}

/**
 * Throws unless PREREG-OT0.md is FROZEN and every listed file has its expected sha256: the table's, or the one an
 * adopted amendment (amendmentsOf) superseded it with. Returns { sha256, files, amendments }.
 */
export function preregCheck(file = PREREG_FILE) {
  if (!existsSync(file)) throw new Error(`no preregistration at ${file}`);
  const text = readFileSync(file, 'utf8');
  if (!/^\*\*Status: FROZEN/m.test(text)) throw new Error('PREREG-OT0.md is a draft: the owner must freeze it (Status: FROZEN) before any paid OT-0 row');
  const rows = [...text.matchAll(/^([0-9a-f]{64})  (\S+)$/gm)].map(m => ({ sha: m[1], file: m[2] }));
  if (!rows.length) throw new Error('PREREG-OT0.md lists no frozen files');
  const sha256 = createHash('sha256').update(text).digest('hex');
  const expected = new Map(rows.map(r => [r.file, r.sha]));
  const amendments = amendmentsOf(file, sha256);
  for (const a of amendments) for (const r of a.rows) {
    if (!expected.has(r.file)) throw new Error(`${a.file} supersedes ${r.file}, which is not in the frozen table`);
    if (expected.get(r.file) !== r.old) throw new Error(`${a.file} supersedes ${r.file} at ${r.old.slice(0, 12)}…, but the frozen (or earlier amended) sha256 is ${expected.get(r.file).slice(0, 12)}…`);
    expected.set(r.file, r.sha);
  }
  const bad = [...expected].filter(([f, sha]) => !existsSync(path.join(ROOT, f)) || shaOf(f) !== sha).map(([f]) => f);
  if (bad.length) throw new Error(`frozen files changed since the prereg${amendments.length ? ' and its amendments' : ''}: ${bad.join(', ')}`);
  return { sha256, files: rows.length, amendments: amendments.map(a => ({ file: a.file, sha256: a.sha256, supersedes: a.rows.map(r => r.file) })) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(table().join('\n'));
