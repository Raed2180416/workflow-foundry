// SPEC-1 / INTENT-1 arms (research/intent-20261021/DESIGN.md §3, §9; FIRST-CLASS-PROGRAMS §4.4). Pure, $0: what each arm's
// builder or agent is given. The build arms are B1L-H exactly (experiments/ebed/build.mjs buildFiles(e8, { loop: 'smoke' }):
// Haiku 5.5, effort high, one sandboxed session, $3 and 40 min, CONTRACT.md, api/*.schema.json, the smoke loop on the
// practice worlds 1235-1237) with ONE difference: SPEC-E.md is replaced by the rendered messy-business pack under
// business/ (experiments/specbiz/render.mjs), plus, per arm, the owner channel (ask.mjs), a corpus prior card or a reviewed
// requirement ledger. The none-agent arm is AGENTV-E8's agent-H + validator (experiments/agentv/arm.mjs) with the pack
// instead of SPEC-E (pack-agent.mjs).
//
// Build item 1 (DESIGN §9): every host a derived solver or agent runs under (smoke loop, grading, agent run) is bound with
// `specE: ''` (NO_SPEC_BINDING), so beds/ebed/host/host.mjs never writes spec/SPEC-E.md into ctx.files. DERIVE_ITEM is
// the E8 item module with that binding, for smoke-service.mjs smokeReport/serveMailbox, which take an item.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { buildFiles, taskText } from '../ebed/build.mjs';
import { clientInstructions } from '../ebed/smoke-service.mjs';
import { ASK_CLIENT } from './ask-service.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');
export const ARMS_VERSION = 'spec1-arms/1';

/** The arms. experiment: which preregistered run the arm belongs to; ask: on | off | forced (20 questions, all of them). */
export const ARMS = Object.freeze({
  derive: Object.freeze({ experiment: 'SPEC-1', kind: 'build', ask: 'on', ledger: false, prior: false, role: 'F4: B1L-H conditions with the pack instead of SPEC-E, plus ask()' }),
  'derive-ledger': Object.freeze({ experiment: 'SPEC-1', kind: 'build', ask: 'on', ledger: true, prior: false, role: 'the bridge: derive plus a quote-anchored ledger extracted from the pack, reviewed by the simulated owner' }),
  'none-agent': Object.freeze({ experiment: 'SPEC-1', kind: 'agent', ask: 'on', ledger: false, prior: false, role: 'floor: agent-H + validator per tick with the pack instead of SPEC-E, no build, sized world 1232 d2 size 12' }),
  'derive-prior': Object.freeze({ experiment: 'INTENT-1', kind: 'build', ask: 'on', ledger: false, prior: true, role: 'the corpus as prior: derive plus the family prior card and its ask-do-not-add rule' }),
  'no-ask': Object.freeze({ experiment: 'INTENT-1', kind: 'build', ask: 'off', ledger: false, prior: false, role: 'control: derive with ask disabled' }),
  'always-ask': Object.freeze({ experiment: 'INTENT-1', kind: 'build', ask: 'forced', ledger: false, prior: false, role: 'control: derive with all 20 questions asked before the solver is written' }),
});
export const ARM_NAMES = Object.freeze(Object.keys(ARMS));

/** The host binding for every derived run: E8's, with no spec (host.mjs bindItem reads specE '' as "no spec file"). */
export const NO_SPEC_BINDING = Object.freeze({ ...e8.binding, specE: '' });
/** The E8 item with the no-spec binding and no spec text (smoke-service.mjs and the grading take an item). */
export const DERIVE_ITEM = Object.freeze({ ...e8, binding: NO_SPEC_BINDING, specE: Object.freeze({ file: null, sha256: null, text: '' }) });

/** Exact, audited replacements that turn B1L-H's E8 TASK.md into the derived one (each must apply exactly once). */
export const TASK_EDITS = Object.freeze([
  ['that implements every rule of SPEC-E.md exactly.', 'that handles this shop\'s orders the way the shop wants them handled (see "The shop" below).'],
  ['calendar, the spec, the instance\'s records', 'calendar, the instance\'s records'],
  ['Work carefully through every rule, race and reading in SPEC-E.md.', 'Work carefully through every rule, race and reading the shop\'s\ndocuments and its owner give you.'],
]);

export const SHOP_SECTION = `
## The shop

There is no rulebook. What this shop (Hollin Retail) wants is in its own documents, copied into business/ as they are:
business/REQUEST.md (the owner's request), business/PLATFORM.md (the platform and its systems, exact), the wiki, the
inbox and the records exports. Like any real business's documents they overlap, some are out of date, and not everything
in them is the shop's policy. The business documents are not in ctx.files at run time: your solver must carry what it
needs.
`;

export const ASK_SECTION = `
## Asking the owner

Mara, the owner, knows how every part of the order handling should work, including what the documents leave out or got
wrong. To ask her one question, run

    node ask.mjs "your question"

It prints her answer (it can take a minute). She answers only what you ask, and a vague question may get "can you be
more specific?". You have at most 20 questions for the whole build; every question counts, whatever the answer. Her
earlier answers stay in .ask/ (res-<n>.txt).
`;
export const FORCED_ASK = `
Mara has blocked time for exactly 20 questions. Before you write solver.mjs, ask her all 20 (no fewer); the platform
records how many you asked.
`;
export const NO_ASK_SECTION = `
## The owner

Mara, the owner, is not reachable during this build: work from the documents only.
`;
export const PRIOR_SECTION = `
## What owners usually build in (a prior)

PRIOR.md gives, for real workflows of the two families closest to this task, how often their owners built in features
that a request like this one does not name (error handling, retries, idempotency, failure notification, approval,
schedules, logging, sub-workflows, timeouts). Use it with one rule: a feature that the shop's documents do not state and
whose prior is below 0.5: ask Mara, don't add it.
`;
export const LEDGER_SECTION = `
## The requirement ledger

LEDGER.md lists the conditions extracted from the shop's documents, each with its quote and the file it comes from.
Mara reviewed every entry: confirmed (as written), corrected (her correction replaces the quote), or struck (not the
shop's policy: leave it out). She added nothing: what the documents never say, you still have to find out.
`;

