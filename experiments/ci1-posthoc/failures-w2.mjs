#!/usr/bin/env node
// Wave-2 failing builds (analysis, $0): for each failing build of the given labels, its outcome and, per failing hidden world, the
// oracle v2 reasons and the run error recorded at scoring time. The starting point for root-causing (diag-w2.mjs reruns one world).
//   node experiments/ci1-w2/failures-w2.mjs <label...> [--item 19187]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNS = process.env.CI1_RUNS ?? '/var/tmp/foundry-work/ci1-20261021/runs';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const only = args.includes('--item') ? args[args.indexOf('--item') + 1] : null;
  for (const label of args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--item')) {
    const dir = path.join(RUNS, label, 'records'); if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
      const r = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
      if (r.pass || (only && r.item !== only)) continue;
      const bad = (r.worlds ?? []).filter(w => !w.pass);
      console.log(`${label} ${r.item} k${r.k} ${r.outcome}${r.error ? ` ${r.error.code ?? ''}` : ''}: ${bad.length}/${(r.worlds ?? []).length} worlds fail`);
      for (const w of bad.slice(0, 3)) console.log(`   ${w.id}${w.error ? ` [${w.error.slice(0, 90)}]` : ''}: ${(w.reasons ?? []).join(' ; ').slice(0, 330)}`);
    }
  }
}
