// Prompts and output schemas for the gameqa-web arms. Model inputs are built only from the public design document
// (beds/gameqa-web/spec/DESIGN.md), the frontier-written template (template.json) and observations of the build; the
// hidden truth (beds/gameqa-web/truth/bugs.json) is never read here (a test asserts no flag or bug id reaches a prompt).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const SPEC = readFileSync(new URL('../../beds/gameqa-web/spec/DESIGN.md', import.meta.url), 'utf8');
export const TEMPLATE = JSON.parse(readFileSync(new URL('./template.json', import.meta.url), 'utf8'));
export const CLASSES = ['collision', 'state_desync', 'softlock', 'ui_overlap', 'score_overflow', 'input_race'];
const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 16);
export const HEURISTICS = TEMPLATE.heuristics.map(h => `- ${h}`).join('\n');

const tokenList = (max, maxItems) => ({ type: 'array', minItems: 1, maxItems, items: { type: 'string', maxLength: max } });
const REPORT = {
  type: 'object', additionalProperties: false, required: ['bug_class', 'title', 'observed', 'expected', 'seed', 'steps'],
  properties: {
    bug_class: { type: 'string', enum: CLASSES }, title: { type: 'string', maxLength: 160 },
    observed: { type: 'string', maxLength: 600 }, expected: { type: 'string', maxLength: 600 },
    seed: { type: 'integer', minimum: 1, maximum: 1000000 }, steps: tokenList(40, 120),
  },
};

// ------------------------------------------------------------------------------------------------ A1: solo agent
export const AGENT_SYSTEM = `You are a game QA tester working alone on a build of a browser game. Your job: find as many distinct bugs as you can, and report each one with the shortest token list that reproduces it from a fresh game.

The design document below says how the game is meant to work; anything the build does differently is a bug. You interact only through the test harness described in its section 9: each turn you may run one list of tokens from a fresh game with a seed of your choice, and you get back the observation after every tick. You keep your own notes between turns.

QA practice (general, not specific to this game):
${HEURISTICS}

Protocol, every turn, answer with JSON:
- notes: your working memory for the next turn (what you tried, what looked wrong, what to try next). It replaces your previous notes. At most 3000 characters.
- action: "run" to play the tokens in steps from a fresh game with seed, or "finish" when you are done.
- seed, steps: the run to play (ignored for finish). A run holds at most 120 tokens; prefer short, focused runs.
- reports: your complete current list of bug reports (it replaces the previous list; keep it up to date every turn, because when the budget runs out your last list is final). Each report: bug_class, title, observed, expected, seed, steps (the shortest tokens that reproduce the bug from a fresh game with that seed: replay it and cut it down before reporting). Report each distinct bug once.

=== DESIGN DOCUMENT ===
${SPEC}`;

export const AGENT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['notes', 'action', 'seed', 'steps', 'reports'],
  properties: {
    notes: { type: 'string', maxLength: 3000 }, action: { type: 'string', enum: ['run', 'finish'] },
    seed: { type: 'integer', minimum: 1, maximum: 1000000 }, steps: { type: 'array', maxItems: 120, items: { type: 'string', maxLength: 40 } },
    reports: { type: 'array', maxItems: 20, items: REPORT },
  },
};

export function agentTurnPrompt({ turn, maxTurns, ticksLeft, notes, history, lastRun, lastError, reports }) {
  const lines = [`Turn ${turn} of ${maxTurns}. Tick budget left: ${ticksLeft}.${turn === maxTurns ? ' This is your last turn: answer with action "finish" and your final reports.' : ''}`];
  lines.push(`\nYour notes from the last turn:\n${notes || '(none yet)'}`);
  lines.push(`\nRuns so far (${history.length}):`);
  for (const h of history.slice(-12)) lines.push(`- run ${h.n}: seed ${h.seed}, ${h.tokens} tokens [${h.steps.slice(0, 30).join(' ')}${h.steps.length > 30 ? ' ...' : ''}] -> ${h.outcome}`);
  if (history.length > 12) lines.push(`(${history.length - 12} earlier runs not listed)`);
  if (lastError) lines.push(`\nYour last answer could not be run: ${lastError}`);
  if (lastRun) lines.push(`\nTrace of your last run (seed ${lastRun.seed}; one line per tick: token -> state after the tick):\n${lastRun.text}\n\nMap after the run (@ = player, e = enemy):\n${lastRun.map}`);
  lines.push(`\nYour current reports (${reports.length}): ${reports.length ? JSON.stringify(reports.map(r => ({ bug_class: r.bug_class, title: r.title, seed: r.seed, steps: r.steps }))) : 'none'}`);
  return lines.join('\n');
}

