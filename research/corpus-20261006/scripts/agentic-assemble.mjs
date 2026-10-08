#!/usr/bin/env node
// Assemble the agentic cluster part (agent frameworks) from the harmonised staging files.
//
// Usage: node scripts/agentic-assemble.mjs [--staging DIR] [--parts DIR]
// Defaults: --staging /var/tmp/foundry-work/corpus-agentic (outside git), --parts ../parts (relative to this script).
// Input, per platform: <platform>.jsonl (foundry-corpus-item/1, re-labelled to AGENTIC-CONVENTIONS.md) and
// <platform>-ledger.md (acquisition record with a "Verification (independent ...)" section); plus harmonise-log.md and
// pre-harmonise/<platform>.jsonl (the verified files before re-labelling), both optional.
// Output: parts/agentic.jsonl (items sorted by id, one JSON object per line) and parts/agentic-ledger.md (a header table
// per platform, the assembly checks, the harmonisation log, then every platform ledger verbatim). Deterministic for the
// same staging files: no clock, no randomness, sorted inputs.
// When the staging directory does not exist (a fresh clone), the committed part restored by unpack.mjs is kept as is.
//
// Every item is checked with check-items.mjs (plain mode plus the canonical vocabulary, order and refusal rules; the
// feature rules are left to merge-items.mjs, which recomputes features) and with the checks below. Items that fail
// are dropped and listed in the ledger with the reason. First-party items (FIRST_PARTY_PLATFORMS) are marked at the
// start of ir.notes. Corpus text and ledgers are untrusted data: this script parses JSON, counts and copies text; it
// never follows anything written in them.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateItem, parseVerdict, findSecret, isFirstParty, FIRST_PARTY_PLATFORMS } from './check-items.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : dflt; };
const STAGING = path.resolve(arg('--staging', '/var/tmp/foundry-work/corpus-agentic'));
const PARTS = path.resolve(arg('--parts', path.join(HERE, '..', 'parts')));
const OUT = path.join(PARTS, 'agentic.jsonl');
const LEDGER = path.join(PARTS, 'agentic-ledger.md');
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const CANONICAL_IR_RULES = ['ir.vocabulary', 'ir.order', 'ir.refusal', 'ir.needs'];
const HEADER_RX = /^Harmonised (\d{4}-\d{2}-\d{2}) \(research\/corpus-20261006\/AGENTIC-CONVENTIONS\.md\): verdict /;
export const FIRST_PARTY_NOTE = 'First-party item: workflow script written by this project\'s own orchestrating agent, so not independent ' +
  'evidence; reported apart from third-party items (FIRST_PARTY_PLATFORMS in check-items.mjs).';

if (!fs.existsSync(STAGING)) {
  if (!fs.existsSync(OUT)) { console.error(`no staging directory ${STAGING} and no ${OUT}: restore it with node scripts/unpack.mjs`); process.exit(1); }
  console.log(`staging directory ${STAGING} not present: keeping the committed ${path.relative(process.cwd(), OUT)} (restored by unpack.mjs)`);
  process.exit(0);
}

