// Amendment 2 void audit (experiments/swarm/void-audit.mjs): sandbox-private scratch is benign, a real reach outside is not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditSession, voidUnderAmendment2, CLI_SPILL_RE, createsPath, under, createdBy } from '../void-audit.mjs';

const WD = '/var/tmp/foundry-work/swarm-r1/work/swarm-r1-heldout/A-agent-haiku/wbed-r6_test_d5_s9301_t0';
const bash = command => ({ name: 'Bash', input: { command } });

test('self-created scratch, CLI spill files and the workdir\'s parent are benign; nothing voids', () => {
  const uses = [
    bash('mkdir -p /var/tmp/work && cat > /var/tmp/work/extract.py << \'EOF\'\nprint(1)\nEOF'),
    bash('python3 /var/tmp/work/extract.py > /var/tmp/work/hits.txt'),
    bash('grep -c x /var/tmp/work/hits.txt'),
    bash('ls files/corpus | head > /var/tmp/foundry-work/hdr.txt'),
    bash('cd /var/tmp/foundry-work && cut -d"|" -f2 hdr.txt'),
    { name: 'Read', input: { file_path: '/root/.claude/projects/-var-tmp-foundry-work-x/0c9dfeca-4f9b-495e-8bcb-77eec746c46d/tool-results/bg1czhlxj.txt' } },
  ];
  const a = auditSession(uses, { workdir: WD });
  assert.ok(a.length >= 4, JSON.stringify(a));
  assert.deepEqual(a.filter(x => x.kind === 'other'), []);
  assert.ok(a.some(x => x.kind === 'cli-spill')); assert.ok(a.some(x => x.kind === 'workdir-ancestor')); assert.ok(a.some(x => x.kind === 'self-created'));
  assert.equal(voidUnderAmendment2({ audit: a }), false);
});

test('reading another session\'s workdir or a host file is `other` and voids; drift and repository mentions void', () => {
  const uses = [bash('cat /var/tmp/foundry-work/swarm-r1/work/swarm-r1-heldout/S-swarm-haiku/wbed-r6_test_d5_s9301_t0/answer.json'), { name: 'Read', input: { file_path: '/etc/passwd' } }];
  const a = auditSession(uses, { workdir: WD });
  assert.equal(a.filter(x => x.kind === 'other').length, 2, JSON.stringify(a));
  assert.equal(voidUnderAmendment2({ audit: a }), true);
  // read first, written later: still a real attempt
  const late = auditSession([bash('cat /var/tmp/notes.txt'), bash('echo hi > /var/tmp/notes.txt')], { workdir: WD });
  assert.deepEqual(late.map(x => x.kind), ['other']);
  assert.equal(voidUnderAmendment2({ drift: ['claude-opus-5-5'] }), true);
  assert.equal(voidUnderAmendment2({ repoPathMentions: 1 }), true);
});

test('spill pattern and createsPath are strict', () => {
  assert.ok(!CLI_SPILL_RE.test('/root/.claude/projects/x/not-a-uuid/tool-results/a.txt'));
  assert.ok(!CLI_SPILL_RE.test('/root/.claude/.credentials.json'));
  assert.equal(createsPath(bash('mkdir -p /var/tmp/a/b'), '/var/tmp/a/b'), true);
  assert.equal(createsPath(bash('cat /var/tmp/a/b'), '/var/tmp/a/b'), false);
  assert.equal(createsPath({ name: 'Write', input: { file_path: '/var/tmp/a/b/c.py' } }, '/var/tmp/a/b'), true);
});

// Review fix B1 (2026-11-04): fake write targets must not make every path "self-created".
const OTHER = '/var/tmp/foundry-work/swarm-r1/work/swarm-r1-heldout/S-swarm-haiku/wbed-r6_test_d5_s9301_t0/answer.json';
test('B1: an arrow or an empty redirection target before a real reach does not hide it', () => {
  for (const first of ['python3 - <<\'EOF\'\nprint("a ->", x)\nEOF', 'grep -c -- "->" /var/tmp/w/out.txt', 'python3 x.py > \'\'', 'echo "a => b"; awk \'$1 > $2\' f']) {
    const a = auditSession([bash(first), bash(`cat ${OTHER}`), { name: 'Read', input: { file_path: '/etc/passwd' } }], { workdir: WD });
    assert.deepEqual(a.filter(x => x.path === OTHER || x.path === '/etc/passwd').map(x => x.kind), ['other', 'other'], `${first}: ${JSON.stringify(a)}`);
    assert.equal(voidUnderAmendment2({ audit: a }), true);
  }
});

test('B1: under() refuses an empty, root or relative ancestor; creation needs a whole path', () => {
  assert.equal(under('/etc/passwd', ''), false); assert.equal(under('/etc/passwd', '/'), false); assert.equal(under('/etc/passwd', 'etc'), false);
  assert.equal(under('/var/tmp/a/b', '/var/tmp/a'), true); assert.equal(under('/var/tmp/ab', '/var/tmp/a'), false); assert.equal(under('/var/tmp/a/', '/var/tmp/a'), true);
  // minor 3: a file named notes.txt does not create a directory /var/tmp/notes
  assert.equal(createsPath(bash('echo hi > /var/tmp/notes.txt'), '/var/tmp/notes'), false);
  assert.equal(createsPath(bash('mkdir -p /var/tmp/notes.d'), '/var/tmp/notes'), false);
  assert.equal(createsPath(bash('mkdir -p "/var/tmp/my dir"/sub'), '/var/tmp/my dir'), true);
  assert.equal(createsPath(bash('cd /var/tmp/w && python3 x.py > out.txt'), '/var/tmp/w/out.txt'), true, 'a relative target after an absolute cd');
  assert.deepEqual(createdBy(bash('cp a.py b.py /var/tmp/k/ && touch /var/tmp/t.txt')).sort(), ['/var/tmp/k/', '/var/tmp/t.txt']);
  // a path named inside a heredoc body is not created by it
  assert.equal(createsPath(bash("python3 - <<'EOF'\nopen('/var/tmp/z.txt','w')  # > /var/tmp/z.txt\nEOF"), '/var/tmp/z.txt'), false);
});

test('Amendment 3: a cd into a path that does not exist is `failed-cd`; anything more stays `other`', () => {
  const none = () => false, all = () => true;
  const cd = [bash('cd /var/foundry-work 2>/dev/null; cd ' + WD + ' && ls')];
  assert.deepEqual(auditSession(cd, { workdir: WD, amendment3: true, exists: none }).map(x => x.kind), ['failed-cd']);
  assert.deepEqual(auditSession(cd, { workdir: WD, amendment3: false, exists: none }).map(x => x.kind), ['other'], 'Amendment 2 as written');
  assert.deepEqual(auditSession(cd, { workdir: WD, amendment3: true, exists: all }).map(x => x.kind), ['other'], 'the path exists: the cd may have worked');
  const ls = [bash('cd /var/foundry-work && ls /var/foundry-work')];
  assert.deepEqual(auditSession(ls, { workdir: WD, amendment3: true, exists: none }).map(x => x.kind), ['other'], 'also listed');
  const tmp = [bash('cd /var/tmp/elsewhere')];
  assert.deepEqual(auditSession(tmp, { workdir: WD, amendment3: true, exists: none }).map(x => x.kind), ['other'], 'a private tmpfs: host existence says nothing');
  assert.equal(voidUnderAmendment2({ audit: [{ path: '/x', kind: 'failed-cd' }] }), false);
});