// ------------------------------------------------------------------------------------------------ amendment A2: matched agent
// The solo agent with (1) the persona prompt's exploration wording instead of "prefer short, focused runs" (review finding
// M2: the frozen agent prompt never mentions goto and asks for short runs, the persona prompt says "reach new areas and
// states ... goto:x,y is a convenient way to walk"), (2) an append-only report log (finding M1: the frozen protocol let the
// agent drop a bug it had found by rewriting its list), and (3) restarts until it has spent what a workflow run costs
// (finding M3, run by arms.mjs runAgentMatched). The frozen AGENT_SYSTEM above is unchanged (its digest is in old metas).
export const AGENT_MATCHED_SYSTEM = `You are a game QA tester working alone on a build of a browser game. Your job: find as many distinct bugs as you can, and report each one with the shortest token list that reproduces it from a fresh game.

The design document below says how the game is meant to work; anything the build does differently is a bug. You interact only through the test harness described in its section 9: each turn you may run one list of tokens from a fresh game with a seed of your choice, and you get back the observation after every tick. You keep your own notes between turns.

Plan runs that reach new areas and states, and set up situations where a rule could break. A run holds at most 120 tokens; goto:x,y is a convenient way to walk. Different seeds change the enemies' timing.

QA practice (general, not specific to this game):
${HEURISTICS}

Protocol, every turn, answer with JSON:
- notes: your working memory for the next turn (what you tried, what looked wrong, what to try next). It replaces your previous notes. At most 3000 characters.
- action: "run" to play the tokens in steps from a fresh game with seed, or "finish" when you are done with this session.
- seed, steps: the run to play (ignored for finish).
- reports: the bug reports to file this turn: new bugs, or a shorter repro of a bug you filed. Every report you file is kept, and none can be withdrawn, so file only what you have replayed. Each report: bug_class, title, observed, expected, seed, steps (the shortest tokens that reproduce the bug from a fresh game with that seed: replay it and cut it down before filing). Leave the list empty when you have nothing new to file.

=== DESIGN DOCUMENT ===
${SPEC}`;
export const AGENT_MATCHED_SCHEMA = AGENT_SCHEMA;

export function agentMatchedTurnPrompt({ session, turn, maxTurns, ticksLeft, notes, history, lastRun, lastError, filed }) {
  const lines = [`Session ${session}, turn ${turn} of ${maxTurns}. Tick budget left: ${ticksLeft}.${turn === maxTurns ? ' This is the last turn of this session: file anything you have not filed yet.' : ''}`];
  if (session > 1 && turn === 1) lines.push('This is a fresh session: your earlier sessions ended and their notes are gone. The bugs filed so far are listed below; look for other bugs.');
  lines.push(`\nYour notes from the last turn:\n${notes || '(none yet)'}`);
  lines.push(`\nRuns so far in this session (${history.length}):`);
  for (const h of history.slice(-12)) lines.push(`- run ${h.n}: seed ${h.seed}, ${h.tokens} tokens [${h.steps.slice(0, 30).join(' ')}${h.steps.length > 30 ? ' ...' : ''}] -> ${h.outcome}`);
  if (history.length > 12) lines.push(`(${history.length - 12} earlier runs not listed)`);
  if (lastError) lines.push(`\nYour last answer could not be run: ${lastError}`);
  if (lastRun) lines.push(`\nTrace of your last run (seed ${lastRun.seed}; one line per tick: token -> state after the tick):\n${lastRun.text}\n\nMap after the run (@ = player, e = enemy):\n${lastRun.map}`);
  lines.push(`\nReports filed so far (${filed.length}): ${filed.length ? JSON.stringify(filed.map(r => ({ bug_class: r.bug_class, title: r.title, seed: r.seed, steps: r.steps }))) : 'none'}`);
  return lines.join('\n');
}

// ------------------------------------------------------------------------------------------------ A2: workflow
export const CONSTRUCT_SYSTEM = `You build the test plan for an automated QA workflow for a browser game. Code will play the plans and evaluate your checks on every tick; you never see the game directly in this step.

From the design document below, produce:
1. personas: 3 to 6 tester personas adapted to this game. Each has a name, a goal and a style (what it does, how it plays). Start from these archetypes:
${TEMPLATE.personaArchetypes.map(a => `   - ${a}`).join('\n')}
2. checks: 8 to 30 executable invariant checks covering the document's rules.

QA practice (general, not specific to this game):
${HEURISTICS}

Check language:
${TEMPLATE.checkLanguage}

Examples of checks (for a different, imaginary game):
${TEMPLATE.checkExamples.map(c => JSON.stringify(c)).join('\n')}

=== DESIGN DOCUMENT ===
${SPEC}`;

