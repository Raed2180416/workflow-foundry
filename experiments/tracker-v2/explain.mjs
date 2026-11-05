#!/usr/bin/env node
// Analyst tool (no model call): for BUILDER-1 builds and one bind file, print the person's words, every condition with its check in
// plain words and as JSON, then every check's activations per practice view with the first violations (and, with --effects, every
// effect of every view). Used to root-cause each alarm (RESULT-TRACKER.md §5).
//   node experiments/tracker-v2/explain.mjs --bind research/tracker-20261021/builder1/bind-....json --build b-h-1/L1 [--build b0-h-1/I3] [--effects] [--json]
//   --heldout: the held-out set (research/tracker-20261021/heldout; builds named as run-heldout.mjs names them, e.g. b0-h/HS1, control/HC1-0)
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderCheck, evaluate } from '../../app/core/tracker/checks.mjs';
import { practiceWorkspace, practiceViews } from '../../app/core/tracker/practice.mjs';
import { scenarioRows } from '../../app/core/tracker/scenarios.mjs';
import { judgeViews } from '../../app/core/tracker/index.mjs';
import { prepareCheck } from '../../app/core/tracker/semantics.mjs';
import { loadCases, wordsFor, archivedBuilds } from './builder1.mjs';

const { values: a } = parseArgs({ options: { bind: { type: 'string' }, build: { type: 'string', multiple: true }, effects: { type: 'boolean' }, json: { type: 'boolean' }, cond: { type: 'string' }, semantics: { type: 'string' }, heldout: { type: 'boolean' } } });
const sem = a.semantics ?? 'v1';
const bound = JSON.parse(readFileSync(path.resolve(a.bind), 'utf8'));
const held = a.heldout ? { ...(await import('./heldout/cases.mjs')), ...(await import('./heldout/run-heldout.mjs')) } : null;
const cases = Object.fromEntries((held ? held.loadHeldout() : loadCases()).map(c => [c.id, c]));
const builds = held ? held.heldoutBuilds() : archivedBuilds();
const practice = practiceWorkspace();
let shown = null;
for (const id of a.build ?? []) {
  const b = builds.find(x => x.id === id);
  if (!b) { console.log(`no build ${id}`); continue; }
  const c = cases[b.case];
  const conds = (bound.cases[c.id] ?? []).filter(x => !a.cond || x.id === a.cond);
  if (shown !== c.id) {
    shown = c.id;
    console.log(`\n== ${c.id} (${c.template})`);
    for (const w of wordsFor(c)) console.log(`[turn ${w.turn} ${w.kind}${w.question ? ` ${w.question}` : ''}] ${w.text}`);
    for (const x of conds) {
      console.log(`${x.id} [${x.verification}${x.binding ? ` / ${x.binding.decision}` : ''}] "${x.quote}"`);
      if (x.check) { console.log(`   ${renderCheck(x.check)}`); if (a.json) console.log(`   ${JSON.stringify(x.check)}`); }
      else if (x.why) console.log(`   why: ${x.why}`);
    }
  }
  const checks = conds.map(x => x.check).filter(Boolean);
  const { views } = await practiceViews(b.workflow, { practice, scenarioRows: base => scenarioRows(checks, base, { semantics: sem }), repeat: true });
  console.log(`## ${id} verified=${b.verified} oracle: ${b.reasons.slice(0, 3).join(' | ').slice(0, 300)} views=${views.map(v => `${v.id}:${v.effects.length}`).join(' ')}`);
  for (const x of conds.filter(x => x.check)) for (const v of views) {
    const r = evaluate(prepareCheck(x.check, { quote: x.quote, words: wordsFor(c), semantics: sem }), v, { semantics: sem });
    const bad = r.instances.filter(i => i.ok === false);
    console.log(`   ${x.id} @${v.id}: activated ${r.activated} decided ${r.decided} violated ${r.violated}${bad.length ? ` :: ${bad.slice(0, 2).map(i => `${i.item?.id ?? ''} ${i.why}`).join(' | ')}` : ''}`);
  }
  // The statuses as judgeViews gives them (this build's views only, so no G3 and the gate sees one build).
  const st = judgeViews(conds.map(x => ({ ...x, version: 1 })), views, { semantics: sem, words: wordsFor(c) });
  for (const [cid, x] of Object.entries(st)) {
    if (x.status === 'unknown' && !['needs-answer', 'check-suspect'].includes(x.reason)) continue;
    console.log(`   => ${cid} ${x.status}${x.reason ? ` (${x.reason})` : ''}${x.flags?.length ? ` [${x.flags.join(',')}]` : ''}${x.questions ? ` Q: ${x.questions[0]}` : ''} :: ${(x.evidence ?? []).slice(0, 2).map(e => `${e.item?.id ?? ''} ${e.why}`).join(' | ').slice(0, 300)}`);
  }
  if (a.effects) for (const v of views) {
    console.log(`   -- effects @${v.id}`);
    for (const e of v.effects) console.log(`      ${e.id} ${e.channel} ${JSON.stringify(e.fields).slice(0, 400)}`);
  }
}
