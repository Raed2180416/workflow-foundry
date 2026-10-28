// OAuth for remote MCP servers (custody C1 tokens), ARCHITECTURE.md §2.6. Implements the client side of the MCP authorization revision
// 2026-07-28 (the `latest` page, read 2026-10-21) for a pre-registered public client, on the pinned SDK 1.30.0's low-level functions
// (discovery, startAuthorization, exchangeAuthorization, refreshAuthorization). Foundry does NOT hand the transport an authProvider: with
// one, the SDK transport re-authorizes on 401 and "upscopes" on 403 insufficient_scope by itself (client/streamableHttp.js), which would
// widen authority without a person. Instead:
//   connect    an OWNER action decided on a person channel (a PersonDecision for the connect subject: entry, scope class, scopes,
//              issuer, resource; ./person.mjs), never a model, a channel name or an elicitation: discover (RFC 9728 protected
//              resource metadata, required; the AS must be the catalog-attested issuer; RFC 8414 metadata whose `issuer` matches; PKCE S256
//              advertised, refused if absent), authorize (PKCE S256, `state`, RFC 8707 `resource` = the server's canonical URI, the attested
//              scopes of one scope class), validate the response (state, then RFC 9207 `iss` per the spec's table, BEFORE the code goes to any
//              token endpoint), exchange (resource again), refuse a grant wider than requested, and store the tokens in the OS keychain.
//   bearer     at call time, host code reads the token record, checks it was issued for THIS server by THIS issuer (a token for anything
//              else is never sent), refreshes when it is about to expire (same scope, resource again, rotated refresh token stored), and
//              adds the values to the run scrub set.
//   step-up    an HTTP 403 insufficient_scope challenge on an OAuth entry is a typed SCOPE_INSUFFICIENT and a `scope.step-up` proposal
//              carrying only owner-listed scopes (the attested scopes and `stepUpScopes`), de-duplicated; only a person's approval of it
//              lets a later connect request the extra scope.
// The loopback redirect receiver answers only the request that carries this connect's `state` (any other local request is refused and
// ignored, so a local process cannot fail a connect by calling the port first), and refreshes of one token record run one at a time (two
// concurrent refreshes with rotation would present a spent refresh token and trip the server's reuse detection).
// The authorization URL is validated (https, or loopback http for dev entries, same origin as the attested issuer) and handed to a
// caller-supplied `openUrl` function; this module never starts a process or a shell (the CVE-2025-6514 class: an authorization endpoint
// passed to a shell `open`). Server and AS error text never travels: only host-chosen codes and the closed RFC 6749 error code.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { discoverOAuthProtectedResourceMetadata, discoverAuthorizationServerMetadata, startAuthorization, exchangeAuthorization, refreshAuthorization } from '@modelcontextprotocol/sdk/client/auth.js';
import { digest, fail, FoundryError, sanitizeScopes } from './common.mjs';
import { guardedFetch } from './guarded-fetch.mjs';
import { acceptPerson, DEFAULT_PERSON_CHANNELS, subjectOf } from './person.mjs';

export { sanitizeScopes };

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const OAUTH_ERRORS = new Set(['invalid_request', 'invalid_client', 'invalid_grant', 'unauthorized_client', 'unsupported_grant_type', 'invalid_scope', 'invalid_target', 'access_denied', 'server_error', 'temporarily_unavailable']);
const REFRESH_MARGIN_MS = 30000;

/** RFC 8707 canonical URI of an MCP server: no fragment, lower-case scheme and host (URL does that), no trailing slash on a bare origin. */
export function canonicalResource(url) {
  const u = new URL(url);
  u.hash = '';
  const href = u.toString();
  return u.pathname === '/' && !u.search ? href.slice(0, -1) : href;
}
const allowedUrl = (url, { dev }) => { try { const u = new URL(url); return u.protocol === 'https:' || (dev && u.protocol === 'http:' && LOOPBACK.has(u.hostname)); } catch { return false; } };
const scopesOf = text => String(text ?? '').split(/\s+/).filter(Boolean);
function oauthOf(entry) {
  const credential = entry.credential, oauth = credential?.oauth;
  if (!oauth) fail('OAUTH_NOT_CONFIGURED', `Entry ${entry.id} has no OAuth credential`);
  return { credential, oauth };
}
/** Map SDK / AS failures to host codes; AS-provided text never travels, only a closed RFC 6749 error code. */
function mapOAuthError(error, fallback) {
  if (error instanceof FoundryError) return error;
  const code = typeof error?.errorCode === 'string' && OAUTH_ERRORS.has(error.errorCode) ? error.errorCode : null;
  return new FoundryError(fallback, `The authorization server refused the request${code ? ` (${code})` : ''}`, code ? { oauthError: code } : {});
}

