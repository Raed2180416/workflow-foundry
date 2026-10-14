// Need router v1 preregistration check ($0: no model call, no `claude`, never reads beds/sealed/ or any result file).
// Validates research/need-router-20261014/prereg/stages.json, the machine-readable half of PREREG-NEED-V1.md, against
//   - the seed ledger (experiments/jit/seeds.mjs seedRefusals, the same rule every runner applies through assertSeedsAllowed),
//   - the model policy (policy/models.json: model ids and base prices),
//   - the spend rules (each stage cap <= the $500 pause, the sum of caps <= the $1,500 session soft cap),
//   - the preregistration text (status, every job id, stage id and arm settings hash is named in it),
// and exports the preregistered task plan (per-seed difficulty, example sets, E2E draw) so label-run reads one rule.
//   node experiments/need-router/prereg-check.mjs [--stages FILE] [--prereg FILE] [--hashes] [--stamp] [--json]
//   --hashes  also generate every planned example and evaluation task of each existing bed ($0) and report taskHash
//             collisions between example and evaluation tasks of one family (L4) and repeated evaluation tasks
//   --stamp   print the engine-stamp record of the working tree (git trees, file shas, Node version); writes nothing
// Exit 0 when no error, 1 otherwise.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadLedger, seedRefusals } from '../jit/seeds.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const STAGES_FILE = path.join(REPO, 'research/need-router-20261014/prereg/stages.json');
export const PREREG_FILE = path.join(REPO, 'research/need-router-20261014/PREREG-NEED-V1.md');
export const POLICY_FILE = path.join(REPO, 'policy/models.json');
export const SCHEMA = 'need-prereg-stages/1';
export const EVAL_TASKS = 12;
export const SPLITS = Object.freeze(['train', 'heldout', 'heldout-conditional', 'forced', 'sealed', 'owner']);
export const ARM_CLASSES = Object.freeze(['no-workflow', 'workflow-guided', 'workflow-built', 'ceiling', 'baseline', 'm1']);
// Seed roles of stages.json `seeds`: the split each lives on and the ledger purpose it is checked under.
export const ROLES = Object.freeze({
  examples: { split: 'dev', purposeKey: 'example' }, probe: { split: 'dev', purposeKey: 'example' },
  trainEval: { split: 'dev', purposeKey: 'train' }, trainReserve: { split: 'dev', purposeKey: 'train' },
  heldoutEval: { split: 'test', purposeKey: 'heldout' }, heldoutReserve: { split: 'test', purposeKey: 'heldout' },
  e2e: { split: 'test', purposeKey: 'heldout' }, drift: { split: 'test', purposeKey: 'heldout' },
});
const EVAL_ROLES = new Set(['trainEval', 'heldoutEval', 'e2e', 'drift']);
const HELDOUT_SPLITS = new Set(['heldout', 'heldout-conditional', 'sealed']);
// Special arm tokens a run may name besides the arms table: the E2E lane runs the decision card's choice.
const SPECIAL_ARMS = new Set(['router-choice']);

/** JSON with object keys sorted at every depth (the hashing form of an arm definition). */
export function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export const sha256 = s => createHash('sha256').update(s).digest('hex');
/** An arm's settings hash: sha256 of its canonical definition without the `settingsSha` field, first 16 hex digits. */
export function armSha(arm) {
  const { settingsSha, ...def } = arm; // eslint-disable-line no-unused-vars
  return sha256(canonicalJson(def)).slice(0, 16);
}
export const span = ({ from, to }) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** Evaluation task i (0..n-1) of a banded job: contiguous equal blocks over the band (12 tasks: 6/4/3 per level for bands
 *  of 2/3/4 levels), so seed-parity halves stay balanced over difficulty for bands of 2 and 3 levels. */
export function evalDifficulty(band, i, n = EVAL_TASKS) {
  if (!Array.isArray(band) || !band.length) throw new Error('evalDifficulty: band must be a non-empty list');
  if (!Number.isInteger(i) || i < 0 || i >= n) throw new Error(`evalDifficulty: index ${i} outside 0..${n - 1}`);
  return band[Math.floor((i * band.length) / n)];
}
/** Example seed s (601-609): the band rotated over the nine seeds, so every example set of 3 covers a band of up to 3 levels. */
export function exampleDifficulty(band, seed, base = 601) {
  if (!Array.isArray(band) || !band.length) throw new Error('exampleDifficulty: band must be a non-empty list');
  return band[(((seed - base) % band.length) + band.length) % band.length];
}
/** need-stage jobs fix the stage kind by position (3 tasks per kind): kinds[i mod 4]. */
const kindAt = (job, i) => (job.stageKinds ? job.stageKinds[i % job.stageKinds.length] : undefined);

