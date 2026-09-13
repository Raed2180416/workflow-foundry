// Inert, domain-neutral fixtures for construction diagnostics. These are never
// substituted for a model response or used to qualify the batch demonstration.
export const malformedExtraBrace = '{"workflow":{"nodes":[{"id":"step","args":{"schema":{"type":"object"}}}, "timeoutMs":1000}]} ,"rationale":"Neutral syntax probe."}';
export const ref = $ref => ({ $ref });
export const exists = value => ({ op: 'exists', value });
export const eq = (left, right) => ({ op: 'eq', left, right });
const task = (id, tool, args, needs = []) => ({ id, kind: 'task', description: `Neutral ${id} probe`, needs, tool, args, timeoutMs: 1000, retry: { maxAttempts: 1 } });

export function neutralNested(kind = 'map', acceptance = [exists(ref('nodes.emit.payload'))], field = 'emit.payload') {
  if (!['map', 'loop'].includes(kind)) throw new Error('Expected map or loop');
  const node = { id: 'group', kind, description: 'A neutral nested data binding', needs: [],
    ...(kind === 'map' ? { items: ref('input.entries'), maxItems: 5 }
      : { initial: { emit: { payload: 'seed' } }, maxIterations: 2, until: exists(ref('nodes.emit.payload')) }),
    // Keep the neutral loop's recurrence valid even if a later iteration is
    // needed. This fixture tests nested acceptance, not a dropped body wrapper.
    body: { nodes: [task('emit', 'core.identity', { payload: ref(kind === 'map' ? 'item' : 'previous.emit.payload') })], acceptance }
  };
  return { schemaVersion: '1.0', id: `Neutral${kind}`, version: 1, title: 'Synthetic construction probe', domain: 'diagnostic',
    goal: 'Exercise generic nested contracts without an external model or task answer.',
    envelope: { assumptions: ['Inert local fixture'], risks: [], successCriteria: ['Observed values retain their declared nesting'] },
    budget: { maxSteps: 20, maxConcurrency: 1, maxDurationMs: 10000, maxCost: 0 },
    nodes: [node, ...(kind === 'map' ? [task('project', 'core.pluck', { items: ref('nodes.group.items'), field }, ['group'])] : [])],
    acceptance: [exists(ref(kind === 'map' ? 'nodes.project.items' : 'nodes.group.last.emit.payload'))] };
}

export function promptFeedback(prompt) {
  const marker = 'Previous candidate and independent host feedback (repair the causal defect, preserve the task and capability contracts):\n';
  const start = prompt.indexOf(marker);
  if (start < 0) return null;
  const end = prompt.lastIndexOf('\n\nReturn exactly one JSON object');
  if (end < start) throw new Error('Incomplete generator feedback envelope');
  return JSON.parse(prompt.slice(start + marker.length, end));
}
