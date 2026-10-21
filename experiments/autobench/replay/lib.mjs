// Shared helpers of the A1-C replay tools (experiments/autobench/replay/; DEVELOPER TOOLS, in-sample development evidence).
// They read a recorded run's host directories (pipeline records, calls.jsonl, generated.json, grades) as the developer
// reads devTrain evidence (PREREG-AB-v1 §5); no harness module imports this directory (test/codeowned-v2.test.mjs, 17).
//   recorded(runDir, task)      the recorded inputs and outputs of one A1-C task
//   round0Cut(nodes, calls)     the steps before the first repair session (the world the round-0 check saw)
//   playback(...)               replay.py: the world and the grader's verdict after a number of recorded steps
//   served(...)                 a bridge serving a given world through a fresh mailbox, and a host client for it
//   recompileV2(...)            v2 checks compiled from the recorded reader, adjudication and mapping replies
//   alignScore(check, a)        automatic check-to-assertion alignment (the study's autoalign rule, ported)
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BRIDGE, VENV_PY, readJson, startServe } from '../lib.mjs';
import { bridgeClient } from '../harness/bridge-client.mjs';
import { buildInventory, dateOf, isLoadStamp } from '../harness/v2/inventory.mjs';
import { applyDecisions, majorityOf, mergeLedgers, normalizeLedger, parseJsonReply, settleByCode, sourceMap, typeLedger } from '../harness/v2/ledger.mjs';
import { applyMapped, postconditionsFromLedger } from '../harness/v2/postconditions.mjs';
import { PIPELINE_DEFAULTS } from '../harness/v2/codeowned.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PLAYBACK = path.join(HERE, 'playback.py');
export const DEFAULT_RUN = '/var/tmp/foundry-work/autobench/a1c-dev60-dn';
const readText = f => (existsSync(f) ? readFileSync(f, 'utf8') : null);
const readLines = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

export const runTaskList = runDir => readJson(path.join(runDir, 'launch.json')).tasks;
export function dirsOf(runDir, task) {
  const host = path.join(runDir, 'host', task, 'fork-0');
  return { host, pipeline: path.join(host, 'pipeline'), prep: path.join(runDir, 'prep', task) };
}
/** Everything one recorded A1-C task holds that the replays need. */
export function recorded(runDir, task) {
  const d = dirsOf(runDir, task);
  const files = existsSync(d.pipeline) ? readdirSync(d.pipeline) : [];
  const reply = re => files.filter(f => re.test(f)).sort().map(f => readText(path.join(d.pipeline, f)));
  const nodes = readJson(path.join(d.pipeline, 'nodes.json'));
  const inv = nodes.find(n => n.name === 'inventory');
  const checks = files.filter(f => /^check-\d+\.json$/.test(f)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0])).map(f => readJson(path.join(d.pipeline, f)));
  return {
    task, dirs: d, prompt: readJson(path.join(d.prep, 'prompt.json')), meta: readJson(path.join(d.prep, 'meta.json')), inventory: readJson(path.join(d.pipeline, 'inventory.json')), nodes,
    clock: inv ? { t0: inv.started * 1000, t1: inv.ended * 1000 } : null, calls: readLines(path.join(d.host, 'calls.jsonl')), grade: existsSync(path.join(d.host, 'grade.json')) ? readJson(path.join(d.host, 'grade.json')) : null,
    ledgerReplies: reply(/^\d+-ledger-\d+\.reply\.txt$/), adjudicateReply: reply(/^\d+-adjudicate\.reply\.txt$/)[0] ?? null, pcmapReply: reply(/^\d+-pcmap\.reply\.txt$/)[0] ?? null,
    v1: { ledgers: existsSync(path.join(d.pipeline, 'ledgers.json')) ? readJson(path.join(d.pipeline, 'ledgers.json')) : null, postconditions: existsSync(path.join(d.pipeline, 'postconditions.json')) ? readJson(path.join(d.pipeline, 'postconditions.json')) : null, checks },
    actSystem: reply(/^\d+-act\.system\.txt$/)[0] ?? null,
  };
}
/** Steps before the first repair session started (all steps when no repair ran). */
export function round0Cut(nodes, calls) {
  const rep = nodes.find(n => n.name === 'repair-1');
  return rep ? calls.filter(c => c.t < rep.started).length : calls.length;
}
/** The act session's window, [started, ended] in epoch seconds. */
export const actWindow = nodes => { const a = nodes.find(n => n.name === 'act'); return a ? [a.started, a.ended] : null; };

