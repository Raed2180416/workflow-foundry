// The capability host: host-owned state of the node-capability layer for one process (ARCHITECTURE.md §2). It qualifies the catalog into
// member records (MCP listings and pins, skills and their manifests, ui.* members, builtins), owns the MCP connections and pin guards, the
// UI sessions, the loaded skills and the run scrub set, and invokes members. Execution authority stays here and in the runtime; nothing
// a model, a server or a skill says changes what this object holds (I2).
import { createDefaultRegistry } from '../capabilities.mjs';
import { validateData } from '../validate.mjs';
import { clone } from '../data.mjs';
import { bindable, entryStatus } from './catalog.mjs';
import { digest, fail, FoundryError } from './common.mjs';
import { ScrubSet, credentialPresent } from './credentials.mjs';
import { McpPool } from './mcp-client.mjs';
import { qualifyMcp, PinGuard, invokeMcp, runCanary, checkMemberSchema } from './import-mcp.mjs';
import { loadSkill, skillMembers, invokeSkill } from './skills.mjs';
import { uiMembers, invokeUi, UiSessions } from './cua.mjs';
import { attestationHashOf, memberRecord } from './members.mjs';
import { programMember, invokeProgram } from './program.mjs';
import { lockMembers } from './resolve.mjs';

/** How an approved member record differs from a live one: null, DEFINITION_CHANGED (pins moved) or LOCK_STALE (view/attestation only). */
export function memberDrift(approved, live) {
  if (approved.implementation === live.implementation) return null;
  const fields = [...(digest(approved.pins) !== digest(live.pins) ? ['pins'] : []), ...(approved.viewHash !== live.viewHash ? ['view'] : []), ...(approved.attestationHash !== live.attestationHash ? ['attestation'] : [])];
  return { code: fields.includes('pins') ? 'DEFINITION_CHANGED' : 'LOCK_STALE', fields: fields.length ? fields : ['implementation'] };
}

