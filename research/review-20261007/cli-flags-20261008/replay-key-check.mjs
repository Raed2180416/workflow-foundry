// Do journals recorded before the childEnv change still replay? Recomputes the replay key of every claude-cli row in the given journals from
// the row's own prompt hash, decoding, sample index and salt plus the CURRENT policy/models.json (which carries the childEnv block), and counts
// the rows whose stored key it reproduces. Journals are opened read-only. Rows that do not match were recorded under an earlier policy
// (another model entry or invocation) and do not match the pre-change policy either.
//   node research/review-20261007/cli-flags-20261008/replay-key-check.mjs <journal.sqlite>... [--out file.json]
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import { loadPolicy } from '../../../src/models/policy.mjs';
import { modelDigestOf, replayKeyOf } from '../../../src/models/port.mjs';

const args = process.argv.slice(2), outAt = args.indexOf('--out'), out = outAt >= 0 ? args.splice(outAt, 2)[1] : null;
const { policy, hash } = loadPolicy(), result = { policyVersion: policy.policyVersion, policyHash: hash, childEnv: policy.providers['claude-cli'].childEnv, journals: [] };
for (const file of args) {
  const db = new DatabaseSync(file, { readOnly: true });
  const rows = db.prepare("SELECT replay_key, prompt_hash, model_id, decoding, sample_index, request FROM model_calls WHERE provider='claude-cli' ORDER BY id").all();
  let matched = 0, unknownModel = 0;
  for (const r of rows) {
    const entry = policy.models.find(m => m.id === r.model_id), salt = JSON.parse(r.request ?? '{}').salt;
    if (!entry || typeof salt !== 'string') { unknownModel++; continue; }
    const key = replayKeyOf({ promptHash: r.prompt_hash, modelId: r.model_id, modelDigest: modelDigestOf(entry, policy.providers[entry.provider]), decoding: JSON.parse(r.decoding), sampleIndex: r.sample_index, salt });
    if (key === r.replay_key) matched++;
  }
  db.close();
  result.journals.push({ file, claudeCliRows: rows.length, matched, notMatched: rows.length - matched - unknownModel, notChecked: unknownModel });
  console.log(JSON.stringify(result.journals.at(-1)));
}
if (out) writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
