// DUR-1 sealed author (PREREG-DUR-1 §13.1 F-A, Appendix B; BUILD-PLAN §4 step 2). One Opus 5.5 xhigh session (<= $2,
// 60 min) writes the three sealed changes (R2s, E2s, U1s) as a dur1-sealed/1 bundle, blind to every program, result,
// contract, monitor and heal prompt; one revision session if its own gates fail. The platform runs the author's gates on
// its validation worlds 1223-1226 and prints COUNTS ONLY (to the author and to the experimenter alike). The bundle is
// stored outside the repository (/var/tmp/foundry-work/dur1-sealed/bundle.json); only its sha256 and the counts are
// committed (research/durability-20261021/SEALED.json) until the run ends.
// Gates (Appendix B): every anchor occurs once (stacked on the R1-edited transition); the drifted reference passes every
// completed case with 0 oracle errors (both timings); each change meets its exposure floor per world; for rule changes
// the reference WITHOUT that rule fails >= 90% of the change's exposed completed cases; every bad control still fails.
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync, renameSync, copyFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runClaudeCode } from '../../src/executors/claude-code.mjs';
import { buildBundle, loadSealed, transitionSource, R1_EDIT, ROOT, WORK } from './changes.mjs';
import { referencePools, gradeRun } from './oracle.mjs';
import { exposureOf } from './exposure.mjs';
import { runBundle, controlVersion, BAD_CONTROLS } from './arms.mjs';
import { ruleVersion } from './rmaint.mjs';
import { AUTHOR_VALIDATION, CHANGES, T0_MS, DAY_MS, assertDurSeeds } from './schedule.mjs';
import { spendOf, EffortMissing, throwIfEnvFault, preflight, meteredRun } from './heal-adapter.mjs';
import { specE } from '../../beds/ebed/e8/index.mjs';

const sha = s => createHash('sha256').update(s).digest('hex');
export const AUTHOR_SESSION = Object.freeze({ model: 'claude-opus-5-5', effort: 'xhigh', budgetUsd: 2.0, minutes: 60, role: 'sealed-author', revisions: 1 });
export const SEALED_DIR = process.env.DUR1_SEALED_DIR ?? '/var/tmp/foundry-work/dur1-sealed';
export const SEALED_IDS = Object.freeze(['R2s', 'E2s', 'U1s']);
const RES = path.join(ROOT, 'research/durability-20261021');

/** The author's validation world spec on seed s: R1 carried, the three sealed changes starting at their own onsets. */
export function validationSpec(seed, bundle, { size = 80 } = {}) {
  const at = (d, t = '00:00') => { const [h, m] = t.split(':').map(Number); return T0_MS + (d - 1) * DAY_MS + (h * 60 + m) * 60_000; };
  const ch = id => bundle.changes[id];
  return { stream: 'author', k: 4, seed, size, difficulty: 3, mix: 'tail', changes: [
    { id: 'R1', cls: 'CHG-A', kind: 'rule', startsHere: false, onsetMs: T0_MS, effMs: at(5), publishMs: null },   // carried: R1's published effective date (W3 d5), as in the streams (B7)
    { id: 'R2s', cls: 'CHG-A', kind: 'rule', startsHere: true, onsetMs: at(ch('R2s').onset.day), publishMs: ch('R2s').publish ? at(ch('R2s').publish.day, ch('R2s').publish.time ?? '09:00') : null },
    { id: 'E2s', cls: 'CHG-U', kind: 'env', startsHere: true, onsetMs: at(ch('E2s').onset.day), publishMs: null },
    { id: 'U1s', cls: 'CHG-U', kind: 'rule', startsHere: true, onsetMs: at(ch('U1s').onset.day), publishMs: null },
  ] };
}

