// The only fetch an HTTP MCP connection uses, ARCHITECTURE.md §3.3: https only (loopback http for development entries), no redirects
// (any 3xx is an error), the Authorization header attached only for the entry's own origin, a response size cap (a JSON body is buffered
// and refused over `maxBytes`; a server-sent event stream is counted as it is read and errors over `maxStreamBytes`), and a record of
// what was sent (for the canary sweep). The SDK's StreamableHTTPClientTransport takes it as its `fetch` option.
import { fail, FoundryError, sanitizeScopes } from './common.mjs';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function guardedFetch({ origin, dev = false, bearer = null, maxBytes = 2 * 1024 * 1024, maxStreamBytes = 8 * 1024 * 1024, onRequest = null, baseFetch = fetch } = {}) {
  const allowed = new URL(origin).origin;
  return async function nodecapFetch(input, init = {}) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.protocol !== 'https:' && !(dev && url.protocol === 'http:' && LOOPBACK.has(url.hostname))) fail('EGRESS_REFUSED', 'MCP connections use https (loopback http only for development entries)');
    const headers = new Headers(init.headers ?? (typeof input === 'object' && !(input instanceof URL) ? input.headers : undefined));
    headers.delete('authorization');
    // The bearer is sent to its own origin only; any other origin gets no Authorization header at all.
    if (bearer && url.origin === allowed) headers.set('authorization', `Bearer ${await bearer()}`);
    if (url.origin !== allowed) fail('EGRESS_REFUSED', 'An MCP connection talks only to its own origin');
    onRequest?.({ method: init.method ?? 'GET', origin: url.origin, path: url.pathname, authorized: headers.has('authorization') });
    const response = await baseFetch(url, { ...init, headers, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) fail('REDIRECT_REFUSED', `The MCP server answered with a redirect (${response.status}); redirects are refused`);
    if (response.status === 401 || response.status === 403) {
      const challenge = response.headers.get('www-authenticate') ?? '';
      // The challenged scopes are server text: sanitized to scope-shaped tokens; any error_description is dropped.
      if (/insufficient_scope/i.test(challenge)) fail('SCOPE_INSUFFICIENT', 'The server requires a scope this connection does not hold; a scope step-up is a person\'s decision', { status: response.status, scopes: sanitizeScopes(/(?:^|[\s,])scope="([^"]*)"/i.exec(challenge)?.[1] ?? '') });
      if (response.status === 401) fail('AUTH_REQUIRED', 'The server requires authorization this connection does not hold', { status: 401 });
    }
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > maxBytes) fail('RESPONSE_TOO_LARGE', `The response exceeds ${maxBytes} bytes`);
    if (!response.body) return response;
    if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
      // An event stream has no length up front: count every byte as the transport reads it, and fail the stream past the cap.
      let total = 0;
      const capped = response.body.pipeThrough(new TransformStream({ transform(chunk, controller) {
        total += chunk.length;
        if (total > maxStreamBytes) controller.error(new FoundryError('RESPONSE_TOO_LARGE', `The event stream exceeds ${maxStreamBytes} bytes`));
        else controller.enqueue(chunk);
      } }));
      return new Response(capped, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    // Buffer bounded JSON bodies so an oversized one is refused rather than parsed.
    const reader = response.body.getReader(), chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) { await reader.cancel(); fail('RESPONSE_TOO_LARGE', `The response exceeds ${maxBytes} bytes`); }
      chunks.push(value);
    }
    return new Response(Buffer.concat(chunks), { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}
