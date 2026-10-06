// Oracle-side judgement for the `runbook` bed: expected end state per hidden scenario, replay of an
// episode record through a fresh Sim, and the pass rule / partial score documented in README.md.
import { Sim } from './sim.mjs';

export function expectation(world) {
  const { spec: sp, plan } = world;
  const init = new Sim(world).stateMap();
  const exp = { ...init };
  const ev = plan.events;
  if (ev.includes('stall')) return { init, exp, conds: [{ type: 'lag-stall', subject: sp.cluster }], verify: [] };
  const failed = new Set([plan.perm, plan.stuck].filter(Boolean));
  for (const id of sp.targets) {
    exp[`node:${id}.in_service`] = !failed.has(id);
    exp[`node:${id}.version`] = failed.has(id) ? undefined : sp.versionTo;
    exp[`node:${id}.health`] = failed.has(id) ? undefined : 'ok';
  }
  for (const w of sp.workers) { exp[`node:${w}.version`] = sp.versionTo; exp[`node:${w}.health`] = 'ok'; }
  const k = sp.keys, reject = ev.includes('reject');
  exp[`config:${k.pin}`] = sp.versionTo;
  if (!reject) {
    if (sp.maxInflight !== null) exp[`config:${k.maxInflight}`] = sp.maxInflight;
    exp[`config:${k.slowStart}`] = sp.slowStart;
  }
  if (sp.dbStep) {
    exp[`config:${k.workMem}`] = sp.workMem;
    exp[`db:${sp.db.replica}.pending_restart`] = false;
    exp[`db:${sp.db.primary}.pending_restart`] = !sp.primaryRestart;
  }
  exp[`flag:${sp.ff}`] = !(reject || ev.includes('spike'));
  exp[`flag:${sp.banner}`] = false;
  exp[`flag:${sp.paused}`] = false;
  const conds = [];
  if (plan.perm) conds.push({ type: 'restart-permanent', subject: plan.perm });
  if (plan.stuck) conds.push({ type: 'health-stuck', subject: plan.stuck });
  if (reject) conds.push({ type: 'config-rejected', subject: k.slowStart });
  if (ev.includes('spike')) conds.push({ type: 'error-spike', subject: sp.ff });
  const verify = [];
  if (exp[`flag:${sp.ff}`]) verify.push('flag');
  if (sp.workerStep) verify.push('workers');
  if (sp.dbStep) verify.push('db');
  return { init, exp, conds, verify };
}

export function replay(world, actions) {
  const sim = new Sim(world);
  for (const a of actions) sim.step(a);
  return sim;
}

export function judge(world, actions) {
  const sp = world.spec;
  const { init, exp, conds, verify } = expectation(world);
  const sim = replay(world, actions);
  const fin = sim.stateMap(), s = sim.s;
  const mismatches = [], collateral = [], clauses = [];
  for (const [field, want] of Object.entries(exp)) {
    if (want === undefined) continue;
    const got = fin[field];
    if (want !== init[field]) clauses.push({ id: `state:${field}`, ok: got === want });
    if (got !== want) {
      mismatches.push({ field, expected: want, found: got });
      if (want === init[field]) collateral.push(field);
    }
  }
  const compensations = conds.map(c => {
    const hit = s.conditions.find(x => x.type === c.type && x.subject === c.subject);
    return { id: `comp:${c.type}:${c.subject}`, observed: !!hit, paged: !!hit?.paged, ok: !!hit?.paged };
  });
  const verification = verify.map(v => {
    if (v === 'flag') {
      const after = s.serviceQueries.filter(q => q.ffOn && s.ffEnabledAt !== null && q.t >= s.ffEnabledAt).map(q => q.t);
      const ok = after.length >= 2 && after[after.length - 1] - after[0] >= sp.thr.errGap;
      return { id: 'verify:flag', ok, detail: `${after.length} error-rate readings after enabling ${sp.ff}` };
    }
    if (v === 'workers') {
      const missing = sp.workers.filter(w => { const r = s.hosts[w].services[sp.worker].lastRestartAt; return r === null || !(s.workerVerifiedAt[w] >= r); });
      return { id: 'verify:workers', ok: missing.length === 0, detail: missing.length ? `not queried after restart: ${missing.join(',')}` : 'all workers re-read' };
    }
    const ok = s.db.lastRestartAt !== null && s.db.lastQueryAt !== null && s.db.lastQueryAt >= s.db.lastRestartAt;
    return { id: 'verify:db', ok, detail: ok ? 'db re-read after last restart' : 'db not re-read after its last restart' };
  });
  const violations = s.violations.map(v => ({ action: v.i, code: v.code, detail: v.detail }));
  const all = [...clauses, ...compensations, ...verification];
  const pass = mismatches.length === 0 && violations.length === 0 && compensations.every(c => c.ok) && verification.every(v => v.ok);
  const frac = all.length ? all.filter(c => c.ok).length / all.length : 1;
  const score = pass ? 1 : Math.round(0.9 * frac / (1 + violations.length + collateral.length) * 10000) / 10000;
  return {
    pass, score,
    details: {
      actions: actions.length, goalClauses: clauses.length, goalClausesMet: clauses.filter(c => c.ok).length,
      mismatches: mismatches.slice(0, 40), mismatchCount: mismatches.length, collateral: collateral.length,
      violations: violations.slice(0, 40), violationCount: violations.length, compensations, verification,
      conditions: s.conditions.map(c => ({ action: c.i, type: c.type, subject: c.subject, paged: c.paged })),
      pages: s.pages.length, endClock: new Date(s.t * 1000).toISOString(),
    },
  };
}
