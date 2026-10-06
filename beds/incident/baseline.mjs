// Non-model script baselines for the `incident` bed. They read only task.prompt/inputs (never
// the truth) and encode the obvious shortcuts a 20-line script would take: parse the table and
// the log, find the first service whose warning/error rate jumps, vote on keywords. They exist to
// show that the bed is not solvable by surface statistics; they are not part of the oracle.

const LEVEL_RES = [
  ['ERROR', /^(ERROR\b|\[ERROR\]|E: |level=error\b|\{"(level|lvl)":"error"|\{"severity":"ERROR")/],
  ['WARN', /^(WARN\b|\[WARN\]|W: |level=warn\b|\{"(level|lvl)":"warn"|\{"severity":"WARN")/],
];

const KEYWORDS = {
  memory_leak_oom: /oom|out of memory|heap|memory|rss|\bgc\b/i,
  disk_full: /no space|enospc|disk|storage|errno 28|\b507\b|volume/i,
  certificate_expiry: /certificat|x509|\btls\b|handshake|\bssl\b/i,
  dns_resolution_failure: /lookup|resolv|\bdns\b|getaddrinfo|eai_again|servfail|nameserver/i,
  connection_pool_exhaustion: /\bpool\b|idle connection|free connection|acquire/i,
  clock_skew: /clock|\bntp\b|skew|drift|not yet valid|\b401\b|token/i,
  upstream_rate_limiting: /\b429\b|rate limit|throttl|quota|too many requests/i,
  poisoned_cache: /cache|checksum|corrupt|integrity/i,
  bad_config_deploy: /rollout|release|deploy|config|\bbuild\b/i,
};

export function parseTask(task) {
  const { system, log } = task.inputs;
  const rows = system.split('\n').filter(l => l.startsWith('| ') && !l.startsWith('| Service') && !l.startsWith('|---'))
    .map(l => l.split('|').map(x => x.trim()).filter((_, i, a) => i > 0 && i < a.length - 1));
  const names = rows.map(r => r[0]).sort((a, b) => b.length - a.length);
  const aliases = new Map();
  for (const [name, , , , other] of rows) for (const a of (other || '').split(',').map(x => x.trim().replace(/^'|'$/g, '')).filter(x => x && x !== '-')) aliases.set(a, name);
  const lines = log.trim().split('\n').map(text => {
    const m = /^(L\d+) (\S+) (\S+) (.*)$/.exec(text);
    const [, id, ts, source, body] = m;
    const svc = names.find(n => source === n || source.startsWith(`${n}-`)) || aliases.get(source) || source;
    const level = (LEVEL_RES.find(([, re]) => re.test(body)) || ['INFO'])[0];
    return { id, ts, t: Date.parse(ts), svc, level, body };
  });
  return { names, aliases, lines };
}

const classify = bodies => {
  let best = 'bad_config_deploy', bestN = -1;
  for (const [k, re] of Object.entries(KEYWORDS)) {
    const n = bodies.filter(b => re.test(b)).length;
    if (n > bestN) { best = k; bestN = n; }
  }
  return best;
};

// H1: the service whose warn/error rate jumps first (sustained) is the root.
export function heuristicFirstJump(task) {
  const { lines } = parseTask(task);
  const t0 = lines[0].t;
  const minute = l => Math.floor((l.t - t0) / 60000);
  const bySvc = new Map();
  for (const l of lines) if (l.level !== 'INFO') {
    const m = bySvc.get(l.svc) || new Map();
    m.set(minute(l), (m.get(minute(l)) || 0) + 1);
    bySvc.set(l.svc, m);
  }
  const onsets = [];
  for (const [svc, m] of bySvc) {
    let base = 0;
    for (let i = 0; i < 8; i++) base += m.get(i) || 0;
    base /= 8;
    for (let i = 8; i < 30; i++) {
      const c = m.get(i) || 0;
      const next = [1, 2, 3].map(j => m.get(i + j) || 0);
      if (c >= Math.max(2, 2 * base + 1) && next.reduce((a, b) => a + b, 0) / 3 >= 1.5 * base + 0.7) { onsets.push({ svc, minute: i }); break; }
    }
  }
  if (!onsets.length) onsets.push({ svc: lines[0].svc, minute: 15 });
  onsets.sort((a, b) => a.minute - b.minute);
  const root = onsets[0];
  const after = lines.filter(l => l.svc === root.svc && l.level !== 'INFO' && minute(l) >= root.minute);
  return {
    root_service: root.svc,
    fault_class: classify(after.map(l => l.body)),
    first_bad_timestamp: (after[0] || lines[0]).ts,
    impacted_services: [...new Set(onsets.map(o => o.svc))],
    evidence_line_ids: after.slice(0, 10).map(l => l.id),
  };
}

// H2: the service with the most ERROR lines in the second half is the root.
export function heuristicMostErrors(task) {
  const { lines } = parseTask(task);
  const mid = lines[0].t + 15 * 60000;
  const count = new Map();
  for (const l of lines) if (l.level === 'ERROR' && l.t >= mid) count.set(l.svc, (count.get(l.svc) || 0) + 1);
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1]);
  const root = ranked.length ? ranked[0][0] : lines[0].svc;
  const mine = lines.filter(l => l.svc === root && l.level !== 'INFO');
  const firstLate = mine.find(l => l.t >= lines[0].t + 8 * 60000) || mine[0] || lines[0];
  return {
    root_service: root,
    fault_class: classify(mine.map(l => l.body)),
    first_bad_timestamp: firstLate.ts,
    impacted_services: ranked.slice(0, Math.max(2, Math.ceil(ranked.length / 2))).map(([s]) => s),
    evidence_line_ids: mine.slice(0, 10).map(l => l.id),
  };
}

// H3: keyword grep over everything: the service with the most class-keyword hits is the root.
export function heuristicKeywordGrep(task) {
  const { lines } = parseTask(task);
  let best = null;
  for (const [cls, re] of Object.entries(KEYWORDS)) {
    const hits = new Map();
    for (const l of lines) if (l.level !== 'INFO' && re.test(l.body)) hits.set(l.svc, (hits.get(l.svc) || 0) + 1);
    for (const [svc, n] of hits) if (!best || n > best.n) best = { cls, svc, n };
  }
  const re = KEYWORDS[best.cls];
  const mine = lines.filter(l => l.svc === best.svc && l.level !== 'INFO' && re.test(l.body));
  const late = mine.filter(l => l.t >= lines[0].t + 8 * 60000);
  const errSvcs = new Map();
  for (const l of lines) if (l.level === 'ERROR' && l.t >= (late[0] || mine[0]).t) errSvcs.set(l.svc, (errSvcs.get(l.svc) || 0) + 1);
  return {
    root_service: best.svc,
    fault_class: best.cls,
    first_bad_timestamp: (late[0] || mine[0]).ts,
    impacted_services: [...errSvcs.entries()].filter(([, n]) => n >= 3).map(([s]) => s),
    evidence_line_ids: mine.slice(0, 10).map(l => l.id),
  };
}

export const heuristics = { firstJump: heuristicFirstJump, mostErrors: heuristicMostErrors, keywordGrep: heuristicKeywordGrep };