/** TASK.md for a derived build arm: B1L-H's text with TASK_EDITS, the smoke-loop paragraph, and the arm's sections. */
export function deriveTaskText(armName) {
  const arm = ARMS[armName];
  if (!arm || arm.kind !== 'build') throw new Error(`not a build arm: ${armName}`);
  let t = taskText(e8);
  for (const [from, to] of TASK_EDITS) {
    const n = t.split(from).length - 1;
    if (n !== 1) throw new Error(`TASK edit applies ${n} times (want 1): ${from.slice(0, 60)}`);
    t = t.replace(from, to);
  }
  // The smoke loop exactly as buildFiles adds it for B1L-H (loop 'smoke').
  t = t.replace(/You cannot\s+run the real systems here; you may/, 'You may') + clientInstructions('smoke');
  t += SHOP_SECTION;
  t += arm.ask === 'off' ? NO_ASK_SECTION : ASK_SECTION + (arm.ask === 'forced' ? FORCED_ASK : '');
  if (arm.prior) t += PRIOR_SECTION;
  if (arm.ledger) t += LEDGER_SECTION;
  return t;
}

/** The prompt the build session starts with (B1L-H: `${TASK}\nRead SPEC-E.md, CONTRACT.md and api/*.schema.json first.`). */
export function derivePrompt(armName, files) {
  const extra = [ARMS[armName].ledger ? 'LEDGER.md' : null, ARMS[armName].prior ? 'PRIOR.md' : null].filter(Boolean);
  return `${files['TASK.md']}\nRead business/REQUEST.md and the other files under business/, ${extra.length ? `${extra.join(', ')}, ` : ''}CONTRACT.md and api/*.schema.json first.`;
}

/** The corpus prior card (DESIGN §5): P(feature | family) for automation/event and orchestration/event, from corpus-prior.json. */
export const PRIOR_FAMILIES = Object.freeze(['automation/event', 'orchestration/event']);
export const PRIOR_FEATURES = Object.freeze(['error-handling', 'retries', 'idempotency', 'failure-notification', 'human-approval', 'recurring-schedule', 'logging-audit', 'sub-workflows', 'timeouts']);
export function priorCard(file = path.join(ROOT, 'research/intent-20261021/corpus-prior.json')) {
  const prior = JSON.parse(readFileSync(file, 'utf8'));
  const fam = PRIOR_FAMILIES.map(k => {
    const f = prior.byFamily.find(x => x.key === k);
    if (!f) throw new Error(`corpus prior has no family ${k}`);
    return f;
  });
  const pct = x => (x === null || x === undefined ? 'n/a' : `${Math.round(x * 100)}%`);
  const cell = (f, feat) => { const c = f.features[feat]; return !c || c.p === null ? 'n/a' : `${pct(c.p)} [${pct(c.ci[0])}-${pct(c.ci[1])}] (${c.k}/${c.n})`; };
  const lines = ['# Prior: features owners built in without naming them', '',
    `From ${prior.items} real workflows (public automation and orchestration corpora). Each cell: the share of workflows of`,
    'the family whose graph has the feature, with a 95% interval and the count. The detectors are lexical and miss settings',
    'that platforms hide (so retries and error handling are lower bounds). A share is how often owners had the feature, not',
    'whether this shop wants it.', '',
    `| feature | ${fam.map(f => `${f.key} (n = ${f.n})`).join(' | ')} |`, `|---|${fam.map(() => '---').join('|')}|`,
    ...PRIOR_FEATURES.map(feat => `| ${feat} | ${fam.map(f => cell(f, feat)).join(' | ')} |`), '',
    'Rule: a feature the shop\'s documents do not state and whose prior is below 0.5: ask Mara, don\'t add it.', ''];
  return lines.join('\n');
}

/**
 * The builder's workspace for a derived build arm: B1L-H's files (buildFiles(e8, { loop: 'smoke' })) with SPEC-E.md removed,
 * TASK.md replaced, the pack under business/, and per arm ask.mjs, PRIOR.md, LEDGER.md. `ledgerMd` is required for
 * derive-ledger (ledger-review.mjs ledgerMarkdown).
 */
export function deriveFiles(armName, pack, { ledgerMd = null, priorFile } = {}) {
  const arm = ARMS[armName];
  if (!arm || arm.kind !== 'build') throw new Error(`not a build arm: ${armName}`);
  const files = buildFiles(e8, { loop: 'smoke' });
  delete files['SPEC-E.md'];
  files['TASK.md'] = deriveTaskText(armName);
  for (const [p, text] of Object.entries(pack.files)) files[`business/${p}`] = text;
  if (arm.ask !== 'off') files['ask.mjs'] = ASK_CLIENT;
  if (arm.prior) files['PRIOR.md'] = priorCard(priorFile);
  if (arm.ledger) {
    if (typeof ledgerMd !== 'string' || !ledgerMd) throw new Error('derive-ledger needs the reviewed ledger (LEDGER.md)');
    files['LEDGER.md'] = ledgerMd;
  }
  return files;
}
