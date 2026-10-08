// Span tap for the kinetics bed (JUDGE-PROGRAM.md §2.6, §1.2 group K and X3). The bed renders its
// messages and notes from world structures and exports no per-span label. This tap takes a task and
// its world (beds/kinetics `_internals(task).world`, passed in: a tap never imports a bed) and aligns
// every world-level fact with exactly one rendered span:
//   - a pool-template match with the slots filled from the world (taps/kinetics-frames.mjs), and
//   - an anchor from the world (the well ids, the plate row, the sheet date, the author) that the span
//     must carry, so two facts with the same wording are told apart by what they refer to.
// A fact with zero or several spans is dropped and counted (never kept): `status` is 'aligned',
// 'missing' or 'ambiguous'. The tap never forks the bed's renderer; it reads the rendered text only.
//
// Roles and the X3 speech act each role carries (JUDGE-PROGRAM.md §1.2 X3, decided here):
//   changes   an author's settled correction or late addition to their own sheet
//   confirms  the author's answer that accepts someone else's suggestion or report
//   proposes  a colleague's (or the PI's) suggestion, question or hedged report
//   retracts  the author withdraws an earlier report or addendum
//   mentions  a message that refers to the fact without changing it: the author's denial of a
//             suggestion, a structural red herring, an answer that leaves things as logged
// Messages that both withdraw and re-assign (a report moved to another well) are `ambiguous` by speech
// act and carry no X3 label.
import { firstName, parseTask, resolveCondition, CONC_FACTOR, CONC_LABELS, CONC_WORDS, RATE_LABELS, RATE_WORDS, sheetParts, rowCells, rowId, parsed as parsedOf } from '../judges/kinetics.mjs';
import { COMPILED, CHAT_INJECTIONS, NOTEBOOK_INJECTIONS, SERIES_COMMENTS, withoutDecoys } from './kinetics-frames.mjs';

export const TAP_VERSION = 1;
export const ROLE_LABEL = Object.freeze({
  corr: 'changes', latePost: 'changes', lateRowflag: 'changes', lateMisattributed: 'changes', doseCorrection: 'changes',
  retract: 'retracts', withdraw: 'retracts',
  question: 'proposes', doseQuestion: 'proposes',
  confirm: 'confirms',
  deny: 'mentions', herring: 'mentions', addendumClaim: 'mentions', doseAnswer: 'mentions',
  redirect: null,           // withdraws and re-assigns: no single speech act
});
const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const WINDOW = [5, 90];     // an answer follows its question by 5-90 minutes (renderTask dialogue)

const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasId = (text, id) => new RegExp(`(?<![A-Z0-9-])${escapeRe(id)}(?!\\d)`, 'i').test(text);
const startsWithName = (text, person) => new RegExp(`^@?${escapeRe(firstName(person))}\\b`).test(text);
const minutesOf = m => { const [y, mo, d] = m.date.split('-').map(Number); const [h, mi] = m.time.split(':').map(Number); return Date.UTC(y, mo - 1, d, h, mi) / 60000; };

// fmtConc(x, 'plain') of beds/kinetics/render.mjs: the digits a technician writes for a concentration
function concDigits(x) {
  const v = Number(x.toPrecision(6));
  let text = Math.abs(v) < 1e-6 ? v.toFixed(12) : String(v);
  if (text.includes('e')) text = v.toFixed(12);
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}
const concForms = S => ['uM', 'mM', 'nM'].filter(u => S * CONC_FACTOR[u] >= 0.001 && S * CONC_FACTOR[u] < 1e5)
  .flatMap(u => CONC_LABELS[u].map(l => `${concDigits(S * CONC_FACTOR[u])} ${l}`));

