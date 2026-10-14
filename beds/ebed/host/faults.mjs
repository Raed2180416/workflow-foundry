// Fault injector (E-BED §2.7; BED-CONTRACT-v1.1 §4.3). The schedule is world data, keyed by
// (world, case, system, op, ordinal) — `ordinal` counts the attempts on (case, system, op) that reach the system,
// 1-based — so it is identical across arms that make the same attempts. Every injected ledger row and result is tagged
// `injected: true` with its fault id in `faultTags`; real environment faults never are (they are a different record).
//
//   F1 429 Retry-After        not applied            rate-limited, retryAfter (params.retryAfterSeconds, default 60)
//   F2 5xx transient          not applied            error { code: 503, retryable: true }
//   F3 timeout                applied if it can      unknown (the same error whether or not it committed); status(key)
//                                                    shows the truth
//   F4 partial batch          the item not applied   the batch result is partial with per-item statuses
//   F5 API field renamed      from `at` the mock accepts only params.to and rejects params.from (400, field named)
//   F6 permanent failure      not applied            error { code: 'permanent', retryable: false }, at its ordinal and at
//                                                    every later ordinal of that (case, system, op): a retry, under the
//                                                    same key or a new one, fails again (review finding 4, H-23)
//
// `params.repeat` (default 1) extends F1–F4 to that many consecutive ordinals (a long outage). F6 takes no `repeat`
// (it is permanent); no other fault may be scheduled on an attempt an F6 already covers.

export const FAULT_KINDS = Object.freeze({
  F1: Object.freeze({ id: 'F1', name: '429 with Retry-After', applied: false }),
  F2: Object.freeze({ id: 'F2', name: '5xx transient', applied: false }),
  F3: Object.freeze({ id: 'F3', name: 'timeout (outcome hidden)', applied: true }),
  F4: Object.freeze({ id: 'F4', name: 'partial batch (item not applied)', applied: false }),
  F5: Object.freeze({ id: 'F5', name: 'API field renamed', applied: false }),
  F6: Object.freeze({ id: 'F6', name: 'permanent failure', applied: false }),
});

const opKey = (c, system, op) => `${c}\u0000${system}\u0000${op}`;
const keyOf = (c, system, op, ordinal) => `${opKey(c, system, op)}\u0000${ordinal}`;

/** Validate a world's fault schedule against its systems; returns { lookup, renames, count }. */
export function faultSchedule(world, systemsById, toMs) {
  const index = new Map();
  const permanent = new Map();     // opKey -> { from, entry }: F6 holds from its ordinal on
  const renames = [];
  const where = i => `world.faults[${i}]`;
  const checked = (world.faults ?? []).map((f, i) => {
    if (!FAULT_KINDS[f.kind]) throw new Error(`${where(i)}: unknown kind ${f.kind}`);
    const sys = systemsById.get(f.system);
    if (!sys) throw new Error(`${where(i)}: unknown system ${f.system}`);
    const op = sys.def.ops[f.op];
    if (!op || op.readOnly) throw new Error(`${where(i)}: ${f.system}.${f.op} is not an effect op`);
    if (f.kind === 'F5') return f;
    if (f.kind === 'F4' && !op.batch) throw new Error(`${where(i)}: F4 needs a batch op`);
    if (!Number.isInteger(f.ordinal) || f.ordinal < 1) throw new Error(`${where(i)}: ordinal must be an integer >= 1`);
    if (typeof f.case !== 'string') throw new Error(`${where(i)}: case must name a truth case`);
    return f;
  });
  checked.forEach((f, i) => {
    if (f.kind !== 'F6') return;
    if (f.params?.repeat !== undefined) throw new Error(`${where(i)}: F6 is permanent and takes no repeat (use F2 with repeat for an outage)`);
    const k = opKey(f.case, f.system, f.op);
    if (permanent.has(k)) throw new Error(`${where(i)}: two F6 on one (case, system, op)`);
    permanent.set(k, { from: f.ordinal, entry: { kind: 'F6', params: f.params ?? {}, fault: i } });
  });
  checked.forEach((f, i) => {
    if (f.kind === 'F5') {
      const { from, to } = f.params ?? {};
      if (typeof from !== 'string' || typeof to !== 'string' || from === to) throw new Error(`${where(i)}: F5 needs params.from and params.to`);
      renames.push({ atMs: toMs(f.at), system: f.system, op: f.op, from, to, fault: i });
      return;
    }
    if (f.kind === 'F6') return;
    const repeat = f.params?.repeat ?? 1;
    if (!Number.isInteger(repeat) || repeat < 1 || repeat > 1e6) throw new Error(`${where(i)}: bad repeat`);
    const perm = permanent.get(opKey(f.case, f.system, f.op));
    if (perm && f.ordinal + repeat - 1 >= perm.from) throw new Error(`${where(i)}: scheduled on an attempt that an earlier-or-equal F6 already fails permanently`);
    for (let k = 0; k < repeat; k++) {
      const key = keyOf(f.case, f.system, f.op, f.ordinal + k);
      if (index.has(key)) throw new Error(`${where(i)}: two faults on one attempt`);
      index.set(key, { kind: f.kind, params: f.params ?? {}, fault: i });
    }
  });
  return {
    count: index.size + permanent.size + renames.length,
    renames,
    lookup: (c, system, op, ordinal) => {
      if (c === null || c === undefined) return null;
      const perm = permanent.get(opKey(c, system, op));
      if (perm && ordinal >= perm.from) return perm.entry;
      return index.get(keyOf(c, system, op, ordinal)) ?? null;
    },
  };
}
