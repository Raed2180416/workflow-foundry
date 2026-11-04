// MCP client adapter for catalog entries (stdio and streamable HTTP), ARCHITECTURE.md §3.3, on the pinned @modelcontextprotocol/sdk 1.30.0.
// A connection is lazy (spawned or opened on first use) and closed with its owner. stdio children are spawned only after their pinned files
// re-hash to the owner's integrity pins, inside the namespace sandbox of ./stdio-sandbox.mjs, with a blanked environment plus the entry's
// envAllow names (as src/components.mjs); their stderr is drained unread. HTTP connections use ./guarded-fetch.mjs and keep
// SEPARATE sessions for the read and the write credential, chosen by member effects. Listing always uses the constant clientInfo and the
// read (production) credential, so a server cannot serve the pinning client one definition and the calling client another.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, DEFAULT_INHERITED_ENV_VARS } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { fail, FoundryError } from './common.mjs';
import { guardedFetch } from './guarded-fetch.mjs';
import { osKeychain, osKeychainStore, resolveCredential } from './credentials.mjs';
import { oauthBearer } from './oauth.mjs';
import { sandboxedSpawn } from './stdio-sandbox.mjs';

export const CLIENT_INFO = Object.freeze({ name: 'workflow-foundry-nodecap', version: '1' });
const MAX_PAGES = 10;

