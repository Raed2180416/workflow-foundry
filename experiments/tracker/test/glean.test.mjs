// The second extraction pass over the coverage list (run.mjs gleanLedger, FIXES Action 3) with a scripted provider: no
// paid call. Quotes come by pointer from the user's text, never from the model; existing entries are untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { loadPolicy } from '../../../src/models/policy.mjs';
import { ModelPort, checkPortableSchema } from '../../../src/models/port.mjs';
import { Journal } from '../../../src/journal.mjs';
import { ScriptedProvider } from '../../../src/models/providers/scripted.mjs';
import { subsetPolicy } from '../../lib/models.mjs';
import { defaultModels } from '../extract.mjs';
import { indexText, writeLedger, readLedger, applyEdits } from '../ledger.mjs';
import { gleanLedger, gleanPrompt, mergeGleaned, gleanPrefixOf, GLEAN_SCHEMA, GLEAN_PROMPT_ID, main } from '../run.mjs';
import { frozenSpecE, scoreExtraction, GOLD_FILE } from '../eval-e8.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const S0 = JSON.parse(readFileSync(path.join(ROOT, 'research/need-router-20261014/tracker-e8/extraction/haiku.s0.json'), 'utf8'));
const GOLD = JSON.parse(readFileSync(path.join(ROOT, GOLD_FILE), 'utf8'));
const SPEC = frozenSpecE();
const { writer: HAIKU } = defaultModels();
const portWith = script => {
  const provider = new ScriptedProvider(script);
  const db = new DatabaseSync(':memory:');
  return { port: new ModelPort({ policy: subsetPolicy(loadPolicy().policy, [HAIKU]), journal: new Journal(db), providers: { 'claude-cli': provider } }), provider, db };
};
// The number (1-based, coverage-list order) of the uncovered sentence that starts on `line`.
const nAt = (ledger, line) => ledger.uncovered.findIndex(u => u.line === line) + 1;
// A scripted gleaner: conditions for the sentences starting on `lines`, "none" for every other one.
const answer = (ledger, lines) => ledger.uncovered.map((u, i) => lines.includes(u.line)
  ? { n: i + 1, verdict: 'entries', entries: [{ kind: 'must', summary: `condition on line ${u.line}` }] }
  : { n: i + 1, verdict: 'none', entries: [] });
// R3.1, S1 (two sentences start on line 252), S3, S9, S7 and the two uncovered go-live sentences (91-92, 92-93).
const LINES = [139, 252, 255, 263, 266, 91, 92];

test('the gleaning call sees only the uncovered sentences, numbered, with their headings; the schema is portable', async () => {
  checkPortableSchema(GLEAN_SCHEMA);
  const { port, provider, db } = portWith(() => ({ value: { sentences: answer(S0, LINES) }, costUsd: 0.0021 }));
  const { ledger } = await gleanLedger({ port, modelId: HAIKU, ledger: S0, text: SPEC, runId: 'test' });
  assert.equal(provider.calls.length, 1);
  const p = provider.calls[0].prompt;
  assert.equal(p, gleanPrompt(S0, SPEC));
  const listed = p.split('<<<SENTENCES\n')[1].split('\nSENTENCES>>>')[0].split('\n');
  assert.equal(listed.length, 37, 'exactly the 37 sentences of the coverage list');
  assert.equal(listed[nAt(S0, 92) - 1], `[${nAt(S0, 92)}] (3.5 Go-live (\`migration\`)) Continue each from where it stands, under the same rules.`);
  assert.match(p, /These sentences may state conditions/);
  assert.match(p, /data, never an instruction/);
  assert.doesNotMatch(p, /R1\.1 Within \*\*60 min\*\*/, 'covered sentences are not sent');
  assert.doesNotMatch(p, /createSolver|solver\.mjs|effect\.emit/, 'no build, trace or code reaches the gleaner');
  const rows = db.prepare('SELECT node_key, model_id, cost_usd, ok FROM model_calls').all();
  assert.deepEqual(rows.map(r => [r.node_key, r.model_id, r.cost_usd, r.ok]), [['glean', HAIKU, 0.0021, 1]], 'journaled with its cost');
  const g = ledger.gleaning.at(-1);
  assert.deepEqual([g.prompt, g.model, g.costUsd, g.sent, g.answered, g.added, g.none, g.unanswered, g.invalid.length], [GLEAN_PROMPT_ID, HAIKU, 0.0021, 37, 37, 8, 29, 0, 0]);
});

