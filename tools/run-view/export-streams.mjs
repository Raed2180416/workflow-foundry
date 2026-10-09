#!/usr/bin/env node
// Write the JIT streams view: a self-contained streams-export.json and, by default, ONE html file with the page, its styles, scripts and that data inlined
// (opened by double-click; it makes no request).
//
//   node tools/run-view/export-streams.mjs [--out PATH] [--json-out PATH] [--root experiments/runs/jit] [--configs experiments/jit/configs]
//        [--experiment NAME ...] [--notes-chars 1200] [--allow-heldout-notes]
//
// --out PATH   an .html path writes the page with the data inlined, and the JSON beside it as streams-export.json (or at --json-out);
//              a .json path writes the JSON only. Default: the session scratchpad's streams.html (DEFAULT_OUT below).
// Reads the stream folders only (index-streams.mjs); never writes into them. Security as export-history.mjs: a meta Content-Security-Policy with script and
// style HASHES and connect-src 'none'; the data block escapes `<` (and U+2028/9), so no text from a run can close the block or open markup. Files are mode 0600:
// they hold builder notes about the traced tasks.
import { readFileSync, writeFileSync, chmodSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { buildStreams, DEFAULT_ROOT, DEFAULT_CONFIGS } from './index-streams.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_OUT = '/tmp/claude-0/-home-user-workflow-foundry/d3c9fb19-46ab-5a0c-bfdd-4f8b7871088a/scratchpad/streams.html';
const sha256b64 = text => createHash('sha256').update(text).digest('base64');

/** The page with its data inlined. Replacer functions, not replacement strings: the scripts contain `$&`-style sequences. */
export function bundleStreamsHtml(data, dir = here) {
  const read = f => readFileSync(path.join(dir, f), 'utf8');
  const html = read('streams.html'), css1 = read('history.css'), css2 = read('streams.css'), core = read('history-core.js'), js = read('streams.js');
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/ /g, '\\u2028').replace(/ /g, '\\u2029');
  const csp = `default-src 'none'; script-src 'sha256-${sha256b64(core)}' 'sha256-${sha256b64(js)}'; style-src 'sha256-${sha256b64(css1)}' 'sha256-${sha256b64(css2)}'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'`;
  return html
    .replace('<!--CSP-->', () => `<meta http-equiv="Content-Security-Policy" content="${csp}">`)
    .replace('<link rel="stylesheet" href="history.css">', () => `<style>${css1}</style>`)
    .replace('<link rel="stylesheet" href="streams.css">', () => `<style>${css2}</style>`)
    .replace('<!--DATA-->', () => `<script id="streams-data" type="application/json">${json}</script>`)
    .replace('<script src="history-core.js"></script>', () => `<script>${core}</script>`)
    .replace('<script src="streams.js"></script>', () => `<script>${js}</script>`);
}

/** Where the files go: an .html --out writes the page and the JSON beside it; a .json --out writes the JSON only. */
export function outputsFor(out = DEFAULT_OUT, jsonOut = null) {
  const isJson = /\.json$/i.test(out);
  return { html: isJson ? null : out, json: jsonOut ?? (isJson ? out : path.join(path.dirname(out), 'streams-export.json')) };
}

export function exportStreams({ root = DEFAULT_ROOT, configsDir = DEFAULT_CONFIGS, only = null, notesChars = 1200, allowHeldoutNotes = false, out = DEFAULT_OUT, jsonOut = null, now = Date.now() } = {}) {
  const t0 = performance.now();
  const data = buildStreams({ root, configsDir, only, notesChars, allowHeldoutNotes, now });
  const files = outputsFor(out, jsonOut), outputs = [];
  const write = (file, text) => { mkdirSync(path.dirname(path.resolve(file)), { recursive: true }); writeFileSync(file, text, { mode: 0o600 }); chmodSync(file, 0o600); outputs.push({ file, bytes: statSync(file).size }); };
  write(files.json, JSON.stringify(data));
  if (files.html) write(files.html, bundleStreamsHtml(data));
  return { data, outputs, ms: Math.round(performance.now() - t0) };
}

function main() {
  const { values: a } = parseArgs({ options: { out: { type: 'string', default: DEFAULT_OUT }, 'json-out': { type: 'string' }, root: { type: 'string' }, configs: { type: 'string' }, experiment: { type: 'string', multiple: true },
    'notes-chars': { type: 'string', default: '1200' }, 'allow-heldout-notes': { type: 'boolean', default: false }, help: { type: 'boolean', default: false } } });
  if (a.help) { console.log('Usage: export-streams.mjs [--out streams.html|streams.json] [--json-out streams-export.json] [--root experiments/runs/jit] [--configs experiments/jit/configs] [--experiment NAME ...] [--notes-chars N] [--allow-heldout-notes]'); return; }
  const { data, outputs, ms } = exportStreams({ root: a.root ? path.resolve(a.root) : DEFAULT_ROOT, configsDir: a.configs ? path.resolve(a.configs) : DEFAULT_CONFIGS, only: a.experiment,
    notesChars: Number(a['notes-chars']), allowHeldoutNotes: a['allow-heldout-notes'], out: a.out, jsonOut: a['json-out'] ?? null });
  console.log(JSON.stringify({ outputs, ms, experiments: data.experiments.map(e => ({ name: e.name, arms: e.arms.length, rows: e.arms.reduce((t, x) => t + x.rows.length, 0), versions: e.arms.reduce((t, x) => t + x.versions.length, 0), error: e.error ?? null })), skipped: data.skipped }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
