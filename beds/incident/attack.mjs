// Adversarial audit asset (not part of the bed interface): the strongest short deterministic
// solver the auditor could write. It reads only task.prompt/inputs and encodes the shortcuts a
// careful script author would take after studying a few generated tasks: resolve aliases from the
// service map, keep ERROR lines that name a callee listed in the table, follow the blame chain down
// from the gateway to the deepest sick service, classify by vocabulary, take the start of the last
// dense run of class-matching lines as T, and close the blast radius over blaming callers.
// The bed's tests require it to pass < 20% of seeds at difficulty 3 (see AUDIT.md).
const CLASS_RE = {
  connection_pool_exhaustion: /\bpool\b|borrow|acquire|free connection|idle .*connection|first query|checked out|leak-detection|borrowed=/i,
  certificate_expiry: /certificat|handshake|notafter|x509|\btls\b|acme|alert 45|first byte|\bcert\b/i,
  bad_config_deploy: /config|setting|route for|panic|malformed|serializer|nil pointer|validator|toggle|effective timeout/i,
  disk_full: /space|enospc|errno 28|read-only|100% full|compaction|checkpoint|temp file|free bytes|retention|storage/i,
  dns_resolution_failure: /lookup|resolv|getaddrinfo|servfail|nameserver|host cache|address (of|unknown)|never left|eai_again/i,
  memory_leak_oom: /heap|memory|\brss\b|\bgc\b|oom|allocation|old gen/i,
  clock_skew: /clock|\bjwt\b|bearer|signature timestamp|\bttl\b|nbf|fired .* early|issued-at|not yet valid|minted/i,
  upstream_rate_limiting: /\b429\b|throttl|quota|rate limit|back(ing)? off|budget|token bucket|slow down|too many/i,
  poisoned_cache: /checksum|integrity|schema v\d|missing field|is null|bytes \(typical|empty '|cache hit ratio|cache hit /i,
};
export function blameChainSolve(task) {
  const { system, log } = task.inputs, alias = new Map(), calls = new Map(), esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [, n, c, o] of system.matchAll(/^\| ([a-z0-9-]+) \| [^|]+ \| [^|]+ \| ([^|]+) \| ([^|]+) \|$/gm)) {
    if (n === 'Service') continue;
    alias.set(n, n); calls.set(n, new Set(c.trim() === '-' ? [] : c.split(',').map(x => x.trim()).filter(x => !x.endsWith('(optional)'))));
    for (const x of o.split(',').map(y => y.trim().replace(/'/g, ''))) if (x !== '-') alias.set(x, n);
  }
  for (const [, n, a] of system.matchAll(/refer to (\S+) by its pre-migration name '([^']+)'/g)) alias.set(a, n);
  for (const m of system.matchAll(/^- (\S+): (\d+\.\d+\.\d+\.\d+:\d+)$/gm)) alias.set(m[2], m[1]);
  for (const m of system.matchAll(/(\S+) still ships its logs under its old application name '([^']+)'/g)) alias.set(m[2], m[1]);
  for (const [, a, b] of system.matchAll(/(\S+) also calls (\S+) directly/g)) calls.get(a)?.add(b);
  for (const [, a, b] of system.matchAll(/(\S+) no longer calls (\S+):/g)) calls.get(a)?.delete(b);
  for (const [, a, b] of system.matchAll(/(\S+) treats (\S+) as optional/g)) calls.get(a)?.delete(b);
  const res = [...alias.keys()].sort((a, b) => b.length - a.length).map(a => [new RegExp(`(^|[^a-z0-9.-])${esc(a)}($|[^a-z0-9-])`), alias.get(a)]);
  const L = log.trim().split('\n').map(l => { const [id, ts, src, ...rest] = l.split(' '), body = rest.join(' '), head = body.slice(0, 24);
    return { id, ts, t: Date.parse(ts), body, svc: alias.get(src) || [...calls.keys()].find(n => src.startsWith(`${n}-`)) || src,
      lvl: /^(ERROR|\[ERROR\]|E:)|"(level|lvl|severity)":"error|level=error/i.test(head) ? 'E' : /^(WARN|\[WARN\]|W:)|"(level|lvl|severity)":"warn|level=warn/i.test(head) ? 'W' : 'I' }; });
  const named = l => { for (const [re, n] of res) if (n !== l.svc && re.test(l.body)) return n; return null; };
  const fails = L.filter(l => l.lvl === 'E' && !/fallback|degraded/i.test(l.body)).map(l => ({ ...l, callee: named(l) })).filter(l => l.callee && calls.get(l.svc)?.has(l.callee));
  const t0 = fails[0]?.t ?? L[0].t, span = [t0 - L[0].t, L.at(-1).t - t0], ew = (s, a) => L.filter(l => l.svc === s && l.lvl !== 'I' && (l.t >= t0) === a).length;
  const sick = s => ew(s, true) >= 3 && ew(s, true) / span[1] >= 2 * (ew(s, false) + 1) / span[0];
  const top = (s, seen) => { const c = new Map(); for (const f of fails) if (f.svc === s && !seen.has(f.callee)) c.set(f.callee, (c.get(f.callee) || 0) + 1); return [...c].sort((a, b) => b[1] - a[1]).find(([k, n]) => n >= 2 && sick(k))?.[0]; };
  const counts = new Map(); for (const f of fails) counts.set(f.svc, (counts.get(f.svc) || 0) + 1);
  let root = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? L[0].svc; const seen = new Set([root]);
  for (let nx; (nx = top(root, seen)); seen.add(nx)) root = nx;
  const mine = L.filter(l => l.svc === root && l.lvl !== 'I');
  const cls = Object.entries(CLASS_RE).map(([k, re]) => [k, mine.filter(l => re.test(l.body)).length]).sort((a, b) => b[1] - a[1])[0][0];
  const hits = mine.filter(l => CLASS_RE[cls].test(l.body)), tF = fails.find(f => f.callee === root)?.t ?? 0; let i = hits.length - 1;
  if (cls === 'memory_leak_oom') while (i > 0 && hits[i].t - hits[i - 1].t <= 150000) i--; else i = Math.max(0, hits.findIndex(h => h.t >= tF - 150000));
  const T = (hits[i] || mine[0] || L[0]).t, imp = new Set([root]);
  for (let grew = true; grew;) { grew = false; for (const f of fails) if (f.t >= T && imp.has(f.callee) && !imp.has(f.svc)) { imp.add(f.svc); grew = true; } }
  return { root_service: root, fault_class: cls, first_bad_timestamp: new Date(T).toISOString(), impacted_services: [...imp], evidence_line_ids: hits.slice(i, i + 10).map(l => l.id) };
}

// Second attacker, written after reading the v2 generator (audit round 2). Same budget, more
// knowledge: fallback lines and prose notes mark optional edges (negated notes are skipped),
// warnings with failure vocabulary count as failures, the chain only descends into services that
// show fault vocabulary or 5xx/401 answers of their own, and the onset is the first class line
// after the root's last recovery line.
const FAIL_RE = /timed out|timeout|\b5\d\d\b|unavailable|refused|deadline|circuit|failed|exhausted|bulkhead|rejected|eof|validation|unexpected|aborting|gave a|said:|error (calling|from|body)|could not|unauthorized|401/i;
const BENIGN_RE = /fallback|degraded|using |instead|succeeded|reconnected|slow response|\b40[049]\b|409|deprecated|without fresh/i;
const RECOVER_RE = /cleared|recover|succeeding again|healthy|back to|restarted;|reload(ed)? succeeded|resolved on retry|synchronised|freed|steady|renewed/i;
export function adaptedSolve(task) {
  const { system, log } = task.inputs, alias = new Map(), calls = new Map(), soft = new Set(), esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [, n, c, o] of system.matchAll(/^\| ([a-z0-9-]+) \| [^|]+ \| [^|]+ \| ([^|]+) \| ([^|]+) \|$/gm)) {
    if (n === 'Service') continue;
    alias.set(n, n); calls.set(n, new Set(c.trim() === '-' ? [] : c.split(',').map(x => x.trim().replace(' (optional)', ''))));
    for (const x of c.split(',')) if (x.includes('(optional)')) soft.add(`${n}>${x.trim().replace(' (optional)', '')}`);
    for (const x of o.split(',').map(y => y.trim().replace(/'/g, ''))) if (x !== '-') alias.set(x, n);
  }
  const svcs = [...calls.keys()], inSent = s => svcs.filter(n => new RegExp(`(^|[^a-z0-9-])${esc(n)}($|[^a-z0-9-])`).test(s)).sort((a, b) => s.indexOf(a) - s.indexOf(b));
  for (const m of system.matchAll(/^- (\S+): (\d+\.\d+\.\d+\.\d+:\d+)$/gm)) alias.set(m[2], m[1]);
  for (const sent of system.split(/\n- |\. /)) {
    const ns = inSent(sent), q = [...sent.matchAll(/'([a-z0-9-]+)'/g)].map(m => m[1]);
    if (ns.length === 1 && q.length) alias.set(q[0], ns[0]);
    if (ns.length !== 2) continue;
    const neg = /\bno fallback|not optional|never built|cannot serve|no degraded/i.test(sent);
    if (!neg && /optional|fallback|instead|soft dependency|degrades/i.test(sent)) { soft.add(`${ns[0]}>${ns[1]}`); soft.add(`${ns[1]}>${ns[0]}`); }
    else if (/no longer|stopped using|does not talk|outdated/i.test(sent)) calls.get(ns[0])?.delete(ns[1]);
    else if (/refactor|directly|straight from|dependency on|involve a call/i.test(sent)) calls.get(ns[0])?.add(ns[1]);
  }
  const res = [...alias.keys()].sort((a, b) => b.length - a.length).map(a => [new RegExp(`(^|[^a-z0-9.-])${esc(a)}($|[^a-z0-9-])`), alias.get(a)]);
  const L = log.trim().split('\n').map(l => { const [id, ts, src, ...rest] = l.split(' '), body = rest.join(' '), head = body.slice(0, 24);
    return { id, ts, t: Date.parse(ts), body, svc: alias.get(src) || svcs.find(n => src.startsWith(`${n}-`)) || src,
      lvl: /^(ERROR|\[ERROR\]|E:)|"(level|lvl|severity)":"error|level=error/i.test(head) ? 'E' : /^(WARN|\[WARN\]|W:)|"(level|lvl|severity)":"warn|level=warn/i.test(head) ? 'W' : 'I' }; });
  const named = l => { for (const [re, n] of res) if (n !== l.svc && re.test(l.body)) return n; return null; };
  for (const l of L) if (/fallback|degraded mode|using |without fresh/i.test(l.body) && named(l)) soft.add(`${l.svc}>${named(l)}`);
  const fails = L.filter(l => l.lvl !== 'I' && FAIL_RE.test(l.body) && !BENIGN_RE.test(l.body)).map(l => ({ ...l, callee: named(l) }))
    .filter(l => l.callee && calls.get(l.svc)?.has(l.callee) && !soft.has(`${l.svc}>${l.callee}`));
  const t0 = fails[0]?.t ?? L[0].t, own = s => L.filter(l => l.svc === s && l.lvl !== 'I' && l.t >= t0 && !named(l));
  const sick = s => own(s).filter(l => Object.values(CLASS_RE).some(re => re.test(l.body))).length >= 3 || L.filter(l => l.svc === s && l.t >= t0 && /\b(5\d\d|401)\b/.test(l.body) && !named(l)).length >= 2;
  const top = (s, seen) => { const c = new Map(); for (const f of fails) if (f.svc === s && !seen.has(f.callee)) c.set(f.callee, (c.get(f.callee) || 0) + 1); return [...c].sort((a, b) => b[1] - a[1]).find(([k, n]) => n >= 2 && (fails.some(f => f.svc === k) || sick(k)))?.[0]; };
  let root = svcs[0]; const seen = new Set([root]);
  for (let nx; (nx = top(root, seen)); seen.add(nx)) root = nx;
  const mine = L.filter(l => l.svc === root && l.lvl !== 'I'), tF = fails.find(f => f.callee === root)?.t ?? t0;
  const cls = Object.entries(CLASS_RE).map(([k, re]) => [k, mine.filter(l => l.t >= tF - 300000 && re.test(l.body)).length]).sort((a, b) => b[1] - a[1])[0][0];
  const lastRec = L.filter(l => l.svc === root && l.t < tF && RECOVER_RE.test(l.body)).at(-1)?.t ?? 0;
  const hit = mine.find(l => l.t > lastRec && l.t >= tF - 600000 && CLASS_RE[cls].test(l.body)) || mine.find(l => l.t >= tF - 150000) || L[0];
  const imp = new Set([root]);
  for (let grew = true; grew;) { grew = false; for (const f of fails) if (f.t >= hit.t && imp.has(f.callee) && !imp.has(f.svc)) { imp.add(f.svc); grew = true; } }
  return { root_service: root, fault_class: cls, first_bad_timestamp: new Date(hit.t).toISOString(), impacted_services: [...imp], evidence_line_ids: mine.slice(0, 10).map(l => l.id) };
}
