#!/usr/bin/env node
// $0 replay of the harness/v3 commit gate (ATTACK §6 Move 2, step (b): "replay-gate --lint with Move 1's dispositions")
// over the STORED calls.jsonl of the six dev60 arms. DEVELOPER TOOL: development / diagnostic evidence, devTrain dev60
// only. Δ* is built exactly as in dstar-replay.mjs (request, inventory, stored reader outputs); grades are read only to
// score the refusals afterwards.
//
//   node experiments/autobench/replay/gate-replay.mjs --vlab <lab dir> --rl2 <rl2 extract.jsonl> --out <file> [--tasks a,b] [--identity v1|v2]
//
// Every call of every stored session is offered to a fresh gate in recorded order (inventory reads, acting, checks,
// repairs), twice: in ADMIT mode (unexplained writes admitted, the mode the kill clause is about) and in HOLD mode (the
// gate's default since v3-gate-v2: unexplained and unreadable writes held). A refused or held write is counted, not
// simulated further (a live actor would change it).
// Scoring (ATTACK's thresholds applied verbatim in summarizeGate(); replay v3, review of 2026-11-04):
//   arms             the preregistered verdict uses ATTACK's FIVE dev60 arms; the six-arm count (with m3-a1c) is reported
//                    beside it as a sensitivity line;
//   true refusal     a P refusal in a failing world whose refused call is a MESSAGE to the broken guardrail's recipient,
//                    or in its channel (the call's channel resolved through the enumerated channel list), that names the
//                    guardrail's literal; a refused call with no channel never aligns with a channel guardrail (v2
//                    aligned it, which counted a refused row append as a mention break: review finding 1);
//   false refusal    each P refusal in a passing world, and each registry (K) refusal there of DIFFERENT content than the
//                    write it collides with (a conflated key); counted per REFUSAL, not per world (finding 16); a K
//                    refusal of the same content is a stopped duplicate;
//   mention breaks   the 12 message-mention breaks of the haiku-a1c arm (slack_message_not_in_channel and
//                    gmail_message_sent_to_with_body_not_contains, the latent-requirements sweep's class);
//   duplicates       tasks per arm with diff-level duplicates (created records sharing an identityOfCreated key) before
//                    the gate, and after it: a duplicate is removed when a write carrying its text was refused
//                    (attributeDuplicates; an unattributed duplicate stays); the v1 loose-key count is kept beside it;
//   unexplained      admitted writes that discharge no Δ* obligation, in passing vs failing worlds (the kill clause);
//   holds            in hold mode, held writes and passing worlds with a hold, by reason (unexplained, unreadable);
//   witnesses        certificates whose read-back spec the world's own changes (the stored diff, an end-of-run read-back)
//                    confirm (gate.mjs witnessHolds), against all certificates.
// Replay v2 added the K split, the duplicate and unexplained clauses to the verdict, and --identity v1|v2.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGate, witnessHolds, writeSucceeded } from '../harness/v3/gate.mjs';
import { identityOf, identityOfV1, identityOfCreated, normText, EFFECTS_SHA256, REGISTRY_VERSION } from '../harness/v3/registry.mjs';
import { ARMS, FIVE_ARMS, SOURCES, buildFor } from './dstar-replay.mjs';
import { brokenGuardrails, readGrade, scaffoldNegatives, MENTION_TYPES_PREREG } from './dstar-score.mjs';
import { universesFromInventory } from '../verifier/requirement-ledger-v3/universe.mjs';

// the gate's ceiling: a pseudo-Δ* whose prohibitions are the oracle-implied closure checks (scoring scaffold only)
export const GATE_SOURCES = Object.freeze([...SOURCES, 'scaffold']);
function scaffoldDstar(rows) {
  const a1c = rows.find(r => r.arm === 'haiku-a1c');
  const universes = universesFromInventory(JSON.parse(readFileSync(`${a1c.source.host}/pipeline/inventory.json`, 'utf8')));
  const S = scaffoldNegatives(readGrade(a1c.source.host), universes).filter(x => x.check);
  return { assertions: S.map((x, i) => ({ id: `S${i}`, polarity: 'must_not', status: 'hard', origin: 'scaffold', check: x.check })) };
}
import { containsLiteral, norm } from '../verifier/requirement-ledger-v3/lib.mjs';