/** Structural checks of a bundle object (schema, bounds of Appendix B). Returns [problem]. */
export function bundleProblems(b) {
  const p = [];
  if (b?.schema !== 'dur1-sealed/1') p.push('schema must be dur1-sealed/1');
  for (const id of SEALED_IDS) {
    const c = b?.changes?.[id];
    if (!c) { p.push(`${id} missing`); continue; }
    const [lo, hi] = CHANGES[id].onsetBounds;
    if (!Number.isInteger(c.onset?.day) || c.onset.day < lo || c.onset.day > hi) p.push(`${id}: onset day must be an integer in [${lo}, ${hi}]`);
    if (!c.label || !c.prediction) p.push(`${id}: label and prediction required`);
  }
  const r2 = b?.changes?.R2s;
  if (r2 && !(r2.publish?.day && r2.onset?.day - r2.publish.day >= 2)) p.push('R2s: publish at least 2 days before its effective date');
  if (r2 && !(r2.transition?.length && r2.spec?.length)) p.push('R2s: needs transition and spec edits');
  const e2 = b?.changes?.E2s;
  if (e2 && (e2.transition?.length || e2.spec?.length)) p.push('E2s: an environment drift edits no rule and no spec');
  if (e2) for (const r of e2.renames ?? []) if ((r.system === 'billing' && r.op === 'charge') || (r.system === 'carrier' && r.op === 'create')) p.push('E2s: a rename on billing.charge or carrier.create is not allowed (E1 uses one)');
  if (e2 && !(e2.renames?.length || e2.edition)) p.push('E2s: needs an edition change or an F5 rename');
  const u1 = b?.changes?.U1s;
  if (u1 && !(u1.transition?.length)) p.push('U1s: needs a transition edit gated by its effective date');
  if (u1 && u1.spec?.length) p.push('U1s: its spec diff is never published');
  if (u1 && !(Array.isArray(u1.complaintTemplates) && u1.complaintTemplates.length >= 3 && u1.complaintTemplates.length <= 5)) p.push('U1s: 3-5 complaint templates');
  for (const id of ['R2s', 'U1s']) for (const e of b?.changes?.[id]?.transition ?? []) if (!/__durEff\(world, '(R2s|U1s)'\)/.test(e.to)) p.push(`${id}: every transition edit must be gated by __durEff(world, '${id}')`);
  return p;
}

/**
 * The author's gates on a bundle file (count-only output). Returns { ok, text, counts }: text and counts carry numbers and
 * change ids only, never a case id, order or world detail.
 */
