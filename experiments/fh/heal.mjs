// FH-1: failure handling on real recurring failures of Haiku-built E8 workflows (research/heal-20261021/PREREG-FH1.md).
//
// The heal arm is the C3 loop: CLASSIFY -> INTERVENE -> PATCH -> REPLAY (gate) -> grade.
//   classify   code: run the program on the practice worlds, judge every completed order with the VERIFIER, group the failing orders
//              into failure classes (verifier, rule, normalised finding), localise each class to the modules that own its rules.
//   intervene  code (ROADMAP §2.6 ladder): a second run must reproduce every failure (deterministic program): then it is a workflow
//              defect and the action is a scoped patch (L3). A failure that does not reproduce would be a flake (retry), which the
//              baseline shows never happens here (retry recovers nothing), so this step only routes.
//   patch      one sandboxed Haiku 5.5 session (the builders' executor, effort high) with the program, SPEC-E, the failure report and
//              a smoke loop on the practice worlds that reports the arm's verifier.
//   replay     code: the patched program re-runs on the practice worlds under the arm's verifier; promoted only if it strictly reduces
//              the verifier's failing orders, fails no order that passed before, adds no arm error and loads. Otherwise the original
//              program is kept (the patch is rejected).
//   grade      $0: the kept program on the 9 grading worlds, judged by the E8 oracle (never seen by any arm).
// Arms differ only in the verifier (the factor under test, "verification precision is the bottleneck"):
//   H-C  the 13 capability contracts (spec-derived executable checks; experiments/compose/capabilities.mjs)
//   H-N  N-version consensus of the other recorded builds (oracle-free; the B1N-H method, experiments/ebed/repair.mjs)
//   H-0  none: the program is said to fail some orders; ungraded smoke; gate = loads and no new arm error
// METERED: the patch session only (CLI-reported cost). Every session is appended to the spend ledger before and after it runs.
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, copyFileSync, rmSync, readdirSync, renameSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { runClaudeCode } from '../../src/executors/claude-code.mjs';
import { CAPABILITIES } from '../compose/capabilities.mjs';
import { composedBuildFiles, runModuleTests } from '../compose/build.mjs';
import { readProgram } from '../compose/bundle.mjs';
import { interfaceReport } from '../compose/trace.mjs';
import { buildFiles } from '../ebed/build.mjs';
import { CLIENT } from '../ebed/smoke-service.mjs';
import { vote } from '../tracker/nversion.mjs';
import { ROOT, GRADING, PRACTICE, worldOf, worldKey, subjectOf, runWorld, gradeSubject, compare, totals, bedDigest } from './grade.mjs';
import { BUILDS } from './baseline.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const RUN_DIR = path.join(ROOT, 'research/heal-20261021/fh1/runs');
export const SPEND = path.join(ROOT, 'research/heal-20261021/fh1/spend.jsonl');
export const WORKDIRS = process.env.FH_WORKDIRS ?? '/var/tmp/foundry-work/fh-sessions';
const POLICY = JSON.parse(readFileSync(path.join(ROOT, 'policy', 'models.json'), 'utf8'));
export const MODEL = 'claude-haiku-5-5';
export const ARMS = Object.freeze(['H-C', 'H-N', 'H-0']);
export const INCIDENTS = Object.freeze(['ch-e8-1', 'ch-e8-2', 'ch-e8-3', 'cht-e8-1', 'cht-e8-2', 'cht-e8-3', 'b1lh-e8-2', 'b1lh-e8-3']);
// The N-version ensemble: every recorded Haiku build of the same SPEC-E (the incident itself is one voter, as in B1N-H).
export const ENSEMBLE = Object.freeze(['b1lh-e8-1', 'b1lh-e8-2', 'b1lh-e8-3', 'ch-e8-1', 'ch-e8-2', 'ch-e8-3', 'cht-e8-1', 'cht-e8-2', 'cht-e8-3']);
export const SESSION = Object.freeze({ model: MODEL, effort: 'high', budgetUsd: 0.5, minutes: 20 });
export const TOTAL_CAP_USD = 5;
export const ENV_FAULTS = Object.freeze(['MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'SANDBOX_UNAVAILABLE']);
const sha = s => createHash('sha256').update(s).digest('hex');

// ---- spend ledger -------------------------------------------------------------------------------------------------------------
export function spent(file = SPEND) {
  if (!existsSync(file)) return { usd: 0, upperUsd: 0, sessions: 0 };
  const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  const done = new Map();
  for (const l of lines) if (l.phase === 'end') done.set(l.id, l);
  const open = lines.filter(l => l.phase === 'start' && !done.has(l.id));
  const usd = [...done.values()].reduce((s, l) => s + (l.costUsd ?? l.costUpperUsd ?? 0), 0);
  return { usd, upperUsd: usd + open.reduce((s, l) => s + l.capUsd, 0), sessions: done.size, open: open.length };
}

// ---- classify -----------------------------------------------------------------------------------------------------------------
const norm = s => String(s).replace(/ORD-\d+-\d+(-F\d+)?/g, 'ORD-…').replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})?/g, '<time>')
  .replace(/\b(o|e|ev|ar)\d{3,}\b/g, '<id>').replace(/\b\d+(\.\d+)?\b/g, '<n>').slice(0, 160);
