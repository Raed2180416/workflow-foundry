// Names, hosts and error texts for the exec-injected family of F1. Data only. Error texts are the ones Node, SQLite,
// HTTP clients and the Foundry runtime itself produce (src/runtime.mjs, src/capabilities.mjs, src/sandbox.mjs);
// the fixtures raise them in the same shape a deployed capability would. Nothing here reads a bed or a held-out file.

// ---- node ids by role (snake_case, as workflow authors write them) ---------------------------------------------------
export const IDS = Object.freeze({
  fetch: ['fetch_quotes', 'load_orders', 'pull_tickets', 'read_inventory', 'get_prices', 'fetch_invoices', 'download_report', 'query_accounts',
    'sync_catalog', 'poll_status', 'fetch_rates', 'load_customers', 'pull_metrics', 'read_ledger', 'get_shipments', 'collect_events', 'scan_listings'],
  ident: ['normalise_rows', 'prepare_batch', 'clean_records', 'stage_payload', 'map_fields', 'reshape_input', 'prime_batch', 'tidy_rows', 'align_columns'],
  agg: ['sum_amounts', 'total_up', 'aggregate_totals', 'tally_rows', 'roll_up', 'add_up_values'],
  pluck: ['extract_amounts', 'collect_ids', 'pick_fields', 'project_values', 'list_amounts', 'gather_keys'],
  tmpl: ['render_summary', 'build_message', 'format_report', 'compose_note', 'draft_digest', 'fill_template'],
  agent: ['classify_ticket', 'label_sentiment', 'tag_priority', 'route_request', 'pick_category', 'assess_risk', 'triage_item', 'sort_message'],
  gate: ['check_totals', 'assert_nonempty', 'guard_range', 'validate_batch', 'require_rows', 'confirm_shape', 'sanity_check'],
  json: ['serialise_result', 'package_output', 'encode_payload', 'wrap_result'],
  sut: ['call_service', 'run_checkout', 'exercise_parser', 'probe_endpoint', 'drive_cart', 'invoke_formatter', 'exercise_scheduler', 'run_pricing'],
  write: ['write_report', 'save_output', 'publish_summary', 'persist_results', 'export_csv', 'store_digest'],
  module: ['load_fitter', 'import_ratetab', 'open_model_lib', 'require_codec', 'load_scorer', 'import_geotable'],
  api: ['call_billing_api', 'post_update', 'sync_crm', 'query_vendor_api', 'push_status', 'register_event'],
  code: ['compute_stats', 'merge_records', 'build_index', 'score_rows', 'transform_batch', 'derive_metrics', 'reconcile_totals', 'group_by_owner'],
  sink: ['finalise_run', 'mark_complete', 'emit_result', 'archive_output', 'notify_done'],
  map: ['each_row', 'per_item', 'for_each_record', 'process_each', 'walk_rows'],
});

// ---- services, modules, credentials, directories -------------------------------------------------------------------
export const SERVICES = Object.freeze([
  { name: 'quotes_api', host: 'api.quotes.internal', port: 443 }, { name: 'ledger_db', host: '10.0.3.17', port: 5432 },
  { name: 'model_gateway', host: '127.0.0.1', port: 8402 }, { name: 'vendor_api', host: 'vendor-gw.internal', port: 8443 },
  { name: 'catalog_svc', host: 'catalog-svc', port: 9000 }, { name: 'billing_api', host: 'billing.int.example', port: 443 },
  { name: 'ticket_store', host: '10.1.8.22', port: 6379 }, { name: 'metrics_hub', host: 'metrics.corp.local', port: 9090 },
]);
export const MODULES = Object.freeze(['fitlib', 'ratetab', 'geotable', 'codec_v2', 'scorer', 'pricing_rules', 'holiday_cal', 'unit_conv']);
export const CREDENTIALS = Object.freeze(['API_TOKEN', 'VENDOR_KEY', 'LEDGER_PASSWORD', 'REGISTRY_TOKEN', 'WEBHOOK_SECRET', 'CRM_API_KEY']);
export const DIRS = Object.freeze(['out', 'reports', 'cache', 'staging', 'exports']);
// facets that exist in every fingerprint but that a given node does not use (unrelated changes must not label env)
export const BYSTANDER_FACETS = Object.freeze([
  ['module', 'legacy_csv'], ['module', 'old_formatter'], ['credential', 'LEGACY_KEY'], ['credential', 'STAGING_TOKEN'],
  ['service', 'audit_sink'], ['service', 'mail_relay'], ['tool', 'jq'], ['tool', 'rsync'], ['dir', 'tmp_scratch'], ['dir', 'old_exports'],
]);

