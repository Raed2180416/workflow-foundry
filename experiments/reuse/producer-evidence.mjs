#!/usr/bin/env node
// The producer's evidence under the consumer's rule (review of C2-1/C2-2, finding 7; $0, post-hoc, 2026-11-04).
// The registry entry B reuses (runs/c2-1/entry-dangerous_goods.json) carries as its evidence 20/20 on the 20 SOP-Bench dev
// rows it was built and repaired on: training evidence, below M3's minimum of 60. The same artifact was later run on
// SOP-Bench's 254 sealed dangerous_goods rows (k = 3, research/sopbench-20261021/runs/p2-sealed/summary.json, read as a
// committed aggregate; no sealed row is read). This script holds the producer to the rule the consumer is held to: M3
// (stats.mjs reuseBoundRule, exact, minN 60, bound 5%) on each kind of evidence, after checking the hash chain
// entry artifact sha256 -> FREEZE-p2.json artifacts.dangerous_goods.sha256 -> sha256(FREEZE-p2.json) = summary.freezeSha256.
// Each sealed row is its own cluster (one product per row); a row counts wrong unless it passed all k runs (pass^k).
// registry.mjs is frozen by FREEZE-C2-1/C2-2 and does not change: this is a sidecar attestation, not a registry write.
//   node experiments/reuse/producer-evidence.mjs        -> research/reuse-20261021/runs/c2-1/producer-evidence.json
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { reuseBoundRule } from '../lib/stats.mjs';
import { REPO, RESEARCH, readJson, sha256, writeJson } from './lib.mjs';

export const ENTRY_FILE = path.join(RESEARCH, 'runs/c2-1/entry-dangerous_goods.json');
export const P2_FREEZE = path.join(REPO, 'research/sopbench-20261021/FREEZE-p2.json');
export const P2_SEALED_SUMMARY = path.join(REPO, 'research/sopbench-20261021/runs/p2-sealed/summary.json');
export const OUT_FILE = path.join(RESEARCH, 'runs/c2-1/producer-evidence.json');

/** M3 on `rows` independent decisions of which `wrong` were wrong (one cluster per row). */
export function m3OnRows(rows, wrong) {
  if (!Number.isInteger(rows) || !Number.isInteger(wrong) || wrong < 0 || wrong > rows) throw new Error(`m3OnRows: bad counts ${wrong}/${rows}`);
  const clusters = Array.from({ length: rows }, (_, i) => ({ parent: `row-${i}`, n: 1, wrong: i < wrong ? 1 : 0 }));
  const { decision, upper, n, nEff, minN } = reuseBoundRule(clusters, { method: 'exact' });
  return { rows, wrong, decision, upper, n, nEff, minN };
}

/** The attestation: training and sealed evidence for the entry's artifact, each under M3, with the hash chain checked. */
export function producerEvidence({ entry, freezeText, summary, sop = 'dangerous_goods' }) {
  const art = JSON.parse(freezeText).artifacts?.[sop];
  const chain = {
    entryArtifact: entry.artifact.sha256,
    freezeArtifact: art?.sha256 ?? null,
    freezeSha256: sha256(freezeText),
    summaryFreezeSha256: summary.freezeSha256,
  };
  chain.ok = chain.entryArtifact === chain.freezeArtifact && chain.freezeSha256 === chain.summaryFreezeSha256;
  if (!chain.ok) throw new Error(`producer evidence: hash chain broken ${JSON.stringify(chain)}`);
  const W = summary.analysis?.perSop?.[sop]?.W;
  if (!W) throw new Error(`producer evidence: no sealed W row for ${sop}`);
  const passed = Math.round(W.passK * W.rows);
  if (Math.abs(passed / W.rows - W.passK) > 1e-9) throw new Error('producer evidence: passK is not a count over rows');
  const ev = entry.origin.evidence;
  return {
    kind: 'c2-producer-evidence', entry: entry.id, artifactSha256: entry.artifact.sha256, chain,
    training: { what: ev.kind, heldOut: false, ...m3OnRows(ev.of, ev.of - ev.pass) },
    sealed: { what: `SOP-Bench sealed rows, workflow arm W, pass^${summary.k} (${path.relative(REPO, P2_SEALED_SUMMARY)})`, heldOut: true, k: summary.k, ...m3OnRows(W.rows, W.rows - passed) },
    reading: 'Evidence in the PRODUCER\'s program (SOP-Bench), not in B\'s: it says the artifact is right on A\'s rows, not that it is right on B\'s suppliers (C2-1: b3 let 32 of 112 accepted items through wrong).',
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = producerEvidence({ entry: readJson(ENTRY_FILE), freezeText: readFileSync(P2_FREEZE, 'utf8'), summary: readJson(P2_SEALED_SUMMARY) });
  writeJson(OUT_FILE, { ...out, generatedAt: new Date().toISOString() });
  console.log(`training ${out.training.rows - out.training.wrong}/${out.training.rows}: ${out.training.decision} (upper ${out.training.upper.toFixed(3)}); sealed ${out.sealed.rows - out.sealed.wrong}/${out.sealed.rows}: ${out.sealed.decision} (upper ${out.sealed.upper.toFixed(3)})`);
}
