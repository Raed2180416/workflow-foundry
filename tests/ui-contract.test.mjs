import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { layoutGraph, flowContext, scopeForNodeKey, childIterations, diffValues, statusLabel, statusTone, agentPresentation, generationLabel, providerLabel } from '../web/app.js';

test('UI layout handles unordered branches and joins without inventing edges', () => {
  const nodes = [
    { id: 'join', needs: ['left', 'right'] }, { id: 'right', needs: ['start'] },
    { id: 'start', needs: [] }, { id: 'left', needs: ['start'] }
  ];
  const graph = layoutGraph(nodes);
  assert.deepEqual(graph.edges, [{ from: 'left', to: 'join' }, { from: 'right', to: 'join' }, { from: 'start', to: 'right' }, { from: 'start', to: 'left' }]);
  for (const { from, to } of graph.edges) assert.ok(graph.positions.get(from).x < graph.positions.get(to).x, `${from} must precede ${to}`);
  assert.equal(graph.positions.get('left').x, graph.positions.get('right').x);
  assert.notEqual(graph.positions.get('left').y, graph.positions.get('right').y);
  for (const position of graph.positions.values()) {
    assert.ok(position.x >= 0 && position.y >= 0);
    assert.ok(position.x + position.width <= graph.width);
    assert.ok(position.y + position.height <= graph.height);
  }
});

test('UI layout reports malformed graph evidence and terminates on cycles', () => {
  const graph = layoutGraph([{ id: 'a', needs: ['b'] }, { id: 'b', needs: ['a', 'missing'] }]);
  assert.deepEqual(graph.cyclic, ['a', 'b']);
  assert.equal(graph.missingDependencies, 1);
  assert.equal(graph.positions.size, 2);
  assert.ok(Number.isFinite(layoutGraph([]).height));
});

const workflow = { nodes: [{ id: 'each', kind: 'map', body: { nodes: [{ id: 'repeat', kind: 'loop', body: { nodes: [{ id: 'ask', kind: 'human' }] } }] } }] };
const run = { nodes: { each: { status: 'waiting_child' } }, outputs: {}, frames: {
  'root/each:0': { nodes: {}, outputs: {} },
  'root/each:1': { nodes: {}, outputs: {} },
  'root/each:0/repeat:0': { nodes: { ask: { status: 'completed' } }, outputs: { ask: { answer: 'first' } } },
  'root/each:1/repeat:0': { nodes: { ask: { status: 'awaiting_human' } }, outputs: {} }
} };

test('nested UI views select only the exact recorded frame and preserve answer node paths', () => {
  const selected = scopeForNodeKey(workflow, 'root/each:1/repeat:0/ask');
  assert.deepEqual(selected, { scope: [{ nodeId: 'each', index: 1 }, { nodeId: 'repeat', index: 0 }], nodeId: 'ask' });
  const context = flowContext(workflow, selected.scope, run);
  assert.equal(context.frameKey, 'root/each:1/repeat:0');
  assert.equal(context.frame.nodes.ask.status, 'awaiting_human');
  assert.equal(context.frame.outputs.ask, undefined, 'A previous iteration output cannot leak into this view.');
  assert.equal(flowContext(workflow, [], run).frame, run);
  const definition = flowContext(workflow, [{ nodeId: 'each', index: null }, { nodeId: 'repeat', index: 0 }], run);
  assert.equal(definition.frameKey, null);
  assert.equal(definition.frame, null, 'Definition-only views must not imply recorded execution.');
  assert.equal(definition.flow.nodes[0].id, 'ask');
  assert.equal(scopeForNodeKey(workflow, 'root/each:999/not-a-node'), null);
  assert.equal(scopeForNodeKey(workflow, 'other/each:0/repeat:0/ask'), null);
});

test('nested iteration choices do not include grandchildren or similarly prefixed maps', () => {
  const extra = structuredClone(run);
  extra.frames['root/each:10'] = { nodes: {}, outputs: {} };
  extra.frames['root/each-other:2'] = { nodes: {}, outputs: {} };
  assert.deepEqual(childIterations(extra, 'root', 'each'), [0, 1, 10]);
  assert.deepEqual(childIterations(extra, 'root/each:1', 'repeat'), [0]);
  assert.deepEqual(childIterations(extra, null, 'repeat'), []);
});

