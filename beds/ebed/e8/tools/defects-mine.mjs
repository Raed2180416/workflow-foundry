// Mine E8 latent defects from reference mutants (E-BED §2.10, §9.5; defects.mjs). $0, one process, sequential.
// Every mutant (tools/mutate.mjs's transition mutants as the arm, plus policy mutants: E-BED §3 E8's hand candidates and
// two edition operators) runs on one dev world per difficulty, hardest first, and stops at the first world with a failing
// E0 case. The difficulties before that world, where E0 was silent, are the mutant's **band** (d5 only, d4-d5, ... or all):
// E8's later-epoch structure differs by difficulty (a second edition from d4, renames and faults at d5), so a defect can
// be latent at d4-d5 and visible at d2-d3. A mutant that fails some later case inside its band goes to stage 2, which
// re-executes the E0-silence check on a second seed at each band difficulty (hardest first; the band shrinks at a
// failure). A defect is latent at the difficulties where both seeds are E0-silent and admitted when a world of its band
// reveals it inside E2/E3. Mutants with the same behaviour (journal digest) on every band world are one defect. Writes
// one manifest per admitted defect and index.json under --out (default ledger/latent-defects/).
//   node beds/ebed/e8/tools/defects-mine.mjs [--stage1 1101:5,1101:4,1101:3,1101:2] [--stage2 1102:5,1102:4,1102:3,1102:2]
//        [--only ref-k12,hc-timer-first] [--limit N] [--out DIR] [--no-write]
// index.json `perWorld` is `<failed E0 cases>/<failed later cases>` per world mined (stage 1, then stage 2); `!` marks a
// runaway stopped by the host (graded up to the stop).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transitionMutants, HAND_CANDIDATES, armItemOf, mineOnWorld, prepareWorld, planReveal, defectManifest, baseDigests, scratchDir, removeDir, PARAMS } from '../defects.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const worldsOf = s => s.split(',').filter(Boolean).map(x => { const [seed, d] = x.split(':').map(Number); return { seed, difficulty: d }; });
const stage1 = worldsOf(arg('--stage1', '1101:5,1101:4,1101:3,1101:2'));
const stage2 = worldsOf(arg('--stage2', '1102:5,1102:4,1102:3,1102:2'));
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
    try { item = await armItemOf(m, dir); } catch (e) { st.status = 'load-error'; st.error = String(e?.message ?? e).slice(0, 120); console.log(`    ${m.id} load-error`); continue; }
    for (const p of prepared.filter(q => !st.band || st.band.includes(q.difficulty))) {
      let r;
      try { r = await mineOnWorld({ mutant: m, item, prepared: p }); } catch (e) {
        st.status = 'run-error'; st.stage = stageName; st.error = `${p.world.id}: ${String(e?.message ?? e).slice(0, 120)}`; break;
      }
      const w = { world: p.world.id, difficulty: p.difficulty, stage: stageName, digest: r.digest, inert: r.inert,
        e0Failed: r.e0.failed.length, affected: r.affected.length, oracleErrors: r.affected.filter(a => a.oracleError).length };
      if (r.aborted) w.stopped = r.stoppedAt;
      st.worlds.push(w);
      if (r.e0.failed.length) { st.e0First ??= { world: p.world.id, stage: stageName, ...r.e0.failed[0] }; break; }
      if (r.aborted) { st.stopped ??= `${p.world.id}: ${r.aborted.slice(0, 80)}; E0 silent up to the stop at ${r.stoppedAt}`; break; }
    }
    // The band: difficulties with an E0-silent, completed run on every seed mined so far.
    const ok = d => st.worlds.filter(w => w.difficulty === d).every(w => !w.e0Failed && !w.stopped) && st.worlds.some(w => w.difficulty === d);
    const ds = [...new Set(st.worlds.map(w => w.difficulty))].sort((x, y) => y - x);
    const band = [];
    for (const d of ds) { if (!ok(d)) break; band.push(d); }
    st.band = band;
    if (st.status !== 'load-error' && st.status !== 'run-error') {
      const inBand = st.worlds.filter(w => band.includes(w.difficulty));
      const errs = inBand.reduce((s2, w) => s2 + w.oracleErrors, 0);
      st.status = errs ? 'oracle-error' : inBand.some(w => w.affected) ? 'candidate'
        : st.e0First ? 'e0-visible' : st.stopped ? 'runaway' : inBand.every(w => w.inert) ? 'inert' : 'silent';
    }
    console.log(`    ${m.id} ${st.status}${band.length ? ` band d${band.join(',')}` : ''}${st.e0First ? ` (E0: ${st.e0First.world.replace('ebed-e8-dev-', '')} ${st.e0First.case} ${st.e0First.code ?? ''})` : ''} e0/affected ${st.worlds.map(w => `${w.e0Failed}/${w.affected}${w.stopped ? '!' : ''}`).join(' ')} (${secs()} s)`);
    if ((n + 1) % 10 === 0 || n + 1 === list.length) {
      const tally = {}; for (const x of list.slice(0, n + 1)) { const s2 = status.get(x.id).status; tally[s2] = (tally[s2] ?? 0) + 1; }
      console.log(`  ${stageName} ${n + 1}/${list.length} (${secs()} s) ${JSON.stringify(tally)}`);
    }
  }
}

