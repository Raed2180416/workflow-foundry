// Triviality attack (audit step 4): a <=40-line deterministic regex policy. It reads only the prompt, the inputs and the
// env's text observations (what any agent sees), knows every phrasing table and comment template the renderer uses, and
// never reads world/plan/spec. Not part of the oracle; tests assert it passes < 20% at difficulty 3. See AUDIT.md.
import { createEnv } from './index.mjs';
const W = { one: 1, two: 2, three: 3, four: 4, five: 5, once: 1, twice: 2 }, MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const SECW = { fifteen: 15, 'a quarter of a minute': 15, twenty: 20, 'a third of a minute': 20, thirty: 30, 'half a minute': 30, 'forty-five': 45, 'three quarters of a minute': 45, sixty: 60, 'one minute': 60, 'a full minute': 60, ninety: 90, 'a minute and a half': 90, 'one and a half minutes': 90, 'two minutes': 120, 'a hundred and twenty': 120, 'half an hour': 1800, 'thirty minutes': 1800, 'forty-five minutes': 2700, 'three quarters of an hour': 2700, 'one hour': 3600, 'an hour': 3600, 'ninety minutes': 5400, 'an hour and a half': 5400 };
const sec = p => { const m = /^(\d+) s/.exec(p); if (m) return +m[1]; return Object.entries(SECW).sort((a, b) => b[0].length - a[0].length).find(([k]) => p.startsWith(k))?.[1]; };
const cnt = p => { let m = /(\w+) (?:readings|attempts) in (?:total|all)/.exec(p); if (m) return (W[m[1]] ?? +m[1]) - 1; m = /at most (\w+)(?: times)?|up to (\w+) re-checks|no more than (\w+) retr/.exec(p); return W[m[1] ?? m[2] ?? m[3]] ?? +(m[1] ?? m[2] ?? m[3]); };
const pct = p => { let m = /^([\d.]+)%/.exec(p); if (m) return +m[1]; if ((m = /^([\d.]+) errors per thousand/.exec(p))) return m[1] / 10; if ((m = /one request in (\d+)/.exec(p))) return 100 / m[1]; return { 'half a percent': 0.5, 'one percent': 1, 'two percent': 2, 'two and a half percent': 2.5, 'four percent': 4, 'five percent': 5 }[p.replace(/,.*$/, '')]; };
const ts = s => { let m = /(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d) UTC/.exec(s); if (m) return Date.UTC(m[1], m[2] - 1, m[3], m[4], m[5]) / 1000; m = /(\d+) (\w{3}) (\d{4}) (\d\d):(\d\d)/.exec(s); return m && Date.UTC(m[3], MON[m[2]], m[1], m[4], m[5]) / 1000; };
const V = '(\\d+\\.\\d+\\.\\d+(?:-rc\\d)?)', last = (cs, res, init) => cs.reduce((v, c) => { for (const re of res) { const m = re.exec(c); if (m) return m[1] === undefined ? null : m[1]; } return v; }, init);
export function heuristicSolve(task) {
  const env = createEnv(task), T = task.inputs.ticket, R = task.inputs.runbook, inv = task.inputs.inventory.split('\n').slice(4).map(l => l.split(' | '));
  const acts = [], go = a => { acts.push(a); return env.step(a).observation ?? ''; }, wait = n => go({ op: 'wait', seconds: Math.max(1, Math.min(21600, Math.ceil(n))) }), q = target => go({ op: 'query', target });
  const own = T.match(/Change owner: .*?\(@([\w-]+)\)/)[1], apr = T.match(/Approver \(CAB\): .*?\(@([\w-]+)\)/)[1], tz = Number(/\(UTC([+-]\d+)\)|local time is UTC([+-]\d+)/.exec(T).slice(1).find(Boolean));
  const auth = [...T.matchAll(/\] [^\n]*?\(@([\w-]+)\):\n {2}([^\n]*)/g)].filter(m => m[1] === own || m[1] === apr).map(m => m[2]);
  const pool = /\((lbp-[\w-]+)\)/.exec(T)[1], ff = /\+ (ff_\w+)/.exec(T)[1], svc = /Rolling upgrade of (\S+) behind/.exec(R)[1], key = suf => new RegExp(`([\\w.-]+${suf})`).exec(T)?.[1];
  const kPin = `${svc}.version_pin`, kMax = key('max_inflight'), kSlow = key('slow_start_s'), kWm = key('work_mem_mb'), d = s => new RegExp(`${s.replace(/\./g, '\\.')}(?: to| =) (\\d+)`).exec(T)?.[1];
  const ver = last(auth, [new RegExp(`Roll ${V} instead|Use ${V} for this change|going with ${V}|build for tonight is ${V}|replacement build ${V}|roll ${V} as in|stay on ${V}|ships ${V}|${V} is the build|Use ${V} instead`)].map(re => ({ exec: c => { const m = re.exec(c); return m && [0, m.slice(1).find(Boolean)]; } })), /\+ ff/.test(T) && /Rolling upgrade: .*? (\S+) \+/.exec(T)[1]);
  const max = last(auth, [/(?:not touch|Drop the|stays at its current value)()/, /use (\d+) for|should be (\d+)|signed off on (\d+)|Set it to (\d+)|max_inflight: (\d+)\.|keep (\d+) from/].map(re => ({ exec: c => /max_inflight/.test(c) && re.exec(c) && [0, re.exec(c).slice(1).find(x => x !== undefined && x !== '')] })), d(kMax));
  const slow = last(auth, [/slow_start_s to (\d+)|make it (\d+)|slow_start_s = (\d+)|make \S+ (\d+) instead|Keep \S+ at (\d+)/].map(re => ({ exec: c => re.exec(c) && [0, re.exec(c).slice(1).find(Boolean)] })), d(kSlow));
  const wm = last(auth, [/work_mem_mb to (\d+), not|settled on (\d+)|parameter: (\d+)/].map(re => ({ exec: c => re.exec(c) && [0, re.exec(c).slice(1).find(Boolean)] })), kWm && d(kWm));
  const refs = c => inv.filter(r => c.includes(r[0]) || (r[1] && new RegExp(`\\b${r[1].replace(/\./g, '\\.')}\\b`).test(c)) || (/INC-\d+/.test(r[10]) && c.includes(/INC-\d+/.exec(r[10])[0]) && /host (it covered|under)/.test(c))).map(r => r[0]);
  const incl = auth.filter(c => /Include it|upgrade it with the rest|Bring that host|Add it to the rollout/.test(c)).flatMap(refs), excl = auth.filter(c => /out of the upgrade|don't upgrade|is spoken for/.test(c)).flatMap(refs);
  let [ws] = /Approved change window: (.*?) to /.exec(T).slice(1).map(s => ts(s) - (/UTC/.test(s) ? 0 : tz * 3600)), m;
  for (const c of auth) { if ((m = /now runs (.*?) to /.exec(c))) ws = ts(m[1]) - (/UTC/.test(m[1]) ? 0 : tz * 3600); else if ((m = /opens (.+?) later than/.exec(c))) ws += sec(m[1]); else if ((m = /start at (\d\d):(\d\d) .*? instead of (\d\d):(\d\d)/.exec(c))) ws += (((m[1] - m[3]) * 60 + (m[2] - m[4])) * 60 + 86400) % 86400; }
  const lagM = /If it is above (.+?), wait (.+?) and query\(db\) again; (.+?)\. If the lag/.exec(R), lagT = sec(lagM[1]), lagW = sec(lagM[2]), lagN = cnt(lagM[3]);
  const hM = /wait (.+?) and re-check[;(]? ?(.+?)[.)]/.exec(R.slice(R.indexOf('degraded'))), hW = sec(hM[1]), hN = cnt(hM[2]), rN = cnt(/may be retried (.+?)[.;]/.exec(R)[1]), errT = pct(/(?:error rate|reading is) above (.+?), (?:switch|set_flag)/.exec(R)[1]), gap = sec(/again at least (.+?) later/.exec(R)[1]);
  const t0 = ts(q('clock').replace(/T(\d\d:\d\d).*/, ' $1 UTC')); if (t0 < ws) wait(ws - t0 + 65);
  const lag = () => Number(/replication lag[^:]*: ([\d.]+)s/.exec(q('db'))[1]);
  for (let i = 0; ; i++) { if (lag() <= lagT) break; if (i === lagN) { go({ op: 'page_human', reason: 'replica lag stalled' }); return { actions: acts }; } wait(lagW); }
  const apply = (k, v) => { for (let i = 0; i < 4; i++) { const o = go({ op: 'apply_config', key: k, value: String(v) }); if (/ -> /.test(o)) return 'ok'; if (/REJECTED/.test(o)) return 'rej'; wait(15); } };
  const restart = (s, n) => { for (let i = 0; i <= rN; i++) { const o = go({ op: 'restart', service: s, node: n }); if (/process restarted/.test(o)) return true; if (/permanent/.test(o)) return false; if (i < rN) wait(10); } return false; };
  const lbv = q(`lb:${pool}`), canary = inv.find(r => /canary/.test(r[10]))[0], inSvc = [...lbv.matchAll(/ {2}(\S+)\s+in_service/g)].map(x => x[1]);
  const nodes = [...new Set([...inSvc, ...incl])].filter(n => n !== canary && !excl.includes(n));
  go({ op: 'set_flag', name: 'ops.maintenance_banner', value: true }); apply(kPin, ver);
  for (const n of nodes) {
    if (inSvc.includes(n)) { go({ op: 'drain', node: n }); while (!/active_connections=0\b/.test(q(`node:${n}`))) wait(15); }
    if (!restart(svc, n)) { go({ op: 'page_human', reason: `${n} restart failed` }); continue; }
    let ok = false; for (let k = 0; k <= hN && !ok; k++) { if (k) wait(hW); ok = new RegExp(`${svc}\\s+version=${ver.replace(/\./g, '\\.')}\\s+health=ok`).test(q(`node:${n}`)); }
    go(ok ? { op: 'undrain', node: n } : { op: 'page_human', reason: `${n} still degraded` });
  }
  const paused = /\(([\w.]+consumers_paused), true\)/.exec(R)?.[1];
  if (paused) { go({ op: 'set_flag', name: paused, value: true }); for (const r of inv.filter(r => r[3] === 'worker' && !/decommission|retired|replaced/.test(r[10]))) { restart(`${svc}-worker`, r[0]); q(`node:${r[0]}`); } go({ op: 'set_flag', name: paused, value: false }); }
  if (/apply_config\([\w.-]+work_mem_mb/.test(R) && apply(kWm, wm) === 'ok') {
    const db = q('db'), rep = /(\S+)\s+role=replica/.exec(db)[1], pri = /(\S+)\s+role=primary/.exec(db)[1];
    go({ op: 'restart', service: 'postgres', node: rep }); while (lag() > lagT) wait(30);
    const dt = new Date((ts(q('clock').replace(/T(\d\d:\d\d).*/, ' $1 UTC')) + tz * 3600) * 1000); if (dt.getUTCDay() % 6 === 0 || dt.getUTCHours() < 8 || dt.getUTCHours() >= 18) { go({ op: 'restart', service: 'postgres', node: pri }); q('db'); }
  }
  const did = max != null && apply(kMax, max) === 'ok';
  if (apply(kSlow, slow) === 'rej') { if (did) go({ op: 'rollback_config', key: kMax }); go({ op: 'page_human', reason: 'slow start rejected' }); }
  else { for (const x of excl) go({ op: 'drain', node: x }); go({ op: 'set_flag', name: ff, value: true }); for (let k = 0; k < 2; k++) { if (k) wait(gap + 5); if (Number(/error_rate[^=]*= ([\d.]+)/.exec(q(`service:${svc}`))[1]) > errT) { go({ op: 'set_flag', name: ff, value: false }); go({ op: 'page_human', reason: 'error spike' }); break; } } }
  go({ op: 'set_flag', name: 'ops.maintenance_banner', value: false });
  return { actions: acts };
}