// ---- transient network and store faults (flake) and the persistent outages that look like them (env) ----------------
// code is the error.code the runtime journals; message the text the client library raised
export const TRANSIENT = Object.freeze([
  { code: 'ECONNRESET', msg: () => 'read ECONNRESET' },
  { code: 'ECONNRESET', msg: s => `connect ECONNRESET ${s.host}:${s.port}` },
  { code: 'ECONNRESET', msg: () => 'socket hang up' },
  { code: 'ETIMEDOUT', msg: s => `connect ETIMEDOUT ${s.host}:${s.port}` },
  { code: 'ETIMEDOUT', msg: s => `request to https://${s.host}/v1/query timed out after 3000 ms` },
  { code: 'EPIPE', msg: () => 'write EPIPE' },
  { code: 'EAI_AGAIN', msg: s => `getaddrinfo EAI_AGAIN ${s.host}` },
  { code: 'UND_ERR_SOCKET', msg: () => 'fetch failed: other side closed' },
  { code: 'HTTP_503', msg: s => `HTTP 503 Service Unavailable from ${s.host} (upstream connect error or disconnect/reset before headers)` },
  { code: 'HTTP_502', msg: s => `HTTP 502 Bad Gateway from ${s.host}` },
  { code: 'ECONNRESET', msg: () => 'Client network socket disconnected before secure TLS connection was established' },
  { code: 'ERR_SOCKET_CONNECTION_TIMEOUT', msg: s => `Failed to connect to ${s.host}:${s.port} within 3000 ms` },
]);
export const STORE_TRANSIENT = Object.freeze([
  { code: 'SQLITE_BUSY', msg: () => 'database is locked' },
  { code: 'SQLITE_BUSY', msg: () => 'SQLITE_BUSY: database is locked' },
  { code: 'EBUSY', msg: s => `EBUSY: resource busy or locked, open '/srv/app/state/${s.name}.lock'` },
  { code: 'EAGAIN', msg: () => 'EAGAIN: resource temporarily unavailable, read' },
]);
export const PERSISTENT_DOWN = Object.freeze([
  { code: 'ECONNREFUSED', msg: s => `connect ECONNREFUSED ${s.host}:${s.port}` },
  { code: 'ECONNREFUSED', msg: s => `connect ECONNREFUSED ${s.host}:${s.port}` },
  { code: 'ENOTFOUND', msg: s => `getaddrinfo ENOTFOUND ${s.host}` },
  { code: 'EHOSTUNREACH', msg: s => `connect EHOSTUNREACH ${s.host}:${s.port}` },
  { code: 'ENETUNREACH', msg: s => `connect ENETUNREACH ${s.host}:${s.port}` },
  { code: 'ETIMEDOUT', msg: s => `connect ETIMEDOUT ${s.host}:${s.port}` },
  { code: 'ECONNRESET', msg: s => `read ECONNRESET (${s.host}:${s.port} closes every connection)` },
  { code: 'HTTP_503', msg: s => `HTTP 503 Service Unavailable from ${s.host}` },
]);
export const MODEL_TRANSIENT = Object.freeze([
  { code: 'MODEL_RATE_LIMIT', msg: () => 'claude CLI exited 1: API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}' },
  { code: 'MODEL_RATE_LIMIT', msg: () => 'claude CLI exited 1: API Error: 529 {"type":"error","error":{"type":"overloaded_error"}}' },
  { code: 'MODEL_TIMEOUT', msg: () => 'claude CLI Subprocess cancelled after the call timeout' },
  { code: 'MODEL_TIMEOUT', msg: () => 'request aborted after 120000 ms (slot busy)' },
  { code: 'MODEL_UNAVAILABLE', msg: () => 'claude CLI exited 1: API Error: Connection error. (temporary DNS failure resolving the API host, EAI_AGAIN)' },
  { code: 'MODEL_UNAVAILABLE', msg: () => 'fetch failed: read ECONNRESET (socket hang up) while posting to the model gateway' },
]);
export const MODEL_DOWN = Object.freeze([
  { code: 'MODEL_UNAVAILABLE', msg: () => 'llama-server was not healthy within 120000 ms (model file missing: /opt/models/*.gguf)' },
  { code: 'MODEL_UNAVAILABLE', msg: () => 'claude CLI exited 1: Invalid API key. Please run /login' },
  { code: 'MODEL_UNAVAILABLE', msg: s => `connect ECONNREFUSED ${s.host}:${s.port}` },
  { code: 'MODEL_UNAVAILABLE', msg: () => 'Killed (exit 137): the process hit its memory limit while loading the model' },
  { code: 'MODEL_TIMEOUT', msg: () => 'request aborted after 120000 ms (server not responding)' },
]);

