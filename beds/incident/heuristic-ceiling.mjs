// Audit round 4, over-budget "ceiling" attacker (test fixture, diagnostic only): the fourth attacker plus three
// white-box additions (it ignores explicitly partial recoveries, bridges from a service that names no callee to
// its table callee with the most onset-worded lines, and reads the root's numeric stats lines against their own
// median). About 48 dense lines / 12k characters, i.e. over the 40-line triviality budget. It shows what a script
// with full knowledge of the phrase catalog reaches; see AUDIT.md (finding I-12, open).
const OS = { connection_pool_exhaustion: /at capacity|took \d+ms \(pool max|acquire queue length|are checked out; new borrowers|has not been returned|and rising while|without matching load|without closing its transaction|checkouts outpacing/i,
  certificate_expiry: /rejected by the client: certificate expired|no longer valid \(notafter|validity ended at|alert 'certificate_expired'|chain's notafter|hung up right after our certificate/i,
  bad_config_deploy: /rollout started|starting \S+ release|^(?!.*\bpod \S+ loaded).*loaded configuration bundle|picked up by pod|canary|traffic split/i, poisoned_cache: /cache refill: loaded \d+ entries into namespace '[a-z-]+(?<!-preview)'|warm-up finished/i,
  disk_full: /no space left|enospc|could not extend file|0 bytes free|jumped to \d+% \(was|shrinking fast|and climbing|write rate on|points above where|output exploded/i, dns_resolution_failure: /temporary failure in name|eai_again|timed out resolving|could not be resolved \(resolver|cannot refill: lookup/i,
  memory_leak_oom: /heap after full gc is \d+% \(baseline|resident memory \d+ mib and rising|retained objects in cache|watermark crossed|live set after collection/i, upstream_rate_limiting: /429 too many requests \(retry|quota of \d+ requests\/min exhausted|says slow down|x-ratelimit-remaining: 0|refuses most of our calls/i,
  clock_skew: /clock offset vs time source|time sync lost|stepped forward by|ahead of peers|has expired or is not yet valid: current time|rejected as expired: local time/i };
const REC = /cleared|succeeding again|succeed again|resolved on retry|synchroni[sz]ed|freed|steady at|reload succeeded|checksums ok|drained|back to \d+ms|handshake errors stopped|kept after|answering normally|collected back|corrected|flowing normally|validate again|pending=0|\(ok\)|quota usage [1-9]?\d% |lookups\/min, cache hit|handshakes\/min\)|has \d+ GiB free|disk usage [1-7]\d% /i;
const FAIL = /timed out|timeout|\b5\d\d\b|unavailable|refused|deadline|circuit|failed|exhausted|bulkhead|eof|reset|401|could not|gave up|rejecting|unexpected|said:|error (from|calling|body)/i, OK = /fallback|degraded|using |instead|succeeded|reconnected|slow response|\b40[0349]\b|deprecated|without fresh/i;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), word = n => new RegExp(`(^|[^a-z0-9.-])${esc(n)}($|[^a-z0-9-])`), MON = 'JanFebMarAprMayJunJulAugSep';
export function ceilingHeuristicSolve(task) {
  const { system, log } = task.inputs, alias = new Map(), calls = new Map(), batch = new Set(), soft = new Map(), dated = new Map();
  for (const [, n, tier, c, o] of system.matchAll(/^\| ([a-z0-9-]+) \| [^|]+ \| (\w+) \| ([^|]+) \| ([^|]+) \|$/gm)) {
    if (n === 'Service') continue; alias.set(n, n); if (tier === 'batch') batch.add(n);
    calls.set(n, new Set(c.trim() === '-' ? [] : c.split(',').map(x => x.trim().replace(' (optional)', '')))); for (const x of c.split(',')) if (x.includes('(optional)')) soft.set(`${n}>${x.trim().replace(' (optional)', '')}`, null);
    for (const x of o.split(',').map(y => y.trim().replace(/'/g, ''))) if (x !== '-') alias.set(x, n);
  }
  for (const m of system.matchAll(/^- (\S+): (\d+\.\d+\.\d+\.\d+:\d+)$/gm)) alias.set(m[2], m[1]);
  const svcs = [...calls.keys()], inS = s => svcs.filter(n => word(n).test(s)).sort((a, b) => s.search(word(a)) - s.search(word(b)));
  for (const sent of system.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2))) {
    const ns = inS(sent), q = /'([a-z0-9-]+)'/.exec(sent), mo = /\b(January|February|March|April|May|June|July|August|September)\b/.exec(sent), h = /(?:no fallback for|failure of|needs|unlike when) (\S+)/.exec(sent)?.[1];
    if (ns.length === 1 && q && /name|called/.test(sent)) alias.set(q[1], ns[0]);
    else if (ns.length === 2 && /refactor|straight from \S+ in|predates|pending|show yet|missing from|not listed|began calling/.test(sent)) calls.get(ns[0]).add(ns[1]);
    else if (ns.length === 2 && /no longer calls|stopped using|does not talk|outdated|dropped its call|ended with/.test(sent)) calls.get(ns[0]).delete(ns[1]);
    else if (ns.length === 2 && mo) { const m = MON.indexOf(mo[1].slice(0, 3)), k = `${ns[0]}>${ns[1]}`; if (!(dated.get(k)?.[0] > m)) dated.set(k, [m, /gained|no longer fails|tolerate \S+ being down \(|treated|kept serving|soft dep/.test(sent)]); }
    else if (ns.length === 3 && /straight from|directly|as long as|direct read/.test(sent)) soft.set(`${ns[0]}>${ns[1]}`, ns[2]);
    else if (ns.length === 3) soft.set(`${ns[0]}>${ns.slice(1).find(n => n !== h)}`, null);
    else if (ns.length === 2 && !/removed|ignored|never|not something|errors whenever|no degraded|no fallback|not optional|cannot/.test(sent) && /optional|fall|instead|soft|do without|only costs|enrich|substitut|nothing breaks|keeps serving/.test(sent)) soft.set(`${ns[0]}>${ns[1]}`, null).set(`${ns[1]}>${ns[0]}`, null);
  }
  for (const [k, [, isSoft]] of dated) if (isSoft) soft.set(k, null); else soft.delete(k);
  const L = log.trim().split('\n').map(l => { const [id, ts, src, ...r] = l.split(' '), body = r.join(' '), hd = body.slice(0, 24);
    return { id, t: Date.parse(ts), body, svc: alias.get(src) || svcs.find(n => src.startsWith(`${n}-`)) || src, lvl: /^(ERROR|\[ERROR\]|E:)|"(level|lvl|severity)":"error|level=error/i.test(hd) ? 'E' : /^(WARN|\[WARN\]|W:)|"(level|lvl|severity)":"warn|level=warn/i.test(hd) ? 'W' : 'I' }; });
  const res = [...alias.keys()].sort((a, b) => b.length - a.length).map(a => [word(a), alias.get(a)]), named = l => res.find(([re, n]) => n !== l.svc && re.test(l.body))?.[1];
  const fails = L.filter(l => l.lvl !== 'I' && FAIL.test(l.body) && !OK.test(l.body) && (l.callee = named(l)) && calls.get(l.svc)?.has(l.callee)), by = (k, src) => fails.filter(l => l.callee === k && (!src || l.svc === src)).length;
  let root = svcs.filter(k => !batch.has(k)).sort((a, b) => by(b) - by(a))[0];
  const osN = k => L.filter(l => l.svc === k && !named(l) && Object.values(OS).some(re => re.test(l.body))).length, anonF = k => L.filter(l => l.svc === k && l.lvl !== 'I' && !named(l) && /\b5\d\d\b|gave up|deadline|failed/.test(l.body)).length;
  for (let k, seen = new Set([root]); ((k = [...calls.get(root)].filter(c => by(c, root) >= 2).sort((a, b) => by(b, root) - by(a, root))[0]) && (new Set(fails.filter(l => l.callee === k).map(l => l.svc)).size > 1 || L.some(l => l.svc === k && !named(l) && Object.values(OS).some(re => re.test(l.body)) && l.t > (fails.find(f => f.callee === k)?.t ?? 0) - 400000))) || (!fails.some(f => f.svc === root) && anonF(root) >= 3 && (k = [...calls.get(root)].filter(c => !seen.has(c) && osN(c)).sort((a, b) => osN(b) - osN(a))[0]));) { root = k; seen.add(k); }
  const mine = L.filter(l => l.svc === root && !named(l)), tF = fails.find(f => f.callee === root)?.t ?? L.at(-1).t;
  const cls = Object.entries(OS).map(([c, re]) => [c, mine.filter(l => re.test(l.body) && l.t <= tF + 60000).length]).sort((a, b) => b[1] - a[1])[0][0];
  const num = (l, re) => Number(re.exec(l.body)?.[1] ?? NaN), STAT = { connection_pool_exhaustion: /active=(\d+)\//, disk_full: /disk usage (\d+)% on/, memory_leak_oom: /heap after gc (\d+)%/, certificate_expiry: /min, (\d+)% failed/, dns_resolution_failure: /min, (\d+)% failed/, clock_skew: /ntp offset (\d+)ms/, upstream_rate_limiting: /quota usage (\d+)%/ }[cls];
  const vals = STAT ? mine.filter(l => l.t < tF - 600000).map(l => num(l, STAT)).filter(Number.isFinite).sort((a, b) => a - b) : [], med = vals[vals.length >> 1] ?? 0, abn = l => STAT && num(l, STAT) > Math.max(med * 1.15 + 2, 5);
  const isRec = l => (REC.test(l.body) && !/still|resumed|once, but/.test(l.body)) || (STAT && Number.isFinite(num(l, STAT)) && !abn(l));
  const lastRec = mine.filter(l => l.t < tF && isRec(l)).at(-1)?.t ?? 0, T = mine.find(l => l.t > lastRec && l.t <= tF + 60000 && (OS[cls].test(l.body) || abn(l))) ?? mine.find(l => l.t > lastRec) ?? L[0];
  const imp = new Set([root]);
  for (let grew = true; grew;) { grew = false; for (const [a, cs] of calls) if (!batch.has(a) && !imp.has(a) && [...cs].some(b => imp.has(b) && (!soft.has(`${a}>${b}`) || imp.has(soft.get(`${a}>${b}`))))) { imp.add(a); grew = true; } }
  return { root_service: root, fault_class: cls, first_bad_timestamp: new Date(T.t).toISOString(), impacted_services: [...imp], evidence_line_ids: [T.id] };
}
