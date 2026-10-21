#!/usr/bin/env node
// Corpus inversion: a bed of vague requests made from real owners' own descriptions, with the real workflow's feature
// set as latent-need truth and its oracle (where one exists) as the outcome check. $0, deterministic, no model.
//
//   node experiments/intent/inversion.mjs [--items FILE] [--json OUT] [--split dev|test --prereg FILE]
//
// Qualifying items: description.provenance 'original' (the owner's or author's own words; a 'written' description was
// generated from the graph by our normaliser and would leak the answer) and oracle.kind not 'none'.
// The request ladder is LHAW-style segment removal (EXTERNAL-BENCHMARKS.md), deterministic:
//   P0 the original description; P1 specifics genericised (URLs, code, identifiers, versions, numbers, tool names);
//   P2 constraints deleted (only goal sentences kept); P3 one line: the first goal sentence, at most 14 words.
// LHAW's empirical filter (outcome-critical / divergent / benign by agent trials) needs model runs: not run here.
// Truth per item: `latent` = detected features of the real graph not mentioned by P3; `structure` = trigger, connectors,
// effects, human steps, sub-workflows; `absent` = features the real workflow lacks (a weak negative: absence is not refusal).
// Leakage: every item carries exposure strata (popularity proxy, revision, demo boilerplate) for stratified reporting.
// Splits: dev (one third) and test (two thirds) by a salted hash of the id. Test requests are emitted only with a
// preregistration file (--prereg), so development never reads them.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashSeed } from '../../beds/lib/rng.mjs';
import { sha256 } from '../../beds/lib/canonical.mjs';
import { loadItems, ITEMS } from './corpus-prior.mjs';
import { detect, FEATURES, triggerOf, sliceOf } from './features.mjs';

export const INVERSION_VERSION = 'intent-inversion/1';

export const qualifies = it => it.description?.provenance === 'original' && (it.oracle?.kind ?? 'none') !== 'none';

/** Runnability of the item's oracle, read from its notes (offline-light < tooling < infra). */
export function runnability(it) {
  const n = it.oracle?.notes ?? '';
  if (/mocked activities|time skipping|recompile and compare|golden compiled/i.test(n)) return 'offline-light';
  if (/credential|cluster|galaxy server|not runnable offline|external resources|real external/i.test(n)) return 'infra';
  if (/container engine|docker|singularity|nextflow|planemo|cwltest|nf-test|snakemake|test-data|test yml|not run here/i.test(n)) return 'tooling';
  return 'unknown';
}

