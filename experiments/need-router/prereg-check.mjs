// Need router v1 preregistration check ($0: no model call, no `claude`, never reads beds/sealed/ or any result file).
// Validates research/need-router-20261014/prereg/stages.json, the machine-readable half of PREREG-NEED-V1.md, against
//   - the seed ledger (experiments/jit/seeds.mjs seedRefusals, the same rule every runner applies through assertSeedsAllowed),
//   - the model policy (policy/models.json: model ids and base prices),
//   - the spend rules (each stage cap <= the $500 pause, M1's tag shares within its cap, the sum of caps plus every
//     recurring stage's cumulative cap <= the $1,500 session soft cap; a stage outside the totals is recurring or names
//     an external budget whose plan file names it),
//   - the recorded runs (`observed`: keyed by run tags, complete records carry calls, dollars, meter and runner sha, none
//     in flight at freeze, each named in PREREG §0.1, an overrun of its cap share named in §13),
//   - the analysis' imports of the preregistered rules (`analysis.requiredRules`: a warning until the §4.4 A-Freeze row
//     is filled, an error after),
//   - the seed and freeze rules (no test-split seed of any role before Freeze; TRAIN jobs never on test seeds; held-out,
//     forced and sealed jobs never on TRAIN evaluation seeds; held-out probe rows only in an envelope stage that
//     commits its decisions before any matrix stage that needs them),
//   - the preregistration text (status, every job id, every stage id as a whole token, every arm settings hash; when
//     frozen, no TBD-M0 and no "TBD at ... launch" left in §4.4 or §11; "dev-observed" stated when a job is),
// and exports the preregistered task plan (per-seed difficulty, example sets, probe task, E2E draw) so label-run reads
// one rule, and the engine stamps (label engine per paid stage, analysis at Freeze) with their comparison.
//   node experiments/need-router/prereg-check.mjs [--stages FILE] [--prereg FILE] [--hashes] [--stamp [--stage ID]] [--json]
//   --hashes  also generate every planned example, probe and evaluation task of each existing bed ($0), each seed checked
//             against the ledger first, and report taskHash collisions between example and evaluation tasks of one
//             family (L4) and repeated evaluation tasks. Held-out families are generated and hashed only inside a child
//             process that prints counts and task ids, never task content or hashes.
//   --stamp   print the engine-stamp records of the working tree (label engine for --stage, analysis, documents); writes nothing
// Exit 0 when no error, 1 otherwise.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadLedger, seedRefusals } from '../jit/seeds.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const THIS_FILE = fileURLToPath(import.meta.url);
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
/** Roles on the test split: none may run before Freeze, for any job; a TRAIN job never runs on them. */
export const TEST_ROLES = Object.freeze(new Set(Object.keys(ROLES).filter(r => ROLES[r].split === 'test')));
/** TRAIN evaluation roles: a held-out, forced or sealed job never runs on them. */
const DEV_EVAL_ROLES = new Set(['trainEval', 'trainReserve']);
/** Splits held out from tuning for seed purposes (forced jobs included: runbook and e8 never touch TRAIN seeds). */
export const HELDOUT_SPLITS = Object.freeze(new Set(['heldout', 'heldout-conditional', 'forced', 'sealed']));
/** Splits that the E2E lane and the --hashes e2e check cover. */
const E2E_SPLITS = new Set(['heldout', 'heldout-conditional']);
/** Roles whose rows join the held-out matrix: decisions for their jobs must be committed first (L6). */
const ENVELOPE_ROLES = new Set(['heldoutEval', 'e2e']);
const HYPOTHESIS_CLASSES = ['no-workflow', 'workflow', 'either', 'pending'];
/** Status of a recorded run (`stages[].observed[tag]`): a run still in flight blocks the freeze. */
const OBSERVED_STATUS = ['complete', 'in-flight'];
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
/** The probe task (NR-probe and judge-H) is seed 601 at the band's median level (the upper middle of an even band), so
 *  the probe never reads only the band's easiest level (PREREG §3.3). */