console.log(`${mutants.length} reference mutants (${mutants.filter(m => m.kind === 'transition').length} transition, ${mutants.filter(m => m.kind === 'policy').length} policy mutants)`);
console.log('stage 1 worlds');
const p1 = await prepare(stage1);
await mineAll(mutants, p1, 'stage1');
const cands1 = mutants.filter(m => status.get(m.id).status === 'candidate');
const need2 = new Set(cands1.flatMap(m => status.get(m.id).band));
console.log(`stage 2 worlds (${cands1.length} stage-1 candidates; difficulties ${[...need2].sort().join(',')})`);
const p2 = await prepare(stage2.filter(w => need2.has(w.difficulty)));
for (const m of cands1) status.get(m.id).status = 'pending';
await mineAll(cands1, p2, 'stage2');
const allPrepared = [...p1, ...p2];
const latent = mutants.filter(m => status.get(m.id).status === 'candidate');

// One defect per behaviour: the same journal digest on every mining world.
const groups = new Map();
for (const m of latent) {
  const st = status.get(m.id);
  const sig = `${st.band.join(',')}#${st.worlds.filter(w => st.band.includes(w.difficulty)).map(w => w.digest).join('|')}`;
  if (!groups.has(sig)) groups.set(sig, []);
  groups.get(sig).push(m);
}
// A behaviour whose band lies inside another's, with the same journals on its band worlds, is the same defect there
// (for example k10 and k11 at d4-d5): it joins the wider-band defect as a member with its own band.
const digestOn = (m, d) => status.get(m.id).worlds.filter(w => w.difficulty === d).map(w => w.digest).join('|');
const ordered = [...groups.values()].sort((a, b) => status.get(b[0].id).band.length - status.get(a[0].id).band.length);
const memberBand = {};
for (const g of ordered) for (const m of g) memberBand[m.id] = status.get(m.id).band;
for (let i = ordered.length - 1; i > 0; i--) {
  const g = ordered[i], gb = status.get(g[0].id).band;
  const host = ordered.slice(0, i).find(h => h !== g && gb.every(d => status.get(h[0].id).band.includes(d) && digestOn(h[0], d) === digestOn(g[0], d)));
  if (host) { host.push(...g); ordered.splice(i, 1); }
}
groups.clear();
for (const g of ordered) groups.set(g[0].id, g);
console.log(`${latent.length} E0-silent mutants that die later, ${groups.size} distinct behaviours; planning revealing events`);
const manifests = [];
const unrevealed = [];
for (const members of groups.values()) {
  const rep = members[0];
  const id = `ld-${rep.id.replace(/^ref-/, '')}`;
  const item = await armItemOf(rep, dir);
  const results = [];
  const band = status.get(rep.id).band;
  for (const p of allPrepared.filter(q => band.includes(q.difficulty))) {
    const r = await mineOnWorld({ mutant: rep, item, prepared: { ...p, refDigest: null, refDigest0: p.refDigest }, keep: true });   // every E0 case graded, no digest short cut
    if (r.e0.failed.length) throw new Error(`${rep.id}: E0 failure on re-run (${p.world.id}): non-deterministic run`);
    const plan = r.affected.length ? planReveal({ world: p.world, mined: r, defectId: id }) : null;
    const { verdicts, idx, rows, ...keep } = r;
    results.push({ ...keep, plan });
  }
  const e0 = status.get(rep.id).e0First;
  const narrower = Object.fromEntries(members.filter(m => memberBand[m.id].join() !== band.join()).map(m => [m.id, memberBand[m.id]]));
  const man = defectManifest({ id, mutant: rep, members: members.map(m => m.id), membersBand: narrower, results, oracleVerdict: oracleVerdicts[rep.id] ?? null,
    band, outsideBand: e0 ? { world: e0.world, case: e0.case, epoch: e0.epoch, code: e0.code ?? null, ...(e0.lid ? { lid: e0.lid } : {}) } : null });
  if (results.some(r => r.plan?.reveal)) manifests.push(man);
  else unrevealed.push({ id, members: members.map(m => m.id), why: results.filter(r => r.plan).map(r => `${r.meta.world}: ${r.plan.why}`) });
  for (const m of members) status.get(m.id).status = results.some(r => r.plan?.reveal) ? 'latent' : 'latent-unrevealed';
  console.log(`  ${id} (${members.length} mutant${members.length > 1 ? 's' : ''}, ${rep.operator}, band d${band.join(',')}): ${results.filter(r => r.plan?.reveal).length}/${results.length} worlds reveal in E2/E3, affected ${results.map(r => r.affected.length).join('/')} (${secs()} s)`);
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
  counts: { mutants: mutants.length, transition: mutants.filter(m => m.kind === 'transition').length, policy: mutants.filter(m => m.kind === 'policy').length, ...tally,
    behaviours: groups.size, admitted: manifests.length, unrevealed: unrevealed.length, trueRevealingEvents: trueEvents, falseRevealingEvents: falseEvents,
    admittedAllDifficulties: manifests.filter(x => x.band.length === 4).length,
    selfRevealing: manifests.filter(x => x.worlds.every(w => !w.reveal || !w.reveal.event)).length },
  defects: manifests.map(x => {
    const first = x.worlds.find(w => w.reveal);
    return { id: x.id, file: `${x.id}.json`, members: x.members, operator: x.mutant.operator, band: x.band, revealedBy: x.revealedBy, contradicts: x.contradicts,
      worldsRevealing: x.worlds.filter(w => w.reveal).map(w => w.world), firstReveal: { world: first.world, case: first.reveal.case, class: first.reveal.class, at: first.reveal.event?.at ?? first.reveal.at, type: first.reveal.event?.type ?? first.reveal.selfRevealing } };
  }),
  unrevealed,
  mutants: mutants.map(m => {
    const st = status.get(m.id);
    return { id: m.id, operator: m.operator, ...(m.line ? { line: m.line } : {}), status: st.status, ...(st.stage ? { stage: st.stage } : {}),
      ...(st.e0First ? { e0First: { world: st.e0First.world, case: st.e0First.case, epoch: st.e0First.epoch, code: st.e0First.code ?? null, ...(st.e0First.lid ? { lid: st.e0First.lid } : {}) } } : {}),
      ...(st.error ? { error: st.error } : {}), ...(st.stopped ? { stopped: st.stopped } : {}),
      ...(st.worlds.length ? { perWorld: st.worlds.map(w => `${w.e0Failed}/${w.affected}${w.stopped ? '!' : ''}`) } : {}),
      ...(st.band?.length ? { band: st.band } : {}),
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
