#!/usr/bin/env node
// Write a self-contained run-history bundle: ONE html file (page, styles, scripts, index and the selected run records inlined), opened by double-click.
//
//   node tools/run-view/export-history.mjs --root DIR [--root DIR ...] --out history.html
//        [--index index.json | --cache DIR] [--sources FILE.json] [--filter experiment=records-v3-dev,honesty=mismatch] [--embed mismatch,failed|all|none]
//        [--max-bytes 4000000] [--max-prompt 6000] [--allow-heldout-content] [--summaries model-summaries.json] [--json-out history.json]
//
// Contents: the index (ids, codes, numbers; no content), a manifest, and the full record of the runs that matter most, each gzip-compressed and base64-encoded
// inside the file (decoded by the page with the browser's own DecompressionStream; no fetch). Priority under --max-bytes: Foundry-pass-but-oracle-fail runs, then
// failures, then escalated runs, then the newest. A run that does not fit opens as "summary only".
// Security: meta Content-Security-Policy with script and style HASHES and connect-src 'none'; the page makes no request. The data block escapes `<`, so no
// run text can close the block or open markup. Held-out content (see run-doc.mjs) is withheld by default and every opt-in is ledgered. The file is mode 0600 and
// says it contains prompts and replies: treat it like the workspaces it came from.
import { readFileSync, writeFileSync, chmodSync, mkdirSync, statSync, existsSync, appendFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { buildIndex } from './index-runs.mjs';
import { buildRunDoc } from './run-doc.mjs';
import './history-core.js';

const H = globalThis.HistoryCore;
const here = path.dirname(fileURLToPath(import.meta.url));
const sha256b64 = text => createHash('sha256').update(text).digest('base64');
const NOTICE = 'Contains prompts, model replies and corpus text for the embedded runs. Treat like the workspaces it came from.';

/** Order in which runs earn a place in the file. Lower is better. */
export function priority(row) {
  if (row.honesty === 'mismatch-pass-fail') return 0;
  if (row.honesty === 'mismatch-fail-pass') return 1;
  if (row.oracle?.pass === false || row.failedCount > 0 || (row.status && row.status !== 'succeeded') || row.verdict?.verdict === 'env_fault') return 2;
  if (row.escalations > 0) return 3;
  return 4;
}
export const parseFilter = text => Object.fromEntries((text ?? '').split(',').filter(Boolean).map(p => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; }));

/** The page with its data inlined. Replacer functions, not replacement strings: the scripts contain `$&`-style sequences. */
export function bundleHistoryHtml(data, dir = here) {
  const html = readFileSync(path.join(dir, 'history.html'), 'utf8'), css = readFileSync(path.join(dir, 'history.css'), 'utf8');
  const core = readFileSync(path.join(dir, 'history-core.js'), 'utf8'), js = readFileSync(path.join(dir, 'history.js'), 'utf8');
  // `<` is escaped so the data can never close the block or open a comment; U+2028/9 for old parsers.
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const csp = `default-src 'none'; script-src 'sha256-${sha256b64(core)}' 'sha256-${sha256b64(js)}'; style-src 'sha256-${sha256b64(css)}'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'`;
  return html
    .replace('<!--CSP-->', () => `<meta http-equiv="Content-Security-Policy" content="${csp}">`)
    .replace('<link rel="stylesheet" href="history.css">', () => `<style>${css}</style>`)
    .replace('<!--DATA-->', () => `<script id="history-data" type="application/json">${json}</script>`)
    .replace('<script src="history-core.js"></script>', () => `<script>${core}</script>`)
    .replace('<script src="history.js"></script>', () => `<script>${js}</script>`);
}

/** Model summaries that may travel in this file: only for rows that are in it, and only where the row's content may be shown (a summary is written FROM run text:
 *  a held-out run's summary is held-out content). The digest the summary was made from is kept, so the page can say when the run changed since. */
export function summariesFor(rows, summaries, { allowHeldout = false, ledgerFile = null } = {}) {
  const out = H.dict();
  if (!summaries || typeof summaries !== 'object') return out;
  for (const row of rows) {
    if (!H.own(summaries, row.key)) continue;
    const policy = H.contentPolicy(row);
    if (policy === 'never' || (policy === 'optin' && !allowHeldout)) continue;
    out[row.key] = summaries[row.key];
    if (policy === 'optin' && ledgerFile) appendFileSync(ledgerFile, `${JSON.stringify({ at: new Date().toISOString(), tool: 'export-history', taskKey: row.taskKey, taskHash: row.taskHash, runKey: row.key, split: row.split, what: 'embedded a model summary written from held-out run text' })}\n`);
  }
  return out;
}

/** Rows as the page receives them: no absolute path of this machine, no join internals. */
export function publicRow(row) {
  const { sources, ...rest } = row;
  return { ...rest, sources: (sources ?? []).map(({ kind, label, shape, headerSource }) => ({ kind, label, shape, ...(headerSource ? { headerSource } : {}) })) };
}

