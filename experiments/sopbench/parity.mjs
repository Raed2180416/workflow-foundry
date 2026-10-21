#!/usr/bin/env node
// SOP-Bench parity at $0 (research/sopbench-20261021/parity.json; NOTES.md §5). No model is called.
//
//  1. Scripted policies through the full run path (tool.mjs -> mailbox -> bridge serve on the dev world -> grade), on
//     every dev row of every SOP: oracle (the ground truth), wrong (a non-label), labelswap (another dev label),
//     gaming (all dev labels of the column in one string), empty (no answer).
//  2. The same calls and answers through upstream's own path (bridge official: upstream's BenchmarkLoader, ToolManager
//     on the UNFILTERED world, Evaluator.run_single_task with a scripted agent): tool results and verdicts must match.
//  3. A scorer battery: answer variants per dev row (case, '_'/'-', substrings, numbers, booleans, nulls, missing keys,
//     duplicate keys, broken JSON, several blocks, odd whitespace) graded by upstream's code (Python) and by the JS port
//     and the two strict implementations: every covered verdict must agree.
//
//   node experiments/sopbench/parity.mjs [--sops a,b] [--out research/sopbench-20261021/parity.json]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WORK_ROOT } from '../../src/executors/claude-code.mjs';
import { RESEARCH, SPLIT_FILE, bridgeOk, readJson, sha256, writeJson } from './lib.mjs';
import { POLICIES, ROWS_ROOT, gradeAnswers, runRows, scriptedSteps } from './run.mjs';
import { loadSplit } from './split.mjs';
import { finalOutputText } from './scorer.mjs';

const readRecords = f => readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

/** Answer-text variants for one row (host-side fixture; uses the row's ground truth). */
export function battery(exp, labels) {
  const cols = exp.output_columns, ex = exp.expected;
  const gt = Object.fromEntries(cols.map(c => [c, ex[c].isna ? null : ex[c].str]));
  const map = f => Object.fromEntries(cols.map(c => [c, f(gt[c], c)]));
  const s = v => (v === null ? null : String(v));
  const out = [];
  const add = (name, text) => out.push({ name, text });
  add('oracle', finalOutputText(gt));
  add('upper', finalOutputText(map(v => (v === null ? null : s(v).toUpperCase()))));
  add('underscores', finalOutputText(map(v => (v === null ? null : s(v).replace(/[ -]/g, '_')))));
  add('hyphens', finalOutputText(map(v => (v === null ? null : s(v).replace(/[ _]/g, '-')))));
  add('padded', finalOutputText(map(v => (v === null ? null : `  ${v} `))));
  add('prefix', finalOutputText(map(v => (v === null ? null : `Final: ${v}`))));
  add('suffix', finalOutputText(map(v => (v === null ? null : `${v} (per SOP)`))));
  add('substring', finalOutputText(map(v => (v === null || s(v).length < 3 ? v : s(v).slice(1, -1)))));
  add('first-word', finalOutputText(map(v => (v === null ? null : s(v).split(/[\s_-]+/)[0]))));
  add('not', finalOutputText(map(v => (v === null ? null : `not ${v}`))));
  add('gaming', finalOutputText(map((v, c) => (labels[c] ?? []).join(' | '))));
  add('labelswap', finalOutputText(map((v, c) => (labels[c] ?? []).find(l => l !== (ex[c].str)) ?? 'zz')));
  add('nulls', finalOutputText(map(() => null)));
  add('na-strings', finalOutputText(map(() => 'N/A')));
  add('unknown', finalOutputText(map(() => 'unknown')));
  add('bool-json', `<final_output>{${cols.map(c => `${JSON.stringify(c)}: ${/^(true|false)$/i.test(String(gt[c])) ? String(gt[c]).toLowerCase() : JSON.stringify(gt[c])}`).join(', ')}}</final_output>`);
  add('number-json', `<final_output>{${cols.map(c => `${JSON.stringify(c)}: ${/^-?\d+(\.\d+)?$/.test(String(gt[c])) ? `${gt[c]}${String(gt[c]).includes('.') ? '' : '.0'}` : JSON.stringify(gt[c])}`).join(', ')}}</final_output>`);
  add('number-1e', finalOutputText(map(v => (/^-?\d+(\.\d+)?$/.test(String(v)) ? `${Number(v)}e0` : v))));
  add('keys-upper', `<final_output>${JSON.stringify(Object.fromEntries(cols.map(c => [c.toUpperCase(), gt[c]])))}</final_output>`);
  add('dup-keys', `<final_output>{${cols.map(c => `${JSON.stringify(c)}: "zz", ${JSON.stringify(c.toUpperCase())}: ${JSON.stringify(gt[c])}`).join(', ')}}</final_output>`);
  add('missing-first', finalOutputText(Object.fromEntries(cols.slice(1).map(c => [c, gt[c]]))));
  add('extra-keys', finalOutputText({ reasoning: 'checked', ...gt, task_id: 7 }));
  add('two-blocks-wrong-last', `${finalOutputText(gt)}\n${finalOutputText(map(() => 'zz'))}`);
  add('two-blocks-right-last', `${finalOutputText(map(() => 'zz'))}\n${finalOutputText(gt)}`);
  add('broken-json', `<FINAL_OUTPUT>{${cols.map(c => `'${c}': '${gt[c]}'`).join(', ')}}</FINAL_OUTPUT>`);
  add('tag-case', `<Final_Output>\n${JSON.stringify(gt, null, 2)}\n</Final_Output>`);
  add('nested', `<final_output>{"result": ${JSON.stringify(gt)}}</final_output>`);
  add('list-value', finalOutputText(map(v => [v])));
  add('xml-fallback', `<final_decision>${cols.length === 1 ? gt[cols[0]] : ''}</final_decision>`);
  add('plain', String(gt[cols[0]] ?? ''));
  add('empty', '');
  return out;
}

