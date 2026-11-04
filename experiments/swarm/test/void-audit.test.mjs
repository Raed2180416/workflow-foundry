// Amendment 2 void audit (experiments/swarm/void-audit.mjs): sandbox-private scratch is benign, a real reach outside is not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditSession, voidUnderAmendment2, CLI_SPILL_RE, createsPath } from '../void-audit.mjs';

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