const sh = (cmd, args, opts) => new Promise(res => {
  const c = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
  let o = '', e = '';
  c.stdout.on('data', d => { o += d; }); c.stderr.on('data', d => { if (e.length < 100_000) e += d; });
  c.on('close', code => res({ code, stdout: o, stderr: e }));
});
/** Replay the first `cut` recorded steps of a task (recorded generator values played back) and grade there:
 * { n, mismatchedSteps, partial_credit, pass, assertions: [{type, params, passed}], world }. */
export async function playback({ runDir, task, cut, outFile, cwd }) {
  const d = dirsOf(runDir, task);
  mkdirSync(path.dirname(outFile), { recursive: true });
  mkdirSync(cwd, { recursive: true });
  const r = await sh(VENV_PY, ['-I', PLAYBACK, BRIDGE, path.join(d.prep, 'input.json'), d.host, outFile, String(cut)], { cwd, env: { PATH: process.env.PATH, HOME: cwd, HF_HUB_OFFLINE: '1', HF_DATASETS_OFFLINE: '1', TQDM_DISABLE: '1' } });
  if (r.code !== 0) throw new Error(`playback ${task} cut ${cut} failed (${r.code}): ${r.stderr.slice(-1500)}`);
  return readJson(outFile)[String(cut)];
}
/** Serve `world` (an exported world object; null: the task's initial world) for one task through a fresh mailbox and run
 * fn(client) with a host client on it; the bridge is killed afterwards (no grading). */
export async function served({ runDir, task, world = null, liveDir }, fn) {
  const d = dirsOf(runDir, task);
  const meta = readJson(path.join(d.prep, 'meta.json'));
  mkdirSync(liveDir, { recursive: true });
  let wfile = path.join(d.prep, 'world0.json');
  if (world) { wfile = path.join(liveDir, 'world.json'); writeFileSync(wfile, JSON.stringify({ task, contract_sha256: meta.contract_sha256, world })); }
  const mailbox = path.join(liveDir, 'box');
  const bridge = startServe({ liveDir, input: path.join(d.prep, 'input.json'), world: wfile, mailbox, hostDir: path.join(liveDir, 'host'), det: 'record', maxSteps: 50, fork: 0, expectContract: meta.contract_sha256 });
  try {
    await bridge.ready;
    return await fn(bridgeClient({ mailbox, waitMs: 120_000 }));
  } finally { bridge.kill(); }
}

/** The v2 inventory of a task's initial world (served), with the recorded run's inventory clock for load stamps. */
export async function inventoryV2({ runDir, task, liveDir, clock, request, P = PIPELINE_DEFAULTS }) {
  const inv = await served({ runDir, task, liveDir }, client => buildInventory({ request, client, maxSteps: P.inventorySteps, node: 'inventory', dateNote: true, windowMs: P.loadStampWindowMs }));
  if (clock) { inv.clock = { ...clock }; const stamp = v => isLoadStamp(v, inv.clock, P.loadStampWindowMs); for (const r of inv.records) r.date = dateOf(r.data, { stamp }); }
  return inv;
}

/**
 * v2 checks compiled from a task's recorded replies: the recorded reader replies (v1's prompt), the recorded adjudication
 * applied to the v2 conflicts it answered (matched by point text and option label), the recorded mapping reply applied to
 * the v2 judged items it answered (matched by statement). -> { merged, pcs, typing, sources, mappedFromRecord }.
 */
