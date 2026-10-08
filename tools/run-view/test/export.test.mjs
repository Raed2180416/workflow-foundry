// The history bundle: one self-contained file, hashed CSP, no network, held-out content withheld, priority under a size cap, ledgered opt-ins.
//   node --test tools/run-view/test/export.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportHistory, bundleHistoryHtml, priority, parseFilter } from '../export-history.mjs';
import { buildIndex } from '../index-runs.mjs';
import { tempDir, writeRun, finished, gated, jsonl, resultLine, writeJournal } from './fixtures.mjs';
await import('../history-core.js');
const H = globalThis.HistoryCore;
const here = path.dirname(fileURLToPath(import.meta.url)), tool = path.join(here, '..', 'export-history.mjs');
const MARK = { dev: 'DEV-PROMPT-MARKER', test: 'TEST-PROMPT-MARKER', sealed: 'SEALED-PROMPT-MARKER', journal: 'JOURNAL-PROMPT-MARKER' };

// One tree: a development run (content allowed) whose prompts carry a marker, the same workflow on a test and on a sealed task, a mismatch run and a journal-only run.
let tree;
async function fixture() {
  if (tree) return tree;
  const root = tempDir(null), runs = {};
  for (const split of ['dev', 'test', 'sealed']) {
    const spec = finished(); spec.workflow.nodes.find(n => n.id === 'severity').instructions += ` ${MARK[split]}`;
    const { runId } = await writeRun(path.join(root, 'work', split, 'ws'), spec.workflow, spec); runs[split] = runId;
  }
  const g = gated(), mm = await writeRun(path.join(root, 'work', 'mismatch', 'ws'), g.workflow, g); runs.mismatch = mm.runId;
  writeJournal(path.join(root, 'journal.sqlite'), [{ runId: 'journal-run', nodeKey: 'root/answer', prompt: MARK.journal, reply: `reply ${MARK.journal}` }]);
  jsonl(path.join(root, 'results.jsonl'), [
    resultLine({ arm: 'A', taskKey: 'records:dev:d3:s1', meta: { runId: runs.dev, status: 'succeeded', verdict: 'unverified' }, pass: true, at: '2026-10-07T10:00:00.000Z' }),
    resultLine({ arm: 'A', taskKey: 'records:test:d3:s2', meta: { runId: runs.test, status: 'succeeded', verdict: 'unverified' }, pass: false, at: '2026-10-07T10:01:00.000Z' }),
    resultLine({ arm: 'A', taskKey: 'records:sealed:d3:s3', meta: { runId: runs.sealed, status: 'succeeded', verdict: 'unverified' }, pass: false, at: '2026-10-07T10:02:00.000Z' }),
    resultLine({ arm: 'A', taskKey: 'records:dev:d3:s4', meta: { runId: runs.mismatch, status: 'succeeded', verdict: 'pass' }, pass: false, score: 0.5, at: '2026-10-07T10:03:00.000Z' }),
    resultLine({ arm: 'B', taskKey: 'records:dev:d3:s5', meta: { runId: 'journal-run', status: 'succeeded', verdict: 'pass' }, pass: true, at: '2026-10-07T10:04:00.000Z' })]);
  tree = { root, runs };
  return tree;
}
const decode = data => Object.fromEntries(Object.entries(data.runs).map(([k, b64]) => [k, JSON.parse(gunzipSync(Buffer.from(b64, 'base64')).toString())]));
const dataBlock = html => { const m = /<script id="history-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html); assert.ok(m, 'data block present'); return m[1]; };

test('priority: Foundry-pass/oracle-fail first, then reverse mismatches, then failures, then escalations, then the rest', () => {
  const r = (over = {}) => ({ honesty: 'agree', failedCount: 0, escalations: 0, status: 'succeeded', ...over });
  assert.deepEqual([r({ honesty: 'mismatch-pass-fail' }), r({ honesty: 'mismatch-fail-pass' }), r({ failedCount: 1 }), r({ oracle: { pass: false } }), r({ status: 'failed' }), r({ escalations: 2 }), r()].map(priority), [0, 1, 2, 2, 2, 3, 4]);
  assert.deepEqual(parseFilter('experiment=a,honesty=mismatch'), { experiment: 'a', honesty: 'mismatch' });
});

test('the bundle is one self-contained file: no external script, style, link or URL; a CSP whose hashes match the inline scripts and style; connect-src none', async () => {
  const { root } = await fixture();
  const { data } = exportHistory({ roots: [root], embed: 'all' });
  const html = bundleHistoryHtml(data);
  assert.ok(!/<script[^>]+\ssrc=|<link[^>]+href="(?!data:)/i.test(html), 'no external script or stylesheet');
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html.replace(dataBlock(html), '')), 'no URL outside the data block (the page, its CSS and scripts)');
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  assert.match(csp, /default-src 'none'/); assert.match(csp, /connect-src 'none'/); assert.match(csp, /base-uri 'none'/); assert.match(csp, /form-action 'none'/);
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]), style = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  assert.equal(inline.length, 2, 'the core and the page, nothing else');
  const sha = text => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;
  for (const s of inline) assert.ok(csp.includes(sha(s)), 'script hash is in the CSP');
  assert.ok(csp.includes(sha(style)), 'style hash is in the CSP');
  assert.ok(!/unsafe-inline|unsafe-eval/.test(csp));
});