/** The planned tasks of one job under one seed role: [{seed, difficulty, stage?}] (evaluation roles index from the range start). */
export function planTasks(stages, jobId, role) {
  const job = stages.jobs.find(j => j.id === jobId);
  if (!job) throw new Error(`planTasks: unknown job ${jobId}`);
  if (!job.band) throw new Error(`planTasks: job ${jobId} has no frozen band (${job.bandStatus ?? 'TBD'})`);
  const r = stages.seeds[role];
  if (!r) throw new Error(`planTasks: unknown seed role ${role}`);
  const seeds = role === 'probe' ? [r.seed] : span(r);
  return seeds.map((seed, i) => {
    const out = { seed, split: ROLES[role].split };
    if (EVAL_ROLES.has(role)) {
      out.difficulty = evalDifficulty(job.band, i, seeds.length);
      const k = kindAt(job, i); if (k) out.stage = k;
    } else {
      out.difficulty = exampleDifficulty(job.band, seed, stages.seeds.examples.from);
      const k = kindAt(job, seed - stages.seeds.examples.from); if (k) out.stage = k;
    }
    return out;
  });
}
/** Example set k (1..3, or a racing lineage k > 3, which reuses set ((k - 1) mod 3) + 1) of a job. */
export function exampleSet(stages, k) {
  const sets = stages.seeds.exampleSets;
  const key = String(((k - 1) % Object.keys(sets).length) + 1);
  return sets[key];
}

/** Seeded 32-bit generator (mulberry32), for the preregistered E2E job draw. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** The E2E lane's job draw: sort the eligible job ids, Fisher-Yates shuffle with the preregistered seed, take k. */
export function e2eDraw(eligible, seed, k = 6) {
  const ids = [...new Set(eligible)].sort();
  const rand = mulberry32(seed);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  return ids.slice(0, Math.min(k, ids.length));
}

/** Every (run, seed list) of the stage plan with the ledger coordinates it is checked under. */
export function expandRuns(stages) {
  const out = [];
  for (const st of stages.stages) for (const [ri, run] of (st.runs ?? []).entries()) for (const jobId of run.job ? [run.job] : run.eligible ?? [null]) {
    const job = jobId ? stages.jobs.find(j => j.id === jobId) : null;
    const where = `${st.id}.runs[${ri}]${jobId ? ` (${jobId})` : run.bed ? ` (${run.bed})` : ''}`;
    if (run.seeds) { // explicit seeds (M1): bed, split and purpose are given on the run
      out.push({ stage: st.id, where, job, run, role: 'explicit', bed: run.bed, split: run.split, purpose: run.purpose, seeds: span(run.seeds) });
      continue;
    }
    for (const role of run.seedRoles ?? []) {
      const r = stages.seeds[role];
      const meta = ROLES[role];
      if (!r || !meta) { out.push({ stage: st.id, where, job, run, role, error: `unknown seed role ${role}` }); continue; }
      out.push({ stage: st.id, where, job, run, role, bed: job?.ledgerBed ?? job?.family ?? null, split: meta.split,
        purpose: stages.seeds.purposes[meta.purposeKey], seeds: role === 'probe' ? [r.seed] : span(r) });
    }
  }
  return out;
}

const sum = xs => xs.reduce((a, b) => a + b, 0);
const round2 = x => Math.round(x * 100) / 100;

