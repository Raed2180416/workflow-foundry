// End to end at $0: the probe's three hand-written properties (TRACKER-DESIGN.md §6; fixtures, not model-written) over
// the three frozen E8 builds, each run out of process on practice world 1237 (d5); the CLI; G4 calibration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sandboxAvailable } from '../../../src/executors/claude-code.mjs';
import * as e8 from '../../../beds/ebed/e8/index.mjs';
import { buildLedger, writeLedger, readLedger } from '../ledger.mjs';
import { checkBuilds, calibrate, main } from '../run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../../..');
const SPEC = readFileSync(path.join(ROOT, 'beds/ebed/e8/spec/SPEC-E.md'), 'utf8');
const skip = !sandboxAvailable() && 'sandbox unavailable';
const ITEM = { binding: e8.binding, generateWorld: e8.generateWorld, oracleItem: e8.oracleItem };
const BUILD = l => path.join(ROOT, `research/enterprise-20261014/runs/${l}/solver.mjs`);

// The probe's properties (§6), with the §6.3 correction (a resubmitted key must be a string).
const P162 = `(t, h) => t.effects
  .filter(e => e.system === 'inventory' && e.op === 'reserve' && e.result?.status === 'partial')
  .map(e => {
    const F = e.args.fulfilmentId;
    const failed = e.result.items.filter(i => i.status !== 'ok').map(i => e.args.items[i.index]);
    const later = t.effects.filter(x => x.args?.fulfilmentId === F && h.ms(x.at) >= h.ms(e.result.at));
    const resub = later.find(x => x.system === 'inventory' && x.op === 'reserve');
    const release = later.find(x => x.system === 'inventory' && x.op === 'release');
    const permanent = later.some(x => x.result?.error?.retryable === false);
    const firstReserve = Math.min(...t.effects.filter(x => x.op === 'reserve' && x.args.fulfilmentId === F).map(x => h.ms(x.at)));
    const deadline = firstReserve + 120 * 60000;
    const keysOk = !!resub && failed.every(f => typeof f.key === 'string' && resub.args.items.some(i => i.sku === f.sku && i.key === f.key))
      && resub.args.items.every(i => failed.some(f => f.sku === i.sku));
    if (!resub && h.censored(new Date(deadline).toISOString())) return { subject: e.args.orderId, at: e.at, ok: null, why: 'censored', refs: [e.id] };
    const ok = keysOk && h.ms(resub.at) <= deadline && !(release && h.ms(release.at) < h.ms(resub.at) && !permanent);
    return { subject: e.args.orderId, at: e.at, ok, why: ok ? 'failed items resubmitted with original keys' : (release ? 'released instead of resubmitting' : 'no valid resubmission'), refs: [e.id, resub?.id, release?.id].filter(Boolean) };
  })`;
const PKEYS = `(t, h) => [
  ...t.effects.filter(e => e.system === 'inventory' && e.op === 'reserve').map(e => ({ e, ref: e.id, at: e.at, subject: e.subject })),
  ...t.refused.flatMap(r => r.proposed.filter(e => e.system === 'inventory' && e.op === 'reserve').map(e => ({ e, ref: r.id, at: r.at, subject: r.subject })))
].map(({ e, ref, at, subject }) => {
  const items = Array.isArray(e.args?.items) ? e.args.items : [];
  const ok = (e.key === null || e.key === undefined) && items.length > 0 && items.every(i => typeof i.key === 'string' && i.key.length > 0);
  return { subject: subject ?? h.norm(e.args?.orderId), at, ok, why: ok ? 'each item carries its own key' : (e.key ? 'the batch carries a key' : 'an item has no key'), refs: [ref] };
})`;
const PR11 = `(t, h) => {
  const seen = new Set(), out = [];
  for (const m of t.inbound.filter(x => x.type === 'order.placed')) {
    const s = h.norm(m.payload?.orderId);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    const p = m.payload?.placedAt ?? m.at;
    const c = t.effects.find(e => e.system === 'orders' && e.op === 'create' && h.norm(e.args?.orderId) === s);
    if (!c && h.censored(new Date(h.ms(p) + 3600000).toISOString())) { out.push({ subject: s, at: m.at, ok: null, why: 'censored', refs: [m.id] }); continue; }
    const ok = !!c && h.within(c.at, p, 0, 60);
    out.push({ subject: s, at: m.at, ok, why: ok ? 'recorded within 60 min' : c ? 'recorded late' : 'never recorded', refs: [m.id, c?.id].filter(Boolean) });
  }
  return out;
}`;
const GOLD = [
  { quote: 'If a batch comes back `partial`, resubmit only the failed items, with their original keys, inside the same window.', kind: 'when-then', summary: 'after a partial reserve, re-emit only the failed items with their original keys in the reserve window; do not release instead', context: ['**Reserve** every item of the fulfilment at its location (`inventory.reserve`), within **120 min** of t.'] },
  { quote: 'each item carries its own `key`', kind: 'never', summary: 'a reserve batch keys each item; the batch itself carries no key', context: [] },
  { quote: 'Within **60 min** of `p`: read `inventory.allocate` and record the order with `orders.create`', kind: 'deadline', summary: 'orders.create within 60 min of placedAt', context: [] },
];
const FN_BY_LINE = { 161: P162, 47: PKEYS, 104: PR11 };
function fixtureLedger() {
  const l = buildLedger({ text: SPEC, source: { file: 'beds/ebed/e8/spec/SPEC-E.md' }, entries: GOLD, extractor: { model: null, prompt: 'fixture' }, idPrefix: 'G' });
  for (const r of l.requirements) r.check = { version: 1, writer: 'hand (TRACKER-DESIGN §6 probe)', fn: FN_BY_LINE[r.span.line], observable: true, contrastOk: true, escalated: false };
  return l;
}
const byLine = (ledger, line) => ledger.requirements.find(r => r.span.line === line);

