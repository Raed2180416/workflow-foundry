// Re-measurement of research/review-20261007/04-efficiency-rust.md change 1 through the Foundry code path: the claude-cli provider
// with the child-environment flags OFF (CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC and FORCE_PROMPT_CACHING_5M removed from the child)
// against ON (the committed policy/models.json block, no constructor override). Real Haiku 5.5 calls through ModelPort and a journal,
// strictly sequential, arms interleaved with alternating order. Two shapes of trivial call, 5 per arm each (20 calls):
//   shared  one system prompt per arm (arms do not share a cache prefix): call 1 is cold, calls 2-5 can read the cache
//   unique  a nonce at the head of the system prompt: every call is cold
// Budget: hard stop above $0.04 cumulative, $0.02 per call. Development/diagnostic evidence, n=5 per cell: it re-checks the sign and the
// rough size of an earlier measurement, it is not a sealed comparison.
//   node research/review-20261007/cli-flags-20261008/measure.mjs [outfile.json]
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPolicy } from '../../../src/models/policy.mjs';
import { ModelPort } from '../../../src/models/port.mjs';
import { Journal } from '../../../src/journal.mjs';
import { ClaudeCliProvider } from '../../../src/models/providers/claude-cli.mjs';

const N = 5, CAP_TOTAL_USD = 0.04, CAP_CALL_USD = 0.02, MODEL = 'claude-haiku-5-5';
const NE = 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', CACHE = 'FORCE_PROMPT_CACHING_5M';
const out = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'results.json');
const { policy, hash } = loadPolicy();
const schema = { type: 'object', additionalProperties: false, required: ['n'], properties: { n: { type: 'number' } } };
const childCpuMs = () => { const f = readFileSync('/proc/self/stat', 'utf8').split(') ')[1].split(' '); return (Number(f[13]) + Number(f[14]) + Number(f[15]) + Number(f[16])) * 10; };
const load = () => Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0]);

const arms = {
  off: new ClaudeCliProvider({ policy, maxBudgetUsd: CAP_CALL_USD, childEnv: { [NE]: null, [CACHE]: null } }),
  on: new ClaudeCliProvider({ policy, maxBudgetUsd: CAP_CALL_USD }), // the policy block: this is the production path
};
const ports = Object.fromEntries(Object.entries(arms).map(([arm, provider]) =>
  [arm, new ModelPort({ policy, journal: new Journal(new DatabaseSync(':memory:')), providers: { 'claude-cli': provider }, concurrency: { 'claude-cli': 1 } })]));
await arms.off.engineVersion(); // the one-off `claude --version` probe stays out of the timings

const template = arm => `You perform one narrow, typed step inside a larger workflow (${arm}). Use only the information provided. Do not invent facts. Return exactly one JSON value that satisfies the output schema.`;
let spent = 0;
const rows = [];
async function once({ shape, arm, i }) {
  if (spent > CAP_TOTAL_USD) throw new Error(`budget guard: spent $${spent.toFixed(5)}`);
  const system = shape === 'shared' ? template(arm) : `${template(arm)} Nonce ${arm}-${i}-${process.hrtime.bigint()}.`;
  const prompt = `Return n = ${7 + i}.`, loadBefore = load(), cpu0 = childCpuMs(), t0 = process.hrtime.bigint();
  const r = await ports[arm].call({ runId: 'cli-flags', nodeKey: `${shape}-${arm}-${i}`, attempt: 1, modelId: MODEL, system, prompt, schema, decoding: { reasoning: 'none' } });
  const wallMs = Number(process.hrtime.bigint() - t0) / 1e6, cpuMs = childCpuMs() - cpu0;
  const row = ports[arm].journal.get(r.journalId);
  spent += r.costUsd ?? 0;
  const result = { shape, arm, i, ok: r.ok, correct: r.value?.n === 7 + i, wallMs: +wallMs.toFixed(0), apiMs: row.response.meta?.durationApiMs ?? null, childCpuMs: cpuMs, costUsd: r.costUsd,
    input: r.usage.inputTokens, output: r.usage.outputTokens, cacheRead: r.usage.cacheReadTokens, cacheWrite: r.usage.cacheWriteTokens, load1: loadBefore, journalEnv: row.request.providerRequest?.env ?? null };
  rows.push(result); console.log(JSON.stringify(result));
}
for (const shape of ['shared', 'unique'])
  for (let i = 0; i < N; i++) for (const arm of (i % 2 ? ['on', 'off'] : ['off', 'on'])) await once({ shape, arm, i });

const med = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const summary = {};
for (const shape of ['shared', 'unique']) for (const arm of ['off', 'on']) {
  const r = rows.filter(x => x.shape === shape && x.arm === arm), warm = r.filter(x => shape === 'unique' || x.i > 0);
  summary[`${shape}/${arm}`] = { n: r.length, allCorrect: r.every(x => x.ok && x.correct), wallMsMedian: med(r.map(x => x.wallMs)), wallMsMean: +mean(r.map(x => x.wallMs)).toFixed(0), apiMsMedian: med(r.map(x => x.apiMs)),
    nonApiMsMedian: med(r.map(x => x.wallMs - x.apiMs)), childCpuMsMedian: med(r.map(x => x.childCpuMs)), costUsdMean: +mean(r.map(x => x.costUsd)).toFixed(7), costUsdMeanWarm: +mean(warm.map(x => x.costUsd)).toFixed(7),
    cacheWriteMean: +mean(r.map(x => x.cacheWrite)).toFixed(0), cacheReadMean: +mean(r.map(x => x.cacheRead)).toFixed(0), outputTokensMean: +mean(r.map(x => x.output)).toFixed(1) };
}
const pairs = {};
for (const shape of ['shared', 'unique']) {
  const d = (key) => Array.from({ length: N }, (_, i) => rows.find(x => x.shape === shape && x.arm === 'on' && x.i === i)[key] - rows.find(x => x.shape === shape && x.arm === 'off' && x.i === i)[key]);
  const wall = d('wallMs'), cpu = d('childCpuMs'), cost = d('costUsd');
  pairs[shape] = { wallMsDiffMedian: med(wall), wallMsOnFasterInPairs: wall.filter(x => x < 0).length, cpuMsDiffMedian: med(cpu), costUsdOnCheaperInPairs: cost.filter(x => x < 0).length, costUsdDiffMean: +mean(cost).toFixed(7) };
}
const report = { measuredAt: new Date().toISOString(), claude: (await arms.off.engineVersion()), node: process.version, platform: platform(), cpus: cpus().length, policyHash: hash, policyVersion: policy.policyVersion,
  model: MODEL, ambient: { [NE]: process.env[NE] ?? null, [CACHE]: process.env[CACHE] ?? null }, n: N, spentUsd: +spent.toFixed(6), summary, pairs, rows };
writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ spentUsd: report.spentUsd, summary, pairs }, null, 2));
