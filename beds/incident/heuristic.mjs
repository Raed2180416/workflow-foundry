// Audit round 4 triviality attack (test fixture, not part of the bed interface): one <=40-line deterministic
// heuristic that reads only prompt + inputs. Rank services by own non-benign trouble plus blame received, take the
// root's class by vocabulary vote, T = first onset-like root line after its last recovery and before callers fail
// in earnest, impacted = closure over hard callers in the documented graph. `useNote` follows the "not yet in the
// table" note (89% root at d3 before the v3 fix). The bed's tests require < 20% passes at difficulty 3.
const V = { connection_pool_exhaustion: /pool|connection.*(checked out|returned|held)|borrow|acquire|idle=0|waiting for a (free )?\S* ?connection|no idle/i, certificate_expiry: /certificat|x509|notafter|handshake|tls|alert 45|acme|first byte|leaf/i,
  bad_config_deploy: /rollout|release|config|deploy|setting|panic|route for|serializer|validator|toggle|nil pointer/i, disk_full: /disk|space|enospc|errno 28|volume|read-only|fsync|free bytes|compaction|checkpoint failed|temp file/i,
  dns_resolution_failure: /lookup|resolv|getaddrinfo|eai_again|servfail|nameserver|dns|address (unknown|of)|no addresses|host cache/i, memory_leak_oom: /heap|memory|oom|rss|gc |allocation|old gen|live set|retained/i,
  clock_skew: /clock|ntp|chrony|skew|drift|time sync|stepped|issued-at|nbf|not yet valid|jwt|ttl|fired .* early|signature timestamp/i, upstream_rate_limiting: /429|throttl|quota|rate limit|slow down|budget|backing off|token bucket|refuses most/i,
  poisoned_cache: /cache refill|warm-up finished|checksum|integrity|missing field|is null|schema v|bytes \(typical|empty '|primed/i };
const BENIGN = /sandbox|per-client|client \S+ (approaching|offered)|\(ok\)|within (tolerance|budget)|expected;|retired|canary|preview|cleaned up|young generation|days|no waiters|renewed|client's own|client presented|scheduled report|threshold 80|staged/i;
const ONSET = /at capacity|took \d+ms \(pool max|acquire queue length|are checked out; new borrowers|has not been returned|and rising while|without matching load|without closing its transaction|checkouts outpacing|rejected by the client: certificate expired|no longer valid \(notAfter|validity ended at|alert 'certificate_expired'|chain's notafter|hung up right after our certificate|rollout started|starting \S+ release|loaded configuration bundle|picked up by pod|no space left|enospc|could not extend file|0 bytes free|jumped to \d+% \(was|shrinking fast|and climbing|write rate on|points above where|output exploded|temporary failure in name|eai_again|timed out resolving|could not be resolved \(resolver|cannot refill: lookup|heap after full gc is \d+% \(baseline|resident memory \d+ mib and rising|retained objects in cache|watermark crossed|live set after collection|clock offset vs time source|time sync lost|stepped forward by|ahead of peers|has expired or is not yet valid: current time|rejected as expired: local time|429 too many requests \(retry|quota of \d+ requests\/min exhausted|says slow down|x-ratelimit-remaining: 0|refuses most of our calls|cache refill: loaded|warm-up finished/i;
const RECOVER = /cleared|succeeding again|resolved on retry|synchronised|freed|steady at|reloaded;|reload succeeded|checksums ok/i, esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function heuristicSolve(task, { useNote = false } = {}) {
  const { system, log } = task.inputs, alias = new Map(), calls = new Map(), batch = new Set(), soft = new Set();
  for (const [, n, tier, c, o] of system.matchAll(/^\| ([a-z0-9-]+) \| [^|]+ \| (\w+) \| ([^|]+) \| ([^|]+) \|$/gm)) {
    if (n === 'Service') continue; alias.set(n, n); if (tier === 'batch') batch.add(n);
    calls.set(n, new Set(c.trim() === '-' ? [] : c.split(',').map(x => x.trim().replace(' (optional)', '')))); for (const x of c.split(',')) if (x.includes('(optional)')) soft.add(`${n}>${x.trim().replace(' (optional)', '')}`);
    for (const x of o.split(',').map(y => y.trim().replace(/'/g, ''))) if (x !== '-') alias.set(x, n);
  }
  for (const m of system.matchAll(/^- (\S+): (\d+\.\d+\.\d+\.\d+:\d+)$/gm)) alias.set(m[2], m[1]);
  const svcs = [...calls.keys()], inS = s => svcs.filter(n => new RegExp(`(^|[^a-z0-9-])${esc(n)}($|[^a-z0-9-])`).test(s)).sort((a, b) => s.indexOf(a) - s.indexOf(b));
  let noted = null;
  for (const sent of system.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2))) {
    const ns = inS(sent), q = /'([a-z0-9-]+)'/.exec(sent);
    if (ns.length === 1 && q && /name|called/.test(sent)) alias.set(q[1], ns[0]);
    if (/refactor|straight from|table predates|table update pending|does not show yet/.test(sent) && ns.length === 2) { calls.get(ns[0]).add(ns[1]); noted = ns[1]; }
    else if (/no longer|stopped using|does not talk/.test(sent) && ns.length === 2) calls.get(ns[0]).delete(ns[1]);
    else if (ns.length === 3 && /optional|keeps serving/.test(sent)) soft.add(`${ns[0]}>${ns[1]}`);
    else if (ns.length === 2 && !/no fallback|not optional|never built|cannot serve/.test(sent) && /optional|fall|instead|soft/.test(sent)) { soft.add(`${ns[0]}>${ns[1]}`); soft.add(`${ns[1]}>${ns[0]}`); }
  }
  const L = log.trim().split('\n').map(l => { const [id, ts, src, ...r] = l.split(' '), body = r.join(' '), h = body.slice(0, 24);
    return { id, t: Date.parse(ts), body, svc: alias.get(src) || svcs.find(n => src.startsWith(`${n}-`)) || src, lvl: /^(ERROR|\[ERROR\]|E:)|"(level|lvl|severity)":"error|level=error/i.test(h) ? 'E' : /^(WARN|\[WARN\]|W:)|"(level|lvl|severity)":"warn|level=warn/i.test(h) ? 'W' : 'I' }; });
  const res = [...alias.keys()].sort((a, b) => b.length - a.length).map(a => [new RegExp(`(^|[^a-z0-9.-])${esc(a)}($|[^a-z0-9-])`), alias.get(a)]), blames = (l, k) => res.some(([re, n]) => n === k && re.test(l.body));
  const sick = k => L.filter(l => l.svc === k && l.lvl !== 'I' && !BENIGN.test(l.body)).length + 3 * L.filter(l => l.svc !== k && l.lvl === 'E' && blames(l, k)).length;
  const root = (useNote && noted) || svcs.filter(s => !batch.has(s) && s !== svcs[0]).sort((a, b) => sick(b) - sick(a))[0];
  const bl = L.filter(l => l.svc !== root && l.lvl !== 'I' && blames(l, root) && !/\b40\d\b|slow response|reconnected|deprecated|succeeded|fallback|using |instead/i.test(l.body)), tF = bl.find((l, i) => bl[i + 2] && bl[i + 2].t - l.t < 240000)?.t ?? L.at(-1).t;
  const mine = L.filter(l => l.svc === root && !BENIGN.test(l.body)), lastRec = mine.filter(l => l.t < tF && RECOVER.test(l.body)).at(-1)?.t ?? 0;
  const late = mine.filter(l => l.t > lastRec && l.t >= tF - 420000 && (l.lvl !== 'I' || /refill|warm-up|rollout|release|picked up/.test(l.body)));
  const cls = Object.entries(V).map(([k, re]) => [k, late.filter(l => re.test(l.body)).length]).sort((a, b) => b[1] - a[1])[0][0];
  const os = mine.filter(l => l.t > lastRec && l.t <= tF + 60000 && ONSET.test(l.body)), onset = (/cache|config/.test(cls) ? os.at(-1) : os[0]) || late.find(l => V[cls].test(l.body)) || late[0] || L[0];
  const imp = new Set([root]); for (let grew = true; grew;) { grew = false; for (const [a, cs] of calls) if (!batch.has(a) && !imp.has(a) && [...cs].some(b => imp.has(b) && !soft.has(`${a}>${b}`))) { imp.add(a); grew = true; } }
  return { root_service: root, fault_class: cls, first_bad_timestamp: new Date(onset.t).toISOString(), impacted_services: [...imp], evidence_line_ids: [onset.id] };
}
export const noteSolve = task => heuristicSolve(task, { useNote: true });
