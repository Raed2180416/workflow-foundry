// Content pins of MCP tools and servers, ARCHITECTURE.md §3.3. A tool's pin covers the ENTIRE Tool object (name, title, description,
// inputSchema, outputSchema, annotations, icons, _meta, execution): an annotation-only or description-only change moves it. A server's pin
// covers its identity, instructions, capabilities, negotiated protocol version and the sorted tool pins. A changed pin is refused before
// any call is sent (I9). Values that are not plain JSON (checkData) are refused, never pinned.
import { checkData } from '../data.mjs';
import { fail, pinOf } from './common.mjs';

export function toolDigest(tool) {
  try { checkData(tool, { maxBytes: 512 * 1024 }); } catch (error) { fail('PIN_UNSUPPORTED', `A tool definition is not plain JSON (${error.code}); it cannot be pinned`); }
  return pinOf(tool);
}
/** Source identity for the server pin: stdio command line, or the HTTP URL with a development port removed (dev worlds bind port 0). */
export function sourceIdentity(entry) {
  if (entry.kind === 'mcp-stdio') return { kind: entry.kind, command: entry.source.command, args: entry.source.args, cwd: entry.source.cwd ?? null };
  const url = new URL(entry.source.url);
  if (entry.dev === true) url.port = '';
  return { kind: entry.kind, url: url.toString() };
}
export function serverDigest({ entry, serverInfo, instructions, capabilities, protocolVersion, toolDigests }) {
  const tools = Object.fromEntries(Object.entries(toolDigests).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  return pinOf({ serverInfo: serverInfo ?? null, instructions: instructions ?? null, capabilities: capabilities ?? null, protocolVersion: protocolVersion ?? null, tools, source: sourceIdentity(entry) });
}
/** The top-level Tool fields that differ (host-computed; never the server's text). */
export function diffTool(before, after) {
  if (!before || !after) return ['<presence>'];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return keys.filter(key => pinOf({ v: before[key] ?? null }) !== pinOf({ v: after[key] ?? null }));
}
/** Compare a fresh listing with recorded pins: {ok} or {ok:false, changed: [{tool, fields}], added, removed}. */
export function comparePins(expected, observed, { before = {}, after = {} } = {}) {
  const changed = [], added = [], removed = [];
  for (const [name, pin] of Object.entries(expected.tools ?? {})) {
    if (!Object.hasOwn(observed.tools, name)) removed.push(name);
    else if (observed.tools[name] !== pin) changed.push({ tool: name, fields: diffTool(before[name], after[name]) });
  }
  for (const name of Object.keys(observed.tools)) if (!Object.hasOwn(expected.tools ?? {}, name)) added.push(name);
  const ok = expected.server === observed.server && !changed.length && !removed.length && !added.length;
  return { ok, changed, added, removed, serverChanged: expected.server !== observed.server };
}
