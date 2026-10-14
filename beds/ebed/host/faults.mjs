// Fault injector (E-BED §2.7; BED-CONTRACT-v1.1 §4.3). The schedule is world data, keyed by
// (world, case, system, op, ordinal) — `ordinal` counts the attempts on (case, system, op) that reach the system,
// 1-based — so it is identical across arms that make the same attempts. Every injected ledger row and result is tagged
// `injected: true` with its fault id in `faultTags`; real environment faults never are (they are a different record).
//
//   F1 429 Retry-After        not applied            rate-limited, retryAfter (params.retryAfterSeconds, default 60)
//   F2 5xx transient          not applied            error { code: 503, retryable: true }
//   F3 timeout after commit   applied (committed)    unknown; status(key) shows committed
//   F4 partial batch          the item not applied   the batch result is partial with per-item statuses
//   F5 API field renamed      from `at` the mock accepts only params.to and rejects params.from (400, field named)
//   F6 permanent failure      not applied            error { code: 'permanent', retryable: false }
//
// `params.repeat` (default 1) extends F1–F4 and F6 to that many consecutive ordinals (a long outage).

export const FAULT_KINDS = Object.freeze({
  F1: Object.freeze({ id: 'F1', name: '429 with Retry-After', applied: false }),
  F2: Object.freeze({ id: 'F2', name: '5xx transient', applied: false }),
  F3: Object.freeze({ id: 'F3', name: 'timeout after commit', applied: true }),
  F4: Object.freeze({ id: 'F4', name: 'partial batch (item not applied)', applied: false }),
  F5: Object.freeze({ id: 'F5', name: 'API field renamed', applied: false }),
  F6: Object.freeze({ id: 'F6', name: 'permanent failure', applied: false }),
});

const keyOf = (c, system, op, ordinal) => `${c}\u0000${system}\u0000${op}\u0000${ordinal}`;

/** Validate a world's fault schedule against its systems; returns { lookup, renames, count }. */
export function faultSchedule(world, systemsById, toMs) {
  const index = new Map();
  const renames = [];
  for (const [i, f] of (world.faults ?? []).entries()) {
    const where = `world.faults[${i}]`;
    if (!FAULT_KINDS[f.kind]) throw new Error(`${where}: unknown kind ${f.kind}`);
    const sys = systemsById.get(f.system);
    if (!sys) throw new Error(`${where}: unknown system ${f.system}`);
    const op = sys.def.ops[f.op];
    if (!op || op.readOnly) throw new Error(`${where}: ${f.system}.${f.op} is not an effect op`);
    if (f.kind === 'F5') {
      const { from, to } = f.params ?? {};
      if (typeof from !== 'string' || typeof to !== 'string' || from === to) throw new Error(`${where}: F5 needs params.from and params.to`);
      renames.push({ atMs: toMs(f.at), system: f.system, op: f.op, from, to, fault: i });
      continue;
    }
    if (f.kind === 'F4' && !op.batch) throw new Error(`${where}: F4 needs a batch op`);
    if (!Number.isInteger(f.ordinal) || f.ordinal < 1) throw new Error(`${where}: ordinal must be an integer >= 1`);
    if (typeof f.case !== 'string') throw new Error(`${where}: case must name a truth case`);
    const repeat = f.params?.repeat ?? 1;
    if (!Number.isInteger(repeat) || repeat < 1 || repeat > 1e6) throw new Error(`${where}: bad repeat`);
    for (let k = 0; k < repeat; k++) {
      const key = keyOf(f.case, f.system, f.op, f.ordinal + k);
      if (index.has(key)) throw new Error(`${where}: two faults on one attempt`);
      index.set(key, { kind: f.kind, params: f.params ?? {}, fault: i });
    }
  }
  return {
    count: index.size + renames.length,
    renames,
    lookup: (c, system, op, ordinal) => (c === null || c === undefined ? null : index.get(keyOf(c, system, op, ordinal)) ?? null),
  };
}
