// Audit round 4, second attacker (test fixture): written with white-box knowledge of the v3 generator.
// Prose notes parsed with negation-aware rules (mixed notes: the callee after "no fallback for" etc. is hard),
// root = the service blamed most by generic failure lines among those with onset-worded lines of their own,
// descending into a blamed callee only if it also has them; class = class of its onset-worded lines; T = first
// line of the root's last onset-worded episode (a gap of > 150 s or a baseline-valued line ends an episode).
const OS = { connection_pool_exhaustion: /at capacity|took \d+ms \(pool max|acquire queue length|are checked out; new borrowers|has not been returned|and rising while|without matching load|without closing its transaction|checkouts outpacing/i,
  certificate_expiry: /rejected by the client: certificate expired|no longer valid \(notafter|validity ended at|alert 'certificate_expired'|chain's notafter|hung up right after our certificate/i,
  bad_config_deploy: /rollout started|starting \S+ release|loaded configuration bundle|picked up by pod/i, poisoned_cache: /cache refill: loaded \d+ entries into namespace '[a-z-]+'(?<!-preview') |warm-up finished/i,
  disk_full: /no space left|enospc|could not extend file|0 bytes free|jumped to \d+% \(was|shrinking fast|and climbing|write rate on|points above where|output exploded/i,
  dns_resolution_failure: /temporary failure in name|eai_again|timed out resolving|could not be resolved \(resolver|cannot refill: lookup/i,
  memory_leak_oom: /heap after full gc is \d+% \(baseline|resident memory \d+ mib and rising|retained objects in cache|watermark crossed|live set after collection/i,
  clock_skew: /clock offset vs time source|time sync lost|stepped forward by|ahead of peers|has expired or is not yet valid: current time|rejected as expired: local time/i,
  upstream_rate_limiting: /429 too many requests \(retry|quota of \d+ requests\/min exhausted|says slow down|x-ratelimit-remaining: 0|refuses most of our calls/i };
const FAIL = /timed out|timeout|\b5\d\d\b|unavailable|refused|deadline|circuit|failed|exhausted|bulkhead|eof|reset|401|could not|gave up|rejecting|unexpected|said:|error (from|calling|body)/i, OK = /fallback|degraded|using |instead|succeeded|reconnected|slow response|\b4(0[0349])\b|deprecated|without fresh/i;
const HARDP = /no fallback for (\S+)|failure of (\S+) fails|needs (\S+) for every|unlike when (\S+)|cannot (?:serve|answer) without (\S+)/;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), word = n => new RegExp(`(^|[^a-z0-9.-])${esc(n)}($|[^a-z0-9-])`);
export function adaptedHeuristicSolve(task) {
  const { system, log } = task.inputs, alias = new Map(), calls = new Map(), batch = new Set(), soft = new Set();
  for (const [, n, tier, c, o] of system.matchAll(/^\| ([a-z0-9-]+) \| [^|]+ \| (\w+) \| ([^|]+) \| ([^|]+) \|$/gm)) {
    if (n === 'Service') continue; alias.set(n, n); if (tier === 'batch') batch.add(n);
    calls.set(n, new Set(c.trim() === '-' ? [] : c.split(',').map(x => x.trim().replace(' (optional)', '')))); for (const x of c.split(',')) if (x.includes('(optional)')) soft.add(`${n}>${x.trim().replace(' (optional)', '')}`);
    for (const x of o.split(',').map(y => y.trim().replace(/'/g, ''))) if (x !== '-') alias.set(x, n);
  }
  for (const m of system.matchAll(/^- (\S+): (\d+\.\d+\.\d+\.\d+:\d+)$/gm)) alias.set(m[2], m[1]);
  const svcs = [...calls.keys()], inS = s => svcs.filter(n => word(n).test(s)).sort((a, b) => s.search(word(a)) - s.search(word(b)));
  for (const sent of system.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2))) {
    const ns = inS(sent), q = /'([a-z0-9-]+)'/.exec(sent), h = HARDP.exec(sent)?.slice(1).find(Boolean);
    if (ns.length === 1 && q && /name|called/.test(sent)) alias.set(q[1], ns[0]);
    else if (ns.length === 2 && /refactor|straight from|table predates|update pending|show yet/.test(sent)) calls.get(ns[0]).add(ns[1]);
    else if (ns.length === 2 && /no longer|stopped using|does not talk|outdated/.test(sent)) calls.get(ns[0]).delete(ns[1]);
    else if (ns.length === 3) soft.add(`${ns[0]}>${ns.slice(1).find(n => n !== h)}`);
    else if (ns.length === 2 && !h && !/removed|ignored|never|not something|errors whenever|no degraded/.test(sent) && /optional|fall|instead|soft|do without|only costs|enrich|substitut|nothing breaks|keeps serving|can skip|live without/.test(sent)) { soft.add(`${ns[0]}>${ns[1]}`); soft.add(`${ns[1]}>${ns[0]}`); }
  }
  const L = log.trim().split('\n').map(l => { const [id, ts, src, ...r] = l.split(' '), body = r.join(' '), hd = body.slice(0, 24);
    return { id, t: Date.parse(ts), body, svc: alias.get(src) || svcs.find(n => src.startsWith(`${n}-`)) || src, lvl: /^(ERROR|\[ERROR\]|E:)|"(level|lvl|severity)":"error|level=error/i.test(hd) ? 'E' : /^(WARN|\[WARN\]|W:)|"(level|lvl|severity)":"warn|level=warn/i.test(hd) ? 'W' : 'I' }; });
  const res = [...alias.keys()].sort((a, b) => b.length - a.length).map(a => [word(a), alias.get(a)]), named = l => res.find(([re, n]) => n !== l.svc && re.test(l.body))?.[1];
  for (const l of L) l.callee = l.lvl !== 'I' && FAIL.test(l.body) && !OK.test(l.body) ? named(l) : undefined;
  const fails = L.filter(l => l.callee && !soft.has(`${l.svc}>${l.callee}`)), blamed = (k, by) => fails.filter(l => l.callee === k && (!by || l.svc === by)).length;
  const ownOnset = k => L.filter(l => l.svc === k && !named(l) && Object.values(OS).some(re => re.test(l.body)));
  let root = svcs.filter(k => ownOnset(k).length).sort((a, b) => blamed(b) - blamed(a))[0] ?? svcs[1];
  for (let k; (k = [...(calls.get(root) || [])].find(c => blamed(c, root) >= 2 && ownOnset(c).length && blamed(c) > blamed(c, root)));) root = k;
  const mine = ownOnset(root), cls = Object.entries(OS).map(([c, re]) => [c, mine.filter(l => re.test(l.body)).length]).sort((a, b) => b[1] - a[1])[0][0];
  const ep = mine.filter(l => OS[cls].test(l.body)); let i = ep.length - 1;
  while (i > 0 && ep[i].t - ep[i - 1].t <= 150000 && !L.some(l => l.svc === root && l.t > ep[i - 1].t && l.t < ep[i].t && /pending=0|\(ok\)|% \(pause|quota usage|lookups\/min|again|drained|corrected|restored|kept after/i.test(l.body))) i--;
  const T = /cache|config/.test(cls) ? ep.filter(l => l.t <= (fails.find(f => f.callee === root)?.t ?? Infinity)).at(-1) ?? ep[0] : ep[i];
  const imp = new Set([root]);
  for (let grew = true; grew;) { grew = false; for (const [a, cs] of calls) if (!batch.has(a) && !imp.has(a) && [...cs].some(b => imp.has(b) && !soft.has(`${a}>${b}`))) { imp.add(a); grew = true; } }
  return { root_service: root, fault_class: cls, first_bad_timestamp: new Date((T ?? L[0]).t).toISOString(), impacted_services: [...imp], evidence_line_ids: T ? [T.id] : [] };
}
