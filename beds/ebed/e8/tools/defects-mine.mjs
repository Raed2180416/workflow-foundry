// Mine E8 latent defects from reference mutants (E-BED §2.10, §9.5; defects.mjs). $0, one process, sequential.
// Stage 1 runs every mutant (tools/mutate.mjs's transition mutants as the arm, plus E-BED §3 E8's hand candidates) on
// one dev world per difficulty, stopping at the first failing E0 case; stage 2 re-executes the E0-silence check and the
// mining on a second world per difficulty for the stage-1 survivors. Mutants with the same behaviour (journal digest) on
// every mining world are one defect; a defect is admitted when some world reveals it inside E2/E3. Writes one manifest
// per admitted defect and index.json under --out (default ledger/latent-defects/).
//   node beds/ebed/e8/tools/defects-mine.mjs [--stage1 1101:2,1101:3,1101:4,1101:5] [--stage2 1102:2,1102:3,1102:4,1102:5]
//        [--only ref-k12,hc-timer-first] [--limit N] [--out DIR] [--no-write]
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transitionMutants, HAND_CANDIDATES, armItemOf, mineOnWorld, prepareWorld, planReveal, defectManifest, baseDigests, scratchDir, removeDir, PARAMS } from '../defects.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const worldsOf = s => s.split(',').filter(Boolean).map(x => { const [seed, d] = x.split(':').map(Number); return { seed, difficulty: d }; });
const stage1 = worldsOf(arg('--stage1', '1101:2,1101:3,1101:4,1101:5'));
const stage2 = worldsOf(arg('--stage2', '1102:2,1102:3,1102:4,1102:5'));
for (const w of [...stage1, ...stage2]) if (!(w.seed >= 1001 && w.seed <= 1199)) throw new Error(`seed ${w.seed} outside the E-bed dev block 1001-1199`);
const only = arg('--only', null)?.split(',') ?? null;
const out = path.resolve(arg('--out', path.join(here, '..', 'ledger', 'latent-defects')));
const write = !process.argv.includes('--no-write');
const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(0);

let mutants = [...transitionMutants(), ...HAND_CANDIDATES];
if (only) mutants = mutants.filter(m => only.includes(m.id));
mutants = mutants.slice(0, Number(arg('--limit', String(mutants.length))));
const base = baseDigests();
// The oracle-mutant verdicts of the same edits (ledger/MUTANTS.md), when they were computed on this transition.
let oracleVerdicts = {};
try {
  const ev = path.join(here, '..', 'ledger', 'mutants-20261015');
  if (readFileSync(path.join(ev, 'README.md'), 'utf8').includes(`\`transition.mjs\` ${base.transition.slice(0, 12)}`)) {
    for (const x of JSON.parse(readFileSync(path.join(ev, 'data', 'classes.json'), 'utf8'))) oracleVerdicts[`ref-k${x.k}`] = { verdict: x.v, ledger: 'ledger/MUTANTS.md' };
  }
} catch { oracleVerdicts = {}; }

const dir = scratchDir();
const prepare = async list => { const r = []; for (const w of list) { r.push(await prepareWorld(w)); console.log(`  world ${r.at(-1).world.id}: ${Object.keys(r.at(-1).world.truth.cases).length} cases (${secs()} s)`); } return r; };
const status = new Map();        // id -> { status, e0First?, worlds: [{ world, digest, inert, affected }] }