// ATTACK §6 Move 2, verbatim thresholds (replay)
export const MOVE2 = Object.freeze({ mentionRefused: 6, ofMention: 12, distinctTasks: 3, maxFalseRefusals: 1, duplicatesAfterPerArm: 2, duplicatesBeforePerArm: 13 });

const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

/** Replay one stored session through a fresh gate (diff: the world's own changes, for the witness read-back). */
export function replaySession(dstar, hostDir, { holdUnexplained = false, identity = identityOf, universes = null, diff = null } = {}) {
  const gate = createGate({ dstar, holdUnexplained, identity, universes });
  const steps = readJsonl(`${hostDir}/calls.jsonl`);
  const out = { writes: 0, admitted: 0, refusedP: [], refusedK: 0, refusedKSame: 0, refusedKDiffers: 0, kDiffers: [], refusedLoose: new Set(), held: 0, heldUnexplained: 0, heldUnreadable: 0, heldReasons: {}, unexplained: 0, unexplainedAdmitted: 0, undecodable: 0, certificates: 0, witnessed: 0, writeLog: [] };
  const firstText = new Map();
  const content = f => normText(f.text);
  for (const s of steps) for (const [ci, call] of (s.calls ?? []).entries()) {
    const d = gate.check(call);
    if (d.action === 'admit') { const ok = writeSucceeded(s.results?.[ci]); gate.settle(d, ok); if (ok && !firstText.has(d.key)) firstText.set(d.key, content(d.facts)); }
    if (d.action === 'read') continue;
    if (d.action === 'hold' && d.undecodable) {
      // a call the gate cannot read (unknown tool, unparseable arguments, undecodable write): held, not a write it saw
      out.undecodable++; out.held++; out.heldUnreadable++;
      const r = String(d.reason ?? '').replace(/".*"/, '"*"').slice(0, 60); out.heldReasons[r] = (out.heldReasons[r] ?? 0) + 1;
      continue;
    }
    out.writes++;
    out.writeLog.push({ app: d.facts.app, effect: d.facts.effect, text: lh(d.facts.text), refused: d.action === 'refuse', by: d.action === 'refuse' ? (d.violations.length ? 'P' : 'K') : null });
    if (d.unexplained) out.unexplained++;
    if (d.action === 'admit') { out.admitted++; if (d.certificate) { out.certificates++; if (diff && witnessHolds(d.certificate.witness, diff)) out.witnessed++; } if (d.unexplained) out.unexplainedAdmitted++; }
    if (d.action === 'hold') { out.held++; out.heldUnexplained++; }
    if (d.action === 'refuse') {
      if (d.violations.length) out.refusedP.push({ step: s.step, op: d.facts.op, channelKind: d.facts.channelKind ?? null, recipients: d.facts.recipients.slice(0, 4), channels: d.facts.channels.slice(0, 2),
        text: d.facts.text.slice(0, 4000), why: d.violations.map(v => v.why), origins: [...new Set(d.violations.map(v => v.rule.origin))], kinds: [...new Set(d.violations.map(v => v.rule.kind))], duplicate: d.duplicate });
      else {
        out.refusedK++;
        const lk = looseKeyOfCall(d.facts); if (lk) out.refusedLoose.add(lk);
        // a re-send of the same content, or a key that conflates two different effects (a false duplicate)?
        if (firstText.get(d.key) === content(d.facts)) out.refusedKSame++;
        else { out.refusedKDiffers++; if (out.kDiffers.length < 3) out.kDiffers.push({ op: d.facts.op, key: d.key.slice(0, 100) }); }
      }
    }
  }
  return out;
}

