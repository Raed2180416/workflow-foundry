// Static vocabulary for the `incident` bed: fictional roles, fault classes and phrasing pools.
// Everything here is invented for this bed. Template functions take (c, r): c is a context
// object prepared by the generator, r is the seeded RNG from beds/lib/rng.mjs.

export const FAULT_CLASSES = [
  'connection_pool_exhaustion',
  'certificate_expiry',
  'bad_config_deploy',
  'disk_full',
  'dns_resolution_failure',
  'memory_leak_oom',
  'clock_skew',
  'upstream_rate_limiting',
  'poisoned_cache',
];

export const CLASS_SUMMARY = {
  connection_pool_exhaustion: "the service's own client connection pool to a datastore is saturated or leaking, so its requests queue and time out while the datastore itself stays healthy",
  certificate_expiry: 'a TLS certificate served by the service passed the end of its validity period, so clients refuse to connect to it',
  bad_config_deploy: 'a new release or configuration rollout of the service broke its behaviour',
  disk_full: "the service's storage volume ran out of free space, so its writes fail",
  dns_resolution_failure: 'the service can no longer resolve the hostnames of the things it calls, although those targets are healthy',
  memory_leak_oom: 'memory in the service grows without bound until the process is killed for exceeding its memory limit',
  clock_skew: "the service's system clock drifted away from real time, breaking its time-sensitive checks",
  upstream_rate_limiting: 'an external third-party provider the service depends on started throttling its calls',
  poisoned_cache: "the service's cache holds corrupt or invalid entries that it keeps serving to its callers",
};

// Plausible confusions used by the 'sibling class' near-miss control.
export const SIBLING_CLASS = {
  connection_pool_exhaustion: 'upstream_rate_limiting',
  certificate_expiry: 'clock_skew',
  bad_config_deploy: 'poisoned_cache',
  disk_full: 'memory_leak_oom',
  dns_resolution_failure: 'connection_pool_exhaustion',
  memory_leak_oom: 'disk_full',
  clock_skew: 'certificate_expiry',
  upstream_rate_limiting: 'connection_pool_exhaustion',
  poisoned_cache: 'bad_config_deploy',
};

export const COMPANIES = [
  'Marrowfield Goods', 'Corvane Outfitters', 'Ashgrove Pantry', 'Kestrelmoor Books', 'Tidewick Hardware',
  'Bramblecourt Tea', 'Quillfeather Stationers', 'Hollowmere Cycles', 'Saltmarsh Provisions', 'Larchwood Toys',
  'Fennick & Daughters', 'Oxbow Lane Apparel', 'Pellucid Lamps', 'Thimbleton Crafts',
];
export const TEAMS = ['otter', 'sable', 'heron', 'juniper', 'basalt', 'marten', 'plover', 'cedar', 'wren', 'lynx', 'fennel', 'quartz', 'tamarind', 'bittern'];

export const EXTERNALS = {
  card: { names: ['Brindlepay', 'Coppergate Payments', 'Tallowmark Pay'], what: 'card processor' },
  mail: { names: ['Larkpost Mail', 'Inkwell Relay'], what: 'transactional e-mail provider' },
  carrier: { names: ['Cindertrack Carriers', 'Swiftbarrow Freight'], what: 'parcel carrier API' },
  cdn: { names: ['Pebblecast Edge', 'Glimmerline CDN'], what: 'image CDN purge API' },
  risk: { names: ['Hollowcrest Risk', 'Vigilmoor Scoring'], what: 'fraud scoring vendor' },
  tax: { names: ['Ferrowind Tax API', 'Levyline Rates'], what: 'tax-rate provider' },
  geo: { names: ['Quayside Geocoding', 'Mapplewood Places'], what: 'geocoding provider' },
};