/**
 * Discovery for one entry: protected resource metadata from the MCP server (required, RFC 9728), the attested issuer in its
 * authorization_servers, AS metadata from that issuer only (its `issuer` must match exactly), PKCE S256 advertised, endpoints validated.
 */
export async function discover(entry, { baseFetch = fetch } = {}) {
  const { oauth } = oauthOf(entry), dev = entry.dev === true, resource = canonicalResource(entry.source.url);
  if (!allowedUrl(oauth.issuer, { dev })) fail('OAUTH_ENDPOINT_REFUSED', 'The attested issuer must be https (loopback http only for dev entries)');
  // Each fetch is pinned to one origin: the MCP server for its metadata, the attested issuer for everything else.
  const rsFetch = guardedFetch({ origin: entry.source.url, dev, baseFetch }), asFetch = guardedFetch({ origin: oauth.issuer, dev, baseFetch });
  let prm, metadata;
  try { prm = await discoverOAuthProtectedResourceMetadata(entry.source.url, {}, rsFetch); } catch (error) { throw mapOAuthError(error, 'OAUTH_RESOURCE_METADATA'); }
  if (canonicalResource(prm.resource) !== resource) fail('OAUTH_RESOURCE_MISMATCH', 'The protected resource metadata names a different resource');
  if (!(prm.authorization_servers ?? []).includes(oauth.issuer)) fail('OAUTH_ISSUER_UNATTESTED', 'The server names an authorization server the owner did not attest; refused (mix-up / redirection guard)');
  try { metadata = await discoverAuthorizationServerMetadata(oauth.issuer, { fetchFn: asFetch }); } catch (error) { throw mapOAuthError(error, 'OAUTH_METADATA'); }
  if (!metadata) fail('OAUTH_METADATA', 'The attested issuer publishes no authorization server metadata');
  // RFC 8414 §3.3: the metadata's issuer MUST be identical to the issuer it was fetched for. This is the recorded issuer for RFC 9207.
  if (metadata.issuer !== oauth.issuer) fail('OAUTH_ISSUER_MISMATCH', 'The authorization server metadata names a different issuer');
  // MCP 2026-07-28 security considerations: code_challenge_methods_supported absent means no PKCE, and the client MUST refuse to proceed.
  // (SDK 1.30.0 startAuthorization refuses only when the field is present without S256, so this check is Foundry's.)
  if (!Array.isArray(metadata.code_challenge_methods_supported) || !metadata.code_challenge_methods_supported.includes('S256')) fail('OAUTH_PKCE_UNSUPPORTED', 'The authorization server does not advertise PKCE S256; refused');
  const issuerOrigin = new URL(oauth.issuer).origin;
  for (const endpoint of [metadata.authorization_endpoint, metadata.token_endpoint]) {
    if (!allowedUrl(endpoint, { dev }) || new URL(endpoint).origin !== issuerOrigin) fail('OAUTH_ENDPOINT_REFUSED', 'Authorization endpoints must be https (or dev loopback) on the attested issuer origin');
  }
  return { resource, issuer: oauth.issuer, metadata, scopesSupported: sanitizeScopes(prm.scopes_supported ?? []) };
}

/** A one-shot loopback redirect receiver (RFC 8252 §7.3): 127.0.0.1, an OS-chosen port, path /callback. It never echoes parameters, and it
 *  accepts only the response that carries `state` (other requests get 400 and are ignored, so they cannot end or fail the connect). */