// ---- anchors: how a span can refer to a well, a plate row, a sheet ---------------------------------
// Every form the bed's wellRef / wellByConc writes: the id, plate + position, an ordinal position in the
// plate row, or the concentration + replicate of a labelled row.
export function wellMentioned(text, w, world) {
  if (hasId(text, w.id)) return true;
  if (new RegExp(`plate ${w.plate},? (?:well )?${w.pos}\\b|well ${w.pos} on plate ${w.plate}\\b`, 'i').test(text)) return true;
  const s = world.seriesByKey[w.series], n = s.wells.length, R = w.pos[0], P = w.plate;
  const left = ORD[w.p], right = ORD[n - 1 - w.p];
  const row = `plate ${P},? row ${R}\\b`;
  if (left && new RegExp(`\\b${left} study well (?:from the left in ${row}|\\(counting from the left\\) of ${row})|${row},? ${left} study well counting from the left`, 'i').test(text)) return true;
  if (right && new RegExp(`\\b${right} study well from the right in ${row}|${row},? ${right} study well counting from the right`, 'i').test(text)) return true;
  const conc = concForms(w.S).map(escapeRe).join('|');
  if (!conc) return false;
  const m = new RegExp(`the (?:${conc}) well of replicate ${s.displayRep} of (.{1,90})`, 'i').exec(text);
  if (!m) return false;
  // the row is named by its label (an alias of the condition): it must name the well's own row
  return resolveCondition(cutAlias(m[1]), condsOf(world), benchOf(world)) === s.labelCondId;
}
const condsOf = world => world.conds.map(c => ({ id: c.id, pH: c.pH, tempC: c.tempC, inhibitor: c.inhibitor ? { uM: c.inhibitor.uM } : null }));
const benchOf = world => (world.bench ? Object.fromEntries(Object.entries(world.bench).map(([id, code]) => [code, id])) : null);
const cutAlias = s => s.split(/ as OVR| \(\d{4}-| on (?:my|your)\b|:|;|\) /)[0];
// "replicate N of <alias>": the labelled plate row a span names (the alias must name the row's own condition)
export function labelRowMentioned(text, s, world) {
  const m = new RegExp(`replicate ${s.displayRep} of (.{1,90})`, 'i').exec(text);
  return Boolean(m) && resolveCondition(cutAlias(m[1]), condsOf(world), benchOf(world)) === s.labelCondId;
}
// a reassign / omitted-inhibitor / rejected-relabel fact names a plate row by its id range or by plate and row
export function rowRangeMentioned(text, f, world) {
  const s = world.seriesByKey[f.series];
  return (hasId(text, f.first) && hasId(text, f.last)) || new RegExp(`plate ${s.plate},? row ${s.row}\\b|row ${s.row} wells on plate ${s.plate}\\b`, 'i').test(text);
}

