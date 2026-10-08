// LEARN (DESIGN §10): turn a localised pattern into a lesson for the constructor. A lesson is a PROPOSAL (status `proposed`): a lint
// rule with a reference implementation (lessons/rules/*.mjs, the pinned lint's finding shape), a template/cookbook diff for
// skills/micro-harness (text, not applied), a probe requirement, and its measured firing: it must fire on the base workflow, must
// not fire on the healed head, and its count over the workflow population is reported. A rule that fires on most workflows that
// work is downgraded to a warning or dropped. Accepted lessons reach the constructor only through a new kit hash
// (experiments/lib/kit.mjs), never by editing a frozen kit or skills/ in place; CX3 and EX1 do not share a moving kit.
import path from 'node:path';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { REPO } from './kit.mjs';
import { digest } from './ir.mjs';
import * as L1 from './lessons/rules/fragile-global-read.mjs';
import * as L2 from './lessons/rules/check-veto-ungated.mjs';
import * as L3 from './lessons/rules/check-self-exemption.mjs';

export const LESSON = 'heal-lesson/1';
export const LESSON_DIR = path.join(REPO, 'research/heal-20261008/lessons');
export const RULES = Object.freeze({ 'L-1': L1, 'L-2': L2, 'L-3': L3 });
// Which lesson a localised defect class teaches (DESIGN §10).
export const LESSON_OF = Object.freeze({ UNGUARDED_GLOBAL_READ: 'L-1', UNGUARDED_ITEM_READ: 'L-1', CHECK_ESCAPE_HATCH: 'L-3', OVERSTRICT_CHECK: 'L-2', CHECK_VETO_ROUTING: 'L-2' });

const TEXT = {
  'L-1': { title: 'Read a convention once, guard it, and probe every value of it',
    diff: 'skills/micro-harness: add to the "global reads" section. (1) A model read that conditions every item (a date order, a sign convention, a currency) returns a verbatim evidence quote and a check reads it. (2) State the rule "a worked example in the notes decides the order; a locale name does not" in its instructions. (3) Read it twice with distinct reader tags and compare, escalating on disagreement, or start it one class up. (4) Construction probes must exercise each value of a global setting: across the probes each enum field of a global read takes two values, or the construction record lists the untested branch.',
    probe: 'PROBE_VALUE_COVERAGE: across the construction probes, every enum field of an unguarded-or-guarded global read takes at least two values, or the construction record names it as an untested branch.' },
  'L-2': { title: 'A check encodes the contract, and a veto must be gated',
    diff: 'skills/micro-harness: add to the "code checks" section. (1) Every heuristic code check ships a self-test: a documented-legal change, cited from the task contract, must pass it. (2) A selector prefers the earliest candidate that passes the GATING checks; a heuristic check may only add evidence. (3) A repair prompt may not forbid what a named defect class requires (a wrong-default fix changes a default value). (4) The construction probe set covers each defect operator the task family names.',
    probe: 'A documented-legal edit of each kind the contract names must pass the check (documented_legal_edit probe).' },
  'L-3': { title: 'No self-exemption in a check',
    diff: 'skills/micro-harness: add to the "node checks" section. A check with an `any` must constrain the decision field in every branch; a branch that tests only a field the model itself chose (for example relation "none") exempts the output from checking the field that matters. Give decisive fields an unconditional check or a second independent read, and report the check-vacuity rate (share of outputs where no check constrained the decision field) as a construction metric.',
    probe: 'Check-vacuity rate over the construction probes at or below 25% for every decision field.' },
};

// ---- the workflow population a rule is measured on -------------------------------------------------------------------------------------
export function population({ repo = REPO } = {}) {
  const out = [], walk = d => { for (const e of readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.git', 'corpus'].includes(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.json')) { try { const j = JSON.parse(readFileSync(p, 'utf8')); if (j?.schemaVersion && Array.isArray(j.nodes) && Array.isArray(j.acceptance)) out.push({ name: path.relative(repo, p), workflow: j }); } catch { /* not a workflow */ } } } };
  for (const d of ['research', 'examples']) if (existsSync(path.join(repo, d))) walk(path.join(repo, d));
  return out;
}

export function measureRule(rule, pop, ctx = {}) {
  const fires = pop.filter(p => rule.check(p.workflow, ctx).length > 0);
  return { n: pop.length, fires: fires.length, share: pop.length ? +(fires.length / pop.length).toFixed(3) : 0, where: fires.map(f => f.name) };
}
// error if it fires on at most 10% of the population, warning up to 50%, dropped above (DESIGN §10).
export const severityFor = share => share <= 0.1 ? 'error' : share <= 0.5 ? 'warning' : 'dropped';

// Build the lesson for one localised incident.
export function lessonFor({ incidentId, classes, base, healed = null, population: pop = population(), fragility = {}, probes = null, signalCounts = {}, vacuity = [] }) {
  const code = classes.map(c => LESSON_OF[c.code]).find(Boolean);
  if (!code) return null;
  const rule = RULES[code], text = TEXT[code], ctx = { fragility };
  const onBase = rule.check(base, ctx), onHealed = healed ? rule.check(healed, ctx) : null, popM = measureRule(rule, pop, ctx);
  const lesson = { schema: LESSON, id: `${code}-${digest({ incidentId, code, base: digest(base) }).slice(0, 8)}`, lesson: code, from: incidentId, title: text.title,
    pattern: { defectClasses: classes.map(c => c.code), signature: onBase[0] ? { code: onBase[0].code, node: onBase[0].node, details: onBase[0].details } : null },
    lintRule: { code: rule.CODE, summary: rule.SUMMARY, implementation: `experiments/heal/lessons/rules/${{ 'L-1': 'fragile-global-read', 'L-2': 'check-veto-ungated', 'L-3': 'check-self-exemption' }[code]}.mjs`, severity: severityFor(popM.share), baseSeverity: onBase[0]?.severity ?? null },
    templateDiff: { target: 'skills/micro-harness', applied: false, text: text.diff }, probeRequirement: text.probe,
    firing: { onBase: onBase.length, onHealed: onHealed ? onHealed.length : null, firesOnBase: onBase.length > 0, quietOnHealed: onHealed ? onHealed.length === 0 : null, population: popM },
    evidence: { signals: signalCounts, vacuity, ...(probes ? { probes } : {}) },
    status: 'proposed', reviewer: null,
    caveats: ['Rules written from these artifacts: firing on them describes them and predicts nothing until it fires on workflows built after the rule was frozen (docs/LINT.md).',
      'Reaches the constructor only through a new kit hash; held until after EX1 so CX3 and EX1 do not share a moving kit (owner decision 4, default).'] };
  if (code === 'L-1' && probes) lesson.probeCoverage = L1.coverage(probes.returns, probes.outputs);
  return lesson;
}

export function writeLesson(lesson, dir = LESSON_DIR) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${lesson.id}.json`);
  writeFileSync(file, JSON.stringify(lesson, null, 1) + '\n');
  return file;
}