async function callbackServer(timeoutMs, state) {
  let deliver;
  const received = new Promise(resolve => { deliver = resolve; });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method !== 'GET' || url.pathname !== '/callback') { res.writeHead(404).end(); return; }
    if (url.searchParams.get('state') !== state) { res.writeHead(400, { 'content-type': 'text/plain', 'cache-control': 'no-store' }).end('Not this authorization.'); return; }
    res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }).end('Foundry received the authorization response. You can close this window.');
    deliver(url.searchParams);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
  let timer;
  const wait = Promise.race([received, new Promise((_, reject) => { timer = setTimeout(() => reject(new FoundryError('OAUTH_TIMEOUT', 'No authorization response arrived in time')), timeoutMs); })]);
  const close = () => { clearTimeout(timer); server.closeAllConnections?.(); return new Promise(resolve => server.close(() => resolve())); };
  return { redirectUri, wait, close };
}

/**
 * RFC 9207 §2.4 as tabulated by MCP 2026-07-28 ("Authorization Response Validation"), applied before the code reaches a token endpoint,
 * and to error responses too (on a mismatch nothing in the response is acted on or shown).
 */
export function checkIss(params, { recordedIssuer, issSupported }) {
  const iss = params.get('iss');
  if (iss !== null) { if (iss !== recordedIssuer) fail('OAUTH_ISS_MISMATCH', 'The authorization response names a different issuer; the code was not used'); return; }
  if (issSupported === true) fail('OAUTH_ISS_MISSING', 'The authorization server advertises iss but the response has none; the code was not used');
}

/** Scopes a connect may request for one scope class: the attested ones, plus those of an APPROVED scope.step-up proposal for this entry. */
export function connectScopes(entry, scopeClass, { ledger = null, stepUp = null } = {}) {
  const { oauth } = oauthOf(entry), attested = oauth.scopes[scopeClass];
  if (!attested) fail('OAUTH_SCOPE_CLASS', 'The scope class is read or write');
  if (!stepUp) return [...attested];
  const proposal = ledger?.approvedProposal(stepUp);
  if (!proposal || proposal.kind !== 'scope.step-up' || proposal.entry !== entry.id || proposal.scopeClass !== scopeClass)
    fail('OAUTH_SCOPE_UNAPPROVED', 'Extra scopes need an approved scope.step-up proposal for this entry and scope class');
  return [...new Set([...attested, ...sanitizeScopes(proposal.scopes)])];
}

/** The subject a person decides to connect one scope class of an entry: what is asked for, from whom, for which server. */
export function connectSubject(entry, scopeClass, scopes) {
  const { oauth } = oauthOf(entry);
  return subjectOf({ kind: 'oauth.connect', entry: entry.id, scopeClass, scopes: [...scopes].sort(), issuer: oauth.issuer, resource: canonicalResource(entry.source.url) });
}
/**
 * The owner's connect action for one entry and scope class. `person` is a PersonDecision (approve) for connectSubject(entry, scopeClass,
 * connectScopes(...)). `openUrl(url)` shows the authorization URL to the person (a browser or a printed line); it is never run through a
 * shell. `keychainStore(ref, value)` stores the token record (C1). Returns non-secret facts only.
 */