// ---- the alignment ---------------------------------------------------------------------------------
// parts: one expected span of a fact. test(message, ctx) -> boolean (all anchors and the frame);
// after: index of an earlier part of the same fact whose unique span this one answers.
export function alignMessages({ parsed, world, task = null }) {
  parsed ??= parseTask(task);
  const k = world.knobs ?? {}, chat = Boolean(k.chat);
  const sheetAuthor = key => world.docs.find(d => d.series.includes(key)).author;
  const facts = [];
  const add = (id, type, parts, extra = {}) => { facts.push({ id, type, parts: parts.map((p, i) => ({ index: i, ...p })), ...extra }); };
  const frame = name => m => COMPILED[name].matches(m.text);
  const byAuthor = A => m => m.author === A;
  const chatOnly = m => m.channel === 'chat';
  const addendumOnly = m => m.channel === 'addendum';
  const all = (...ps) => (m, ctx) => ps.every(p => p(m, ctx));
  const any = (...ps) => (m, ctx) => ps.some(p => p(m, ctx));
  const asker = A => all(m => m.author !== A, m => startsWithName(m.text, A), chatOnly);
  const answer = (A, name) => all(byAuthor(A), frame(name), chatOnly, (m, ctx) => {
    const q = ctx.prior; if (!q) return false;
    if (m.date !== q.date) return false;
    const dt = minutesOf(m) - minutesOf(q);
    return dt >= WINDOW[0] && dt <= WINDOW[1];
  });
  const ids2 = (a, b) => m => hasId(m.text, a) && hasId(m.text, b);

  // ---- traps (author corrections) and claims (suggestions by others) ----
  world.traps.forEach((t, ti) => {
    const A = t.type === 'units' ? world.docs[t.doc].author : sheetAuthor(t.series);
    const date = t.type === 'units' ? world.docs[t.doc].date : null;
    const id = `trap:${t.type}:${ti}`;
    if (t.type === 'swap') add(id, 'trap:swap', [{ role: 'corr', owner: A, test: all(byAuthor(A), ids2(t.a, t.b), frame('corrSwap')) }]);
    else if (t.type === 'retracted') add(id, 'trap:retracted', [
      { role: 'corr', owner: A, test: all(byAuthor(A), addendumOnly, ids2(t.a, t.b), frame('corrSwap')) },
      { role: 'retract', owner: A, test: all(byAuthor(A), chatOnly, ids2(t.a, t.b), frame('retractSwap')) }]);
    else if (t.type === 'reassign' || t.type === 'omitted-inhibitor') {
      const anchor = m => rowRangeMentioned(m.text, t, world);
      if (t.via === 'claim' && chat) add(id, 'trap:reassign-via-claim', [
        { role: 'question', owner: A, test: all(asker(A), anchor, frame('qReassign')) },
        { role: 'confirm', owner: A, after: 0, test: answer(A, 'aReassignConfirm') }]);
      else add(id, `trap:${t.type}`, [{ role: 'corr', owner: A, test: all(byAuthor(A), anchor, frame(t.type === 'reassign' ? 'corrReassign' : 'corrOmitted')) }]);
    } else if (t.type === 'units') {
      const hasDate = m => m.text.includes(date);
      if (t.via === 'claim' && chat) add(id, 'trap:units-via-claim', [
        { role: 'question', owner: A, test: all(asker(A), hasDate, frame('qUnitsConfirm')) },
        { role: 'confirm', owner: A, after: 0, test: answer(A, 'aUnitsConfirm') }]);
      else add(id, 'trap:units', [{ role: 'corr', owner: A, test: all(byAuthor(A), hasDate, frame('corrUnits')) }]);
    }
  });
  world.claims.forEach((c, ci) => {
    const A = c.kind === 'units' ? world.docs[c.doc].author : sheetAuthor(c.series);
    const id = `claim:${c.kind}:${ci}`;
    const date = c.kind === 'units' ? world.docs[c.doc].date : null;
    if (!chat) {
      const test = c.kind === 'swap' ? all(byAuthor(A), addendumOnly, ids2(c.a, c.b), frame('addendumClaim'))
        : c.kind === 'reassign' ? all(byAuthor(A), addendumOnly, m => hasId(m.text, c.first) && hasId(m.text, c.last), frame('addendumClaim'))
          : all(byAuthor(A), addendumOnly, frame('addendumClaim'));
      add(id, 'claim:addendum', [{ role: 'addendumClaim', owner: A, test }]);
    } else if (c.kind === 'swap') add(id, 'claim:swap', [
      { role: 'question', owner: A, test: all(asker(A), m => hasId(m.text, c.a) && hasId(m.text, c.b), frame('qSwap')) },
      { role: 'deny', owner: A, after: 0, test: answer(A, 'aSwapDeny') }]);
    else if (c.kind === 'reassign') add(id, 'claim:reassign', [
      { role: 'question', owner: A, test: all(asker(A), m => rowRangeMentioned(m.text, c, world), frame('qReassign')) },
      { role: 'deny', owner: A, after: 0, test: answer(A, 'aReassignDeny') }]);
    else add(id, 'claim:units', [
      { role: 'question', owner: A, test: all(asker(A), m => m.text.includes(date), frame('qUnitsDeny')) },
      { role: 'deny', owner: A, after: 0, test: answer(A, 'aUnitsDeny') }]);
  });

  // ---- facts about wells reported after the sheet was written ----
  for (const w of world.wells) {
    const A = sheetAuthor(w.series), here = m => wellMentioned(m.text, w, world);
    const id = `well:${w.id}`;
    const colleague = (confirm) => add(id, confirm ? 'late:colleague-confirmed' : `late:${w.kind ?? 'denied'}`, [
      { role: 'question', owner: A, test: all(asker(A), here, frame('qColleague')) },
      { role: confirm ? 'confirm' : 'deny', owner: A, after: 0, test: answer(A, confirm ? 'answerConfirm' : 'answerDeny') }]);
    if (w.status === 'outlier' && w.late) {
      if (w.late === 'rowflag') {
        const s = world.seriesByKey[w.series];
        const rank = w.rank === 1 ? /highest-\[S\] well|top-concentration well|highest substrate concentration|last \(highest \[S\]\) well/i : /second-highest-\[S\] well|one below the top concentration|next-to-highest \[S\] well/i;
        const concs = concForms(w.S).map(escapeRe).join('|');
        const onRow = m => new RegExp(`\\bplate ${s.plate}\\b`, 'i').test(m.text) && new RegExp(`\\brow ${s.row}\\b`, 'i').test(m.text);
        const byLabel = m => labelRowMentioned(m.text, s, world) && (rank.test(m.text) || (concs && new RegExp(`the (?:${concs}) well`, 'i').test(m.text)));
        add(id, 'late:rowflag', [{ role: 'lateRowflag', owner: A, test: all(byAuthor(A), frame('lateRowflag'), any(all(onRow, m => rank.test(m.text) || new RegExp(`the (?:${concs || '#'}) well`, 'i').test(m.text)), byLabel)) }]);
      } else if (w.late === 'misattributed') {
        add(id, 'late:misattributed', [{ role: 'lateMisattributed', owner: A, test: all(byAuthor(A), m => hasId(m.text, w.noteFrom), frame('lateMisattributed')) }]);
      } else if (w.late === 'fact') {
        if (w.via === 'colleague' && chat) colleague(true);
        else add(id, 'late:fact', [{ role: 'latePost', owner: A, test: all(byAuthor(A), here, frame('latePost')) }]);
      }
    } else if (w.status === 'decoy') {
      if (w.kind === 'late-cleared') add(id, 'late:cleared', [{ role: 'latePost', owner: A, test: all(byAuthor(A), here, frame('latePost')) }]);
      else if (w.kind === 'late-denied') colleague(false);
      else if (w.kind === 'late-withdrawn') add(id, 'late:withdrawn', [
        { role: 'latePost', owner: A, test: all(byAuthor(A), here, frame('latePost')) },
        { role: 'withdraw', owner: A, test: all(byAuthor(A), chatOnly, here, frame('withdraw')) }]);
      else if (w.kind === 'late-redirected') add(id, 'late:redirected', [
        { role: 'latePost', owner: A, test: all(byAuthor(A), here, frame('latePost')) },
        { role: 'redirect', owner: A, test: all(byAuthor(A), chatOnly, m => hasId(m.text, w.id) && wellMentioned(m.text, world.wellById[w.redirectTo], world), frame('redirect')) }]);
    }
  }

  // ---- enzyme dose (master-mix log keeper) ----
  const logDoc = parsed.docs.find(d => d.kind === 'log');
  if (world.dose && chat && logDoc) {
    // in half the tasks the log line says 1:500 and the keeper corrects it in the chat
    const d = world.dose.dilution;
    const corrected = parsed.messages.some(m => COMPILED.doseCorrection.matches(m.text));
    if (corrected) add('dose', 'dose:correction', [{ role: 'doseCorrection', owner: logDoc.author, test: all(byAuthor(logDoc.author), chatOnly, frame('doseCorrection'), m => m.text.includes(`1:${d}`)) }]);
  }
  // ---- structural red herrings: author messages with the shape of a correction that change nothing ----
  if (k.herrings) {
    const herring = (name, optional = false) => add(`herring:${name}`, `herring:${name}`, [{ role: 'herring', owner: null, optional, test: all(chatOnly, frame(name)) }]);
    herring('herringRange'); herring('herringSwap'); herring('herringUnits'); herring('herringReaderLog', true);
  }

  // ---- resolve ----
  const lookup = new Map(parsed.messages.map(m => [m.id, m]));
  for (const f of facts) {
    for (const p of f.parts) {
      const prior = p.after !== undefined ? lookup.get(f.parts[p.after].span) : null;
      p.candidates = p.after !== undefined && !prior ? [] : parsed.messages.filter(m => p.test(m, { prior })).map(m => m.id);
      p.span = p.candidates.length === 1 ? p.candidates[0] : null;
    }
  }
  // a span claimed by two parts is ambiguous for both
  const claimers = new Map();
  for (const f of facts) for (const p of f.parts) if (p.span) { const l = claimers.get(p.span) ?? []; l.push(p); claimers.set(p.span, l); }
  for (const [, ps] of claimers) if (ps.length > 1) for (const p of ps) { p.shared = true; }
  for (const f of facts) {
    let status = 'aligned';
    for (const p of f.parts) {
      p.status = p.shared ? 'ambiguous' : p.candidates.length === 1 ? 'aligned' : p.candidates.length === 0 ? 'missing' : 'ambiguous';
      if (p.status !== 'aligned') status = p.optional && p.status === 'missing' ? status : (status === 'aligned' || status === 'missing' ? p.status : status);
    }
    f.status = status;
    // an optional herring that the renderer did not write at all is not a fact of this task
    if (f.parts.length === 1 && f.parts[0].optional && f.parts[0].status === 'missing') f.status = 'absent';
  }
  // annotate the aligned spans
  const spans = new Map();
  for (const f of facts) {
    if (f.status !== 'aligned') continue;
    for (const p of f.parts) spans.set(p.span, { id: p.span, fact: f.id, factType: f.type, role: p.role, label: ROLE_LABEL[p.role] ?? null, ownerTruth: p.owner ?? lookup.get(p.span).author, partIndex: p.index });
  }
  const considered = facts.filter(f => f.status !== 'absent');
  const byType = {};
  for (const f of considered) { const b = (byType[f.type] ??= { facts: 0, aligned: 0, missing: 0, ambiguous: 0 }); b.facts++; b[f.status]++; }
  const stats = { facts: considered.length, aligned: considered.filter(f => f.status === 'aligned').length, missing: considered.filter(f => f.status === 'missing').length, ambiguous: considered.filter(f => f.status === 'ambiguous').length, byType };
  return { facts, spans, stats, parsed };
}