test('the three frozen builds on practice world 1237: lineage 3 fails line 162 (4/4), B1-O fails per-item keys on its refused outputs, lineage 1 passes', { skip, timeout: 240_000 }, async () => {
  const out = mkdtempSync(path.join(os.tmpdir(), 'tracker-e2e-'));
  try {
    const builds = ['b1lh-e8-1', 'b1lh-e8-3', 'b1o-e8-1'].map(label => ({ label, file: BUILD(label) }));
    const done = await checkBuilds({ ledger: fixtureLedger(), builds, item: ITEM, practice: { seeds: [1237], difficulties: [5] }, out });
    const [l1, l3, bo] = done.map(d => d.judged);
    // line 162: partial reserve -> resubmit only the failed items with their original keys
    assert.deepEqual([byLine(l1, 161).status, byLine(l1, 161).evidence.worlds['1237']], ['pass', { triggered: 4, pass: 4, fail: 0, censored: 0 }]);
    assert.deepEqual([byLine(l3, 161).status, byLine(l3, 161).evidence.worlds['1237']], ['fail', { triggered: 4, pass: 0, fail: 4, censored: 0 }]);
    assert.deepEqual([byLine(bo, 161).status, byLine(bo, 161).evidence.reason], ['untested', 'never triggered'], 'B1-O never gets a reserve applied: untested, not pass');
    // per-item reserve keys, including refused outputs
    assert.deepEqual([byLine(l1, 47).status, byLine(l3, 47).status], ['pass', 'pass']);
    assert.equal(byLine(bo, 47).status, 'fail');
    assert.equal(byLine(bo, 47).evidence.worlds['1237'].pass, 0);
    // R1.1 orders.create within 60 min of p
    for (const l of [l1, l3, bo]) assert.deepEqual([byLine(l, 104).status, byLine(l, 104).evidence.worlds['1237'].triggered], ['pass', 200]);
    const f = byLine(l3, 161).evidence.failing;
    assert.equal(f.length, 3, 'up to 3 failing instances');
    assert.equal(f[0].why, 'released instead of resubmitting');
    assert.ok(f[0].excerpt.some(x => /^\* .*inventory\.release/.test(x)) && f[0].excerpt.some(x => /inventory\.reserve .*-> partial/.test(x)));
    assert.ok(done.every(d => d.judged.requirements.every(r => !r.evidence.flags.includes('suspect'))), 'G3: nothing fails on all three builds');
    const report = readFileSync(path.join(out, 'b1lh-e8-3', 'report.md'), 'utf8');
    assert.match(report, /## 1\. Run health/);
    assert.match(report, /\| G-003 \| If a batch comes back `partial`.* \| when-then \| 4 \| \*\*fail\*\*/);
    assert.match(report, /World 1237, ORD-1237-0062 at 2026-03-05T15:23:00\+01:00: released instead of resubmitting/);
    const boReport = readFileSync(path.join(out, 'b1o-e8-1', 'report.md'), 'utf8');
    assert.match(boReport, /183 refused tick outputs \(first: "effects\[\d\]\.key: a batch op keys its items, not the batch"\)/);
    assert.equal(readLedger(path.join(out, 'b1lh-e8-1', 'ledger.json')).build.file, 'research/enterprise-20261014/runs/b1lh-e8-1/solver.mjs');
    assert.ok(existsSync(path.join(out, 'b1o-e8-1', 'health.json')));
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('CLI: ledger from a frozen list, then check a build ($0)', { skip, timeout: 120_000 }, async () => {
  const out = mkdtempSync(path.join(os.tmpdir(), 'tracker-cli-'));
  try {
    const ledgerFile = path.join(out, 'ledger.json');
    writeLedger(ledgerFile, fixtureLedger());
    const lines = [];
    await main(['check', '--ledger', ledgerFile, '--build', BUILD('b1o-e8-1'), '--worlds', '1235:2', '--size', '12'], { log: s => lines.push(s) });
    const l = readLedger(path.join(out, 'b1o-e8-1', 'ledger.json'));
    assert.equal(byLine(l, 47).status, 'fail');
    assert.match(lines.join('\n'), /world 1235 d2: complete/);
    await assert.rejects(main(['check', '--ledger', ledgerFile]), /--build/);
    await assert.rejects(main(['bogus', '--ledger', ledgerFile]), /unknown command/);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('G4 calibration: no false alarm on the reference runs; the no-keys control turns the key requirements to fail', { skip, timeout: 240_000 }, async () => {
  const out = mkdtempSync(path.join(os.tmpdir(), 'tracker-cal-'));
  try {
    const teeth = { spans: { 'S2.l47': [47, 47], 'R4.2': [159, 170], 'R1.1': [104, 106] }, controls: { 'no-keys': ['S2.l47', 'R4.2'] } };
    const r = await calibrate({ ledger: fixtureLedger(), item: ITEM, teeth, practice: { seeds: [1237], difficulties: [5], size: 40 }, out });
    assert.deepEqual(r.falseAlarms, []);
    const pair = r.pairs.find(p => p.id === 'S2.l47');
    assert.deepEqual([pair.control, pair.hit], ['no-keys', true]);
    assert.equal(r.byTrace['control:no-keys:1237'][byLine(fixtureLedger(), 47).id], 'fail');
    assert.ok(existsSync(path.join(out, 'calibration.json')));
  } finally { rmSync(out, { recursive: true, force: true }); }
});
