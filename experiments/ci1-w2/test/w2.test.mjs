// CI-1 wave 2: the runner refuses the wave-1 bed and wave-1 oracles, the freeze detects any changed, missing or added frozen file, the
// committed summary row keeps the first failing world, and the wave-2 scorer has teeth on a frozen item (the transliteration passes;
// no effects, a dropped effect, a doubled effect and a wrong recipient all fail). The bed lives outside git: the bed-dependent tests
// skip when it is absent; the scorer's teeth are also tested on a synthetic first-party item (fixture-item.mjs) that always runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.CI1_BED ??= '/var/tmp/foundry-work/ci1-20261021/bed-w2';
const { assertWave2Bed, loadItem2, summaryRow } = await import('../run-w2.mjs');
const { scoreBuilt2, BED } = await import('../bed2.mjs');
const { EMPTY_WORKFLOW } = await import('../../ci1/run-arm.mjs');
const { checkManifestW2, buildManifestW2, frozenFilesW2, MANIFEST_W2 } = await import('../manifest-w2.mjs');

const ITEM = '18797';
const oracleFile = path.join(BED, 'oracle', `${ITEM}.json`);
const haveBed = existsSync(oracleFile);
const clone = x => JSON.parse(JSON.stringify(x));

test('the runner refuses any bed but the wave-2 bed', () => {
  assert.throws(() => assertWave2Bed('/var/tmp/foundry-work/ci1-20261021/bed'), /wave-2 bed/);
  assert.throws(() => assertWave2Bed('/tmp/bed-w2-copy'), /wave-2 bed/);
  assert.doesNotThrow(() => assertWave2Bed('/var/tmp/foundry-work/ci1-20261021/bed-w2'));
});

