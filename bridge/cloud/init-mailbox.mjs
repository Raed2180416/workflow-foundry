#!/usr/bin/env node
// Creates (or updates) the mailbox branch: an orphan branch holding only bridge-state/ (README and
// trusted public keys). Run by the orchestrator once, after `cli.mjs keygen`.
//
//   node bridge/cloud/init-mailbox.mjs [--pub ~/.foundry-bridge/cloud-ed25519.pub] [--label cloud]
//        [--remote URL] [--branch foundry-bridge] [--dry-run]
//   node bridge/cloud/init-mailbox.mjs --revoke <key-id>     remove a trusted key
//   node bridge/cloud/init-mailbox.mjs --kill | --unkill     set / clear the kill switch (bridge-state/KILL)
//
// Never force-pushes. Prints only public material.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { keyId, publicKeyPem, toPublicKey } from '../common/protocol.mjs';
import { DEFAULT_BRANCH, DEFAULT_MAILBOX_DIR, LABEL_RE, Mailbox, initMailbox } from '../mailbox.mjs';
import { BRIDGE_HOME, DEFAULT_KEY_PATH, defaultRemote, loadKey } from './client.mjs';

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (['--dry-run', '--kill', '--unkill'].includes(a)) o[a.slice(2)] = true;
    else if (['--pub', '--label', '--remote', '--branch', '--revoke', '--mailbox'].includes(a)) { o[a.slice(2)] = argv[++i]; if (o[a.slice(2)] === undefined) throw new Error(`${a} needs a value`); }
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

function publicKeyFrom(o) {
  const pub = o.pub ?? path.join(BRIDGE_HOME, 'cloud-ed25519.pub');
  if (fs.existsSync(pub)) return toPublicKey(fs.readFileSync(pub, 'utf8'));
  if (!o.pub && fs.existsSync(DEFAULT_KEY_PATH)) return loadKey(DEFAULT_KEY_PATH).publicKey;
  throw new Error(`no public key at ${pub}; run: node bridge/cloud/cli.mjs keygen`);
}

async function main() {
  const o = args(process.argv.slice(2));
  const remote = o.remote ?? await defaultRemote();
  const branch = o.branch ?? process.env.FOUNDRY_BRIDGE_BRANCH ?? DEFAULT_BRANCH;
  const mailboxDir = o.mailbox ?? process.env.FOUNDRY_BRIDGE_MAILBOX ?? DEFAULT_MAILBOX_DIR;
  if (o.kill || o.unkill || o.revoke) {
    const mb = new Mailbox({ dir: mailboxDir, remote, branch });
    const r = o.revoke ? await mb.revokeKey(o.revoke) : await mb.setKill(!!o.kill);
    console.log(JSON.stringify({ action: o.revoke ? `revoke ${o.revoke}` : o.kill ? 'kill' : 'unkill', branch, ...r }, null, 2));
    if (!r.pushed) console.log('(nothing changed)');
    return;
  }
  const label = o.label ?? 'cloud';
  if (!LABEL_RE.test(label)) throw new Error(`--label must match ${LABEL_RE}`);
  const publicKey = publicKeyFrom(o);
  const id = keyId(publicKey);
  try {
    const r = await initMailbox({ remote, branch, keys: [{ label, pem: publicKeyPem(publicKey) }], dryRun: !!o['dry-run'], scratch: os.tmpdir() });
    console.log(JSON.stringify({ remote: remote.replace(/\/\/[^@/]*@/, '//<redacted>@'), ...r }, null, 2));
    console.log(o['dry-run'] ? 'dry run: nothing pushed' : `mailbox ${branch} ready; trusted key ${id}`);
  } catch (error) {
    console.error(`init-mailbox failed: ${error.message}`);
    console.error([
      '',
      'If the push was refused (this cloud session may only be allowed to push its own working branch),',
      'the laptop operator can create the branch with their own credentials instead. On the laptop, run:',
      `  node bridge/cloud/init-mailbox.mjs --pub <file> --label ${label}`,
      'where <file> holds this PUBLIC key (safe to share):',
      '',
      publicKeyPem(publicKey).trim(),
      ''
    ].join('\n'));
    process.exit(1);
  }
}

main().catch(error => { console.error(`error: ${error.message}`); process.exit(error.message.startsWith('unknown argument') ? 2 : 1); });