export async function connectOAuth(entry, { scopeClass, person, channels = DEFAULT_PERSON_CHANNELS, openUrl, keychainStore, ledger = null, stepUp = null, baseFetch = fetch, timeoutMs = 30000, now = Date.now } = {}) {
  const { credential, oauth } = oauthOf(entry), ref = credential[scopeClass]?.keychain;
  if (credential.custody !== 'C1' || !ref) fail('OAUTH_CUSTODY', 'OAuth tokens are held in the OS keychain (custody C1) under the entry\'s read and write refs');
  if (typeof openUrl !== 'function' || typeof keychainStore !== 'function') fail('OAUTH_CONNECT_ARGS', 'connect needs openUrl and keychainStore');
  const scopes = connectScopes(entry, scopeClass, { ledger, stepUp });
  const decided = acceptPerson(person, connectSubject(entry, scopeClass, scopes), { channels: ledger?.channels ?? channels });
  if (!decided.approve) fail('PERSON_DECLINED', 'The person declined this connection');
  const found = await discover(entry, { baseFetch });
  const asFetch = guardedFetch({ origin: oauth.issuer, dev: entry.dev === true, baseFetch });
  const state = randomBytes(24).toString('base64url');
  const receiver = await callbackServer(timeoutMs, state);
  try {
    const clientInformation = { client_id: oauth.clientId };
    let started;
    try { started = await startAuthorization(oauth.issuer, { metadata: found.metadata, clientInformation, redirectUrl: receiver.redirectUri, scope: scopes.join(' '), state, resource: new URL(found.resource) }); }
    catch (error) { throw mapOAuthError(error, 'OAUTH_AUTHORIZE'); }
    const url = started.authorizationUrl;
    if (!allowedUrl(url.href, { dev: entry.dev === true }) || url.origin !== new URL(oauth.issuer).origin) fail('OAUTH_ENDPOINT_REFUSED', 'The authorization URL is not on the attested issuer');
    await openUrl(url.href);
    const params = await receiver.wait;
    // state first (CSRF; a mismatch is discarded), then iss (mix-up), and only then anything else in the response.
    if (params.get('state') !== state) fail('OAUTH_STATE_MISMATCH', 'The authorization response does not carry this request\'s state; discarded');
    checkIss(params, { recordedIssuer: found.issuer, issSupported: found.metadata.authorization_response_iss_parameter_supported });
    if (params.get('error')) { const e = params.get('error'); fail('OAUTH_DENIED', 'The authorization was not granted', OAUTH_ERRORS.has(e) ? { oauthError: e } : {}); }
    const code = params.get('code');
    if (!code) fail('OAUTH_DENIED', 'The authorization response has no code');
    let tokens;
    try { tokens = await exchangeAuthorization(oauth.issuer, { metadata: found.metadata, clientInformation, authorizationCode: code, codeVerifier: started.codeVerifier, redirectUri: receiver.redirectUri, resource: new URL(found.resource), fetchFn: asFetch }); }
    catch (error) { throw mapOAuthError(error, 'OAUTH_TOKEN_REFUSED'); }
    const granted = tokens.scope ? scopesOf(tokens.scope) : scopes;
    // Least privilege: a grant wider than requested is refused and not stored.
    if (granted.some(s => !scopes.includes(s))) fail('OAUTH_SCOPE_WIDER', 'The authorization server granted more scope than was requested; the tokens were discarded');
    if (String(tokens.token_type).toLowerCase() !== 'bearer') fail('OAUTH_TOKEN_TYPE', 'Only bearer tokens are supported');
    const record = { schema: 'foundry-oauth-tokens/1', access_token: tokens.access_token, refresh_token: tokens.refresh_token ?? null,
      expires_at: tokens.expires_in ? now() + tokens.expires_in * 1000 : null, scope: granted.join(' '), resource: found.resource, issuer: found.issuer,
      token_endpoint: found.metadata.token_endpoint, client_id: oauth.clientId, scopeClass };
    await keychainStore(ref, JSON.stringify(record));
    return { entry: entry.id, scopeClass, scopes: granted, resource: found.resource, issuer: found.issuer, expiresAt: record.expires_at, refreshable: !!record.refresh_token };
  } finally { await receiver.close(); }
}

/**
 * The bearer source of one HTTP session (scope class read or write): reads the token record from the keychain, refuses a token issued for
 * another resource or issuer (it is never sent), refreshes it shortly before expiry (same scope; `resource` again; the rotated refresh
 * token is stored), and adds every value to the scrub set. A missing record is CREDENTIAL_MISSING (a person connects; nothing falls back).
 */