export function recompileV2({ rec, inv, P = PIPELINE_DEFAULTS, replies = null, adjudicate = undefined, pcmap = undefined }) {
  const sources = sourceMap(rec.prompt.user, inv, { system: P.systemToReaders ? rec.prompt.system : null, dateNote: true, windowMs: P.loadStampWindowMs });
  const texts = replies ?? rec.ledgerReplies;
  const ledgers = texts.map((t, k) => normalizeLedger(parseJsonReply(t), sources, { reader: k + 1 }));
  const merged = mergeLedgers(ledgers, { sources, entityKeyMerge: P.entityKeyMerge });
  const { settled, open } = settleByCode(merged.conflicts, sources);
  const decisions = settled.map(s => ({ conflict: s.conflict, choice: s.choice, by: 'code', rule: s.rule }));
  const adjText = adjudicate === undefined ? rec.adjudicateReply : adjudicate;
  if (open.length) {
    const reply = adjText ? parseJsonReply(adjText) : null;
    if (adjudicate !== undefined) decisions.push(...open.map((c, i) => { const dd = (reply?.decisions ?? []).find(x => Number(x?.point) === i + 1); const k = dd && dd.option !== 'none' ? Number(dd.option) - 1 : -1; return { conflict: c, choice: c.options[k] ?? null, by: dd ? 'adjudication' : 'adjudication (no answer)' }; }));
    else {
      // The recorded adjudication answered v1's points: apply its choice where the v2 point and option read the same.
      const log = rec.v1.ledgers?.merged?.adjudications ?? [];
      for (const c of open) { const hit = log.find(l => l.by === 'adjudication' && l.about === c.about); decisions.push({ conflict: c, choice: hit ? c.options.find(o => o.label === hit.decided) ?? null : null, by: hit ? 'adjudication (recorded)' : 'unsettled (replay)' }); }
    }
  }
  applyDecisions(merged, decisions);
  const typing = typeLedger(merged, sources, inv, P);
  const majority = majorityOf(merged);
  let pcs = postconditionsFromLedger(merged, inv, { sources, P, majority });
  const sat = pcs.satisfiability, stats = pcs.stats;
  let mappedFromRecord = 0;
  const pmText = pcmap === undefined ? rec.pcmapReply : pcmap;
  const pm = pmText ? parseJsonReply(pmText) : null;
  if (pm?.checks) {
    // The pipeline's own mapping step (postconditions.mjs applyMapped); a RECORDED reply answered v1's item ids, so its
    // requirement is matched to the v2 item by statement.
    const v1Items = rec.v1.ledgers?.merged?.items ?? [];
    const judgedPositive = i => pcs.some(p => p.item === i.id && p.type === 'judged' && p.polarity === 'positive');
    const itemFor = c => { const stmt = pcmap === undefined ? v1Items.find(i => i.id === String(c?.requirement))?.statement : null; return merged.items.find(i => (stmt ? i.statement === stmt : i.id === String(c?.requirement)) && judgedPositive(i)); };
    ({ pcs, mapped: mappedFromRecord } = applyMapped(pcs, pm, { itemFor, sources, inv, majority, P, why: pcmap === undefined ? 'mapped (recorded reply)' : 'mapped by the mapping call; values found in sources' }));
  }
  pcs = pcs.map((p, i) => ({ ...p, id: `P${i + 1}` }));
  pcs.satisfiability = sat; pcs.stats = stats;
  return { merged, pcs, typing, sources, ledgers, mappedFromRecord };
}

// ---------------------------------------------------------------------------------------------------------------
// Automatic alignment of a check with a grader assertion (port of the study's autoalign.py)

