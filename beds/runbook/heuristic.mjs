// Triviality attack (audit step 4): <=40 lines (<=200 chars each, excluding this header) of deterministic regex policy.
// Reads only prompt, inputs and env text observations; generalises the phrasings seen in dev tasks (clause polarity,
// endorsements by handle, relative values, node references, threshold wordings). Never reads world/plan/spec.
import { createEnv } from './index.mjs';
const W = { one: 1, two: 2, three: 3, four: 4, five: 5, once: 1, twice: 2 }, N = s => W[s] ?? +s, esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SW = 'fifteen 15|quarter of a minute 15|twenty 20|third of a minute 20|thirty 30|half a minute 30|forty-five 45|three quarters of a minute 45|sixty 60|one minute 60|full minute 60'
  + '|ninety 90|minute and a half 90|one and a half minutes 90|two minutes 120|hundred and twenty 120|half an hour 1800|thirty minutes 1800|forty-five minutes 2700|three quarters of an hour 2700|one hour 3600|an hour 3600';
const SEC = SW.split('|').map(x => [x.replace(/ \d+$/, ''), +x.match(/\d+$/)[0]]).sort((a, b) => b[0].length - a[0].length), sec = p => +(/^(\d+) s/.exec(p)?.[1] ?? SEC.find(([k]) => p.includes(k))?.[1]);
const cnt = p => { const m = /(\w+) (?:readings|attempts) in (?:total|all)/.exec(p); if (m) return N(m[1]) - 1; const n = /at most (\w+)|up to (\w+)|no more than (\w+)/.exec(p); return N(n[1] ?? n[2] ?? n[3]); };
const PW = { 'half a percent': 0.5, 'one percent': 1, 'two percent': 2, 'two and a half percent': 2.5, 'four percent': 4, 'five percent': 5 }, MON = 'JanFebMarAprMayJunJulAugSepOctNovDec';
const pct = p => { let m; if ((m = /^([\d.]+)%/.exec(p))) return +m[1]; if ((m = /^([\d.]+) errors/.exec(p))) return m[1] / 10; if ((m = /in (\d+)/.exec(p))) return 100 / m[1]; if ((m = /^(0\.\d+) \(/.exec(p))) return m[1] * 100; return PW[p]; };
const ts = s => { let m = /(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)/.exec(s); if (m) return Date.UTC(m[1], m[2] - 1, m[3], m[4], m[5]) / 1000; m = /(\d+) (\w{3}) (\d{4}) (\d\d):(\d\d)/.exec(s); return Date.UTC(m[3], MON.indexOf(m[2]) / 3, m[1], m[4], m[5]) / 1000; };
const HEDGE = /\b(may|might|if that happens|I'll post here|checking|Asking|at one point|not decided|no change for now)\b|\?|Thanks @|Noted, @|Not for this change|appreciated, but|No, @|we keep the approved/;
const NEG = /\b(not|no|forget|out|withdrawn|pulled|off the table|no longer|isn't|only a candidate|in soak|don't|floated|too aggressive|old load-test|outdated|first guess|ramps too fast|was the)\b/;
const pos = c => c.split(/[;(]|\. | — /).filter(x => !NEG.test(x)).join(' | ');
export function heuristicSolve(task) {
  const env = createEnv(task), T = task.inputs.ticket, R = task.inputs.runbook, RN = task.inputs.releaseNotes ?? '', inv = task.inputs.inventory.split('\n').slice(4).map(l => l.split(' | '));
  const acts = [], go = a => { acts.push(a); return env.step(a).observation ?? ''; }, q = target => go({ op: 'query', target }), wait = n => go({ op: 'wait', seconds: Math.max(1, Math.min(21600, Math.ceil(n))) });
  const [, own] = /Change owner: .*?\(@([\w-]+)\)/.exec(T), [, apr] = /Approver \(CAB\): .*?\(@([\w-]+)\)/.exec(T), tz = +/UTC([+-]\d+)/.exec(T)[1], local = !/window: \d{4}/.test(T);
  const all = [...T.matchAll(/\] [^\n]*?\(@([\w-]+)\):\n {2}([^\n]*)/g)], by = h => all.filter(m => m[1] === h).map(m => m[2]).join(' ');
  const dec = all.filter(m => m[1] === own || m[1] === apr).map(m => m[2]).filter(c => !HEDGE.test(c) || /can't|isn't|No need/.test(c)).map(c => c.replace(/@([\w-]+)(?:'s| said| is right| says| —)/g, (x, h) => ` ${by(h)} `));
  const pool = /\((lbp-[\w-]+)\)/.exec(T)[1], ff = /\+ (ff_\w+)/.exec(T)[1], svc = /upgrade of (\S+) behind/.exec(R)[1], key = s => new RegExp(`([\\w.-]+${s})`).exec(T)?.[1], kMax = key('max_inflight'), kSlow = key('slow_start_s'), kWm = key('work_mem_mb');
  const [, vB] = /upgrade: .*? (\S+) \+/.exec(T), vNext = vB.replace(/\d+$/, x => +x + 1);
  let ver = vB; for (const c of dec) { const vs = (pos(c).match(/\d+\.\d+\.\d+(?!-rc)\b/g) ?? []); if (/reinstated|Forget what I said/.test(c)) ver = vB; else if (/next patch|fixes the settlement/.test(c)) ver = vNext; else if (vs.length) ver = vs.find(v => v !== vB) ?? vB; }
  const desc = k => new RegExp(`${esc(k)}(?: to| =) (\\d+)`).exec(T)?.[1], vendor = /suggest (\d+)/.exec(RN)?.[1];
  const num = (k, D, skip) => dec.filter(c => c.includes(k)).reduce((v, c) => { if (skip && skip.test(c)) return null; const m = /(\d+)(?: seconds| MB)? (above|below)|(add|subtract) (\d+)/.exec(c);
    if (m) return String(+D + (/above|add/.test(m[2] ?? m[3]) ? 1 : -1) * +(m[1] ?? m[4])); if (/vendor's suggestion|release-notes number/.test(c)) return vendor; if (/description value|description stands/.test(c)) return D;
    const ns = pos(c.replaceAll(k, '')).match(/\b\d{2,4}\b/g) ?? []; return ns.length ? ns[0] : v; }, D);
  const max = num(kMax, desc(kMax), /not touch|Drop the|stays at its current|no \S+ change|leave it where/), slow = num(kSlow, desc(kSlow)), wm = kWm && num(kWm, desc(kWm));
  const prow = inv.filter(r => r[5] === pool), inc = r => /INC-\d+/.exec(r[10])?.[0] ?? '#', refs = c => prow.filter(r => c.includes(r[0]) || new RegExp(`\\b${esc(r[1])}\\b`).test(c)
    || c.includes(`rack ${r[6]}`) || c.includes(`patched ${r[9].replace('d', '')} days`) || new RegExp(`(?:under|covered by) ${inc(r)}|${inc(r)} is closed`).test(c)).map(r => r[0]);
  const incl = dec.filter(c => /include it|bring it into|add it to the rollout|with the rest|normal target|goes in with/i.test(c)).flatMap(c => refs(pos(c))), excl = dec.filter(c => /drain it|out of rotation before/i.test(c)).flatMap(c => refs(c.split(/Everything else/)[0]));
  let ws = ts(/window: (.*?) to /.exec(T)[1]) - (local ? tz * 3600 : 0), m;
  for (const c of dec) { if ((m = /now runs (.*?) to /.exec(c))) ws = ts(m[1]) - (local ? tz * 3600 : 0); else if ((m = /(?:opens|begin) (.+?) later than/.exec(c))) ws += sec(m[1]); else if ((m = /(?:start at|start then|starts? at|before) (\d\d):(\d\d)/.exec(c))) { const o = /(?:instead of|no longer works|was) (\d\d):(\d\d)/.exec(c) ?? [0, ...(local ? /(\d\d):(\d\d) to/.exec(T).slice(1) : /window: \S+ (\d\d):(\d\d)/.exec(T).slice(1))]; ws += (((m[1] - o[1]) * 60 + (m[2] - o[2])) * 60 + 86400) % 86400; } }
  const lm = /above (.+?), wait (.+?) and query\(db\) again; (.+?)\. If the lag/.exec(R), lagT = sec(lm[1]), lagW = sec(lm[2]), lagN = cnt(lm[3]), hm = /warms up: wait (.+?) and re-check; (.+?)\. If|degraded, wait (.+?) and re-check;? \(?(.+?)[.)]/.exec(R);
  const hW = /replication re-check/.test(hm[1] ?? hm[3]) ? lagW : sec(hm[1] ?? hm[3]), hN = /as many times as/.test(hm[2] ?? hm[4]) ? lagN : cnt(hm[2] ?? hm[4]), rN = cnt(/A transient (?:restart )?failure (?:\([^)]*\) )?(.+?)[.;]/.exec(R)[1]);
  const errT = pct(/(?:error rate|reading is) above (.+?), (?:switch|set_flag)/.exec(R)[1]), gap = sec(/again at least (.+?) later/.exec(R)[1]), now = () => ts(q('clock')), lag = () => +/lag[^:]*: ([\d.]+)s/.exec(q('db'))[1];
  const t0 = now(); if (t0 < ws) wait(ws - t0 + 5); for (let i = 0; ; i++) { if (lag() <= lagT) break; if (i === lagN) { go({ op: 'page_human', reason: 'replica lag stalled' }); return { actions: acts }; } wait(lagW); }
  const apply = (k, v) => { for (let i = 0; i < 4; i++) { const o = go({ op: 'apply_config', key: k, value: String(v) }); if (/ -> /.test(o)) return 'ok'; if (/REJECTED/.test(o)) return 'rej'; wait(15); } };
  const restart = (s, n) => { for (let i = 0; i <= rN; i++) { const o = go({ op: 'restart', service: s, node: n }); if (/process restarted/.test(o)) return true; if (/permanent/.test(o)) return false; if (i < rN) wait(10); } return false; };
  const inSvc = [...q(`lb:${pool}`).matchAll(/ {2}(\S+)\s+in_service/g)].map(x => x[1]), canary = inv.find(r => /canary/.test(r[10]))[0], nodes = [...new Set([...inSvc, ...incl])].filter(n => n !== canary && !excl.includes(n));
  go({ op: 'set_flag', name: 'ops.maintenance_banner', value: true }); apply(`${svc}.version_pin`, ver);
  for (const n of nodes) {
    if (inSvc.includes(n)) { go({ op: 'drain', node: n }); while (!/active_connections=0\b/.test(q(`node:${n}`))) wait(15); }
    if (!restart(svc, n)) { go({ op: 'page_human', reason: `${n} restart failed` }); continue; }
    let ok = false; for (let k = 0; k <= hN && !ok; k++) { if (k) wait(hW); ok = new RegExp(`${svc}\\s+version=${esc(ver)}\\s+health=ok`).test(q(`node:${n}`)); }
    go(ok ? { op: 'undrain', node: n } : { op: 'page_human', reason: `${n} still degraded` });
  }
  const paused = /\(([\w.]+consumers_paused), true\)/.exec(R)?.[1], wk = inv.filter(r => r[3] === 'worker' && !/decommission|retired|replaced|returned/.test(r[10]) && r[2] === pool.split('-')[1]);
  if (paused) { go({ op: 'set_flag', name: paused, value: true }); for (const r of wk) { restart(`${svc}-worker`, r[0]); q(`node:${r[0]}`); } go({ op: 'set_flag', name: paused, value: false }); }
  if (/apply_config\([\w.-]+work_mem_mb/.test(R) && apply(kWm, wm) === 'ok') { const db = q('db'); go({ op: 'restart', service: 'postgres', node: /(\S+)\s+role=replica/.exec(db)[1] }); while (lag() > lagT) wait(30);
    const d = new Date((now() + tz * 3600) * 1000); if (d.getUTCDay() % 6 === 0 || d.getUTCHours() < 8 || d.getUTCHours() >= 18) { go({ op: 'restart', service: 'postgres', node: /(\S+)\s+role=primary/.exec(db)[1] }); q('db'); } }
  const did = max != null && apply(kMax, max) === 'ok';
  if (apply(kSlow, slow) === 'rej') { if (did) go({ op: 'rollback_config', key: kMax }); go({ op: 'page_human', reason: 'slow start rejected' }); }
  else { for (const x of excl) go({ op: 'drain', node: x }); go({ op: 'set_flag', name: ff, value: true }); for (let k = 0; k < 2; k++) { if (k) wait(gap + 5); if (+/error_rate[^=]*= ([\d.]+)/.exec(q(`service:${svc}`))[1] > errT) { go({ op: 'set_flag', name: ff, value: false }); go({ op: 'page_human', reason: 'spike' }); break; } } }
  go({ op: 'set_flag', name: 'ops.maintenance_banner', value: false }); return { actions: acts };
}