// ---- agent labels -------------------------------------------------------------------------------------------------------
export const LABEL_SETS = Object.freeze([
  ['refund', 'shipping', 'billing', 'other'], ['positive', 'neutral', 'negative'], ['low', 'medium', 'high'], ['bug', 'feature', 'question'],
  ['urgent', 'normal', 'deferred'], ['approve', 'review', 'reject'], ['hardware', 'software', 'network', 'access'],
]);
export const AGENT_INSTRUCTIONS = Object.freeze([
  'Decide which label fits the item best. Return only the label.', 'Read the rows and choose one label for the batch.',
  'Classify the batch with exactly one label from the allowed set.', 'Pick the single best label for this data.',
]);

// ---- code nodes (defect) ------------------------------------------------------------------------------------------------
// {k} is a field the rows do not have, {n} an index past the end, {big} a threshold above every amount
export const PY_DEFECTS = Object.freeze([
  { id: 'py-keyerror-sum', src: 'def main(inp):\n    rows = inp["rows"]\n    return {"total": sum(r["{k}"] for r in rows)}' },
  { id: 'py-keyerror-group', src: 'def main(inp):\n    by = {}\n    for r in inp["rows"]:\n        by.setdefault(r["{k}"], []).append(r["id"])\n    return {"groups": len(by)}' },
  { id: 'py-indexerror', src: 'def main(inp):\n    rows = inp["rows"]\n    first = rows[{n}]\n    return {"first": first["id"]}' },
  { id: 'py-zerodiv', src: 'def main(inp):\n    rows = inp["rows"]\n    spread = len(rows) - len(set(r["id"] for r in rows))\n    return {"avg_dup": inp["total"] / spread}' },
  { id: 'py-typeerror-concat', src: 'def main(inp):\n    label = inp["source"] + inp["total"]\n    return {"label": label}' },
  { id: 'py-valueerror-max', src: 'def main(inp):\n    big = [r["amount"] for r in inp["rows"] if r["amount"] > {big}]\n    return {"top": max(big)}' },
  { id: 'py-valueerror-int', src: 'def main(inp):\n    return {"n": int(inp["rows"][0]["id"])}' },
  { id: 'py-attributeerror', src: 'def main(inp):\n    names = [r["{k}"].strip() for r in inp["rows"]]\n    return {"names": names}' },
  { id: 'py-typeerror-none', src: 'def main(inp):\n    rows = inp["rows"]\n    return {"sum": sum(r.get("{k}") for r in rows)}' },
]);
export const JS_DEFECTS = Object.freeze([
  { id: 'js-undefined-account', src: 'export default (inp) => inp.rows.map(r => r.{k}.id);' },
  { id: 'js-parse', src: 'export default (inp) => JSON.parse(inp.source);' },
  { id: 'js-length', src: 'export default (inp) => ({ n: inp.{k}.length });' },
  { id: 'js-tofixed', src: 'export default (inp) => ({ text: inp.rows[0].id.toFixed(2) });' },
  { id: 'js-destructure', src: 'export default (inp) => { const [{ {k}: first }] = inp.rows; return { first: first.trim() }; };' },
]);
// field names a defective node reads that the rows lack
export const MISSING_FIELDS = Object.freeze(['price', 'qty', 'owner', 'group', 'region', 'account', 'currency', 'category', 'items', 'customer']);

// ---- row fixtures ---------------------------------------------------------------------------------------------------------
export const ROW_OWNERS = Object.freeze(['ines', 'tomasz', 'priya', 'bram', 'marisol', 'jun', 'odile', 'kwame']);
export const PAYLOAD_SOURCES = Object.freeze(['orders', 'tickets', 'invoices', 'shipments', 'events', 'listings', 'accounts', 'readings']);