const RULES_OF = Object.fromEntries(CAPABILITIES.map(c => [c.id, c.rules]));
const ruleOwns = (owned, rule) => owned.some(o => o === rule || rule.startsWith(`${o}.`) || o.startsWith(`${rule}.`));

/** Failure classes from a practice grading under the contracts verifier. */
export function contractClasses(practice, manifest = null) {
  const classes = new Map();
  for (const w of practice.worlds) for (const c of w.cases) {
    if (c.contracts !== false) continue;
    for (const cap of c.failedContracts ?? []) {
      const [rule, detail] = c.violations?.[cap]?.[0] ?? ['?', ''];
      const key = `${cap}|${rule}|${norm(detail)}`;
      const k = classes.get(key) ?? { key, contract: cap, rule, finding: norm(detail), orders: [] };
      k.orders.push({ world: w.world, case: c.case, order: c.order, violations: c.violations[cap] });
      classes.set(key, k);
    }
  }
  const owners = rule => !manifest?.modules ? null : Object.entries(manifest.modules).filter(([, m]) => ruleOwns(m.rules ?? [], rule)).map(([id]) => id);
  return [...classes.values()].sort((a, b) => b.orders.length - a.orders.length || a.key.localeCompare(b.key))
    .map(k => ({ ...k, n: k.orders.length, contractRules: RULES_OF[k.contract] ?? [], owners: owners(k.rule) }));
}

/** The order's observable inputs on a practice world: inbound messages and its go-live export (what the program received). */
export function orderInputs(worldSpec, order, { max = 10 } = {}) {
  const w = worldOf(worldSpec);
  const msgs = (w.arrivals ?? []).filter(a => JSON.stringify(a.payload ?? {}).includes(order)).slice(0, max)
    .map(a => `- ${a.at} ${a.type}${a.source ? ` (${a.source})` : ''}: ${JSON.stringify(a.payload).slice(0, 300)}`);
  const mig = (w.backlog ?? []).find(b => JSON.stringify(b.export ?? {}).includes(order));
  return [...(msgs.length ? msgs : ['- (no separate inbound message)']),
    ...(mig ? [`- in the go-live migration export delivered at the start: ${JSON.stringify(mig.export).slice(0, 500)}`] : [])];
}

const describe = sig => { if (!sig) return 'nothing at all (no committed effect for this order)'; try { const s = JSON.parse(sig); return `effects ${s.ops.map(([k, n]) => `${k}×${n}`).join(', ')}; statuses ${s.st.join(', ') || '-'}; notifications ${s.nt.join(', ') || '-'}`; } catch { return String(sig).slice(0, 200); } };

/** Groups of failure classes that share at least one failing order (transitively). [{ classes: [index], orders: ['world/order'] }] */
export function failureGroups(classes) {
  const parent = classes.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owner = new Map();
  classes.forEach((k, i) => { for (const o of k.orders) { const key = `${o.world}/${o.order}`; if (owner.has(key)) parent[find(i)] = find(owner.get(key)); else owner.set(key, i); } });
  const out = new Map();
  classes.forEach((k, i) => { const r = find(i); const g = out.get(r) ?? { classes: [], orders: new Set() }; g.classes.push(i); for (const o of k.orders) g.orders.add(`${o.world}/${o.order}`); out.set(r, g); });
  return [...out.values()].map(g => ({ classes: g.classes, orders: [...g.orders].sort() })).sort((a, b) => b.orders.length - a.orders.length || a.classes[0] - b.classes[0]);
}

export function contractFailuresText(practice, classes, { sigs = {}, maxClasses = 8, examples = 3 } = {}) {
  const t = totals(practice.worlds);
  const lines = ['# Failure report', '',
    `The platform ran your program on the practice worlds (${PRACTICE.map(w => `${w.seed} d${w.d}`).join(', ')}; the same worlds \`node smoke.mjs\` uses) and`,
    `checked every completed order against its capability contracts, executable checks written from SPEC-E's rules.`,
    `${t.contractsPassed} of ${t.contractsN} completed orders pass every contract. The failing orders fall into ${classes.length} failure class${classes.length === 1 ? '' : 'es'}`,
    '(a class = one contract, one rule, one kind of finding). A second run reproduced every failure exactly, so each is a defect in the',
    'program, not chance. Your program is judged on other worlds with other orders: fix the cause, not the example.', ''];
  // CLASSIFY, second step: classes that fail on the same orders usually share one cause (a missed intake fails every later
  // contract of that order too). Group them by shared orders (union-find) so the session looks for the cause, not N symptoms.
  const groups = failureGroups(classes);
  if (groups.some(g => g.classes.length > 1)) {
    lines.push('## Likely common causes', '');
    for (const g of groups.filter(x => x.classes.length > 1)) {
      const nothing = g.orders.filter(o => !sigs[o.split('/')[0]]?.[o.split('/')[1]]).length;
      lines.push(`- Classes ${g.classes.map(i => i + 1).join(', ')} fail on the same ${g.orders.length} order${g.orders.length === 1 ? '' : 's'}${nothing ? ` (for ${nothing} of them your program committed no effect at all)` : ''}: probably one cause, upstream of the first rule they break.`);
    }
    lines.push('');
  }
  for (const [i, k] of classes.slice(0, maxClasses).entries()) {
    lines.push(`## Class ${i + 1}: ${k.n} order${k.n === 1 ? '' : 's'}, contract "${k.contract}", rule ${k.rule}`, '',
      `Finding (normalised): ${k.finding}`, `The contract checks SPEC-E rules ${k.contractRules.join(', ')}.`);
    if (k.owners) lines.push(k.owners.length ? `Modules whose manifest declares rule ${k.rule}: ${k.owners.join(', ')}.` : `No module in composition.json declares rule ${k.rule}.`);
    lines.push('');
    const seen = new Set();
    for (const o of k.orders.filter(o => !seen.has(o.world) && seen.add(o.world)).concat(k.orders).filter((o, j, a) => a.indexOf(o) === j).slice(0, examples)) {
      const [seed, d] = o.world.split(':');
      lines.push(`### ${o.order} (practice world ${seed}, difficulty ${d.slice(1)})`, '', 'What it received:', ...orderInputs({ seed: Number(seed), d: Number(d.slice(1)) }, o.order),
        'What the contract found:', ...o.violations.map(([r, dt]) => `- [${r}] ${dt}`), `What your program did: ${describe(sigs[o.world]?.[o.order])}`, '');
    }
  }
  if (classes.length > maxClasses) lines.push(`(${classes.length - maxClasses} smaller classes are not shown; \`node smoke.mjs\` lists every failing contract.)`);
  return lines.join('\n');
}