// Roles in a global topological order: a service may only call roles listed after it.
// layer 0 edge, 1 api, 2 core, 3 data, 9 batch (noisy, no callers).
export const ROLES = [
  { key: 'gateway', layer: 0, tier: 'edge', names: ['edge-gateway', 'api-gateway', 'front-door'], legacy: ['ingress', 'edge'], weight: 3.0, likes: [], routes: ['GET /api/v1/products', 'GET /api/v1/cart', 'POST /api/v1/checkout', 'GET /api/v1/search', 'GET /api/v1/account', 'POST /api/v1/login', 'GET /api/v1/orders', 'GET /api/v1/home'], what: 'public API routing' },
  { key: 'bff', layer: 1, tier: 'api', names: ['web-bff', 'storefront-bff'], legacy: ['shopfront', 'bff'], weight: 1.8, likes: ['pricing', 'catalog', 'recs', 'flags', 'inventory'], cache: true, routes: ['GET /page/home', 'GET /page/product', 'GET /page/category'], what: 'rendered storefront pages' },
  { key: 'checkout', layer: 1, tier: 'api', names: ['checkout-svc', 'checkout-api'], legacy: ['till'], weight: 1.5, likes: ['pricing', 'inventory', 'payments', 'coupon', 'tax', 'orders', 'auth', 'session'], routes: ['POST /v2/checkout', 'POST /v2/checkout/confirm', 'GET /v2/checkout/status'], what: 'checkout' },
  { key: 'search', layer: 1, tier: 'api', names: ['search-api', 'finder-svc'], legacy: ['finder'], weight: 1.4, likes: ['searchidx', 'catalog', 'recs', 'pricing', 'flags'], cache: true, routes: ['GET /v1/search', 'GET /v1/suggest'], what: 'search results' },
  { key: 'profile', layer: 1, tier: 'api', names: ['profile-svc', 'account-api'], legacy: ['people'], weight: 1.2, likes: ['auth', 'userdb', 'recs', 'session', 'geo'], db: 'userdb', cache: true, routes: ['GET /v1/profile', 'PUT /v1/profile', 'GET /v1/addresses'], what: 'customer profiles' },
  { key: 'notify', layer: 1, tier: 'api', names: ['notify-svc', 'messaging-svc'], legacy: ['herald'], weight: 1.0, likes: ['bus', 'auth', 'flags'], external: 'mail', routes: ['POST /v1/notify', 'POST /v1/email'], what: 'customer notifications' },
  { key: 'shipping', layer: 1, tier: 'api', names: ['shipping-svc', 'fulfil-api'], legacy: ['dock'], weight: 1.1, likes: ['orders', 'geo', 'inventory', 'bus'], external: 'carrier', routes: ['POST /v1/shipments', 'GET /v1/shipping-rates'], what: 'shipment booking' },
  { key: 'media', layer: 1, tier: 'api', names: ['media-api', 'image-svc'], legacy: ['pixels'], weight: 1.1, likes: ['blob', 'catalog'], external: 'cdn', disk: true, routes: ['GET /img/resize', 'POST /img/upload'], what: 'product images' },
  { key: 'loyalty', layer: 1, tier: 'api', names: ['loyalty-svc', 'rewards-api'], legacy: ['points'], weight: 1.0, likes: ['ledger', 'coupon', 'auth', 'userdb'], db: 'userdb', routes: ['GET /v1/points', 'POST /v1/redeem'], what: 'loyalty points' },
  { key: 'orders', layer: 2, tier: 'core', names: ['orders-api', 'order-svc'], legacy: ['oms'], weight: 1.2, likes: ['inventory', 'payments', 'ledger', 'ordersdb', 'bus'], db: 'ordersdb', routes: ['POST /v3/orders', 'GET /v3/orders/{id}'], what: 'order records' },
  { key: 'pricing', layer: 2, tier: 'core', names: ['pricing-svc', 'quote-engine'], legacy: ['rates'], weight: 1.3, likes: ['tax', 'coupon', 'flags', 'catalogdb'], db: 'catalogdb', cache: true, routes: ['GET /v2/quote', 'POST /v2/quote/batch'], what: 'price quotes', fallback: 'the last cached price' },
  { key: 'payments', layer: 2, tier: 'core', names: ['payments-svc', 'pay-core'], legacy: ['purse'], weight: 1.0, likes: ['fraud', 'ledger', 'auth', 'ledgerdb'], db: 'ledgerdb', external: 'card', routes: ['POST /v1/charge', 'POST /v1/refund'], what: 'card charges' },
  { key: 'recs', layer: 2, tier: 'core', names: ['recs-engine', 'suggest-svc'], legacy: ['muse'], weight: 1.0, likes: ['catalog', 'flags', 'session'], cache: true, routes: ['GET /v1/recs', 'GET /v1/similar'], what: 'recommendations', fallback: 'a static bestseller list' },
  { key: 'inventory', layer: 2, tier: 'core', names: ['inventory-svc', 'stock-svc'], legacy: ['larder'], weight: 1.1, likes: ['ordersdb', 'catalogdb', 'bus'], db: 'catalogdb', cache: true, routes: ['GET /v1/stock', 'POST /v1/reserve'], what: 'stock levels', fallback: "an 'availability unknown' badge" },
  { key: 'catalog', layer: 2, tier: 'core', names: ['catalog-svc', 'product-svc'], legacy: ['shelf'], weight: 1.2, likes: ['catalogdb', 'searchidx', 'blob'], db: 'catalogdb', cache: true, routes: ['GET /v1/products/{id}', 'GET /v1/categories'], what: 'product details', fallback: 'cached product cards' },
  { key: 'fraud', layer: 2, tier: 'core', names: ['fraud-scorer', 'risk-svc'], legacy: ['tellwise'], weight: 0.8, likes: ['userdb'], external: 'risk', routes: ['POST /v1/score'], what: 'risk scores', fallback: 'a default medium risk score' },
  { key: 'tax', layer: 2, tier: 'core', names: ['tax-engine', 'levy-svc'], legacy: ['levy'], weight: 0.9, likes: ['geo'], external: 'tax', cache: true, routes: ['GET /v1/tax/rate', 'POST /v1/tax/calc'], what: 'tax amounts', fallback: 'the last cached rate table' },
  { key: 'coupon', layer: 2, tier: 'core', names: ['coupon-svc', 'promo-svc'], legacy: ['voucher'], weight: 0.9, likes: ['userdb'], db: 'userdb', cache: true, routes: ['POST /v1/coupons/validate', 'GET /v1/promos'], what: 'promotion checks', fallback: 'no discount' },
  { key: 'ledger', layer: 2, tier: 'core', names: ['ledger-svc', 'bookkeeper-svc'], legacy: ['abacus'], weight: 0.9, likes: ['ledgerdb', 'bus'], db: 'ledgerdb', routes: ['POST /v1/entries', 'GET /v1/balance'], what: 'ledger entries' },
  { key: 'auth', layer: 2, tier: 'core', names: ['auth-svc', 'identity-svc'], legacy: ['keyring'], weight: 1.2, likes: ['userdb', 'session'], db: 'userdb', cache: true, routes: ['POST /oauth/token', 'GET /v1/introspect'], what: 'token validation', fallback: 'cached token introspection results' },
  { key: 'geo', layer: 2, tier: 'core', names: ['geo-lookup', 'address-svc'], legacy: ['wayfind'], weight: 0.8, likes: [], external: 'geo', cache: true, routes: ['GET /v1/geocode', 'GET /v1/validate-address'], what: 'address lookups', fallback: 'the unvalidated address' },
  { key: 'flags', layer: 2, tier: 'core', names: ['feature-flags', 'toggle-svc'], legacy: ['switches'], weight: 0.9, likes: [], cache: true, routes: ['GET /v1/flags', 'GET /v1/flags/{key}'], what: 'feature flags', fallback: 'built-in default flag values' },
  { key: 'ordersdb', layer: 3, tier: 'data', kind: 'db', names: ['orders-db', 'order-store'], legacy: ['oms-pg'], weight: 0.8, likes: [], disk: true, what: 'order storage' },
  { key: 'catalogdb', layer: 3, tier: 'data', kind: 'db', names: ['catalog-db', 'product-store'], legacy: ['shelf-pg'], weight: 0.8, likes: [], disk: true, what: 'catalogue storage' },
  { key: 'ledgerdb', layer: 3, tier: 'data', kind: 'db', names: ['ledger-db', 'books-store'], legacy: ['abacus-pg'], weight: 0.7, likes: [], disk: true, what: 'ledger storage' },
  { key: 'userdb', layer: 3, tier: 'data', kind: 'db', names: ['user-db', 'accounts-store'], legacy: ['people-pg'], weight: 0.8, likes: [], disk: true, what: 'account storage' },
  { key: 'session', layer: 3, tier: 'data', kind: 'kv', names: ['session-store', 'session-cache'], legacy: ['sesh'], weight: 0.9, likes: [], what: 'session data', fallback: 'a fresh anonymous session' },
  { key: 'searchidx', layer: 3, tier: 'data', kind: 'index', names: ['search-index', 'find-index'], legacy: ['finder-idx'], weight: 0.8, likes: [], disk: true, what: 'indexed search results' },
  { key: 'bus', layer: 3, tier: 'data', kind: 'broker', names: ['event-bus', 'stream-broker'], legacy: ['relay'], weight: 0.8, likes: [], disk: true, what: 'event publishing', fallback: 'a local outbox that is flushed later' },
  { key: 'blob', layer: 3, tier: 'data', kind: 'blob', names: ['blob-proxy', 'object-gw'], legacy: ['crate'], weight: 0.7, likes: [], disk: true, what: 'stored files', fallback: 'a placeholder image' },
  { key: 'exporter', layer: 9, tier: 'batch', kind: 'batch', names: ['report-exporter', 'nightly-export'], legacy: ['exporter'], weight: 0.9, likes: [], what: 'partner report exports', noisyFlavor: 'sftp' },
  { key: 'wsync', layer: 9, tier: 'batch', kind: 'batch', names: ['warehouse-sync', 'erp-bridge'], legacy: ['wms-sync'], weight: 0.9, likes: [], what: 'warehouse stock sync', noisyFlavor: 'partner-timeout' },
  { key: 'audit', layer: 9, tier: 'batch', kind: 'batch', names: ['audit-shipper', 'compliance-dump'], legacy: ['auditd2'], weight: 0.9, likes: [], what: 'audit log shipping', noisyFlavor: 'metrics' },
];
ROLES.forEach((role, i) => { role.order = i; });

