// D20 evidence ($0, read-only): what each owner option does to the recorded heal evidence.
//   (a)  re-freeze: the kit's policy of record becomes the live owner file;
//   (a') re-freeze only what blocks: the record with the owner's class budgets and without defaultsByRole;
//   (b') D20 as implemented: the record is unchanged; defaultsByRole proved unread, the budgets proved inside the owner envelope.
// For every recorded model call of the C0-dev and P1 journals it recomputes the replay key (kit src/models/port.mjs replayKeyOf,
// modelDigestOf) under each candidate policy of record and counts how many still equal the recorded key (a call whose key changes
// can no longer be replayed: REPLAY_MISS), and it reports the policy hash each option would give the runs. It also lists the
// recorded contexts the record's class budgets refused or truncated (the calls whose prompt a raised budget would change).
//   node experiments/heal/d20-proof.mjs [--out research/heal-20261008/d20-proof.json]
import path from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { REPO, KIT_DIR, policyDrift, kitSourceTexts } from './kit.mjs';

const imp = rel => import(pathToFileURL(path.join(KIT_DIR, rel)).href);
const { replayKeyOf, modelDigestOf } = await imp('src/models/port.mjs');
const { digest } = await imp('src/data.mjs');

export function candidates() {
  const record = JSON.parse(readFileSync(path.join(KIT_DIR, 'policy/models.json'), 'utf8'));
  const owner = JSON.parse(readFileSync(path.join(REPO, 'policy/models.json'), 'utf8'));
  const aPrime = structuredClone(record);
  aPrime.inputBudgetTokensByClass = structuredClone(owner.inputBudgetTokensByClass);
  delete aPrime.defaultsByRole;
  return { record, owner, options: { "(b') D20: record unchanged": record, '(a) re-freeze to the owner file': owner, "(a') re-freeze budgets + defaultsByRole only": aPrime } };
}

function keysUnder(policy, rows) {
  let same = 0, changed = 0, unknownModel = 0;
  for (const r of rows) {
    const entry = policy.models.find(m => m.id === r.model_id);
    if (!entry) { unknownModel++; continue; }
    const req = JSON.parse(r.request ?? '{}');
    const key = replayKeyOf({ promptHash: r.prompt_hash, modelId: r.model_id, modelDigest: modelDigestOf(entry, policy.providers[entry.provider]), decoding: JSON.parse(r.decoding ?? 'null'), sampleIndex: r.sample_index, salt: req.salt ?? null });
    if (key === r.replay_key) same++; else changed++;
  }
  return { same, changed, unknownModel };
}

export function proof() {
  const { record, owner, options } = candidates();
  const journals = { 'c0-dev': 'experiments/runs/c0-dev/journal.sqlite', p1: 'experiments/runs/p1/journal.sqlite' };
  const out = { drift: policyDrift(owner, record, { kitSources: kitSourceTexts(KIT_DIR) }), journals: {}, options: {} };
  for (const [name, file] of Object.entries(journals)) {
    const db = new DatabaseSync(path.join(REPO, file), { readOnly: true });
    const rows = db.prepare('SELECT replay_key, model_id, decoding, sample_index, prompt_hash, request, receipt_hash FROM model_calls WHERE request IS NOT NULL').all()
      .filter(r => { try { const q = JSON.parse(r.request); return !q.replayOf && !q.heal; } catch { return false; } });
    // Recorded refusals by a class budget (the kit's CONTEXT_OVERFLOW).
    const overflow = db.prepare("SELECT COUNT(*) n FROM model_calls WHERE error_code='CONTEXT_OVERFLOW'").get().n;
    // Truncations (review m3, 2026-11-04). The receipt's per-input `truncated` flags are not journaled here (model_calls keeps
    // only receipt_hash), but every compiled call's request keeps its system and prompt. The kit truncates only down to the
    // budget (src/context.mjs:116-123: shrink until bytes(system)+bytes(prompt) <= 4 x maxInputTokens), so a call truncated by
    // its class budget sits at ~100% of it. Count the compiled calls at >= 98% of the record's class budget for their model.
    const est = q => Math.ceil((Buffer.byteLength(q.system ?? '') + Buffer.byteLength(q.prompt ?? '')) / 4);
    let compiled = 0, atCap = 0, maxShare = 0, maxAt = null;
    for (const r of rows.filter(x => x.receipt_hash)) {
      const entry = record.models.find(m => m.id === r.model_id), cap = record.inputBudgetTokensByClass?.[entry?.class];
      if (!cap) continue;
      compiled += 1;
      const share = est(JSON.parse(r.request)) / cap;
      if (share >= 0.98) atCap += 1;
      if (share > maxShare) { maxShare = share; maxAt = { model: r.model_id, class: entry.class, cap, estTokens: est(JSON.parse(r.request)) }; }
    }
    db.close();
    out.journals[name] = { calls: rows.length, contextOverflowRows: overflow, compiledCalls: compiled, compiledCallsAtClassCap: atCap, maxShareOfClassCap: Math.round(maxShare * 1000) / 1000, maxShareAt: maxAt };
    for (const [opt, pol] of Object.entries(options)) (out.options[opt] ??= { policyHash: digest(pol).slice(0, 16), byJournal: {} }).byJournal[name] = keysUnder(pol, rows);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const p = proof();
  const out = arg('--out', path.join(REPO, 'research/heal-20261008/d20-proof.json'));
  writeFileSync(out, JSON.stringify(p, null, 1));
  console.log(JSON.stringify({ blocking: p.drift.blocking, journals: p.journals, options: p.options }, null, 1));
}