// ---- N-version (H-N) ----------------------------------------------------------------------------------------------------------
/** Per practice world, the ensemble's signatures; then the incident's disagreements with the strict majority. */
export function nversionDisagreements(sigsByBuild, incident) {
  const out = [];
  const builds = Object.keys(sigsByBuild);
  const i = builds.indexOf(incident);
  if (i < 0) throw new Error(`${incident} is not in the ensemble`);
  for (const w of PRACTICE.map(worldKey)) {
    const per = builds.map(b => new Map(Object.entries(sigsByBuild[b][w] ?? {})));
    for (const [order, v] of vote(per)) if (v.suspects.includes(i)) out.push({ world: w, order, mine: per[i].get(order) ?? null, consensus: v.consensus });
  }
  return out;
}
export function nversionText(list, { maxOrders = 12 } = {}) {
  const lines = ['# Orders where your program disagrees with the majority of independently built programs', '',
    'Each order below ran on a practice world (the same ones `node smoke.mjs` uses). A majority of other programs, built',
    'independently from the same SPEC-E, behaved one way; yours behaved another. The majority is NOT automatically right.',
    'For each order: read what it received, decide from SPEC-E which behaviour the spec requires, and fix your program only',
    'where yours is wrong. Write your reasoning per order (rule ids) into REPAIR-NOTES.md.', ''];
  if (!list.length) lines.push('(No order disagrees with the majority.)', '');
  for (const x of list.slice(0, maxOrders)) {
    const [seed, d] = x.world.split(':');
    lines.push(`## ${x.order} (practice world ${seed}, difficulty ${d.slice(1)})`, '', 'What it received:', ...orderInputs({ seed: Number(seed), d: Number(d.slice(1)) }, x.order), '',
      `Yours: ${describe(x.mine)}`, `Majority: ${describe(x.consensus)}`, '');
  }
  if (list.length > maxOrders) lines.push(`(${list.length - maxOrders} more orders disagree in the same way or similar ways.)`);
  return lines.join('\n');
}

