// The quote- and heredoc-aware command scanner (experiments/swarm/shell-scan.mjs, review fix B1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { shellTokens, scanCommand, simpleCommands } from '../shell-scan.mjs';

test('heredoc bodies, quotes and comments are text, not shell', () => {
  const s = scanCommand("cat > /var/tmp/a.py <<'EOF'\nimport os\nos.system('mkdir /nope; echo x > /nope/f')\nEOF\npython3 /var/tmp/a.py | tee /var/tmp/log # > /var/tmp/not");
  assert.deepEqual(s.redirects, ['/var/tmp/a.py']); assert.deepEqual(s.tee, ['/var/tmp/log']); assert.deepEqual(s.mkdir, []);
  // <<- strips leading tabs from the delimiter line; a quoted delimiter is unquoted
  assert.deepEqual(scanCommand('cat <<-"END" > o1\n\ta > b\n\tEND\necho x > o2').redirects, ['o1', 'o2']);
  // two heredocs on one line
  assert.deepEqual(scanCommand('paste <(cat) - <<A 3<<B > o\na > 1\nA\nb > 2\nB\necho > p').redirects, ['o', 'p']);
});

test('redirections: fd numbers, duplications, process substitution, clobber, append', () => {
  assert.deepEqual(scanCommand('a 2>/dev/null 1>out >|clob >>app &>both &>>both2 2>&1 >&- >(tee x) <in').redirects, ['out', 'clob', 'app', 'both', 'both2']);
  assert.deepEqual(scanCommand('echo a->b').redirects, ['b'], 'unquoted, `->` is a real redirection in shell');
  assert.deepEqual(scanCommand('echo "a->b" \'c->d\' $\'e->f\'').redirects, []);
  assert.deepEqual(scanCommand('echo \\> x').redirects, [], 'an escaped > is a word');
});

test('commands: mkdir, touch, cp/mv targets, cd, prefixes', () => {
  const s = scanCommand('mkdir -p /var/tmp/w/a "/var/tmp/my dir" && touch t1 && cp a b /var/tmp/w/ ; sudo mv x y; nice -n 15 mkdir z; cd /var/tmp/w && ls');
  assert.deepEqual(s.mkdir, ['/var/tmp/w/a', '/var/tmp/my dir', 'z']); assert.deepEqual(s.touch, ['t1']);
  assert.deepEqual(s.copies, ['/var/tmp/w/', 'y']); assert.deepEqual(s.cd, ['/var/tmp/w']);
  assert.deepEqual(simpleCommands(shellTokens('a b > c | d')), [['a', 'b'], ['d']]);
});
