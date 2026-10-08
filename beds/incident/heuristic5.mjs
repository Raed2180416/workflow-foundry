// A12 (second audit, pass 2, 2026-10-08): a generic, cascade-anchored attacker written from scratch with short keyword
// lists instead of the phrase catalog. Cascade start tc = first burst of dependent failures; root = the non-batch
// service with the most novel WARN/ERROR fault-worded lines near tc plus failing request lines of its own, weighted by
// how many of its documented callers fail, then descending to a troubled callee; class = keyword vote over the root's
// lines; T = the root's first novel class-worded line after its last recovery (its own or as echoed by a caller) that
// names the same resource as its late fault lines; impacted = closure over the table and the parsed notes.
// It reads only task.inputs; `cheat` lets the audit substitute the true root/class to measure conditional accuracy.
const CL = { connection_pool_exhaustion: /\bpool\b|acquire|borrow|checked out|not (?:been )?(?:returned|handed back|given back)|in use|slots/, certificate_expiry: /cert|x509|\btls\b|handshake|\bleaf\b|notafter|validity/, bad_config_deploy: /release|rollout|config|canary|\bbuild\b|panic|no route|deploy|setting/,
  disk_full: /disk|volume|enospc|no space|errno 28|read-only|\bfull\b|gib|fsync|filling/, dns_resolution_failure: /\bdns\b|resolv|lookup|look up|eai_again|servfail|nameserver|no such host/, memory_leak_oom: /heap|memory|\boom|\bgc\b|\brss\b|mib|old gen|old space|allocation|collection/,
  clock_skew: /clock|\bntp\b|skew|drift|time source|not yet valid|\bttl\b|issued|ahead/, upstream_rate_limiting: /429|quota|rate.limit|throttl|too many requests|budget|slow down|allowance/, poisoned_cache: /cache|refill|snapshot|checksum|missing field|warm-up|integrity|digest/ };