const EM = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const n = s => String(s ?? '').toLowerCase().replace(/’/g, "'").replace(/\s+/g, ' ').trim();
const APPMAP = { gmail: 'gmail', slack: 'slack', salesforce: 'salesforce', google: 'google', intercom: 'intercom', helpcrunch: 'helpcrunch', zoho: 'zoho_desk', jira: 'jira', asana: 'asana', monday: 'monday', reamaze: 'reamaze', freshdesk: 'freshdesk', docusign: 'docusign', zoom: 'zoom', linkedin: 'linkedin', chatgpt: 'chatgpt', hubspot: 'hubspot', gorgias: 'gorgias', twilio: 'twilio', trello: 'trello', notion: 'notion', confluence: 'confluence', airtable: 'airtable', calendly: 'calendly' };
export function assertionApp(a) {
  const t = a.type;
  if (t.startsWith('google_sheets')) return 'google_sheets';
  if (t.startsWith('google_calendar')) return 'google_calendar';
  const h = t.split('_')[0];
  return APPMAP[h] ?? h;
}
const aLits = a => {
  const P = a.params ?? {}; const L = [];
  for (const k of ['body_contains', 'text_contains', 'subject_contains', 'subject', 'value', 'cell_contains', 'summary_contains', 'summary', 'tag', 'status', 'name_contains', 'prompt_contains', 'content_contains', 'name', 'priority', 'company', 'body_not_contains', 'phone', 'event_name']) {
    const v = P[k];
    if (typeof v === 'string') L.push(v); else if (Array.isArray(v)) L.push(...v.map(String));
  }
  if (P.cells && typeof P.cells === 'object') L.push(...Object.values(P.cells).map(String));
  if (P.params && typeof P.params === 'object') L.push(...Object.values(P.params).filter(v => ['string', 'number'].includes(typeof v)).map(String));
  return L;
};
const aEnts = a => {
  const P = a.params ?? {};
  const E = new Set(JSON.stringify(P).toLowerCase().match(EM) ?? []);
  for (const k of ['record_id', 'contact_id', 'conversation_id', 'ticket_id', 'parent_id', 'message_id', 'row_id', 'spreadsheet_id', 'channel', 'channel_name', 'channel_id', 'company_id', 'user_id', 'customer_id']) if (typeof P[k] === 'string') E.add(P[k].toLowerCase().replace(/^#/, ''));
  return E;
};
const pEnts = p => {
  const P = p.params ?? {};
  const E = new Set(JSON.stringify(P).toLowerCase().match(EM) ?? []);
  const ptr = P.ptr ?? P.parent;
  if (ptr) { const last = String(ptr).split(':').at(-1).toLowerCase(); E.add(last); for (const q of last.split(/[/#]/)) E.add(q); }
  if (P.channel && typeof P.channel === 'object') for (const v of Object.values(P.channel)) if (v) E.add(String(v).toLowerCase());
  if (typeof P.channel === 'string') E.add(P.channel.toLowerCase());
  if (P.spreadsheetId) E.add(String(P.spreadsheetId).toLowerCase());
  return E;
};
const pLits = p => { const P = p.params ?? {}; const L = []; for (const k of ['subject', 'body', 'text', 'values', 'bodyNot']) if (Array.isArray(P[k])) L.push(...P[k].map(String)); if ('value' in P) L.push(String(P.value)); return L; };
export const assertionLiterals = aLits;
export const checkLiterals = pLits;
const COMPAT = { gmail_sent: ['gmail'], gmail_not_sent: ['gmail'], slack_posted: ['slack'], slack_not_posted: ['slack'], sheet_row: ['google_sheets'], row_not_exists: ['google_sheets'] };
const NEGATIVE = new Set(['gmail_not_sent', 'slack_not_posted', 'row_not_exists', 'record_unchanged']);
/** Alignment score: 0 none; 1 literal only (creates and judged checks); 2 entity; 3 entity and literal. */
export function alignScore(p, a) {
  const aa = assertionApp(a), pt = p.type;
  if (COMPAT[pt] && !COMPAT[pt].includes(aa)) return 0;
  if (['record_field', 'record_deleted', 'record_unchanged'].includes(pt) && String(p.params.ptr).split(':')[0] !== aa) return 0;
  if (pt === 'child_created' && String(p.params.parent).split(':')[0] !== aa) return 0;
  if (['record_created', 'channel_posted'].includes(pt) && p.params.app !== aa) return 0;
  if (pt === 'judged' && p.app && p.app !== aa) return 0;
  const negA = a.type.includes('_not_') || a.type.endsWith('_not_exists');
  if (NEGATIVE.has(pt) && !negA) return 0;
  const pe = pEnts(p), ae = aEnts(a);
  let ent = [...pe].some(x => ae.has(x));
  const al = aLits(a).map(n), pl = pLits(p).map(n);
  let lit = al.length ? al.some(x => x && pl.some(q => q && (x.includes(q) || q.includes(x)))) : null;
  if (pt === 'judged') { const st = n(p.statement); lit = al.length ? al.some(x => x && st.includes(x)) : null; ent = ent || [...ae].some(e => e.length > 3 && st.includes(e)); }
  let sc = (ent ? 2 : 0) + (lit ? 1 : 0);
  if (!ent && ['record_created', 'judged', 'channel_posted', 'child_created'].includes(pt) && lit) sc = 1;
  return sc;
}
/** The assertions a check aligns with (score >= 2, or 1 for creates and judged checks), best first. */
export function aligned(p, assertions) {
  return assertions.map((a, i) => ({ i, a, s: alignScore(p, a) })).filter(x => x.s >= 2 || (x.s === 1 && ['record_created', 'judged', 'channel_posted', 'child_created'].includes(p.type))).sort((x, y) => y.s - x.s);
}