// ---- practice report (the in-session smoke loop) ------------------------------------------------------------------------------
/** Run the program in `dir` (composed or monolith) on the practice worlds; the text a session sees, and the summary. */
export async function practiceReport(dir, kind, { mode = 'smoke', show = 8 } = {}) {
  const spec = kind === 'composed' ? `program:${dir}` : `solver:${path.join(dir, 'solver.mjs')}`;
  let subject;
  try { subject = subjectOf(spec); } catch (e) { return { text: `the program cannot be read: ${String(e.message).slice(0, 300)}\n`, summary: { loads: false } }; }
  const lines = [], summary = { loads: true, worlds: [] };
  if (!subject.source || subject.problems.length) {
    lines.push(`program problems (${subject.problems.length}); the platform will not run a program that does not load:`, ...subject.problems.slice(0, 12).map(p => `   - ${p}`), '');
    if (!subject.source) return { text: lines.join('\n'), summary: { loads: false, problems: subject.problems } };
    summary.problems = subject.problems;
  }
  for (const w of PRACTICE) {
    const r = await runWorld(subject, w, { judge: mode === 'contracts' ? 'contracts' : 'none', label: 'fh-smoke', withRows: true });
    const results = {};
    let emitted = 0;
    for (const row of r.rows) {
      if (row.type === 'call' && Array.isArray(row.output?.effects)) emitted += row.output.effects.length;
      if (row.type === 'deliver' && row.event?.type === 'effect.result') {
        const p = row.event.payload;
        for (const it of p.items ?? [{ status: p.status, error: p.error }]) {
          const k = `${p.system}.${p.op} ${it.status}${it.error ? ` ${it.error.code ?? ''} ${it.error.reason ?? ''}`.trimEnd() : ''}`;
          results[k] = (results[k] ?? 0) + 1;
        }
      }
    }
    const ticks = r.rows.filter(x => x.type === 'call').length, wakeups = r.rows.filter(x => x.type === 'wakeup.commit').length;
    lines.push(`== practice world ${w.seed} (difficulty ${w.d}): ${r.status}; ${wakeups} wake-ups, ${ticks} ticks, ${emitted} effects emitted`);
    lines.push(`arm errors: ${r.armErrors}`, ...r.armErrorSamples.map(s => `   ${s}`));
    lines.push('effect results your program received:', ...(Object.keys(results).length ? Object.keys(results).sort().map(k => `   ${String(results[k]).padStart(5)}  ${k}`) : ['   (none)']));
    if (kind === 'composed') {
      const ifc = interfaceReport(r.rows, subject.manifest);
      lines.push(`interface violations: ${ifc.violations} (dropped effects ${ifc.dropped})${ifc.violations ? ` by code ${JSON.stringify(ifc.violationsByCode)}, by module ${JSON.stringify(ifc.violationsByModule)}` : ''}`);
    }
    const ws = { world: r.world, status: r.status, armErrors: r.armErrors, ticks };
    if (mode === 'contracts') {
      const fails = r.cases.filter(c => c.contracts === false);
      lines.push(`capability contracts: ${r.cases.length - fails.length}/${r.cases.length} completed orders pass every contract`);
      const byCap = {};
      for (const c of fails) for (const cap of c.failedContracts) byCap[cap] = (byCap[cap] ?? 0) + 1;
      if (fails.length) lines.push(`   failing orders by contract: ${Object.entries(byCap).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
      for (const c of fails.slice(0, show)) { const [cap] = c.failedContracts; const [rule, detail] = c.violations[cap][0]; lines.push(`   ${c.order}: ${cap} [${rule}] ${detail}`); }
      Object.assign(ws, { completed: r.cases.length, passed: r.cases.length - fails.length, failing: fails.map(c => c.case) });
    }
    summary.worlds.push(ws);
    lines.push('');
  }
  return { text: lines.join('\n'), summary };
}

/** Serve the file-mailbox protocol of experiments/ebed/smoke-service.mjs from a session workdir until stop(). */
export function serveMailbox({ workdir, kind, mode, journal, pollMs = 1000 }) {
  const box = path.join(workdir, '.smoke');
  mkdirSync(box, { recursive: true });
  let busy = false, stopped = false, count = 0;
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      for (const f of readdirSync(box).filter(f => /^req-\d+\.json$/.test(f)).sort((a, b) => Number(a.slice(4, -5)) - Number(b.slice(4, -5)))) {
        const n = f.slice(4, -5), res = path.join(box, `res-${n}.txt`);
        if (existsSync(res)) continue;
        const t = Date.now();
        let text, summary = null;
        try { ({ text, summary } = await practiceReport(workdir, kind, { mode })); } catch (e) { text = `the platform could not run the program: ${String(e?.message ?? e).slice(0, 400)}\n`; }
        writeFileSync(`${res}.tmp`, text); renameSync(`${res}.tmp`, res);
        count += 1;
        if (journal) appendFileSync(journal, JSON.stringify({ n: Number(n), mode, ms: Date.now() - t, summary }) + '\n');
      }
    } finally { busy = false; }
  };
  const timer = setInterval(() => { tick().catch(() => {}); }, pollMs);
  return { stop: async () => { stopped = true; clearInterval(timer); while (busy) await new Promise(r => setTimeout(r, 200)); return count; } };
}

// ---- the session ---------------------------------------------------------------------------------------------------------------
const feedback = (mode, kind) => `
## Feedback loop

\`node smoke.mjs\` runs your ${kind === 'composed' ? 'program' : 'solver'} on the practice worlds through the real platform and prints the run status,
arm errors, the effect results it received${kind === 'composed' ? ' and the interface violations the runtime recorded' : ''}${mode === 'contracts'
    ? ', plus, per world, how many completed orders pass every capability contract and the first finding for each failing order'
    : ' (no grading: it does not say whether the rules were followed)'}. A run takes one to a few minutes. You may run it as often as you like.
`;

export function healTask(arm, kind) {
  const what = kind === 'composed' ? 'Your composed program in this directory (composition.json, parent.mjs, modules/, tests/)' : 'Your solver in this directory (solver.mjs)';
  const done = kind === 'composed' ? '\nWhen you are done, `node compose-kit/compose.mjs check` and `node compose-kit/compose.mjs test` must pass.' : '\nWhen you are done, solver.mjs must be the complete solver.';
  const keep = 'Change only what a fix requires and keep every other behaviour as it is' + ({
    'H-C': ': the platform keeps your change only if it fixes failing orders on the practice worlds without breaking any order that passed before.',
    'H-N': ': the platform keeps your change only if it settles disagreements without creating new ones.',
    'H-0': '.',
  }[arm] ?? '.');
  if (arm === 'H-C') return `# Task: fix the failures the platform found

${what} implements the order process of SPEC-E.md. The platform ran it on the practice worlds and checked every completed
order against its capability contracts (executable checks written from SPEC-E's rules). FAILURES.md lists the failing
orders, grouped into failure classes: for each class, the contract and rule it breaks, ${kind === 'composed' ? 'the modules that own that rule, ' : ''}and examples (what
the order received, what the contract found, what your program did). Every failure reproduced exactly on a second run,
so each one is a defect in the program, not chance.

For each class: read the cited rules in SPEC-E.md, find why your program does what it does for those orders, and fix the
cause. Your program is judged on other worlds with other orders, so fix the general behaviour the rule requires, never the
example orders. ${keep}${done}
${feedback('contracts', kind)}`;
  if (arm === 'H-N') return `# Task: check the orders where independently built programs disagree with yours

${what} implements the order process of SPEC-E.md. DISAGREEMENTS.md lists orders of the practice worlds where a
majority of independently built programs (same SPEC-E) behaved differently from yours. The majority is not automatically
right. For each order, decide from SPEC-E which behaviour the spec requires, fix your program only where yours is wrong,
and write your reasoning per order (rule ids) into REPAIR-NOTES.md. ${keep}${done}
${feedback('smoke', kind)}`;
  if (arm === 'H-0') return `# Task: find and fix what your program gets wrong

${what} implements the order process of SPEC-E.md. On worlds like the practice worlds it handles some orders wrongly;
the platform cannot tell you which. Review your program against every rule, race and reading in SPEC-E.md, find the
requirements it does not implement or implements wrongly, and fix them. ${keep}${done}
${feedback('smoke', kind)}`;
  throw new Error(`unknown arm ${arm}`);
}

function workspaceFiles(kind, arm) {
  const mode = arm === 'H-C' ? 'contracts' : 'smoke';
  const files = kind === 'composed' ? composedBuildFiles(e8, { arm: 'C-H', loop: 'smoke' }) : buildFiles(e8, { loop: 'smoke' });
  files['TASK.md'] = healTask(arm, kind);
  files['smoke.mjs'] = CLIENT;
  return { files, mode };
}

/** Copy the program of a build into a directory (composed: the program tree; monolith: solver.mjs). */
function placeProgram(label, dest) {
  const b = BUILDS[label];
  if (b.spec.startsWith('program:')) cpSync(path.join(ROOT, b.spec.slice(8)), dest, { recursive: true });
  else copyFileSync(path.join(ROOT, b.spec.slice(7)), path.join(dest, 'solver.mjs'));
  return b.spec.startsWith('program:') ? 'composed' : 'monolith';
}
function keepProgram(workdir, kind, keep) {
  mkdirSync(keep, { recursive: true });
  if (kind === 'monolith') { if (existsSync(path.join(workdir, 'solver.mjs'))) copyFileSync(path.join(workdir, 'solver.mjs'), path.join(keep, 'solver.mjs')); return; }
  const p = readProgram(workdir);
  if (p.manifest) writeFileSync(path.join(keep, 'composition.json'), JSON.stringify(p.manifest, null, 1));
  for (const [f, text] of Object.entries(p.sources)) { mkdirSync(path.dirname(path.join(keep, f)), { recursive: true }); writeFileSync(path.join(keep, f), text); }
  if (existsSync(path.join(workdir, 'tests'))) cpSync(path.join(workdir, 'tests'), path.join(keep, 'tests'), { recursive: true });
}
const specOf = (kind, dir) => (kind === 'composed' ? `program:${dir}` : `solver:${path.join(dir, 'solver.mjs')}`);

// ---- the gate (replay on practice worlds under the arm's verifier) ----------------------------------------------------------
/** Gate on two practice gradings (contracts judged) and, for H-N, the disagreement lists. Pure: the decision and its reasons. */
export function gateDecision(arm, { loads, before, after, nvBefore = null, nvAfter = null }) {
  if (!loads) return { accept: false, reason: 'does not load' };
  const ae = g => g.worlds.reduce((s, w) => s + (w.armErrors ?? 0), 0);
  if (ae(after) > ae(before)) return { accept: false, reason: `arm errors ${ae(before)} -> ${ae(after)}` };
  if (arm === 'H-C') {
    const c = compare(before, after, { by: 'contracts' });
    if (c.nRegressed > 0) return { accept: false, reason: `${c.nRegressed} practice orders newly fail a contract (${c.nRecovered} recovered)` };
    if (c.nRecovered === 0) return { accept: false, reason: 'no failing practice order recovered' };
    return { accept: true, reason: `${c.nRecovered} practice orders recovered, 0 regressed` };
  }
  if (arm === 'H-N') {
    const key = x => `${x.world}/${x.order}`;
    const B = new Set(nvBefore.map(key)), A = new Set(nvAfter.map(key));
    const fresh = [...A].filter(k => !B.has(k)).length, gone = [...B].filter(k => !A.has(k)).length;
    if (fresh > 0) return { accept: false, reason: `${fresh} orders newly disagree with the majority` };
    if (gone === 0) return { accept: false, reason: 'no disagreement resolved' };
    return { accept: true, reason: `${gone} disagreements resolved, 0 new` };
  }
  if (arm === 'H-0') return { accept: true, reason: 'loads; no new arm error (no correctness signal)' };
  throw new Error(`unknown arm ${arm}`);
}

/** Signatures of every ensemble build on the practice worlds ($0), cached in the run directory. */
export async function ensembleSignatures({ cache = path.join(RUN_DIR, '..', 'ensemble-signatures.json') } = {}) {
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8'));
  const out = {};
  for (const b of ENSEMBLE) {
    const s = subjectOf(BUILDS[b].spec);
    out[b] = {};
    for (const w of PRACTICE) out[b][worldKey(w)] = (await runWorld(s, w, { judge: 'none', withSignatures: true, label: `fh-nv-${b}` })).signatures;
  }
  mkdirSync(path.dirname(cache), { recursive: true });
  writeFileSync(cache, JSON.stringify({ bedDigest: bedDigest(), ...out }));
  return { bedDigest: bedDigest(), ...out };
}

/**
 * One heal attempt: incident x arm x k. Writes runs/<incident>.<arm>.k<k>/{record.json, FAILURES.md|DISAGREEMENTS.md, program/,
 * transcript.jsonl, smoke.jsonl}. `session` may be replaced by a scripted stub for the $0 dry run.
 */
export async function healAttempt({ incident, arm, k = 1, session = null, dryRun = false, log = console.log }) {
  if (!INCIDENTS.includes(incident)) throw new Error(`unknown incident ${incident}`);
  if (!ARMS.includes(arm)) throw new Error(`unknown arm ${arm}`);
  if (!POLICY.models.some(m => m.id === SESSION.model)) throw new Error(`model not in the owner policy: ${SESSION.model}`);
  const label = `${incident}.${arm}.k${k}${dryRun ? '.dry' : ''}`;
  const out = path.join(RUN_DIR, label);
  if (existsSync(path.join(out, 'record.json'))) { log(`${label}: done before, skipped`); return JSON.parse(readFileSync(path.join(out, 'record.json'), 'utf8')); }
  mkdirSync(out, { recursive: true });
  const base = BUILDS[incident];
  const baseline = JSON.parse(readFileSync(path.join(ROOT, 'research/heal-20261021/fh1/baseline', `${incident}.json`), 'utf8'));
  const t0 = Date.now();
  // CLASSIFY (and the INTERVENE routing: the baseline's second run reproduced every failure exactly, i.e. a workflow defect).
  const intervene = baseline.retry?.identicalJournals ? 'patch (workflow defect: every failure reproduces exactly)' : 'retry first (failures did not reproduce)';
  let report, nvBefore = null, sigsByBuild = null;
  const kind = base.spec.startsWith('program:') ? 'composed' : 'monolith';
  const manifest = kind === 'composed' ? readProgram(path.join(ROOT, base.spec.slice(8))).manifest : null;
  if (arm === 'H-C') {
    const classes = contractClasses(baseline.practice, manifest);
    const sigs = (await ensembleSignatures())[incident];
    report = { file: 'FAILURES.md', text: contractFailuresText(baseline.practice, classes, { sigs }), classes: classes.map(({ orders, ...c }) => ({ ...c, orders: orders.map(o => `${o.world}/${o.order}`) })) };
  } else if (arm === 'H-N') {
    sigsByBuild = await ensembleSignatures();
    const ens = Object.fromEntries(ENSEMBLE.map(b => [b, sigsByBuild[b]]));
    nvBefore = nversionDisagreements(ens, incident);
    report = { file: 'DISAGREEMENTS.md', text: nversionText(nvBefore), disagreements: nvBefore.length };
  } else report = { file: null, text: null };
  if (report.file) writeFileSync(path.join(out, report.file), report.text);
  // INTERVENE, no signal (prereg §2): an N-version verifier that finds no disagreement gives the healer nothing to act on, and its
  // gate could never accept; the method takes no action. No session, $0, outcome net 0 (recorded as no-signal).
  if (arm === 'H-N' && nvBefore.length === 0) {
    const zero = { nRecovered: 0, nRegressed: 0, net: 0, recoveredByClass: {}, regressedByClass: {} };
    const record = { label, incident, arm, k, dryRun, kind, at: new Date().toISOString(), wallMs: Date.now() - t0, bedDigest: bedDigest(), intervene: 'no action (the verifier reports no disagreement)',
      baseDigest: subjectOf(base.spec).digest, patchedDigest: null, changed: false, loads: true, problems: [], noSignal: true,
      session: { model: SESSION.model, effort: SESSION.effort, capUsd: 0, costUsd: 0, costUpperUsd: 0, costUnknown: false, turns: 0, error: null, durationMs: 0, smokeRuns: 0 },
      report: { file: report.file, sha256: sha(report.text), disagreements: 0 }, gate: { accept: false, reason: 'no disagreement: no session' }, gates: null, moduleTests: null,
      practice: { before: totals(baseline.practice.worlds), after: null, nvBefore: 0, nvAfter: null },
      grading: { before: totals(baseline.grading.worlds), rawAfter: null, raw: null, kept: zero } };
    writeFileSync(path.join(out, 'record.json'), JSON.stringify(record, null, 1));
    log(`${label}: no disagreement on the practice worlds: no session (no-signal), kept net 0`);
    return record;
  }
  // PATCH
  const workdir = path.join(WORKDIRS, label);
  rmSync(workdir, { recursive: true, force: true });
  mkdirSync(workdir, { recursive: true });
  const { files, mode } = workspaceFiles(kind, arm);
  for (const [f, t] of Object.entries(files)) { mkdirSync(path.dirname(path.join(workdir, f)), { recursive: true }); writeFileSync(path.join(workdir, f), t); }
  placeProgram(incident, workdir);
  if (report.file) writeFileSync(path.join(workdir, report.file), report.text);
  const smokeJournal = path.join(out, 'smoke.jsonl');
  const box = serveMailbox({ workdir, kind, mode, journal: smokeJournal });
  const id = `${label}@${new Date().toISOString()}`;
  let r;
  try {
    if (session) r = await session({ workdir, kind, arm });
    else {
      const s = spent();
      if (s.upperUsd + SESSION.budgetUsd > TOTAL_CAP_USD) throw Object.assign(new Error(`FH_BUDGET: spent ${s.upperUsd.toFixed(3)} + cap ${SESSION.budgetUsd} > ${TOTAL_CAP_USD}`), { code: 'FH_BUDGET' });
      mkdirSync(path.dirname(SPEND), { recursive: true });
      appendFileSync(SPEND, JSON.stringify({ id, phase: 'start', label, capUsd: SESSION.budgetUsd, at: new Date().toISOString() }) + '\n');
      const prompt = `${files['TASK.md']}\nRead TASK.md, SPEC-E.md, ${report.file ? `${report.file}, ` : ''}and your program first.`;
      r = await runClaudeCode({ model: SESSION.model, prompt, workdir, files: {}, budgetUsd: SESSION.budgetUsd, timeoutMs: SESSION.minutes * 60_000, effort: SESSION.effort });
      appendFileSync(SPEND, JSON.stringify({ id, phase: 'end', label, capUsd: SESSION.budgetUsd, costUsd: r.costUsd, costUpperUsd: r.costUpperUsd, costUnknown: r.costUnknown, turns: r.turns, error: r.error?.code ?? null, at: new Date().toISOString() }) + '\n');
    }
  } finally {
    const smokeRuns = await box.stop();
    r = { ...(r ?? {}), smokeRuns };
  }
  if (existsSync(path.join(workdir, '.executor-transcript.jsonl'))) copyFileSync(path.join(workdir, '.executor-transcript.jsonl'), path.join(out, 'transcript.jsonl'));
  // Environment fault (prereg §3): a session refused by a rate or usage limit, an unavailable model or no sandbox is recorded, not
  // graded as an outcome; no record.json is written, so the plan runner reruns the step once at the end (if budget remains).
  if (ENV_FAULTS.includes(r.error?.code)) {
    const n = readdirSync(out).filter(f => /^envfault-\d+\.json$/.test(f)).length + 1;
    writeFileSync(path.join(out, `envfault-${n}.json`), JSON.stringify({ label, at: new Date().toISOString(), error: r.error, costUsd: r.costUsd ?? null, costUpperUsd: r.costUpperUsd ?? null, turns: r.turns ?? null, smokeRuns: r.smokeRuns }, null, 1));
    if (existsSync(path.join(out, 'transcript.jsonl'))) renameSync(path.join(out, 'transcript.jsonl'), path.join(out, `envfault-${n}.transcript.jsonl`));
    rmSync(workdir, { recursive: true, force: true });
    log(`${label}: ENVIRONMENT FAULT ${r.error.code} (recorded as envfault-${n}.json; not an outcome)`);
    return { label, envFault: r.error.code };
  }
  for (const f of ['REPAIR-NOTES.md']) if (existsSync(path.join(workdir, f))) copyFileSync(path.join(workdir, f), path.join(out, f));
  const keep = path.join(out, 'program');
  keepProgram(workdir, kind, keep);
  const sessionRec = { model: SESSION.model, effort: SESSION.effort, capUsd: SESSION.budgetUsd, costUsd: r.costUsd ?? null, costUpperUsd: r.costUpperUsd ?? null, costUnknown: r.costUnknown ?? null,
    turns: r.turns ?? null, error: r.error ?? null, durationMs: r.durationMs ?? null, smokeRuns: r.smokeRuns };
  log(`${label}: session ${JSON.stringify(sessionRec)}`);
  // REPLAY (gate) on the practice worlds: every arm's gate is computed (analysis), the arm's own decides.
  const after = specOf(kind, keep);
  const subj = subjectOf(after);
  const loads = !!subj.source && !subj.problems.length;
  const changed = subj.digest !== subjectOf(base.spec).digest;
  const practiceAfter = loads ? await gradeSubject(subj, { worlds: PRACTICE, label: `fh-${label}`, withSignatures: true }) : null;
  let nvAfter = null;
  if (loads) {
    const mine = Object.fromEntries(practiceAfter.worlds.map(w => [w.world, w.signatures ?? {}]));
    for (const w of practiceAfter.worlds) delete w.signatures;
    sigsByBuild ??= await ensembleSignatures();
    const all = Object.fromEntries(ENSEMBLE.map(b => [b, sigsByBuild[b]]));
    nvBefore ??= nversionDisagreements(all, incident);
    nvAfter = nversionDisagreements({ ...all, [incident]: mine }, incident);
  }
  const gates = Object.fromEntries(ARMS.map(a => [a, practiceAfter ? gateDecision(a, { loads, before: baseline.practice, after: practiceAfter, nvBefore, nvAfter }) : { accept: false, reason: loads ? 'not graded' : 'does not load' }]));
  const gate = changed ? gates[arm] : { accept: false, reason: 'program unchanged' };
  const tests = kind === 'composed' && loads ? await runModuleTests(workdir).catch(e => ({ error: String(e.message).slice(0, 200) })) : null;
  // GRADE ($0, oracle, grading worlds): the raw patched program always (gate precision), the kept program is the arm's outcome.
  const gradingAfter = loads ? await gradeSubject(subj, { worlds: GRADING, label: `fh-${label}` }) : null;
  const raw = gradingAfter ? compare(baseline.grading, gradingAfter, { by: 'oracle' }) : null;
  const kept = gate.accept ? raw : { nRecovered: 0, nRegressed: 0, net: 0, recovered: [], regressed: [] };
  const summ = c => c && { nRecovered: c.nRecovered, nRegressed: c.nRegressed, net: c.net, recoveredByClass: tally(c.recovered), regressedByClass: tally(c.regressed) };
  const record = { label, incident, arm, k, dryRun, kind, at: new Date().toISOString(), wallMs: Date.now() - t0, bedDigest: bedDigest(), intervene,
    baseDigest: subjectOf(base.spec).digest, patchedDigest: subj.digest, changed, loads, problems: subj.problems.slice(0, 10), session: sessionRec,
    report: report.file ? { file: report.file, sha256: sha(report.text), ...(report.classes ? { classes: report.classes } : {}), ...(report.disagreements !== undefined ? { disagreements: report.disagreements } : {}) } : null,
    gate, gates, moduleTests: tests,
    practice: { before: totals(baseline.practice.worlds), after: practiceAfter?.totals ?? null, nvBefore: nvBefore?.length ?? null, nvAfter: nvAfter?.length ?? null },
    grading: { before: totals(baseline.grading.worlds), rawAfter: gradingAfter?.totals ?? null, raw: summ(raw), kept: summ(kept) } };
  writeFileSync(path.join(out, 'record.json'), JSON.stringify(record, null, 1));
  if (gradingAfter) writeFileSync(path.join(out, 'grading-after.json'), JSON.stringify(gradingAfter));
  rmSync(workdir, { recursive: true, force: true });
  log(`${label}: gate ${gate.accept ? 'ACCEPT' : 'reject'} (${gate.reason}); grading raw ${raw ? `+${raw.nRecovered}/-${raw.nRegressed}` : '-'}; kept net ${kept.net}`);
  return record;
}
const tally = list => { const o = {}; for (const x of list ?? []) o[x.class] = (o[x.class] ?? 0) + 1; return o; };

async function main() {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const plan = arg('--plan', null);
  if (plan) {
    // A plan line is "<incident> <arm> <k>"; the plan file is frozen with the preregistration and run in order.
    const steps = readFileSync(plan, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => l.split(/\s+/));
    // Wall-time stop (prereg §3): no step starts after the deadline; the steps not run are listed.
    const deadline = arg('--deadline', null) ? Date.parse(arg('--deadline')) : Infinity;
    const { checkFreeze } = await import('./freeze.mjs');
    const faulted = [];
    const runSteps = async (list, pass) => {
      for (const [i, [incident, arm, k]] of list.entries()) {
        if (Date.now() > deadline) { console.log(`deadline ${arg('--deadline')} passed; not run (${pass}): ${list.slice(i).map(s => s.join(' ')).join('; ')}`); return false; }
        const s = spent();
        if (s.upperUsd + SESSION.budgetUsd > TOTAL_CAP_USD) { console.log(`stop rule (${pass}): spent ${s.upperUsd.toFixed(3)} + cap ${SESSION.budgetUsd} > ${TOTAL_CAP_USD}; ${incident} ${arm} k${k} and later steps not run`); return false; }
        const fz = checkFreeze();
        if (!fz.ok) { console.log(`FREEZE VIOLATED before ${incident} ${arm} k${k}: ${JSON.stringify(fz)}; stopping`); return false; }
        try {
          const rec = await healAttempt({ incident, arm, k: Number(k) });
          if (rec?.envFault) faulted.push([incident, arm, k]);
        } catch (e) { console.log(`${incident} ${arm} k${k}: ERROR ${e.code ?? ''} ${String(e.message).slice(0, 300)}`); if (e.code === 'FH_BUDGET') return false; }
      }
      return true;
    };
    // Environment faults are rerun once, at the end, if budget and time remain (prereg §3).
    if (await runSteps(steps, 'plan') && faulted.length) { console.log(`rerunning ${faulted.length} environment-faulted step(s) once`); await runSteps(faulted.splice(0), 'rerun'); }
    console.log(`spend: ${JSON.stringify(spent())}`);
    return;
  }
  const dry = arg('--dry', null);
  // $0 dry runs (label suffix .dry, excluded from the analysis): `noop` leaves the program unchanged; `swap:<build>` replaces it with
  // another recorded build's program (a scripted "patch" whose effect on every gate and on grading is known in advance).
  const session = dry === null ? null : dry === 'noop' ? async () => ({ costUsd: 0, turns: 0 })
    : dry.startsWith('swap:') ? async ({ workdir, kind }) => {
      const other = BUILDS[dry.slice(5)];
      if (kind === 'monolith') copyFileSync(path.join(ROOT, other.spec.slice(7)), path.join(workdir, 'solver.mjs'));
      else { for (const f of ['composition.json', 'parent.mjs', 'modules']) rmSync(path.join(workdir, f), { recursive: true, force: true }); cpSync(path.join(ROOT, other.spec.slice(8)), workdir, { recursive: true }); }
      return { costUsd: 0, turns: 0 };
    } : null;
  if (dry !== null && !session) throw new Error(`unknown --dry ${dry}`);
  await healAttempt({ incident: arg('--incident'), arm: arg('--arm'), k: Number(arg('--k', '1')), session, dryRun: dry !== null });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