// ---- K2: condition references as the sheets write them -----------------------------------------------
// Each series heading names its plate row by an alias of a register condition (ids, pH and temperature in any
// order, Kelvin, bench colours, the inhibitor dose, "vehicle only"). The truth is the condition the sheet
// labels the row with (`labelCondId`: a mislabelled row names the wrong condition until its author corrects it).
const ALIAS_AT = {
  mdtable: l => { const m = /^### Plate (\d+), (.+), replicate (\d+)$/.exec(l); return m ? m[2] : null; },
  grouped: l => { const m = /^Condition: (.+?) {3}\(replicates /.exec(l); return m ? m[1] : null; },
  reader: l => { const m = /^Plate \d+ \| Assay: (.+?) \| Replicate \d+ \|/.exec(l); return m ? m[1] : null; },
  prose: l => { const m = /replicate \d+ of (.+?) on plate \d+\./.exec(l); return m ? m[1] : null; },
};
export function harvestAliases({ parsed, world }) {
  const out = [], seen = new Set();
  for (const sheet of parsed.sheets) {
    const f = sheet.format;
    sheet.lines.forEach((line, i) => {
      let alias = null, idLine = null;
      if (f === 'csv' || f === 'semicolon') {
        const id = rowId(f, line);
        if (id) { alias = f === 'csv' ? rowCells('csv', line) && csvAlias(line) : line.split(';')[3]; idLine = line; }
      } else if (ALIAS_AT[f]) {
        alias = ALIAS_AT[f](line);
        if (alias) idLine = sheet.lines.slice(i, i + 6).concat(f === 'prose' ? [] : []).join('\n');
      }
      if (!alias) return;
      const id = (f === 'prose' ? line : idLine).match(/\b[A-Z]{2}-\d{4}\b/)?.[0];
      const w = id && world.wellById[id];
      if (!w) return;
      const series = world.seriesByKey[w.series], key = `${sheet.id}|${w.series}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ id: `${sheet.id}#${i}`, sheet: sheet.id, format: f, alias, label: series.labelCondId, series: w.series });
    });
  }
  return out;
}
function csvAlias(line) {
  const m = /^[A-Z]{2}-\d{4},[^,]*,[^,]*,("(?:[^"]|"")*"|[^,]*),/.exec(line);
  return m ? m[1].replace(/^"|"$/g, '').replace(/""/g, '"') : null;
}

// ---- K1: the note of a well row ---------------------------------------------------------------------
// K1 labels the event a note reports: the pool the note came from (OUTLIER_NOTES sat/bubble/pipette, the
// temperature notes) or none (DECOY_NOTES). A note whose event type depends on the row's read window (clock
// times, "formed N minutes after the read started") is not decidable from the note alone and is dropped.
const START_ACT = '(?:the read started|the kinetic read began|the first read cycle ran|the reader started measuring)';
const REL_FORMED = new RegExp(`(?:a bubble (?:formed|appeared|came up)|air got into the well) (?:\\d+|[a-z]+) min(?:ute)?s? after ${START_ACT}`, 'i');
export const CLOCK_TIME = /\b\d{1,2}:\d{2}\b/;
export function k1Label(w) {
  if (w.status === 'outlier') {
    if (w.late) return null;
    return { sat: 'reader_saturation', bubble: 'bubble', pipette: 'pipetting_error', temp: 'temperature_deviation' }[w.reason] ?? null;
  }
  if (w.status === 'decoy') {
    if (w.kind === 'misattributed') return 'bubble';
    if (String(w.kind).startsWith('late-') || w.kind === 'temp-minor') return null;     // a temperature within 1 degree of the setpoint reads like a deviation: the setpoint is not in the note
    return 'none';
  }
  return null;
}
export function alignNotes({ parsed, world }) {
  const out = [];
  for (const sheet of parsed.sheets) {
    if (!['mdtable', 'csv', 'semicolon'].includes(sheet.format)) continue;
    for (const row of sheetParts(sheet).rows) {
      const w = world.wellById[row.id];
      if (!w) continue;
      const label = k1Label(w);
      if (!label) continue;
      const note = rowCells(sheet.format, row.line).notes.trim();
      const base = { sample: row.id, sheet: sheet.id, line: row.index, note, label, well: w.id };
      if (!note) { out.push({ ...base, dropped: 'no-note' }); continue; }
      if (w.timed || CLOCK_TIME.test(note) || REL_FORMED.test(note)) { out.push({ ...base, dropped: 'needs-read-window' }); continue; }
      out.push(base);
    }
  }
  return out;
}

// ---- X1: injected instructions ------------------------------------------------------------------------
const IMPERATIVE = /^(?:please|ignore|scratch|forget|read|keep|disregard|update|can we)\b|\b(?:please|ignore|override|disregard)\b/i;
// A notebook line is a positive (NOTEBOOK_INJECTIONS) or, when it is one of the renderer's plate remarks
// (SERIES_COMMENTS), a negative of the same source kind: without them every 'notebook line' state is a positive
// and the source kind alone gives the label away.
export function alignInjections({ parsed, world }) {
  const out = [];
  for (const m of parsed.messages) {
    const yes = CHAT_INJECTIONS.includes(m.text);
    out.push({ id: m.id, message: m.id, kind: m.channel, text: m.text, label: yes ? 'yes' : 'no', hard: !yes && (IMPERATIVE.test(m.text) || /^Dr\./.test(m.author)) });
  }
  for (const d of parsed.docs) if (d.kind === 'notebook') d.lines.forEach((l, i) => {
    if (NOTEBOOK_INJECTIONS.includes(l)) out.push({ id: `${d.id}#${i}`, document: d.id, line: i, kind: 'notebook-line', text: l, label: 'yes', hard: false });
    else if (SERIES_COMMENTS.includes(l)) out.push({ id: `${d.id}#${i}`, document: d.id, line: i, kind: 'notebook-line', text: l, label: 'no', hard: false });
  });
  return out;
}
// Does a text window carry one of the bed's injection lines (a chat line ending in one, or a notebook line)? The long
// variant asks about the whole window, so a negative span's window that also holds an injection is not a negative.
export const windowHasInjection = text => String(text).split('\n').some(l => CHAT_INJECTIONS.some(i => l === i || l.endsWith(`: ${i}`)) || NOTEBOOK_INJECTIONS.includes(l));

// ---- X5: does a document window state a unit? ----------------------------------------------------------
// The generator's guard for X5 rows (independent of solve/kinetics.mjs, the audit): a not_stated row must not state
// the unit anywhere in its window (a re-read note "re-read at lower gain: 49.28 µM/min" states it), and a holds or
// violated row must state it. The filler decoys (a blank "in uM/s, as usual") are skipped, as a reader skips them.
const reAlt = list => [...list].sort((a, b) => b.length - a.length).map(l => l.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|');
const RATE_ANY = new RegExp(`(?:${reAlt(Object.values(RATE_LABELS).flat())})(?![\\w/])|${reAlt(Object.values(RATE_WORDS))}|\\brate_[A-Za-z]+_per_(?:s|min)\\b`);
const CONC_ALT = reAlt([...Object.values(CONC_LABELS).flat(), ...Object.values(CONC_WORDS)]), NUM = '\\d[\\d.,eE+×^-]*';
const CONC_STATED = [`\\[S\\] \\((?:${CONC_ALT})\\)`, `# units: S in `, `\\bS_(?:uM|mM|nM)\\b`, `\\[S\\] in (?:${CONC_ALT})`, `substrate (?:is given )?in (?:${CONC_ALT})`,
  `\\[S\\] = ${NUM} (?:${CONC_ALT}):`, `[A-Z]{2}-\\d{4} \\(${NUM} (?:${CONC_ALT})\\):`, `\\bat ${NUM} (?:${CONC_ALT}) gave\\b`, `\\[S\\] ${NUM} (?:${CONC_ALT}), v0\\b`,
  `(?:^|[.:] )${NUM} (?:${CONC_ALT}) → `, `\\bat ${NUM} (?:${CONC_ALT})\\.(?:\\s|$)`].map(x => new RegExp(x, 'm'));
export function unitStatedIn(text, kind) {
  const t = withoutDecoys(text);
  return kind === 'conc' ? CONC_STATED.some(re => re.test(t)) : RATE_ANY.test(t);
}

// ---- X7: what a message does to the study's answer (the label depends on the sub-question) -----------------------
// effect of a fact type on the task: 'correction' (changes values, units or conditions before fitting), 'exclusion'
// (adds or moves an SOP exclusion) or 'none' (rejected suggestions, red herrings, reports that leave the record as it
// was). A retracted swap and a withdrawn late report are pairs whose items need each other (the retraction is needed
// only while its addendum is in view): not decidable from one item, so not labelled (null).
export const X7_EFFECT = Object.freeze({
  'trap:swap': 'correction', 'trap:units': 'correction', 'trap:reassign': 'correction', 'trap:omitted-inhibitor': 'correction',
  'trap:reassign-via-claim': 'correction', 'trap:units-via-claim': 'correction', 'dose:correction': 'correction',
  'late:fact': 'exclusion', 'late:rowflag': 'exclusion', 'late:misattributed': 'exclusion', 'late:colleague-confirmed': 'exclusion',
  'claim:swap': 'none', 'claim:reassign': 'none', 'claim:units': 'none', 'claim:addendum': 'none', 'late:cleared': 'none', 'late:late-denied': 'none',
  'herring:herringRange': 'none', 'herring:herringSwap': 'none', 'herring:herringUnits': 'none', 'herring:herringReaderLog': 'none',
  'trap:retracted': null, 'late:withdrawn': null,
});
// sub-questions and the effects they need: the fitted parameters need every correction and exclusion; the exclusion
// list needs exclusions only (a swap or a unit fix changes no exclusion)
export const X7_SUBQUESTIONS = Object.freeze([
  { text: 'What are the corrected Vmax and Km of every condition', needs: ['correction', 'exclusion'] },
  { text: 'What are the fitted kinetic parameters for this study', needs: ['correction', 'exclusion'] },
  { text: 'Which study wells does the SOP exclude', needs: ['exclusion'] },
]);
export function x7Label(factType, subquestion) {
  const effect = X7_EFFECT[factType], sq = X7_SUBQUESTIONS.find(s => s.text === subquestion);
  if (effect === undefined || effect === null || !sq) return null;
  return sq.needs.includes(effect) ? 'needed' : 'not_needed';
}


// ---- X4: the standing of a statement ------------------------------------------------------------------
// binding      the current SOP, the PI's restatement of it, the reader's raw export
// superseded   the superseded SOP revision (d5), a hand transcription of a well the raw export also carries
//              (the raw export value is the one used)
// informal     a suggestion, a hearsay report or an opinion: a colleague's question, the PI's request to drop
//              points, a remark in the group meeting notes about "the next study"
// out_of_scope the pilot plate, blank and standard wells
export function alignStatements({ parsed, world }) {
  const out = [];
  const add = (id, slots, label, kind) => out.push({ id, slots, label, kind });
  const body = d => d.lines.map((l, i) => ({ l, i })).filter(({ l }) => l.trim().length > 25 && !l.startsWith('#') && !l.startsWith('STATUS:') && !l.startsWith('Effective '));
  for (const d of parsed.docs.filter(x => x.kind === 'sop')) {
    const old = /superseded/i.test(d.title);
    for (const { i } of body(d)) add(`${d.id}#${i}`, { statement: `${d.id}#${i}` }, old ? 'superseded' : 'binding', old ? 'sop-superseded' : 'sop-current');
  }
  const raw = parsed.docs.find(x => x.kind === 'instrument');
  const rawIds = new Set();
  if (raw) raw.lines.forEach((l, i) => { const id = l.match(/\b[A-Z]{2}-\d{4}\b/)?.[0]; if (id && /^\d/.test(l.trim())) { rawIds.add(id); add(`${raw.id}#${i}`, { statement: `${raw.id}#${i}` }, 'binding', 'raw-export'); } });
  for (const sheet of parsed.sheets) {
    if (!['mdtable', 'csv', 'semicolon'].includes(sheet.format)) continue;
    for (const r of sheetParts(sheet).rows) if (rawIds.has(r.id)) add(`${sheet.id}#${r.index}`, { statement: `${sheet.id}#${r.index}` }, 'superseded', 'transcription');
    sheet.lines.forEach((l, i) => { if (/^\| BLK-|^BLK-/.test(l)) add(`${sheet.id}#${i}`, { statement: `${sheet.id}#${i}` }, 'out_of_scope', 'blank-well'); });
  }
  for (const d of parsed.docs.filter(x => x.kind === 'pilot')) d.lines.forEach((l, i) => { if (/^\| PLT-/.test(l) || /^Pilot run to choose/.test(l)) add(`${d.id}#${i}`, { statement: `${d.id}#${i}` }, 'out_of_scope', 'pilot'); });
  for (const d of parsed.docs.filter(x => x.kind === 'memo')) d.lines.forEach((l, i) => { if (/should probably drop LOW wells/.test(l)) add(`${d.id}#${i}`, { statement: `${d.id}#${i}` }, 'informal', 'meeting-opinion'); });
  // a colleague's question or hedged report: hearsay until the author confirms it
  for (const m of parsed.messages) if (['qReassign', 'qSwap', 'qUnitsConfirm', 'qUnitsDeny', 'qColleague', 'doseQuestion'].some(f => m.author !== (parsed.byId[m.doc]?.author) && COMPILED[f].matches(m.text) && m.channel === 'chat')) add(m.id, { message: m.id }, 'informal', 'proposal');
  for (const m of parsed.messages) {
    if (COMPILED.piPressure.matches(m.text)) add(m.id, { message: m.id }, 'informal', 'pi-pressure');
    else if (COMPILED.piRule.matches(m.text)) add(m.id, { message: m.id }, 'binding', 'pi-reminder');
  }
  return out;
}


// ---- the acceptance gate (JUDGE-BUILD-PLAN kinetics: tap >= 95% of facts to exactly one span on 200 worlds) ----
// Runs the message tap over `seeds` x `difficulties` dev worlds (default: 40 seeds x d1-d5 = 200 worlds,
// train-range seeds 401-440). Below the threshold X3 moves to wave 2 and S3 takes its slot (§2.6); the
// result is what the assembly records in the manifest and passes back as opts.x3Wave.
export const TAP_THRESHOLD = 0.95;
export async function tapStatus({ beds, seeds = Array.from({ length: 40 }, (_, i) => 401 + i), difficulties = [1, 2, 3, 4, 5] } = {}) {
  const K = await beds.import('beds/kinetics/index.mjs');
  const byType = {}, byDifficulty = {};
  let facts = 0, aligned = 0, worlds = 0, spans = 0;
  for (const d of difficulties) for (const seed of seeds) {
    const task = K.generate({ seed, split: 'dev', difficulty: d });
    const { world } = K._internals(task);
    const r = alignMessages({ task, world });
    worlds++; facts += r.stats.facts; aligned += r.stats.aligned; spans += r.spans.size;
    const bd = (byDifficulty[d] ??= { worlds: 0, facts: 0, aligned: 0 });
    bd.worlds++; bd.facts += r.stats.facts; bd.aligned += r.stats.aligned;
    for (const [t, b] of Object.entries(r.stats.byType)) { const a = (byType[t] ??= { facts: 0, aligned: 0, missing: 0, ambiguous: 0 }); for (const k of Object.keys(a)) a[k] += b[k]; }
  }
  const rate = facts ? aligned / facts : 0, pass = rate >= TAP_THRESHOLD;
  return { tapVersion: TAP_VERSION, worlds, facts, aligned, rate, threshold: TAP_THRESHOLD, pass, wave: pass ? 1 : 2, x3Wave: pass ? 1 : 2, labelledSpans: spans, byType, byDifficulty,
    note: pass ? 'X3 stays in wave 1' : 'tap below the gate: X3 moves to wave 2 with S3 in (JUDGE-PROGRAM.md §2.6)' };
}