export async function authorGates(file, { seeds = AUTHOR_VALIDATION, controls = BAD_CONTROLS, size = 80 } = {}) {
  const lines = [], counts = { structural: [], worlds: [] };
  let b;
  try { b = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { return { ok: false, text: `bundle.json does not parse: ${String(e.message).slice(0, 200)}\n`, counts }; }
  counts.structural = bundleProblems(b);
  if (counts.structural.length) return { ok: false, text: `structural problems:\n${counts.structural.map(x => `- ${x}`).join('\n')}\n`, counts };
  let sealed;
  try {
    sealed = loadSealed(file);
    transitionSource([R1_EDIT, ...['R2s', 'U1s'].flatMap(id => (b.changes[id].transition ?? []).map((e, i) => ({ id: `${id}#${i}`, from: e.from, to: e.to })))]);
  } catch (e) { return { ok: false, text: `the edits do not apply: ${String(e.message).slice(0, 300)}\n`, counts }; }
  assertDurSeeds(seeds);
  let ok = true;
  for (const seed of seeds) {
    const spec = validationSpec(seed, b, { size });
    const w = { seed, problems: [] };
    let bundle;
    try { bundle = await buildBundle(spec, { sealed }); } catch (e) { ok = false; lines.push(`world ${seed}: does not build (${String(e.message).slice(0, 160)})`); counts.worlds.push({ seed, builds: false }); continue; }
    const ref = await referencePools(bundle);
    w.referenceOk = ref.control.ok; w.completed = ref.control.completed;
    if (!ref.control.ok) { ok = false; w.problems.push(`reference fails ${ref.control.problems.length} check(s)`); }
    const ex = await exposureOf(spec, { sealed, bundle });
    w.exposure = {};
    for (const id of SEALED_IDS) {
      const n = ex.changes[id]?.completed.size ?? 0, floor = CHANGES[id].floor;
      w.exposure[id] = { completed: n, floor };
      if (n < floor) { ok = false; w.problems.push(`${id} exposes ${n} completed cases (floor ${floor})`); }
    }
    for (const id of ['R2s', 'U1s']) {
      const ids = ['R1', 'R2s', 'U1s'].filter(x => x !== id);
      const run = await runBundle(bundle, { version: ruleVersion(ids) });
      const g = gradeRun(bundle, run.rows, ref.pools);
      const exp = ex.changes[id]?.completed ?? new Set();
      const failed = g.cases.filter(c => c.graded && exp.has(c.case) && !c.pass).length;
      w.exposure[id].undriftedFails = failed;
      if (exp.size && failed / exp.size < 0.9) { ok = false; w.problems.push(`the reference without ${id} fails only ${failed}/${exp.size} of its exposed cases (need >= 90%)`); }
    }
    w.controls = {};
    for (const c of controls) {
      const run = await runBundle(bundle, { version: controlVersion(c) });
      const g = gradeRun(bundle, run.rows, ref.pools);
      const fails = g.passed < g.completed || g.oracleErrors > 0;
      w.controls[c] = fails ? 'fails' : 'PASSES';
      if (!fails) { ok = false; w.problems.push(`bad control ${c} passes`); }
    }
    counts.worlds.push(w);
    lines.push(`world ${seed}: reference ${w.referenceOk ? 'ok' : 'FAILS'} (${w.completed} completed); exposure ${SEALED_IDS.map(id => `${id} ${w.exposure[id].completed}/${w.exposure[id].floor}${w.exposure[id].undriftedFails !== undefined ? ` (undrifted fails ${w.exposure[id].undriftedFails})` : ''}`).join(', ')}; controls ${Object.values(w.controls).filter(x => x === 'fails').length}/${controls.length} fail${w.problems.length ? `; PROBLEMS: ${w.problems.join('; ')}` : ''}`);
  }
  return { ok, text: `${ok ? 'ALL GATES PASS' : 'GATES FAIL'}\n${lines.join('\n')}\n`, counts };
}

export const CHECK_CLIENT = `// Ask the platform to run the gates on ./bundle.json (counts only). Usage: node check.mjs
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
mkdirSync('.check', { recursive: true });
const n = readdirSync('.check').filter(f => f.startsWith('req-')).length + 1;
writeFileSync(\`.check/req-\${n}.json\`, JSON.stringify({ n }));
process.stdout.write(\`check request \${n} queued; waiting (up to 20 min)\\n\`);
const t = Date.now();
while (Date.now() - t < 20 * 60_000) {
  if (existsSync(\`.check/res-\${n}.txt\`)) { process.stdout.write(readFileSync(\`.check/res-\${n}.txt\`, 'utf8')); process.exit(0); }
  await new Promise(r => setTimeout(r, 1000));
}
console.log('no answer within 20 min'); process.exit(1);
`;

/** Serve the gate mailbox for one author workdir. */
export function serveChecks(workdir, { pollMs = 1000 } = {}) {
  const box = path.join(workdir, '.check');
  mkdirSync(box, { recursive: true });
  let busy = false, stopped = false, count = 0;
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      for (const f of readdirSync(box).filter(x => /^req-\d+\.json$/.test(x))) {
        const n = f.slice(4, -5), res = path.join(box, `res-${n}.txt`);
        if (existsSync(res)) continue;
        let text;
        try { text = (await authorGates(path.join(workdir, 'bundle.json'))).text; } catch (e) { text = `the platform could not run the gates: ${String(e?.message ?? e).slice(0, 300)}\n`; }
        writeFileSync(`${res}.tmp`, text); renameSync(`${res}.tmp`, res);
        count += 1;
      }
    } finally { busy = false; }
  };
  const timer = setInterval(() => { tick().catch(() => {}); }, pollMs);
  return { stop: async () => { stopped = true; clearInterval(timer); while (busy) await new Promise(r => setTimeout(r, 200)); return count; }, tick };
}

/** The author's workspace (what it may see: Appendix B). */
export function authorFiles() {
  return {
    'AUTHOR-BRIEF.md': readFileSync(path.join(RES, 'AUTHOR-BRIEF.md'), 'utf8'),
    'API.md': readFileSync(path.join(ROOT, 'experiments/durability/fixtures/author-api.md'), 'utf8'),
    'SPEC-E.md': specE.text,
    'transition.base.mjs': transitionSource([R1_EDIT]),
    'drift-template.mjs': readFileSync(path.join(ROOT, 'experiments/compose/drift.mjs'), 'utf8'),
    'world.mjs': readFileSync(path.join(ROOT, 'beds/ebed/e8/world.mjs'), 'utf8'),
    'systems.mjs': readFileSync(path.join(ROOT, 'beds/ebed/e8/systems.mjs'), 'utf8'),
    'check.mjs': CHECK_CLIENT,
  };
}

/**
 * The paid author step (P1). session = stub { kind: 'stub', fn({ workdir, attempt, feedback }) } or a paid config with
 * spend and checkFreeze (F-A). Writes the bundle to SEALED_DIR and SEALED.json (sha256 + counts) under research/.
 */