const CHECK = {
  type: 'object', additionalProperties: false, required: ['id', 'rule', 'bug_class', 'expect'],
  properties: { id: { type: 'string', maxLength: 40 }, rule: { type: 'string', maxLength: 300 }, bug_class: { type: 'string', enum: CLASSES },
    when: { type: 'string', maxLength: 600 }, expect: { type: 'string', maxLength: 600 } },
};
export const CONSTRUCT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['personas', 'checks'],
  properties: {
    personas: { type: 'array', minItems: 3, maxItems: 6, items: { type: 'object', additionalProperties: false, required: ['name', 'goal', 'style'],
      properties: { name: { type: 'string', maxLength: 40 }, goal: { type: 'string', maxLength: 300 }, style: { type: 'string', maxLength: 400 } } } },
    checks: { type: 'array', minItems: 4, maxItems: 30, items: CHECK },
  },
};
export const REPAIR_SCHEMA = { type: 'object', additionalProperties: false, required: ['checks'], properties: { checks: { type: 'array', minItems: 1, maxItems: 30, items: CHECK } } };
export const repairPrompt = rejected => `Some of your checks could not be parsed or evaluated. Rewrite each of them (same id) so that it parses in the check language, or drop it. Problems:\n${rejected.map(r => `- ${r.id}: ${r.error}\n  when: ${r.when ?? '(none)'}\n  expect: ${r.expect}`).join('\n')}`;

export const exploreSystem = persona => `You are one tester persona in an automated QA workflow for a browser game. You plan runs; code plays them from a fresh game and checks every tick against executable invariants. Your persona: ${persona.name}. Goal: ${persona.goal} Style: ${persona.style}

Plan runs that exercise what your persona cares about, reach new areas and states, and set up situations where a rule could break. Each plan: a seed and a token list (the harness tokens of section 9; at most 120 tokens; goto:x,y is a convenient way to walk). Different seeds change the enemies' timing.

QA practice (general, not specific to this game):
${HEURISTICS}

=== DESIGN DOCUMENT ===
${SPEC}`;
export const EXPLORE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['notes', 'plans'],
  properties: {
    notes: { type: 'string', maxLength: 800 },
    plans: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', additionalProperties: false, required: ['seed', 'steps', 'purpose'],
      properties: { seed: { type: 'integer', minimum: 1, maximum: 1000000 }, steps: tokenList(40, 120), purpose: { type: 'string', maxLength: 200 } } } },
  },
};
export function explorePrompt({ round, rounds, notes, coverage, violations, lastRuns, lastError }) {
  const lines = [`Round ${round} of ${rounds}.`, `Your notes from the last round: ${notes || '(none yet)'}`,
    `Shared coverage so far (all personas): ${coverage.tiles} distinct player tiles; events seen: ${coverage.events.join(', ') || 'none'}; modes: ${coverage.modes.join(', ') || 'none'}; dialogs: ${coverage.dialogs.join(', ') || 'none'}.`,
    `Checks already violated somewhere (no need to chase these again): ${violations.length ? violations.join('; ') : 'none yet'}.`];
  if (lastError) lines.push(`Problem with your last plans: ${lastError}`);
  for (const r of lastRuns ?? []) lines.push(`\nYour plan "${r.purpose}" (seed ${r.seed}) played like this:\n${r.text}\nMap after it:\n${r.map}`);
  lines.push('\nAnswer with your notes for the next round and 1 to 3 new plans.');
  return lines.join('\n');
}

export const JUDGE_SYSTEM = `You review candidate bugs found by an automated QA workflow for a browser game. Each candidate is an executable check that was violated, with the shortest token list that still violates it (found by delta debugging) and the trace of that replay. A check can be wrong: it may misread the design document, forget an exception, or flag behaviour the document marks "by design". Decide for each candidate whether the trace shows the build breaking the design document. If it does, give the bug class, a short title, what was observed and what the document requires.

=== DESIGN DOCUMENT ===
${SPEC}`;
export const JUDGE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['verdicts'],
  properties: { verdicts: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false,
    required: ['candidate', 'is_bug', 'bug_class', 'title', 'observed', 'expected'],
    properties: { candidate: { type: 'integer', minimum: 0, maximum: 99 }, is_bug: { type: 'boolean' }, bug_class: { type: 'string', enum: CLASSES },
      title: { type: 'string', maxLength: 160 }, observed: { type: 'string', maxLength: 600 }, expected: { type: 'string', maxLength: 600 } } } } },
};
export const judgePrompt = cands => cands.map(c => `--- candidate ${c.n} ---\n${c.checks.map(k => `Check: ${k.id}: ${k.rule}\n${k.when ? `  when: ${k.when}\n` : ''}${k.expect ? `  expect: ${k.expect}\n` : ''}  violated at tick ${k.step}`).join('\n')}\nMinimized repro: seed ${c.seed}, tokens ${JSON.stringify(c.steps)}\nTrace of the replay:\n${c.trace}`).join('\n\n') + '\n\nAnswer with one verdict per candidate.';

export const promptDigests = () => ({ agentSystem: sha(AGENT_SYSTEM), agentMatchedSystem: sha(AGENT_MATCHED_SYSTEM), constructSystem: sha(CONSTRUCT_SYSTEM), judgeSystem: sha(JUDGE_SYSTEM),
  exploreSystem: sha(exploreSystem({ name: '', goal: '', style: '' })), spec: sha(SPEC), template: sha(JSON.stringify(TEMPLATE)) });
