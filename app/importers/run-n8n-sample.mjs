#!/usr/bin/env node
// Run the n8n importer on the acquired sample and write the verdicts (no workflow content beyond node types and step names).
//   node app/importers/run-n8n-sample.mjs [--acq DIR] [--out research/surface-20261021/n8n-import-results.json]
// The raw files live outside git (research/surface-20261021/n8n-sample-manifest.json, rawLocation); each is checked against its sha256 first.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { importN8n } from './n8n.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MANIFEST = path.join(root, 'research/surface-20261021/n8n-sample-manifest.json');
export const DEFAULT_ACQ = '/var/tmp/foundry-work/surface-20261021/n8n-acq';

export function runSample(acq = DEFAULT_ACQ) {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  return manifest.files.map(f => {
    const file = path.join(acq, f.repo, f.path);
    if (!existsSync(file)) return { id: f.id, missing: true };
    const bytes = readFileSync(file);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== f.sha256) return { id: f.id, shaMismatch: true };
    const report = importN8n(JSON.parse(bytes.toString('utf8')), { id: path.basename(f.path, '.json') });
    return { id: f.id, license: manifest.repos[f.repo].license, sha256, name: report.name, nodes: report.features.nodeCount, connectors: report.features.connectors,
      declaredVerdict: report.declaredVerdict, compileVerdict: report.compileVerdict, reasons: report.reasons.map(r => ({ code: r.code, steps: r.nodes })),
      needsCapabilities: report.needsCapabilities.map(c => `${c.name} (${c.effects})`), hostBindings: report.hostBindings.map(b => b.binding), sourceModels: report.sourceModels,
      loweredHash: report.workflowHash, loweredSteps: report.workflow?.nodes.length ?? 0, validation: report.validation, wrap: { via: report.wrap.via, typedInput: report.wrap.typedInput, effects: report.wrap.descriptor.effects, asksFirst: report.wrap.descriptor.requiresApproval },
      executed: false };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { acq: { type: 'string' }, out: { type: 'string' } } });
  const rows = runSample(values.acq ?? DEFAULT_ACQ);
  const count = (key, value) => rows.filter(r => r[key] === value).length;
  const reasons = {}; for (const r of rows) for (const x of r.reasons ?? []) reasons[x.code] = (reasons[x.code] ?? 0) + 1;
  const result = { schema: 'foundry-import-results/1', importer: 'app/importers/n8n.mjs', date: '2026-10-21', manifest: path.relative(root, MANIFEST),
    summary: { items: rows.length, lowered: count('compileVerdict', 'lowered'), unsupported: count('compileVerdict', 'unsupported'), wrappable: rows.filter(r => r.wrap).length,
      declaredNative: count('declaredVerdict', 'native'), executed: 0, itemsByReason: reasons },
    caveat: 'Compile-level verdicts on a 10-file deterministic sample of open-licensed n8n workflows (mostly AI-agent flows from two repositories by one author). Not representative of n8n usage; nothing was executed.',
    rows };
  const text = JSON.stringify(result, null, 2) + '\n';
  if (values.out) writeFileSync(values.out, text); else process.stdout.write(text);
}
