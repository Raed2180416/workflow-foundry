// World generator for the `runbook` bed: a fictional site with an LB pool, queue workers, a
// primary/replica database, flags, a config store and a change window, plus the hidden failure
// plan. Everything is invented. Pure function of (seed, split, difficulty) via beds/lib/rng.mjs.
import { rng } from '../lib/rng.mjs';

export const WORLD_VERSION = '1.0.0';
export const DAY = 86400;
export const BASE_EPOCH = Date.UTC(2026, 0, 5) / 1000; // Monday 2026-01-05T00:00:00Z
export const MAX_WAIT = 21600;

// Per-difficulty knobs. README.md documents them; tests assert the generated sizes follow them.
export const KNOBS = {
  1: { targets: 3, quarantined: 0, green: 0, otherSites: 1, otherPerSite: 2, otherPool: 0, extras: 2, workers: 0, db: false,
    chatter: 2, distract: 0, amend: 0, retract: false, inject: 0, lookalike: false, startEarly: false, tzLocal: false,
    words: false, legacy: false, tips: false, staleDb: 0, changelog: false, handover: false, postmortem: false, transientRestart: [0, 0], transientConfig: [0, 0],
    degraded: [0, 1], maxF: 0, budget: 150, windowHours: 3, bleed: [10, 45] },
  2: { targets: 4, quarantined: 1, green: 2, otherSites: 2, otherPerSite: 3, otherPool: 0, extras: 3, workers: 0, db: false,
    chatter: 4, distract: 1, amend: 1, retract: false, inject: 0, lookalike: false, startEarly: false, tzLocal: false,
    words: false, legacy: false, tips: false, staleDb: 0, changelog: false, handover: false, postmortem: false, transientRestart: [1, 1], transientConfig: [0, 1],
    degraded: [1, 2], maxF: 1, budget: 200, windowHours: 3, bleed: [20, 120] },
  3: { targets: 6, quarantined: 1, green: 3, otherSites: 3, otherPerSite: 6, otherPool: 4, extras: 5, workers: 3, db: false,
    chatter: 9, distract: 2, amend: 2, retract: false, inject: 0, lookalike: false, startEarly: true, tzLocal: false,
    words: true, legacy: true, tips: false, staleDb: 0, changelog: false, handover: true, postmortem: false, transientRestart: [1, 2], transientConfig: [1, 1],
    degraded: [2, 3], maxF: 1, budget: 300, windowHours: 3, bleed: [20, 150] },
  4: { targets: 8, quarantined: 1, green: 4, otherSites: 4, otherPerSite: 8, otherPool: 5, extras: 7, workers: 3, db: true,
    chatter: 14, distract: 4, amend: 3, retract: false, inject: 2, lookalike: false, startEarly: true, tzLocal: true,
    words: true, legacy: true, tips: false, staleDb: 0.5, changelog: false, handover: true, postmortem: true, transientRestart: [2, 3], transientConfig: [1, 1],
    degraded: [2, 4], maxF: 1, budget: 400, windowHours: 4, bleed: [20, 150] },
  5: { targets: 11, quarantined: 2, green: 5, otherSites: 6, otherPerSite: 10, otherPool: 6, extras: 8, workers: 4, db: true,
    chatter: 22, distract: 7, amend: 3, retract: true, inject: 4, lookalike: true, startEarly: true, tzLocal: true,
    words: true, legacy: true, tips: true, staleDb: 0.6, changelog: true, handover: true, postmortem: true, transientRestart: [2, 4], transientConfig: [1, 2],
    degraded: [3, 5], maxF: 2, budget: 500, windowHours: 4, bleed: [20, 150] },
};