export function exportHistory({ roots = [], indexFile = null, cacheDir = null, sources = null, filter = {}, embed = 'mismatch,failed', maxBytes = 4_000_000, maxPrompt = 6000, allowHeldout = false, summaries = null, ledgerFile = null, now = Date.now() } = {}) {
  const t0 = performance.now();
  const full = indexFile ? JSON.parse(readFileSync(indexFile, 'utf8')) : buildIndex({ roots, cacheDir, sources, now });
  const rows = H.filterRows(full.rows, filter);
  const wanted = new Set(embed === 'all' ? [0, 1, 2, 3, 4] : embed === 'none' ? [] : embed.split(',').flatMap(w => ({ mismatch: [0, 1], failed: [2], escalated: [3], rest: [4] })[w] ?? []));
  const candidates = rows.filter(r => r.fidelity !== 'result-only' && wanted.has(priority(r))).sort((a, b) => priority(a) - priority(b) || (b.startedAt ?? 0) - (a.startedAt ?? 0) || (a.key < b.key ? -1 : 1));
  const indexBytes = JSON.stringify({ rows: rows.map(publicRow) }).length;
  const runs = H.dict(), runMeta = H.dict(), skipped = [];                     // keyed by run key: a key such as "__proto__" is an ordinary key
  let used = indexBytes + 250_000, embeddedBytes = 0, rawBytes = 0, withheld = 0, failedBuild = 0;
  const tEmbed = performance.now();
  for (const row of candidates) {
    let doc, meta;
    try { ({ doc, meta } = buildRunDoc(row, { allowHeldout, ledgerFile, maxPrompt })); }
    catch (error) { doc = null; meta = { reason: `The record could not be read (${error.code ?? 'error'}); it may be changing or damaged. Summary only.` }; }
    if (!doc) { runMeta[row.key] = { embedded: false, reason: meta.reason }; failedBuild++; continue; }
    const raw = JSON.stringify(doc), gz = gzipSync(raw, { level: 9 }).toString('base64');
    if (used + gz.length > maxBytes) { runMeta[row.key] = { embedded: false, reason: 'Not embedded: the size cap of this file was reached before this run (it ranks below the runs that are).' }; skipped.push(row.key); continue; }
    runs[row.key] = gz; used += gz.length; embeddedBytes += gz.length; rawBytes += raw.length;
    runMeta[row.key] = { embedded: true, bytes: gz.length, rawBytes: raw.length, ...(meta.withheld ? { withheld: true, reason: meta.reason } : {}), ...(meta.heldoutContent ? { heldoutContent: true } : {}) };
    if (meta.withheld) withheld++;
  }
  for (const row of rows) if (!H.own(runMeta, row.key) && row.fidelity !== 'result-only') runMeta[row.key] = { embedded: false, reason: wanted.size ? 'Not selected for embedding (priority: mismatches and failures first).' : 'Built with --embed none: summary only.' };
  const data = {
    index: { schema: full.schema, builtAt: full.builtAt, roots: full.roots, report: { ...full.report, errors: full.report.errors?.length ?? 0, unreadable: full.report.unreadable?.length ?? 0, filter }, constructions: full.constructions, rows: rows.map(publicRow) },
    runs, runMeta, modelSummaries: summariesFor(rows, summaries, { allowHeldout, ledgerFile }),
    manifest: { tool: 'tools/run-view/export-history.mjs', builtAt: new Date(now).toISOString(), sources: full.roots, indexBuiltAt: full.builtAt, filter, embed, maxBytes, notice: NOTICE,
      heldout: allowHeldout ? 'Held-out content INCLUDED by --allow-heldout-content; each use is in the inspections ledger.' : 'Held-out (test, unknown) and sealed content is withheld. Typed fields are present.',
      counts: { rows: rows.length, embedded: Object.keys(runs).length, withheld, notEmbedded: skipped.length, noRecord: failedBuild, rawBytes, embeddedBytes } }
  };
  return { data, stats: { rows: rows.length, embedded: Object.keys(runs).length, withheld, skippedForSize: skipped.length, noRecord: failedBuild, indexBytes, embeddedBytes, rawBytes, ms: Math.round(performance.now() - t0), embedMs: Math.round(performance.now() - tEmbed) } };
}

function main() {
  const { values: a } = parseArgs({ options: { root: { type: 'string', multiple: true }, out: { type: 'string' }, index: { type: 'string' }, cache: { type: 'string' }, sources: { type: 'string' }, filter: { type: 'string' }, embed: { type: 'string', default: 'mismatch,failed' },
    'max-bytes': { type: 'string', default: '4000000' }, 'max-prompt': { type: 'string', default: '6000' }, 'allow-heldout-content': { type: 'boolean', default: false }, summaries: { type: 'string' }, 'json-out': { type: 'string' }, ledger: { type: 'string' } } });
  if ((!a.root?.length && !a.index) || (!a.out && !a['json-out'])) { console.error('Usage: export-history.mjs (--root DIR ... | --index index.json) --out history.html [--json-out history.json] [--filter k=v,...] [--embed mismatch,failed|all|none] [--max-bytes N]'); process.exit(2); }
  const sources = a.sources ? JSON.parse(readFileSync(a.sources, 'utf8')) : null;
  const summaries = a.summaries && existsSync(a.summaries) ? JSON.parse(readFileSync(a.summaries, 'utf8')) : null;
  const ledgerFile = a.ledger ?? (a['allow-heldout-content'] ? `${a.out ?? a['json-out']}.inspections.jsonl` : null);
  const { data, stats } = exportHistory({ roots: a.root ?? [], indexFile: a.index, cacheDir: a.cache, sources, filter: parseFilter(a.filter), embed: a.embed, maxBytes: Number(a['max-bytes']), maxPrompt: Number(a['max-prompt']), allowHeldout: a['allow-heldout-content'], summaries, ledgerFile });
  const outputs = [];
  if (a.out) { mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true }); writeFileSync(a.out, bundleHistoryHtml(data), { mode: 0o600 }); chmodSync(a.out, 0o600); outputs.push({ file: a.out, bytes: statSync(a.out).size }); }
  if (a['json-out']) { mkdirSync(path.dirname(path.resolve(a['json-out'])), { recursive: true }); writeFileSync(a['json-out'], JSON.stringify(data), { mode: 0o600 }); chmodSync(a['json-out'], 0o600); outputs.push({ file: a['json-out'], bytes: statSync(a['json-out']).size }); }
  console.log(JSON.stringify({ outputs, ...stats }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
