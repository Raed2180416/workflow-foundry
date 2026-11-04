// The person channel (src/capabilities/person.mjs; review finding M1). A widening decision or an effect approval is a PersonDecision: an
// object only a person channel mints, bound to one subject digest, used once, from a channel the ledger accepts. The CLI channel reads
// the controlling terminal (never stdin) and needs the one-time code it printed with the subject; it is exercised here on a real
// pseudo-terminal driven by a helper process. $0, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { acceptPerson, isPersonDecision, scriptedPerson, subjectOf, ttyPerson } from '../src/capabilities/person.mjs';
import { NodecapLedger } from '../src/capabilities/ledger.mjs';
import { workspace } from './support/nodecap.mjs';

const code = expected => error => { assert.equal(error.code, expected, `${error.code}: ${error.message}`); return true; };
const subject = subjectOf({ kind: 'test', n: 1 }), other = subjectOf({ kind: 'test', n: 2 });

test('person: only a minted decision counts; a hand-built, cloned or deserialized one does not', () => {
  const person = scriptedPerson('t'), decision = person(subject, true);
  assert.equal(isPersonDecision(decision), true);
  for (const forged of [{ ...decision }, JSON.parse(JSON.stringify(decision)), structuredClone(decision), { channel: 'cli', approve: true, subject, principal: { kind: 'os-user' } }, 'cli', null])
    assert.equal(isPersonDecision(forged), false);
  assert.throws(() => acceptPerson({ ...decision }, subject, { channels: ['scripted'] }), code('APPROVAL_CHANNEL_INSUFFICIENT'));
  assert.throws(() => decision.approve = false, TypeError, 'a decision is frozen');
});

test('person: a decision is bound to one subject, used once, and only from a channel the ledger accepts', t => {
  const person = scriptedPerson('t');
  assert.throws(() => acceptPerson(person(subject, true), other, { channels: ['scripted'] }), code('PERSON_SUBJECT_MISMATCH'));
  const once = person(subject, true);
  assert.deepEqual(acceptPerson(once, subject, { channels: ['scripted'] }).approve, true);
  assert.throws(() => acceptPerson(once, subject, { channels: ['scripted'] }), code('PERSON_DECISION_REUSED'));
  // A production ledger (default channels: cli, dashboard) refuses the beds' scripted person; the record of an accepted one says 'scripted'.
  const dir = workspace(t), production = new NodecapLedger(dir), bed = new NodecapLedger(dir, { channels: ['scripted'] });
  t.after(() => { production.close(); bed.close(); });
  const parts = { workflowHash: 'a'.repeat(64), lockHash: `sha256:${'b'.repeat(64)}`, envelopeDigest: 'e', catalogDigest: 'c', dryRunId: null };
  assert.throws(() => production.approveLock(parts, { person: person(NodecapLedger.subject(parts), true) }), code('APPROVAL_CHANNEL_INSUFFICIENT'));
  assert.equal(production.lockApproval(parts), null);
  bed.approveLock(parts, { person: person(NodecapLedger.subject(parts), true) });
  assert.equal(bed.lockApproval(parts).channel, 'scripted', 'no bed result can report a scripted decision as a person on the CLI');
  assert.equal(production.lockApproval(parts), null, 'a production ledger does not honour a scripted approval written to the same file');
  assert.throws(() => new NodecapLedger(dir, { channels: ['mcp-elicitation'] }), code('LEDGER_CHANNELS'));
});

test('person: the CLI channel needs a terminal; a pipe, a file or no terminal mints nothing', () => {
  for (const ttyPath of ['/dev/null', '/nonexistent/tty']) assert.throws(() => ttyPerson({ subject, summary: 'x', ttyPath }), code('PERSON_CHANNEL_UNAVAILABLE'));
});

/** A helper process that owns a pseudo-terminal: it prints the terminal's path, waits for the prompt, answers it, and reports what it saw. */
const PTY = `
import os, pty, re, select, sys, time
mode = sys.argv[1]
master, slave = pty.openpty()
print(os.ttyname(slave), flush=True)
seen, deadline = b'', time.time() + 20
while time.time() < deadline:
    if select.select([master], [], [], 0.2)[0]:
        seen += os.read(master, 4096)
        m = re.search(rb'Type "approve ([A-Z0-9]{6})"', seen)
        if m:
            answer = {'approve': b'approve ' + m.group(1), 'decline': b'decline', 'wrong': b'approve ' + bytes(reversed(m.group(1))), 'other-code': b'approve ZZZZZZ'}[mode]
            os.write(master, answer + b'\\n')
            break
time.sleep(0.5)
print(seen.hex(), flush=True)
`;
async function onPty(mode, ask) {
  const child = spawn('python3', ['-I', '-c', PTY, mode], { stdio: ['ignore', 'pipe', 'inherit'] }), lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  try {
    const ttyPath = (await lines.next()).value;
    let result, error;
    try { result = ask(ttyPath); } catch (e) { error = e; }
    const seen = Buffer.from((await lines.next()).value ?? '', 'hex').toString('utf8');
    return { result, error, seen };
  } finally { child.kill(); }
}

test('person: on a terminal, the person sees the host rendering and approves with the one-time code; anything else decides nothing', { skip: process.platform !== 'linux' && 'pty helper is Linux-only' }, async () => {
  const summary = 'Approve tickets_add_comment on ticket 42\x1b[2J\x1b[H(an escape sequence in quoted data)';
  const approved = await onPty('approve', ttyPath => ttyPerson({ subject, summary, ttyPath }));
  assert.equal(approved.error, undefined, String(approved.error));
  assert.equal(isPersonDecision(approved.result), true);
  assert.deepEqual([approved.result.channel, approved.result.approve, approved.result.subject, approved.result.principal.kind, approved.result.principal.uid], ['cli', true, subject, 'os-user', process.getuid()]);
  assert.match(approved.seen, /Approve tickets_add_comment on ticket 42\?\[2J\?\[H/, 'control characters in the rendering are neutralised');
  assert.ok(approved.seen.includes(subject), 'the subject digest is shown with the code');
  const declined = await onPty('decline', ttyPath => ttyPerson({ subject, summary: 'x', ttyPath }));
  assert.deepEqual([declined.result.channel, declined.result.approve], ['cli', false]);
  for (const mode of ['wrong', 'other-code']) {
    const refused = await onPty(mode, ttyPath => ttyPerson({ subject, summary: 'x', ttyPath }));
    assert.equal(refused.result, undefined);
    assert.equal(refused.error?.code, 'PERSON_INPUT_INVALID', mode);
  }
});
