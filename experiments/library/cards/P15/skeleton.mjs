// P15 fan-in aggregate / report — L1-PATTERNS §4. Fragment (flow, task, x, S) -> {report, failed}.
// Slots: PARTS (path), KEY (fn part -> group key), AGG (fn parts -> value; code), IDENTITY (fn (parts, report) -> bool;
// a conservation identity in minor units), QUORUM (number 0..1). A failed branch (ok: false) counts against the quorum
// and is reported in `failed`, never skipped silently. The reduce is code; a model-written summary of totals is refused.
export default async function P15(flow, task, x, S) {
  const parts = S.PARTS(task, x);
  const failed = parts.filter(p => p.ok === false), live = parts.filter(p => p.ok !== false);
  flow.guard('quorum', live.length >= S.QUORUM * parts.length, { live: live.length, failed: failed.length, quorum: S.QUORUM });
  const groups = groupBy(live, S.KEY);
  const report = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, S.AGG(v)]));
  flow.invariant('identity', S.IDENTITY(live, report), {});
  return { report, failed: failed.map(p => p.id ?? null) };
}
