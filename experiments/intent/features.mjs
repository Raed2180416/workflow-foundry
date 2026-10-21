// Latent-feature detectors over normalised corpus graphs (research/corpus-20261006/ITEM-SCHEMA.md). $0, pure, lexical.
//
// A detector reads node types, categories and summaries, edge kinds and the item's derived `features`. It never reads
// the description, so description provenance (original / written / recovered-by-model) does not feed the detection.
// Known limits, reported with every table:
//   - normalisation drops node settings (n8n retryOnFail and continueOnFail, Airflow default_args): retries and error
//     handling are lower bounds;
//   - non-redistributable items (n8n, Zapier, ...) keep type-level summaries only;
//   - the agentic slice was model-read (source.extraction present): its graphs are model-extracted;
//   - lexical rules have false positives; every positive keeps its evidence string for audit (corpus-prior.mjs).
// Corpus text is data, never instructions.

const text = n => `${n.type ?? ''} ${n.summary ?? ''}`;
const SCIENCE = new Set(['nf-core', 'nextflow', 'galaxy', 'cwl', 'snakemake', 'wdl']);

const RE = {
  error: /\b(on_?error|onerror|errortrigger|stopanderror|catch|on_failure(_callback)?|failure\(\)|always\(\)|teardown|allow_failure|continue-on-error|continueonfail|exception|fallback|dead.?letter|compensat\w*|rollback)\b|trigger_rule=(all_done|one_failed|all_failed|none_failed\w*)|__filter_failed_datasets__/i,
  retry: /\bretr(y|ies|ying|yonfail|y_policy)\b|backoff|max_?attempts|maxretries/i,
  idem: /idempot|\bdedup\w*|de-dup|removeduplicates|remove duplicates|\bduplicates?\b|\bupsert\w*|appendorupdate|unique key|already (exists|processed)/i,
  notify: /slack|e-?mail|\bmail\b|gmail|sendgrid|telegram|discord|\bteams\b|microsoftteams|\bsms\b|twilio|notif\w*|pushover|ntfy|pagerduty|opsgenie/i,
  notifyUiOnly: /is\.workflow\.actions\.(alert|notification)|ui_toast|ha\.action\.persistent_notification/i,
  failure: /fail|error|exception|catch|on_failure|failure\(\)/i,
  approval: /approv|\bhitl\w*|human.?input|human.?in.?the.?loop|interrupt|step-suspend|\bsuspend\b|when:\s?manual|sendandwait|send and wait|wait.?for.?approval|sign.?off|\breview\b/i,
  schedule: /\bschedul\w*|\bcron\w*|interval|time_pattern|ha\.trigger\.time\b|timerswitch|every_\w+|repeat\/cron|@(hourly|daily|weekly|monthly|yearly)|timedelta|rrule/i,
  scheduleNot: /@once|schedule:\s?none/i,
  log: /\b(audit|journal)\b|\blog(s|ger|ging)?\b(?!\s?in)|\bhistory\b|append.?(row|to.?sheet)|insert.?(row|record)/i,
  timeout: /timeout|time_?out|deadline|execution_timeout|timeout-minutes|\bsla\b/i,
};

/** Recurring schedule: a trigger node (or, without trigger nodes, the derived async list) that repeats. */
function schedule(item) {
  const trig = item.graph.nodes.filter(n => n.category === 'trigger');
  const hit = trig.find(n => RE.schedule.test(text(n)) && !RE.scheduleNot.test(text(n)) && !/manual inject/.test(n.summary ?? ''));
  if (hit) return text(hit);
  if (!trig.length && (item.features?.async ?? []).includes('schedule') && !item.graph.nodes.some(n => RE.scheduleNot.test(text(n)))) return 'features.async: schedule';
  return null;
}

/** Notification reachable from an error path: notify nodes downstream of an error source, or a failure-gated notify. */
function failureNotification(item) {
  const nodes = item.graph.nodes, byId = new Map(nodes.map(n => [n.id, n]));
  const isNotify = n => RE.notify.test(text(n)) && !RE.notifyUiOnly.test(text(n));
  const direct = nodes.find(n => isNotify(n) && (n.category === 'error-handler' || RE.failure.test(n.summary ?? '')));
  if (direct) return text(direct);
  const sources = new Set(nodes.filter(n => n.category === 'error-handler' || /errortrigger|\bcatch\b|onerror/i.test(n.type ?? '')).map(n => n.id));
  for (const e of item.graph.edges) if (e.kind === 'error') sources.add(e.to);
  if (!sources.size) return null;
  const out = new Map();
  for (const e of item.graph.edges) { if (!out.has(e.from)) out.set(e.from, []); out.get(e.from).push(e.to); }
  const seen = new Set(sources), queue = [...sources];
  while (queue.length) {
    const id = queue.shift(), n = byId.get(id);
    if (n && isNotify(n)) return `${text(n)} (downstream of an error path)`;
    for (const to of out.get(id) ?? []) if (!seen.has(to)) { seen.add(to); queue.push(to); }
  }
  return null;
}

