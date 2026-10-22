#!/usr/bin/env node
// CI-1 description leakage gates (research/ci1-20261021/DOSSIER.md §4 item 4), $0. A description is the request a builder gets; it was
// written by a describer who saw the corpus source, so it must not carry the source's surface:
//   G1 no node name of the source workflow verbatim (names of >= 2 words and >= 12 characters; generic step names are listed);
//   G2 no n8n vocabulary (node type names, "node", "n8n", expression syntax);
//   G3 not the template title, and at most 0.10 of the description's word 8-grams in the creator's own description or sticky notes.
// Corpus text is read as data only (compared, never printed beyond the matched phrase).
//   node experiments/ci1/gates.mjs [ids...]   (default: every item in SPLIT.json) -> JSON lines, exit 1 when any gate fails
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw } from './pool.mjs';
import { workflowOf } from '../../app/importers/n8n.mjs';
import { BED } from './bed.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MAX_8GRAM = 0.10;
const N8N_VOCAB = /\bn8n\b|nodes-base|\bgoogleSheets\b|\bemailSend\b|\brespondToWebhook\b|\bsplitInBatches\b|\b(?:code|function|set|if|switch|merge|filter|webhook|gmail|slack|telegram|sheets?) node\b|\{\{\s*\$|\$json|\$\(['"]/i;
const words = t => String(t ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[\p{L}\p{N}]+/gu) ?? [];
const grams = (ws, n = 8) => { const out = new Set(); for (let i = 0; i + n <= ws.length; i++) out.add(ws.slice(i, i + n).join(' ')); return out; };

export function gates(id) {
  const description = readFileSync(path.join(BED, 'items', String(id), 'description.md'), 'utf8');
  const raw = loadRaw(id), doc = raw.doc, wf = workflowOf(doc);
  const lower = description.toLowerCase(), out = { id: String(id), pass: true, fails: [] };
  const fail = (gate, what) => { out.pass = false; out.fails.push({ gate, what }); };
  for (const n of wf.nodes ?? []) {
    // a trigger's name states the schedule or the event ("Every Monday at 8am"): that is the request, not leaked structure
    if (String(n.type).endsWith('stickyNote') || /Trigger$|\.cron$|\.interval$|\.webhook$/.test(String(n.type))) continue;
    const name = String(n.name ?? '').trim();
    if (name.split(/\s+/).length >= 2 && name.length >= 12 && lower.includes(name.toLowerCase())) fail('G1 node name', name);
  }
  // literal values the request quotes and channel names are data the person names (a default id, "#n8n"), not platform vocabulary
  const prose = description.replace(/"[^"\n]*"|'[^'\n]*'/g, ' ').replace(/#[\w-]+/g, ' ');
  const m = prose.match(N8N_VOCAB); if (m) fail('G2 n8n vocabulary', m[0]);
  const title = String(doc.workflow?.name ?? '').trim();
  if (title && lower.includes(title.toLowerCase())) fail('G3 title', title);
  const creator = [doc.workflow?.description ?? '', ...(wf.nodes ?? []).filter(n => String(n.type).endsWith('stickyNote')).map(n => n.parameters?.content ?? '')].join('\n');
  const mine = grams(words(description)), theirs = grams(words(creator));
  const shared = [...mine].filter(g => theirs.has(g)).length;
  out.overlap8 = mine.size ? Math.round((shared / mine.size) * 1000) / 1000 : 0;
  if (out.overlap8 > MAX_8GRAM) fail('G3 8-gram overlap', `${out.overlap8} > ${MAX_8GRAM}`);
  out.words = words(description).length;
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const split = JSON.parse(readFileSync(path.join(here, '../../research/ci1-20261021/SPLIT.json'), 'utf8'));
  const ids = args.length ? args : [...split.dev, ...split.test];
  let bad = 0;
  for (const id of ids) { const g = gates(id); if (!g.pass) bad++; console.log(JSON.stringify(g)); }
  process.exitCode = bad ? 1 : 0;
}