/** All structural, ledger, policy, spend and text checks. Returns {errors, warnings, summary}; never throws on content. */
export function checkStages(stages, { ledger = loadLedger(), policy = JSON.parse(readFileSync(POLICY_FILE, 'utf8')), preregText = null, repo = REPO } = {}) {
  const errors = [], warnings = [];
  const err = m => errors.push(m), warn = m => warnings.push(m);
  if (stages?.schema !== SCHEMA) { err(`schema must be ${SCHEMA}`); return { errors, warnings, summary: null }; }
  if (!['draft', 'frozen'].includes(stages.status)) err('status must be draft or frozen');

  // Policy: model ids and base prices come from policy/models.json only.
  const policyModels = new Map((policy.models ?? []).map(m => [m.id, m]));
  if (stages.policy?.policyVersion !== policy.policyVersion) warn(`policy version ${policy.policyVersion} differs from the preregistered ${stages.policy?.policyVersion}: record a deviation if model ids or prices changed`);
  const pause = policy.spend?.perExperimentPauseAboveUsd, softCap = policy.spend?.sessionSoftCapUsd;
  if (stages.policy?.perExperimentPauseAboveUsd !== pause) err(`perExperimentPauseAboveUsd ${stages.policy?.perExperimentPauseAboveUsd} differs from policy ${pause}`);
  if (stages.policy?.sessionSoftCapUsd !== softCap) err(`sessionSoftCapUsd ${stages.policy?.sessionSoftCapUsd} differs from policy ${softCap}`);
  for (const [id, pm] of Object.entries(stages.priceTable?.models ?? {})) {
    const p = policyModels.get(id);
    if (!p) { err(`price table model ${id} is not in the policy`); continue; }
    const t0 = pm.tiers?.[0];
    if (!t0 || t0.input !== p.price?.inputPerMTok || t0.output !== p.price?.outputPerMTok) err(`price table ${id} base tier ${t0?.input}/${t0?.output} differs from policy ${p.price?.inputPerMTok}/${p.price?.outputPerMTok}`);
    for (const t of pm.tiers ?? []) for (const k of ['input', 'output', 'cacheRead', 'cacheWrite5m']) if (!(Number.isFinite(t[k]) && t[k] >= 0)) err(`price table ${id}: tier field ${k} must be a number >= 0`);
  }

  // Arms: settings hash, class, model ids.
  const arms = stages.arms ?? {};
  const modelIdsOf = a => [a.model, a.builderModel, ...(a.models ?? []), ...Object.values(a).filter(v => v && typeof v === 'object' && !Array.isArray(v)).flatMap(modelIdsOf)].filter(Boolean);
  for (const [id, a] of Object.entries(arms)) {
    if (a.id !== id) err(`arm ${id}: id field ${a.id} differs from its key`);
    if (!ARM_CLASSES.includes(a.class)) err(`arm ${id}: class ${a.class} not in ${ARM_CLASSES.join('|')}`);
    const h = armSha(a);
    if (a.settingsSha !== h) err(`arm ${id}: settingsSha ${a.settingsSha} != computed ${h}`);
    for (const m of new Set(modelIdsOf(a))) if (!policyModels.has(m)) err(`arm ${id}: model ${m} is not in policy/models.json`);
  }

  // Clusters and jobs.
  const clusters = stages.clusters ?? {};
  for (const [cid, c] of Object.entries(clusters)) if (!SPLITS.includes(c.split)) err(`cluster ${cid}: split ${c.split} not in ${SPLITS.join('|')}`);
  const famCluster = new Map(), jobIds = new Set();
  for (const j of stages.jobs ?? []) {
    if (jobIds.has(j.id)) err(`job ${j.id} repeated`);
    jobIds.add(j.id);
    const c = clusters[j.cluster];
    if (!c) { err(`job ${j.id}: unknown cluster ${j.cluster}`); continue; }
    if (j.split !== c.split) err(`job ${j.id}: split ${j.split} differs from its cluster ${j.cluster} (${c.split})`);
    if (j.family) {
      if (famCluster.has(j.family) && famCluster.get(j.family) !== j.cluster) err(`family ${j.family} is in two clusters (${famCluster.get(j.family)}, ${j.cluster}): a family stays in one cluster and one split`);
      famCluster.set(j.family, j.cluster);
    }
    if (j.band != null) {
      if (!Array.isArray(j.band) || !j.band.length || !j.band.every((d, i) => Number.isInteger(d) && d >= 1 && d <= 5 && (i === 0 || d > j.band[i - 1]))) err(`job ${j.id}: band must be ascending integers in 1..5`);
      else if (EVAL_TASKS % j.band.length) err(`job ${j.id}: ${EVAL_TASKS} tasks cannot spread evenly over a band of ${j.band.length} levels`);
    } else if (!j.bandStatus) err(`job ${j.id}: band missing and no bandStatus saying who freezes it`);
    if (j.bedStatus === 'exists') {
      if (!j.family || j.family.startsWith('sealed')) err(`job ${j.id}: bedStatus exists needs a non-sealed family id`);
      else if (!existsSync(path.join(repo, 'beds', j.family, 'index.mjs'))) err(`job ${j.id}: beds/${j.family}/index.mjs does not exist`);
    } else warn(`job ${j.id}: bed ${j.family ?? '(none)'} is ${j.bedStatus}; its rows run only once it exists and passes admission`);
    for (const m of [...(j.modes ?? []), ...(j.ceiling ?? [])]) if (!arms[m]) err(`job ${j.id}: unknown arm ${m}`);
    if (j.interactive && (j.modes ?? []).includes('direct-H')) err(`job ${j.id}: direct-H is masked on interactive families`);
    if (j.maxExampleTokens != null && arms['agent-O']) {
      const want = j.maxExampleTokens > arms['agent-O'].largeInputTokens ? arms['agent-O'].budgetUsdLargeInputs : arms['agent-O'].budgetUsd;
      if (j.agentOBudgetUsd !== want) err(`job ${j.id}: agentOBudgetUsd ${j.agentOBudgetUsd} != ${want} (max example input ${j.maxExampleTokens} tokens)`);
    }
    for (const n of ['n1', 'n10']) { const h = j.hypothesis?.[n]; if (!h || !['no-workflow', 'workflow', 'either', 'pending'].includes(h.class)) err(`job ${j.id}: hypothesis.${n}.class missing or not no-workflow|workflow|either|pending`); }
    if (j.stageKinds && !(Array.isArray(j.stageKinds) && j.stageKinds.length && EVAL_TASKS % j.stageKinds.length === 0)) err(`job ${j.id}: stageKinds must divide ${EVAL_TASKS}`);
  }
  // A cluster sits in one split by construction (job.split === cluster.split); TRAIN and held-out never share a family.

  // Seed roles: inside the ledger, on the right split, pairwise disjoint per split.
  const S = stages.seeds ?? {};
  for (const [role, meta] of Object.entries(ROLES)) {
    const r = S[role];
    if (!r) { err(`seeds.${role} missing`); continue; }
    const p = S.purposes?.[meta.purposeKey];
    if (!ledger.purposes[p]) { err(`seeds.${role}: purpose ${p} is not in the ledger`); continue; }
    if (ledger.purposes[p].split !== meta.split) err(`seeds.${role}: purpose ${p} is on ${ledger.purposes[p].split}, role needs ${meta.split}`);
  }
  const roleSeeds = role => (role === 'probe' ? [S.probe?.seed] : S[role] ? span(S[role]) : []);
  for (const a of Object.keys(ROLES)) for (const b of Object.keys(ROLES)) {
    if (a >= b || ROLES[a].split !== ROLES[b].split || [a, b].includes('probe')) continue;
    const B = new Set(roleSeeds(b)); const shared = roleSeeds(a).filter(s => B.has(s));
    if (shared.length) err(`seed roles ${a} and ${b} share ${shared.length} seed(s) (${shared.slice(0, 3).join(', ')})`);
  }
  if (S.probe && !span(S.examples).includes(S.probe.seed)) err('the probe seed must be an example seed');
  const setSeeds = Object.values(S.exampleSets ?? {}).flat();
  if (setSeeds.length !== new Set(setSeeds).size || setSeeds.sort((x, y) => x - y).join() !== span(S.examples).join()) err('exampleSets must partition seeds.examples');
  if (span(S.trainEval).length !== EVAL_TASKS || span(S.heldoutEval).length !== EVAL_TASKS) err(`trainEval and heldoutEval must hold ${EVAL_TASKS} seeds`);

  // Stages: caps, order, runs, ledger refusals.
  const order = new Map((stages.stages ?? []).map((s, i) => [s.id, i]));
  const freezeAt = order.get('Freeze');
  if (freezeAt == null) err('a stage with id Freeze is required');
  const stageIds = new Set();
  for (const st of stages.stages ?? []) {
    if (stageIds.has(st.id)) err(`stage ${st.id} repeated`);
    stageIds.add(st.id);
    if (!(st.capUsd >= st.estUsd)) err(`stage ${st.id}: cap ${st.capUsd} below estimate ${st.estUsd}`);
    if (!(st.capUsd <= pause)) err(`stage ${st.id}: cap $${st.capUsd} is over the $${pause} pause (K6)`);
    for (const [ri, run] of (st.runs ?? []).entries()) for (const jobId of run.job ? [run.job] : run.eligible ?? [null]) {
      const where = `${st.id}.runs[${ri}]${jobId ? ` (${jobId})` : ''}`;
      const job = jobId ? stages.jobs.find(j => j.id === jobId) : null;
      if (jobId && !job) { err(`${where}: unknown job ${jobId}`); continue; }
      if (!jobId && !run.bed) { err(`${where}: a run names a job, an eligible list or a bed`); continue; }
      if (run.eligible && (run.seedRoles ?? []).includes('trainEval')) err(`${where}: the E2E lane runs on fresh held-out seeds only`);
      for (const a of run.arms ?? []) {
        if (!arms[a] && !SPECIAL_ARMS.has(a)) err(`${where}: unknown arm ${a}`);
        else if (job && arms[a] && arms[a].class !== 'baseline' && !(job.modes ?? []).includes(a) && !(job.ceiling ?? []).includes(a)) err(`${where}: arm ${a} is not a mode or ceiling arm of job ${job.id}`);
      }
      if (job && (run.seedRoles ?? []).some(r => EVAL_ROLES.has(r))) {
        const heldout = HELDOUT_SPLITS.has(job.split);
        for (const r of run.seedRoles) {
          if (!EVAL_ROLES.has(r)) continue;
          if (heldout && r === 'trainEval') err(`${where}: held-out job ${job.id} on TRAIN evaluation seeds`);
          if (job.split === 'train' && r !== 'trainEval') err(`${where}: TRAIN job ${job.id} on ${r} seeds`);
          if (heldout && freezeAt != null && order.get(st.id) <= freezeAt && r === 'heldoutEval') err(`${where}: held-out evaluation of ${job.id} before Freeze`);
        }
      }
    }
  }
  const counted = (stages.stages ?? []).filter(s => s.inTotals);
  const core = counted.filter(s => s.core);
  const tot = { estUsd: round2(sum(counted.map(s => s.estUsd))), capUsd: round2(sum(counted.map(s => s.capUsd))), coreEstUsd: round2(sum(core.map(s => s.estUsd))), coreCapUsd: round2(sum(core.map(s => s.capUsd))) };
  for (const k of Object.keys(tot)) if (stages.totals?.[k] !== tot[k]) err(`totals.${k} ${stages.totals?.[k]} != the stage sum ${tot[k]}`);
  if (!(tot.capUsd <= softCap)) err(`sum of stage caps $${tot.capUsd} is over the $${softCap} session soft cap`);

  let seedChecks = 0;
  for (const x of expandRuns(stages)) {
    if (x.error) { err(`${x.where}: ${x.error}`); continue; }
    if (x.job && x.job.split === 'sealed') continue; // sealed seeds are chosen by the NL3 session (checked then)
    if (!x.bed) { err(`${x.where}: no ledger bed for role ${x.role}`); continue; }
    for (const seed of x.seeds) {
      seedChecks += 1;
      const why = seedRefusals(ledger, { bed: x.bed, split: x.split, seed, purpose: x.purpose });
      if (why.length) { err(`${x.where} ${x.role} s${seed}: SEED_REFUSED (${why.join('; ')})`); break; }
    }
  }

  // The preregistration text names every job, stage and arm hash, and carries the same status.
  if (preregText != null) {
    const want = stages.status === 'frozen' ? /Status:\s*\*\*FROZEN/ : /Status:\s*\*\*DRAFT/;
    if (!want.test(preregText)) err(`PREREG text status does not say ${stages.status.toUpperCase()}`);
    for (const j of stages.jobs ?? []) if (!preregText.includes(`\`${j.id}\``)) err(`PREREG text does not name job \`${j.id}\``);
    for (const s of stages.stages ?? []) if (!preregText.includes(s.id)) err(`PREREG text does not name stage ${s.id}`);
    for (const [id, a] of Object.entries(arms)) if (!preregText.includes(a.settingsSha)) err(`PREREG text does not carry arm ${id}'s settings hash ${a.settingsSha}`);
  }
  const summary = { status: stages.status, jobs: jobIds.size, arms: Object.keys(arms).length, stages: stageIds.size, seedChecks, totals: tot,
    clusters: Object.fromEntries(SPLITS.map(s => [s, Object.entries(clusters).filter(([, c]) => c.split === s).map(([k]) => k)])) };
  return { errors, warnings, summary };
}

