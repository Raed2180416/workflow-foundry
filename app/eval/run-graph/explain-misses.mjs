#!/usr/bin/env node
// Root-causing, after a look (diagnostic, changes no score): re-record the same seeds and put every miss of B1, B0 and T into a named class.
//   node app/eval/run-graph/explain-misses.mjs --seeds 100000-100299 [--named] [--out FILE]
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { NAMED, randomScenario } from './scenarios.mjs';
import { record, answers, truthAt, statusesOf } from './harness.mjs';
import * as Real from '../../core/run-graph.mjs';

const C = globalThis.RunViewCore;
const STOPPED = new Set(['succeeded', 'failed', 'cancelled', 'uncertain']);
function classifyNode(arm, id, said, truth, cp, workflow, executing) {
  const key = `root/${id}`, def = workflow.nodes.find(n => n.id === id), st = statusesOf(cp).get(key);
  if (Object.values(cp.approvals ?? {}).some(a => a.nodeKey === key && a.status === 'rejected') && said === 'needs_you') return 'refused action still shown as needing you (approval.decided has no nodeKey)';
  if (STOPPED.has(cp.status) && ['needs_you', 'working'].includes(said) && truth === 'idle') return 'run stopped, step still shown as waiting or working';
  if (def?.kind === 'verify' && st?.status === 'completed' && said === 'working' && truth === 'problem') return 'independent check disagreed, shown as still working';
  if (cp.status === 'running' && executing === false && truth === 'problem') return 'process gone, step still shown as working';
  if (truth === 'working' && said === 'idle' && cp.status === 'ready') return 'run ready under a live owner, shown as not started';
  return `other: said ${said}, truth ${truth}, row ${st?.status}`;
}
export async function explain({ seeds, named = false, scratch = tmpdir() }) {
  const root = mkdtempSync(path.join(scratch, 'explain-misses-')), classes = {};
  const bump = (arm, q, cls) => { classes[arm] ??= {}; classes[arm][q] ??= {}; classes[arm][q][cls] = (classes[arm][q][cls] ?? 0) + 1; };
  try {
    const jobs = [...(named ? Object.keys(NAMED).map(name => ({ name, sc: { ...NAMED[name](), name } })) : []), ...Array.from({ length: seeds[1] - seeds[0] + 1 }, (_, i) => ({ name: `R${seeds[0] + i}`, sc: randomScenario(seeds[0] + i) }))];
    for (const job of jobs) {
      const rec = await record(path.join(root, job.name), job.sc);
      if (rec.invalid) continue;
      const { workflow, commits, events, journal } = rec;
      const mT = Real.foldEvents(workflow, []), mB1 = new C.RunModel({ workflow }, { dispatchKnown: false });
      let applied = 0;
      commits.forEach((c, i) => {
        const final = i === commits.length - 1;
        while (applied < c.seq) { const ev = events[applied++]; mT.apply(ev); mB1.apply(ev); }
        const truth = truthAt(workflow, c.run, journal, c.executing);
        const a = answers(Real, { workflow, cp: c.run, events: events.slice(0, c.seq), model: mT, b1Model: mB1, executing: c.executing, journal: final ? journal : null });
        for (const arm of ['T', 'B1']) for (const [id, t] of Object.entries(truth.nodes)) if (a[arm].nodes[id] !== t) bump(arm, 'state', classifyNode(arm, id, a[arm].nodes[id], t, c.run, workflow, c.executing));
        for (const arm of ['T', 'B1', 'B0']) for (const k of truth.waiting) if (!a[arm].waiting.includes(k)) bump(arm, 'waitMissed', k.startsWith('question:') ? 'question not listed' : k.split('/').length > 2 ? 'approval inside a map item not listed' : `approval not listed while the run is ${c.run.status}`);
        for (const arm of ['T', 'B1', 'B0']) for (const k of a[arm].waiting) if (!truth.waiting.includes(k)) bump(arm, 'waitFalse', STOPPED.has(c.run.status) ? 'listed after the run stopped' : 'listed but not waiting');
        if (final && truth.failing) for (const arm of ['T', 'B1', 'B0']) {
          const f = a[arm].failing, leaves = truth.failing.leaves;
          if (f && leaves.has(f.nodeKey) && leaves.get(f.nodeKey) === f.code) continue;
          const cls = !f ? 'no cause named' : leaves.size === 0 ? (f.code === truth.failing.runCode ? 'ok' : 'run-level code wrong')
            : [...leaves.keys()].some(k => f.nodeKey && k.startsWith(`${f.nodeKey}:`)) ? 'names the container, not the failing item step'
            : f.nodeKey === null ? 'names no step (a step failed)' : leaves.has(f.nodeKey) ? 'right step, wrong code' : 'names another step';
          if (cls !== 'ok') bump(arm, 'failDeep', cls);
        }
      });
      rec.store.close(); rmSync(path.join(root, job.name), { recursive: true, force: true });
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
  return classes;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values: a } = parseArgs({ options: { seeds: { type: 'string', default: '0-199' }, named: { type: 'boolean', default: false }, out: { type: 'string' }, scratch: { type: 'string', default: tmpdir() } } });
  const [lo, hi] = a.seeds.split('-').map(Number);
  const r = await explain({ seeds: [lo, hi], named: a.named, scratch: a.scratch });
  if (a.out) writeFileSync(a.out, `${JSON.stringify(r, null, 1)}\n`);
  console.log(JSON.stringify(r, null, 1));
}