export function probeDifficulty(band) {
  if (!Array.isArray(band) || !band.length) throw new Error('probeDifficulty: band must be a non-empty list');
  return band[Math.floor(band.length / 2)];
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
    } else if (role === 'probe') {
      out.difficulty = probeDifficulty(job.band);
      const k = kindAt(job, seed - stages.seeds.examples.from); if (k) out.stage = k;
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
/** Whether the text names id as a whole token: "NL2" inside "NL2b" or "M1" inside "M1e" does not count. */
export function namesToken(text, id) {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_-])${esc}($|[^A-Za-z0-9_-])`, 'm').test(text);
}
/** The names a module's source imports from a sibling module `base` (named imports, `x as y` keeps x; a namespace import
 *  counts each `ns.name` it reads). Static text only: the module is not loaded. */
export function importedNames(src, base) {
  const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), out = new Set();
  for (const m of src.matchAll(new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*['"](?:\\.{1,2}/)+(?:[\\w.-]+/)*${esc}['"]`, 'g'))) {
    for (const part of m[1].split(',')) { const name = part.trim().split(/\s+as\s+/)[0].trim(); if (name) out.add(name); }
  }
  for (const m of src.matchAll(new RegExp(`import\\s*\\*\\s*as\\s+(\\w+)\\s*from\\s*['"](?:\\.{1,2}/)+(?:[\\w.-]+/)*${esc}['"]`, 'g'))) {
    for (const u of src.matchAll(new RegExp(`\\b${m[1]}\\.(\\w+)`, 'g'))) out.add(u[1]);
  }
  return out;
}
/** The text of a Markdown section from its heading to the next heading of the same or a higher level (null if absent). */
export function sectionOf(text, heading) {
  const m = heading.exec(text);
  if (!m) return null;
  const level = (/^#+/.exec(m[0]) ?? ['##'])[0].length, rest = text.slice(m.index + m[0].length);
  const next = new RegExp(`^#{1,${level}} `, 'm').exec(rest);
  return m[0] + (next ? rest.slice(0, next.index) : rest);
}

/** All structural, ledger, policy, spend and text checks. Returns {errors, warnings, summary}; never throws on content. */
export function checkStages(stages, { ledger = loadLedger(), policy = JSON.parse(readFileSync(POLICY_FILE, 'utf8')), preregText = null, repo = REPO, sources = null } = {}) {
  const errors = [], warnings = [];
  const err = m => errors.push(m), warn = m => warnings.push(m);
  if (stages?.schema !== SCHEMA) { err(`schema must be ${SCHEMA}`); return { errors, warnings, summary: null }; }
  if (!['draft', 'frozen'].includes(stages.status)) err('status must be draft or frozen');

  // Policy: model ids and base prices come from policy/models.json only.
  const policyModels = new Map((policy.models ?? []).map(m => [m.id, m]));
  // Once frozen, a policy version other than the preregistered one (the version in force for NL0 and later stages) is an
  // error: model ids or prices may have drifted between paid stages. Before the freeze it is a warning.
  if (stages.policy?.policyVersion !== policy.policyVersion) (stages.status === 'frozen' ? err : warn)(`policy version ${policy.policyVersion} differs from the preregistered ${stages.policy?.policyVersion}: ${stages.status === 'frozen' ? 'a paid stage would run under another policy than the frozen one (record a §13 deviation and re-pin stages.json policy.policyVersion)' : 'record a deviation if model ids or prices changed, and pin the version in force for NL0 before freezing'}`);
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
    for (const n of ['n1', 'n10']) { const h = j.hypothesis?.[n]; if (!h || !HYPOTHESIS_CLASSES.includes(h.class)) err(`job ${j.id}: hypothesis.${n}.class missing or not ${HYPOTHESIS_CLASSES.join('|')}`); }
    // A hypothesis revised after a dev observation keeps the original row and logs what informed the revision.
    for (const [ri, rv] of (j.hypothesis?.revisions ?? []).entries()) {
      if (!rv.date || !rv.informedBy) err(`job ${j.id}: hypothesis.revisions[${ri}] needs a date and informedBy`);
      for (const n of ['n1', 'n10']) if (rv[n] && !HYPOTHESIS_CLASSES.includes(rv[n].class)) err(`job ${j.id}: hypothesis.revisions[${ri}].${n}.class not ${HYPOTHESIS_CLASSES.join('|')}`);
    }
    if (j.devObserved != null && !(Array.isArray(j.devObserved) && j.devObserved.length)) err(`job ${j.id}: devObserved must list what observed it`);
    if (j.stageKinds && !(Array.isArray(j.stageKinds) && j.stageKinds.length && EVAL_TASKS % j.stageKinds.length === 0)) err(`job ${j.id}: stageKinds must divide ${EVAL_TASKS}`);
  }
  // A near or dev-observed held-out job cannot carry a claim alone: a drop sensitivity for C7a and C7b is mandatory.
  const mandatory = stages.analysis?.mandatorySensitivities ?? [];
  for (const j of stages.jobs ?? []) {
    if (!HELDOUT_SPLITS.has(j.split) || !(j.near || j.devObserved || clusters[j.cluster]?.near || clusters[j.cluster]?.devObserved)) continue;
    const ok = mandatory.some(m => (m.drop ?? []).includes(j.id) && ['C7a', 'C7b'].every(c => (m.appliesTo ?? []).includes(c)));
    if (!ok) err(`job ${j.id} is ${j.devObserved ? 'dev-observed' : 'near'}: analysis.mandatorySensitivities must drop it for both C7a and C7b`);
  }
  // A held-out family a Jev study read with its outcomes (J-NEED-2 read r3p's 24 M1 tasks and their one-call outcomes, part
  // of r3p's held-out direct-H label) never informs a router design choice: the Freeze decision on Jev features reads that
  // study recomputed without the family (analysis.jevFeatureDecision.excludeFamilies).
  const jf = stages.analysis?.jevFeatureDecision;
  for (const j of stages.jobs ?? []) {
    if (!HELDOUT_SPLITS.has(j.split) || !(j.devObserved ?? []).some(x => /^J-NEED-2\b/.test(x))) continue;
    if (!jf) err(`job ${j.id} was read by J-NEED-2 with its outcomes: analysis.jevFeatureDecision must say how the Freeze decision on Jev features excludes it`);
    else if (!(jf.excludeFamilies ?? []).includes(j.family)) err(`analysis.jevFeatureDecision.excludeFamilies must name ${j.family} (held-out job ${j.id}, read by J-NEED-2 with its outcomes)`);
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

  // Stages: caps, order, runs, ledger refusals, recorded runs.
  const readText = rel => (sources && rel in sources ? sources[rel] : rel && existsSync(path.join(repo, rel)) ? readFileSync(path.join(repo, rel), 'utf8') : null);
  const observedOverruns = [];
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
      // Seed and freeze rules, for every role (not only the evaluation roles) and every split.
      const before = freezeAt != null && order.get(st.id) <= freezeAt;
      if (run.seeds && run.split === 'test' && before) err(`${where}: test-split seeds before Freeze`);
      for (const r of run.seedRoles ?? []) {
        if (!ROLES[r]) continue; // reported by expandRuns
        const test = TEST_ROLES.has(r);
        if (test && before) err(`${where}: ${r} seeds (test split) before Freeze${job ? ` for ${job.id}` : ''}`);
        if (job?.split === 'train' && test) err(`${where}: TRAIN job ${job.id} on ${r} seeds`);
        if (job && HELDOUT_SPLITS.has(job.split) && DEV_EVAL_ROLES.has(r)) err(`${where}: held-out job ${job.id} on TRAIN evaluation seeds (${r})`);
        if (job && r === 'e2e' && !E2E_SPLITS.has(job.split)) err(`${where}: the E2E lane runs held-out non-forced jobs only (${job.id} is ${job.split})`);
      }
    }
    // M1 (and any stage with tagged runs): one approved cap, shared by tag.
    const tags = [...new Set((st.runs ?? []).map(r => r.tag).filter(Boolean))];
    if (tags.length || st.capShares) {
      const shares = st.capShares ?? {};
      for (const t of tags) if (!(Number.isFinite(shares[t]) && shares[t] > 0)) err(`stage ${st.id}: run tag ${t} has no cap share (capShares)`);
      for (const t of Object.keys(shares)) if (!tags.includes(t)) err(`stage ${st.id}: cap share ${t} names no run tag`);
      const tot = round2(sum(Object.values(shares)));
      if (tot > st.capUsd + 1e-9) err(`stage ${st.id}: cap shares $${tot} exceed the stage cap $${st.capUsd}`);
    }
    if (st.recurring && !(Number.isInteger(st.recurring.maxRuns) && st.recurring.maxRuns >= 1 && round2(st.recurring.maxRuns * st.capUsd) === st.recurring.cumulativeCapUsd)) err(`stage ${st.id}: recurring needs an integer maxRuns >= 1 and cumulativeCapUsd = maxRuns x capUsd`);
    // Outside the totals only with a recurring limit (its cumulative cap joins the soft-cap check) or a budget held by
    // another plan file that names the stage (M1-R: MEMORY-ROUTING-RECURSION §5, whose totals add this program's).
    if (!st.inTotals && !st.recurring && st.capUsd > 0) {
      const eb = st.externalBudget;
      if (!eb) err(`stage ${st.id} is outside the totals with no recurring run limit and cumulative cap, and no externalBudget: its spend would escape every soft-cap check`);
      else {
        const text = readText(eb.plan);
        if (text == null) err(`stage ${st.id}: externalBudget plan ${eb.plan} does not exist`);
        else if (!namesToken(text, st.id)) err(`stage ${st.id}: externalBudget plan ${eb.plan} does not name the stage`);
        if (eb.capUsd !== st.capUsd) err(`stage ${st.id}: externalBudget capUsd ${eb.capUsd} differs from the stage cap ${st.capUsd}`);
      }
    }
    // Recorded runs (observed): keyed by a run tag of the stage, complete records carry their figures, and a run in
    // flight blocks the freeze (its results go into PREREG §0.1 first).
    for (const [k, o] of Object.entries(st.observed ?? {})) {
      const at = `stage ${st.id}: observed.${k}`;
      if (!tags.includes(k)) err(`${at} names no run tag of the stage`);
      if (!OBSERVED_STATUS.includes(o?.status)) { err(`${at}: status must be ${OBSERVED_STATUS.join(' or ')}`); continue; }
      if (stages.status === 'frozen' && o.status !== 'complete') err(`frozen, but ${at} is ${o.status}: record its results in PREREG §0.1 first`);
      if (o.status !== 'complete') continue;
      for (const f of ['calls', 'reportedUsd', 'meterUsd']) if (!Number.isFinite(o[f])) err(`${at}: a complete record needs ${f}`);
      if (Number.isFinite(o.meterUsd) && Number.isFinite(o.reportedUsd) && o.meterUsd + 1e-9 < o.reportedUsd) err(`${at}: meterUsd ${o.meterUsd} below reportedUsd ${o.reportedUsd} (the meter charges max(reported, re-priced))`);
      if (!Object.entries(o).some(([f, v]) => /Sha256$/.test(f) && /^[0-9a-f]{64}$/.test(v))) err(`${at}: a complete record needs its runner's sha256`);
      const share = st.capShares?.[k] ?? st.capUsd, metered = Math.max(o.meterUsd ?? 0, o.meterWithSetAsideUsd ?? 0);
      if (metered > share + 1e-9) observedOverruns.push({ stage: st.id, tag: k, metered, share });
    }
  }

  // Decisions envelopes (L6): held-out probe and judge rows run in an envelope stage that commits every held-out decision
  // card; a matrix stage (heldoutEval or e2e rows of held-out or forced jobs) names the envelopes it needs, which precede it.
  const stageList = stages.stages ?? [];
  const envelopes = new Map(stageList.filter(s => s.commitsEnvelope).map(s => [s.id, s]));
  const jobsOfRun = run => (run.job ? [run.job] : run.eligible ?? []);
  const isHeldoutJob = id => { const j = (stages.jobs ?? []).find(x => x.id === id); return j && HELDOUT_SPLITS.has(j.split) && j.split !== 'sealed'; };
  const envelopeFiles = new Set();
  for (const st of stageList) {
    if (st.commitsEnvelope) {
      if (!Array.isArray(st.decides) || !st.decides.length) err(`stage ${st.id}: an envelope stage lists the jobs whose decisions it commits (decides)`);
      if (freezeAt != null && order.get(st.id) <= freezeAt) err(`stage ${st.id}: held-out decisions are committed after Freeze`);
      for (const [ri, run] of (st.runs ?? []).entries()) if ((run.seedRoles ?? []).some(r => r !== 'probe')) err(`${st.id}.runs[${ri}]: an envelope stage runs probe-task rows only (no evaluation seeds)`);
      // The committed file the launch check (envelopeLaunchCheck) reads: one file per envelope, never shared or rewritten.
      if (typeof st.envelopeFile !== 'string' || !/^research\/need-router-20261014\/envelopes\/[\w.-]+\.json$/.test(st.envelopeFile)) err(`stage ${st.id}: an envelope stage names its committed decisions file (envelopeFile: research/need-router-20261014/envelopes/<name>.json)`);
      else if (envelopeFiles.has(st.envelopeFile)) err(`stage ${st.id}: envelopeFile ${st.envelopeFile} is used by another envelope stage`);
      else envelopeFiles.add(st.envelopeFile);
      continue;
    }
    const matrixJobs = new Set(), probeJobs = new Set();
    for (const run of st.runs ?? []) {
      const roles = run.seedRoles ?? [];
      for (const id of jobsOfRun(run)) {
        if (!isHeldoutJob(id)) continue;
        if (roles.some(r => ENVELOPE_ROLES.has(r))) matrixJobs.add(id);
        if (roles.includes('probe')) probeJobs.add(id);
      }
    }
    for (const id of probeJobs) err(`stage ${st.id}: probe or judge rows of held-out job ${id} outside an envelope stage (they must be committed before any matrix row)`);
    // A conditional envelope (conditionalEnvelopes: { <envelope stage>: [jobs] }) is required at launch only when one of its
    // jobs is launched or drawn (NL2bp for E2E: only when gameqa is drawn). Its jobs must be ones that envelope decides.
    const cond = st.conditionalEnvelopes ?? {};
    for (const [r, list] of Object.entries(cond)) {
      if (!(st.requiresEnvelope ?? []).includes(r)) err(`stage ${st.id}: conditionalEnvelopes names ${r}, which requiresEnvelope does not list`);
      if (!Array.isArray(list) || !list.length) { err(`stage ${st.id}: conditionalEnvelopes.${r} must list the jobs that require it`); continue; }
      const e = envelopes.get(r);
      for (const j of list) if (e && !(e.decides ?? []).includes(j)) err(`stage ${st.id}: conditionalEnvelopes.${r} names ${j}, which ${r} does not decide`);
    }
    if (!matrixJobs.size) continue;
    const req = st.requiresEnvelope ?? [], covered = new Set();
    for (const r of req) {
      const e = envelopes.get(r);
      if (!e) { err(`stage ${st.id}: requiresEnvelope ${r} is not an envelope stage`); continue; }
      if (order.get(r) >= order.get(st.id)) err(`stage ${st.id}: its envelope ${r} must come before it`);
      for (const id of cond[r] ?? e.decides ?? []) covered.add(id);
    }
    for (const id of matrixJobs) if (!covered.has(id)) err(`stage ${st.id}: held-out job ${id} joins the matrix with no committed decisions envelope (requiresEnvelope)`);
  }

  // Totals. capUsd sums the preregistered caps. committedUsd counts each stage at max(its cap, the spend its recorded runs
  // show on the §12 meter, set-aside attempts included): an overrun (M1 at $62.92 against its $15 cap) is spend, not a
  // cap. The soft-cap check adds the recurring stages' cumulative caps and the stages held by another plan's budget
  // (externalBudget, M1-R) at the same max: the session soft cap is one envelope across plans.
  const observedUsd = s => sum(Object.values(s.observed ?? {}).map(o => Math.max(o?.meterUsd ?? 0, o?.meterWithSetAsideUsd ?? 0)));
  const committedOf = s => Math.max(s.recurring ? s.recurring.cumulativeCapUsd ?? 0 : s.capUsd ?? 0, observedUsd(s));
  const counted = stageList.filter(s => s.inTotals);
  const core = counted.filter(s => s.core);
  const recurringCap = round2(sum(stageList.filter(s => s.recurring).map(committedOf)));
  const external = stageList.filter(s => !s.inTotals && !s.recurring && s.externalBudget);
  const tot = { estUsd: round2(sum(counted.map(s => s.estUsd))), capUsd: round2(sum(counted.map(s => s.capUsd))), coreEstUsd: round2(sum(core.map(s => s.estUsd))), coreCapUsd: round2(sum(core.map(s => s.capUsd))) };
  tot.committedUsd = round2(sum(counted.map(committedOf)));
  tot.recurringCapUsd = recurringCap;
  tot.externalCommittedUsd = round2(sum(external.map(committedOf)));
  tot.softCapCheckUsd = round2(tot.committedUsd + recurringCap + tot.externalCommittedUsd);
  for (const k of Object.keys(tot)) if (stages.totals?.[k] !== tot[k]) err(`totals.${k} ${stages.totals?.[k]} != the stage sum ${tot[k]}`);
  if (!(tot.softCapCheckUsd <= softCap)) err(`committed spend $${tot.committedUsd} (each stage at max(cap, recorded meter)) plus recurring caps $${recurringCap} plus externally budgeted stages $${tot.externalCommittedUsd} is over the $${softCap} session soft cap`);
  // Owner tasks (seedsFrom: owner tasks) carry a per-task estimate and bound, so K7 can be read per owner task, and their
  // replicates and lineages are stated (no default K).
  for (const st of stageList) for (const [ri, run] of (st.runs ?? []).entries()) {
    if (!run.seedsFrom) continue;
    const where = `${st.id}.runs[${ri}]`, job = (stages.jobs ?? []).find(j => j.id === run.job);
    if (!Number.isInteger(run.replicates) || !Number.isInteger(run.lineages)) err(`${where}: a run on ${run.seedsFrom} states its replicates and lineages (integers)`);
    if (!(job?.estPerTaskUsd > 0) || !(job?.boundPerTaskUsd >= job?.estPerTaskUsd) || !Number.isInteger(job?.maxTasks)) { err(`${where}: job ${run.job} needs estPerTaskUsd > 0, boundPerTaskUsd >= it and an integer maxTasks (K7 reads them)`); continue; }
    if (st.estUsd + 1e-9 < job.maxTasks * job.estPerTaskUsd) err(`${where}: stage ${st.id} estimate $${st.estUsd} is below ${job.maxTasks} owner tasks at $${job.estPerTaskUsd}`);
  }

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

  // The preregistration text names every job, stage (as a whole token) and arm hash, and carries the same status.
  if (preregText != null) {
    const want = stages.status === 'frozen' ? /Status:\s*\*\*FROZEN/ : /Status:\s*\*\*DRAFT/;
    if (!want.test(preregText)) err(`PREREG text status does not say ${String(stages.status).toUpperCase()}`);
    for (const j of stages.jobs ?? []) if (!preregText.includes(`\`${j.id}\``)) err(`PREREG text does not name job \`${j.id}\``);
    for (const s of stageList) if (!namesToken(preregText, s.id)) err(`PREREG text does not name stage ${s.id} (as a whole token)`);
    for (const [id, a] of Object.entries(arms)) if (!preregText.includes(a.settingsSha)) err(`PREREG text does not carry arm ${id}'s settings hash ${a.settingsSha}`);
    if ((stages.jobs ?? []).some(j => j.devObserved) && !/dev-observed/.test(preregText)) err('PREREG text does not flag the dev-observed job(s)');
    // Freezing requires the null-simulation numbers (§11) and the launch stamp (§4.4): no placeholder may survive it.
    if (stages.status === 'frozen') {
      for (const [name, head] of [['§4.4', /^### 4\.4\b/m], ['§11', /^## 11\./m]]) {
        const sec = sectionOf(preregText, head);
        if (sec == null) { err(`PREREG text has no ${name} section`); continue; }
        if (/TBD-M0/.test(sec)) err(`frozen, but PREREG ${name} still carries TBD-M0`);
        const m = sec.match(/TBD at [^|\n]*?launch/);
        if (m) err(`frozen, but PREREG ${name} still carries "${m[0]}"`);
      }
    }
    // Every recorded run is named in §0.1 (what the author had seen), and a recorded overrun of a cap is a §13 deviation.
    const observedStages = stageList.filter(s => Object.keys(s.observed ?? {}).length);
    if (observedStages.length) {
      const s01 = sectionOf(preregText, /^### 0\.1\b/m), s13 = sectionOf(preregText, /^## 13\./m);
      if (s01 == null) err('PREREG text has no §0.1 section for the recorded runs');
      else for (const s of observedStages) for (const id of [s.id, ...Object.keys(s.observed)]) if (!namesToken(s01, id)) err(`PREREG §0.1 does not name the recorded run ${id} (stage ${s.id})`);
      for (const o of observedOverruns) if (s13 == null || !namesToken(s13, o.tag)) err(`stage ${o.stage}: observed.${o.tag} is $${round2(o.metered)} on the meter against its $${o.share} cap, and PREREG §13 does not name ${o.tag}`);
    }
  }

  // The analysis reads the preregistered rules from their module (PREREG §14): a warning while it may still change, an
  // error once the Freeze addendum pins it (the §4.4 A-Freeze row no longer TBD-FREEZE).
  const rr = stages.analysis?.requiredRules;
  if (rr) {
    const modText = readText(rr.module);
    if (modText == null) err(`analysis.requiredRules: module ${rr.module} does not exist`);
    else {
      const exported = new Set([...modText.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+(\w+)/gm)].map(m => m[1]));
      for (const n of rr.rules ?? []) if (!exported.has(n)) err(`analysis.requiredRules: ${n} is not exported by ${rr.module}`);
      const imported = new Set(), base = path.posix.basename(rr.module);
      for (const reader of rr.readers ?? []) {
        const t = readText(reader);
        if (t == null) { err(`analysis.requiredRules: reader ${reader} does not exist`); continue; }
        for (const n of importedNames(t, base)) imported.add(n);
      }
      const missing = (rr.rules ?? []).filter(n => !imported.has(n));
      const aFreeze = preregText == null ? null : (/^\|\s*A-Freeze\b[^\n]*/m.exec(preregText) ?? [null])[0];
      const pinned = aFreeze != null && !/TBD-FREEZE/.test(aFreeze);
      if (missing.length) (pinned ? err : warn)(`${pinned ? 'the Freeze addendum pins the analysis, but ' : ''}${(rr.readers ?? []).join(' and ')} do not import ${missing.join(', ')} from ${base} (PREREG §14: the analysis reads the preregistered rules from there before Freeze)`);
    }
  }
  const summary = { status: stages.status, jobs: jobIds.size, arms: Object.keys(arms).length, stages: stageIds.size, seedChecks, totals: tot,
    clusters: Object.fromEntries(SPLITS.map(s => [s, Object.entries(clusters).filter(([, c]) => c.split === s).map(([k]) => k)])) };
  return { errors, warnings, summary };
}

/** Hash the planned tasks of some jobs in this process (examples and the probe task on one side, evaluation tasks on the
 *  other), checking every seed against the ledger before generating it. Returns counts and task ids, no content. */
async function hashJobs(stages, jobIds, { ledger = loadLedger() } = {}) {
  const { loadFamily } = await import(pathToFileURL(path.join(REPO, 'experiments/lib/beds.mjs')).href);
  const { canonical, sha256: hash } = await import(pathToFileURL(path.join(REPO, 'beds/lib/canonical.mjs')).href);
  const byFamily = new Map(), out = { tasks: 0, exampleEval: [], evalRepeats: [], refused: [] };
  for (const id of jobIds) {
    const j = stages.jobs.find(x => x.id === id);
    const fam = await loadFamily(j.family);
    const roles = ['examples', 'probe', j.split === 'train' ? 'trainEval' : 'heldoutEval', ...(E2E_SPLITS.has(j.split) ? ['e2e'] : [])];
    const rec = byFamily.get(j.family) ?? { example: new Map(), eval: new Map() };
    for (const role of roles) for (const t of planTasks(stages, j.id, role)) {
      const why = seedRefusals(ledger, { bed: j.ledgerBed ?? j.family, split: t.split, seed: t.seed, purpose: stages.seeds.purposes[ROLES[role].purposeKey] });
      if (why.length) { out.refused.push(`${j.id}:${role}:s${t.seed}: ${why.join('; ')}`); continue; }
      const args = { seed: t.seed, split: t.split, difficulty: t.difficulty, ...(t.stage ? { stage: t.stage } : {}) };
      const h = hash(canonical(fam.generate(args)));
      out.tasks += 1;
      const key = `${j.id}:${role}:s${t.seed}:d${t.difficulty}`;
      if (role === 'examples' || role === 'probe') rec.example.set(h, key);
      else { if (rec.eval.has(h) && rec.eval.get(h).startsWith(`${j.id}:`)) out.evalRepeats.push([rec.eval.get(h), key]); rec.eval.set(h, key); }
    }
    byFamily.set(j.family, rec);
  }
  for (const rec of byFamily.values()) for (const [h, key] of rec.eval) if (rec.example.has(h)) out.exampleEval.push([rec.example.get(h), key]);
  return out;
}

/** $0 L4 pre-check: generate every planned example, probe and evaluation task of each existing, non-sealed bed and look
 *  for taskHash collisions (example or probe vs evaluation within a family; repeated evaluation tasks within a job).
 *  Every seed is checked against the ledger first (refusals are reported, never generated). TRAIN families are hashed
 *  in this process; held-out, conditional and forced families only inside a child process whose output is the counts
 *  and task ids (job:role:seed:difficulty), never task content or hashes. `child: false` hashes TRAIN jobs here (tests of
 *  the child's counts compare with it); with a held-out, conditional or forced job it is refused (PREREG §3.3: the child
 *  is the only use of held-out seeds before Freeze). Families never span splits (checked), so the two halves cannot
 *  collide with each other. */
export async function hashCollisions(stages, { jobs = null, child = true, ledger = null } = {}) {
  const eligible = stages.jobs.filter(j => (!jobs || jobs.includes(j.id)) && j.bedStatus === 'exists' && j.band && j.family && !j.family.startsWith('sealed'));
  const dev = eligible.filter(j => j.split === 'train').map(j => j.id), held = eligible.filter(j => j.split !== 'train').map(j => j.id);
  if (!child && held.length) throw Object.assign(new Error(`hashCollisions: child: false would generate held-out tasks in this process (${held.join(', ')}); held-out families are hashed only in the child (PREREG §3.3)`), { code: 'HELDOUT_IN_PROCESS' });
  const L = ledger ?? loadLedger();
  const a = await hashJobs(stages, dev, { ledger: L });
  let b = { tasks: 0, exampleEval: [], evalRepeats: [], refused: [] };
  if (held.length) {
    {
      const txt = execFileSync(process.execPath, [THIS_FILE, '--hash-child'], { cwd: REPO, input: JSON.stringify({ stages, jobs: held }), encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 1 << 24 });
      b = JSON.parse(txt.trim().split('\n').pop());
    }
  }
  return { tasks: a.tasks + b.tasks, exampleEval: [...a.exampleEval, ...b.exampleEval], evalRepeats: [...a.evalRepeats, ...b.evalRepeats], refused: [...a.refused, ...b.refused],
    heldoutJobs: held.length, heldoutInChild: child && held.length > 0 };
}

// ------------------------------------------------------------------------------------------------------ engine stamps
const STAMP_DEFAULT = {
  labelEngine: { files: ['experiments/need-router/label-run.mjs', 'experiments/need-router/prereg-check.mjs', 'experiments/need-router/metrics.mjs', 'policy/models.json'],
    trees: ['experiments/lib', 'experiments/c0', 'src', 'beds/lib'], stagesFields: ['arms', 'priceTable', 'seeds', 'grid'] },
  analysis: { files: ['experiments/need-router/features.mjs', 'experiments/need-router/router.mjs', 'experiments/need-router/voi.mjs', 'experiments/need-router/metrics.mjs', 'experiments/need-router/evaluate.mjs'] },
};

/** The bed directories a set of families loads, following static relative imports (`from '...'`, `import('...')`) inside
 *  beds/ transitively: beds/wbed-r2 reaches beds/wbed and beds/records. beds/sealed is never read. */
export function bedClosure(families, { repo = REPO } = {}) {
  const root = path.join(repo, 'beds'), seen = new Set(), dirs = new Set();
  const queue = families.map(f => path.join(root, f, 'index.mjs')).filter(p => existsSync(p));
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const rel = path.relative(root, file), top = rel.split(path.sep)[0];
    if (rel.startsWith('..') || top === 'sealed') continue;
    dirs.add(top);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"](\.{1,2}\/[^'"]+)['"]/gm)) {
      const target = path.resolve(path.dirname(file), m[1]);
      if (target.startsWith(root + path.sep) && existsSync(target) && /\.m?js$/.test(target)) queue.push(target);
    }
  }
  return [...dirs].sort();
}

