#!/usr/bin/env node
// Merge every ledger (raw/ledger.jsonl, raw/ladder*/ladder.jsonl, meter-log*.jsonl) into one chronological table:
// when, call, model, list-price cost, token classes, 5h and 7d meter readings, and the running list-price total. Writes timeline.tsv.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { HERE } from './lib.mjs';
const files = ['raw/ledger.jsonl', ...readdirSync(path.join(HERE, 'raw')).filter(n => n.startsWith('ladder')).map(n => `raw/${n}/ladder.jsonl`), ...readdirSync(HERE).filter(n => /^meter-log.*\.jsonl$/.test(n))];
const rows = [];
for (const f of files) if (existsSync(path.join(HERE, f))) for (const l of readFileSync(path.join(HERE, f), 'utf8').split('\n').filter(Boolean)) {
  const r = JSON.parse(l);
  const h5 = r.fiveHour?.utilization ?? (typeof r.fiveHour === 'number' ? r.fiveHour : null), d7 = r.sevenDay?.utilization ?? (typeof r.sevenDay === 'number' ? r.sevenDay : null);
  rows.push({ ts: r.ts, call: r.label ?? `${path.basename(f, '.jsonl')}#${r.i}`, model: (r.model ?? '').replace('claude-', ''), cost: r.costUsd, in: r.inputTokens, out: r.outputTokens, cr: r.cacheReadTokens, cw: r.cacheWriteTokens, h5, d7, src: f });
}
rows.sort((a, b) => a.ts.localeCompare(b.ts));
let run = 0, prev = null;
const lines = ['ts\tcall\tmodel\tcost_usd\tinput\toutput\tcache_read\tcache_write\tfive_hour\tseven_day\trunning_usd\ttick'];
for (const r of rows) {
  run += r.cost ?? 0;
  const tick = prev && r.h5 != null && (r.h5 !== prev.h5 || r.d7 !== prev.d7) ? `5h ${prev.h5}->${r.h5} 7d ${prev.d7}->${r.d7}` : '';
  if (r.h5 != null) prev = r;
  lines.push([r.ts, r.call, r.model, r.cost?.toFixed(6), r.in, r.out, r.cr, r.cw, r.h5, r.d7, run.toFixed(5), tick].join('\t'));
}
writeFileSync(path.join(HERE, 'timeline.tsv'), lines.join('\n') + '\n');
console.log(lines.filter((l, i) => i === 0 || l.split('\t')[11]).join('\n'));
console.log(`rows ${rows.length}, running total $${run.toFixed(5)} (calls with a ledger row; the manual first call is in raw/ only)`);