const hex = (r, n) => Array.from({ length: n }, () => '0123456789abcdef'[r.int(0, 15)]).join('');
export const rid = r => `req-${hex(r, 8)}`;
export const hexs = hex;
const pct = (r, lo, hi) => r.int(lo, hi);

// ---------------------------------------------------------------- fault templates
// Each returns [level, message]. `c` fields used: db, pool, max, ext, calleeHost, callerHost,
// host, port, expIso, route, newVer, oldVer, svc, vol, key, ns, field, skew, lim, pod, ip, cacheName.

export const FAULTS = {
  connection_pool_exhaustion: {
    onset: [
      (c, r) => ['WARN', `connection pool '${c.pool}' at capacity: in use ${c.max}/${c.max}, ${r.int(30, 140)} callers waiting`],
      (c, r) => ['WARN', `waiting for a ${c.db} connection took ${r.int(900, 2900)}ms (pool max ${c.max})`],
      (c, r) => ['WARN', `db client: acquire queue length ${r.int(25, 90)}, no idle connections to ${c.db}`],
    ],
    direct: [
      (c, r) => ['ERROR', `timed out after ${r.pick([2000, 3000, 5000])}ms waiting for a free connection to ${c.db} (in use ${c.max}/${c.max})`],
      (c, r) => ['ERROR', `could not obtain a database connection within ${r.pick([1500, 3000])}ms; pool '${c.pool}' saturated`],
      (c, r) => ['WARN', `connection pool '${c.pool}' still exhausted: active=${c.max} idle=0 pending=${r.int(40, 260)}`],
      (c, r) => ['ERROR', `${c.route} aborted: no idle ${c.db} connection available (${r.int(20, 200)} waiting)`],
    ],
    indirect: [
      (c, r) => ['WARN', `pool stats total=${c.max} active=${c.max} idle=0 pending=${r.int(40, 300)}`],
      (c, r) => ['WARN', `possible leak: connection checked out ${r.int(31, 400)}s ago by ${c.route} was never returned`],
      (c, r) => ['ERROR', `handler ${c.route} waited ${r.int(2100, 9000)}ms before its first query could start`],
      (c, r) => ['WARN', `db client: borrowed=${c.max} returned=${r.int(0, 3)} in the last 60s`],
    ],
    rootReq: [
      (c, r) => ['ERROR', `${c.route} 503 ${r.int(2000, 5100)}ms err="db acquire timeout"`],
      (c, r) => ['ERROR', `${c.route} 503 ${r.int(2000, 5100)}ms`],
    ],
    rootReqP: 0.5,
    blip: [
      (c, r) => ['WARN', `pool '${c.pool}' briefly saturated (${c.max}/${c.max} in use)`],
      (c, r) => ['WARN', `connection acquire wait ${r.int(400, 1500)}ms on pool '${c.pool}'`],
    ],
    recover: (c, r) => ['INFO', `pool pressure cleared; pending=0 active=${r.int(3, 12)}/${c.max}`],
    phrases: ['connection pool exhaustion', 'its database connection pool running dry', 'DB connection starvation'],
  },

  certificate_expiry: {
    onset: [
      (c, r) => ['ERROR', `TLS handshake from ${c.callerHost} rejected by the client: certificate expired (notAfter ${c.expIso})`],
      (c, r) => ['ERROR', `inbound TLS on :${c.port} failing: serving certificate for ${c.host} is no longer valid (notAfter ${c.expIso})`],
      (c, r) => ['WARN', `x509 serving cert ${c.host} validity ended at ${c.expIso}; peers aborting handshakes`],
    ],
    direct: [
      (c, r) => ['WARN', `${r.int(12, 140)} TLS handshakes failed in the last 30s (reason: expired leaf certificate)`],
      (c, r) => ['ERROR', `handshake failure from ${c.callerHost}: remote error: tls: expired certificate`],
      (c, r) => ['WARN', `cert renewer: last successful renewal for ${c.host} was ${r.int(88, 97)} days ago; nothing scheduled`],
      (c, r) => ['WARN', `listener :${c.port}: ${c.callerHost} closed the connection during handshake (bad certificate)`],
    ],
    indirect: [
      (c, r) => ['WARN', `inbound request rate fell to ${r.int(0, 6)}/min; connections close before the first byte`],
      (c, r) => ['WARN', `TLS alert 45 received from ${c.callerHost}`],
      (c, r) => ['ERROR', `serving certificate serial ${hex(r, 12)} is outside its validity window`],
    ],
    precursor: (c, r, minutes) => ['WARN', `certificate for ${c.host} expires in ${minutes} minutes (notAfter ${c.expIso}); renewal not confirmed`],
    rootReq: [
      (c, r) => ['WARN', `connection from ${c.callerHost} closed during TLS handshake`],
      (c, r) => ['WARN', `handshake error from ${c.callerHost}: EOF`],
    ],
    rootReqP: 0.45,
    firstHop: [
      (c, r) => ['ERROR', `x509: certificate has expired or is not yet valid: current time ${c.nowIso} is after ${c.expIso} (dialing ${c.callee})`],
      (c, r) => ['ERROR', `TLS verification failed for ${c.callee}: certificate expired`],
      (c, r) => ['ERROR', `SSL handshake to ${c.callee} failed: certificate verify failed (certificate has expired)`],
    ],
    firstHopP: 0.6,
    blip: [
      (c, r) => ['WARN', `TLS handshake errors from ${c.callerHost}: unknown certificate authority`],
      (c, r) => ['WARN', `${r.int(3, 20)} handshakes failed: certificate chain incomplete`],
    ],
    recover: (c, r) => ['INFO', 'certificate bundle reloaded; handshakes succeeding again'],
    phrases: ['an expired TLS certificate', 'certificate expiry', 'a lapsed serving certificate'],
  },

  bad_config_deploy: {
    onset: [
      (c, r) => ['INFO', `rollout started: ${c.svc} ${c.oldVer} -> ${c.newVer}`],
      (c, r) => ['INFO', `starting ${c.svc} release ${c.newVer} (previous ${c.oldVer})`],
      (c, r) => ['INFO', `loaded configuration bundle from release ${c.newVer} (was ${c.oldVer})`],
    ],
    direct: [
      (c, r) => ['ERROR', `config value '${r.pick(['upstream.timeout', 'retry.max', 'pool.size', 'routes.default'])}'='${r.pick(['2s', '-1', 'none', '0x10'])}' is not valid; using fallback ${r.pick(['0', 'null', 'empty'])}`],
      (c, r) => ['ERROR', `no route for '${c.route}' in routing table from ${c.newVer}; returning 500`],
      (c, r) => ['ERROR', `panic in handler ${c.route}: feature '${r.pick(['fast-path', 'bulk-mode', 'v3-schema', 'lazy-load'])}' enabled by the new config but its dependency is not initialised`],
      (c, r) => ['WARN', `unknown setting '${r.pick(['cache.ttl_ms', 'http.keepalive', 'batch.window'])}' ignored (introduced in ${c.newVer})`],
      (c, r) => ['ERROR', `upstream base URL from config is malformed: '${r.pick(['http//', 'https://:8443', 'tcp://undefined'])}'`],
    ],
    indirect: [
      (c, r) => ['WARN', `effective timeout for ${c.callee || 'upstream calls'} is 0ms after reload`],
      (c, r) => ['ERROR', `${c.route} 500 err="nil pointer: settings.${r.pick(['limits', 'routes', 'auth'])}"`],
      (c, r) => ['WARN', `build ${c.newVer}: ${r.int(5, 80)} requests rejected by input validator (schema '${r.pick(['v4', 'quote-next', 'beta'])}' not found)`],
    ],
    rootReq: [
      (c, r) => ['ERROR', `${c.route} 500 ${r.int(3, 40)}ms build=${c.newVer}`],
      (c, r) => ['ERROR', `${c.route} 500 ${r.int(3, 40)}ms`],
    ],
    rootReqP: 0.5,
    blip: [
      (c, r) => ['WARN', `config reload rejected (syntax error at line ${r.int(10, 200)} of ${r.pick(['app.yaml', 'routes.toml', 'limits.json'])}); keeping previous config`],
    ],
    recover: (c, r) => ['INFO', 'config reload succeeded; serving with the new limits'],
    phrases: ['a bad configuration rollout', 'the latest deploy', 'a broken release'],
  },

  disk_full: {
    onset: [
      (c, r) => ['ERROR', `write to ${c.vol}/${r.pick(['wal', 'data', 'segments'])}/${hex(r, 8)} failed: no space left on device`],
      (c, r) => ['ERROR', `flush of segment ${r.int(1000, 9999)} aborted: ENOSPC`],
      (c, r) => ['ERROR', `could not extend file "${c.vol}/base/${r.int(16000, 17000)}/${r.int(2000, 9000)}": No space left on device`],
    ],
    direct: [
      (c, r) => ['ERROR', 'append to write-ahead log failed; switching to read-only mode'],
      (c, r) => ['ERROR', `rejecting write: volume ${c.vol} is 100% full (${r.pick([50, 100, 200, 500])} GiB)`],
      (c, r) => ['ERROR', `compaction aborted: insufficient free space on ${c.vol}`],
      (c, r) => ['WARN', `could not create temp file in ${c.vol}/tmp`],
      (c, r) => ['ERROR', 'checkpoint failed: no space left on device'],
    ],
    indirect: [
      (c, r) => ['ERROR', `fsync returned error 28 on ${c.vol}/${r.pick(['wal', 'idx', 'log'])}.${r.int(1, 99)}`],
      (c, r) => ['ERROR', 'storage layer refused append (errno 28)'],
      (c, r) => ['WARN', `free bytes on ${c.vol}: 0`],
    ],
    rootReq: [
      (c, r) => ['ERROR', `${c.writeRoute} 507 ${r.int(2, 30)}ms`],
      (c, r) => ['ERROR', `${c.writeRoute} 500 ${r.int(2, 30)}ms "insufficient storage"`],
    ],
    rootReqP: 0.35,
    blip: [
      (c, r) => ['WARN', `disk usage ${r.int(95, 98)}% on ${c.vol}`],
      (c, r) => ['WARN', `log rotation freed ${r.int(3, 20)} GiB on ${c.vol}`],
    ],
    recover: (c, r) => ['INFO', `disk usage back to ${r.int(55, 70)}% on ${c.vol}`],
    phrases: ['a full disk', 'a full data volume', 'storage running out of space'],
  },

  dns_resolution_failure: {
    onset: [
      (c, r) => ['ERROR', `lookup ${c.calleeHost}: temporary failure in name resolution`],
      (c, r) => ['ERROR', `getaddrinfo EAI_AGAIN ${c.calleeHost}`],
      (c, r) => ['ERROR', `resolver ${c.ip}:53 timed out resolving ${c.calleeHost}`],
    ],
    direct: [
      (c, r) => ['ERROR', `dial tcp: lookup ${c.calleeHost} on ${c.ip}:53: i/o timeout`],
      (c, r) => ['ERROR', `could not resolve ${c.calleeHost} (attempt ${r.int(1, 3)}/3)`],
      (c, r) => ['ERROR', `SERVFAIL while resolving ${c.calleeHost}`],
      (c, r) => ['WARN', `nameserver ${c.ip} unreachable; no fallback resolver configured`],
    ],
    indirect: [
      (c, r) => ['ERROR', `name lookup for ${c.calleeHost} returned no addresses`],
      (c, r) => ['WARN', `address of ${c.calleeHost} unknown; request ${rid(r)} dropped`],
      (c, r) => ['WARN', `host cache: ${r.int(4, 40)} entries expired and refresh keeps failing`],
    ],
    rootReq: [
      (c, r) => ['ERROR', `${c.route} 502 ${r.int(5000, 10050)}ms upstream unresolved`],
      (c, r) => ['ERROR', `${c.route} 502 ${r.int(5000, 10050)}ms`],
    ],
    rootReqP: 0.45,
    blip: [
      (c, r) => ['WARN', `transient resolver timeout for ${c.calleeHost || c.host}`],
    ],
    recover: (c, r) => ['INFO', `${c.calleeHost || c.host} resolved on retry`],
    phrases: ['a DNS outage', 'name resolution failures', 'DNS problems'],
  },

  memory_leak_oom: {
    onset: [
      (c, r) => ['WARN', `heap after full GC is ${c.p0}% (baseline ${c.base}%); old generation not shrinking`],
      (c, r) => ['WARN', `resident memory ${c.mb0} MiB and rising (+${r.int(18, 60)} MiB/min)`],
      (c, r) => ['WARN', `retained objects in cache '${c.cacheName}' grew to ${r.int(300, 900)}k entries; GC cannot reclaim them`],
    ],
    growth: [
      (c, r, p) => ['WARN', `post-GC heap ${p}% (+${r.int(3, 9)}% in ${r.int(30, 60)}s)`],
      (c, r, p) => ['WARN', `GC overhead ${r.int(25, 70)}% of CPU; heap ${p}%`],
      (c, r, p) => ['WARN', `allocation stall ${r.int(200, 1900)}ms; heap ${p}%`],
      (c, r, p) => ['WARN', `rss ${Math.round(c.lim * p / 100)} MiB of ${c.lim} MiB`],
    ],
    oom: [
      (c, r) => ['ERROR', `container ${c.pod} terminated: OOMKilled (limit ${c.lim}Mi), restart #${c.restarts}`],
      (c, r) => ['ERROR', `process killed by the memory cgroup (limit ${c.lim}Mi); supervisor restarting (#${c.restarts})`],
      (c, r) => ['ERROR', `fatal: heap out of memory after ${r.int(200, 900)}s uptime; exit code 137`],
    ],
    restart: [
      (c, r) => ['INFO', `starting ${c.svc} (pid ${r.int(1000, 60000)})`],
      (c, r) => ['INFO', `ready to serve on :${c.port}`],
    ],
    rootReq: [
      (c, r) => ['WARN', `${c.route} 200 ${r.int(1500, 6000)}ms (slow)`],
      (c, r) => ['ERROR', `${c.route} 503 ${r.int(1, 20)}ms (warming up)`],
    ],
    rootReqP: 0.35,
    firstHop: [
      (c, r) => ['ERROR', `connection refused ${c.calleeHost}`],
      (c, r) => ['ERROR', `connection reset by peer while calling ${c.callee}`],
      (c, r) => ['ERROR', `upstream ${c.callee} closed the connection unexpectedly (EOF)`],
    ],
    firstHopP: 0.6,
    blip: [
      (c, r) => ['ERROR', `container ${c.pod} OOMKilled (limit ${c.lim}Mi), restart #1`],
    ],
    recover: (c, r) => ['INFO', `restarted; heap steady at ${r.int(35, 48)}%`],
    phrases: ['a memory leak', 'repeated OOM kills', 'memory exhaustion'],
  },

  clock_skew: {
    onset: [
      (c, r) => ['WARN', `clock offset vs time source is +${c.skew}s (tolerance 0.5s)`],
      (c, r) => ['WARN', `time sync lost: last successful NTP exchange ${r.int(40, 180)} min ago; estimated drift +${c.skew}s`],
      (c, r) => ['WARN', `system clock stepped forward by ${c.skew}s`],
    ],
    direct: [
      (c, r) => ['WARN', `rejecting bearer token from ${c.callerHost}: issued-at is ${c.skew}s in the future`],
      (c, r) => ['WARN', `token presented by ${c.callerHost} considered expired ${r.int(5, 60)}s ago`],
      (c, r) => ['ERROR', `request signature timestamp outside allowed window (skew ${c.skew}s)`],
      (c, r) => ['ERROR', `lease renewal computed a negative TTL (-${r.int(10, 80)}s)`],
    ],
    indirect: [
      (c, r) => ['WARN', `${r.int(20, 200)} requests rejected in 30s with 401 (token not yet valid)`],
      (c, r) => ['WARN', `nbf check failed for token ${hex(r, 10)}`],
      (c, r) => ['ERROR', `scheduled job '${r.pick(['rotate-keys', 'expire-holds', 'flush-batch'])}' fired ${c.skew}s early`],
    ],
    rootReq: [
      (c, r) => ['WARN', `${c.route} 401 ${r.int(1, 9)}ms (token validation failed)`],
      (c, r) => ['WARN', `${c.route} 401 ${r.int(1, 9)}ms`],
    ],
    rootReqP: 0.5,
    firstHop: [
      (c, r) => ['ERROR', `upstream ${c.callee} replied 401 Unauthorized`],
      (c, r) => ['ERROR', `auth failure from ${c.callee}: token rejected although freshly issued`],
    ],
    firstHopP: 0.6,
    blip: [
      (c, r) => ['WARN', `ntp: offset ${r.int(120, 480)}ms, correcting by slewing`],
    ],
    recover: (c, r) => ['INFO', `clock synchronised (offset ${r.int(1, 9)}ms)`],
    phrases: ['clock drift', 'time skew', 'an NTP failure'],
  },

  upstream_rate_limiting: {
    onset: [
      (c, r) => ['WARN', `${c.ext} responded 429 Too Many Requests (retry-after ${r.int(10, 60)}s)`],
      (c, r) => ['WARN', `throttled by ${c.ext}: quota of ${c.quota} requests/min exhausted`],
      (c, r) => ['WARN', `${c.ext} API says slow down (rate limit exceeded for key ****${hex(r, 4)})`],
    ],
    direct: [
      (c, r) => ['WARN', `backing off ${r.int(500, 8000)}ms before retrying ${c.ext}`],
      (c, r) => ['ERROR', `dropping request ${rid(r)}: ${c.ext} budget exhausted for the current window`],
      (c, r) => ['ERROR', `${c.ext} call failed with status 429 after ${r.int(2, 5)} retries`],
      (c, r) => ['WARN', `outbound queue to ${c.ext} at ${r.int(200, 3000)} (limit ${r.pick([256, 512, 1024])})`],
    ],
    indirect: [
      (c, r) => ['WARN', `partner quota window exhausted (${c.quota}/${c.quota}); next window in ${r.int(5, 59)}s`],
      (c, r) => ['ERROR', `${c.ext} answered status 429`],
      (c, r) => ['WARN', `${c.ext} retry budget spent; failing fast`],
    ],
    rootReq: [
      (c, r) => ['ERROR', `${c.route} 503 ${r.int(5, 900)}ms (provider unavailable)`],
      (c, r) => ['ERROR', `${c.route} 503 ${r.int(5, 900)}ms`],
    ],
    rootReqP: 0.45,
    blip: [
      (c, r) => ['WARN', `${c.ext || 'partner API'} returned 429 for ${r.int(2, 9)} requests`],
    ],
    recover: (c, r) => ['INFO', `${c.ext || 'partner API'} calls succeeding again`],
    phrases: ['rate limiting by a provider', 'third-party throttling', 'provider quota exhaustion'],
  },

  poisoned_cache: {
    onset: [
      (c, r) => ['WARN', `cached value for ${c.key} failed integrity check (checksum mismatch); served from cache anyway`],
      (c, r) => ['WARN', `decoded cached entry for ${c.key} is missing field '${c.field}'; serving as-is`],
      (c, r) => ['WARN', `cache entry ${c.key} has schema v${c.va} but readers expect v${c.vb}; returned to caller`],
    ],
    refill: (c, r) => ['INFO', `cache refill: loaded ${r.int(8000, 90000)} entries into namespace '${c.ns}' from snapshot ${c.snap}`],
    direct: [
      (c, r) => ['WARN', `cache HIT ${c.key} (age ${r.int(5, 900)}s, ${r.int(0, 40)} bytes): value failed validation`],
      (c, r) => ['WARN', `serving entry for ${c.key} from cache although field '${c.field}' is null`],
      (c, r) => ['WARN', `${r.int(40, 900)} cache entries in '${c.ns}' failed checksum in the last minute`],
    ],
    indirect: [
      (c, r) => ['INFO', `cache hit ratio 99.${r.int(80, 99)}%, origin fetches 0 in the last 60s`],
      (c, r) => ['WARN', `response for ${c.route} built from cached '${c.ns}' entry with empty '${c.field}'`],
      (c, r) => ['INFO', `cache HIT ${c.key} age ${r.int(5, 900)}s size ${r.int(0, 40)}B`],
    ],
    rootReq: [
      (c, r) => ['INFO', `${c.route} 200 ${r.int(1, 6)}ms cache=hit`],
    ],
    rootReqP: 0.3,
    firstHop: [
      (c, r) => ['ERROR', `response from ${c.callee} failed validation: field '${c.field}' missing`],
      (c, r) => ['ERROR', `unexpected null '${c.field}' in payload from ${c.callee} (key ${c.key})`],
      (c, r) => ['ERROR', `could not parse body from ${c.callee}: unexpected end of JSON input`],
    ],
    firstHopP: 0.75,
    blip: [
      (c, r) => ['WARN', `evicted ${r.int(3, 60)} corrupt entries after checksum failure`],
    ],
    recover: (c, r) => ['INFO', `refilled ${r.int(3, 60)} entries from origin; checksums ok`],
    phrases: ['cache poisoning', 'corrupt cache entries', 'a bad cache fill'],
  },
};