const MESSAGE_KINDS = new Set(['email', 'chat', 'dm', 'sms', 'social', 'reply', 'esign']);
/** The enumerated channels of a task: [{id, name}] from channel collections and from the containers of channel messages. */
export function channelList(universes) {
  const out = [];
  for (const u of universes ?? []) {
    if (u.app !== 'slack') continue;
    if (/channel/.test(u.kind)) for (const m of u.members) out.push({ id: String(m.attrs?.id ?? m.id ?? ''), name: String(m.attrs?.name ?? m.label ?? '') });
    else if (u.container) out.push({ id: String(u.container), name: String(u.title ?? '').replace(/^#/, '') });
  }
  return out;
}
const channelForms = (c, list) => {
  const n = norm(String(c ?? '').replace(/^#/, ''));
  if (!n) return new Set();
  const hit = list.filter(x => norm(x.id) === n || norm(x.name) === n);
  return new Set([n, ...hit.flatMap(x => [norm(x.id), norm(x.name)])].filter(Boolean));
};

/** Does a refused call carry a broken guardrail? It must be a MESSAGE to the guardrail's recipient or in its channel (the
 *  call's own channel, resolved through the enumerated channel list), and name the guardrail's literal. A guardrail
 *  without a recipient or channel aligns with any refused call that names its literal. */
export function refusalAligns(ref, g, { channels = [] } = {}) {
  if (g.to || g.channel) {
    if (!MESSAGE_KINDS.has(ref.channelKind)) return false;
    if (g.to && !ref.recipients.includes(String(g.to).toLowerCase())) return false;
    if (!g.to && g.channel) {
      const want = channelForms(g.channel, channels);
      if (!ref.channels.some(c => [...channelForms(c, channels)].some(x => want.has(x)))) return false;
    }
  }
  return g.lits.some(l => l.length >= 2 && (containsLiteral(ref.text, l) || norm(ref.text).includes(norm(l))));
}

/** Diff-level duplicates (the verifier lab's definition: two created records with the same key fields). */
export function diffDuplicates(diff) {
  const seen = new Map();
  let dups = 0;
  for (const c of diff?.changes ?? []) {
    if (c.op !== 'created') continue;
    const k = identityOfCreated(c);
    if (seen.has(k)) dups++; else seen.set(k, true);
  }
  return dups;
}

// A loose key that a planned write and the record it created share (to tell which diff duplicates the registry refused):
// e-mail by recipients and subject, chat by text, a sheet row by its cell values, another record by its name.
const lh = s => normText(s).replace(/[^a-z0-9@.$%]+/g, ' ').trim();
export function looseKeyOfCall(f) {
  if (!f) return null;
  if (f.channelKind === 'email') return `email|${[...f.recipients].sort().join(',')}|${lh(f.subject)}`;
  if (['chat', 'dm', 'sms', 'social', 'reply', 'note'].includes(f.channelKind)) return `msg|${lh(f.text).slice(0, 400)}`;
  if (f.app === 'google_sheets' && f.effect === 'create') { const v = f.body?.values ?? []; return `row|${lh(v.flat().join('|'))}`; }
  if (f.effect === 'create') return `create|${f.app}|${lh(f.name || f.text).slice(0, 200)}`;
  return null;
}
export function looseKeyOfCreated(c) {
  const r = c.record ?? {};
  if (c.app === 'gmail' && c.coll === 'messages') return `email|${emailsInText(JSON.stringify([r.to, r.cc, r.bcc].filter(Boolean))).sort().join(',')}|${lh(r.subject)}`;
  if (c.app === 'slack' || /message|note|repl/i.test(c.coll)) return `msg|${lh(r.text ?? r.body ?? '').slice(0, 400)}`;
  if (c.app === 'google_sheets' && c.coll === 'rows') return `row|${lh(Object.values(r.cells ?? {}).join('|'))}`;
  return `create|${c.app}|${lh(r.name ?? r.title ?? r.summary ?? r.subject ?? '').slice(0, 200)}`;
}
const emailsInText = s => [...new Set((String(s ?? '').toLowerCase().match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []))];
/** Diff duplicates the registry did NOT prevent: duplicate created records whose loose key no refused write carries. */
export function residualDuplicates(diff, refusedLoose) {
  const seen = new Set();
  let residual = 0;
  for (const c of diff?.changes ?? []) {
    if (c.op !== 'created') continue;
    const k = identityOfCreated(c);
    if (!seen.has(k)) { seen.add(k); continue; }
    if (!refusedLoose.has(looseKeyOfCreated(c))) residual++;
  }
  return residual;
}

/** Diff-level duplicates the gate prevented, attributed by content: for each group of created records that share an
 *  identityOfCreated key, the writes of the same app whose text carries the records' distinguishing text are the writes
 *  that made them; every one of those writes the gate refused removes one duplicate. -> {duplicates, prevented,
 *  residual, unattributed} (an unattributed duplicate counts as residual) */
export function attributeDuplicates(diff, writeLog) {
  const groups = new Map();
  for (const c of diff?.changes ?? []) {
    if (c.op !== 'created') continue;
    const k = identityOfCreated(c);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  let duplicates = 0, prevented = 0, unattributed = 0;
  for (const cs of groups.values()) {
    if (cs.length < 2) continue;
    duplicates += cs.length - 1;
    const t = distinguishing(cs[0]);
    const writes = t ? writeLog.filter(w => w.app === cs[0].app && ['create', 'send'].includes(w.effect) && w.text.includes(t)) : [];
    if (!writes.length) { unattributed += cs.length - 1; continue; }
    prevented += Math.min(cs.length - 1, writes.filter(w => w.refused).length);
  }
  return { duplicates, prevented, residual: duplicates - prevented, unattributed };
}
function distinguishing(c) {
  const r = c.record ?? {}, p = r.params ?? {};
  const v = [r.subject, r.name, r.title, r.summary, p.summary, p.name, p.title, p.subject, r.text, p.text, r.body, p.body, r.body_plain, ...Object.values(r.cells ?? {})].find(x => typeof x === 'string' && lh(x).length >= 6);
  return v ? lh(v).slice(0, 60) : null;
}

/** The Move 2 counts over a set of arms (passing worlds: false refusals per refusal; duplicates per arm; unexplained). */
function gateStats(rows, arms) {
  const all = rows.flatMap(r => arms.filter(a => r.arms[a]).map(a => ({ task: r.task, arm: a, ...r.arms[a] })));
  const passing = all.filter(x => x.passed), failing = all.filter(x => !x.passed);
  const falseRefusalWorlds = passing.filter(x => x.refusedP > 0 || (x.refusedKDiffers ?? 0) > 0);
  const dupAfterAttributed = arm => all.filter(x => x.arm === arm && x.dupAttribution && x.dupAttribution.residual > 0).length;
  const sum = (xs, k) => xs.reduce((n, x) => n + (x[k] ?? 0), 0);
  return {
    all, passing, failing, falseRefusalWorlds,
    falseRefusalsP: sum(passing, 'refusedP'), falseRefusalsK: sum(passing, 'refusedKDiffers'),
    falseRefusals: sum(passing, 'refusedP') + sum(passing, 'refusedKDiffers'),
    maxDupAfter: Math.max(...arms.map(dupAfterAttributed)), dupAfterAttributed,
    unexplainedAdmittedPassing: sum(passing, 'unexplainedAdmitted'), unexplainedAdmittedFailing: sum(failing, 'unexplainedAdmitted'),
  };
}

export function summarizeGate(perTask) {
  const S = {};
  for (const source of GATE_SOURCES) {
    const rows = Object.entries(perTask).filter(([, v]) => v[source]).map(([task, v]) => ({ task, ...v[source] }));
    const T = MOVE2;
    const five = gateStats(rows, FIVE_ARMS), six = gateStats(rows, ARMS);
    const { all, passing, failing } = six;
    const a1c = rows.map(r => ({ task: r.task, ...r.arms['haiku-a1c'] })).filter(x => x && !x.passed);
    const mention = a1c.flatMap(x => x.guardrails.filter(g => g.mention).map(g => ({ task: x.task, ...g })));
    const mentionRefused = mention.filter(g => g.refused);
    const mentionTasks = new Set(mentionRefused.map(g => g.task));
    const dupBefore = arm => all.filter(x => x.arm === arm && x.diffDuplicates > 0).length;
    const dupK = arm => all.filter(x => x.arm === arm && x.refusedK > 0).length;
    const dupAfter = arm => all.filter(x => x.arm === arm && x.residualDuplicates > 0).length;
    const verdict = st => ({
      success: mentionRefused.length >= T.mentionRefused && mentionTasks.size >= T.distinctTasks && st.falseRefusals <= T.maxFalseRefusals && st.maxDupAfter <= T.duplicatesAfterPerArm,
      kill: st.falseRefusals > T.maxFalseRefusals || st.unexplainedAdmittedPassing > st.unexplainedAdmittedFailing,
      parts: { mention: `${mentionRefused.length} of ${mention.length} from ${mentionTasks.size} tasks (need >= ${T.mentionRefused} from >= ${T.distinctTasks})`,
        falseRefusals: `${st.falseRefusals} refusals (${st.falseRefusalsP} P + ${st.falseRefusalsK} registry refusals of different content) in ${st.falseRefusalWorlds.length} passing worlds (need <= ${T.maxFalseRefusals} refusal)`,
        maxDuplicateTasksAfterPerArm: `${st.maxDupAfter} (need <= ${T.duplicatesAfterPerArm})`, unexplainedAdmittedRightMoreThanWrong: st.unexplainedAdmittedPassing > st.unexplainedAdmittedFailing },
    });
    const hold = arms => {
      const hs = rows.flatMap(r => arms.filter(a => r.hold?.[a]).map(a => ({ task: r.task, arm: a, ...r.hold[a] })));
      const p = hs.filter(x => x.passed), f = hs.filter(x => !x.passed);
      const reasons = {};
      for (const x of hs) for (const [k, n] of Object.entries(x.heldReasons ?? {})) reasons[k] = (reasons[k] ?? 0) + n;
      return { passingWorlds: p.length, passingWorldsWithHold: p.filter(x => x.held > 0).length, passingWorldsWithUnexplainedHold: p.filter(x => x.heldUnexplained > 0).length, passingWorldsWithUnreadableHold: p.filter(x => x.heldUnreadable > 0).length,
        heldInPassing: p.reduce((n, x) => n + x.held, 0), heldInFailing: f.reduce((n, x) => n + x.held, 0), failingWorldsWithHold: f.filter(x => x.held > 0).length, failingWorlds: f.length, reasons };
    };
    S[source] = {
      writes: all.reduce((n, x) => n + x.writes, 0), unreadableHeld: all.reduce((n, x) => n + x.undecodable, 0),
      mentionBreaks: `${mentionRefused.length}/${mention.length}`, mentionTasks: [...mentionTasks],
      allBrokenGuardrailsRefused: `${a1c.reduce((n, x) => n + x.guardrails.filter(g => g.refused).length, 0)}/${a1c.reduce((n, x) => n + x.guardrails.length, 0)}`,
      trueRefusalsFailingWorlds: failing.reduce((n, x) => n + x.trueRefusals, 0), failingWorldsWithTrueRefusal: failing.filter(x => x.trueRefusals > 0).length,
      unalignedRefusalsFailingWorlds: failing.reduce((n, x) => n + x.unalignedRefusals, 0),
      falseRefusals: { fiveArms: { refusals: five.falseRefusals, p: five.falseRefusalsP, registryDiffers: five.falseRefusalsK, worlds: five.falseRefusalWorlds.length, passingWorlds: five.passing.length },
        sixArms: { refusals: six.falseRefusals, p: six.falseRefusalsP, registryDiffers: six.falseRefusalsK, worlds: six.falseRefusalWorlds.length, passingWorlds: six.passing.length } },
      registryRefusals: { passingSame: passing.reduce((n, x) => n + (x.refusedKSame ?? 0), 0), passingDiffers: passing.reduce((n, x) => n + (x.refusedKDiffers ?? 0), 0), failingSame: failing.reduce((n, x) => n + (x.refusedKSame ?? 0), 0), failingDiffers: failing.reduce((n, x) => n + (x.refusedKDiffers ?? 0), 0),
        passingWorldsConflated: passing.filter(x => x.refusedKDiffers > 0).map(x => `${x.task}/${x.arm}: ${(x.kDiffers ?? []).map(k => k.op).join(', ')}`) },
      falseRefusalList: six.falseRefusalWorlds.map(x => `${x.task}/${x.arm}: ${x.refusalWhy.slice(0, 2).join('; ')}`),
      falseRefusalsByOrigin: six.falseRefusalWorlds.reduce((a, x) => { for (const o of x.refusalOrigins) a[o] = (a[o] ?? 0) + 1; return a; }, {}),
      duplicates: Object.fromEntries(ARMS.map(a => [a, { diffLevelBefore: dupBefore(a), callLevelRefusedByRegistry: dupK(a), diffLevelAfterLooseKey: dupAfter(a), diffLevelAfter: six.dupAfterAttributed(a),
        records: all.filter(x => x.arm === a && x.dupAttribution).reduce((t, x) => ({ duplicates: t.duplicates + x.dupAttribution.duplicates, prevented: t.prevented + x.dupAttribution.prevented, unattributed: t.unattributed + x.dupAttribution.unattributed }), { duplicates: 0, prevented: 0, unattributed: 0 }) }])),
      unexplainedAdmitted: { inPassingWorlds: five.unexplainedAdmittedPassing, inFailingWorlds: five.unexplainedAdmittedFailing, arms: 'five',
        shareInPassing: five.unexplainedAdmittedPassing + five.unexplainedAdmittedFailing ? +(five.unexplainedAdmittedPassing / (five.unexplainedAdmittedPassing + five.unexplainedAdmittedFailing)).toFixed(3) : null,
        baseShareInPassing: +(five.passing.reduce((n, x) => n + (x.admitted ?? 0), 0) / Math.max(1, five.all.reduce((n, x) => n + (x.admitted ?? 0), 0))).toFixed(3) },
      unexplained: { writes: all.reduce((n, x) => n + x.unexplained, 0), passingWorldsWithUnexplained: passing.filter(x => x.unexplained > 0).length, failingWorldsWithUnexplained: failing.filter(x => x.unexplained > 0).length, passingWorlds: passing.length, failingWorlds: failing.length },
      certificates: { issued: all.reduce((n, x) => n + x.certificates, 0), witnessedByWorld: all.reduce((n, x) => n + (x.witnessed ?? 0), 0),
        note: 'a certificate is witnessed when the stored world diff (an end-of-run read-back) shows its read-back spec (gate.mjs witnessHolds); the rest are claims' },
      holdMode: { fiveArms: hold(FIVE_ARMS), sixArms: hold(ARMS) },
      prereg: { ...verdict(five), arms: 'five (ATTACK: "the five dev60 arms")',
        rule: 'success: >= 6 of the 12 message-mention breaks refused from >= 3 distinct tasks, <= 1 false refusal over all passing worlds; duplicates per arm 13/60 -> <= 2/60; kill: > 1 false refusal on passing worlds, or admitted writes Δ* could not explain right more often than wrong (ATTACK §6 Move 2)' },
      preregSixArms: verdict(six),
    };
  }
  return S;
}

async function main() {
  const a = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) { a[argv[i].replace(/^--/, '')] = argv[i + 1]; i++; }
  if (!a.vlab) throw new Error('--vlab <lab dir> is required');
  const L = await import(pathToFileURL(path.join(path.resolve(a.vlab), 'load.mjs')).href);
  const rl2ByTask = new Map();
  for (const x of readJsonl(a.rl2 ?? '')) if (x.ok && x.version === 'rl2-extract-v3' && /^haiku:[012]$/.test(x.reader)) { if (!rl2ByTask.has(x.task)) rl2ByTask.set(x.task, []); rl2ByTask.get(x.task).push(x); }
  const all = L.loadRows({ canonicalOnly: true, arms: [...ARMS] });
  const tasks = (a.tasks ? a.tasks.split(',') : [...new Set(all.map(r => r.task))]).sort();
  const perTask = {};
  for (const task of tasks) {
    const rows = all.filter(r => r.task === task);
    const canon = [...L.loadRows({ canonicalOnly: true, tasks: [task] })].sort((x, y) => L.ARM_ORDER.indexOf(x.arm) - L.ARM_ORDER.indexOf(y.arm)).find(r => !r.worlds.initialRebuilt);
    perTask[task] = {};
    for (const source of GATE_SOURCES) {
      let D;
      try { D = source === 'scaffold' ? scaffoldDstar(rows) : buildFor(source, { rows, canon, L, rl2ByTask }); } catch (e) { process.stderr.write(`[gate-replay] ${task}/${source}: ${String(e?.message ?? e).slice(0, 160)}\n`); continue; }
      const arms = {}, hold = {};
      // identity v2 keys a message by the members it is about (the universes Δ* was built over); v1 reproduces the first replay
      const srcRow = rows.find(r => r.arm === (source === 'm3' ? 'm3-a1c' : 'haiku-a1c'));
      const invUniverses = universesFromInventory(JSON.parse(readFileSync(`${srcRow.source.host}/pipeline/inventory.json`, 'utf8')));
      const universes = a.identity === 'v1' ? null : invUniverses;
      const channels = channelList(invUniverses);
      const identity = a.identity === 'v1' ? identityOfV1 : identityOf;
      for (const r of rows) {
        const rep = replaySession(D, r.source.host, { identity, universes, diff: r.diff, holdUnexplained: false });
        const passed = r.label.task_completed_correctly === 1;
        const broken = passed ? [] : brokenGuardrails(readGrade(r.source.host));
        const guardrails = broken.map(g => ({ type: g.type, mention: MENTION_TYPES_PREREG.has(g.type), refused: rep.refusedP.some(ref => refusalAligns(ref, g, { channels })) }));
        const trueRefusals = rep.refusedP.filter(ref => broken.some(g => refusalAligns(ref, g, { channels }))).length;
        arms[r.arm] = { passed, writes: rep.writes, undecodable: rep.undecodable, refusedP: rep.refusedP.length, refusedK: rep.refusedK, unexplained: rep.unexplained, certificates: rep.certificates, witnessed: rep.witnessed,
          trueRefusals, unalignedRefusals: passed ? 0 : rep.refusedP.length - trueRefusals, guardrails,
          refusalWhy: rep.refusedP.flatMap(x => x.why).slice(0, 6), refusalOrigins: [...new Set(rep.refusedP.flatMap(x => x.origins))], diffDuplicates: diffDuplicates(r.diff), residualDuplicates: residualDuplicates(r.diff, rep.refusedLoose),
          admitted: rep.admitted, unexplainedAdmitted: rep.unexplainedAdmitted, refusedKSame: rep.refusedKSame, refusedKDiffers: rep.refusedKDiffers, kDiffers: rep.kDiffers, dupAttribution: attributeDuplicates(r.diff, rep.writeLog) };
        const hr = replaySession(D, r.source.host, { identity, universes, diff: r.diff, holdUnexplained: true });
        hold[r.arm] = { passed, held: hr.held, heldUnexplained: hr.heldUnexplained, heldUnreadable: hr.heldUnreadable, heldReasons: hr.heldReasons, refusedP: hr.refusedP.length, refusedKDiffers: hr.refusedKDiffers };
      }
      perTask[task][source] = { arms, hold };
    }
    process.stderr.write(`[gate-replay] ${task}: ${GATE_SOURCES.map(s => `${s} P${Object.values(perTask[task][s]?.arms ?? {}).reduce((n, x) => n + x.refusedP, 0)}/K${Object.values(perTask[task][s]?.arms ?? {}).reduce((n, x) => n + x.refusedK, 0)}`).join(' ')}\n`);
  }
  const res = { evidence: 'development/diagnostic, $0, in-sample (devTrain dev60 stored calls; grades as scoring scaffold only)', version: 'gate-replay-v3', identity: a.identity === 'v1' ? 'v1' : 'v2', registry: REGISTRY_VERSION, effectsSha256: EFFECTS_SHA256, fiveArms: FIVE_ARMS, summary: summarizeGate(perTask), perTask };
  if (a.out) writeFileSync(a.out, JSON.stringify(res, null, 1));
  process.stdout.write(`${JSON.stringify(res.summary, null, 1)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