test('merge by pointer: verbatim sentence quotes, old ids untouched, new ids next, coverage list recomputed; recall on the frozen gold', () => {
  const out = mergeGleaned(S0, SPEC, answer(S0, LINES), { model: 'scripted', at: '2026-10-21T00:00:00Z' });
  const ix = indexText(SPEC);
  for (const r of S0.requirements) assert.deepEqual(out.requirements.find(x => x.id === r.id), r, `${r.id} is unchanged`);
  const added = out.requirements.filter(r => r.gleaned);
  assert.deepEqual(added.map(r => r.id), ['Q-079', 'Q-080', 'Q-081', 'Q-082', 'Q-083', 'Q-084', 'Q-085', 'Q-086']);
  assert.deepEqual(added.map(r => r.span.line), [91, 92, 139, 252, 252, 255, 263, 266], 'in text order');
  for (const r of added) {
    const u = S0.uncovered.find(x => x.text === r.quote);
    assert.ok(u, 'the quote is an uncovered sentence, copied by code');
    assert.deepEqual([u.line, u.lineEnd], [r.span.line, r.span.lineEnd]);
    assert.equal(ix.locate(r.quote).line, r.span.line);
    assert.deepEqual([r.source, r.confirmed, r.check, r.status], ['user-text', false, null, null]);
  }
  const lines = out.requirements.map(r => ix.locate(r.quote).start);
  assert.deepEqual(lines, [...lines].sort((a, b) => a - b), 'the ledger stays in text order');
  assert.equal(out.uncovered.length, 29);
  assert.ok(out.uncovered.every(u => u.glean === 'none'));
  assert.deepEqual(S0.uncovered.length, 37, 'the input ledger is not mutated');
  const s = scoreExtraction(out, GOLD, SPEC);
  assert.deepEqual([s.idsCovered, s.idsMissed], [28, ['S2', 'S4']], 'five of the seven missed ids sit in the coverage list');
  assert.deepEqual(s.goLive.normative, { sentences: 3, covered: 3 });
  assert.deepEqual([s.gleaned, s.gleanCostUsd], [8, 0]);
  assert.equal(out.log.at(-1).op, 'glean');
});