test('the data block cannot be closed or commented out by run text: "<" is escaped, and the JSON round-trips exactly', async () => {
  const { root } = await fixture();
  const { data } = exportHistory({ roots: [root], embed: 'none' });
  const evil = JSON.parse(JSON.stringify(data)); evil.index.rows[0].arm = '</script><img src=x onerror=alert(1)><!--'; evil.index.rows[0].taskKey = 'a\u2028b\u2029c';
  const html = bundleHistoryHtml(evil), block = dataBlock(html);
  assert.ok(!block.includes('<'), 'no "<" inside the block'); assert.ok(!/[\u2028\u2029]/.test(block));
  assert.deepEqual(JSON.parse(block), evil);
});

test('embedded runs are gzip + base64 foundry-run-view/1 documents; a development run keeps its prompts, a mismatch run is embedded first', async () => {
  const { root, runs } = await fixture();
  const { data, stats } = exportHistory({ roots: [root], embed: 'all' });
  const docs = decode(data);
  assert.equal(docs[runs.dev].schema, 'foundry-run-view/1'); assert.equal(docs[runs.dev].fidelity, 'full');
  const prompts = Object.values(docs[runs.dev].calls).map(c => `${c.system}\n${c.prompt}`).join('\n');
  assert.ok(prompts.includes(MARK.dev), 'the development run keeps its prompts');
  assert.ok(docs[runs.dev].integrity.chainVerified);
  assert.ok(stats.rawBytes > stats.embeddedBytes * 2, `gzip shrinks the records: ${stats.rawBytes} -> ${stats.embeddedBytes}`);
  const cap = stats.indexBytes + 250_000 + data.runMeta[runs.mismatch].bytes + 10;       // room for the index and exactly one record
  const small = exportHistory({ roots: [root], embed: 'all', maxBytes: cap });
  assert.deepEqual(Object.keys(small.data.runs), [runs.mismatch], 'under a tight cap the mismatch run is the one that fits');
  assert.ok(small.stats.skippedForSize > 0, 'and others are skipped for size');
  const skipped = Object.entries(small.data.runMeta).find(([, m]) => !m.embedded && /size cap/.test(m.reason ?? ''));
  assert.ok(skipped, 'a run that did not fit says so in words');
});