export class McpConnection {
  #clients = new Map();
  #listeners = new Set();
  constructor(entry, { connection = null, scrub = null, env = process.env, keychain, keychainStore = null, cwd = undefined, onRequest = null, timeoutMs = 15000, now = Date.now } = {}) {
    if (!['mcp-stdio', 'mcp-http'].includes(entry.kind)) fail('MCP_ENTRY', `Entry ${entry.id} is not an MCP server`);
    Object.assign(this, { entry, connection, scrub, env, keychain, keychainStore, cwd, onRequest, timeoutMs, now });
    this.negotiated = new Map();
    this.listChanges = 0; // notifications/tools/list_changed seen on any session of this connection
  }
  onListChanged(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  credentialRef(scope) {
    const credential = this.entry.credential ?? this.connection?.credential ?? null;
    if (!credential) return null;
    const ref = scope === 'write' ? credential.write ?? null : credential.read ?? null;
    return ref ? { ref, custody: credential.custody, credential } : null;
  }
  async #client(scope) {
    // stdio servers have one session (one process); credentials do not apply. HTTP keeps one session per credential scope.
    const key = this.entry.kind === 'mcp-stdio' ? 'stdio' : scope;
    if (this.#clients.has(key)) return this.#clients.get(key);
    const pending = this.#open(scope, key);
    this.#clients.set(key, pending);
    try { return await pending; } catch (error) { this.#clients.delete(key); throw error; }
  }
  async #open(scope, key) {
    let transport;
    if (this.entry.kind === 'mcp-stdio') {
      // Credentials the server takes from its environment (envSecrets) are resolved by host code first: each value enters the scrub set,
      // so a tool output, trace or log that echoes it is refused (SECRET_EXPOSURE); a missing or unscrubbably short one refuses the spawn.
      for (const name of this.entry.source.envSecrets ?? []) await resolveCredential({ env: name }, { custody: 'C0', scrub: this.scrub, env: this.env });
      // Integrity pins first (SOURCE_INTEGRITY refuses the spawn), then the sandboxed command line.
      const spawn = sandboxedSpawn(this.entry, { env: this.env });
      // The SDK merges its default HOME/USER/... even when env is supplied: blank every inherited key before restoring the allowlist.
      const env = { ...Object.fromEntries(DEFAULT_INHERITED_ENV_VARS.map(name => [name, ''])), ...spawn.env };
      transport = new StdioClientTransport({ command: spawn.command, args: spawn.args, cwd: spawn.cwd, env, stderr: 'pipe' });
      transport.stderr?.resume();
    } else {
      const found = this.credentialRef(scope);
      // OAuth tokens (C1) come through oauthBearer: audience-checked, refreshed by host code, never re-authorized or up-scoped by the SDK.
      const bearer = !found ? null : found.credential.oauth
        ? oauthBearer({ ...this.entry, credential: found.credential }, { scopeClass: scope, keychain: this.keychain ?? osKeychain, keychainStore: this.keychainStore ?? (this.keychain ? null : osKeychainStore), scrub: this.scrub, now: this.now })
        : () => resolveCredential(found.ref, { custody: found.custody, scrub: this.scrub, env: this.env, keychain: this.keychain });
      transport = new StreamableHTTPClientTransport(new URL(this.entry.source.url), {
        fetch: guardedFetch({ origin: this.entry.source.url, dev: this.entry.dev === true, bearer, onRequest: this.onRequest }) });
    }
    const original = transport.setProtocolVersion?.bind(transport);
    transport.setProtocolVersion = version => { this.negotiated.set(key, version); original?.(version); };
    const client = new Client({ ...CLIENT_INFO }, { capabilities: {} });
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => { this.listChanges++; for (const listener of this.#listeners) listener(this.entry.id); });
    try { await client.connect(transport, { timeout: this.timeoutMs }); }
    catch (error) { await client.close().catch(() => {}); throw mapError(error, 'MCP_CONNECT'); }
    return client;
  }
  /** Every tool page (at most ten; a repeated cursor is refused), with the server identity a pin covers. */
  async listAll() {
    const client = await this.#client('read'), tools = [], cursors = new Set();
    let cursor;
    for (let page = 0; page < MAX_PAGES; page++) {
      let result;
      try { result = await client.listTools(cursor ? { cursor } : {}, { timeout: this.timeoutMs }); } catch (error) { throw mapError(error, 'MCP_LIST'); }
      tools.push(...result.tools); cursor = result.nextCursor;
      if (!cursor) break;
      if (cursors.has(cursor)) fail('MCP_CATALOG_CURSOR', `Server ${this.entry.id} repeated a tool-list cursor`);
      cursors.add(cursor);
    }
    if (cursor) fail('MCP_CATALOG_LIMIT', `Server ${this.entry.id} listed more than ${MAX_PAGES} pages of tools`);
    if (new Set(tools.map(t => t.name)).size !== tools.length) fail('MCP_CATALOG_DUPLICATE', `Server ${this.entry.id} listed duplicate tool names`);
    const key = this.entry.kind === 'mcp-stdio' ? 'stdio' : 'read';
    return { tools: JSON.parse(JSON.stringify(tools)), serverInfo: client.getServerVersion() ?? null, instructions: client.getInstructions() ?? null,
      capabilities: client.getServerCapabilities() ?? null, protocolVersion: this.negotiated.get(key) ?? null };
  }
  /** One tools/call on the session of `scope` (read for effects none, write otherwise). Returns the raw CallToolResult. */
  async call(tool, args, { signal, timeoutMs = this.timeoutMs, scope = 'read' } = {}) {
    const client = await this.#client(scope);
    try { return await client.callTool({ name: tool, arguments: args }, undefined, { signal, timeout: timeoutMs }); }
    catch (error) { throw mapError(error, 'MCP_CALL'); }
  }
  async close() { const clients = [...this.#clients.values()]; this.#clients.clear(); await Promise.allSettled(clients.map(async c => (await c).close())); }
}

// Upstream error text never travels: only a host-chosen code (and, for our own guarded-fetch refusals, their own code).
function mapError(error, fallback) {
  const own = error instanceof FoundryError ? error : error?.cause instanceof FoundryError ? error.cause : null;
  if (own) return own;
  const text = String(error?.message ?? '');
  // Server text and JSON-RPC error codes are the server's own words: they never become SCOPE_INSUFFICIENT (a step-up proposal) or
  // AUTH_REQUIRED. Only guarded-fetch's own refusals of an HTTP 401/403 challenge (returned above as `own`) are those codes.
  if (error?.name === 'AbortError' || /aborted/i.test(text)) return new FoundryError('CANCELLED', 'The MCP request was cancelled');
  if (/timed out|timeout/i.test(text)) return new FoundryError('TOOL_TIMEOUT', 'The MCP request timed out');
  return new FoundryError(fallback, `The MCP ${fallback === 'MCP_CALL' ? 'call' : fallback === 'MCP_LIST' ? 'listing' : 'connection'} failed`);
}

/** Host-owned pool of MCP connections, one per catalog entry, closed together. */
export class McpPool {
  #connections = new Map();
  constructor(catalog, options = {}) { this.catalog = catalog; this.options = options; }
  get(entryId) {
    if (this.#connections.has(entryId)) return this.#connections.get(entryId);
    const entry = this.catalog.entries.find(e => e.id === entryId);
    if (!entry) fail('MCP_ENTRY', `No catalog entry ${entryId}`);
    const connection = entry.connection ? this.catalog.entries.find(e => e.id === entry.connection) : null;
    const created = new McpConnection(entry, { ...this.options, connection });
    this.#connections.set(entryId, created);
    return created;
  }
  async close() { const all = [...this.#connections.values()]; this.#connections.clear(); await Promise.allSettled(all.map(c => c.close())); }
}