/** The jobs a stage runs (named, eligible), or every job with an existing bed when no stage is given. */
const stageJobs = (stages, stageId) => {
  if (!stageId) return stages.jobs.filter(j => j.bedStatus === 'exists');
  const st = stages.stages.find(s => s.id === stageId);
  if (!st) throw new Error(`stamp: unknown stage ${stageId}`);
  const ids = new Set((st.runs ?? []).flatMap(r => (r.job ? [r.job] : r.eligible ?? [])));
  return stages.jobs.filter(j => ids.has(j.id));
};

/** The engine-stamp records of the working tree (ROADMAP §6 rule 13; PREREG §4.4), read-only:
 *  - labelEngine: what makes a label (runner, task plan, arms, construct, model layer, engine, policy, the preregistered
 *    arms, prices, seeds and grid, and the bed-import closure of the stage's jobs); re-taken at every paid stage;
 *  - analysis: the router and evaluation code, free to change until the Freeze addendum pins it;
 *  - documents: the PREREG text and stages.json, informational (their edits are §13 records, not engine changes). */
export function stamp(stages, { repo = REPO, stage = null } = {}) {
  const git = args => { try { return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
  const fileSha = rel => (existsSync(path.join(repo, rel)) ? sha256(readFileSync(path.join(repo, rel))) : null);
  const cfg = { labelEngine: { ...STAMP_DEFAULT.labelEngine, ...(stages.engineStamp?.labelEngine ?? {}) }, analysis: { ...STAMP_DEFAULT.analysis, ...(stages.engineStamp?.analysis ?? {}) } };
  const families = [...new Set(stageJobs(stages, stage).filter(j => j.bedStatus === 'exists' && j.family && !j.family.startsWith('sealed')).map(j => j.family))]
    .concat((stage ? stages.stages.find(s => s.id === stage).runs ?? [] : []).filter(r => r.bed).map(r => r.bed));
  const bedDirs = bedClosure([...new Set(families)].sort(), { repo });
  const ledgerFile = path.join(repo, stages.ledger ?? 'research/jit-20261008/SEED-LEDGER.json');
  const ledger = existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, 'utf8')) : null;
  const needLedger = ledger ? { purposes: Object.fromEntries(Object.entries(ledger.purposes ?? {}).filter(([k]) => k.startsWith('need-'))), ranges: (ledger.ranges ?? []).filter(r => String(r.owner) === 'need-router' || String(r.id).startsWith('need-')) } : null;
  const labelEngine = {
    stage, commit: git(['rev-parse', 'HEAD']),
    dirty: (git(['status', '--porcelain', '--', ...cfg.labelEngine.files, ...cfg.labelEngine.trees, ...bedDirs.map(d => `beds/${d}`)]) ?? '').split('\n').filter(Boolean).length,
    files: Object.fromEntries(cfg.labelEngine.files.map(f => [f, fileSha(f)])),
    trees: Object.fromEntries(cfg.labelEngine.trees.map(t => [t, git(['rev-parse', `HEAD:${t}`])])),
    beds: Object.fromEntries(bedDirs.map(d => [d, git(['rev-parse', `HEAD:beds/${d}`])])),
    prereg: Object.fromEntries(cfg.labelEngine.stagesFields.map(k => [k, stages[k] === undefined ? null : sha256(canonicalJson(stages[k])).slice(0, 16)])),
    ledgerNeed: needLedger ? sha256(canonicalJson(needLedger)).slice(0, 16) : null,
    node: process.version,
  };
  return {
    labelEngine,
    analysis: { files: Object.fromEntries(cfg.analysis.files.map(f => [f, fileSha(f)])) },
    documents: Object.fromEntries(['research/need-router-20261014/prereg/stages.json', 'research/need-router-20261014/PREREG-NEED-V1.md', 'beds/wbed/references/r1-reference.mjs', 'beds/wbed/references/r3-reference.mjs'].map(f => [f, fileSha(f)])),
    note: 'the claude CLI version and the static@v3 arm parser state are recorded by the coordinator at launch (this script starts no binary)',
  };
}

