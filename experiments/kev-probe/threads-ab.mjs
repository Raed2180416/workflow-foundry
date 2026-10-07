// Same weights, two server configurations, interleaved so both see the same co-tenant load:
//   A = the provided server on :8008 (torch default: 4 intra-op threads, default OpenMP wait policy)
//   B = a second instance on :8009 started by this probe with OMP_NUM_THREADS=2, OMP_WAIT_POLICY=PASSIVE
// Also checks that both return the same probabilities for the same request.
// Writes experiments/runs/kev-probe/threads-ab.jsonl.
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { build } from '../../beds/incident/gen.mjs';
import { SystemOneClient } from '../../src/judgment.mjs';
import { RUN_DIR, spend, load, appendJsonl } from './lib.mjs';

const OUT = path.join(RUN_DIR, 'threads-ab.jsonl');
const servers = { A: new SystemOneClient({ url: 'http://127.0.0.1:8008', timeoutMs: 900000 }), B: new SystemOneClient({ url: 'http://127.0.0.1:8009', timeoutMs: 900000 }) };
const filler = build(11, 'dev', 5).task.inputs.log;
const q = { q0: { type: 'choice', instructions: 'Is there an incident in progress in this excerpt?', criteria: { yes: 'errors are rising', no: 'routine traffic only' } } };
let off = 50000;
const state = tokens => { const c = Math.round(tokens * 1.78); const s = `excerpt ${Math.random().toString(36).slice(2, 9)}\n` + filler.slice(off, off + c); off += c; return s; };

const reps = Number(process.env.REPS ?? 6);
for (const size of [300, 600]) for (let rep = 0; rep < reps; rep++) for (const arm of rep % 2 ? ['B', 'A'] : ['A', 'B']) {
  spend('kev', 1, 'threads-ab');
  const t0 = performance.now();
  const body = await servers[arm].ask({ state: state(size), questions: q });
  const row = { arm, size, rep, wallMs: Math.round(performance.now() - t0), serverMs: body.latency_ms, inputTokens: body.usage?.input_tokens, load1: load().one };
  appendJsonl(OUT, row); console.log(JSON.stringify(row));
}
// identity: one fixed state on both servers
const fixed = filler.slice(0, 600);
const ans = {};
for (const arm of ['A', 'B']) { spend('kev', 1, 'threads-ab identity'); ans[arm] = (await servers[arm].ask({ state: fixed, questions: q })).answers.q0.probabilities; }
const diff = Math.max(...Object.keys(ans.A).map(k => Math.abs(ans.A[k] - ans.B[k])));
appendJsonl(OUT, { identity: true, A: ans.A, B: ans.B, maxAbsDiff: diff }); console.log('identity', JSON.stringify(ans), diff);