// Generic dependent failure lines; c.callee is how this caller refers to the failing callee.
export const DEP_FAIL = [
  (c, r) => ['ERROR', `call to ${c.callee} timed out after ${r.pick([1000, 2000, 2500, 3000, 5000])}ms`],
  (c, r) => ['ERROR', `upstream ${c.callee} returned 503 Service Unavailable`],
  (c, r) => ['ERROR', `${c.route} -> 502 (dependency ${c.callee} failed)`],
  (c, r) => ['WARN', `circuit breaker for ${c.callee} OPEN (error ratio 0.${r.int(35, 95)})`],
  (c, r) => ['ERROR', `retries exhausted (3/3) calling ${c.callee}: deadline exceeded`],
  (c, r) => ['ERROR', `request ${rid(r)} failed: ${c.callee} unavailable`],
  (c, r) => ['ERROR', `error calling ${c.callee}: context deadline exceeded`],
  (c, r) => ['ERROR', `${c.route} 500 ${r.int(1000, 5100)}ms: downstream error from ${c.callee}`],
];
export const EDGE_FAIL = (c, r) => ['ERROR', `${c.route} ${r.pick([502, 503, 504, 504])} ${r.int(900, 5100)}ms upstream=${c.callee}`];

export const SOFT_FALLBACK = [
  (c, r) => ['WARN', `${c.callee} did not answer within ${r.pick([150, 250, 400])}ms; using ${c.fallback}`],
  (c, r) => ['INFO', `degraded mode: ${c.fallback} used instead of the ${c.callee} response`],
  (c, r) => ['INFO', `fallback engaged for ${c.callee}; request still served`],
  (c, r) => ['WARN', `${c.callee} slow (${r.int(300, 3000)}ms); skipped optional ${c.what}`],
];