export const SITES = [
  { code: 'wmr', name: 'Westmarch' }, { code: 'nhl', name: 'Nordholm' }, { code: 'ebk', name: 'Eastbrook' },
  { code: 'svl', name: 'Southvale' }, { code: 'cdp', name: 'Cedarport' }, { code: 'hlx', name: 'Halix Bay' },
  { code: 'tvn', name: 'Tarven' }, { code: 'ost', name: 'Osterlund' }, { code: 'brw', name: 'Brackenwold' },
];
export const SERVICES = [
  { id: 'ledger-api', short: 'ldg', product: 'Ledger', alias: 'the Ledger API', team: 'payments' },
  { id: 'tessera-gw', short: 'tsr', product: 'Tessera', alias: 'the Tessera gateway', team: 'edge' },
  { id: 'quill-checkout', short: 'qck', product: 'Quill Checkout', alias: 'Quill checkout', team: 'checkout' },
  { id: 'marlin-search', short: 'mrl', product: 'Marlin', alias: 'Marlin search', team: 'discovery' },
  { id: 'orrery-pricing', short: 'orr', product: 'Orrery', alias: 'the Orrery pricing service', team: 'pricing' },
  { id: 'beacon-notify', short: 'bcn', product: 'Beacon', alias: 'Beacon notifications', team: 'messaging' },
  { id: 'cobalt-auth', short: 'cbt', product: 'Cobalt', alias: 'Cobalt auth', team: 'identity' },
];
const FEATURES = ['split_tender', 'async_settlement', 'smart_retry', 'edge_cache_v2', 'bulk_export', 'fuzzy_rank',
  'rate_card_v3', 'quiet_hours', 'token_rotation', 'lazy_hydration', 'partial_refunds', 'geo_fencing'];
export const PEOPLE = [
  ['Mireille Baptiste', 'mbaptiste'], ['Tomasz Okafor', 'tokafor'], ['Ragnhild Lindqvist', 'rlindqvist'],
  ['Desmond Achterberg', 'dachterberg'], ['Priya Venkataraman', 'pvenkat'], ['Oluwaseun Marchetti', 'omarchetti'],
  ['Henrike Vasquez', 'hvasquez'], ['Callum Nakashima', 'cnakashima'], ['Ines Abernathy', 'iabernathy'],
  ['Jovan Szabo', 'jszabo'], ['Linh Castellanos', 'lcastellanos'], ['Bartholomew Ilunga', 'bilunga'],
  ['Saoirse Delacroix', 'sdelacroix'], ['Kwabena Thorsen', 'kthorsen'], ['Yevgenia Pinto', 'ypinto'],
  ['Matthias Oyelaran', 'moyelaran'], ['Esperanza Holm', 'eholm'], ['Rafferty Kimura', 'rkimura'],
  ['Annelies Mbeki', 'ambeki'], ['Teodor Quispe', 'tquispe'], ['Wilhelmina Arcos', 'warcos'], ['Dario Fennimore', 'dfennimore'],
].map(([name, handle]) => ({ name, handle }));
const TZS = [-6, -5, -4, -3, 0, 1, 2, 3, 8, 9];
const EXTRA_ROLES = [
  ['cache', 'keydb', 'cache'], ['edge', 'haproxy', 'edge'], ['batch', 'cronrunner', 'batch'], ['obs', 'otel-collector', 'observability'],
  ['mq', 'rabbitmq', 'queue'], ['bastion', 'sshd', 'bastion'], ['search', 'opensearch', 'search'], ['vault', 'vault-agent', 'secrets'],
];

export const pad2 = n => String(n).padStart(2, '0');
export const sub = (seed, split, difficulty, label) => rng('runbook', WORLD_VERSION, split, seed, difficulty, label);

export function localParts(abs, tz) {
  const d = new Date((abs + tz * 3600) * 1000);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), wd: d.getUTCDay() };
}
export function inBusinessHours(abs, tz) {
  const p = localParts(abs, tz);
  return p.wd >= 1 && p.wd <= 5 && p.h >= 8 && p.h < 18;
}

function pickWeighted(r, pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let x = r.next() * total;
  for (const [v, w] of pairs) { if ((x -= w) < 0) return v; }
  return pairs[pairs.length - 1][0];
}

function chooseAmendments(r, difficulty, K) {
  if (!K.amend) return [];
  const pool = { 2: ['version', 'value', 'exclude', 'include'], 3: ['version', 'value', 'exclude', 'include'],
    4: ['version', 'value', 'exclude', 'include', 'skip', 'workmem'], 5: ['version', 'value', 'exclude', 'include', 'skip', 'workmem'] }[difficulty];
  for (;;) {
    const kinds = r.sample(pool, K.amend);
    const changing = kinds.some(k => ['version', 'include', 'exclude'].includes(k));
    const both = kinds.includes('value') && kinds.includes('skip');
    if (changing && !both && !(kinds.includes('include') && K.quarantined < 1)) return kinds;
  }
}