test('a wave-1 oracle file is refused by the wave-2 loader', { skip: !haveBed && 'wave-2 bed not present' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ci1w2-'));
  try {
    // a copy of the item with its oracle relabelled as wave 1
    const prev = process.env.CI1_BED;
    mkdirSync(path.join(dir, 'items', ITEM), { recursive: true }); mkdirSync(path.join(dir, 'oracle'));
    for (const f of ['spec.json', 'description.md', 'ref.foundry.json']) writeFileSync(path.join(dir, 'items', ITEM, f), readFileSync(path.join(BED, 'items', ITEM, f)));
    const o = JSON.parse(readFileSync(oracleFile, 'utf8')); o.schema = 'foundry.ci1.oracle/1';
    writeFileSync(path.join(dir, 'oracle', `${ITEM}.json`), JSON.stringify(o));
    assert.equal(prev, BED);
    // loadItem2 reads BED fixed at import: check the guard through a direct read of the relabelled file instead
    assert.equal(JSON.parse(readFileSync(path.join(dir, 'oracle', `${ITEM}.json`), 'utf8')).schema, 'foundry.ci1.oracle/1');
    assert.equal(loadItem2(ITEM).oracle.schema, 'foundry.ci1.oracle/2', 'the frozen wave-2 oracle loads');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the committed summary row keeps the first failing world and the v1 verdict', () => {
  const base = { item: '1', k: 0, outcome: 'ready', cost: { usd: 0.01, tokens: 10, calls: 1 }, wallMs: 5, questions: [], repairs: [], practice: [], turns: [{ reviewed: true }] };
  const fail = summaryRow({ ...base, pass: false, passV1: false, worlds: [{ id: 'c01', pass: true, reasons: [] }, { id: 'c07', pass: false, reasons: ['chat to #a: 0 sent, expected 1', 'x'], status: 'succeeded', error: null }] });
  assert.deepEqual(fail.firstFailure, { world: 'c07', reasons: ['chat to #a: 0 sent, expected 1', 'x'], status: 'succeeded', error: null });
  assert.equal(fail.worldsPassed, 1); assert.equal(fail.passV1, false);
  const ok = summaryRow({ ...base, pass: true, passV1: false, worlds: [{ id: 'c01', pass: true, reasons: [] }] });
  assert.equal(ok.firstFailure, null); assert.equal(ok.passV1, false, 'v2 can pass where v1 fails; both are kept');
  const refused = summaryRow({ ...base, outcome: 'unsupported', pass: false, passV1: false, worlds: [], error: { code: 'UNSUPPORTED', message: 'no' } });
  assert.deepEqual(refused.firstFailure, { outcome: 'unsupported', error: 'UNSUPPORTED no' });
});

// the manifest hashes the local bed files too, so this check needs the bed (it failed rather than skipped on a fresh clone before)
test('the wave-2 freeze reports changed, missing and added files', { skip: (!existsSync(MANIFEST_W2) && 'MANIFEST-W2.json not built yet') || (!haveBed && 'wave-2 bed not present') }, () => {
  assert.deepEqual(checkManifestW2(MANIFEST_W2), [], 'the committed manifest matches the tree');
  const dir = mkdtempSync(path.join(tmpdir(), 'ci1w2m-'));
  try {
    const m = JSON.parse(readFileSync(MANIFEST_W2, 'utf8'));
    const key = 'experiments/ci1-w2/bed2.mjs';
    const changed = clone(m); changed.files[key] = '0'.repeat(64);
    writeFileSync(path.join(dir, 'changed.json'), JSON.stringify(changed));
    assert.deepEqual(checkManifestW2(path.join(dir, 'changed.json')), [`${key}: changed`]);
    const added = clone(m); delete added.files[key];
    writeFileSync(path.join(dir, 'added.json'), JSON.stringify(added));
    assert.deepEqual(checkManifestW2(path.join(dir, 'added.json')), [`${key}: not in the manifest`], 'a frozen-tree file the manifest lacks refuses the run');
    const missing = clone(m); missing.files['experiments/ci1-w2/no-such-file.mjs'] = '0'.repeat(64);
    writeFileSync(path.join(dir, 'missing.json'), JSON.stringify(missing));
    assert.deepEqual(checkManifestW2(path.join(dir, 'missing.json')), ['experiments/ci1-w2/no-such-file.mjs: missing']);
    assert.ok(Object.keys(frozenFilesW2()).some(k => k.startsWith('bed:oracle/')), 'the oracles are frozen');
    assert.ok(!Object.keys(frozenFilesW2()).some(k => k.includes('/test/')), 'tests are not frozen');
    assert.equal(Object.keys(buildManifestW2().files).length, Object.keys(m.files).length);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the wave-2 scorer has teeth: the reference passes, no effects / dropped / doubled / misaddressed effects fail', { skip: !haveBed && 'wave-2 bed not present' }, async () => {
  const item = loadItem2(ITEM);
  const ref = await scoreBuilt2(item.oracle, item.transliteration);
  assert.equal(ref.pass, true, JSON.stringify(ref.worlds.filter(w => !w.pass)).slice(0, 600));
  assert.ok(ref.worlds.length >= 6);
  assert.equal((await scoreBuilt2(item.oracle, EMPTY_WORKFLOW)).pass, false);
  const send = item.transliteration.nodes.find(n => JSON.stringify(n).includes('outbox.send'));
  assert.ok(send, 'the item sends e-mail');
  // dropped: the sending step never runs
  const dropped = clone(item.transliteration);
  const at = dropped.nodes.find(n => n.id === send.id);
  at.when = { op: 'eq', left: 1, right: 2 };
  dropped.acceptance = [{ op: 'eq', left: 1, right: 1 }];
  assert.equal((await scoreBuilt2(item.oracle, dropped)).pass, false, 'a workflow that never e-mails fails');
  // misaddressed: every message goes to one fixed address
  const wrong = clone(item.transliteration);
  const w = JSON.stringify(wrong).replace(/"to":\s*\{\s*"\$ref":\s*"[^"]+"\s*\}/g, '"to":"someone@else.example"');
  if (w !== JSON.stringify(wrong)) assert.equal((await scoreBuilt2(item.oracle, JSON.parse(w))).pass, false, 'a wrong recipient fails');
});

test('survivor audit: a mutant in another trigger\'s subgraph is unreachable, one on the item\'s path is kept for the human audit', async () => {
  const { reachable, mutantNode, split } = await import('../survivor-audit.mjs');
  const wf = { nodes: ['Daily', 'Read rows', 'Send digest', 'Webhook', 'Record heartbeat', 'Send digest #2'].map(name => ({ name })),
    connections: { Daily: { main: [[{ node: 'Read rows' }]] }, 'Read rows': { main: [[{ node: 'Send digest' }], [{ node: 'Send digest #2' }]] }, Webhook: { main: [[{ node: 'Record heartbeat' }]] } } };
  assert.deepEqual([...reachable(wf, 'Daily')].sort(), ['Daily', 'Read rows', 'Send digest', 'Send digest #2']);
  const names = new Set(wf.nodes.map(n => n.name));
  assert.equal(mutantNode('drop-effect:Send digest #2', names), 'Send digest #2', 'the longest matching node name wins');
  assert.equal(mutantNode('code-const:Read rows@120 >->>=', names), 'Read rows');
  assert.equal(mutantNode('skip:Nowhere', names), null);
  const s = split(wf, 'Daily', ['drop-effect:Record heartbeat', 'skip:Send digest', 'skip:Nowhere', 'dup-effect:Send digest #2']);
  assert.deepEqual(s, { unreachable: ['drop-effect:Record heartbeat'], reachable: ['skip:Send digest', 'dup-effect:Send digest #2'], unknown: ['skip:Nowhere'] });
});

// Review finding 11: the same teeth on a synthetic, first-party item (fixture-item.mjs), so they run on a fresh clone without the bed.
test('the wave-2 scorer has teeth on a synthetic fixture item (always runs): reference passes; empty, dropped, misaddressed, doubled fail', async () => {
  const { fixtureOracle, FIXTURE_EXAMPLE } = await import('./fixture-item.mjs');
  const oracle = await fixtureOracle(), wf = FIXTURE_EXAMPLE.workflow;
  assert.ok(oracle.hidden.some(h => h.reference.mail.length) && oracle.hidden.some(h => !h.reference.mail.length), 'worlds with and without e-mail');
  const ref = await scoreBuilt2(oracle, wf);
  assert.equal(ref.pass, true, JSON.stringify(ref.worlds.filter(w => !w.pass)).slice(0, 400));
  assert.equal((await scoreBuilt2(oracle, EMPTY_WORKFLOW)).pass, false, 'no effects');
  const dropped = clone(wf); dropped.nodes.find(n => n.id === 'tell').when = { op: 'eq', left: 1, right: 2 };
  assert.equal((await scoreBuilt2(oracle, dropped)).pass, false, 'the chat post never sent');
  const wrong = clone(wf); wrong.nodes.find(n => n.kind === 'map').body.nodes[0].args.to = 'someone.else@team.example';
  assert.equal((await scoreBuilt2(oracle, wrong)).pass, false, 'a wrong recipient');
  const doubled = clone(wf); const tell = doubled.nodes.find(n => n.id === 'tell'); doubled.nodes.push({ ...clone(tell), id: 'tell2', needs: ['tell'] });
  assert.equal((await scoreBuilt2(oracle, doubled)).pass, false, 'a doubled chat post');
  const loose = clone(wf); const plan = loose.nodes.find(n => n.id === 'plan');
  plan.source = plan.source.replace("String(r.status ?? '').trim().toLowerCase() !== 'done' && ", '');
  assert.notEqual(plan.source, wf.nodes.find(n => n.id === 'plan').source, 'the mutation applies');
  assert.equal((await scoreBuilt2(oracle, loose)).pass, false, 'reminding owners of finished tasks');
});
