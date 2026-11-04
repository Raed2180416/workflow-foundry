// Host-side fault and drift injection for the bed facade (PLAN §3.2 "Adaptivity: tools, MCP, faults, drift"; WorkBench
// extras rule wb-extras-v1). A fault spec is declared per session before it starts; the relay and the model see only its
// effect, the world sees only what the spec says reaches it, and grading is unchanged (the journal of world actions).
// A deliberate fault is never an environment fault.
//
//   transient     {kind, target: 'write' | <mcp name>, nth = 1, times = 1}: matching calls nth .. nth+times-1 are
//                 answered "503 Service Unavailable" and not forwarded (the world is unchanged; a retry succeeds)
//   lost_ack      {kind, target, nth = 1}: the matching call is forwarded and applied, then answered with a timeout
//                 error (a blind retry duplicates the effect)
//   rename_param  {kind, tool: <bed name>, from, to}: drift; the tool's schema shows `to` instead of `from`; the host maps
//                 `to` back to `from`; a call that still uses `from` is refused ("unknown parameter") and not forwarded
//   distractor    {kind, like: <bed name>}: a retired twin `<mcp name>_v2` with the same schema is listed; calling it
//                 changes nothing and answers that the endpoint is retired
export const FAULT_TEXT = Object.freeze({
  transient: '503 Service Unavailable: the service is temporarily unavailable and the request was not applied. Please retry.',
  lost_ack: 'Request timed out after 30 s waiting for the service to confirm. The outcome is unknown.',
  retired: name => `This endpoint (${name}) is retired and no longer performs any action.`,
  unknownParam: (p, to) => `Invalid arguments: unknown parameter '${p}'.${to ? ` Expected parameters include '${to}'.` : ''}`,
});

const sanitize = name => name.replace(/[^a-zA-Z0-9_-]/g, '_');

/** Validate a spec; returns it normalised or throws. */
export function normalizeFault(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('fault spec must be an object');
  const k = spec.kind;
  if (k === 'transient') return { kind: k, target: spec.target ?? 'write', nth: spec.nth ?? 1, times: spec.times ?? 1 };
  if (k === 'lost_ack') return { kind: k, target: spec.target ?? 'write', nth: spec.nth ?? 1 };
  if (k === 'rename_param') { if (!spec.tool || !spec.from || !spec.to) throw new Error('rename_param needs tool, from, to'); return { kind: k, tool: spec.tool, from: spec.from, to: spec.to }; }
  if (k === 'distractor') { if (!spec.like) throw new Error('distractor needs like'); return { kind: k, like: spec.like }; }
  throw new Error(`unknown fault kind ${k}`);
}

/**
 * The session's view of the catalog under a fault: { mcpTools (for the relay's tools.json), hostCatalog (for the host:
 * [{name, bedName, write, distractor?}]), extraToolNames (names the init fingerprint gains) }.
 * mcpTools: [{name, description, inputSchema}] as the session would see them without a fault; bedTools: the host catalog.
 */
export function applyFaultToCatalog({ mcpTools, bedTools }, spec) {
  const f = spec ? normalizeFault(spec) : null;
  let tools = mcpTools.map(t => ({ ...t, inputSchema: structuredClone(t.inputSchema) }));
  let host = bedTools.map(t => ({ ...t }));
  const extra = [];
  if (f?.kind === 'rename_param') {
    const mcp = sanitize(f.tool);
    const t = tools.find(x => x.name === mcp);
    if (!t) throw new Error(`rename_param: no tool ${f.tool}`);
    const props = t.inputSchema?.properties ?? {};
    if (!(f.from in props)) throw new Error(`rename_param: ${f.tool} has no parameter ${f.from}`);
    // keep property order, swap the key
    t.inputSchema.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k === f.from ? f.to : k, v]));
    if (Array.isArray(t.inputSchema.required)) t.inputSchema.required = t.inputSchema.required.map(r => (r === f.from ? f.to : r));
    if (typeof t.description === 'string') t.description = t.description.replace(new RegExp(`\\b${f.from}\\b`, 'g'), f.to);
  }
  if (f?.kind === 'distractor') {
    const mcp = sanitize(f.like);
    const t = tools.find(x => x.name === mcp);
    if (!t) throw new Error(`distractor: no tool ${f.like}`);
    const name = `${mcp}_v2`;
    tools = [...tools, { name, description: t.description, inputSchema: structuredClone(t.inputSchema) }];
    host = [...host, { name, bedName: null, write: false, distractor: true }];
    extra.push(name);
  }
  return { mcpTools: tools, hostCatalog: host, extraToolNames: extra };
}

/**
 * The host's fault state for one session. decide({ name (MCP), bedName, write, args }) is called for every catalog call
 * before it reaches the world and returns one of:
 *   { action: 'pass', args }                  forward (args possibly mapped back by a drift)
 *   { action: 'refuse', text }                answer with an error; nothing reaches the world
 *   { action: 'apply_then_error', args, text} forward, then answer with an error (lost acknowledgement)
 * Every decision that is not a plain pass is journaled by the host as a `fault` record.
 */
export function faultState(spec) {
  const f = spec ? normalizeFault(spec) : null;
  let matched = 0;
  const matches = c => (f.target === 'write' ? c.write : c.name === f.target);
  return {
    spec: f,
    decide(c) {
      if (!f) return { action: 'pass', args: c.args };
      if (c.distractor) return { action: 'refuse', text: FAULT_TEXT.retired(c.name), fault: 'distractor' };
      if (f.kind === 'rename_param' && c.bedName === f.tool) {
        const a = { ...c.args };
        if (f.from in a && !(f.to in a)) return { action: 'refuse', text: FAULT_TEXT.unknownParam(f.from, f.to), fault: 'rename_param_old_name' };
        // map back in place, so the logged action keeps the argument order the agent used
        if (f.to in a) return { action: 'pass', args: Object.fromEntries(Object.entries(a).map(([k, v]) => [k === f.to ? f.from : k, v])), fault: 'rename_param_mapped' };
        return { action: 'pass', args: a };
      }
      if ((f.kind === 'transient' || f.kind === 'lost_ack') && matches(c)) {
        matched += 1;
        const hit = f.kind === 'transient' ? matched >= f.nth && matched < f.nth + f.times : matched === f.nth;
        if (hit && f.kind === 'transient') return { action: 'refuse', text: FAULT_TEXT.transient, fault: 'transient' };
        if (hit) return { action: 'apply_then_error', args: c.args, text: FAULT_TEXT.lost_ack, fault: 'lost_ack' };
      }
      return { action: 'pass', args: c.args };
    },
  };
}