const DEMO = /^\s*(#+\s*)?(an? )?(example|sample|demo)\b|demonstrat|showcas|\bthis (dag|example|workflow|sample) (shows|demonstrates|demos)\b|\bdemos an?\b|^shows how/i;
const CONSTRAINT = /\b(must|only|should|requires?|required|prerequisite|before|after|unless|note|needs? to|make sure|ensure|see|e\.g\.|for more|topics?:)\b/i;
const TOOLS = /\b(fastqc|multiqc|trimgalore|trim galore|bowtie2?|bwa|samtools|star|salmon|kallisto|dada2|qiime2?|hifiasm|merqury|compleasm|gatk|deeptrio|deepvariant|picard|macs2|immcantation|airflow|nextflow|snakemake|galaxy|kubeflow|temporal|tekton|argo|docker|kubernetes|aws|gcp|azure|s3|bigquery|google|amazon)\b/gi;

export function genericise(text) {
  return text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s(Topics|Tags):.*$/s, '')                    // nf-core / Galaxy keyword suffixes
    .replace(/^\W*(#+\s*)*Introduction\b\s*/i, '')            // README heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')            // markdown links: keep the text
    .replace(/https?:\/\/\S+/g, '')                         // URLs
    .replace(/`{1,3}[^`]*`{1,3}/g, '')                      // code spans
    .replace(/<redacted>/g, '')
    .replace(/[*_#>]+/g, ' ')
    .replace(/\bnf-core\b|\bnextflow\b|\bsnakemake\b|\bgalaxy\b/gi, '')    // platform names
    .replace(/\b[\w.-]+\/[\w.-]+\b/g, 'a project')            // owner/repo names
    .replace(TOOLS, 'a tool')
    .replace(/\b[A-Za-z]*[a-z][A-Z]\w*\b/g, 'a component')   // CamelCase identifiers
    .replace(/\b\w+_\w+\b/g, 'a setting')                   // snake_case identifiers
    .replace(/\b[A-Z0-9]{2,}(?:-[A-Z0-9]+)*\b/g, 'X')       // acronyms and codes
    .replace(/\bv?\d+(\.\d+)+\b/g, '').replace(/\b\d+\b/g, 'some')
    .replace(/\b(a tool|a component|a setting|X)(\s*(,|and|or|\/)\s*(a tool|a component|a setting|X))+/g, '$1s')
    .replace(/\s+/g, ' ').replace(/\s([.,;:])/g, '$1').trim();
}

const sentences = t => t.split(/(?<=[.!?])\s+(?=[A-Z])/).map(s => s.trim()).filter(Boolean);

/** The request ladder P0-P3 for one item. */
export function ladder(it) {
  const P0 = it.description.text.replace(/\s+/g, ' ').trim();
  const P1 = genericise(P0);
  const goal = sentences(P1).filter(s => !CONSTRAINT.test(s));
  const P2 = goal.join(' ');
  const first = (sentences(P2)[0] ?? '').replace(/[.!?]+$/, '');
  const words = first.split(/\s+/).filter(Boolean);
  const P3 = words.length ? `Can you set up something for this: ${words.slice(0, 14).join(' ')}${words.length > 14 ? ' ...' : ''}` : '';
  const content = words.filter(w => /^[a-z]{4,}$/i.test(w) && !/^(some|tool|component|setting|this|that|with|from|using|uses|which|workflow|pipeline|example|sample)$/i.test(w));
  return { P0, P1, P2, P3, contentWords: content.length, goalSentences: goal.length };
}

/** Feature words a request mentions (stated, not latent). */
const MENTION = {
  'error-handling': /error|fail|exception|fallback|recover/i, retries: /retr(y|ies)/i, idempotency: /duplicate|dedup|idempot|once/i,
  'failure-notification': /notif|alert|e-?mail|slack|report/i, 'human-approval': /approv|review|manual|human/i,
  'recurring-schedule': /daily|hourly|weekly|schedul|cron|every|periodic/i, 'logging-audit': /log|audit|track|record/i,
  'sub-workflows': /sub-?workflow|sub-?pipeline|stage|module/i, timeouts: /timeout|deadline|time limit/i,
};

/** Who wrote the description: a pipeline owner's goal statement, or a developer's example docstring. */
export function kindOf(it) {
  const u = `${it.source.url ?? ''} ${it.id}`;
  if (/tests\/system|\/examples?\/|samples?[-_/]|\/test\/|_test\b|example_/i.test(u) || ['temporal', 'argo', 'kubeflow', 'tekton'].includes(it.source.platform)) return 'developer-example';
  return 'owner-goal';
}

/** Features present in at least `share` of a platform's corpus items: born of the platform's template, not the owner. */
export function platformDefaults(items, share = 0.8) {
  const by = new Map();
  for (const it of items) { const d = detect(it).has; const p = it.source.platform; if (!by.has(p)) by.set(p, { n: 0, k: {} }); const b = by.get(p); b.n += 1; for (const f of FEATURES) if (d[f]) b.k[f] = (b.k[f] ?? 0) + 1; }
  return Object.fromEntries([...by].map(([p, b]) => [p, FEATURES.filter(f => (b.k[f] ?? 0) / b.n >= share)]));
}

export function split(id) { return hashSeed('intent-inversion/split', id) % 3 === 0 ? 'dev' : 'test'; }

/** Exposure strata (training-data leakage proxies available offline). */
export function exposure(it) {
  const p = it.source.platform, url = it.source.url ?? '';
  const popular = /github\.com\/(apache\/airflow|nf-core\/|kubeflow\/pipelines|argoproj\/argo-workflows|temporalio\/samples|tektoncd\/pipeline|galaxyproject\/iwc)/i.test(url) || p === 'nf-core';
  return { popularRepo: popular, demo: DEMO.test(it.description.text), revision: it.source.revision ?? null, retrievedAt: it.source.retrievedAt ?? null };
}

export function invert(items) {
  const q = items.filter(qualifies);
  const defaults = platformDefaults(items);
  const rows = q.map(it => {
    const L = ladder(it), d = detect(it);
    const present = FEATURES.filter(f => d.has[f]), stated = present.filter(f => MENTION[f].test(L.P3));
    const latent = present.filter(f => !stated.includes(f));
    const kind = kindOf(it);
    const usable = L.contentWords >= 3 && L.goalSentences > 0 && !exposure(it).demo;
    return {
      id: it.id, platform: it.source.platform, slice: sliceOf(it.source.platform), oracle: it.oracle.kind, runnability: runnability(it), split: split(it.id),
      kind, usable, exposure: exposure(it), requestDigest: sha256(L.P3), ladder: L,
      truth: { latent, platformDefault: latent.filter(f => defaults[it.source.platform]?.includes(f)), ownerSpecific: latent.filter(f => !defaults[it.source.platform]?.includes(f)),
        stated, absent: FEATURES.filter(f => d.has[f] === false), notApplicable: FEATURES.filter(f => d.has[f] === null),
        structure: { trigger: triggerOf(it), connectors: it.features?.connectors ?? [], effects: it.features?.effects ?? null, humanSteps: it.features?.humanSteps ?? 0, subworkflows: it.features?.subworkflows ?? 0, nodes: it.features?.nodeCount ?? 0 },
        evidence: d.evidence },
    };
  });
  const count = (key, rs = rows) => { const m = {}; for (const r of rs) { const k = key(r); m[k] = (m[k] ?? 0) + 1; } return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1])); };
  return {
    version: INVERSION_VERSION, qualifying: rows.length,
    byPlatformOracle: count(r => `${r.platform} | ${r.oracle}`),
    byPlatform: count(r => r.platform), byOracle: count(r => r.oracle), byRunnability: count(r => r.runnability),
    usable: rows.filter(r => r.usable).length, usableByPlatform: count(r => r.platform, rows.filter(r => r.usable)),
    byKind: count(r => r.kind), usableOwnerGoal: rows.filter(r => r.usable && r.kind === 'owner-goal').length,
    usableOwnerGoalByPlatformOracle: count(r => `${r.platform} | ${r.oracle} | ${r.runnability}`, rows.filter(r => r.usable && r.kind === 'owner-goal')),
    platformDefaults: Object.fromEntries(Object.entries(defaults).filter(([p, fs]) => fs.length && rows.some(r => r.platform === p))),
    ownerSpecificLatentPerUsableItem: (() => { const u = rows.filter(r => r.usable); return u.length ? u.reduce((s, r) => s + r.truth.ownerSpecific.length, 0) / u.length : 0; })(),
    usableOfflineLight: rows.filter(r => r.usable && r.runnability === 'offline-light').length,
    demo: rows.filter(r => r.exposure.demo).length, popularRepo: rows.filter(r => r.exposure.popularRepo).length,
    bySplit: count(r => r.split), latentPerItem: rows.length ? rows.reduce((s, r) => s + r.truth.latent.length, 0) / rows.length : 0,
    rows,
  };
}

/** P0 is the item's own description (already in items.jsonl) and P1-P2 regenerate from it: the manifest keeps P3 only. */
const slimRow = r => ({ ...r, ladder: { P3: r.ladder.P3, contentWords: r.ladder.contentWords, goalSentences: r.ladder.goalSentences, P0: 'items.jsonl description.text', 'P1-P2': 'regenerate: inversion.mjs ladder()' },
  truth: { ...r.truth, evidence: undefined } });

/** The manifest written to the repository: dev rows in full, test rows without any request text. */
export function manifest(inv, { split: which = 'dev', prereg = null } = {}) {
  if (which === 'test' && !prereg) throw new Error('test-split requests need --prereg FILE (a frozen preregistration)');
  const { rows, ...summary } = inv;
  return { ...summary, emitted: which, prereg: prereg ? sha256(readFileSync(prereg, 'utf8')) : null,
    rows: rows.map(r => (r.split === which || (which === 'test' && prereg) ? slimRow(r) : { id: r.id, platform: r.platform, oracle: r.oracle, runnability: r.runnability, split: r.split, kind: r.kind, usable: r.usable, requestDigest: r.requestDigest, latentCount: r.truth.latent.length })) };
}

async function main() {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const inv = invert(loadItems(arg('--items', ITEMS)));
  const which = arg('--split', 'dev'), prereg = arg('--prereg', null);
  if (prereg && !existsSync(prereg)) throw new Error(`no prereg file ${prereg}`);
  const m = manifest(inv, { split: which, prereg });
  const { rows, ...s } = m;
  if (arg('--json')) writeFileSync(arg('--json'), `${JSON.stringify(s, null, 1).replace(/\n}$/, ',\n "rows": [\n')}${rows.map(r => `  ${JSON.stringify(r)}`).join(',\n')}\n ]\n}\n`);
  console.log(JSON.stringify(s, null, 1));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