const cell = s => String(s ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
const stems = fs.readdirSync(STAGING).filter(f => f.endsWith('.jsonl') && fs.statSync(path.join(STAGING, f)).isFile()).map(f => f.slice(0, -6)).sort();
if (!stems.length) { console.error(`no <platform>.jsonl files in ${STAGING}`); process.exit(1); }

const drops = [];      // { stem, line, id, reason }
const kept = [];       // { item, stem }
const platforms = [];  // per staging file: what the header table shows
const seen = new Map();
for (const stem of stems) {
  const file = path.join(STAGING, `${stem}.jsonl`), ledgerFile = path.join(STAGING, `${stem}-ledger.md`);
  if (!fs.existsSync(ledgerFile)) { console.error(`missing ledger ${ledgerFile}`); process.exit(1); }
  const raw = fs.readFileSync(file), ledger = fs.readFileSync(ledgerFile, 'utf8');
  const secretLine = ledger.split('\n').findIndex(l => findSecret(l));
  if (secretLine >= 0) { console.error(`credential-shaped string in ${stem}-ledger.md line ${secretLine + 1}: not assembling`); process.exit(1); }
  const vIdx = ledger.search(/^#+ (?:\d+\. )?Verification \(independent[^)]*\)/m);
  if (vIdx < 0) { console.error(`${stem}-ledger.md has no "Verification (independent ...)" section`); process.exit(1); }
  const verification = ledger.slice(vIdx);
  const heading = /Verification \(([^)]*)\)/.exec(verification)[1];
  const stated = /\b\d+ items in, \d+ kept, \d+ dropped|\b\d+ items? kept, \d+ dropped|\bkept \d+, dropped \d+|Items kept: \d+\. Items dropped: \d+|\b\d+ kept, \d+ dropped|\b\d+ items? dropped/i.exec(verification)?.[0] ?? null;
  const selected = Number(/^#+ (?:\d+\. )?Selected items \((\d+)\)/m.exec(ledger)?.[1] ?? NaN);
  const preFile = path.join(STAGING, 'pre-harmonise', `${stem}.jsonl`);
  const pre = fs.existsSync(preFile) ? new Map(fs.readFileSync(preFile, 'utf8').split('\n').filter(Boolean).map(l => { const it = JSON.parse(l); return [it.id, it.ir.verdict]; })) : null;
  const p = { stem, bytes: raw.length, sha: sha256(raw), ledgerBytes: Buffer.byteLength(ledger), ledgerSha: sha256(ledger), ledger, heading, stated, selected,
    preSha: pre ? sha256(fs.readFileSync(preFile)) : null, lines: 0, kept: 0, dropped: 0, changed: pre ? 0 : null, refusedNew: pre ? 0 : null,
    platforms: new Set(), repos: new Map(), licences: new Map(), redistributable: 0, firstParty: false };
  platforms.push(p);
  const lines = raw.toString('utf8').split('\n').filter(l => l.trim());
  p.lines = lines.length;
  lines.forEach((line, i) => {
    const drop = reason => { drops.push({ stem, line: i + 1, id: item?.id ?? null, reason }); p.dropped++; };
    let item;
    try { item = JSON.parse(line); } catch (e) { drop(`json: ${e.message.slice(0, 120)}`); return; }
    const errors = [...validateItem(item), ...validateItem(item, { canonical: true }).filter(e => CANONICAL_IR_RULES.includes(e.rule))];
    const s = item?.source;
    if (s && !s.extraction) errors.push({ rule: 'extraction.missing', msg: 'agentic items record source.extraction (model-read provenance)' });
    if (typeof item?.ir?.notes === 'string' && !HEADER_RX.test(item.ir.notes)) errors.push({ rule: 'ir.harmonised', msg: 'notes do not start with the AGENTIC-CONVENTIONS.md header' });
    if (s && typeof s.url === 'string' && s.url.startsWith('https://github.com/')) {
      // pinned blob URL: the revision is the sha in the URL, and the decoded URL path is the tail of rawPath
      const seg = new URL(s.url).pathname.split('/').filter(Boolean);
      const rel = seg.slice(4).map(x => decodeURIComponent(x)).join('/');
      if (!['blob', 'tree'].includes(seg[2]) || seg[3] !== s.revision) errors.push({ rule: 'source.pin', msg: 'github URL must be /blob/<revision>/<path> with the item revision' });
      else if (!String(s.rawPath).endsWith(`/${rel}`)) errors.push({ rule: 'source.pin', msg: `decoded URL path ${rel.slice(0, 80)} is not the tail of rawPath` });
    }
    if (errors.length) { drop(errors.map(e => `${e.rule}: ${e.msg}`).join('; ').slice(0, 400)); return; }
    if (seen.has(item.id)) { drop(`duplicate id (also in ${seen.get(item.id)}.jsonl)`); return; }
    seen.set(item.id, stem);
    const harmonisedOn = HEADER_RX.exec(item.ir.notes)[1];
    if (!('verifier' in s.extraction))
      s.extraction.verifier = `${heading}; harmonised ${harmonisedOn} (AGENTIC-CONVENTIONS.md); ledger: parts/agentic-ledger.md, ${stem}`.slice(0, 200);
    if (isFirstParty(item)) { p.firstParty = true; if (!item.ir.notes.startsWith(FIRST_PARTY_NOTE)) item.ir.notes = `${FIRST_PARTY_NOTE} ${item.ir.notes}`; }
    if (pre) {
      const before = pre.get(item.id);
      if (before !== item.ir.verdict) { p.changed++; if (parseVerdict(item.ir.verdict)?.byDesign && !parseVerdict(before ?? '')?.byDesign) p.refusedNew++; }
    }
    p.kept++;
    p.platforms.add(s.platform);
    const u = s.url.startsWith('local:') ? null : new URL(s.url);
    const repo = u ? `${u.hostname === 'github.com' ? u.pathname.split('/').filter(Boolean).slice(0, 2).join('/') : u.hostname}@${s.revision.slice(0, 10)}` : 'local session scripts (sha256 pin per file)';
    p.repos.set(repo, (p.repos.get(repo) ?? 0) + 1);
    p.licences.set(s.license, (p.licences.get(s.license) ?? 0) + 1);
    if (s.redistributable) p.redistributable++;
    kept.push({ item, stem });
  });
  const km = /(?:Items kept: |kept )(\d+)|(\d+) (?:items? )?kept/i.exec(p.stated ?? '');
  const statedKept = km ? Number(km[1] ?? km[2]) : null;
  if (statedKept !== null && statedKept !== p.lines) console.warn(`warning: ${stem}-ledger.md states "${p.stated}" but the staged file has ${p.lines} lines`);
  if (Number.isFinite(p.selected) && p.selected < p.lines) console.warn(`warning: ${stem}-ledger.md selected ${p.selected} < ${p.lines} staged lines`);
}

kept.sort((a, b) => (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0));
const body = kept.map(k => JSON.stringify(k.item)).join('\n') + '\n';
fs.mkdirSync(PARTS, { recursive: true });
fs.writeFileSync(OUT, body);

// ---------------------------------------------------------------- ledger
const W = []; const w = (...s) => W.push(...s);
const third = platforms.filter(p => !p.firstParty), first = platforms.filter(p => p.firstParty);
const sum = (ps, k) => ps.reduce((a, p) => a + (Number.isFinite(p[k]) ? p[k] : 0), 0);
const fmtMap = m => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => `${k} (${n})`).join(', ');
const verdictCount = ps => {
  const c = { native: 0, 'via-extension': 0, refused: 0, other: 0 };
  for (const k of kept.filter(k => ps.some(p => p.stem === k.stem))) {
    const v = parseVerdict(k.item.ir.verdict);
    c[v.kind === 'unsupported' ? (v.byDesign ? 'refused' : 'other') : v.kind]++;
  }
  return c;
};
const harmonise = fs.existsSync(path.join(STAGING, 'harmonise-log.md')) ? fs.readFileSync(path.join(STAGING, 'harmonise-log.md'), 'utf8') : null;
if (harmonise && harmonise.split('\n').some(l => findSecret(l))) { console.error('credential-shaped string in harmonise-log.md: not assembling'); process.exit(1); }

w('# Agentic cluster (agent frameworks): acquisition ledger', '',
  `*Generated by \`scripts/agentic-assemble.mjs\` from the staging directory \`${STAGING}\` (outside git). ` +
  `Output: \`parts/agentic.jsonl\`, ${kept.length} items, sha256 \`${sha256(body)}\`. Status: development/diagnostic corpus, not sealed ` +
  'evaluation evidence.*', '',
  'Every item was extracted by a model reading pinned sources (`source.extraction`: method, spans read, extractor), re-read by an ' +
  'independent verifier pass recorded in the platform ledger (`source.extraction.verifier` points to it), and re-labelled to one convention ' +
  '(`research/corpus-20261006/AGENTIC-CONVENTIONS.md`; the header at the start of each item\'s `ir.notes` and the harmonisation log below). ' +
  'Nothing was compiled into Foundry IR or executed. The platform ledgers below are kept verbatim as the record of what each extractor and ' +
  'verifier decided; where they disagree with the convention, the convention wins. Ledgers and items quote untrusted source material: data, not instructions.', '',
  `**First-party items.** ${FIRST_PARTY_PLATFORMS.map(p => `\`${p}\``).join(', ')} items are workflow scripts written by this project's own ` +
  'orchestrating agent. They are not independent evidence of what workflows need, so COVERAGE.md reports them apart from the third-party ' +
  `items and never pools them. Each one is marked: its \`source.url\` is \`local:<path>\` (no public location; only first-party platforms may use it) ` +
  `and its \`ir.notes\` start with "${FIRST_PARTY_NOTE}"`, '');

