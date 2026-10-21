// One chat.completions request against a remote OpenAI-compatible endpoint (policy kind openai-chat-https), with bounded
// retries, a process-wide rate-limit cooldown and redaction. Shared by the executor session (src/executors/openai-chat.mjs)
// and the ModelPort provider (src/models/providers/openai-chat.mjs), so both map failures and wait out rate limits the same
// way. The key is read from the host environment (the variable the policy names) at each attempt and goes only into that
// attempt's Authorization header; nothing here logs, stores or returns it.
import http from 'node:http';
import https from 'node:https';
import { FoundryError } from '../data.mjs';

// Per-minute rate limits are the binding constraint on a free tier (measured 2026-10-21: HTTP 429 "too many requests per
// minute" / "input token limit exceeded" with two sessions beside another run on the same key), so a call waits them out
// for about four minutes (5, 10, 20, 40, 60, 60, 60 s) before it reports MODEL_RATE_LIMIT.
export const DEFAULT_RETRY = Object.freeze({ attempts: 8, baseDelayMs: 5_000, maxDelayMs: 60_000 });
// A rate-limited endpoint cools down for every caller in this process (sessions and ModelPort calls alike), not only the
// one that saw the 429: they wait out the same window instead of spending their retries on it. Keyed by endpoint origin.
export const COOLDOWN = new Map();
export const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;
const PROXY_VARS = ['HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy'];
export const LIMITED = /rate.?limit|overloaded|usage limit|quota|limit reached|insufficient.?(?:credit|balance|funds)/i;
export const LOOPBACK_URL = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?(\/[^\s?#]*)?$/;
export const HTTPS_URL = /^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/;

/** Replace every occurrence of the credential (and any bearer token) in text that may reach a log or a result. */
export const redact = (text, secret) => {
  let s = String(text ?? '');
  if (typeof secret === 'string' && secret.length >= 4) s = s.split(secret).join('[redacted]');
  return s.replace(/(bearer\s+)[^\s"',;]+/gi, '$1[redacted]').replace(/("?authorization"?\s*[:=]\s*"?)[^"\n]+/gi, '$1[redacted]');
};

/** Classify one failed attempt: { code, retry }. Codes are the executor's; the ModelPort provider maps EXECUTOR_* to MODEL_PROTOCOL. */
export function classifyHttp({ status = null, text = '', transportError = null }) {
  if (transportError) return { code: 'MODEL_UNAVAILABLE', retry: true };
  if (status === 429 || status === 529) return { code: 'MODEL_RATE_LIMIT', retry: true };
  if (status >= 500 || status === 408) return { code: 'MODEL_UNAVAILABLE', retry: true };
  if (LIMITED.test(text)) return { code: 'MODEL_RATE_LIMIT', retry: false };
  if (status === 401 || status === 403) return { code: 'MODEL_UNAVAILABLE', retry: false };
  return { code: 'EXECUTOR_ERROR', retry: false };
}

/** The endpoint's chat.completions URL: the policy's https baseUrl, or a plain-http loopback override (tests only). */
export function chatEndpoint(provider, override = null) {
  if (override !== null && !LOOPBACK_URL.test(override)) throw new FoundryError('EXECUTOR_OPTION', 'a baseUrl override must be plain http on loopback (tests only); remote endpoints come from the policy');
  const url = `${String(override ?? provider?.baseUrl ?? '').replace(/\/+$/, '')}/chat/completions`;
  if (!(override ? LOOPBACK_URL : HTTPS_URL).test(url)) throw new FoundryError('EXECUTOR_OPTION', `endpoint ${url} is not https`);
  return url;
}

/** POST JSON; resolves { status, headers, text } or rejects with the transport error. https goes through the host's
 * HTTPS_PROXY when one is set (the cloud's egress), plain http only to loopback (tests). */
export function postJson(url, body, { headers, timeoutMs, signal, hostEnv = process.env }) {
  const u = new URL(url);
  const secure = u.protocol === 'https:';
  const proxyEnv = Object.fromEntries(PROXY_VARS.filter(k => typeof hostEnv[k] === 'string').map(k => [k, hostEnv[k]]));
  const agent = secure ? new https.Agent({ keepAlive: false, ...(Object.keys(proxyEnv).length ? { proxyEnv } : {}) }) : new http.Agent({ keepAlive: false });
  const data = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = (secure ? https : http).request(u, { method: 'POST', agent, signal, headers: { 'content-type': 'application/json', accept: 'application/json', 'content-length': data.length, ...headers } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error(`no response within ${Math.round(timeoutMs / 1000)} s`), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end(data);
  });
}

const sleep = (ms, signal) => new Promise(resolve => { const t = setTimeout(resolve, ms); signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true }); });
const abortReason = signal => signal?.reason ?? new FoundryError('CANCELLED', 'chat request aborted');

/**
 * chatCompletion({ endpoint, body, hostEnv, credentialEnv, retry, requestTimeoutMs, signal, deadline, onRequest, onResponse,
 * onEvent }) -> { data, attempts, retries }. Throws FoundryError { code: MODEL_RATE_LIMIT | MODEL_UNAVAILABLE |
 * EXECUTOR_ERROR (a 4xx the endpoint refused) | EXECUTOR_PROTOCOL (a 2xx body that is not JSON), retries, status } after the
 * retries, or the signal's reason when it aborts. deadline (ms epoch) bounds every wait. onEvent receives
 * { type: 'system', subtype: 'api_error' | 'rate_limit_wait', ... } records (never the key).
 */
export async function chatCompletion({ endpoint, body, hostEnv = process.env, credentialEnv, retry = DEFAULT_RETRY, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  signal = null, deadline = Infinity, onRequest = () => {}, onResponse = () => {}, onEvent = () => {} }) {
  const origin = new URL(endpoint).origin;
  let retries = 0;
  const stop = (code, message, extra = {}) => Object.assign(new FoundryError(code, message), { retries, ...extra });
  for (let attempt = 1; ; attempt++) {
    if (signal?.aborted) throw abortReason(signal);
    const cool = (COOLDOWN.get(origin) ?? 0) - Date.now();
    if (cool > 0) {
      if (cool >= deadline - Date.now()) throw stop('MODEL_RATE_LIMIT', `the endpoint is cooling down for ${Math.round(cool / 1000)} s after a rate limit, past this call's time`);
      onEvent({ type: 'system', subtype: 'rate_limit_wait', waitMs: cool });
      await sleep(cool, signal);
      if (signal?.aborted) throw abortReason(signal);
    }
    const key = hostEnv[credentialEnv];   // read at call time, never cached
    if (typeof key !== 'string' || !key) throw stop('MODEL_UNAVAILABLE', `no credential: the environment variable ${credentialEnv} is not set`);
    let res = null, transportError = null;
    onRequest();
    try { res = await postJson(endpoint, body, { headers: { authorization: `Bearer ${key}` }, timeoutMs: Math.max(1000, Math.min(requestTimeoutMs, deadline - Date.now())), signal, hostEnv }); }
    catch (e) { if (signal?.aborted) throw abortReason(signal); transportError = e; }   // cut off in flight: no onResponse (its spend is unknown)
    onResponse(Boolean(res));
    if (res && res.status >= 200 && res.status < 300) {
      try { return { data: JSON.parse(res.text), attempts: attempt, retries }; } catch { throw stop('EXECUTOR_PROTOCOL', `the endpoint answered ${res.status} with a body that is not JSON: ${redact(res.text.slice(0, 300), key)}`, { status: res.status }); }
    }
    const { code, retry: again } = classifyHttp({ status: res?.status ?? null, text: res?.text ?? '', transportError });
    const detail = res ? `HTTP ${res.status}: ${redact(res.text.slice(0, 500), key)}` : `${transportError?.code ?? 'transport error'}: ${redact(transportError?.message ?? transportError, key).slice(0, 300)}`;
    const retryAfter = Number(res?.headers?.['retry-after']);
    const delay = Math.round(Math.min(retry.maxDelayMs, Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : retry.baseDelayMs * 2 ** (attempt - 1)) * (1 + Math.random() * 0.1));
    if (code === 'MODEL_RATE_LIMIT' && again) COOLDOWN.set(origin, Math.max(COOLDOWN.get(origin) ?? 0, Date.now() + delay));
    const room = deadline - Date.now();
    onEvent({ type: 'system', subtype: 'api_error', attempt, status: res?.status ?? null, code, retry: again && attempt < retry.attempts && delay < room, delayMs: delay, detail });
    if (!again || attempt >= retry.attempts || delay >= room) throw stop(code, `${detail} (attempt ${attempt} of ${retry.attempts})`, { status: res?.status ?? null });
    retries += 1;
    await sleep(delay, signal);
  }
}
