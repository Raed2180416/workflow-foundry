// Compact, text-free digest of live heal-run records (ids, codes, counts, dollars; never task text or prompts).
//   node experiments/heal/summarise-live.mjs experiments/heal/runs/live-20261008/rec.json [more.json ...]
import { readFileSync } from 'node:fs';

for (const file of process.argv.slice(2)) {
  const o = JSON.parse(readFileSync(file, 'utf8'));
  const line = (...a) => console.log(a.join(' '));
  line(`===== ${o.campaign?.incident ?? o.incident} (${file.split('/').pop()}) wall ${Math.round((o.wallMs ?? o.ms ?? 0) / 1000)}s  spend $${o.budget?.spentUsd}  cap $${o.budget?.capUsd}`);
  line('trial', o.trial?.key, 'score', o.trial?.score, 'fidelity', o.fidelity?.identical);
  line('signals', JSON.stringify(o.signals), 'lint', JSON.stringify(o.lint?.counts));
  line('class', o.classification?.class, JSON.stringify(o.classification?.reasons), 'variance', JSON.stringify(o.variance && { n: o.variance.n, passing: o.variance.passing, rate: o.variance.rate, wilsonLower: o.variance.wilsonLower, costUsd: o.variance.costUsd }));
  const r = o.localisation?.root;
  line('root', r?.node, r?.confidence, 'locus', JSON.stringify(r?.locus), 'sample', JSON.stringify(r && { node: r.sample.node, path: r.sample.path, from: r.sample.from, to: r.sample.to, identity: r.sample.identity }), 'flippers', JSON.stringify(o.localisation?.flippers));
  line('classes', (o.localisation?.classes ?? []).map(c => `${c.code}@${c.node}${c.field ? '.' + c.field : ''}`).join(', '), 'coverage', JSON.stringify(o.localisation?.coverage), 'loc ms', o.localisation?.ms);
  line('incident', JSON.stringify(o.incident));
  line('lintDebt ops', JSON.stringify((o.lintDebt?.ops ?? []).map(x => x.op + (x.node ? ':' + x.node : ''))), 'needsProposer', JSON.stringify(o.lintDebt?.needsProposer), 'decision', o.lintDebt?.decision);
  for (const d of o.decisions ?? []) {
    line(`  proposal ${d.proposal} [${d.kind}] ops=${JSON.stringify(d.ops)} => ${d.decision} ${JSON.stringify(d.reasons)} reject=${d.rejectCode ?? '-'} cost $${d.costUsd} ratio ${d.costRatio}${d.promoted ? ' PROMOTED ' + JSON.stringify(d.promoted) : ''}${d.queued ? ' QUEUED' : ''}`);
    for (const s of d.stages) line(`     ${s.id} ok=${s.ok}${s.code ? ' ' + s.code : ''}${s.detail ? ' ' + String(s.detail).slice(0, 220) : ''} $${s.costUsd ?? 0}`);
  }
  line('proposer', JSON.stringify(o.proposer && { spec: o.proposer.spec, allowed: o.proposer.allowed, locus: o.proposer.locus }), 'rounds', JSON.stringify(o.proposerRounds), 'events', JSON.stringify(o.proposerEvents?.map(e => `${e.from}->${e.to}@${e.round}`)));
  line('result', JSON.stringify(o.result), 'head', JSON.stringify(o.head));
  for (const p of o.proposals ?? []) line(`  proposed ${p.id} [${p.kind}] ${JSON.stringify(p.ops).slice(0, 700)} cites ${JSON.stringify(p.citations)}`);
  line('lesson', JSON.stringify(o.lesson && { id: o.lesson.id, lesson: o.lesson.lesson, lintRule: o.lesson.lintRule, firing: o.lesson.firing, status: o.lesson.status }));
}