function chooseEvents(r, difficulty) {
  const primary = list => r.pick(list);
  if (difficulty === 1) return [primary(['reject', 'spike'])];
  if (difficulty === 2) return [primary(['reject', 'spike', 'perm'])];
  if (r.chance(0.08)) return ['stall'];
  if (difficulty === 3) return [primary(['reject', 'spike', 'perm'])];
  const ev = [primary(['reject', 'spike'])];
  if (difficulty === 4) { if (r.chance(0.5)) ev.push('perm'); return ev; }
  if (r.chance(0.6)) ev.push('perm');
  if (r.chance(0.5)) ev.push('stuck');
  return ev;
}

export function buildWorld(seed, split, difficulty) {
  const K = KNOBS[difficulty];
  if (!K) throw new Error(`runbook: difficulty must be 1..5, got ${difficulty}`);
  const rs = sub(seed, split, difficulty, 'structure');
  const site = rs.pick(SITES);
  const tz = rs.pick(TZS);
  const svc = rs.pick(SERVICES);
  const color = rs.pick(['blue', 'amber', 'violet', 'teal']);
  const pool = `lbp-${site.code}-${svc.short}-${color}`;
  const greenPool = `lbp-${site.code}-${svc.short}-green`;
  const ff = `ff_${svc.short}_${rs.pick(FEATURES)}`;
  const banner = 'ops.maintenance_banner';
  const paused = `queue.${svc.short}.consumers_paused`;
  const worker = `${svc.id}-worker`;
  const cluster = `pg-${site.code}`;
  const ticketId = `CHG-${rs.int(30000, 89999)}`;
  const incId = `INC-${rs.int(10000, 29999)}`;
  const rbId = `RB-${rs.int(100, 899)}`;
  const people = rs.sample(PEOPLE, 12);
  const owner = people[0], approver = people[1], requester = people[2];

  // Versions.
  const maj = rs.int(2, 7), min = rs.int(3, 19), pat = rs.int(0, 9);
  const vFrom = `${maj}.${min}.${pat}`;
  const vBase = `${maj}.${min + 1}.${rs.int(0, 4)}`;
  const vAmended = `${maj}.${min + 1}.${Number(vBase.split('.')[2]) + 1}`;
  const vRc = `${maj}.${min + 2}.0-rc${rs.int(1, 3)}`;

  // Amendments decide part of the truth.
  const ra = sub(seed, split, difficulty, 'amend');
  const kinds = chooseAmendments(ra, difficulty, K);
  const include = kinds.includes('include'), exclude = kinds.includes('exclude');
  const versionTo = kinds.includes('version') ? vAmended : vBase;

  // Pool composition: targets (incl. an 'included' formerly quarantined node), canary, quarantined, load-test.
  const roles = [];
  for (let i = 0; i < K.targets - (include ? 1 : 0); i++) roles.push('target');
  roles.push('canary');
  for (let i = 0; i < K.quarantined; i++) roles.push(include && i === 0 ? 'included' : 'quarantined');
  if (exclude) roles.push('loadtest');
  const shuffled = rs.shuffle(roles);
  const poolMembers = shuffled.map((role, i) => ({ id: `${site.code}-${svc.short}-${pad2(i + 1)}`, n: i + 1, role }));
  const targets = poolMembers.filter(m => m.role === 'target' || m.role === 'included').map(m => m.id).sort();
  const canary = poolMembers.find(m => m.role === 'canary').id;
  const quarantined = poolMembers.filter(m => m.role === 'quarantined').map(m => m.id);
  const includedNode = poolMembers.find(m => m.role === 'included')?.id ?? null;
  const loadtestNode = poolMembers.find(m => m.role === 'loadtest')?.id ?? null;
  const descQuarantined = poolMembers.filter(m => m.role === 'quarantined' || m.role === 'included').map(m => m.id);

  // Hosts.
  const hosts = [];
  const legacy = (short, n, code) => `${short}${n}.${code}`;
  for (const m of poolMembers) {
    const inService = !(m.role === 'quarantined' || m.role === 'loadtest');
    hosts.push({ id: m.id, aka: legacy(svc.short, m.n, site.code), site: site.code, role: 'web', pool, inService,
      services: { [svc.id]: m.role === 'canary' ? versionTo : vFrom, 'envoy': `1.${rs.int(27, 31)}.${rs.int(0, 6)}` },
      drainNote: m.role === 'quarantined' ? `quarantine ${incId}` : m.role === 'loadtest' ? 'load-test reservation' : null, member: m.role, app: svc.id });
  }
  for (let i = 0; i < K.green; i++) {
    const n = poolMembers.length + i + 1;
    hosts.push({ id: `${site.code}-${svc.short}-${pad2(n)}`, aka: legacy(svc.short, n, site.code), site: site.code, role: 'web', pool: greenPool,
      inService: true, services: { [svc.id]: vFrom, envoy: `1.${rs.int(27, 31)}.${rs.int(0, 6)}` }, drainNote: null, member: 'green', app: svc.id });
  }
  const otherSites = rs.sample(SITES.filter(s => s.code !== site.code), K.otherSites);
  for (const os of otherSites) {
    const otherVer = `${maj}.${min}.${rs.int(0, 9)}`;
    for (let i = 0; i < K.otherPerSite; i++) {
      hosts.push({ id: `${os.code}-${svc.short}-${pad2(i + 1)}`, aka: legacy(svc.short, i + 1, os.code), site: os.code, role: 'web',
        pool: `lbp-${os.code}-${svc.short}-blue`, inService: true, services: { [svc.id]: otherVer, envoy: `1.${rs.int(27, 31)}.0` }, drainNote: null, member: 'other-site', app: svc.id });
    }
  }
  const otherSvc = rs.pick(SERVICES.filter(s => s.id !== svc.id));
  const otherPoolId = `lbp-${site.code}-${otherSvc.short}-blue`;
  for (let i = 0; i < K.otherPool; i++) {
    hosts.push({ id: `${site.code}-${otherSvc.short}-${pad2(i + 1)}`, aka: legacy(otherSvc.short, i + 1, site.code), site: site.code, role: 'web',
      pool: otherPoolId, inService: true, services: { [otherSvc.id]: `${rs.int(1, 9)}.${rs.int(0, 30)}.${rs.int(0, 9)}`, envoy: `1.${rs.int(27, 31)}.0` },
      drainNote: null, member: 'other-service', app: otherSvc.id });
  }
  const extras = rs.sample(EXTRA_ROLES, Math.min(K.extras, EXTRA_ROLES.length));
  for (const [role, service] of extras) {
    hosts.push({ id: `${site.code}-${role}-01`, aka: null, site: site.code, role, pool: null, inService: null,
      services: { [service]: `${rs.int(1, 9)}.${rs.int(0, 20)}.${rs.int(0, 9)}` }, drainNote: null, member: 'extra', app: service });
  }
  const workers = [];
  let decommissioned = null;
  {
    const count = Math.max(K.workers, 2); // workers always exist; they are in scope only from difficulty 3
    for (let i = 0; i < count; i++) {
      const id = `${site.code}-${svc.short}w-${pad2(i + 1)}`;
      hosts.push({ id, aka: `${svc.short}w${i + 1}.${site.code}`, site: site.code, role: 'worker', pool: null, inService: null,
        services: { [worker]: vFrom }, drainNote: null, member: 'worker', app: worker });
      workers.push(id);
    }
    if (difficulty >= 3) {
      decommissioned = `${site.code}-${svc.short}w-${pad2(count + 1)}`;
      hosts.push({ id: decommissioned, aka: `${svc.short}w${count + 1}.${site.code}`, site: site.code, role: 'worker', pool: null, inService: null,
        services: { [worker]: `${maj}.${min - 1}.0` }, drainNote: null, member: 'decommissioned', unreachable: true, app: worker });
    }
  }
  const dbHosts = [`${cluster}-a`, `${cluster}-b`];
  const primary = rs.pick(dbHosts), replica = dbHosts.find(h => h !== primary);
  for (const h of dbHosts) hosts.push({ id: h, aka: null, site: site.code, role: 'db', pool: null, inService: null, services: { postgres: '15.8' }, drainNote: null, member: 'db', app: 'postgres' });
  const staleDb = K.staleDb > 0 && rs.chance(K.staleDb);
  const teams = ['platform-sre', svc.team, 'data-infra', 'edge', 'core-services'];
  for (const h of hosts) {
    h.rack = `${'ABCDEF'[rs.int(0, 5)]}${pad2(rs.int(1, 24))}`;
    h.os = rs.pick(['debian-12.6', 'debian-12.7', 'rocky-9.4', 'ubuntu-24.04']);
    h.team = h.role === 'db' ? 'data-infra' : h.member === 'extra' ? rs.pick(teams) : h.app === svc.id || h.app === worker ? svc.team : 'core-services';
    h.patched = rs.int(5, 120);
  }

  // Values.
  const rv = sub(seed, split, difficulty, 'values');
  const maxInflightInit = rv.pick(['192', '256', '320']);
  const maxInflightDesc = rv.pick(['384', '448', '512', '640']);
  const maxInflightAmend = rv.pick(['352', '416', '480', '576'].filter(v => v !== maxInflightDesc));
  const slowInit = rv.pick(['0', '10', '15']);
  const slowStart = rv.pick(['20', '30', '45', '60']);
  const slowRetracted = rv.pick(['25', '40', '50', '90'].filter(v => v !== slowStart));
  const workMemInit = rv.pick(['64', '96']);
  const workMemDesc = rv.pick(['128', '160', '192']);
  const workMemAmend = rv.pick(['112', '144', '176'].filter(v => v !== workMemDesc));
  const idleInit = rv.pick(['45', '60', '75']);
  const maxInflight = kinds.includes('skip') ? null : kinds.includes('value') ? maxInflightAmend : maxInflightDesc;
  const workMem = K.db ? (kinds.includes('workmem') ? workMemAmend : workMemDesc) : null;

  // Thresholds stated in the runbook (not hidden).
  const rt = sub(seed, split, difficulty, 'thresholds');
  const thr = {
    lagT: rt.pick([20, 30, 45]), lagWait: rt.pick([45, 60, 90]), lagRetries: rt.pick([2, 3]),
    errT: rt.pick([1.5, 2, 2.5]), errGap: rt.pick([60, 90]), connWait: rt.pick([15, 30]),
    healthWait: rt.pick([45, 60]), healthRetries: rt.pick([2, 3]), restartRetries: 2, dbPoll: 30,
  };
  const inService0 = hosts.filter(h => h.pool === pool && h.inService).length;
  thr.minInService = Math.max(1, inService0 - 1 - K.maxF);

  // Window and clock.
  const rw = sub(seed, split, difficulty, 'time');
  const wtype = K.db ? pickWeighted(rw, [['evening', 0.55], ['weekday-day', 0.3], ['weekend-day', 0.15]])
    : pickWeighted(rw, [['evening', 0.5], ['weekday-day', 0.3], ['weekend-day', 0.2]]);
  let dayIdx = rw.int(300, 680);
  const wd = i => i % 7; // 0=Mon .. 5=Sat, 6=Sun (BASE_EPOCH is a Monday)
  if (wtype === 'weekday-day') while (wd(dayIdx) > 4) dayIdx++;
  if (wtype === 'weekend-day') while (wd(dayIdx) < 5) dayIdx++;
  const startLocal = wtype === 'evening' ? 19 * 3600 + rw.int(0, 4) * 1800 : 9 * 3600 + rw.int(0, 3) * 1800;
  const wlen = K.windowHours * 3600 + (wtype === 'evening' ? rw.pick([0, 1800]) : 0);
  const ws = BASE_EPOCH + dayIdx * DAY + startLocal - tz * 3600;
  const window = { start: ws, end: ws + wlen, type: wtype };
  const windowInHours = inBusinessHours(ws, tz) || inBusinessHours(ws + wlen - 1, tz);
  const start = K.startEarly ? ws - rw.int(1200, 7200) : ws + rw.int(120, 1200);
  const created = ws - rw.int(2, 5) * DAY - rw.int(0, 30000);

  // Hidden failure plan.
  const rp = sub(seed, split, difficulty, 'plan');
  const events = chooseEvents(rp, difficulty);
  const lagMode = events.includes('stall') ? 'stall'
    : difficulty === 1 ? 'ok' : difficulty === 2 ? pickWeighted(rp, [['ok', 0.7], ['recover', 0.3]]) : pickWeighted(rp, [['ok', 0.6], ['recover', 0.4]]);
  const lagFrom = (start < ws ? ws : start) - 900;
  const lag = {
    mode: lagMode, from: lagFrom, L0: thr.lagT + rp.int(10, 60),
    until: lagMode === 'recover' ? Math.max(ws, start) + rp.int(40, thr.lagRetries * thr.lagWait - 25) : lagMode === 'stall' ? Infinity : lagFrom,
    replicaJump: thr.lagT + rp.int(30, 90),
  };
  const restart = {};
  const candidates = rp.shuffle(targets);
  const perm = events.includes('perm') ? candidates[0] : null;
  const stuck = events.includes('stuck') ? candidates[1] : null;
  const nTrans = rp.int(K.transientRestart[0], K.transientRestart[1]);
  for (const id of rp.sample(targets.filter(t => t !== stuck), nTrans)) restart[id] = { transient: difficulty >= 5 && rp.chance(0.3) ? 2 : 1, permanent: false };
  if (perm) restart[perm] = { transient: difficulty >= 5 && rp.chance(0.4) ? 1 : 0, permanent: true };
  if (workers.length && K.workers && difficulty >= 3 && rp.chance(0.6)) restart[rp.pick(workers)] = { transient: 1, permanent: false };
  const degraded = {};
  const maxDeg = Math.min(150, thr.healthRetries * thr.healthWait - 30);
  const nDeg = rp.int(K.degraded[0], K.degraded[1]);
  for (const id of rp.sample(targets.filter(t => t !== perm && t !== stuck), nDeg)) degraded[id] = rp.int(15, difficulty === 1 ? 45 : maxDeg);
  if (stuck) degraded[stuck] = Infinity;
  const conns = {};
  for (const h of hosts) if (h.pool) conns[h.id] = { base: rp.int(20, 240), bleed: rp.int(K.bleed[0], K.bleed[1]) };
  const configKeys = { pin: `${svc.id}.version_pin`, maxInflight: `${svc.id}.max_inflight`, slowStart: `lb.${pool}.slow_start_s`, workMem: `db.${cluster}.work_mem_mb` };
  const transientConfig = {};
  const nTc = rp.int(K.transientConfig[0], K.transientConfig[1]);
  const tcKeys = [configKeys.pin, ...(maxInflight !== null ? [configKeys.maxInflight] : []), ...(K.db ? [configKeys.workMem] : [])];
  for (const k of rp.sample(tcKeys, nTc)) transientConfig[k] = 1;
  const plan = {
    events, lag, restart, perm, stuck, degraded, conns, transientConfig,
    reject: events.includes('reject') ? configKeys.slowStart : null,
    spike: events.includes('spike'),
    errBase: Math.round(rp.float(0.15, Math.min(0.9, thr.errT - 0.6)) * 100) / 100,
    errSpike: Math.round((thr.errT + rp.float(1.5, 6)) * 100) / 100,
    spikeDelay: 20,
  };

  // Initial config and flags (stores contain distractors).
  const config = {
    [configKeys.pin]: vFrom, [configKeys.maxInflight]: maxInflightInit, [configKeys.slowStart]: slowInit,
    [configKeys.workMem]: workMemInit, [`${svc.id}.log_level`]: 'info', [`${svc.id}.cache_ttl_s`]: String(rs.pick([30, 60, 120])),
    [`lb.${pool}.idle_timeout_s`]: idleInit, [`lb.${greenPool}.slow_start_s`]: slowInit, [`${worker}.concurrency`]: String(rs.pick([8, 16, 24])),
    [`${otherSvc.id}.version_pin`]: `${rs.int(1, 9)}.${rs.int(0, 30)}.${rs.int(0, 9)}`, ['deploy.freeze']: 'false',
    [`db.${cluster}.max_connections`]: String(rs.pick([400, 500, 800])),
  };
  const flags = {
    [banner]: false, [ff]: false, [paused]: false, [`ff_${svc.short}_${rs.pick(FEATURES.filter(f => !ff.endsWith(f)))}`]: true,
    [`ff_${otherSvc.short}_${rs.pick(FEATURES)}`]: rs.chance(0.5), ['ops.readonly_mode']: false,
  };
  const artifacts = [vFrom, vBase, vAmended, vRc, `${maj}.${min}.${Math.max(0, pat - 1)}`];

  const workerStep = K.workers > 0, dbStep = K.db;
  const spec = {
    difficulty, ticketId, incId, rbId, site, tz, svc, worker, pool, greenPool, color, ff, banner, paused, cluster,
    owner, approver, requester, people, kinds, versionFrom: vFrom, versionBase: vBase, versionTo, versionRc: vRc,
    keys: configKeys, maxInflight, maxInflightDesc, maxInflightInit, maxInflightAmend, slowStart, slowRetracted, slowInit,
    workMem, workMemDesc, workMemAmend, workMemInit, idleInit,
    targets, canary, quarantined, includedNode, loadtestNode, descQuarantined, poolMembers: poolMembers.map(m => m.id),
    workers: workerStep ? workers : [], allWorkers: workers, decommissioned, workerStep, dbStep,
    db: { hosts: dbHosts, primary, replica, staleDb }, window, windowInHours, primaryRestart: dbStep && !windowInHours,
    start, created, thr, budget: K.budget, otherSites, otherSvc, artifacts,
  };
  const init = { t: start, hosts, config, flags };
  return { spec, plan, init, K };
}
