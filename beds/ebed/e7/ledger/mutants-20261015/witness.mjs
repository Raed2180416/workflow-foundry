// Witness journals for the E7 mutants whose separation turns on a pending deadline's projected window (ledger/MUTANTS.md
// §4, §5). $0, no model calls; dev seeds only (the cached mutation corpus of tools/mutate.mjs, worlds 1009-1012).
// A witness is a reference-run case of the corpus, edited the way an arm could write it, graded case by case with the
// shared grader (oracle/grade.mjs gradeCase) under the original oracle and under one mutant oracle, with the signature
// tools/mutate.mjs compares (verdict, first divergence layer/code/lid, critical codes).
//   lateAuto     a resolved incident nobody confirms; the arm writes every record up to D2 as the reference did, its own
//                instance does not tick after D2, and an instance bound to another case closes it `auto` at D2 + 61 min.
//   lateDeclare  as lateAuto for the R7.2 fail-safe declaration (setMajor at D + 16 min).
//   noCaller     an alert-opened incident (no caller) put on hold `awaitingCaller` one hour after its accept (SPEC-E §3.4:
//                any incident can be held for any reason), never answered; the arm writes every record the original requires
//                by then on time and closes it `no-caller-response` at D + 61 min from an instance bound to another case.
//   withCaller   as noCaller on a report-opened incident held for its caller (the reference run's own hold).
// Prerequisite: the corpus cache, built by `node beds/ebed/e7/tools/mutate.mjs` (any run that is not --golden-only).
//   node beds/ebed/e7/ledger/mutants-20261015/witness.mjs [--per 40]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const E7 = path.join(REPO, 'beds/ebed/e7');
const { mutantsOf, writeModuleSet } = await import(path.join(E7, 'tools/mutate.mjs'));
const { generateWorld } = await import(path.join(E7, 'world.mjs'));
const { gradeCase } = await import(path.join(REPO, 'beds/ebed/oracle/grade.mjs'));
const { caseView } = await import(path.join(REPO, 'beds/ebed/oracle/view.mjs'));
const { oracleItem } = await import(path.join(E7, 'index.mjs'));
const { canonicalArgs, referenceTransition } = await import(path.join(E7, 'transition.mjs'));

const argv = process.argv.slice(2);
const per = Number(argv[argv.indexOf('--per') + 1] || 40) || 40;
const corpusRoot = path.join(REPO, '.foundry/e7-mutate/corpus');
const dirs = existsSync(corpusRoot) ? readdirSync(corpusRoot).filter(d => existsSync(path.join(corpusRoot, d, 'buckets.json'))) : [];
if (!dirs.length) throw new Error('no corpus cache: run `node beds/ebed/e7/tools/mutate.mjs --only t1` once to build it');
const corpusDir = path.join(corpusRoot, dirs.sort((a, b) => a.localeCompare(b)).at(-1));
const meta = JSON.parse(readFileSync(path.join(corpusDir, 'meta.json'), 'utf8'));
if (meta.worlds.some(w => w.seed < 1001 || w.seed > 1199)) throw new Error('dev seeds only');
const revive = (k, v) => (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && Array.isArray(v.$set) ? new Set(v.$set) : v);
const B = JSON.parse(readFileSync(path.join(corpusDir, 'buckets.json'), 'utf8')).filter(x => x.journals.some(j => j.startsWith('ref-earliest')));
const W = meta.worlds.map(s => generateWorld({ seed: s.seed, difficulty: s.d, mix: 'tail', ...(s.size ? { size: s.size } : {}) }));
const MIN = 60_000;
const sources = { t: readFileSync(path.join(E7, 'transition.mjs'), 'utf8'), e: readFileSync(path.join(E7, 'sla.mjs'), 'utf8'), index: readFileSync(path.join(E7, 'index.mjs'), 'utf8') };
const MUTANTS = mutantsOf(sources);
const itemOf = async id => {
  const m = MUTANTS.find(x => x.id === id);
  const urls = writeModuleSet(path.join(REPO, '.foundry/e7-mutate/witness-modules', id), m, sources);
  return (await import(urls.index)).oracleItem;
};

const fd = v => (v.firstDivergence ? `${v.firstDivergence.layer}/${v.firstDivergence.code}/${v.firstDivergence.lid ?? v.firstDivergence.field ?? ''}` : '');
const sigOf = v => `${v.pool === 'completed' ? `${v.pass ? 1 : 0}${v.oracleError ? 'E' : ''}:${fd(v)}` : '-'}|${v.critical.map(x => x.code).sort().join(',')}`;
const EMPTY = { deliveries: [], ledger: [], tasks: [], taskEvents: [], calls: [] };
const canon = b => ({ ...b, ledger: b.ledger.map(r => ({ ...r, args: canonicalArgs(r.system, r.op, structuredClone(r.args)) })) });
const idxOf = (x, b) => ({ world: W[x.w], horizonMs: Date.parse(W[x.w].horizonEnd), bucket: cc => (cc === x.c ? b : EMPTY) });
const grade = (item, x, b) => sigOf(gradeCase({ item, world: Object.create(W[x.w]), idx: idxOf(x, b), c: x.c, pool: 'completed' }));
const away = (r, at) => ({ ...r, at, callAt: at, instance: 'IX', knows: new Set(), given: new Set() });   // emitted by another case's instance