/**
 * Compare a paid stage's label-engine stamp with the earlier paid stages' stamps (PREREG §4.4). `prev` is the previous
 * stamp or the list of every earlier one, oldest first. Allowed: a bed directory no earlier stamp holds (its first paid
 * use; no earlier label depends on it, e.g. the codefix-notests generator or the held-out families). Everything else
 * that differs is a deviation, recorded in §13 before the stage starts: a file, a tree, the preregistered arms, prices,
 * seeds, grid or meter, the need ledger, Node or the CLI (against the latest earlier stamp), or a bed against any earlier
 * stamp that used it.
 */
export function stampDiff(prev, next) {
  const earlier = (Array.isArray(prev) ? prev : [prev]).filter(Boolean);
  if (!earlier.length) throw new Error('stampDiff needs at least one earlier stamp');
  const last = earlier[earlier.length - 1], deviations = [], allowed = [], seen = new Set();
  const cmp = (k, a, b, at) => {
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null) || seen.has(`${k}|${a}`)) return;
    seen.add(`${k}|${a}`);
    deviations.push({ key: k, prev: a ?? null, next: b ?? null, ...(at ? { since: at } : {}) });
  };
  for (const g of ['files', 'trees', 'prereg']) for (const k of new Set([...Object.keys(last[g] ?? {}), ...Object.keys(next[g] ?? {})])) cmp(`${g}.${k}`, last[g]?.[k], next[g]?.[k]);
  for (const k of ['ledgerNeed', 'node', 'cli']) cmp(k, last[k], next[k]);
  for (const [d, tree] of Object.entries(next.beds ?? {})) {
    const users = earlier.filter(e => e.beds?.[d] !== undefined);
    if (!users.length) { allowed.push({ key: `beds.${d}`, next: tree, why: 'first paid use of this bed' }); continue; }
    for (const e of users) cmp(`beds.${d}`, e.beds[d], tree, e.stage ?? null);
  }
  return { deviations, allowed, ok: !deviations.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
  if (process.argv.includes('--hash-child')) {
    // The sealed half of --hashes: reads {stages, jobs} on stdin, prints one line of counts and task ids, nothing else.
    const { stages, jobs } = JSON.parse(readFileSync(0, 'utf8'));
    const r = await hashJobs(stages, jobs);
    process.stdout.write(`${JSON.stringify({ tasks: r.tasks, exampleEval: r.exampleEval, evalRepeats: r.evalRepeats, refused: r.refused })}\n`);
    process.exit(0);
  }
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const stagesFile = path.resolve(arg('--stages', STAGES_FILE));
  const preregFile = path.resolve(arg('--prereg', PREREG_FILE));
  const stages = JSON.parse(readFileSync(stagesFile, 'utf8'));
  const res = checkStages(stages, { preregText: existsSync(preregFile) ? readFileSync(preregFile, 'utf8') : null });
  if (process.argv.includes('--hashes')) {
    res.hashes = await hashCollisions(stages);
    for (const x of res.hashes.refused) res.errors.push(`--hashes: SEED_REFUSED ${x}`);
  }
  if (process.argv.includes('--stamp')) res.stamp = stamp(stages, { stage: arg('--stage', null) });
  if (process.argv.includes('--json')) console.log(JSON.stringify(res, null, 1));
  else {
    for (const e of res.errors) console.log(`ERROR ${e}`);
    for (const w of res.warnings) console.log(`warn  ${w}`);
    console.log(JSON.stringify(res.summary));
    if (res.hashes) console.log(`hashes: ${res.hashes.tasks} tasks (held-out families hashed in a child process: ${res.hashes.heldoutJobs} jobs); example/eval collisions ${res.hashes.exampleEval.length}; repeated eval tasks ${res.hashes.evalRepeats.length}; refused ${res.hashes.refused.length}`, JSON.stringify({ exampleEval: res.hashes.exampleEval.slice(0, 10), evalRepeats: res.hashes.evalRepeats.slice(0, 10) }));
    if (res.stamp) console.log(JSON.stringify(res.stamp, null, 1));
    console.log(res.errors.length ? `FAIL: ${res.errors.length} error(s)` : 'OK');
  }
  process.exit(res.errors.length ? 1 : 0);
}