export async function parity({ sops: only = null, out = path.join(RESEARCH, 'parity.json'), log = m => process.stderr.write(m + '\n') } = {}) {
  const split = loadSplit(SPLIT_FILE);
  const sops = only ?? Object.keys(split.sops);
  const runs = {};
  const live = path.join(WORK_ROOT, 'sopbench', `parity-${Date.now()}`);
  // 1. scripted policies through the run path
  for (const policy of POLICIES) {
    const { summary, results } = await runRows({ policy, sops, rowsPerSop: 20, runId: `parity-${policy}`, liveRoot: path.join(live, policy), outDir: null, concurrency: 3, log: () => {} });
    runs[policy] = { summary, results };
    log(`[parity] ${policy}: upstream ${summary.upstream.micro?.toFixed(3)} strict ${summary.strict.micro?.toFixed(3)} (${summary.n} rows)`);
  }
  // 2. official path on the same calls and answers
  const oracleLive = path.join(live, 'oracle');
  const expectedOf = (s, r) => readJson(path.join(oracleLive, 'prep', s, 'rows', String(r), 'expected.json'));
  const answers = [];
  for (const policy of POLICIES) {
    for (const r of runs[policy].results) {
      const pdir = path.join(oracleLive, 'prep', r.sop);
      const task = readJson(path.join(pdir, 'rows', String(r.row), 'task.json'));
      const steps = scriptedSteps(task, readJson(path.join(pdir, 'catalog.json')));
      answers.push({ policy, sop: r.sop, row: r.row, id: `${policy}:${r.sop}:${r.row}`, calls: steps.flatMap(s => s.calls), text: r.answerText ?? '' });
    }
  }
  const inFile = path.join(live, 'official-in.jsonl'), outFile = path.join(live, 'official-out.jsonl');
  writeFileSync(inFile, answers.map(a => JSON.stringify(a)).join('\n') + '\n');
  await bridgeOk(['official', '--answers', inFile, '--out', outFile], { liveDir: live });
  const official = readRecords(outFile);
  const ours = new Map();
  for (const policy of POLICIES) for (const r of runs[policy].results) ours.set(`${policy}:${r.sop}:${r.row}`, r);
  const callCmp = { compared: 0, equal: 0, differ: [] }, verdictCmp = { compared: 0, equal: 0, differ: [] };
  const loaders = {}, leaks = {};
  for (const o of official) {
    const mine = ours.get(o.id);
    const pol = o.id.split(':')[0];
    loaders[o.sop] = o.loader;
    if (o.upstreamTaskInputs) leaks[o.sop] = o.upstreamTaskInputs.filter(c => (expectedOf(o.sop, o.row).output_columns).includes(c));
    verdictCmp.compared++;
    if (mine.grade?.upstream === o.upstream.pass) verdictCmp.equal++; else verdictCmp.differ.push({ id: o.id, ours: mine.grade?.upstream, official: o.upstream.pass });
    if (pol !== 'oracle') continue; // the calls are the same for every policy; compare them once
    const myCalls = readRecords(path.join(oracleLive, 'host', o.sop, String(o.row), 'calls.jsonl'));
    o.calls.forEach((c, i) => {
      callCmp.compared++;
      const m = myCalls[i];
      const same = m && m.name === c.name && m.content === c.content && Boolean(m.upstreamFatal) === Boolean(c.upstreamFatal);
      // Contents are row data (CC BY-NC): the report names the call and hashes both results; ROWS_ROOT keeps the texts.
      if (same) callCmp.equal++; else callCmp.differ.push({ id: o.id, i, name: c.name, oursSha256: m?.content ? sha256(m.content) : null, officialSha256: c.content ? sha256(c.content) : null, detail: { ours: m?.content, official: c.content } });
    });
  }
  // 3. scorer battery (dev rows of the oracle run)
  const bat = [];
  for (const r of runs.oracle.results) {
    const exp = expectedOf(r.sop, r.row);
    const labels = {};
    for (const x of runs.oracle.results.filter(y => y.sop === r.sop)) { const e = expectedOf(x.sop, x.row); for (const c of e.output_columns) (labels[c] ??= new Set()).add(e.expected[c].isna ? 'nan' : e.expected[c].str); }
    const lab = Object.fromEntries(Object.entries(labels).map(([c, v]) => [c, [...v].sort()]));
    for (const v of battery(exp, lab)) bat.push({ sop: r.sop, row: r.row, id: v.name, text: v.text });
  }
  const graded = await gradeAnswers(bat, { liveDir: live, expectedOf });
  const byVariant = {};
  let covered = 0, agreeUp = 0, agreeStrict = 0;
  const disagree = [];
  graded.forEach((g, i) => {
    const v = (byVariant[bat[i].id] ??= { n: 0, upstreamPass: 0, strictPass: 0, jsCovered: 0 });
    v.n++; v.upstreamPass += g.upstream ? 1 : 0; v.strictPass += g.strict ? 1 : 0;
    const ref = { sop: bat[i].sop, row: bat[i].row, variant: bat[i].id, textSha256: sha256(bat[i].text) };
    if (g.jsUpstream !== null) { covered++; v.jsCovered++; if (g.agree.upstream) agreeUp++; else disagree.push({ ...ref, py: g.upstream, js: g.jsUpstream, kind: 'upstream', detail: bat[i].text }); }
    if (g.agree.strict) agreeStrict++; else disagree.push({ ...ref, py: g.strict, js: g.jsStrict, kind: 'strict', detail: bat[i].text });
  });
  const table = Object.fromEntries(POLICIES.map(p => [p, { upstream: runs[p].summary.upstream, strict: runs[p].summary.strict, n: runs[p].summary.n,
    bySop: Object.fromEntries(Object.entries(runs[p].summary.bySop).map(([s, x]) => [s, { n: x.n, upstream: x.upstream, strict: x.strict }])) }]));
  const report = {
    kind: 'sopbench-parity', at: new Date().toISOString(), splitSha256: split.splitSha256, rows: runs.oracle.summary.n, sops: sops.length,
    evidence: 'development/diagnostic, $0: scripted policies on SPLIT.json dev rows only; no model',
    policies: table,
    officialPath: { loaders, upstreamInputsContainOutputs: leaks, toolCalls: { compared: callCmp.compared, equal: callCmp.equal, differ: callCmp.differ.slice(0, 40), differCount: callCmp.differ.length },
      verdicts: { compared: verdictCmp.compared, equal: verdictCmp.equal, differ: verdictCmp.differ.slice(0, 40) } },
    scorerBattery: { answers: graded.length, variants: Object.keys(byVariant).length, jsUpstreamCovered: covered, jsUpstreamAgree: agreeUp, strictAgree: agreeStrict, disagreements: disagree.slice(0, 40),
      disagreementCount: disagree.length, byVariant },
    runPathScorer: Object.fromEntries(POLICIES.map(p => [p, runs[p].summary.scorer])),
    worldFlags: Object.fromEntries(POLICIES.slice(0, 1).map(p => [p, runs[p].summary.world])),
  };
  // The repo copy drops every `detail` (row-derived text); the full report goes to ROWS_ROOT (outside the repo).
  const strip = x => JSON.parse(JSON.stringify(x, (k, v) => (k === 'detail' ? undefined : v)));
  writeJson(path.join(ROWS_ROOT, `parity-${Date.now()}`, 'parity.full.json'), report);
  writeJson(out, strip(report));
  return strip(report);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const get = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const r = await parity({ sops: get('--sops')?.split(','), out: get('--out') });
  const { policies, officialPath, scorerBattery } = r;
  console.log(JSON.stringify({ policies: Object.fromEntries(Object.entries(policies).map(([p, x]) => [p, { upstream: x.upstream, strict: x.strict, n: x.n }])),
    toolCalls: { compared: officialPath.toolCalls.compared, equal: officialPath.toolCalls.equal }, verdicts: { compared: officialPath.verdicts.compared, equal: officialPath.verdicts.equal },
    battery: { answers: scorerBattery.answers, covered: scorerBattery.jsUpstreamCovered, agreeUp: scorerBattery.jsUpstreamAgree, agreeStrict: scorerBattery.strictAgree, disagreements: scorerBattery.disagreementCount } }, null, 1));
}