export class NodecapHost {
  constructor({ catalog, ledger = null, envelope, env = process.env, keychain, keychainStore = null, chromium = null, scrub = new ScrubSet(), now = Date.now, codeRunner } = {}) {
    Object.assign(this, { catalog, ledger, envelope, env, keychain, keychainStore, scrub, now, codeRunner });
    this.pool = new McpPool(catalog, { scrub, env, keychain, keychainStore, now });
    this.sessions = chromium ? new UiSessions({ chromium, scrub, env, keychain }) : null;
    this.members = new Map(); this.guards = new Map(); this.skills = new Map(); this.failures = []; this.qualified = new Set();
    this.builtins = createDefaultRegistry();
  }
  entry(id) { return this.catalog.entries.find(e => e.id === id) ?? null; }
  member(id) { return this.members.get(id) ?? null; }
  /**
   * Qualify bindable entries. An entry that fails is recorded (and, for drift, quarantined by the ledger) and contributes no members.
   * `only`: the entry ids to qualify (an MCP server outside it is never spawned); programs pull in the entries they use. Default: all.
   */
  async qualify({ canaries = true, only = null } = {}) {
    let wanted = only ? new Set(only) : null;
    if (wanted) for (const entry of this.catalog.entries) if (entry.kind === 'program' && wanted.has(entry.id)) for (const id of entry.uses) wanted.add(id.split('.')[1]);
    // Programs last: a program's members are built from the members it uses, which must have qualified first.
    const ordered = [...this.catalog.entries.filter(e => e.kind !== 'program'), ...this.catalog.entries.filter(e => e.kind === 'program')];
    for (const entry of ordered) {
      if (!bindable(entry, this.ledger) || (wanted && !wanted.has(entry.id)) || this.qualified.has(entry.id)) continue;
      this.qualified.add(entry.id);
      try {
        let members = [];
        if (entry.kind === 'mcp-stdio' || entry.kind === 'mcp-http') {
          const connection = this.pool.get(entry.id), q = await qualifyMcp(entry, connection, { ledger: this.ledger });
          if (canaries) await runCanary(entry, connection, { ledger: this.ledger });
          this.guards.set(entry.id, new PinGuard(entry, connection, { pins: q.pins, tools: q.tools, ledger: this.ledger, now: this.now, verifiedAt: q.listedAt, seenChanges: q.changesBefore, ttlMs: this.envelope?.limits?.relistTtlMs ?? 60000 }));
          members = q.members;
        } else if (entry.kind === 'skill') {
          const skill = loadSkill(entry.source.root, { expectedManifest: entry.manifest ?? null });
          if (skill.stripReceipt) this.ledger?.receipt('skill.strip', skill.stripReceipt);
          this.skills.set(entry.id, skill);
          members = skillMembers(entry, skill);
        } else if (entry.kind === 'cua') members = uiMembers(entry);
        else if (entry.kind === 'program') members = [programMember(entry, this.members)];
        else if (entry.kind === 'builtin') {
          members = Object.entries(entry.members).map(([name, attestation]) => {
            if (!this.builtins.get(attestation.capability)) fail('MEMBER_TOOL_MISSING', `Builtin ${attestation.capability} is not registered`);
            checkMemberSchema(attestation.view.inputSchema, `${entry.id}/${name} view`);
            return memberRecord({ entry, name, id: `builtin.${entry.id}.${name}`, attestation, adapter: 'nodecap-builtin/1', pins: { capability: attestation.capability, handler: this.builtins.get(attestation.capability).handlerHash } });
          });
        }
        for (const member of members) this.members.set(member.id, member);
      } catch (error) {
        if (!(error instanceof FoundryError)) throw error;
        // A server whose code no longer matches its owner-attested integrity pins is quarantined like a definition change (M3, I9).
        if (error.code === 'SOURCE_INTEGRITY') this.ledger?.quarantine(entry.id, 'SOURCE_INTEGRITY', { files: error.details?.files ?? [] });
        this.failures.push({ entry: entry.id, code: error.code });
      }
    }
    return { members: [...this.members.values()], failures: clone(this.failures) };
  }
  /**
   * The entries a construction may need, decided from the owner's attestations BEFORE anything is spawned: MCP entries with an attested
   * member whose type matches a requirement or whose system is in an acquire clause, and every non-MCP entry (no process to start).
   */
  candidateEntries(sidecar, { typeMatch }) {
    const types = Object.values(sidecar.nodes ?? {}).flatMap(n => (n.requires ?? []).map(r => r.type)), systems = new Set(Object.values(sidecar.nodes ?? {}).flatMap(n => n.acquire?.systems ?? []));
    return this.catalog.entries.filter(entry => !entry.kind.startsWith('mcp') || Object.values(entry.members ?? {}).some(a => systems.has(a.system) || types.some(t => typeMatch(a.type, t) > 0))).map(e => e.id);
  }
  /**
   * Catalog tools outside what qualified in this process (T3, quarantined, revoked, imported, failed, or never spawned here): proposal
   * candidates only, never callable, described by the owner's attestation (an unqualified candidate has no implementation yet: binding it
   * qualifies it first, and the person approves its pins with lock N+1).
   */
  outsideCandidates() {
    const out = [];
    for (const entry of this.catalog.entries) {
      if (bindable(entry, this.ledger) && this.qualified.has(entry.id) && !this.failures.some(f => f.entry === entry.id)) continue;
      // An MCP member's record carries the catalog attestation verbatim, so its attestation hash is known before it qualifies (a proposal
      // records it, and lock N+1 binds the member only if it still matches); other kinds derive theirs at qualification (none recorded).
      for (const [name, a] of Object.entries(entry.members ?? {})) out.push({ id: `${entry.kind.startsWith('mcp') ? 'mcp' : entry.kind}.${entry.id}.${name}`, entry: entry.id, tool: name, trust: entry.trust,
        status: entryStatus(entry, this.ledger), type: a.type, system: a.system, objects: a.objects, verbs: a.verbs, effects: a.effects, egress: a.egress, summary: a.view.summary, view: { name: a.view.name, summary: a.view.summary },
        attestationHash: entry.kind.startsWith('mcp') ? attestationHashOf(a) : null });
    }
    return out;
  }
  /**
   * The approved lock against what qualified in THIS process. A member whose pins moved since the person approved the lock is
   * DEFINITION_CHANGED (the entry is quarantined; I9 across processes: the host's own fresh qualification is never the reference); a changed
   * view or attestation with the same pins is LOCK_STALE (the owner edited the catalog: construct a new version); a member that did not
   * qualify is TOOL_ABSENT.
   */
  lockDrift(lock) {
    const problems = [];
    for (const id of lockMembers(lock)) {
      const approved = lock.members[id], live = this.member(id);
      if (!live) { problems.push({ entry: approved.entryId, member: id, code: 'TOOL_ABSENT' }); continue; }
      const drift = memberDrift(approved, live);
      if (!drift) continue;
      problems.push({ entry: approved.entryId, member: id, ...drift });
      if (drift.code === 'DEFINITION_CHANGED') this.ledger?.quarantine(approved.entryId, 'DEFINITION_CHANGED', { member: id, since: 'lock' });
    }
    return problems;
  }
  /** Preflight for a lock: the lock's pins against this process's qualification, a forced re-list of every MCP entry it uses, canaries, credentials. */
  async preflight(memberIds, lock = null) {
    const entries = new Set(memberIds.map(id => this.member(id)?.entryId).filter(Boolean)), problems = lock ? this.lockDrift(lock) : [];
    for (const id of entries) {
      const entry = this.entry(id);
      if (!bindable(entry, this.ledger)) { problems.push({ entry: id, code: 'CAPABILITY_QUARANTINED' }); continue; }
      try {
        if (this.guards.has(id)) { await this.guards.get(id).check({ force: true }); await runCanary(entry, this.pool.get(id), { ledger: this.ledger }); }
        const credential = entry.credential ?? (entry.connection ? this.entry(entry.connection)?.credential : null);
        for (const ref of [credential?.read, credential?.write, entry.login?.user, entry.login?.password].filter(Boolean)) {
          const custody = credential?.custody ?? (ref.env ? 'C0' : 'C1');
          if (!(await credentialPresent(ref, { custody, scrub: this.scrub, env: this.env, keychain: this.keychain }))) problems.push({ entry: id, code: 'CREDENTIAL_MISSING' });
        }
      } catch (error) { if (!(error instanceof FoundryError)) throw error; problems.push({ entry: id, code: error.code }); }
    }
    return { ok: problems.length === 0, problems };
  }
  /** Invoke one member. `ctx`: { runId, node, signal, idempotencyKey, artifactsDir, practice }. Output validated against the attestation. */
  async invoke(memberId, args, ctx = {}) {
    const member = this.member(memberId);
    if (!member) fail('TOOL_ABSENT', `No qualified member ${memberId}`);
    const entry = this.entry(member.entryId);
    if (!bindable(entry, this.ledger)) fail('CAPABILITY_QUARANTINED', `${member.entryId} is not active`);
    // The approved record (from the lock) must be the one that qualified here, before anything is sent.
    if (ctx.approved) {
      const drift = memberDrift(ctx.approved, member);
      if (drift) {
        if (drift.code === 'DEFINITION_CHANGED') this.ledger?.quarantine(member.entryId, 'DEFINITION_CHANGED', { member: member.id, since: 'lock' });
        fail(drift.code, `${member.id} no longer matches the approved lock (${drift.fields.join(', ')}); the call was not sent`, { member: member.id, fields: drift.fields });
      }
    }
    validateData(member.view.inputSchema, args, `${member.id} arguments`);
    // Practice never reaches the real world: effects are simulated, and a computer-use member (whose page loads are requests to the real
    // origin, whatever its effect class) is not run at all.
    if (ctx.practice && (member.effects !== 'none' || member.kind === 'cua')) return { practice: true, member: member.id, wouldCall: true };
    let out;
    if (member.kind === 'mcp-stdio' || member.kind === 'mcp-http') out = await invokeMcp(member, { connection: this.pool.get(entry.id), guard: this.guards.get(entry.id) }, args, ctx);
    else if (member.kind === 'skill') out = await invokeSkill(member, this.skills.get(entry.id), args, { signal: ctx.signal, ...(this.codeRunner ? { codeRunner: this.codeRunner } : {}) });
    else if (member.kind === 'cua') {
      if (!this.sessions) fail('UI_BACKEND_UNAVAILABLE', 'This host was created without a browser backend');
      out = await invokeUi(member, this.sessions, args, { runId: ctx.runId, node: ctx.node, entry, artifactsDir: ctx.artifactsDir });
    } else if (member.kind === 'builtin') out = await this.builtins.execute(member.capability, args, ctx);
    else if (member.kind === 'program') out = (await invokeProgram(member, entry, args, { signal: ctx.signal, invoke: (id, inner) => this.invoke(id, inner, { ...ctx, approved: null }) })).value;
    else fail('MEMBER_KIND', `Unsupported member kind ${member.kind}`);
    validateData(member.outputSchema, out, `${member.id} output`);
    return out;
  }
  /** The host's rendering of a held UI request of an existing session (what a person approves for ui.commit); null when there is none. */
  async heldRequest({ runId, node, entryId, id }) {
    const entry = this.entry(entryId);
    return this.sessions && entry && typeof id === 'string' ? this.sessions.held({ runId, node, entry, id }) : null;
  }
  async closeRun(runId) { await this.sessions?.closeRun(runId); }
  async close() { await this.sessions?.close(); await this.pool.close(); }
}
