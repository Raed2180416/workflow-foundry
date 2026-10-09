// Regenerate records dev tasks for the C0 testbed (rows 3, 4, 7 of BLOCKER-SYNTHESIS §2.1).
// Seeds: 201-216 d3, 217-224 d4 (in-sample, as experiments/jit/configs/dev-records-1.json);
//        249-264 d3, 265-272 d4 (out-of-sample). Never 225-248 (reserved for R0), never >= 5000.
// Writes, under OUT (default /var/tmp/foundry-work/c0-testbed):
//   tasks/s<seed>.json   the rendered task exactly as experiments/lib/beds.mjs makeTasks builds it (what a solver sees)
//   labels/s<seed>.json  generator labels (analyst side only; never shown to a solver)
//   manifest.json        seed, difficulty, taskHash (sha256 of canonical task, as stream.mjs) and file sha256
// Usage: node --max-old-space-size=1024 gen.mjs [OUT]
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { makeTasks } from '../../../../experiments/lib/beds.mjs';
import { buildWorld } from '../../../../beds/records/world.mjs';
import { isoDate, fromDay } from '../../../../beds/records/render.mjs';

export const SETS = {
  in: [{ difficulty: 3, seeds: range(201, 216) }, { difficulty: 4, seeds: range(217, 224) }],
  out: [{ difficulty: 3, seeds: range(249, 264) }, { difficulty: 4, seeds: range(265, 272) }],
};
function range(a, b) { return Array.from({ length: b - a + 1 }, (_, i) => a + i); }
const FORBIDDEN = s => (s >= 225 && s <= 248) || s >= 5000;

const OUT = process.argv[2] ?? '/var/tmp/foundry-work/c0-testbed';
const sha = s => createHash('sha256').update(s).digest('hex');

async function main() {
  mkdirSync(path.join(OUT, 'tasks'), { recursive: true });
  mkdirSync(path.join(OUT, 'labels'), { recursive: true });
  const manifest = { generatedAt: new Date().toISOString(), family: 'records', split: 'dev', tasks: [] };
  for (const [set, segs] of Object.entries(SETS)) {
    for (const { difficulty, seeds } of segs) {
      for (const seed of seeds) {
        if (FORBIDDEN(seed)) throw new Error(`seed ${seed} is reserved`);
        const [t] = await makeTasks('records', { split: 'dev', seeds: [seed], difficulty });
        const taskText = JSON.stringify(t.task);
        writeFileSync(path.join(OUT, 'tasks', `s${seed}.json`), taskText);
        // Generator labels: per-task conventions and truth (analyst side).
        const w = buildWorld(seed, 'dev', difficulty);
        const conv = w.ctx.conv;
        const personOf = {};
        for (const r of w.truth.records) for (const row of r.source_rows) personOf[row] = r.entity_id;
        const atlasRows = w.allRows.filter(x => x.system === 'ATLAS').map(x => ({ row: x.rowId, update: isoDate(fromDay(x.date)), monthFirst: w.ctx.atlasMonthFirst(x.date) }));
        const labels = {
          seed, difficulty, set,
          dateOrder: { BRIGHTDESK: conv.bd.toUpperCase(), ATLAS: conv.atlas.toUpperCase(), VENDEX: conv.vendex.toUpperCase() },
          atlasCutoff: w.ctx.cutoff === null ? null : isoDate(fromDay(w.ctx.cutoff)),
          atlasRows,
          mirror: conv.mirror, persp: conv.persp, flags: conv.flags,
          entities: w.truth.records.length,
          personOf,
          voidRows: w.allRows.filter(x => !w.rows.includes(x)).map(x => x.rowId),
        };
        const labelText = JSON.stringify(labels);
        writeFileSync(path.join(OUT, 'labels', `s${seed}.json`), labelText);
        manifest.tasks.push({ seed, difficulty, set, taskKey: t.taskKey, taskHash: t.taskHash, taskFileSha256: sha(taskText), labelFileSha256: sha(labelText), rows: w.allRows.length, entities: labels.entities });
        process.stderr.write(`s${seed} d${difficulty} rows=${w.allRows.length} E=${labels.entities}\n`);
      }
    }
  }
  writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
}
main().catch(e => { console.error(e); process.exit(1); });