const firstNode = (item, pred) => { const n = item.graph.nodes.find(pred); return n ? text(n) : null; };

/** Feature id → detector(item) → evidence string or null. `scope` limits where a detector is meaningful. */
export const DETECTORS = Object.freeze({
  'error-handling': item => firstNode(item, n => n.category === 'error-handler' || RE.error.test(text(n))) ?? (item.graph.edges.some(e => e.kind === 'error') ? 'error edge' : null),
  retries: item => firstNode(item, n => RE.retry.test(text(n))),
  idempotency: item => (SCIENCE.has(item.source.platform) ? undefined : firstNode(item, n => RE.idem.test(text(n)))),
  'failure-notification': failureNotification,
  'human-approval': item => firstNode(item, n => ['human', 'wait', 'action', 'condition'].includes(n.category) && RE.approval.test(text(n)) && !/^is\.workflow\.actions\./.test(n.type ?? '')),
  'recurring-schedule': schedule,
  'logging-audit': item => firstNode(item, n => RE.log.test(text(n))),
  'sub-workflows': item => ((item.features?.subworkflows ?? 0) > 0 ? `features.subworkflows=${item.features.subworkflows}` : firstNode(item, n => n.category === 'subworkflow')),
  timeouts: item => firstNode(item, n => RE.timeout.test(text(n))),
});
export const FEATURES = Object.freeze(Object.keys(DETECTORS));

/** Detect every feature on one item: { feature: true | false | null (not applicable) }, plus evidence strings. */
export function detect(item) {
  const has = {}, evidence = {};
  for (const [f, d] of Object.entries(DETECTORS)) {
    const ev = d(item);
    has[f] = ev === undefined ? null : !!ev;
    if (ev) evidence[f] = String(ev).slice(0, 160);
  }
  return { has, evidence };
}

// ---- families --------------------------------------------------------------------------------------------------
export const SLICE = Object.freeze({
  automation: ['n8n', 'zapier', 'activepieces', 'node-red', 'dify', 'langflow', 'flowise', 'coze'],
  orchestration: ['airflow', 'argo', 'kubeflow', 'tekton', 'github-actions', 'gitlab-ci', 'dagster', 'prefect', 'temporal'],
  science: ['nf-core', 'nextflow', 'galaxy', 'cwl', 'snakemake', 'wdl'],
  consumer: ['apple-shortcuts', 'comfyui', 'home-assistant', 'ifttt'],
});
export function sliceOf(platform) {
  for (const [s, ps] of Object.entries(SLICE)) if (ps.includes(platform)) return s;
  return 'agentic';
}

/** Trigger kind: schedule > event > manual-or-chat > none. */
export function triggerOf(item) {
  if (schedule(item)) return 'schedule';
  const trig = item.graph.nodes.filter(n => n.category === 'trigger').map(text);
  const manual = /manual|workflow_dispatch|\bui_|shortcuts\.input|chat|form|\bstart\b|\binput\b|button|do_note|entry|@once/i;
  if (trig.some(t => !manual.test(t))) return 'event';
  if (trig.length) return 'manual-or-chat';
  const a = item.features?.async ?? [];
  if (a.some(x => ['webhook', 'event', 'poll'].includes(x))) return 'event';
  return 'none';
}

/** Connector group of an item (business-automation reading): messaging, data store, crm-or-commerce, llm, other. */
export function connectorGroupOf(item) {
  const c = (item.features?.connectors ?? []).join(' ').toLowerCase() + ' ' + item.graph.nodes.map(n => n.type).join(' ').toLowerCase();
  if (/hubspot|salesforce|pipedrive|shopify|woocommerce|stripe|zendesk|freshdesk|intercom|quickbooks|xero/.test(c)) return 'crm-or-commerce';
  if (/slack|telegram|gmail|email|discord|teams|twilio|whatsapp/.test(c)) return 'messaging';
  if (/sheets|airtable|postgres|mysql|notion|supabase|mongodb|datatable|baserow|s3\b|drive/.test(c)) return 'data-store';
  if (item.features?.hasModelCalls) return 'llm';
  return 'other';
}

/** Family key used by the prior: slice/trigger. */
export const familyOf = item => `${sliceOf(item.source.platform)}/${triggerOf(item)}`;