/** The reference's case cut at the deadline: the deadline's own row moved to D + late, nothing else of the case after D. */
const lateRow = (pick, late) => x => {
  const b = JSON.parse(x.bucket, revive);
  const row = b.ledger.find(r => r.committed && pick(r));
  if (!row) return null;
  const D = Date.parse(row.args.at);
  const keep = r => r.at <= D;
  return canon({ deliveries: b.deliveries.filter(keep), calls: b.calls.filter(keep), tasks: b.tasks.filter(keep), taskEvents: b.taskEvents.filter(keep),
    ledger: [...b.ledger.filter(r => r !== row && keep(r)), away(row, D + late * MIN)].sort((p, q) => p.at - q.at || p.seq - q.seq) });
};

/** A hold awaiting the caller one hour after the accept (alert-opened: no caller), every required record on time, the closure late. */
const heldForCaller = (alert, late) => x => {
  const b0 = JSON.parse(x.bucket, revive);
  if ((b0.deliveries[0]?.event.type === 'alert.raised') !== alert) return null;
  const acc = b0.deliveries.find(d => d.event.type === 'resolver.update' && d.event.payload.action === 'accept');
  if (!acc) return null;
  const h = acc.at + 60 * MIN;
  const { ref, ...pl } = acc.event.payload;
  const hold = { ...acc, seq: acc.seq + 0.5, at: h, event: { ...acc.event, id: `${acc.event.id}-hold`, at: new Date(h).toISOString(), payload: { ...pl, action: 'hold', holdReason: 'awaitingCaller' } } };
  const base = { deliveries: [...b0.deliveries.filter(d => d.at <= acc.at), hold], ledger: b0.ledger.filter(r => r.at <= acc.at), tasks: [], taskEvents: [], calls: [] };
  let E;
  try { E = referenceTransition(W[x.w], caseView(idxOf(x, canon(base)), x.c, h + 30 * MIN)); } catch { return null; }
  const proj = E.effects.required.find(e => e.lid.endsWith(':no-caller-response'));
  if (!proj) return null;
  const D = proj.window.earliest - 1000;
  let seq = Math.max(...base.deliveries.map(d => d.seq), ...base.ledger.map(r => r.seq)) + 1;
  const rows = [];
  for (const e of E.effects.required) {
    if (e.lid.includes(':no-caller-response') || e.lid.includes(':closed-no-response') || e.window.earliest > h + 30 * MIN) continue;
    if (base.ledger.some(r => r.system === e.system && r.op === e.op && Object.entries(e.match).every(([k, v]) => JSON.stringify(canonicalArgs(r.system, r.op, r.args)[k]) === JSON.stringify(v)))) continue;
    const at = Math.max(e.window.earliest, h);
    rows.push({ seq: seq++, at, system: e.system, op: e.op, key: null, args: e.args, committed: true, status: 'ok', error: null, case: x.c, via: 'effect', injected: false, money: false, callAt: at, knows: new Set([x.c]), given: new Set(), instance: 'I1' });
  }
  const close = away({ seq: seq + 10_000, at: 0, system: 'itsm', op: 'close', key: null, args: proj.args, committed: true, status: 'ok', error: null, case: x.c, via: 'effect', injected: false, money: false }, D + late * MIN);
  return canon({ ...base, ledger: [...base.ledger, ...rows, close].sort((p, q) => p.at - q.at || p.seq - q.seq) });
};

const SCENARIOS = {
  lateAuto: lateRow(r => r.system === 'itsm' && r.op === 'close' && r.args.reason === 'auto', 61),
  lateDeclare: lateRow(r => r.system === 'itsm' && r.op === 'setMajor', 16),
  noCaller: heldForCaller(true, 61),
  withCaller: lateRow(r => r.system === 'itsm' && r.op === 'close' && r.args.reason === 'no-caller-response', 61),
};
// [mutant, scenario, expected]: t288, t294 and t278 (killed: the deadline's own window) check the harness itself.
const RUNS = [['t345', 'lateAuto', 'separates'], ['t288', 'lateAuto', 'separates'], ['t341', 'noCaller', 'separates'], ['t343', 'noCaller', 'same'],
  ['t341', 'withCaller', 'same'], ['t343', 'withCaller', 'same'], ['t278', 'withCaller', 'separates'], ['t347', 'lateDeclare', 'same'], ['t349', 'lateDeclare', 'same'], ['t294', 'lateDeclare', 'separates']];
const items = new Map();
let bad = 0;
for (const [id, sc, want] of RUNS) {
  if (!items.has(id)) items.set(id, await itemOf(id));
  let tried = 0, sep = 0, example = null;
  for (const x of B) {
    const b = SCENARIOS[sc](x);
    if (!b) continue;
    tried += 1;
    const o = grade(oracleItem, x, b), mu = grade(items.get(id), x, b);
    if (o !== mu) { sep += 1; example ??= `${meta.worlds[x.w].seed}:${x.c} original ${o} vs mutant ${mu}`; }
    if (tried >= per) break;
  }
  const got = sep ? 'separates' : 'same';
  if (got !== want) bad += 1;
  console.log(`${id.padEnd(5)} ${sc.padEnd(11)} ${sep}/${tried} cases separate${example ? `, e.g. ${example}` : ''}${got !== want ? `  (EXPECTED ${want})` : ''}`);
}
process.exitCode = bad ? 1 : 0;