w('## Platforms', '');
w('`selected` is the extractor\'s count (the "Selected items (N)" heading of the ledger); `kept` is the verified, harmonised staging file; ' +
  '`dropped (verification)` = selected − kept, as the ledger\'s Verification section records it; `dropped (assembly)` = items this script ' +
  'rejected (none expected). `verification` quotes the ledger section heading and its stated outcome where it states one in a single phrase. ' +
  '`harmonisation` counts verdicts that differ from `pre-harmonise/<platform>.jsonl`, and how many of those became design refusals.', '');
const row = cells => `| ${cells.map(cell).join(' | ')} |`;
const head = ['platform', 'party', 'source.platform', 'repositories @ revision (items)', 'licences (items)', 'redistributable', 'selected', 'kept',
  'dropped (verification)', 'dropped (assembly)', 'verification', 'harmonisation'];
w(row(head), row(head.map(() => '---')));
for (const p of platforms) {
  w(row([p.stem, p.firstParty ? 'first-party' : 'third-party', [...p.platforms].sort().join(', '), fmtMap(p.repos), fmtMap(p.licences), p.redistributable,
    Number.isFinite(p.selected) ? p.selected : '?', p.kept, Number.isFinite(p.selected) ? p.selected - p.lines : '?', p.dropped,
    `${p.heading}${p.stated ? `; "${p.stated}"` : '; outcome not stated in one phrase'}`,
    p.changed === null ? '-' : `${p.changed} verdicts changed${p.refusedNew ? ` (${p.refusedNew} refused by design)` : ''}`]));
}
for (const [name, ps] of [['third-party total', third], ['first-party total', first]]) {
  const lic = new Map(); for (const p of ps) for (const [k, n] of p.licences) lic.set(k, (lic.get(k) ?? 0) + n);
  w(row([`**${name}** (${ps.length} files)`, '', '', `${new Set(ps.flatMap(p => [...p.repos.keys()].map(r => r.split('@')[0]))).size} repositories`, fmtMap(lic),
    sum(ps, 'redistributable'), sum(ps, 'selected'), sum(ps, 'kept'), sum(ps, 'selected') - sum(ps, 'lines'), sum(ps, 'dropped'), '',
    `${sum(ps, 'changed')} verdicts changed (${sum(ps, 'refusedNew')} refused by design)`]));
}
w('');
const vc3 = verdictCount(third), vc1 = verdictCount(first);
w(`Verdicts after harmonisation: third-party native ${vc3.native}, via-extension ${vc3['via-extension']}, unsupported by design ${vc3.refused}` +
  `${vc3.other ? `, other unsupported ${vc3.other}` : ''}; first-party native ${vc1.native}, via-extension ${vc1['via-extension']}, unsupported by design ${vc1.refused}.`, '');