export async function runAuthor({ session, sealedDir = SEALED_DIR, sealedJson = path.join(RES, "SEALED.json"), log = () => {}, gateOpts = {} }) {
  mkdirSync(sealedDir, { recursive: true });
  const records = [];
  let gates = null, feedback = null;
  // Attempts already on the ledger (a crash after a paid attempt) count: the author never gets more than one session and one
  // revision in all (review R2-M11).
  const prior = session.kind === 'stub' || !session.spend?.file || !existsSync(session.spend.file) ? 0
    : readFileSync(session.spend.file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(l => l?.phase === 'start' && /^author-a\d+$/.test(l.label ?? '')).length;
  if (prior >= 1 + AUTHOR_SESSION.revisions) { writeFileSync(sealedJson, JSON.stringify({ status: 'failed', at: new Date().toISOString(), records, reason: `${prior} author attempts already on the ledger` }, null, 1) + '\n'); return { ok: false, records, counts: null }; }
  for (let attempt = prior + 1; attempt <= 1 + AUTHOR_SESSION.revisions; attempt++) {
    const workdir = path.join(WORK, 'author', `a${attempt}`);
    rmSync(workdir, { recursive: true, force: true });
    mkdirSync(workdir, { recursive: true });
    for (const [f, t] of Object.entries(authorFiles())) writeFileSync(path.join(workdir, f), t);
    if (attempt > 1 && existsSync(path.join(sealedDir, 'bundle.candidate.json'))) copyFileSync(path.join(sealedDir, 'bundle.candidate.json'), path.join(workdir, 'bundle.json'));
    if (feedback) writeFileSync(path.join(workdir, 'GATES.txt'), feedback);
    const box = serveChecks(workdir);
    let r;
    try {
      if (session.kind === 'stub') r = await session.fn({ workdir, attempt, feedback });
      else {
        preflight(session, `author-a${attempt}`);   // freeze F-A (FreezeError: exit 3), row P1, total
        const prompt = `Read AUTHOR-BRIEF.md and API.md first, then write bundle.json and run \`node check.mjs\` until every gate passes.${feedback ? ' GATES.txt holds the gate output of your previous attempt.' : ''}`;
        r = await meteredRun(session, { label: `author-a${attempt}`, run: () => runClaudeCode({ model: session.model, prompt, workdir, files: {}, budgetUsd: session.budgetUsd, timeoutMs: session.minutes * 60_000, effort: session.effort }) });
        throwIfEnvFault(r, `author-a${attempt}`);
      }
    } finally { await box.stop(); }
    const f = path.join(workdir, 'bundle.json');
    records.push({ attempt, session: { kind: session.kind ?? 'paid', model: session.model ?? null, effort: session.effort ?? null, costUsd: r?.costUsd ?? 0, error: r?.error?.code ?? null }, wrote: existsSync(f) });
    if (!existsSync(f)) { feedback = 'no bundle.json was written\n'; continue; }
    copyFileSync(f, path.join(sealedDir, 'bundle.candidate.json'));
    gates = await authorGates(f, gateOpts);
    feedback = gates.text;
    log(`author attempt ${attempt}: ${gates.ok ? 'gates pass' : 'gates fail'}`);
    rmSync(workdir, { recursive: true, force: true });
    if (gates.ok) break;
  }
  const cand = path.join(sealedDir, 'bundle.candidate.json');
  if (!gates?.ok || !existsSync(cand)) {
    writeFileSync(sealedJson, JSON.stringify({ status: 'failed', at: new Date().toISOString(), records, counts: gates?.counts ?? null }, null, 1) + '\n');
    return { ok: false, records, counts: gates?.counts ?? null };
  }
  renameSync(cand, path.join(sealedDir, 'bundle.json'));
  const digest = sha(readFileSync(path.join(sealedDir, 'bundle.json')));
  writeFileSync(sealedJson, JSON.stringify({ status: 'sealed', sha256: digest, at: new Date().toISOString(), file: path.join(sealedDir, 'bundle.json'), records, counts: gates.counts }, null, 1) + '\n');
  return { ok: true, sha256: digest, records, counts: gates.counts };
}

/** A $0 stub author: writes the designer-known stub bundle (fixtures/sealed-stub.json), never the real sealed changes. */
export const stubAuthor = () => ({ kind: 'stub', fn: async ({ workdir }) => { copyFileSync(path.join(ROOT, 'experiments/durability/fixtures/sealed-stub.json'), path.join(workdir, 'bundle.json')); return { costUsd: 0 }; } });