const REFRESHING = new Map();
/** Run `work` for one token record at a time (keyed by its keychain reference), process-wide. */
function serialized(key, work) {
  const previous = REFRESHING.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  const settled = next.catch(() => {});
  REFRESHING.set(key, settled);
  settled.then(() => { if (REFRESHING.get(key) === settled) REFRESHING.delete(key); });
  return next;
}
export function oauthBearer(entry, { scopeClass, keychain, keychainStore = null, scrub = null, baseFetch = fetch, now = Date.now }) {
  const { credential, oauth } = oauthOf(entry), ref = credential[scopeClass]?.keychain, resource = canonicalResource(entry.source.url);
  return () => serialized(`${ref?.service}\u0000${ref?.account}`, bearer);
  async function bearer() {
    if (!ref) fail('CREDENTIAL_REF', `Entry ${entry.id} has no ${scopeClass} token reference`);
    let text;
    try { text = await keychain(ref); } catch { text = null; }
    if (typeof text !== 'string' || !text) fail('CREDENTIAL_MISSING', 'No OAuth tokens are stored for this connection; the owner must connect it');
    let record;
    try { record = JSON.parse(text); } catch { fail('CREDENTIAL_INVALID', 'The stored OAuth record is not valid'); }
    scrub?.add(record.access_token); scrub?.add(record.refresh_token);
    // MCP: clients MUST NOT send a server tokens other than ones issued by its authorization server, and tokens are bound to a resource.
    if (record.resource !== resource || record.issuer !== oauth.issuer || record.client_id !== oauth.clientId) fail('OAUTH_TOKEN_AUDIENCE', 'The stored token was issued for another server or issuer; it is not sent');
    if (record.expires_at === null || record.expires_at - REFRESH_MARGIN_MS > now()) return record.access_token;
    if (!record.refresh_token || !keychainStore) fail('AUTH_EXPIRED', 'The access token expired and cannot be refreshed here; the owner must reconnect');
    const tokenEndpoint = record.token_endpoint;
    if (!allowedUrl(tokenEndpoint, { dev: entry.dev === true }) || new URL(tokenEndpoint).origin !== new URL(oauth.issuer).origin) fail('OAUTH_ENDPOINT_REFUSED', 'The stored token endpoint is not on the attested issuer');
    let tokens;
    try {
      tokens = await refreshAuthorization(oauth.issuer, { metadata: { issuer: oauth.issuer, token_endpoint: tokenEndpoint, token_endpoint_auth_methods_supported: ['none'] },
        clientInformation: { client_id: oauth.clientId }, refreshToken: record.refresh_token, resource: new URL(resource), fetchFn: guardedFetch({ origin: oauth.issuer, dev: entry.dev === true, baseFetch }) });
    } catch (error) { throw mapOAuthError(error, 'OAUTH_REFRESH_REFUSED'); }
    const granted = tokens.scope ? scopesOf(tokens.scope) : scopesOf(record.scope);
    if (granted.some(s => !scopesOf(record.scope).includes(s))) fail('OAUTH_SCOPE_WIDER', 'A refresh returned more scope than the stored grant; refused');
    const next = { ...record, access_token: tokens.access_token, refresh_token: tokens.refresh_token ?? record.refresh_token, expires_at: tokens.expires_in ? now() + tokens.expires_in * 1000 : null, scope: granted.join(' ') };
    scrub?.add(next.access_token); scrub?.add(next.refresh_token);
    await keychainStore(ref, JSON.stringify(next));
    return next.access_token;
  }
}

/**
 * A scope.step-up proposal from a typed SCOPE_INSUFFICIENT on an OAuth entry. The challenged scopes are server text: sanitized, and only
 * those the owner listed (the entry's attested read and write scopes and `stepUpScopes`) are carried; a challenge naming none of them raises
 * no proposal (a receipt records it). An open proposal for the same entry, class and scopes is returned instead of a new one.
 */
export function stepUpProposal(ledger, { entry, scopeClass, scopes, flowId = null, node = null, evidence = {} }) {
  const oauth = entry.credential?.oauth;
  if (!oauth) return null;
  const listed = new Set([...oauth.scopes.read, ...oauth.scopes.write, ...(oauth.stepUpScopes ?? [])]), asked = sanitizeScopes(scopes);
  const wanted = asked.filter(s => listed.has(s)).sort();
  if (!wanted.length) { ledger.receipt('scope.step-up.refused', { entry: entry.id, scopeClass, unlisted: asked.length, evidence }); return null; }
  const dedupKey = `sha256:${digest({ kind: 'scope.step-up', entry: entry.id, scopeClass, scopes: wanted })}`;
  const open = ledger.openProposal(dedupKey);
  if (open) return open;
  return ledger.putProposal({ kind: 'scope.step-up', flowId, node, entry: entry.id, scopeClass, scopes: wanted, dedupKey, ...(asked.length > wanted.length ? { unlistedDropped: asked.length - wanted.length } : {}),
    quoted: wanted.length ? [{ text: wanted.join(' '), label: `untrusted:mcp.${entry.id}`, sourceHash: null }] : [],
    diff: { added: [], scopes: { add: wanted } },
    riskSummary: { entry: entry.id, scopeClass, attested: entry.credential?.oauth?.scopes?.[scopeClass] ?? [], requested: wanted, flags: ['scope-widening', ...(scopeClass === 'write' ? ['write-scope'] : [])] },
    evidence });
}
