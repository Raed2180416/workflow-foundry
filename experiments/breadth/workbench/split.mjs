// WorkBench frozen held-out split (research/breadth-20261021/PLAN.md §4.3 T1-1, §8.2; PREREG-BREADTH v0 §5).
//
// THE RULE IS FIXED BY THE COMMIT THAT ADDS THIS FILE (the "split-rule commit"); the salt comes from a later commit
// that this file's author does not choose:
//   salt = the full 40-hex SHA of the first commit on refs/heads/claude/intelligent-hamilton-vg1f9a whose subject
//          starts with "WIP: running agents' changes" (the orchestrator's autosave) and whose committer timestamp is
//          strictly later than the split-rule commit's committer timestamp.
// Population: the 69 templates (690 shipped instances, 10 per template) of WorkBench @49c7dfd0, pinned by the sha256
// of their sorted ids. A template id is `<domain>/<first 10 hex of sha256(base_template)>` (bed.py template_id).
// Order: within each domain, ascending hex of sha256(utf8(salt + template_id)). The first round(0.42 · n_domain) are
// dev (29 in all), the rest held out (40).
// Sealed: 3 instances per held-out template, plus 1 more per held-out multi_domain template (132 when 12 multi_domain
// templates are held out). Instances come from WorkBench's own generators with seed 8850 (H2-ext: shipped world,
// regenerated task parameters) when seed control verifies (seed 42 reproduces the shipped CSVs byte for byte; the same
// seed twice gives identical output) and regeneration changes the answers (below); otherwise from the shipped
// instances of held-out templates (H4), chosen by ascending sha256(salt + instance id).
// H2-ext selection: per held-out template, the regenerated instances in generator order, skipping any whose task text
// equals a shipped task text of that template or whose gold does not replay cleanly; the first k are taken; seeds
// 8851..8859 top up a template that runs short. An instance is "answer-changed" when its gold action list equals no
// shipped gold list of its template. The bed is H2-ext when at least 80% of sealed instances are answer-changed; a
// template is labelled H2-ext when at least 2 of its sealed instances are answer-changed, else H4.
// Sealed content stays host-only (outside the repository); only the manifest's sha256 is committed.
import { createHash } from 'node:crypto';

export const SPLIT_RULE = Object.freeze({
  version: 'wb-split-v1',
  bed: 'WorkBench @49c7dfd00c03d384ec59ea57374f50b766aa5613',
  population: Object.freeze({ templates: 69, instances: 690, perTemplate: 10,
    templateIdsSha256: '9c34e59eb95cd47b2d4733eb142916276ca72a3a39f9dd337d2ef4fbb7b0ce2b',
    instanceIdsSha256: 'b40a81683b39c70761205f4ea63a4dc074635829b371f69e2d92e774f4bb1762' }),
  saltSource: Object.freeze({ ref: 'refs/heads/claude/intelligent-hamilton-vg1f9a', subjectPrefix: "WIP: running agents' changes", after: 'split-rule commit (committer timestamp, strict)' }),
  devShare: 0.42,
  expected: Object.freeze({ dev: 29, heldOut: 40 }),
  sealed: Object.freeze({ perHeldOutTemplate: 3, extraPerHeldOutMultiDomain: 1, seed: 8850, topUpSeeds: Object.freeze([8851, 8852, 8853, 8854, 8855, 8856, 8857, 8858, 8859]),
    h2ExtBedShare: 0.8, h2ExtTemplateMin: 2 }),
});

const sha256 = s => createHash('sha256').update(s, 'utf8').digest('hex');
export const templateIdsSha256 = ids => sha256([...ids].sort().join('\n'));
export const domainOf = templateId => templateId.split('/')[0];

/** Split the template ids with the given salt. Returns { dev, heldOut, order } (order: per domain, ranked). */
export function splitTemplates(templateIds, salt) {
  if (!/^[0-9a-f]{40}$/.test(String(salt))) throw new Error('salt must be a 40-hex commit SHA');
  const ids = [...new Set(templateIds)].sort();
  if (ids.length !== SPLIT_RULE.population.templates) throw new Error(`expected ${SPLIT_RULE.population.templates} templates, got ${ids.length}`);
  if (templateIdsSha256(ids) !== SPLIT_RULE.population.templateIdsSha256) throw new Error('the template population differs from the pinned one');
  const byDomain = new Map();
  for (const id of ids) { const d = domainOf(id); if (!byDomain.has(d)) byDomain.set(d, []); byDomain.get(d).push(id); }
  const dev = [], heldOut = [], order = {};
  for (const d of [...byDomain.keys()].sort()) {
    const ranked = byDomain.get(d).map(id => ({ id, key: sha256(salt + id) })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const k = Math.round(SPLIT_RULE.devShare * ranked.length);
    order[d] = ranked.map(r => r.id);
    dev.push(...ranked.slice(0, k).map(r => r.id));
    heldOut.push(...ranked.slice(k).map(r => r.id));
  }
  return { dev: dev.sort(), heldOut: heldOut.sort(), order };
}

/** The sealed quota per held-out template. */
export const sealedQuota = templateId => SPLIT_RULE.sealed.perHeldOutTemplate + (domainOf(templateId) === 'multi_domain' ? SPLIT_RULE.sealed.extraPerHeldOutMultiDomain : 0);

/** H4 fallback: shipped instances of a held-out template chosen by ascending sha256(salt + instance id). */
export function shippedSealedPick(instanceIds, templateId, salt) {
  return [...instanceIds].map(id => ({ id, key: sha256(salt + id) })).sort((a, b) => (a.key < b.key ? -1 : 1)).slice(0, sealedQuota(templateId)).map(r => r.id);
}

/** The salt: from `git log` lines "<sha> <committer epoch> <subject>" of the salt ref (newest first), the earliest
 * autosave strictly after the rule commit's committer epoch. null when none has landed yet. */
export function pickSalt(logLines, ruleEpoch) {
  const rows = logLines.map(l => /^([0-9a-f]{40}) (\d+) (.*)$/.exec(l)).filter(Boolean).map(m => ({ sha: m[1], epoch: Number(m[2]), subject: m[3] }));
  const cands = rows.filter(r => r.epoch > ruleEpoch && r.subject.startsWith(SPLIT_RULE.saltSource.subjectPrefix)).sort((a, b) => a.epoch - b.epoch);
  return cands[0] ?? null;
}
