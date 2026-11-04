#!/usr/bin/env node
// $0 replay of the harness/v3 commit gate (ATTACK §6 Move 2, step (b): "replay-gate --lint with Move 1's dispositions")
// over the STORED calls.jsonl of the six dev60 arms. DEVELOPER TOOL: development / diagnostic evidence, devTrain dev60
// only. Δ* is built exactly as in dstar-replay.mjs (request, inventory, stored reader outputs); grades are read only to
// score the refusals afterwards.
//
//   node experiments/autobench/replay/gate-replay.mjs --vlab <lab dir> --rl2 <rl2 extract.jsonl> --out <file> [--tasks a,b] [--identity v1|v2]
//
// Every call of every stored session is offered to a fresh gate in recorded order (inventory reads, acting, checks,
// repairs). A refused or held write is counted, not simulated further (a live actor would change it).
// Scoring (fixed before scoring; ATTACK's thresholds applied verbatim in summarizeGate()):
//   true refusal     a P refusal in a failing world whose refused call names a broken guardrail's literal on its target;
//   false refusal    a P refusal in a passing world, or a registry (K) refusal there of DIFFERENT content than the
//                    write it collides with (a conflated key); a K refusal of the same content is a stopped duplicate;
//   mention breaks   the 12 message-mention breaks of the haiku-a1c arm (slack_message_not_in_channel and
//                    gmail_message_sent_to_with_body_not_contains, the latent-requirements sweep's class);
//   duplicates       tasks per arm with diff-level duplicates (created records sharing an identityOfCreated key) before
//                    the gate, and after it: a duplicate is removed when a write carrying its text was refused
//                    (attributeDuplicates; an unattributed duplicate stays); the v1 loose-key count is kept beside it;
//   unexplained      admitted writes that discharge no Δ* obligation, in passing vs failing worlds (the kill clause).
// Replay v2 (this file) adds the K split, the duplicate and unexplained clauses to the verdict, and --identity v1|v2.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGate, writeSucceeded } from '../harness/v3/gate.mjs';
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