/** $0 L4 pre-check: generate every planned example and evaluation task of each existing, non-sealed bed and look for
 *  taskHash collisions (example vs evaluation within a family; repeated evaluation tasks within a job). */
export async function hashCollisions(stages, { jobs = null } = {}) {
  const { loadFamily } = await import(pathToFileURL(path.join(REPO, 'experiments/lib/beds.mjs')).href);
  const { canonical, sha256: hash } = await import(pathToFileURL(path.join(REPO, 'beds/lib/canonical.mjs')).href);
  const byFamily = new Map(), out = { tasks: 0, exampleEval: [], evalRepeats: [] };
  for (const j of stages.jobs) {
    if (jobs && !jobs.includes(j.id)) continue;
    if (j.bedStatus !== 'exists' || !j.band || !j.family || j.family.startsWith('sealed')) continue;
    const fam = await loadFamily(j.family);
    const roles = ['examples', j.split === 'train' ? 'trainEval' : 'heldoutEval', ...(HELDOUT_SPLITS.has(j.split) && j.split !== 'sealed' ? ['e2e'] : [])];
    const rec = byFamily.get(j.family) ?? { example: new Map(), eval: new Map() };
    for (const role of roles) for (const t of planTasks(stages, j.id, role)) {
      const args = { seed: t.seed, split: t.split, difficulty: t.difficulty, ...(t.stage ? { stage: t.stage } : {}) };
      const h = hash(canonical(fam.generate(args)));
      out.tasks += 1;
      const key = `${j.id}:${role}:s${t.seed}:d${t.difficulty}`;
      if (role === 'examples') rec.example.set(h, key);
      else { if (rec.eval.has(h) && rec.eval.get(h).startsWith(`${j.id}:`)) out.evalRepeats.push([rec.eval.get(h), key]); rec.eval.set(h, key); }
    }
    byFamily.set(j.family, rec);
  }
  for (const rec of byFamily.values()) for (const [h, key] of rec.eval) if (rec.example.has(h)) out.exampleEval.push([rec.example.get(h), key]);
  return out;
}