async function mineAll(list, prepared, stageName) {
  for (const [n, m] of list.entries()) {
    const st = status.get(m.id) ?? { status: 'pending', worlds: [] };
    status.set(m.id, st);
    let item;
    try { item = await armItemOf(m, dir); } catch (e) { st.status = 'load-error'; st.error = String(e?.message ?? e).slice(0, 120); continue; }
    for (const p of prepared) {
      let r;
      try { r = await mineOnWorld({ mutant: m, item, prepared: p }); } catch (e) {
        const msg = String(e?.message ?? e);
        st.status = /wake-ups/.test(msg) ? 'runaway' : 'run-error'; st.stage = stageName; st.error = `${p.world.id}: ${msg.slice(0, 120)}`; break;
      }
      if (r.e0.failed.length) { st.status = `e0-visible`; st.stage = stageName; st.e0First = { world: p.world.id, ...r.e0.failed[0] }; break; }
      st.worlds.push({ world: p.world.id, digest: r.digest, inert: r.inert, affected: r.affected.length, oracleErrors: r.affected.filter(a => a.oracleError).length });
    }
    if (st.status === 'pending' || st.status === 'candidate') {
      const errs = st.worlds.reduce((s, w) => s + w.oracleErrors, 0);
      st.status = errs ? 'oracle-error' : st.worlds.some(w => w.affected) ? 'candidate' : st.worlds.every(w => w.inert) ? 'inert' : 'silent';
    }
    console.log(`    ${m.id} ${st.status}${st.e0First ? ` (${st.e0First.world.replace('ebed-e8-dev-', '')} ${st.e0First.case} ${st.e0First.code ?? ''})` : ''}${st.worlds.length ? ` affected ${st.worlds.map(w => w.affected).join('/')}` : ''} (${secs()} s)`);
    if ((n + 1) % 10 === 0 || n + 1 === list.length) {
      const tally = {}; for (const x of list.slice(0, n + 1)) { const s = status.get(x.id).status; tally[s] = (tally[s] ?? 0) + 1; }
      console.log(`  ${stageName} ${n + 1}/${list.length} (${secs()} s) ${JSON.stringify(tally)}`);
    }
  }
}

console.log(`${mutants.length} reference mutants (${mutants.filter(m => m.kind === 'transition').length} transition, ${mutants.filter(m => m.kind === 'policy').length} hand candidates)`);
console.log('stage 1 worlds');
const p1 = await prepare(stage1);
await mineAll(mutants, p1, 'stage1');
const cands1 = mutants.filter(m => status.get(m.id).status === 'candidate');
console.log(`stage 2 worlds (${cands1.length} stage-1 candidates)`);
const p2 = cands1.length ? await prepare(stage2) : [];
for (const m of cands1) status.get(m.id).status = 'pending';
await mineAll(cands1, p2, 'stage2');
const allPrepared = [...p1, ...p2];
const latent = mutants.filter(m => status.get(m.id).status === 'candidate');

// One defect per behaviour: the same journal digest on every mining world.
const groups = new Map();
for (const m of latent) {
  const sig = status.get(m.id).worlds.map(w => w.digest).join('|');
  if (!groups.has(sig)) groups.set(sig, []);
  groups.get(sig).push(m);
}
console.log(`${latent.length} E0-silent mutants that die later, ${groups.size} distinct behaviours; planning revealing events`);
const manifests = [];
const unrevealed = [];
for (const members of groups.values()) {
  const rep = members[0];
  const id = `ld-${rep.id.replace(/^ref-/, '')}`;
  const item = await armItemOf(rep, dir);
  const results = [];
  for (const p of allPrepared) {
    const r = await mineOnWorld({ mutant: rep, item, prepared: { ...p, refDigest: null, refDigest0: p.refDigest }, keep: true });   // every E0 case graded, no digest short cut
    if (r.e0.failed.length) throw new Error(`${rep.id}: E0 failure on re-run (${p.world.id}): non-deterministic run`);
    const plan = r.affected.length ? planReveal({ world: p.world, mined: r, defectId: id }) : null;
    const { verdicts, idx, rows, ...keep } = r;
    results.push({ ...keep, plan });
  }
  const man = defectManifest({ id, mutant: rep, members: members.map(m => m.id), results, oracleVerdict: oracleVerdicts[rep.id] ?? null });
  if (results.some(r => r.plan?.reveal)) manifests.push(man);
  else unrevealed.push({ id, members: members.map(m => m.id), why: results.filter(r => r.plan).map(r => `${r.meta.world}: ${r.plan.why}`) });
  for (const m of members) status.get(m.id).status = results.some(r => r.plan?.reveal) ? 'latent' : 'latent-unrevealed';
  console.log(`  ${id} (${members.length} mutant${members.length > 1 ? 's' : ''}, ${rep.operator}): ${results.filter(r => r.plan?.reveal).length}/${results.length} worlds reveal in E2/E3, affected ${results.map(r => r.affected.length).join('/')} (${secs()} s)`);
}
removeDir(dir);

