// Oracle for the gameqa-web bed (hidden ground truth: truth/bugs.json). A report counts for an injected bug only when
// replaying its tokens from a fresh game with its seed, on the build under test, makes that bug's fault probe fire.
// Each injected fault computes the correct result next to the faulty one and records a probe only when they differ
// (game/game.js), so "the probe fired" means "the fault manifested in this replay".
//
// Per report (all replays deterministic, D0):
//   malformed     the report breaks the report schema (class, seed, 1..400 valid tokens): a false report
//   no_fault      replaying it fires no injected probe: a false report
//   credited      it fires at least one probe. Credit goes to the earliest fired bug whose accepted classes contain the
//                 report's class; if none does, to the earliest fired bug (classMatch false)
//   minimal       1-minimal (ddmin's guarantee): removing any single token stops the credited probe from firing
//   duplicate     a later report credited to a bug that an earlier report already earned (order: valid-minimal first)
// Per bug: foundMin (some report credits it with a 1-minimal repro), foundMinClass (and the class is accepted),
// foundAny (some report fires it). False reports = malformed + no_fault.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSession, tokenError, MAX_STEPS } from './driver.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const TRUTH_FILE = path.join(here, 'truth', 'bugs.json');
export const CLASSES = Object.freeze(['collision', 'state_desync', 'softlock', 'ui_overlap', 'score_overflow', 'input_race']);
export const loadTruth = (file = TRUTH_FILE) => JSON.parse(readFileSync(file, 'utf8'));

// The files whose bytes define the build, the public spec, the truth and the scoring rule.
export const FROZEN_FILES = Object.freeze(['game/index.html', 'game/game.js', 'spec/DESIGN.md', 'truth/bugs.json', 'driver.mjs', 'oracle.mjs']);
export function freezeManifest() {
  const files = Object.fromEntries(FROZEN_FILES.map(f => [f, createHash('sha256').update(readFileSync(path.join(here, f))).digest('hex')]));
  const all = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  return { files, sha256: all };
}

export function reportShapeError(r) {
  if (!r || typeof r !== 'object') return 'not an object';
  if (!CLASSES.includes(r.bug_class)) return `bug_class must be one of ${CLASSES.join(', ')}`;
  if (!Number.isInteger(r.seed) || r.seed < 1 || r.seed > 1_000_000) return 'seed must be an integer 1..1000000';
  if (!Array.isArray(r.steps) || r.steps.length < 1 || r.steps.length > MAX_STEPS) return `steps must hold 1..${MAX_STEPS} tokens`;
  const bad = r.steps.map(tokenError).find(Boolean);
  return bad ? `bad token: ${bad}` : null;
}

// Replays on the build under test and returns the ordered, de-duplicated list of bug ids whose probe fired.
async function firedBugs(session, byFlag, seed, steps) {
  const r = await session.replayWithProbes(seed, steps);
  const out = [];
  for (const f of r.fired) { const b = byFlag.get(f.id); if (b && !out.includes(b.id)) out.push(b.id); }
  return { fired: out, primitives: r.primitives };
}

/** Score a list of reports against the truth. `browser` is a Playwright browser; the oracle opens its own session. */
export async function scoreReports(browser, reports, { truth = loadTruth(), checkMinimality = true } = {}) {
  const byFlag = new Map(truth.bugs.map(b => [b.flag, b])), byId = new Map(truth.bugs.map(b => [b.id, b]));
  const session = await openSession(browser, { flags: truth.build.flags, oracle: true });
  const perReport = [];
  let replays = 0;
  try {
    for (const [index, report] of reports.entries()) {
      const shape = reportShapeError(report);
      if (shape) { perReport.push({ index, verdict: 'malformed', reason: shape }); continue; }
      const first = await firedBugs(session, byFlag, report.seed, report.steps); replays += 1;
      if (!first.fired.length) { perReport.push({ index, verdict: 'no_fault', steps: report.steps.length }); continue; }
      const again = await firedBugs(session, byFlag, report.seed, report.steps); replays += 1;
      const deterministic = JSON.stringify(again.fired) === JSON.stringify(first.fired);
      const matching = first.fired.find(id => byId.get(id).acceptClasses.includes(report.bug_class));
      const credited = matching ?? first.fired[0];
      let removable = [];
      if (checkMinimality) {
        for (let i = 0; i < report.steps.length; i++) {
          const without = report.steps.filter((_, j) => j !== i);
          if (!without.length) continue;
          const r = await firedBugs(session, byFlag, report.seed, without); replays += 1;
          if (r.fired.includes(credited)) removable.push(i);
        }
      }
      perReport.push({ index, verdict: 'credited', bug: credited, classMatch: Boolean(matching), fired: first.fired, deterministic,
        minimal: checkMinimality ? removable.length === 0 : null, removable, steps: report.steps.length, primitives: first.primitives });
    }
  } finally { await session.close(); }

  // Duplicates: per bug, the first valid-minimal report earns it (else the first credited one); the rest are duplicates.
  const perBug = Object.fromEntries(truth.bugs.map(b => [b.id, { class: b.class, foundAny: false, foundMin: false, foundMinClass: false, reports: [] }]));
  for (const r of perReport.filter(r => r.verdict === 'credited')) {
    const b = perBug[r.bug];
    b.reports.push(r.index); b.foundAny = true;
    if (r.minimal) { b.foundMin = true; if (r.classMatch) b.foundMinClass = true; }
  }
  for (const b of Object.values(perBug)) {
    const earner = b.reports.find(i => perReport.find(r => r.index === i).minimal) ?? b.reports[0];
    for (const i of b.reports) if (i !== earner) perReport.find(r => r.index === i).duplicate = true;
  }
  const count = f => Object.values(perBug).filter(f).length;
  const falseReports = perReport.filter(r => r.verdict === 'malformed' || r.verdict === 'no_fault').length;
  const summary = {
    reports: reports.length, bugs: truth.bugs.length,
    foundMin: count(b => b.foundMin), foundMinClass: count(b => b.foundMinClass), foundAny: count(b => b.foundAny),
    falseReports, duplicates: perReport.filter(r => r.duplicate).length,
    precision: reports.length ? perReport.filter(r => r.verdict === 'credited').length / reports.length : null,
    nondeterministic: perReport.filter(r => r.verdict === 'credited' && !r.deterministic).length, replays,
  };
  return { summary, perBug, perReport };
}
