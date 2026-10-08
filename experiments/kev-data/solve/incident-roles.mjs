// What each catalog pool of the incident bed is used for: the tags (`truth.idsByTag` keys) its lines are emitted under.
// Read off the `emit(...)` calls of beds/incident/gen.mjs (VERSION 4.2.0), pool by pool; this is the solver's own
// knowledge of the generator, written once and independent of any line it is later asked about. test/incident.test.mjs
// checks it against the bed: every line of 300 train-range worlds that matches a pool must have a tag the pool declares
// (the pool table is complete), and the solver's label is compared with the tag table's (two code paths).
//
// A pool path is `NAME` or `NAME.<class>` or `NAME.<sub>` or `FAULTS.<class>.<sub>`; <class> is one of the nine fault
// classes. A rule is [regexp over the path, tags]; the first matching rule wins.
export const CLASSES = ['connection_pool_exhaustion', 'certificate_expiry', 'bad_config_deploy', 'disk_full', 'dns_resolution_failure', 'memory_leak_oom', 'clock_skew', 'upstream_rate_limiting', 'poisoned_cache'];
const BLIPS = ['blip-root', 'blip-same', 'blip-other', 'blip-rival'];

export const POOL_RULES = Object.freeze([
  // the root's own fault lines (origin) -------------------------------------------------------------------------
  // routine cache refills of the root use the onset wording of poisoned_cache (gen.mjs: "identical in form to earlier routine refills")
  [/^FAULTS\.poisoned_cache\.onset$/, ['onset', 'root', 'shadow', 'bg']],
  [/^(?:ONSET_MORE|ONSET_X|ONSET_ALT|ONSET_DIRECT)\.poisoned_cache$/, ['onset', 'root', 'bg']],
  [/^FAULTS\.[a-z_]+\.(?:onset|direct|indirect|oom)$/, ['onset', 'root', 'shadow']],
  [/^FAULTS\.[a-z_]+\.(?:growth|restart)$/, ['root', 'shadow']],
  [/^FAULTS\.[a-z_]+\.precursor$/, ['precursor']],
  [/^FAULTS\.[a-z_]+\.firstHop$/, ['dep']],
  [/^FAULTS\.[a-z_]+\.rootReq$/, ['root']],
  [/^FAULTS\.[a-z_]+\.(?:blip|recover)$/, BLIPS],
  [/^(?:ONSET_ALT|ONSET_DIRECT|ONSET_MORE|ONSET_X)\./, ['onset', 'root']],
  [/^TREND\.[a-z_]+\.onset$/, ['onset', 'root']],
  [/^TREND\.[a-z_]+\.step$/, ['root']],
  [/^(?:CANARY|CANARY_NOVER)$/, ['onset', 'root']],
  [/^(?:PROMOTE|POD_ECHO\.[a-z_]+)$/, ['root']],
  [/^BASELINE_AFTER\./, ['onset', 'root', ...BLIPS]],
  [/^(?:LATENT_EARLY|SIBLING_ONSET|SIBLING_MORE|SECONDARY|CALLEE_LINES|PARTIAL_RECOVERY|PARTIAL_MORE)\./, ['root']],
  // the cascade -----------------------------------------------------------------------------------------------------
  [/^(?:DEP_FAIL|ANON_FAIL|EDGE_FAIL)$/, ['dep', 'echo']],
  [/^(?:WRAP|PROVIDER_FAIL)$/, ['dep', 'echo']],
  [/^COLLATERAL$/, ['collateral']],
  [/^SOFT_FALLBACK$/, ['soft', 'echo']],
  [/^SOFT_ERR$/, ['soft']],
  [/^ECHO_RECOVER$/, ['echo']],
  [/^(?:CONSEQUENCE|CALLEE_REJECT\.[a-z_]+)$/, ['consequence']],
  // herrings --------------------------------------------------------------------------------------------------------
  [/^(?:LOOKALIKE|LOOKALIKE_MORE|LOOKALIKE_GEN)\./, ['lookalike']],
  [/^(?:BLIP_ONSET\.[a-z_]+|RECOVER_ALT\.[a-z_]+|RECOVER_MORE\.[a-z_]+)$/, BLIPS],
  [/^STRAY\.[a-z_]+$/, ['stray', 'rival', 'blip-rival']],
  [/^RIVAL_MORE\./, ['rival']],
  [/^STRAY_REC\./, ['stray']],
  [/^STRAY_STATS\./, ['stray', 'baseline']],
  [/^BASELINE\./, ['baseline', 'stray']],
  [/^ROOT_CHRONIC\./, ['baseline']],
  [/^CHRONIC\./, ['chronic', 'decoy', 'baseline']],
  [/^DECOY\./, ['decoy']],
  [/^(?:BENIGN|BENIGN_HARD)$/, ['benign']],
  [/^NOISY\./, ['noise']],
  [/^SPORADIC$/, ['sporadic']],
  [/^(?:MENTION|MENTION_ERR)$/, ['mention']],
  [/^CERT_RENEWED\./, ['renew']],
  [/^(?:DEPLOY\.start)$/, ['deploy']],
  [/^(?:DEPLOY\.ready|DEPLOY\.done|DEPLOY\.reload)$/, ['deploy', 'root', 'bg']],
  [/^DEPLOY_PREV\./, ['bg']],
  [/^INJECT$/, ['inject']],
  [/^(?:MISLEAD|NOTICE)$/, ['mislead']],
  [/^(?:BG_DATA\.[a-z]+|PERIODIC_SVC)$/, ['bg']],
  // lines written by gen.mjs itself ------------------------------------------------------------------------------------
  [/^GEN\.requestOk$/, ['bg', 'shadow']],
  [/^GEN\.call(?:Ok|Ext)$/, ['bg']],
  [/^GEN\.ntp$/, [...BLIPS, 'baseline']],
  [/^GEN\.tls(?:Close|Eof)$/, ['root']],
]);

export function tagsOfPool(pool) {
  for (const [re, tags] of POOL_RULES) if (re.test(pool)) return tags;
  return null;
}