/** Replay one stored session through a fresh gate. */
export function replaySession(dstar, hostDir, { holdUnexplained = false, identity = identityOf, universes = null } = {}) {
  const gate = createGate({ dstar, holdUnexplained, identity, universes });
  const steps = readJsonl(`${hostDir}/calls.jsonl`);
  const out = { writes: 0, admitted: 0, refusedP: [], refusedK: 0, refusedKSame: 0, refusedKDiffers: 0, kDiffers: [], refusedLoose: new Set(), held: 0, unexplained: 0, unexplainedAdmitted: 0, undecodable: 0, certificates: 0, writeLog: [] };
  const firstText = new Map();
  const content = f => normText(f.text);
  for (const s of steps) for (const [ci, call] of (s.calls ?? []).entries()) {
    const d = gate.check(call);
    if (d.action === 'admit') { const ok = writeSucceeded(s.results?.[ci]); gate.settle(d, ok); if (ok && !firstText.has(d.key)) firstText.set(d.key, content(d.facts)); }
    if (d.action === 'read') continue;
    if (d.action === 'undecodable') { out.undecodable++; continue; }
    out.writes++;
    out.writeLog.push({ app: d.facts.app, effect: d.facts.effect, text: lh(d.facts.text), refused: d.action === 'refuse', by: d.action === 'refuse' ? (d.violations.length ? 'P' : 'K') : null });
    if (d.unexplained) out.unexplained++;
    if (d.action === 'admit') { out.admitted++; if (d.certificate) out.certificates++; if (d.unexplained) out.unexplainedAdmitted++; }
    if (d.action === 'hold') out.held++;
    if (d.action === 'refuse') {
      if (d.violations.length) out.refusedP.push({ step: s.step, op: d.facts.op, recipients: d.facts.recipients.slice(0, 4), channels: d.facts.channels.slice(0, 2),
        ruleChannels: [...new Set(d.violations.flatMap(v => [v.rule.target?.channel?.id, v.rule.target?.channel?.name, v.rule.channel?.id, v.rule.channel?.name]).filter(Boolean))], text: d.facts.text.slice(0, 4000), why: d.violations.map(v => v.why), origins: [...new Set(d.violations.map(v => v.rule.origin))], kinds: [...new Set(d.violations.map(v => v.rule.kind))], duplicate: d.duplicate });
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

/** Does a refused call carry a broken guardrail (its literal, on its target)? */
export function refusalAligns(ref, g) {
  const ch = g.channel ? norm(String(g.channel).replace(/^#/, '')) : null;
  const toOk = g.to ? ref.recipients.includes(String(g.to).toLowerCase()) : ch ? [...ref.channels, ...(ref.ruleChannels ?? [])].some(c => norm(c) === ch) || !ref.channels.length : true;
  if (!toOk) return false;
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

export function summarizeGate(perTask) {
  const S = {};
  for (const source of GATE_SOURCES) {
    const rows = Object.entries(perTask).filter(([, v]) => v[source]).map(([task, v]) => ({ task, ...v[source] }));
    const all = rows.flatMap(r => ARMS.filter(a => r.arms[a]).map(a => ({ task: r.task, arm: a, ...r.arms[a] })));
    const passing = all.filter(x => x.passed), failing = all.filter(x => !x.passed);
    const a1c = rows.map(r => ({ task: r.task, ...r.arms['haiku-a1c'] })).filter(x => x && !x.passed);
    const mention = a1c.flatMap(x => x.guardrails.filter(g => g.mention).map(g => ({ task: x.task, ...g })));
    const mentionRefused = mention.filter(g => g.refused);
    const mentionTasks = new Set(mentionRefused.map(g => g.task));
    const falseRefusalWorldsP = passing.filter(x => x.refusedP > 0);
    // a false refusal on a passing world: a P refusal, or a registry refusal of DIFFERENT content (a conflated key); a
    // registry refusal of the same content again is a duplicate the gate should stop, not a false refusal
    const falseRefusalWorlds = passing.filter(x => x.refusedP > 0 || x.refusedKDiffers > 0);
    const T = MOVE2;
    const dupBefore = arm => all.filter(x => x.arm === arm && x.diffDuplicates > 0).length;
    const dupK = arm => all.filter(x => x.arm === arm && x.refusedK > 0).length;
    const dupAfter = arm => all.filter(x => x.arm === arm && x.residualDuplicates > 0).length;
    const dupAfterAttributed = arm => all.filter(x => x.arm === arm && x.dupAttribution && x.dupAttribution.residual > 0).length;
    const unexplainedAdmittedPassing = passing.reduce((s, x) => s + (x.unexplainedAdmitted ?? 0), 0), unexplainedAdmittedFailing = failing.reduce((s, x) => s + (x.unexplainedAdmitted ?? 0), 0);
    const maxDupAfter = Math.max(...ARMS.map(dupAfterAttributed));
    S[source] = {
      writes: all.reduce((s, x) => s + x.writes, 0), undecodable: all.reduce((s, x) => s + x.undecodable, 0),
      mentionBreaks: `${mentionRefused.length}/${mention.length}`, mentionTasks: [...mentionTasks],
      allBrokenGuardrailsRefused: `${a1c.reduce((s, x) => s + x.guardrails.filter(g => g.refused).length, 0)}/${a1c.reduce((s, x) => s + x.guardrails.length, 0)}`,
      trueRefusalsFailingWorlds: failing.reduce((s, x) => s + x.trueRefusals, 0), failingWorldsWithTrueRefusal: failing.filter(x => x.trueRefusals > 0).length,
      unalignedRefusalsFailingWorlds: failing.reduce((s, x) => s + x.unalignedRefusals, 0),
      falseRefusals: passing.reduce((s, x) => s + x.refusedP, 0), passingWorldsWithFalseRefusalP: falseRefusalWorldsP.length, passingWorldsWithFalseRefusal: falseRefusalWorlds.length, passingWorlds: passing.length,
      registryRefusals: { passingSame: passing.reduce((s, x) => s + (x.refusedKSame ?? 0), 0), passingDiffers: passing.reduce((s, x) => s + (x.refusedKDiffers ?? 0), 0), failingSame: failing.reduce((s, x) => s + (x.refusedKSame ?? 0), 0), failingDiffers: failing.reduce((s, x) => s + (x.refusedKDiffers ?? 0), 0),
        passingWorldsConflated: passing.filter(x => x.refusedKDiffers > 0).map(x => `${x.task}/${x.arm}: ${(x.kDiffers ?? []).map(k => k.op).join(', ')}`) },
      falseRefusalList: falseRefusalWorlds.map(x => `${x.task}/${x.arm}: ${x.refusalWhy.slice(0, 2).join('; ')}`),
      falseRefusalsByOrigin: falseRefusalWorlds.reduce((a, x) => { for (const o of x.refusalOrigins) a[o] = (a[o] ?? 0) + 1; return a; }, {}),
      duplicates: Object.fromEntries(ARMS.map(a => [a, { diffLevelBefore: dupBefore(a), callLevelRefusedByRegistry: dupK(a), diffLevelAfterLooseKey: dupAfter(a), diffLevelAfter: dupAfterAttributed(a),
        records: all.filter(x => x.arm === a && x.dupAttribution).reduce((t, x) => ({ duplicates: t.duplicates + x.dupAttribution.duplicates, prevented: t.prevented + x.dupAttribution.prevented, unattributed: t.unattributed + x.dupAttribution.unattributed }), { duplicates: 0, prevented: 0, unattributed: 0 }) }])),
      unexplainedAdmitted: { inPassingWorlds: unexplainedAdmittedPassing, inFailingWorlds: unexplainedAdmittedFailing, shareInPassing: unexplainedAdmittedPassing + unexplainedAdmittedFailing ? +(unexplainedAdmittedPassing / (unexplainedAdmittedPassing + unexplainedAdmittedFailing)).toFixed(3) : null,
        baseShareInPassing: +(passing.reduce((s, x) => s + (x.admitted ?? 0), 0) / Math.max(1, all.reduce((s, x) => s + (x.admitted ?? 0), 0))).toFixed(3) },
      unexplainedWrites: { inPassingWorlds: passing.reduce((s, x) => s + x.unexplained, 0), inFailingWorlds: failing.reduce((s, x) => s + x.unexplained, 0), writesPassing: passing.reduce((s, x) => s + x.writes, 0), writesFailing: failing.reduce((s, x) => s + x.writes, 0) },
      unexplained: { writes: all.reduce((s, x) => s + x.unexplained, 0), passingWorldsWithUnexplained: passing.filter(x => x.unexplained > 0).length, failingWorldsWithUnexplained: failing.filter(x => x.unexplained > 0).length, passingWorlds: passing.length, failingWorlds: failing.length },
      certificates: all.reduce((s, x) => s + x.certificates, 0),
      prereg: {
        success: mentionRefused.length >= T.mentionRefused && mentionTasks.size >= T.distinctTasks && falseRefusalWorlds.length <= T.maxFalseRefusals && maxDupAfter <= T.duplicatesAfterPerArm,
        kill: falseRefusalWorlds.length > T.maxFalseRefusals || unexplainedAdmittedPassing > unexplainedAdmittedFailing,
        parts: { mention: `${mentionRefused.length} of ${mention.length} from ${mentionTasks.size} tasks (need >= ${T.mentionRefused} from >= ${T.distinctTasks})`, falseRefusalWorlds: `${falseRefusalWorlds.length} (P only ${falseRefusalWorldsP.length}; need <= ${T.maxFalseRefusals})`, maxDuplicateTasksAfterPerArm: `${maxDupAfter} (need <= ${T.duplicatesAfterPerArm})`, unexplainedAdmittedRightMoreThanWrong: unexplainedAdmittedPassing > unexplainedAdmittedFailing },
        rule: 'success: >= 6 of the 12 message-mention breaks refused from >= 3 distinct tasks, <= 1 false refusal over all passing worlds; duplicates per arm 13/60 -> <= 2/60; kill: > 1 false refusal on passing worlds, or admitted writes Δ* could not explain right more often than wrong (ATTACK §6 Move 2)',
      },
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
      const arms = {};
      // identity v2 keys a message by the members it is about (the universes Δ* was built over); v1 reproduces the first replay
      const srcRow = rows.find(r => r.arm === (source === 'm3' ? 'm3-a1c' : 'haiku-a1c'));
      const universes = a.identity === 'v1' ? null : universesFromInventory(JSON.parse(readFileSync(`${srcRow.source.host}/pipeline/inventory.json`, 'utf8')));
      for (const r of rows) {
        const rep = replaySession(D, r.source.host, { identity: a.identity === 'v1' ? identityOfV1 : identityOf, universes });
        const passed = r.label.task_completed_correctly === 1;
        const broken = passed ? [] : brokenGuardrails(readGrade(r.source.host));
        const guardrails = broken.map(g => ({ type: g.type, mention: MENTION_TYPES_PREREG.has(g.type), refused: rep.refusedP.some(ref => refusalAligns(ref, g)) }));
        const trueRefusals = rep.refusedP.filter(ref => broken.some(g => refusalAligns(ref, g))).length;
        arms[r.arm] = { passed, writes: rep.writes, undecodable: rep.undecodable, refusedP: rep.refusedP.length, refusedK: rep.refusedK, unexplained: rep.unexplained, certificates: rep.certificates,
          trueRefusals, unalignedRefusals: passed ? 0 : rep.refusedP.length - trueRefusals, guardrails,
          refusalWhy: rep.refusedP.flatMap(x => x.why).slice(0, 6), refusalOrigins: [...new Set(rep.refusedP.flatMap(x => x.origins))], diffDuplicates: diffDuplicates(r.diff), residualDuplicates: residualDuplicates(r.diff, rep.refusedLoose),
          admitted: rep.admitted, unexplainedAdmitted: rep.unexplainedAdmitted, refusedKSame: rep.refusedKSame, refusedKDiffers: rep.refusedKDiffers, kDiffers: rep.kDiffers, dupAttribution: attributeDuplicates(r.diff, rep.writeLog) };
      }
      perTask[task][source] = { arms };
    }
    process.stderr.write(`[gate-replay] ${task}: ${GATE_SOURCES.map(s => `${s} P${Object.values(perTask[task][s]?.arms ?? {}).reduce((n, x) => n + x.refusedP, 0)}/K${Object.values(perTask[task][s]?.arms ?? {}).reduce((n, x) => n + x.refusedK, 0)}`).join(' ')}\n`);
  }
  const res = { evidence: 'development/diagnostic, $0, in-sample (devTrain dev60 stored calls; grades as scoring scaffold only)', version: 'gate-replay-v2', identity: a.identity === 'v1' ? 'v1' : 'v2', registry: REGISTRY_VERSION, effectsSha256: EFFECTS_SHA256, fiveArms: FIVE_ARMS, summary: summarizeGate(perTask), perTask };
  if (a.out) writeFileSync(a.out, JSON.stringify(res, null, 1));
  process.stdout.write(`${JSON.stringify(res.summary, null, 1)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
