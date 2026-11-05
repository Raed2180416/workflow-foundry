// The BUILDER-1 evaluation pipeline end to end with a scripted model ($0): capture -> bind -> judge (T0, T2) -> prose (T1) -> score,
// on three cases (L3, W3, C3) and their 15 archived builds. Also: the frozen gold locates verbatim, and the $0 rule's recall.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Journal } from '../../../src/journal.mjs';
import { ModelPort } from '../../../src/models/port.mjs';
import { ScriptedProvider } from '../../../src/models/providers/scripted.mjs';
import { loadPolicy } from '../../../src/models/policy.mjs';
import { CAPTURE_SYSTEM, BIND_SYSTEM, captureRule } from '../../../app/core/tracker/model.mjs';
import { PROSE_SYSTEM } from '../prose.mjs';
import { stepCapture, stepBind, stepJudge, stepProse, stepScore } from '../run-builder1.mjs';
import { loadCases, wordsFor, validateGold, scoreCapture, GOLD_FILE } from '../builder1.mjs';

const ONLY = ['L3', 'W3', 'C3'];
const nul = { values: null, source: null, column: null, filterPath: null, filterOp: null, filterValue: null, itemPath: null };
const cond = (path, op, value, extra = {}) => ({ path, op, value, ...nul, ...extra });
const entry = (id, o) => ({ id, decision: 'check', why: null, question: null, template: null, channel: null, where: [], source: null, filter: [], linkItem: null, linkEffect: null, linkOp: null,
  require: [], countOp: null, n: null, windowAnchor: null, windowMin: null, windowMax: null, forbidChannel: null, forbidWhere: [], thenChannel: null, thenWhere: [], linkThen: null, ...o });