const BENIGN = /test|staging|deliberat|on purpose|scanner|probe|drill|harness|scheduled|nightly|every evening|tolerance|not used|nothing (?:points|calls)|client-side|client's|by design|no request|ignored|retired|shut|replay|sandbox|synthetic|expected|preview|unaffected|cleaned up|no waiters|staged|days|healthy|\(ok\)|policy|expires in|drafted|prepared|standby|replica|backup|vacuum|exporter|license|shipper|audit sink|reindex|lifecycle|mirror task|aof|fork took|shards|trending/;
const REC = /again|recover|cleared|back to|locked to|in sync|succeed|resolved|normal|drained|steady|freed|reloaded|renewed/, FAIL = /timed out|deadline|\b50[0234]\b|unavailable|breaker.*open|retries|gave up|did not complete|refused|unreachable|bulkhead/, esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), W = n => new RegExp(`(^|[^a-z0-9.-])${esc(n)}($|[^a-z0-9-])`), MON = 'JanFebMarAprMayJunJulAugSep';
export function cascadeHeuristicSolve(task, cheat = {}) {
  const { system, log } = task.inputs, al = new Map(), calls = new Map(), batch = new Set(), soft = new Map(), dated = new Map();
  for (const [, n, tier, c, o] of system.matchAll(/^\| ([a-z0-9-]+) \| [^|]+ \| (\w+) \| ([^|]+) \| ([^|]+) \|$/gm)) if (n !== 'Service') {
    al.set(n, n); if (tier === 'batch') batch.add(n); calls.set(n, new Set(c.trim() === '-' ? [] : c.split(',').map(x => x.trim().replace(' (optional)', '')))); for (const x of o.split(',').map(y => y.trim().replace(/'/g, ''))) if (x !== '-') al.set(x, n); }
  for (const [, n, a] of system.matchAll(/^- ([a-z0-9-]+): (\S+)$/gm)) if (calls.has(n)) al.set(a, n);
  const svcs = [...calls.keys()], what = [...system.matchAll(/(\S+) \(team \S+\) provides ([^;.]+)/g)].sort((a, b) => b[2].length - a[2].length);
  for (let s of system.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).replace(/^The /, 'the '))) {
    for (const [, n, w] of what) s = s.replaceAll(`the service that provides ${w}`, n).replaceAll(`the service behind ${w}`, n).replaceAll(`the ${w} service`, n);
    const ns = svcs.filter(n => W(n).test(s)).sort((a, b) => s.search(W(a)) - s.search(W(b))), q = /'([a-z0-9-]+)'/.exec(s), mo = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep)\w+/.exec(s), k = `${ns[0]}>${ns[1]}`;
    if (ns.length === 1 && q && /name/.test(s)) al.set(q[1], ns[0]);
    else if (ns.length === 2 && /table (?:does not|predates)|not (?:yet in|listed)|missing from|pending|began calling|straight from/.test(s) && !/fall/.test(s)) calls.get(ns[0]).add(ns[1]);
    else if (ns.length === 2 && /no longer calls|stopped using|does not talk|outdated|dropped its call|ended with/.test(s)) calls.get(ns[0]).delete(ns[1]);
    else if (ns.length === 2 && mo) { const m = MON.indexOf(mo[1]); if (!(dated.get(k)?.[0] > m)) dated.set(k, [m, /gained|no longer fails|to tolerate|treated .* optional|kept serving|soft dep/.test(s)]); }
    else if (ns.length === 3) soft.set(/straight from|directly|as long as|direct read/.test(s) ? k : `${ns[0]}>${ns.slice(1).find(n => !new RegExp(`(no fallback for|failure of|needs|unlike when) ${esc(n)}`).test(s))}`, /straight from|directly|as long as|direct read/.test(s) ? ns[2] : null);
    else if (ns.length === 2 && !/removed|ignored|never|not something|no degraded|no fallback|not optional|cannot|whenever/.test(s)) soft.set(k, null);
  }
  for (const [k, [, isSoft]] of dated) if (isSoft) soft.set(k, null); else soft.delete(k);
  const sh = new Set([...system.matchAll(/\b([a-z0-9-]+-[0-9a-f]{5})\b/g)].map(m => m[1])), names = [...al.keys()].sort((a, b) => b.length - a.length);
  const L = log.trim().split('\n').map(l => { const [id, ts, src, ...r] = l.split(' '); return { id, t: Date.parse(ts) / 1000, b: r.join(' ').toLowerCase(), svc: al.get(src) || svcs.find(n => src.startsWith(`${n}-`)) || src, src }; }).filter(l => !sh.has(l.src));
  const named = l => names.filter(a => al.get(a) !== l.svc && l.b.includes(a.toLowerCase())).map(a => al.get(a)), sk = l => l.b.replace(/[0-9a-f]*\d[0-9a-f.:]*/g, '#');
  const dep = L.filter(l => FAIL.test(l.b) && !batch.has(l.svc) && !/fallback|degraded|instead|still served|again/.test(l.b)), tc = dep.find(l => dep.filter(x => x.svc === l.svc && x.t >= l.t && x.t < l.t + 240).length >= 4)?.t ?? 0;
  const own = k => L.filter(l => l.svc === k && !BENIGN.test(l.b) && !named(l).length && Object.values(CL).some(re => re.test(l.b))), old = k => new Set(L.filter(l => l.svc === k && l.t < tc - 900).map(sk));
  const req = k => L.filter(l => l.svc === k && l.t > tc - 600 && !named(l).length && /(?:get|post|put|delete) \/\S*(?: status=| -> | )(?:5\d\d|401)\b|slow|during tls|handshake error/.test(l.b)).length;
  const trouble = k => { const o = old(k); return own(k).filter(l => l.t > tc - 600 && l.t < tc + 600 && /^(e|w)[: ]|error|warn/.test(l.b.slice(0, 22)) && !o.has(sk(l))).length + 4 * req(k); };
  const score = k => trouble(k) * (1 + svcs.filter(a => calls.get(a).has(k) && dep.some(l => l.svc === a && l.t >= tc)).length), rec = l => REC.test(l.b) && !/still|but |although|only|once|some|partly|for now|briefly|moment/.test(l.b);
  let root = cheat.root ?? svcs.filter(k => !batch.has(k) && k !== svcs[0]).sort((a, b) => score(b) - score(a))[0];
  for (let c, seen = new Set([root]); !cheat.root && (c = [...calls.get(root)].filter(x => !seen.has(x) && !batch.has(x) && trouble(x) >= 3 && (req(x) > 0 || trouble(x) > trouble(root))).sort((a, b) => trouble(b) - trouble(a))[0]); seen.add(c)) root = c;
  const mine = own(root), lr = Math.max(0, ...L.filter(l => l.t < tc && rec(l) && (l.svc === root || /again/.test(l.b) && named(l).includes(root))).map(l => l.t));
  const cls = cheat.cls ?? Object.entries(CL).map(([c, re]) => [c, mine.filter(l => l.t > lr && re.test(l.b)).length]).sort((a, b) => b[1] - a[1])[0][0], cnt = new Map();
  const tok = l => l.b.match(/'[^']+'|\/[\w./-]{3,}|[\w-]+(?:\.[\w-]+)+\.(?:internal|example)|snap-\w+|\bv?\d+\.\d+\.\d+[\w.+]*|[a-z]+ \(pid/g) || []; for (const l of mine.filter(x => x.t > tc && CL[cls].test(x.b))) for (const x of new Set(tok(l))) cnt.set(x, (cnt.get(x) || 0) + 1);
  const key = [...cnt].sort((a, b) => b[1] - a[1])[0]?.[0], seen = new Set(L.filter(l => l.svc === root && l.t <= lr).map(sk));
  const T = mine.find(l => l.t > lr && CL[cls].test(l.b) && !rec(l) && !seen.has(sk(l)) && (!key || !tok(l).length || tok(l).includes(key))) ?? L[0];
  const imp = new Set([root]); for (let g = true; g;) { g = false; for (const [a, cs] of calls) if (!batch.has(a) && !imp.has(a) && [...cs].some(b => imp.has(b) && (!soft.has(`${a}>${b}`) || imp.has(soft.get(`${a}>${b}`))))) { imp.add(a); g = true; } }
  return { root_service: root, fault_class: cls, first_bad_timestamp: new Date(T.t * 1000).toISOString(), impacted_services: [...imp], evidence_line_ids: [T.id] };
}