test('proposal diff includes acceptance, budget, additions and removals with JSON pointer escaping', () => {
  const before = { nodes: [{ id: 'a', args: { 'a/b~c': 1, old: true } }], acceptance: [{ right: 1 }], budget: { maxSteps: 10 } };
  const after = { nodes: [{ id: 'a', args: { 'a/b~c': 2, added: false } }], acceptance: [{ right: 2 }], budget: { maxSteps: 3 } };
  const diff = diffValues(before, after);
  assert.equal(diff.truncated, false);
  assert.ok(diff.changes.some(change => change.path === '/nodes/0/args/a~1b~0c' && change.before === 1 && change.after === 2));
  assert.ok(diff.changes.some(change => change.path === '/acceptance/0/right'));
  assert.ok(diff.changes.some(change => change.path === '/budget/maxSteps'));
  assert.ok(diff.changes.some(change => change.path.endsWith('/old') && change.kind === 'removed'));
  assert.ok(diff.changes.some(change => change.path.endsWith('/added') && change.kind === 'added' && change.after === false));
  assert.equal(diffValues(before, after, 2).truncated, true);
  assert.equal(diffValues(before, after, 2).changes.length, 2);
});

test('uncertain, handled-error and skipped states are never colored as success', () => {
  for (const status of ['uncertain', 'handled_error', 'skipped', 'awaiting_human', 'waiting_child', 'processing', 'generating', 'accepted-candidate', 'rejected-candidate', 'failed-attempt', 'interrupted']) assert.notEqual(statusTone(status), 'good');
  assert.equal(statusLabel('uncertain'), 'Uncertain');
  assert.equal(statusTone('succeeded'), 'good');
  assert.equal(statusLabel('future-server-status'), 'future-server-status', 'Unknown server states stay visible.');
});

test('automatic-provider configuration does not imply human review or task qualification', () => {
  const manual = agentPresentation({ mode: 'host-agent-mcp', automaticBackgroundGeneration: false });
  assert.equal(manual.automatic, false);
  assert.match(manual.summary, /need a real host agent/);
  const proposed = agentPresentation({ automaticBackgroundGeneration: true, appliesCandidates: false });
  assert.match(proposed.summary, /proposed for review/);
  const applied = agentPresentation({ automaticBackgroundGeneration: true, appliesCandidates: true, deploymentQualifiedByDefault: true });
  assert.match(applied.summary, /applied automatically/);
  assert.match(applied.summary, /Independent task qualification is not implied/);
  assert.doesNotMatch(applied.summary, /review before applying/);
  assert.equal(agentPresentation({ automaticBackgroundGeneration: 'true', appliesCandidates: 'true' }).automatic, false, 'Wrong-type flags cannot enable automatic mode.');
  assert.equal(providerLabel({ kind: 'synthetic-test-provider', model: 'ui-fixture/1' }), 'synthetic-test-provider · ui-fixture/1');
});

test('generation labels preserve historical application and pending cancellation evidence', () => {
  assert.equal(generationLabel({ status: 'running' }, true), 'Cancellation requested');
  assert.equal(generationLabel({ status: 'failed' }, true), 'Failed');
  assert.equal(generationLabel({ status: 'cancelled' }, true), 'Cancelled');
  assert.equal(generationLabel({ status: 'applied', limits: { autoApply: false } }), 'Applied');
  assert.equal(generationLabel({ status: 'applied', limits: { autoApply: true } }), 'Applied automatically');
  assert.equal(generationLabel({ status: 'proposed', limits: { autoApply: false } }), 'Proposed · review required');
  assert.equal(generationLabel({ status: 'proposed', limits: { autoApply: false } }, false, { status: 'applied' }), 'Proposed · subsequently applied');
  assert.equal(generationLabel({ status: 'future-provider-status' }), 'future-provider-status');
});

test('UI assets require no CDN, unsafe HTML rendering, dynamic code or inline styles', () => {
  const source = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML|\beval\s*\(|new\s+Function\s*\(/);
  assert.doesNotMatch(source, /\.style\b|setAttribute\(['"]style['"]/);
  assert.doesNotMatch(html, /\sstyle\s*=|\son\w+\s*=/i);
  assert.doesNotMatch(html, /(?:src|href)=["']https?:/i);
  assert.doesNotMatch(css, /@import|url\(\s*['"]?https?:/i);
  assert.equal((html.match(/__FOUNDRY_BOOTSTRAP__/g) ?? []).length, 1);
  for (const id of ['request-form', 'run-controls', 'proposal-review', 'graph-viewport', 'import-dialog']) assert.ok(html.includes(`id="${id}"`));
});
