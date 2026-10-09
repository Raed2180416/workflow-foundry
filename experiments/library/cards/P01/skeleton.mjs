// P01 linear pipeline with typed hand-offs — L1-PATTERNS §4. Fragment (flow, task, x, S) -> the last stage's output.
// Slots: STAGES (2..8 literal stages {name, kind: step | judge | call, fn | spec (+ merge) | hash (+ budgetUsd), out: schema}),
// CONSERVE (fn (input, output) -> bool; strongly recommended).
// Every hand-off is checked against its stage's schema; stages over 8 are split into a P54 call.
export default async function P01(flow, task, x, S) {
  const input = x;
  flow.guard('stages-bounded', S.STAGES.length >= 2 && S.STAGES.length <= 8, { n: S.STAGES.length });
  let v = x;
  for (const s of S.STAGES) {   // a literal list of 2..8 stages (the slot's bound)
    if (s.kind === 'call') v = await flow.call(s.hash, v, { name: s.name, budgetUsd: s.budgetUsd, timeoutMs: 120000 });
    else if (s.kind === 'judge') { const prev = v, out = await flow.judge(s.name, judgeSpec(s.spec, prev)); v = s.merge ? s.merge(prev, out) : out; }
    else v = flow.step(s.name, () => s.fn(v));
    flow.invariant(`${s.name}-typed`, validates(s.out, v), { stage: s.name });
  }
  if (S.CONSERVE) flow.invariant('conserved', S.CONSERVE(input, v), {});
  return v;
}