const BIND = {
  'Germany & Austria -> Lena': o => entry(o, { template: 'when-then', source: 'leads', filter: [cond('country', 'in', null, { values: ['Germany', 'Austria'] })], channel: 'email', linkItem: 'name', linkEffect: '*', linkOp: 'mentions', require: [cond('to', 'eq', 'lena@brook-tools.de')] }),
  'France -> Paul': o => entry(o, { template: 'when-then', source: 'leads', filter: [cond('country', 'eq', 'France')], channel: 'email', linkItem: 'name', linkEffect: '*', linkOp: 'mentions', require: [cond('to', 'eq', 'paul@brook-tools.de')] }),
  'Send it to our CTO, maya@brightfold.com': o => entry(o, { template: 'present', channel: 'email', where: [cond('to', 'eq', 'maya@brightfold.com')] }),
  'dont change anything': o => entry(o, { template: 'absent', channel: 'row' }),
  'send it to me at lee@harborlight.org': o => entry(o, { template: 'present', channel: 'email', where: [cond('to', 'eq', 'lee@harborlight.org')] }),
  // An address the person never wrote: the vocabulary lint drops it (an invented channel cannot even pass the enum schema).
  'Lena is lena@brook-tools.de and Paul is paul@brook-tools.de.': o => entry(o, { template: 'present', channel: 'email', where: [cond('to', 'eq', 'boss@brook-tools.de')] }),
};
function scripted() {
  const provider = new ScriptedProvider(args => {
    const usage = { inputTokens: 1000, outputTokens: 100 };
    if (args.system === CAPTURE_SYSTEM) {
      const turns = [...args.prompt.matchAll(/\[turn (\d+), [^\]]*\]\n"""\n([\s\S]*?)\n"""/g)].map(m => ({ turn: Number(m[1]), kind: 'request', text: m[2] }));
      return { value: { conditions: captureRule(turns).map(u => ({ quote: u.quote, summary: u.quote, kind: 'must', checkable: !/weekly|usual|team\./i.test(u.quote), why: null })) }, usage, costUsd: 0.001 };
    }
    if (args.system === BIND_SYSTEM) {
      const lines = args.prompt.split('\n').filter(l => /^- C-\d+: "/.test(l));
      return { value: { checks: lines.map(l => { const id = l.match(/^- (C-\d+)/)[1], q = l.match(/"(.*)" \(/)[1]; return BIND[q] ? BIND[q](id) : entry(id, { decision: 'inspection', why: 'not expressible' }); }) }, usage, costUsd: 0.002 };
    }
    if (args.system === PROSE_SYSTEM) {
      const ids = [...args.prompt.matchAll(/^- (C-\d+): /gm)].map(m => m[1]);
      return { value: { items: ids.map(id => ({ id, verdict: 'cannot-tell', why: 'x' })), ready: true }, usage, costUsd: 0.003 };
    }
    throw new Error('unexpected system');
  });
  return new ModelPort({ policy: loadPolicy().policy, providers: { 'claude-cli': provider }, journal: new Journal(new DatabaseSync(':memory:')) });
}

test('the frozen gold locates verbatim; the $0 rule covers 71 of its 80 conditions', () => {
  const gold = JSON.parse(readFileSync(GOLD_FILE, 'utf8'));
  assert.deepEqual(validateGold(gold), []);
  let covered = 0, total = 0;
  for (const c of loadCases()) { const s = scoreCapture(captureRule(wordsFor(c)), gold.cases[c.id], wordsFor(c)); covered += s.covered; total += s.gold; }
  assert.deepEqual([covered, total], [71, 80]);
});

test('pipeline at $0 on L3, W3, C3: T2 catches the L3 routing defect and the C3 / W3 no-send builds; no false alarm on verified builds', { timeout: 300_000 }, async () => {
  const out = mkdtempSync(path.join(tmpdir(), 'trk-b1-'));
  const port = scripted(), cases = loadCases().filter(c => ONLY.includes(c.id)), log = () => {};
  try {
    await stepCapture({ out, model: 'claude-haiku-5-5', samples: 1, cases, port, log });
    const bindFile = await stepBind({ out, captureFile: path.join(out, 'capture-claude-haiku-5-5-s0.json'), model: 'claude-haiku-5-5', cases, port, log });
    const bound = JSON.parse(readFileSync(bindFile, 'utf8'));
    const lena = bound.cases.L3.find(c => c.quote.startsWith('Lena is'));
    assert.equal(lena.binding.decision, 'no-check'); assert.match(lena.binding.lint[0], /boss@brook-tools.de.* is not in the person's words/); assert.equal(lena.binding.retried, true);
    const [judgeFile, judgeV2] = await stepJudge({ out, bindFile, only: ONLY, log });
    assert.equal(path.basename(judgeV2), `judge-v2-${path.basename(judgeFile).replace(/^judge-/, '')}`, 'v2 (deviation D2) is written beside the frozen v1 file');
    for (const f of [judgeFile, judgeV2]) {
      const j = JSON.parse(readFileSync(f, 'utf8'));
      const unmet = id => j.builds[id].tally.unmet;
      assert.ok(unmet('b-h-1/L3') > 0 && unmet('b-m-1/L3') > 0 && unmet('b0-h-1/L3') > 0, 'every L3 build that routes Germany/France wrongly is flagged');
      assert.equal(unmet('b-h-fix-1/L3'), 0); assert.equal(unmet('b-m-fix-1/L3'), 0);
      assert.ok(unmet('b0-h-1/W3') > 0 && unmet('b0-h-1/C3') > 0);
      assert.equal(j.builds['b0-h-1/W3'].t0.passed, false, 'T0: the W3 one-shot build fails its own practice run');
    }
    await stepProse({ out, captureFile: path.join(out, 'capture-claude-haiku-5-5-s0.json'), model: 'claude-haiku-5-5', port, only: ONLY, log });
    const s = stepScore({ out, only: ONLY });
    for (const f of [judgeFile, judgeV2]) {
      const arm = s.arms[path.basename(f)];
      assert.equal(arm.T2.falseAlarms, 0);
      assert.deepEqual(arm.T2.caughtIds.sort(), ['b-h-1/L3', 'b-m-1/L3', 'b0-h-1/C3', 'b0-h-1/L3', 'b0-h-1/W3']);
      assert.deepEqual(arm.T0.caughtIds.sort(), ['b0-h-1/C3', 'b0-h-1/W3']);
    }
    assert.equal(s.arms['prose-claude-haiku-5-5-s0__claude-haiku-5-5.json'].T1.caught, 0, 'the scripted reviewer ticks nothing unmet');
    assert.ok(s.recall['capture-rule.json'].recall > 0.9);
  } finally { rmSync(out, { recursive: true, force: true }); }
});
