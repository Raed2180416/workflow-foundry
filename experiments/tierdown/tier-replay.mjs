#!/usr/bin/env node
// Node-level tier replay (A10 / #42; dossier §4 item 2): the archived requests of the chosen judge sites, re-asked of
// cheaper tiers, scored against the archived (reference-tier) answers on decision leaves only.
//
// Tiers:
//   claude-haiku-5-5, mercury-3   by explicit id through ModelPort (experiments/lib/models.mjs createModelPort with
//                                 allowedModels; mercury-3 needs a hard run token cap, --mercury-tokens). One request per
//                                 decision, decoding {reasoning: 'none'} as the solvers asked. Paid (Haiku list price) or
//                                 token-capped (Mercury, D18).
//   rule                          experiments/tierdown/rules/index.mjs: code written from the CALIBRATION slice only, which
//                                 abstains on any input it does not recognise (abstention falls back to the reference).
//   memo                          an identical earlier request (same system, prompt and schema) anywhere in the archive's
//                                 delivery journals answers at $0; otherwise it abstains.
// Jev (jev-1.13.0) is a listed tier for enum leaves, but this session has no FOUNDRY_SYSTEMONE_API_KEY: it is refused up
// front, never silently skipped (the result records the refusal).
//
// The slice (C calibration / H held-out) comes from the frozen preregistration (PREREG-TIERDOWN.json, sha256 checked).
// Requests: each faithful archived compiled answer of the slice is replayed at $0 (replay.mjs) to list its judge
// decisions; a decision of a target site is re-asked with the exact system/prompt/schema of its archived journal row.
// Output: one JSON line per (row, decision, tier) in --out (resumable: lines already there are not re-asked):
//   {row, taskKey, slice, site, name, key, tier, refModels, refCostUsd, ok, abstain, value, error, costUsd, latencyMs,
//    inputTokens, outputTokens, agreement, exact}
// agreement = tolerant decision-leaf agreement with the reference value (tierdown.mjs decisionAgreement, compare.mjs
// tolerance relTol 0.01); exact = the decision leaves are identical.
//
//   node experiments/tierdown/tier-replay.mjs --prereg research/tierdown-20261021/PREREG-TIERDOWN.json --expect-sha <hex>
//        --slice C|H --tiers claude-haiku-5-5,mercury-3,rule,memo [--sites records/rules,...] --leverage <leverage.json>
//        --out <answers.jsonl> [--cap-usd 2] [--mercury-tokens 400000] [--concurrency 2] [--runs DIR] [--dry]
import path from 'node:path';
import os from 'node:os';
import { readFileSync, appendFileSync, existsSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { listArms, journalOf, rowId, sha256, DEFAULT_RUNS } from './archive.mjs';
import { replayRow } from './replay.mjs';
import { requestKeyOf, canonical } from './override.mjs';
import { siteIdOf, pool } from './leverage.mjs';
import { decisionAgreement, stripEvidence } from '../jit/tierdown.mjs';
import { tolerance } from '../jit/compare.mjs';
import { phaseOf } from './archive.mjs';

export const MODEL_TIERS = Object.freeze(['claude-haiku-5-5', 'mercury-3']);
export const ALL_TIERS = Object.freeze([...MODEL_TIERS, 'rule', 'memo', 'jev-1.13.0']);
export const TOL = tolerance({ relTol: 0.01, absTol: 1e-9 });
export const agreementOf = (ref, cand) => decisionAgreement(ref, cand, TOL);
export const exactOf = (ref, cand) => canonical(stripEvidence(ref)) === canonical(stripEvidence(cand));

// The preregistered split: a task is in the held-out slice H iff the first hex digit of
// sha256('tierdown-20261021/split\0' + taskKey) is >= 8 (every arm's run of one task lands in the same slice).
export const sliceOf = taskKey => (parseInt(sha256(`tierdown-20261021/split\0${taskKey}`)[0], 16) >= 8 ? 'H' : 'C');

export function loadPrereg(file, expectSha = null) {
  const text = readFileSync(file, 'utf8'), sha = sha256(text);
  if (expectSha && sha !== expectSha) throw new Error(`prereg ${file}: sha256 ${sha} is not the frozen ${expectSha}`);
  return { prereg: JSON.parse(text), sha };
}

// Every archived request (delivery phase) of an arm by request key, with its answer.
export function requestIndex(arm) {
  const out = new Map();
  for (const j of journalOf(arm)) {
    const body = j.request?.body;
    if (!body || typeof body.prompt !== 'string') continue;
    const key = requestKeyOf({ system: body.system, prompt: body.prompt, schema: body.schema });
    if (!out.has(key)) out.set(key, { system: body.system ?? '', prompt: body.prompt, schema: body.schema, rows: [] });
    out.get(key).rows.push({ model: j.modelId, ok: !!j.ok, value: j.response?.body?.value, costUsd: j.costUsd ?? 0, phase: phaseOf(String(j.runId)), latencyMs: j.latencyMs ?? null });
  }
  return out;
}

// memo tier: every delivery-phase request of every arm of the family, seen BEFORE this row's own run (an identical
// request from an earlier task); the arm's own row is excluded by run id prefix.
export function memoAnswer(index, key, { exclude }) {
  const hit = index.get(key)?.rows.find(r => r.ok && r.phase === 'delivery' && !exclude(r));
  return hit ? { ok: true, value: hit.value } : { abstain: 'no identical earlier request' };
}

const done = file => new Set((existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []).map(l => { const r = JSON.parse(l); return `${r.row}\0${r.key}\0${r.tier}`; }));

async function main() {
  const args = process.argv.slice(2), opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; }, flag = n => args.includes(n);
  const { prereg, sha } = loadPrereg(opt('--prereg'), opt('--expect-sha'));
  const slice = opt('--slice'); if (!['C', 'H'].includes(slice)) throw new Error('--slice C|H');
  const tiers = (opt('--tiers') ?? '').split(',').filter(Boolean);
  for (const t of tiers) if (!ALL_TIERS.includes(t)) throw new Error(`unknown tier ${t}`);
  if (tiers.includes('jev-1.13.0') && !process.env.FOUNDRY_SYSTEMONE_API_KEY) throw new Error('tier jev-1.13.0 refused: FOUNDRY_SYSTEMONE_API_KEY is not provisioned in this session');
  const sites = (opt('--sites') ?? prereg.sites.map(s => s.site).join(',')).split(',');
  const out = opt('--out'), capUsd = Number(opt('--cap-usd', 2)), mercuryTokens = Number(opt('--mercury-tokens', 400000)), concurrency = Number(opt('--concurrency', 2));
  const lev = JSON.parse(readFileSync(opt('--leverage'), 'utf8'));
  const faithful = new Set(lev.rows.filter(r => r.status === 'screened').map(r => r.id));
  const arms = listArms({ runs: opt('--runs', DEFAULT_RUNS), experiments: prereg.experiments });
  const jobs = arms.flatMap(arm => arm.rows.filter(row => faithful.has(rowId(arm, row)) && sliceOf(row.taskKey) === slice).map(row => ({ arm, row })));
  const already = done(out);
  console.error(`prereg ${sha.slice(0, 12)}; slice ${slice}: ${jobs.length} faithful rows; tiers ${tiers.join(',')}; sites ${sites.join(',')}; ${already.size} answers already in ${out}`);
  let rules = {};
  if (tiers.includes('rule')) rules = (await import('./rules/index.mjs')).RULES;
  const modelTiers = tiers.filter(t => MODEL_TIERS.includes(t));
  let port = null, db = null, tokens = () => ({});
  if (modelTiers.length && !flag('--dry')) {
    const { createModelPort } = await import('../lib/models.mjs');
    mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    ({ port, db, tokens } = createModelPort({ journalFile: path.resolve(out).replace(/\.jsonl$/, '') + '.journal.sqlite', allowedModels: modelTiers,
      ...(modelTiers.includes('mercury-3') ? { tokenCap: mercuryTokens } : {}), timeoutMs: 300000 }));
  }
  let spent = 0, calls = 0, refusedByCap = 0;
  const work = mkdtempSync(path.join(os.tmpdir(), 'tierdown-tr-')), indexes = new Map();
  const indexOf = arm => { if (!indexes.has(arm.dir)) indexes.set(arm.dir, requestIndex(arm)); return indexes.get(arm.dir); };
  // memo: the family's delivery requests of OTHER tasks (any arm), earlier by seed.
  const familyIndex = new Map();
  for (const arm of arms) {
    const fi = familyIndex.get(arm.family) ?? new Map();
    for (const [k, v] of indexOf(arm)) { if (!fi.has(k)) fi.set(k, { ...v, rows: [] }); fi.get(k).rows.push(...v.rows.map(r => ({ ...r, arm: arm.slug }))); }
    familyIndex.set(arm.family, fi);
  }
  try {
    await pool(jobs, concurrency, async ({ arm, row }) => {
      const id = rowId(arm, row), base = await replayRow({ arm, row, flowPath: arm.flows.hooked, work });
      const seen = new Set();
      for (const j of base.judges) {
        const site = siteIdOf(arm.family, j.name);
        if (!sites.includes(site) || !j.key || seen.has(j.key)) continue;
        seen.add(j.key);
        const req = indexOf(arm).get(j.key);
        const refCalls = base.calls.filter(c => c.key === j.key);
        const common = { row: id, taskKey: row.taskKey, slice, site, name: j.name, key: j.key, refModels: [...new Set(refCalls.map(c => c.modelId))], refCostUsd: refCalls.reduce((s, c) => s + (c.origCostUsd ?? 0), 0),
          refLatencyMs: refCalls.reduce((s, c) => s + (c.origLatencyMs ?? 0), 0) };
        for (const tier of tiers) {
          if (already.has(`${id}\0${j.key}\0${tier}`)) continue;
          let rec;
          if (!req) rec = { ok: false, error: 'request not in the arm journal' };
          else if (tier === 'rule') {
            const fn = rules[site];
            const t0 = Date.now();
            let r;
            try { r = fn ? fn({ system: req.system, prompt: req.prompt, schema: req.schema }) : { abstain: 'no rule for this site' }; } catch (e) { r = { abstain: `rule threw: ${String(e.message ?? e).slice(0, 200)}` }; }
            rec = r.abstain ? { ok: false, abstain: r.abstain, costUsd: 0, latencyMs: Date.now() - t0 } : { ok: true, value: r.value, costUsd: 0, latencyMs: Date.now() - t0 };
          } else if (tier === 'memo') {
            const r = memoAnswer(familyIndex.get(arm.family), j.key, { exclude: x => x.arm === arm.slug });
            rec = r.abstain ? { ok: false, abstain: r.abstain, costUsd: 0, latencyMs: 0 } : { ok: true, value: r.value, costUsd: 0, latencyMs: 0 };
          } else if (flag('--dry')) rec = { ok: false, error: 'dry run' };
          else if (tier === 'claude-haiku-5-5' && spent >= capUsd) { refusedByCap++; continue; }
          else {
            calls++;
            const r = await port.call({ runId: `tierdown:${prereg.id}:${slice}`, nodeKey: `tier-replay/${site}/${tier}/${id}/${j.key.slice(0, 16)}`, attempt: 0, modelId: tier,
              system: req.system, prompt: req.prompt, schema: req.schema, decoding: { reasoning: 'none' } }).catch(e => ({ ok: false, error: { code: e.code ?? 'ERROR', message: String(e.message ?? e).slice(0, 300) } }));
            spent += r.costUsd ?? 0;
            rec = { ok: !!r.ok, value: r.ok ? r.value : undefined, error: r.ok ? null : r.error, costUsd: r.costUsd ?? 0, latencyMs: r.latencyMs ?? null,
              inputTokens: r.usage?.inputTokens ?? null, outputTokens: r.usage?.outputTokens ?? null, cacheReadTokens: r.usage?.cacheReadTokens ?? null };
          }
          if (rec.ok) { rec.agreement = agreementOf(j.value, rec.value); rec.exact = exactOf(j.value, rec.value); }
          appendFileSync(out, JSON.stringify({ ...common, tier, ...rec }) + '\n');
        }
      }
    });
  } finally {
    db?.close(); rmSync(work, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ prereg: sha, slice, rows: jobs.length, calls, spentUsd: Math.round(spent * 1e6) / 1e6, capUsd, refusedByCap, tokens: tokens() }));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e.stack ?? e); process.exit(1); });
