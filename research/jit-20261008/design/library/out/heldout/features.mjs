// J1 / L1-b structural cross-check (PREREG §5). $0. Reads only the saved definitions (MANIFEST.json + files) and labels.jsonl
// (the last row per id). For each workflow it extracts mechanical counts from the definition and checks the label against
// them: a label that omits a construct the definition plainly contains (or names one it does not contain) is listed.
// It is a recall check on the labeller, not a second labeller. Usage (repo root):
//   node research/jit-20261008/design/library/out/heldout/features.mjs   -> features.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLATFORMS = ['windmill', 'kestra', 'power-automate', 'step-functions', 'logic-apps'];
const rd = (p) => fs.readFileSync(p, 'utf8');
const count = (re, s) => (s.match(re) ?? []).length;
const idOf = (p, wf) => `${p}:${p === 'power-automate' ? wf.id : p === 'windmill' ? wf.id : wf.id}`;

// ---------- Windmill hub flows: JSON {flow:{value:{modules, preprocessor_module, failure_module}}}
function windmill(text) {
  const f = JSON.parse(text).flow; const v = f.value ?? {};
  const f2 = { modules: 0, types: {}, suspend: 0, stopAfterIf: 0, retry: 0, sleep: 0, skipFailures: 0, branch: 0, loops: 0, parallel: 0, failureModule: !!v.failure_module, preprocessor: !!v.preprocessor_module, whileLoops: 0 };
  const code = [];
  const walk = (m) => {
    f2.modules++; const val = m.value ?? {}; f2.types[val.type] = (f2.types[val.type] ?? 0) + 1;
    if (m.suspend || val.suspend) f2.suspend++; if (m.stop_after_if || val.stop_after_if) f2.stopAfterIf++; if (m.retry) f2.retry++; if (m.sleep) f2.sleep++;
    if (val.skip_failures) f2.skipFailures++;
    if (val.type === 'branchone' || val.type === 'branchall') f2.branch++; if (val.type === 'forloopflow') f2.loops++; if (val.type === 'whileloopflow') { f2.loops++; f2.whileLoops++; }
    if (val.parallel) f2.parallel++;
    if (val.content) code.push(val.content);
    for (const b of val.branches ?? []) { for (const x of b.modules ?? []) walk(x); }
    for (const x of val.default ?? []) walk(x); for (const x of val.modules ?? []) walk(x);
  };
  for (const m of v.modules ?? []) walk(m); if (v.failure_module) walk(v.failure_module); if (v.preprocessor_module) walk(v.preprocessor_module);
  const c = code.join('\n');
  return { ...f2, clock: count(/new Date\(|Date\.now\(|utcnow|datetime\.now/g, c), random: count(/Math\.random|randomUUID|uuid/gi, c), codeEffects: count(/\bfetch\(|axios|requests\.|\.query\(|client\.connect/g, c), unboundedWhile: count(/while\s*\(/g, c), state: count(/getState|setState/g, c), resume: count(/getResumeUrls/g, c) };
}

// ---------- Kestra flow YAML (text scan; no YAML parser: the files are plugin-typed lists)
function kestra(text) {
  const body = text.split(/^extend:/m)[0];
  const types = {}; for (const m of body.matchAll(/type:\s*(io\.kestra\.[A-Za-z0-9_.]+)/g)) types[m[1].replace(/^io\.kestra\.plugin\./, '')] = (types[m[1].replace(/^io\.kestra\.plugin\./, '')] ?? 0) + 1;
  return { types, triggers: count(/trigger\.(Schedule|Webhook|Flow|Realtime|Polling)/g, body), schedule: count(/trigger\.Schedule/g, body), webhook: count(/trigger\.Webhook/g, body), errors: count(/^errors:/gm, body), finally: count(/^finally:/gm, body), pause: count(/flow\.Pause/g, body), loops: count(/flow\.(Loop|ForEach|ForEachItem)/g, body), ifs: count(/flow\.(If|Switch)/g, body), parallel: count(/flow\.Parallel/g, body), subflow: count(/flow\.Subflow/g, body), retry: count(/^\s+retry:/gm, body), allowFailed: count(/allowFailed/g, body), kv: count(/core\.kv\./g, body), secret: count(/secret\(/g, body), clock: count(/\bnow\(\)|dateAdd|execution\.startDate/g, body), random: count(/uuid|random/gi, body), ai: count(/plugin\.ai\./g, body), scripts: count(/plugin\.scripts\./g, body), disabledTriggers: count(/disabled:\s*true/g, body), wait: count(/wait:\s*true|pollInterval|waitTimeout/g, body) };
}

// ---------- Workflow Definition Language (Power Automate flows, Logic Apps templates)
function wdl(text) {
  const j = JSON.parse(text); const def = j.properties?.definition ?? j.definition ?? j;
  const f = { actions: 0, types: {}, triggers: Object.entries(def.triggers ?? {}).map(([n, t]) => ({ n, type: t.type, kind: t.kind, recurrence: !!t.recurrence, splitOn: !!t.splitOn })), until: 0, untilNoCount: 0, foreach: 0, ifs: 0, scopes: 0, runAfterFailed: 0, terminate: 0, wait: 0, approvals: 0, switches: 0, vars: 0, parallelSiblings: 0 };
  const walk = (acts) => {
    const names = Object.keys(acts ?? {});
    // siblings with identical runAfter sets run concurrently
    const bySet = {}; for (const n of names) { const k = JSON.stringify(acts[n].runAfter ?? {}); (bySet[k] ??= []).push(n); }
    for (const [k, v] of Object.entries(bySet)) if (v.length > 1 && k !== '{}') f.parallelSiblings += v.length;
    for (const [n, a] of Object.entries(acts ?? {})) {
      f.actions++; f.types[a.type] = (f.types[a.type] ?? 0) + 1;
      if (a.type === 'Until') { f.until++; if (!(a.limit && a.limit.count)) f.untilNoCount++; }
      if (a.type === 'Foreach') f.foreach++; if (a.type === 'If') f.ifs++; if (a.type === 'Switch') f.switches++; if (a.type === 'Scope') f.scopes++;
      if (a.type === 'Terminate') f.terminate++; if (a.type === 'Wait') f.wait++; if (/Approval/i.test(JSON.stringify(a.inputs ?? {}).slice(0, 4000)) && /approval/i.test(JSON.stringify(a.inputs?.host ?? a.inputs?.path ?? ''))) f.approvals++;
      if (/Initialize|SetVariable|Append/.test(a.type)) f.vars++;
      if (Object.values(a.runAfter ?? {}).some((s) => s.includes('Failed') || s.includes('TimedOut'))) f.runAfterFailed++;
      walk(a.actions); walk(a.else?.actions); for (const c of Object.values(a.cases ?? {})) walk(c.actions); walk(a.default?.actions);
    }
  };
  walk(def.actions);
  const s = JSON.stringify(def);
  return { ...f, clock: count(/utcnow|utcNow|getFutureTime|getPastTime/g, s), random: count(/\brand\(|guid\(/gi, s), delayUntil: count(/"until":\s*\{\s*"timestamp/g, s), pagination: count(/paginationPolicy/g, s), secretsLiteral: count(/"(password|apiKey|secret)"\s*:\s*"[^@"$][^"]*"/gi, s) };
}

// ---------- Step Functions ASL
function asl(text) {
  const j = JSON.parse(text); const types = {}; let retry = 0, catches = 0, sync = 0, callback = 0, uuid = 0, ctx = 0, wait = 0, maps = 0, parallel = 0, states = 0; const edges = {};
  const walk = (sm, prefix) => {
    for (const [n, s] of Object.entries(sm.States ?? {})) {
      states++; types[s.Type] = (types[s.Type] ?? 0) + 1; const id = prefix + n;
      if (s.Retry) retry += s.Retry.length; if (s.Catch) catches += s.Catch.length;
      if (/\.sync/.test(s.Resource ?? '')) sync++; if (/waitForTaskToken/.test(s.Resource ?? '')) callback++;
      if (s.Type === 'Wait') wait++; if (s.Type === 'Map') maps++; if (s.Type === 'Parallel') parallel++;
      const out = []; if (s.Next) out.push(s.Next); for (const c of s.Choices ?? []) out.push(c.Next); if (s.Default) out.push(s.Default); for (const c of s.Catch ?? []) out.push(c.Next);
      edges[id] = out.map((x) => prefix + x);
      for (const b of s.Branches ?? []) walk(b, id + '/'); if (s.ItemProcessor) walk(s.ItemProcessor, id + '/'); if (s.Iterator) walk(s.Iterator, id + '/');
    }
  };
  walk(j, '');
  // back edges (cycles) by DFS within each prefix scope
  let cycles = 0; const state = {};
  const dfs = (u) => { state[u] = 1; for (const v of edges[u] ?? []) { if (!(v in edges)) continue; if (state[v] === 1) cycles++; else if (!state[v]) dfs(v); } state[u] = 2; };
  for (const u of Object.keys(edges)) if (!state[u]) dfs(u);
  const s = text;
  return { states, types, retry, catches, sync, callback, wait, maps, parallel, cycles, uuid: count(/States\.UUID/g, s), clock: count(/\$\$\.Execution\.StartTime|\$\$\.State\.EnteredTime|States\.Now/g, s), random: count(/States\.MathRandom|States\.UUID/g, s), timeout: count(/TimeoutSeconds/g, s) };
}

const EXTRACT = { windmill, kestra, 'power-automate': wdl, 'step-functions': asl, 'logic-apps': wdl };

// labels: last row per id
const labels = new Map();
for (const l of rd(path.join(HERE, 'labels.jsonl')).trim().split('\n').filter(Boolean)) { const r = JSON.parse(l); labels.set(r.id, r); }

const out = []; const issues = [];
for (const p of PLATFORMS) {
  const m = JSON.parse(rd(path.join(HERE, p, 'MANIFEST.json')));
  for (const wf of m.workflows) {
    const id = `${p}:${wf.id}`; const lab = labels.get(id);
    const feat = EXTRACT[p](rd(path.join(HERE, p, wf.file)));
    const row = { platform: p, id, file: wf.file, bytes: wf.bytes, features: feat, labelled: !!lab };
    out.push(row);
    if (!lab) { issues.push({ id, issue: 'no label row' }); continue; }
    const l0 = new Set(lab.l0); const gapText = JSON.stringify(lab.gaps).toLowerCase();
    const has = (...k) => k.some((x) => l0.has(x));
    const chk = (cond, msg) => { if (cond) issues.push({ id, issue: msg }); };
    if (p === 'windmill') {
      chk(feat.suspend > 0 && !has('approve', 'wait.signal'), 'suspend step but no approve/wait.signal in l0');
      chk(feat.loops > 0 && !has('map', 'for'), 'loop module but no map/for in l0');
      chk(feat.branch > 0 && !has('if', 'map'), 'branch module but no if in l0');
      chk(feat.skipFailures > 0 && !/skip_failures|per-item failure/.test(gapText), 'skip_failures present but no per-item failure policy gap');
      chk(feat.state > 0 && !has('state'), 'getState/setState but no state in l0');
      chk((feat.clock + feat.random) > 0 && !/clock|random|wall/.test(gapText), 'clock or randomness in code but no clock/random gap');
    }
    if (p === 'kestra') {
      chk(feat.errors > 0 && !has('route.error'), 'errors: block but no route.error in l0');
      chk(feat.pause > 0 && !has('approve', 'ask', 'wait.signal'), 'Pause but no approve/ask in l0');
      chk(feat.loops > 0 && !has('map', 'for'), 'Loop/ForEach but no map/for');
      chk(feat.schedule > 0 && !has('trigger.schedule'), 'Schedule trigger but no trigger.schedule');
      chk(feat.webhook > 0 && !has('trigger.webhook'), 'Webhook trigger but no trigger.webhook');
      chk(feat.kv > 0 && !has('state'), 'KV store used but no state');
      chk(feat.ifs > 0 && !has('if'), 'If/Switch but no if');
      chk(feat.clock > 0 && !/clock|wall/.test(gapText), 'now()/dateAdd used but no clock gap');
      chk(feat.ai > 0, 'plugin.ai task present: check agent/judge reading');
    }
    if (p === 'power-automate' || p === 'logic-apps') {
      chk(feat.runAfterFailed > 0 && !has('route.error', 'finally', 'retry'), 'runAfter Failed/TimedOut but no route.error/finally');
      chk(feat.foreach > 0 && !has('map'), 'Foreach but no map');
      chk(feat.until > 0 && !has('for'), 'Until but no for');
      chk(feat.untilNoCount > 0 && !/cap|count|rewrite/.test(gapText), 'Until with no count limit but no cap gap');
      chk(feat.wait > 0 && !has('wait.delay', 'wait.signal'), 'Wait action but no wait.*');
      chk(feat.delayUntil > 0 && !/timestamp|delay until|absolute/.test(gapText), 'delay-until but no gap');
      chk(feat.terminate > 0 && !/terminate|run status|runstatus/.test(gapText), 'Terminate but no run-status gap');
      chk((feat.clock + feat.random) > 0 && !/clock|random|wall/.test(gapText), 'clock or randomness expression but no gap');
      chk(feat.triggers.some((t) => t.recurrence && t.type === 'Recurrence') && !has('trigger.schedule'), 'Recurrence trigger but no trigger.schedule');
      chk(feat.triggers.some((t) => t.recurrence && t.type !== 'Recurrence') && !has('trigger.poll', 'stream'), 'polling trigger but no trigger.poll');
      chk(feat.parallelSiblings > 0 && !has('map'), 'concurrent siblings (same runAfter) but no map/parallel note');
    }
    if (p === 'step-functions') {
      chk(feat.retry > 0 && !has('retry'), 'Retry but no retry in l0');
      chk(feat.catches > 0 && !has('route.error'), 'Catch but no route.error');
      chk(feat.wait > 0 && !has('wait.delay'), 'Wait state but no wait.delay');
      chk(feat.maps > 0 && !has('map'), 'Map state but no map');
      chk(feat.parallel > 0 && !has('map'), 'Parallel state but no map/parallel');
      chk(feat.cycles > 0 && !/loop|cycle|cap|poll|paginat/.test(gapText), 'state cycle but no unbounded-loop gap');
      chk(feat.uuid > 0 && !/random|uuid/.test(gapText), 'States.UUID but no randomness gap');
      chk(feat.sync > 0 && !has('wait.signal', 'wait.delay'), '.sync integration but no wait');
      chk(feat.callback > 0 && !has('wait.signal'), 'waitForTaskToken but no wait.signal');
    }
  }
}
fs.writeFileSync(path.join(HERE, 'features.json'), JSON.stringify({ made: new Date().toISOString(), note: 'PREREG §5: mechanical features and label-vs-definition discrepancies; a recall check on the labeller, not a second labeller', rows: out, issues }, null, 1) + '\n');
console.log(out.length, 'workflows;', issues.length, 'issues');
for (const i of issues) console.log(' -', i.id.replace(/^(.{70}).*$/, '$1…'), '|', i.issue);
