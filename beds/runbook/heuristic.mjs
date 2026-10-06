// Triviality attack (audit step 4): a <=40-line deterministic regex policy that reads only the prompt, the inputs and
// the env's text observations (what any agent sees) and encodes what a script author learns from a few dev tasks.
// It never reads world/plan/spec. Not part of the oracle; tests assert it stays below 20% at difficulty 3.
import { createEnv } from './index.mjs';
const WORD = { two: 2, three: 3, four: 4, fifteen: 15, twenty: 20, thirty: 30, 'forty-five': 45, sixty: 60, ninety: 90 };
const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const ts = s => { let m = /(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d) UTC/.exec(s); if (m) return Date.UTC(m[1], m[2] - 1, m[3], m[4], m[5]) / 1000; m = /(\d+) (\w{3}) (\d{4}) (\d\d):(\d\d)/.exec(s); return m && Date.UTC(m[3], MON[m[2]], m[1], m[4], m[5]) / 1000; };
export function heuristicSolve(task) {
  const env = createEnv(task), T = task.inputs.ticket, R = task.inputs.runbook, inv = task.inputs.inventory.split('\n').map(l => l.split(' | '));
  const acts = [], go = a => { acts.push(a); return env.step(a).observation ?? ''; }, wait = n => go({ op: 'wait', seconds: Math.max(1, Math.min(21600, Math.ceil(n))) });
  const own = T.match(/Change owner: .*?\(@([\w-]+)\)/)[1], apr = T.match(/Approver \(CAB\): .*?\(@([\w-]+)\)/)[1];
  const auth = [...T.matchAll(/\] [^\n]*?\(@([\w-]+)\):\n {2}([^\n]*)/g)].filter(m => m[1] === own || m[1] === apr).map(m => m[2]);
  const pool = /\((lbp-[\w-]+)\)/.exec(T)[1], ff = /\+ (ff_\w+)/.exec(T)[1], svc = /Rolling upgrade of (\S+) behind/.exec(R)[1], tz = Number(/\(UTC([+-]\d+)\)|local time is UTC([+-]\d+)/.exec(T).slice(1).find(Boolean));
  const keyOf = suf => new RegExp(`([\\w.-]+${suf})`).exec(T)?.[1], kPin = `${svc}.version_pin`, kMax = keyOf('max_inflight'), kSlow = keyOf('slow_start_s'), kWm = keyOf('work_mem_mb');
  const val = k => k && new RegExp(`${k.replace(/\./g, '\\.')}(?: to| =) (\\d+)`).exec(T)?.[1];
  let max = val(kMax), wm = val(kWm); const slow = val(kSlow);
  for (const c of auth) { if (/max_inflight/.test(c)) max = /not touch|leave .*unchanged/i.test(c) ? null : (/(?:use|be) (\d+)/.exec(c)?.[1] ?? max); if (/work_mem/.test(c)) wm = /to (\d+), not/.exec(c)?.[1] ?? wm; }
  const [ws, we] = /Approved change window: (.*?) to (.*?)(?:\(|, \w)/.exec(T).slice(1).map(s => ts(s) - (/UTC/.test(s) ? 0 : tz * 3600));
  const errT = 2.0, now = () => ts(go({ op: 'query', target: 'clock' }).replace(/T(\d\d:\d\d).*/, ' $1 UTC'));
  const lbView = go({ op: 'query', target: `lb:${pool}` }), inSvc = [...lbView.matchAll(/ {2}(\S+)\s+in_service/g)].map(m => m[1]);
  const ver = id => /version=(\S+)/.exec(go({ op: 'query', target: `node:${id}` }))[1], vers = inSvc.map(ver), cnt = v => vers.filter(x => x === v).length;
  const canaryV = vers.find(v => cnt(v) === 1), canary = inSvc[vers.indexOf(canaryV)], target = canaryV, nodes = inSvc.filter(n => n !== canary);
  const t0 = now(); if (t0 < ws) wait(ws - t0 + 5);
  const lag = () => Number(/replication lag[^:]*: ([\d.]+)s/.exec(go({ op: 'query', target: 'db' }))[1]);
  for (let i = 0; ; i++) { if (lag() < 10) break; if (i === 3) { go({ op: 'page_human', reason: 'replica lag stalled' }); return { actions: acts }; } wait(90); }
  const apply = (key, v) => { for (let i = 0; i < 4; i++) { const o = go({ op: 'apply_config', key, value: String(v) }); if (/ -> /.test(o)) return 'ok'; if (/REJECTED/.test(o)) return 'rej'; wait(15); } };
  const restart = (s, n) => { for (let i = 0; i < 3; i++) { const o = go({ op: 'restart', service: s, node: n }); if (/process restarted/.test(o)) return true; if (/permanent/.test(o)) return false; wait(10); } return false; };
  go({ op: 'set_flag', name: 'ops.maintenance_banner', value: true }); apply(kPin, target);
  for (const n of nodes) {
    go({ op: 'drain', node: n }); while (!/active_connections=0\b/.test(go({ op: 'query', target: `node:${n}` }))) wait(15);
    if (!restart(svc, n)) { go({ op: 'page_human', reason: `${n} restart failed permanently` }); continue; }
    let ok = false; for (let k = 0; k < 4 && !ok; k++) { if (k) wait(60); ok = new RegExp(`${svc}\\s+version=${target.replace(/\./g, '\\.')}\\s+health=ok`).test(go({ op: 'query', target: `node:${n}` })); }
    if (ok) go({ op: 'undrain', node: n }); else go({ op: 'page_human', reason: `${n} still degraded` });
  }
  const paused = /\(([\w.]+consumers_paused), true\)/.exec(R)?.[1];
  if (paused) { go({ op: 'set_flag', name: paused, value: true }); for (const r of inv.filter(r => r[3] === 'worker' && !/decommission/.test(r[10]))) { restart(`${svc}-worker`, r[0]); go({ op: 'query', target: `node:${r[0]}` }); } go({ op: 'set_flag', name: paused, value: false }); }
  if (/apply_config\([\w.-]+work_mem_mb/.test(R) && apply(kWm, wm) === 'ok') {
    const db = go({ op: 'query', target: 'db' }), rep = /(\S+)\s+role=replica/.exec(db)[1], pri = /(\S+)\s+role=primary/.exec(db)[1];
    go({ op: 'restart', service: 'postgres', node: rep }); while (lag() >= 10) wait(30);
    const d = new Date((now() + tz * 3600) * 1000); if (d.getUTCDay() % 6 === 0 || d.getUTCHours() < 8 || d.getUTCHours() >= 18) { go({ op: 'restart', service: 'postgres', node: pri }); go({ op: 'query', target: 'db' }); }
  }
  const did = max != null && apply(kMax, max) === 'ok';
  if (apply(kSlow, slow) === 'rej') { if (did) go({ op: 'rollback_config', key: kMax }); go({ op: 'page_human', reason: 'slow start rejected' }); }
  else { go({ op: 'set_flag', name: ff, value: true }); for (let k = 0; k < 2; k++) { if (k) wait(95); if (Number(/error_rate[^=]*= ([\d.]+)/.exec(go({ op: 'query', target: `service:${svc}` }))[1]) > errT) { go({ op: 'set_flag', name: ff, value: false }); go({ op: 'page_human', reason: 'error spike' }); break; } } }
  go({ op: 'set_flag', name: 'ops.maintenance_banner', value: false });
  return { actions: acts };
}