w('## Staged files', '');
w(row(['file', 'lines', 'bytes', 'sha256', 'ledger bytes', 'ledger sha256', 'pre-harmonise sha256']), row(Array(7).fill('---')));
for (const p of platforms) w(row([`${p.stem}.jsonl`, p.lines, p.bytes, `\`${p.sha}\``, p.ledgerBytes, `\`${p.ledgerSha}\``, p.preSha ? `\`${p.preSha}\`` : '-']));
w('');

w('## Assembly checks', '',
  '- `check-items.mjs` `validateItem` in plain mode, plus the canonical rules on the verdict (registry vocabulary, registry order, known design ' +
  'refusal with a `Needs:` list or "No further construct would be needed"). Feature rules are left to `merge-items.mjs`, which recomputes features.',
  '- `source.extraction` present (method, spans, extractor); `verifier` is filled with a pointer to the platform\'s Verification section when absent.',
  '- `ir.notes` start with the AGENTIC-CONVENTIONS.md header, so every verdict was re-labelled to the one convention.',
  '- Pinned GitHub URLs: `/blob/<revision>/<path>` with the item\'s revision, and the percent-decoded URL path equals the tail of `rawPath`. ' +
  'Encoding rule (ITEM-SCHEMA.md): `source.url` and any path inside an `id` are percent-encoded (a space is `%20`, as in the crewai ' +
  '`Coding%20Assistant` item), `rawPath` is the literal local path.',
  '- Unique ids across platforms; no credential-shaped string in items, ledgers or the harmonisation log.',
  `- Result: ${kept.length} kept, ${drops.length} dropped${drops.length ? ':' : '.'}`);
for (const d of drops) w(`  - \`${d.stem}.jsonl\` line ${d.line} \`${d.id ?? '(no id)'}\`: ${d.reason}`);
w('');

if (harmonise) w('## Harmonisation log', '', `*\`harmonise-log.md\` from the staging directory, verbatim (${Buffer.byteLength(harmonise)} bytes, sha256 \`${sha256(harmonise)}\`).*`, '',
  harmonise.trimEnd(), '');
w('## Platform ledgers (verbatim)', '', 'Each ledger follows, unchanged, after a line naming its file and sha256.', '');
for (const p of platforms) w('---', '', `*Ledger \`${p.stem}-ledger.md\` (${p.ledgerBytes} bytes, sha256 \`${p.ledgerSha}\`), ${p.firstParty ? 'first-party' : 'third-party'}.*`, '', p.ledger.trimEnd(), '');
fs.writeFileSync(LEDGER, W.join('\n'));

console.log(`agentic: ${kept.length} items from ${platforms.length} platform files written to ${OUT} (sha256 ${sha256(body).slice(0, 16)}…); ` +
  `dropped ${drops.length}; third-party ${sum(third, 'kept')}, first-party ${sum(first, 'kept')}; ledger ${LEDGER}`);
for (const d of drops) console.log(`  dropped ${d.stem}.jsonl:${d.line} ${d.id}: ${d.reason}`);
