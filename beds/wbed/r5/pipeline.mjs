// The bed's own exact solver for R5 as the reference outline's stages: decode (the dump subsidiary's rows and trailer)
// -> R4's children (the dump pack closed from the decoded rows) -> translate -> pair -> eliminate -> report. Each decode
// mistake is run through the same pipeline, so its downstream effect is what the R1 solver really makes of the wrong
// rows: r1TraceOnRows re-runs R1's normalise and report over the decoded rows instead of the pack's own invoices.
import { normRow } from '../lib/legacy.mjs';
import { isoDay } from '../lib/domain.mjs';
import * as R1 from '../r1/index.mjs';
import { buildLedger, usdOf } from '../r1/world.mjs';
import { report as r1Report } from '../r1/pipeline.mjs';
import { STATUS_WORDS, statusLiveOf } from '../r1/vocab.mjs';
import { children, translate, pair, eliminate, report } from '../r4/pipeline.mjs';
import { decodeStage, rowKey, rowsEqual } from './decode.mjs';

/**
 * R1's trace when its invoice lists are the decoded `rows` of pack `sub` (an R4 child). A row identical to one of the
 * pack's invoices is that invoice. Any other row is read the way an R1 solver reads a list line: its date counts only
 * if it is one the pack's billing system printed (a mangled date cannot be dated), its status by the system's status
 * words (an unknown word does not count), its amount and currency as decoded (a currency without a quote does not
 * count). Duplicate invoice numbers are counted twice, as a list with a line twice would be.
 */
export function r1TraceOnRows(sub, decoded) {
  const rows = decoded.map(normRow);
  const w = buildLedger(sub.spec.seed, sub.spec.split, sub.spec.difficulty);
  const truth = R1.referenceTrace(sub.task);
  const byNo = new Map(w.invoices.map(i => [i.no, i]));
  const truthKey = new Map(truth.extract.invoices.map(x => [x.invoice, rowKey(x)]));
  const dayOfDate = new Map(truth.extract.invoices.map(x => [`${x.system}|${x.date_text}`, byNo.get(x.invoice).day]));
  const flagOf = new Map(w.flags.map(f => [`${f.system}|${f.word}`, f]));
  const derived = rows.map(r => {
    const wi = byNo.get(r.invoice);
    if (wi && truthKey.get(r.invoice) === rowKey(r)) return wi;
    const words = STATUS_WORDS[r.system];
    let status = 'void', flag, flagPolarity;
    if (words) {
      if (r.status_text === words.open) status = 'open';
      else if (r.status_text === words.paid) status = 'paid';
      else { const f = flagOf.get(`${r.system}|${r.status_text}`); if (f) { status = 'open'; flag = f.word; flagPolarity = f.polarity; } }
    }
    return { no: r.invoice, system: r.system, row: r.row, day: dayOfDate.get(`${r.system}|${r.date_text}`) ?? null, currency: r.currency, minor: r.amount_minor, status, flag, flagPolarity };
  });
  const close = w.conv.close;
  const quoted = c => Boolean(w.fx.cur[c]);
  const no = {
    invoices: derived.map(i => ({ invoice: i.no, row: i.row, date: i.day === null ? '' : isoDay(i.day), usd_cents: quoted(i.currency) ? usdOf(w, i.currency, i.minor) : 0,
      live: i.day !== null && quoted(i.currency) && statusLiveOf(i) && i.day <= close })),
    payments: truth.normalise.payments,
  };
  const ex = { customer_rows: truth.extract.customer_rows, invoices: rows, payments: truth.extract.payments };
  const rc = truth.reconcile;
  return { extract: ex, normalise: no, reconcile: rc, report: r1Report({ ...w, invoices: derived }, ex, no, rc) };
}

/**
 * Full R5 trace { decode, children, translate, pair, eliminate, report } under `opts`:
 *   opts.decode       a decode mistake (decode.mjs) or null
 *   opts.reportRaw    the output's dump.rows are the raw decode with the excluded records (relation control)
 * The R4 layer runs with no options (R4's own controls are inherited from R4 directly, index.mjs).
 */
export function runPipeline(world, opts = {}, { traces = true } = {}) {
  const dec = decodeStage(world, opts.decode ?? null);
  const w4 = world.r4;
  let kids = children(w4, {}, { traces });
  if (!rowsEqual(world.rows, dec.rows)) {
    const tr = r1TraceOnRows(world.sub, dec.rows);
    kids = kids.map(k => (k.sub_id === world.sub.id ? { ...k, output: structuredClone(tr.report), trace: traces ? tr : null } : k));
  }
  const tl = translate(w4, kids), pr = pair(w4), el = eliminate(w4, pr);
  const rep = report(w4, kids, tl, el);
  const reported = opts.reportRaw ? decodeStage(world, 'decoys-kept').rows : dec.rows;
  const output = { ...rep, dump: { sub_id: world.sub.id, rows: reported.map(normRow) } };
  return { decode: dec, children: kids, translate: tl, pair: pr, eliminate: el, report: output };
}