const tally = {};
for (const m of mutants) { const s = status.get(m.id).status; tally[s] = (tally[s] ?? 0) + 1; }
const trueEvents = manifests.reduce((s, x) => s + x.worlds.filter(w => w.reveal?.event).length, 0);
const falseEvents = manifests.reduce((s, x) => s + x.worlds.filter(w => w.falseReveal).length, 0);
const index = {
  schema: 'ebed-e8-latent-defects-index/1',
  date: arg('--date', new Date().toISOString().slice(0, 10)),
  evidence: 'development (dev worlds, E-bed dev block 1001-1199); $0, no model calls',
  command: `node beds/ebed/e8/tools/defects-mine.mjs ${process.argv.slice(2).join(' ')}`.trim(),
  base,
  params: { ...PARAMS, stage1: p1.map(p => p.world.id), stage2: p2.map(p => p.world.id),
    e0CasesChecked: { stage1: p1.map(p => p.world.id).length && p1.reduce((s, p) => s + Object.values(p.world.truth.cases).filter(t => PARAMS.e0Epochs.includes(t.epoch)).length, 0),
      stage2: p2.reduce((s, p) => s + Object.values(p.world.truth.cases).filter(t => PARAMS.e0Epochs.includes(t.epoch)).length, 0) } },
  counts: { mutants: mutants.length, transition: mutants.filter(m => m.kind === 'transition').length, hand: mutants.filter(m => m.kind === 'policy').length, ...tally,
    behaviours: groups.size, admitted: manifests.length, unrevealed: unrevealed.length, trueRevealingEvents: trueEvents, falseRevealingEvents: falseEvents },
  defects: manifests.map(x => {
    const first = x.worlds.find(w => w.reveal);
    return { id: x.id, file: `${x.id}.json`, members: x.members, operator: x.mutant.operator, contradicts: x.contradicts,
      worldsRevealing: x.worlds.filter(w => w.reveal).map(w => w.world), firstReveal: { world: first.world, case: first.reveal.case, class: first.reveal.class, at: first.reveal.event?.at ?? first.reveal.at, type: first.reveal.event?.type ?? first.reveal.selfRevealing } };
  }),
  unrevealed,
  mutants: mutants.map(m => {
    const st = status.get(m.id);
    return { id: m.id, operator: m.operator, ...(m.line ? { line: m.line } : {}), status: st.status, ...(st.stage ? { stage: st.stage } : {}),
      ...(st.e0First ? { e0First: { world: st.e0First.world, case: st.e0First.case, epoch: st.e0First.epoch, code: st.e0First.code ?? null, ...(st.e0First.lid ? { lid: st.e0First.lid } : {}) } } : {}),
      ...(st.error ? { error: st.error } : {}),
      ...(['latent', 'latent-unrevealed', 'silent', 'oracle-error'].includes(st.status) ? { affected: st.worlds.map(w => w.affected) } : {}),
      ...(oracleVerdicts[m.id] ? { asOracleMutant: oracleVerdicts[m.id].verdict } : {}) };
  }),
};
console.log(`done in ${secs()} s: ${JSON.stringify(index.counts)}`);
if (write) {
  mkdirSync(out, { recursive: true });
  for (const f of existsSync(out) ? readdirSync(out) : []) if (/^ld-.*\.json$/.test(f)) rmSync(path.join(out, f));
  for (const x of manifests) writeFileSync(path.join(out, `${x.id}.json`), `${JSON.stringify(x, null, 1)}\n`);
  writeFileSync(path.join(out, 'index.json'), `${JSON.stringify(index, null, 1)}\n`);
  console.log(`wrote ${manifests.length} manifests and index.json to ${path.relative(process.cwd(), out)}`);
}
