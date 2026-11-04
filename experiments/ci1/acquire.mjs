// CI-1 S1: grow the executable n8n pool by a TARGETED fetch (research/ci1-20261021/DOSSIER.md §6 S1).
//
// The local search index (/opt/corpus/n8n/index.json, the n8n.io template search API snapshot of 2026-10-06) lists each template's
// integration node types, so a template that needs a model, an agent, an HTTP call or a connector we have no stand-in for can be
// dropped BEFORE downloading. We fetch only free templates whose listed types are all simulable, newest first (the post-cutoff stratum
// matters most for memorisation), and record every response in a ledger (URL, sha256 of the raw bytes, size, dates, terms, outcome).
//
// Raw responses are untrusted data, stored gzip-compressed OUTSIDE git (n8n.io terms: local research use; never redistributed).
// Only the ledger (ids, digests, dates, outcomes) is committed. Usage (network; low rate, one request at a time):
//   NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node experiments/ci1/acquire.mjs --limit 420
import { readFileSync, writeFileSync, existsSync, readdirSync, appendFileSync, mkdirSync, statfsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const RAW_DIR = '/var/tmp/foundry-work/ci1-20261021/n8n/workflows';
export const LOCAL_DIR = '/opt/corpus/n8n/workflows';
export const INDEX = '/opt/corpus/n8n/index.json';
export const LEDGER = path.join(here, '../../research/ci1-20261021/acquisition/ledger.jsonl');
export const API = 'https://api.n8n.io/api/templates/workflows/';
export const TERMS = 'n8n.io template library (api.n8n.io); n8n terms of service and each template\'s own terms; local research use only, raw JSON never committed or redistributed';
export const CUTOFF = '2026-07-01';
// Integration node types n8n-sim can stand in for (experiments/ci1/sim/nodes.mjs). The index lists integrations, not core nodes; core
// nodes the simulator lacks are caught after download by the admission census (experiments/ci1/pool.mjs).
export const SIMULABLE = new Set(('manualTrigger scheduleTrigger cron webhook formTrigger set if switch filter merge code function functionItem splitOut ' +
  'aggregate itemLists sort limit removeDuplicates dateTime noOp stickyNote splitInBatches wait respondToWebhook summarize renameKeys compareDatasets ' +
  'emailSend gmail gmailTrigger googleSheets googleSheetsTrigger slack telegram telegramTrigger discord stopAndError start interval markdown html crypto ' +
  'dateTimeV2 emailReadImap').split(' '));
const base = t => t.split('.').pop();
export const fits = w => !w.price && w.types.length > 0 && w.types.every(t => !t.includes('langchain') && SIMULABLE.has(base(t)));

export function candidates({ index = JSON.parse(readFileSync(INDEX, 'utf8')), local = new Set(readdirSync(LOCAL_DIR).map(f => f.replace('.json.gz', ''))) } = {}) {
  const fit = Object.values(index).filter(fits);
  const ntypes = w => w.types.filter(t => !/stickyNote/.test(t)).length;
  // Newest first within post-cutoff; then the rest by integration breadth (a richer flow is likelier to be non-trivial), id as tie-break.
  const post = fit.filter(w => (w.createdAt ?? '') >= CUTOFF).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || a.id - b.id);
  const pre = fit.filter(w => (w.createdAt ?? '') < CUTOFF).sort((a, b) => ntypes(b) - ntypes(a) || (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || a.id - b.id);
  return { fit: fit.length, local: fit.filter(w => local.has(String(w.id))).map(w => w.id), toFetch: [...post, ...pre].filter(w => !local.has(String(w.id))) };
}

async function main() {
  const limit = Number(process.argv[process.argv.indexOf('--limit') + 1] || 0) || 420;
  mkdirSync(RAW_DIR, { recursive: true });
  const { fit, local, toFetch } = candidates();
  const done = new Set(existsSync(LEDGER) ? readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).id) : []);
  console.log(`fit ${fit}, already local ${local.length}, to fetch ${toFetch.length}, ledgered ${done.size}, limit ${limit}`);
  let n = 0;
  for (const w of toFetch) {
    if (n >= limit) break;
    if (done.has(w.id)) { n++; continue; }
    const free = statfsSync('/'); if (free.bavail * free.bsize < 1.3e9) { console.log('STOP: under 1.3 GB free'); break; }
    const url = `${API}${w.id}`, fetchedAt = new Date().toISOString();
    let row;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'workflow-foundry-corpus/2026-10-21 (research; low rate)' }, signal: AbortSignal.timeout(60000) });
      const raw = Buffer.from(await r.arrayBuffer());
      if (r.status !== 200) row = { id: w.id, url, fetchedAt, outcome: `http-${r.status}` };
      else {
        writeFileSync(path.join(RAW_DIR, `${w.id}.json.gz`), gzipSync(raw));
        row = { id: w.id, url, fetchedAt, outcome: 'ok', bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex'), createdAt: w.createdAt ?? null, terms: TERMS };
      }
    } catch (e) { row = { id: w.id, url, fetchedAt, outcome: `error:${String(e.cause?.code ?? e.name)}` }; }
    appendFileSync(LEDGER, `${JSON.stringify(row)}\n`);
    n++;
    await new Promise(r => setTimeout(r, 600));
  }
  console.log('done', n);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