export const NOISY = {
  sftp: [
    (c, r) => ['ERROR', `export batch ${r.int(1000, 9999)} to partner SFTP failed: authentication rejected; retry in 60s`],
    (c, r) => ['ERROR', `upload of ${r.pick(['daily-sales', 'returns', 'stock-delta'])}-${r.int(100, 999)}.csv aborted: permission denied on remote path`],
    (c, r) => ['INFO', `starting export batch ${r.int(1000, 9999)}`],
    (c, r) => ['WARN', `job export-${r.pick(['sales', 'returns'])} exceeded its runtime budget (${r.int(120, 900)}s)`],
  ],
  'partner-timeout': [
    (c, r) => ['ERROR', `partner endpoint ${c.partnerHost} timed out after ${r.pick([10000, 15000, 30000])}ms (batch ${r.int(100, 999)})`],
    (c, r) => ['ERROR', `reconcile run ${r.int(100, 999)}: ${r.int(3, 400)} records skipped (malformed row ${r.int(2, 9000)} in upstream file)`],
    (c, r) => ['INFO', `sync cycle ${r.int(1000, 9999)} started`],
    (c, r) => ['WARN', `partner returned HTTP ${r.pick([500, 502, 520])}; will retry next cycle`],
  ],
  metrics: [
    (c, r) => ['ERROR', 'failed to push metrics batch to collector: HTTP 500'],
    (c, r) => ['ERROR', `audit segment ${r.int(100, 999)} rejected by archive: checksum header missing`],
    (c, r) => ['INFO', `shipping audit segment ${r.int(100, 999)}`],
    (c, r) => ['WARN', `archive backlog ${r.int(10, 400)} segments`],
  ],
};

