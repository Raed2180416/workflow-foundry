// Evaluator-author supplied upper bound and deliberate mutants. NEVER feed this
// file or its generated graphs to a constructor being evaluated on this task.
import { INPUT_SCHEMA, TASK } from './contract.mjs';

const ref = ($ref, fallback = null) => ({ $ref, default: fallback });
const eq = (left, right) => ({ op: 'eq', left, right });
const all = (...conditions) => ({ op: 'all', conditions });
const any = (...conditions) => ({ op: 'any', conditions });
const not = condition => ({ op: 'not', condition });
const yes = eq(1, 1), no = eq(1, 0);
const task = (id, tool, args, needs = [], extra = {}) => ({
  id, kind: 'task', description: `Supplied ${id} operation`, needs, tool, args,
  timeoutMs: 3000, retry: { maxAttempts: 1 }, ...extra
});
const envelope = {
  assumptions: ['Evaluator-author supplied executable upper bound; zero learned construction claim.'],
  risks: ['Missing evidence and instrument errors require explicit dispositions.'],
  successCriteria: ['Every sample reported with the observed disposition and exact permitted instrument attempts.']
};

export function suppliedWorkflow(mode = 'positive') {
  const schemaScreen = { type: 'object', required: ['ok', 'sampleId', 'suspicious'],
    properties: { ok: { const: true }, sampleId: { type: 'string' }, suspicious: { type: 'boolean' } } };
  const loose = mode === 'accept_missing_evidence';
  const schemaReproduction = { type: 'object',
    required: loose ? ['ok', 'sampleId'] : ['ok', 'sampleId', 'independent', 'evidenceId', 'reproduced'],
    properties: { ok: { const: true }, sampleId: { type: 'string' }, independent: { const: true },
      evidenceId: { type: 'string', minLength: 1 }, reproduced: { type: 'boolean' } } };
  const usableScreen = all(eq(ref('nodes.screenShape.valid'), true), eq(ref('nodes.screen.sampleId'), ref('item.id')));
  const wanted = all(usableScreen, eq(ref('nodes.screen.suspicious'), true));
  const completeReproduction = all(wanted, eq(ref('nodes.reproShape.valid'), true), eq(ref('nodes.reproduce.sampleId'), ref('item.id')));
  const fromScreen = mode === 'confirm_from_screen';
  const flags = {
    clear: all(usableScreen, eq(ref('nodes.screen.suspicious'), false)),
    confirmed: fromScreen ? wanted : all(completeReproduction, eq(ref('nodes.reproduce.reproduced', loose ? true : null), true)),
    not_reproduced: fromScreen ? no : all(completeReproduction, eq(ref('nodes.reproduce.reproduced'), false)),
    error: any(eq(ref('nodes.screen.ok'), false), fromScreen ? no : all(wanted, eq(ref('nodes.reproduce.ok'), false)))
  };
  flags.inconclusive = not(any(...Object.values(flags)));
  const reproduction = task('reproduce', 'lab.reproduce', { sampleId: ref('item.id') }, ['screenShape'],
    { join: 'all_resolved', onError: 'continue', when: fromScreen ? no : wanted });
  if (mode === 'reproduce_every_item') delete reproduction.when;
  const rowNames = Object.keys(flags).map(name => `row_${name}`);
  const body = {
    nodes: [
      task('screen', 'lab.screen', { sampleId: ref('item.id') }, [], { onError: 'continue' }),
      task('screenShape', 'core.validate', { value: ref('nodes.screen', {}), schema: schemaScreen }, ['screen'], { join: 'all_resolved' }),
      reproduction,
      task('reproShape', 'core.validate', { value: ref('nodes.reproduce', {}), schema: schemaReproduction }, ['reproduce'], { join: 'all_resolved' }),
      ...Object.entries(flags).map(([disposition, when]) => task(`row_${disposition}`, 'core.identity',
        { sampleId: ref('item.id'), disposition }, ['screenShape', 'reproShape'], { when, join: 'all_resolved' })),
      task('selected', 'data.one', { values: rowNames.map(id => ref(`nodes.${id}`)) }, rowNames, { join: 'all_resolved' })
    ],
    acceptance: [eq(ref('nodes.selected.value.sampleId'), ref('item.id'))]
  };
  const workflow = {
    schemaVersion: '1.0', id: `Supplied_${mode}`, version: 1, title: `Supplied ${mode}`,
    goal: TASK, domain: 'synthetic-sample-processing', envelope, inputSchema: INPUT_SCHEMA,
    budget: { maxSteps: 160, maxConcurrency: 2, maxDurationMs: 30000, maxCost: 0 },
    nodes: [
      { id: 'samples', kind: 'map', needs: [], description: 'Supplied per-sample computation',
        items: ref('input.samples', []), maxItems: 6, body },
      task('rows', 'core.pluck', { items: ref('nodes.samples.items', []), field: 'selected.value' }, ['samples'], { join: 'all_resolved' }),
      task('serialized', 'core.json', { value: { samples: ref('nodes.rows.items', []) } }, ['rows']),
      task('manifest', 'core.artifact', { name: 'manifest.json', content: ref('nodes.serialized.text', '') }, ['serialized'])
    ],
    acceptance: [eq(ref('nodes.manifest.name'), 'manifest.json')],
    metadata: { tags: ['supplied-control'], rationale: 'Authored from the public contract by the evaluator author. Not model synthesis.' }
  };
  if (mode === 'skip_item' || mode === 'duplicate_item') {
    workflow.nodes[0].items = Array.from({ length: mode === 'skip_item' ? 1 : 2 }, () => ref('input.samples.0'));
    workflow.nodes[0].when = { op: 'exists', value: { $ref: 'input.samples.0' } };
  }
  if (mode === 'do_nothing') {
    workflow.nodes = [task('claim', 'core.identity', { successful: true })];
    workflow.acceptance = [eq(ref('nodes.claim.successful'), true)];
  }
  return workflow;
}

// All identifiers and declaration order change. Only public data semantics stay
// the same. This checks that the independent oracle does not require our graph.
export function renamedEquivalent() {
  const original = suppliedWorkflow();
  const mapping = new Map();
  const collect = flow => flow.nodes.forEach(node => {
    mapping.set(node.id, `u${mapping.size}`); if (node.body) collect(node.body);
  });
  collect(original);
  const walk = value => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      const copy = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]));
      if (copy.kind && copy.id && mapping.has(copy.id)) copy.id = mapping.get(copy.id);
      if (copy.needs) copy.needs = copy.needs.map(id => mapping.get(id));
      if (copy.$ref?.startsWith('nodes.')) { const parts = copy.$ref.split('.'); parts[1] = mapping.get(parts[1]); copy.$ref = parts.join('.'); }
      if (copy.field === 'selected.value') copy.field = `${mapping.get('selected')}.value`;
      if (copy.nodes) copy.nodes.reverse();
      return copy;
    }
    return value;
  };
  const changed = walk(original); changed.id = 'SuppliedEquivalent';
  return changed;
}

export const MUTANTS = ['skip_item', 'reproduce_every_item', 'confirm_from_screen', 'accept_missing_evidence', 'do_nothing', 'duplicate_item'];
