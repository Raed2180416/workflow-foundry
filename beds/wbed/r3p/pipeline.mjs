// The bed's own exact solver for R3', written as the reference outline's stages: inventory the repository (code) ->
// fan out per source file: a worker lists the suspicious functions with a class (the per-file judgment) -> verify each
// suspect by running a witness against its contract (code; keeps reproduced suspects only) -> fan-in (code): root-cause
// attribution (a caller whose reproduction is explained by a reproduced callee is dropped) and the report.
// referenceSolve runs it with no options; each pipeline control runs it with one option reproducing one mistake.
//
// What a per-file worker suspects, when it reads well: every planted defect (with its class), every decoy (it looks like
// its class's mistake) and every caller that inherits a helper defect (it misbehaves against its own contract).
// Verification separates them: defects and inheriting callers reproduce, decoys do not.
const SWAP = { OFF_BY_ONE: 'LOGIC_ERROR', LOGIC_ERROR: 'OFF_BY_ONE' };

export function inventory(world) {
  return { files: world.render.sourceFiles.map(path => ({ path,
    functions: world.fns.filter(f => f.path === path).map(f => { const s = world.render.spans.get(f.name); return { name: f.name, start_line: s.start, end_line: s.end }; }) })) };
}

const helperClass = (world, f) => world.fns.find(h => h.kind === 'helper' && h.name === f.calls)?.cls ?? null;
export function candidates(world, inv, opts = {}) {
  const skim = opts.skim ?? new Set();
  const byName = world.byName;
  return {
    items: inv.files.map((file, i) => {
      if (skim.has(file.path) || (opts.stopAfter !== undefined && i >= opts.stopAfter)) return { path: file.path, candidates: [] };
      let cands = [];
      for (const { name } of file.functions) {
        const f = byName.get(name);
        if (opts.testedClean && f.tested) continue;
        if (f.role === 'defect') {
          if (opts.smellOnly && !f.smell) continue;
          const cls = opts.smellOnly ? f.smell : f.cls;
          cands.push({ function: name, class: opts.classSwap ? (SWAP[cls] ?? cls) : cls });
        } else if (f.role === 'decoy') {
          cands.push({ function: name, class: opts.classSwap ? (SWAP[f.smell] ?? f.smell) : f.smell });
        } else if (f.affected && !opts.smellOnly) cands.push({ function: name, class: helperClass(world, f) });
      }
      if (opts.fileLevel) cands = cands.map(c => ({ ...c, function: file.functions[0].name }));
      return { path: file.path, candidates: cands };
    }),
  };
}

/** Does the planted function misbehave against its contract on some valid input (a defect, or a caller inheriting one)? */
export const deviates = (world, name) => { const f = world.byName.get(name); return Boolean(f && (f.role === 'defect' || f.affected)); };

export function verify(world, cand, opts = {}) {
  return {
    items: cand.items.flatMap(it => it.candidates.map(c => {
      const reproduced = opts.assumeAll ? true : deviates(world, c.function);
      const f = world.byName.get(c.function);
      return { path: it.path, function: c.function, class: c.class, reproduced, witness: reproduced && deviates(world, c.function) ? { args: f.witness } : null };
    })),
  };
}

/** Root cause from the trace: a reproduced function whose callee also reproduced inherits its misbehaviour. */
export const inheritedIn = (world, items) => {
  const rep = new Set(items.filter(x => x.reproduced).map(x => x.function));
  return name => { const f = world.byName.get(name); return Boolean(f?.calls && rep.has(f.calls)); };
};

export function reduce(world, ver, opts = {}) {
  const inherited = inheritedIn(world, ver.items);
  const n = world.render.sourceFiles.length, a = Math.floor(n / 3), b = Math.ceil((2 * n) / 3);
  const middle = new Set(world.render.sourceFiles.filter((_, i) => i >= a && i < b));
  const seen = new Set();
  const findings = [];
  for (const x of ver.items) {
    if (!opts.ignoreVerdict && !x.reproduced) continue;
    if (!opts.noRootCause && x.reproduced && inherited(x.function)) continue;
    if (opts.lostMiddle && middle.has(x.path)) continue;
    const k = `${x.path}|${x.function}|${x.class}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const span = world.render.spans.get(x.function);
    findings.push({ file: x.path, function: x.function, class: x.class, ...(span ? { line: span.start } : {}), ...(x.witness ? { witness: x.witness } : {}) });
  }
  return { findings };
}

/** Full trace { inventory, candidates, verify, reduce } under `opts` (default: the exact solver). */
export function runPipeline(world, opts = {}) {
  const inv = inventory(world);
  const cand = candidates(world, inv, opts);
  const ver = verify(world, cand, opts);
  return { inventory: inv, candidates: cand, verify: ver, reduce: reduce(world, ver, opts) };
}
