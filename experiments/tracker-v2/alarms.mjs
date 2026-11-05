#!/usr/bin/env node
// Analyst-side: every `unmet` (build, condition) of a BUILDER-1 judge file, with the condition's quote, its check in plain words, the
// evidence and the build's hidden-world verdict, for the adjudication of PREREG-TRACKER §5. Also every T1 `unmet` tick of a prose file.
//   node experiments/tracker-v2/alarms.mjs --judge J.json --bind B.json [--prose P.json] [--json]
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { renderCheck } from '../../app/core/tracker/checks.mjs';

export function alarms({ judge, bind, prose = null }) {
  const out = [];
  for (const [id, b] of Object.entries(judge.builds)) {
    for (const [cid, s] of Object.entries(b.t2NoG3)) {
      if (s.status !== 'unmet' && b.t2[cid]?.status !== 'unmet') continue;
      const c = (bind.cases[b.case] ?? []).find(x => x.id === cid);
      out.push({ arm: 'T2', build: id, case: b.case, verified: b.verified, condition: cid, quote: c?.quote, summary: c?.summary, check: c?.check ? renderCheck(c.check) : null,
        g3Suspect: b.t2[cid]?.status !== 'unmet', evidence: s.evidence.map(e => `${e.view}: ${e.why}`), oracle: b.oracleReasons });
    }
  }
  if (prose) for (const [id, r] of Object.entries(prose.builds)) for (const [cid, v] of Object.entries(r.verdicts ?? {})) {
    if (v.verdict !== 'unmet') continue;
    const b = judge.builds[id];
    out.push({ arm: 'T1', build: id, case: b?.case, verified: b?.verified, condition: cid, why: v.why });
  }
  return out;
}

if (process.argv[1]?.endsWith('alarms.mjs')) {
  const { values: a } = parseArgs({ options: { judge: { type: 'string' }, bind: { type: 'string' }, prose: { type: 'string' }, json: { type: 'boolean' } } });
  const list = alarms({ judge: JSON.parse(readFileSync(a.judge, 'utf8')), bind: JSON.parse(readFileSync(a.bind, 'utf8')), prose: a.prose ? JSON.parse(readFileSync(a.prose, 'utf8')) : null });
  if (a.json) console.log(JSON.stringify(list, null, 1));
  else for (const x of list) console.log(`${x.arm} ${x.verified ? 'GOOD' : 'BAD '} ${x.build} ${x.condition}${x.g3Suspect ? ' (G3)' : ''}: "${x.quote ?? ''}"\n   check: ${x.check ?? '-'}\n   ${x.arm === 'T1' ? `why: ${x.why}` : `evidence: ${x.evidence.join(' | ')}`}\n   oracle: ${(x.oracle ?? []).join(' | ').slice(0, 300)}`);
}