export const BENIGN = [
  (c, r) => ['WARN', `GC pause ${r.int(180, 450)}ms (young generation)`],
  (c, r) => ['WARN', `slow query ${r.int(700, 2400)}ms on table ${r.pick(['line_items', 'carts', 'sku_prices', 'addresses', 'events'])}`],
  (c, r) => ['WARN', `retrying publish to topic '${r.pick(['order-events', 'stock-events', 'audit'])}' (attempt 2/5)`],
  (c, r) => ['WARN', `deprecated endpoint ${c.route} called by client ${r.pick(['ios-4.2', 'android-3.9', 'partner-feed'])}`],
  (c, r) => ['WARN', `certificate for ${c.host} expires in ${r.int(9, 60)} days`],
  (c, r) => ['WARN', `disk usage ${r.int(81, 88)}% on /var/log (warning threshold 80%)`],
  (c, r) => ['WARN', `request ${rid(r)} took ${r.int(1100, 2600)}ms (budget 1000ms)`],
  (c, r) => ['INFO', `ntp offset ${r.int(1, 40)}ms (ok)`],
  (c, r) => ['WARN', `cache miss ratio 0.${r.int(18, 35)} above baseline`],
];
export const BENIGN_HARD = [
  (c, r) => ['WARN', `config: unknown key '${r.pick(['legacy_mode', 'trace.sample', 'ui.theme'])}' ignored`],
  (c, r) => ['WARN', `client ${r.pick(['partner-feed', 'bulk-importer', 'ios-4.2'])} approaching its rate limit (${r.int(80, 95)}/100 per min)`],
  (c, r) => ['WARN', `connection to ${c.host} reset; reconnected after ${r.int(20, 300)}ms`],
  (c, r) => ['WARN', `heap after gc ${r.int(60, 72)}% (pause ${r.int(30, 140)}ms)`],
  (c, r) => ['WARN', `pool stats total=40 active=${r.int(30, 36)} idle=${r.int(4, 10)} pending=0`],
];