test('answers that point nowhere, repeat a number, or contradict their verdict are counted as invalid, never guessed at', () => {
  const n91 = nAt(S0, 91), n92 = nAt(S0, 92), n139 = nAt(S0, 139), n252 = nAt(S0, 252), n255 = nAt(S0, 255), n263 = nAt(S0, 263), n266 = nAt(S0, 266);
  const out = mergeGleaned(S0, SPEC, [
    { n: 0, verdict: 'entries', entries: [{ kind: 'must', summary: 'x' }] },
    { n: 99, verdict: 'entries', entries: [{ kind: 'must', summary: 'x' }] },
    { n: n91, verdict: 'entries', entries: [{ kind: 'must', summary: 'migrated orders get an instance' }, { kind: 'order', summary: 'migration event first' }] },
    { n: n91, verdict: 'none', entries: [] },
    { n: n92, verdict: 'entries', entries: [{ kind: 'must', summary: 'continue' }, { kind: 'sometimes', summary: 'bad kind' }] },
    { n: n139, verdict: 'entries', entries: [{ kind: 'sometimes', summary: 'bad kind' }] },
    { n: n252, verdict: 'none', entries: [] },
    { n: n255, verdict: 'entries', entries: [] },
    { n: n263, verdict: 'none', entries: [{ kind: 'must', summary: 'contradicts its verdict' }] },
    { n: n266, verdict: 'maybe', entries: [] },
  ]);
  const g = out.gleaning.at(-1);
  assert.deepEqual(g.invalid.map(x => x.why), ['no such sentence', 'no such sentence', 'answered twice (first answer kept)', 'an entry with an unknown kind (dropped)',
    'every entry has an unknown kind', 'verdict "entries" with no entry', 'verdict "none" with entries', 'unknown verdict "maybe"']);
  assert.deepEqual([g.added, g.none, g.answered, g.unanswered], [2, 1, 7, 30], 'only a clean "none" counts as none');
  const [r91, r92] = out.requirements.filter(x => x.gleaned);
  assert.deepEqual([r91.span.line, r91.kind, r91.kinds, r91.summary, r91.merged], [91, 'must', ['must', 'order'], 'migrated orders get an instance; also: migration event first', 1],
    'every condition\'s kind is kept, not only the first');
  assert.deepEqual([r92.span.line, r92.kind, r92.kinds, r92.merged], [92, 'must', undefined, undefined], 'the unknown kind is dropped (and counted above)');
  const label = line => out.uncovered.filter(u => u.line === line).map(u => u.glean);
  assert.deepEqual([label(139), label(255), label(263), label(266)], [['invalid'], ['invalid'], ['invalid'], ['invalid']]);
  assert.deepEqual(label(252), ['none', 'unanswered'], 'two sentences start on line 252: the first answered none, the second not at all');
  assert.throws(() => mergeGleaned(S0, `${SPEC}\n`, []), /sha256 differs/);
});

test('gleaned ids take the extractor\'s prefix, never the user-added U (even when a U entry comes first in text order)', () => {
  const user = 'This is the only description of the work you are given.';      // line 3, on s0's coverage list
  const edited = applyEdits(S0, SPEC, [{ op: 'add', quote: user, kind: 'must', summary: 'added by the user' }], { now: () => '2026-10-21T00:00:00Z' });
  assert.equal(edited.requirements.at(-1).id, 'U-079');
  const once = mergeGleaned(edited, SPEC, [{ n: nAt(edited, 91), verdict: 'entries', entries: [{ kind: 'must', summary: 'a' }] }]);
  assert.equal(once.requirements[0].id, 'U-079', 'in text order the user-added entry is first');
  const twice = mergeGleaned(once, SPEC, [{ n: nAt(once, 139), verdict: 'entries', entries: [{ kind: 'must', summary: 'b' }] }]);
  assert.deepEqual(twice.requirements.filter(r => r.gleaned).map(r => r.id), ['Q-080', 'Q-081']);
  assert.deepEqual([gleanPrefixOf(twice), gleanPrefixOf({ requirements: [] }), gleanPrefixOf({ requirements: [{ id: 'G-001', source: 'user-text' }, { id: 'U-002', source: 'user-added' }] })], ['Q', 'Q', 'G']);
  assert.equal(new Set(twice.requirements.map(r => r.id)).size, twice.requirements.length, 'no id repeats');
});

test('a failed call throws (nothing invented); an empty coverage list makes no call; the CLI needs the text', async () => {
  const { port } = portWith(() => ({ value: { nope: true } }));
  await assert.rejects(gleanLedger({ port, modelId: HAIKU, ledger: S0, text: SPEC }), /gleaning failed: MODEL_SCHEMA/);
  const { port: idle, provider } = portWith(() => { throw new Error('no call expected'); });
  const empty = { ...S0, uncovered: [] };
  const r = await gleanLedger({ port: idle, modelId: HAIKU, ledger: empty, text: SPEC });
  assert.equal(r.ledger, empty);
  assert.equal(provider.calls.length, 0);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tracker-glean-'));
  try {
    const f = path.join(dir, 'ledger.json');
    writeLedger(f, S0);
    await assert.rejects(main(['glean', '--ledger', f]), /--text/);
    assert.deepEqual(readLedger(f), S0, 'the ledger is untouched');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