/** The engine-stamp record of the working tree (ROADMAP §6 rule 13): read-only git and file hashes. */
export function stamp(stages, { repo = REPO } = {}) {
  const git = args => { try { return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
  const fileSha = rel => (existsSync(path.join(repo, rel)) ? sha256(readFileSync(path.join(repo, rel))) : null);
  const trees = ['experiments/need-router', 'experiments/lib', 'experiments/c0', 'experiments/jit', 'src', 'beds/wbed/references'];
  const families = [...new Set(stages.jobs.filter(j => j.bedStatus === 'exists' && j.family && !j.family.startsWith('sealed')).map(j => j.family))].sort();
  return {
    commit: git(['rev-parse', 'HEAD']), rootTree: git(['rev-parse', 'HEAD^{tree}']),
    dirty: (git(['status', '--porcelain', '--', ...trees, 'beds', 'policy', 'research/need-router-20261014']) ?? '').split('\n').filter(Boolean).length,
    trees: Object.fromEntries(trees.map(t => [t, git(['rev-parse', `HEAD:${t}`])])),
    beds: Object.fromEntries(families.map(f => [f, git(['rev-parse', `HEAD:beds/${f}`])])),
    files: Object.fromEntries(['policy/models.json', 'research/need-router-20261014/prereg/stages.json', 'research/need-router-20261014/PREREG-NEED-V1.md',
      'beds/wbed/references/r1-reference.mjs', 'beds/wbed/references/r3-reference.mjs'].map(f => [f, fileSha(f)])),
    node: process.version,
    note: 'claude CLI version and the static@v3 arm parser state are recorded by the coordinator at launch (this script starts no binary)',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const stagesFile = path.resolve(arg('--stages', STAGES_FILE));
  const preregFile = path.resolve(arg('--prereg', PREREG_FILE));
  const stages = JSON.parse(readFileSync(stagesFile, 'utf8'));
  const res = checkStages(stages, { preregText: existsSync(preregFile) ? readFileSync(preregFile, 'utf8') : null });
  if (process.argv.includes('--hashes')) res.hashes = await hashCollisions(stages);
  if (process.argv.includes('--stamp')) res.stamp = stamp(stages);
  if (process.argv.includes('--json')) console.log(JSON.stringify(res, null, 1));
  else {
    for (const e of res.errors) console.log(`ERROR ${e}`);
    for (const w of res.warnings) console.log(`warn  ${w}`);
    console.log(JSON.stringify(res.summary));
    if (res.hashes) console.log(`hashes: ${res.hashes.tasks} tasks; example/eval collisions ${res.hashes.exampleEval.length}; repeated eval tasks ${res.hashes.evalRepeats.length}`, JSON.stringify({ exampleEval: res.hashes.exampleEval.slice(0, 10), evalRepeats: res.hashes.evalRepeats.slice(0, 10) }));
    if (res.stamp) console.log(JSON.stringify(res.stamp, null, 1));
    console.log(res.errors.length ? `FAIL: ${res.errors.length} error(s)` : 'OK');
  }
  process.exit(res.errors.length ? 1 : 0);
}