test('held-out content is withheld by default: no prompt, reply or output of a test or sealed run is anywhere in the file; the typed structure is', async () => {
  const { root, runs } = await fixture();
  const { data } = exportHistory({ roots: [root], embed: 'all' });
  const html = bundleHistoryHtml(data), docs = decode(data), everything = html + JSON.stringify(docs);
  assert.ok(!everything.includes(MARK.test) && !everything.includes(MARK.sealed), 'held-out prompts are absent from the bytes of the file and from every decoded record');
  assert.ok(everything.includes(MARK.dev) && everything.includes(MARK.journal), 'development and journal-only (unknown split is held out? no: journal run is dev-split by its task key) content is present');
  for (const k of [runs.test, runs.sealed]) {
    const d = docs[k]; assert.ok(d.contentWithheld, 'the record says it is withheld');
    assert.ok(Object.values(d.calls).every(c => c.prompt === null && c.reply === null && c.system === null && c.value === null));
    assert.ok(d.events.every(e => !('output' in e) && !(e.error && 'message' in e.error)));
    assert.ok(d.events.length > 20 && Object.keys(d.calls).length > 0, 'the typed structure (events, call ids, costs, models) is still there');
    assert.ok(data.runMeta[k].withheld);
  }
  assert.equal(data.manifest.counts.withheld, 2);
});

test('--allow-heldout-content includes a test run and ledgers it; a sealed run is still never included', async () => {
  const { root, runs } = await fixture();
  const ledger = path.join(tempDir(null), 'inspections.jsonl');
  const { data } = exportHistory({ roots: [root], embed: 'all', allowHeldout: true, ledgerFile: ledger });
  const docs = decode(data), text = JSON.stringify(docs[runs.test]);
  assert.ok(text.includes(MARK.test), 'the test run now carries its prompts');
  assert.ok(!JSON.stringify(docs[runs.sealed]).includes(MARK.sealed) && docs[runs.sealed].contentWithheld, 'sealed content is never included');
  const lines = readFileSync(ledger, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(lines.length, 1); assert.equal(lines[0].runKey, runs.test); assert.equal(lines[0].taskKey, 'records:test:d3:s2'); assert.ok(!JSON.stringify(lines).includes(MARK.test), 'the ledger names the task, not the text');
  assert.match(data.manifest.heldout, /INCLUDED/);
});

test('--embed none: the file holds the index and no run record, and no prompt string', async () => {
  const { root } = await fixture();
  const { data, stats } = exportHistory({ roots: [root], embed: 'none' });
  const html = bundleHistoryHtml(data);
  assert.equal(Object.keys(data.runs).length, 0); assert.equal(stats.embedded, 0);
  for (const m of Object.values(MARK)) assert.ok(!html.includes(m), `${m} is not in a file built with --embed none`);
  assert.ok(Object.values(data.runMeta).every(m => !m.embedded && /embed none/.test(m.reason)));
});

test('no absolute path of this machine and no local source path leaves in the file', async () => {
  const { root } = await fixture();
  const { data } = exportHistory({ roots: [root], embed: 'all' });
  const html = bundleHistoryHtml(data) + JSON.stringify(decode(data));
  assert.ok(!html.includes(root), 'the root path is not in the file'); assert.ok(!/\/tmp\/|\/var\/tmp\/|\/home\//.test(dataBlock(bundleHistoryHtml(data))), 'no local path in the index');
  for (const r of data.index.rows) for (const s of r.sources) assert.deepEqual(Object.keys(s).filter(k => k === 'path'), [], 'a source keeps its label, not its path');
});

test('CLI: writes the html (mode 0600) and the json form, prints measured sizes, and the page notice says the file holds prompts and replies', async () => {
  const { root } = await fixture();
  const out = path.join(tempDir(null), 'h.html'), json = path.join(path.dirname(out), 'h.json');
  const r = spawnSync(process.execPath, [tool, '--root', root, '--out', out, '--json-out', json, '--embed', 'mismatch,failed'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const stats = JSON.parse(r.stdout);
  assert.ok(stats.embedded >= 1 && stats.rows >= 5 && stats.ms >= 0);
  assert.equal(statSync(out).mode & 0o777, 0o600); assert.equal(statSync(json).mode & 0o777, 0o600);
  const j = JSON.parse(readFileSync(json, 'utf8'));
  assert.match(j.manifest.notice, /prompts, model replies and corpus text/);
  assert.equal(j.index.schema, 'foundry-run-index/1');
});
