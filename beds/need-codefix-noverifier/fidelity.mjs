// Transcript-fidelity probe for the bug reports (trusted host code, $0: runs bed-generated modules in the local Python, no model).
//
// The bug report of every task carries REPL transcripts ("```>>> ...```") and "For `expr` I expected A, but I get B." sentences,
// rendered by beds/codefix from harness-normalised results. This probe replays each transcript statement by statement in a real
// Python REPL emulation, against the buggy module and against the reference module, and compares the printed text. It exists to
// pin two inherited codefix defects that this bed may not fix (it is a pure subtraction from codefix, see README):
//   - the red-herring comment's sentence has `expected` and `got` swapped, so it contradicts its own transcript (d4/d5);
//   - Python floats print as ints (63.0 as "63") and dict keys come out sorted, so a transcript misstates real REPL output.
// Used by need-codefix-noverifier.test.mjs and by `measure.mjs fidelity`. It never touches the oracle or the hidden suite
// beyond the reference module, which only a trusted host may read.
import { spawnSync } from 'node:child_process';
import { PYTHON } from '../codefix/sandbox.mjs';

/** Expectation sentence as beds/codefix/report.mjs writes it (value forms: `v` or "it to raise X", "I get `v`" or "it raises X"). */
export const SENTENCE = /For `([^`]+)` I expected (?:`([^`]*)`|it to raise (\w+)), but (?:I get `([^`]*)`|it raises (\w+))\./;

const PY = String.raw`
import json, sys, types
req = json.loads(sys.stdin.read())

def run(stmts, name, src):
    sys.modules.pop(name, None)
    mod = types.ModuleType(name)
    sys.modules[name] = mod
    exec(compile(src, name + ".py", "exec"), mod.__dict__)
    env = {"__name__": "__main__"}
    out = []
    for s in stmts:
        seen = []
        sys.displayhook = lambda v: seen.append(v) if v is not None else None
        try:
            exec(compile(s, "<stdin>", "single"), env)
            out.append({"k": "value", "r": repr(seen[0]), "dict": isinstance(seen[0], dict)} if seen else {"k": "none"})
        except Exception as e:
            out.append({"k": "raise", "n": type(e).__name__, "m": str(e)})
    return out

print(json.dumps([{"buggy": run(t["stmts"], t["mod"], t["buggy"]), "ref": run(t["stmts"], t["mod"], t["ref"])} for t in req]))
`;

/** The REPL blocks of a bug report, each with its statements, what the transcript printed for them, and the section's sentence. */
export function replBlocks(report) {
  const blocks = [];
  // writeReport joins the issue body and each comment with a horizontal rule; every section holds at most one block.
  for (const section of report.split('\n\n---\n\n')) {
    for (const m of section.matchAll(/```\n([\s\S]*?)\n```/g)) {
      const stmts = [];
      for (const line of m[1].split('\n')) {
        if (line.startsWith('>>> ')) stmts.push({ code: line.slice(4), lines: [] });
        else stmts.at(-1).lines.push(line);
      }
      for (const s of stmts) {
        if (!s.lines.length) s.printed = { kind: 'none' };
        else if (s.lines[0].startsWith('Traceback')) s.printed = { kind: 'raise', text: s.lines.at(-1) };
        else s.printed = { kind: 'value', text: s.lines.join('\n') };
      }
      const sm = section.match(SENTENCE);
      const sentence = sm && {
        expr: sm[1],
        expected: sm[2] !== undefined ? { kind: 'value', text: sm[2] } : { kind: 'raise', name: sm[3] },
        got: sm[4] !== undefined ? { kind: 'value', text: sm[4] } : { kind: 'raise', name: sm[5] },
      };
      blocks.push({ stmts, sentence });
    }
  }
  return blocks;
}

/** How a printed text relates to the real Python result of the same statement: ok, a known deviation, or other (a misstatement). */
export function classify(printed, real) {
  if (real.k === 'none') return printed.kind === 'none' ? 'ok' : 'other';
  if (real.k === 'raise') {
    if (printed.kind !== 'raise') return 'other';
    if (printed.name !== undefined) return printed.name === real.n ? 'ok' : 'other';
    const tail = real.m ? `${real.n}: ${real.m}` : real.n;
    return printed.text === tail || printed.text.endsWith(`.${tail}`) ? 'ok' : 'other';
  }
  if (printed.kind !== 'value') return 'other';
  if (printed.text === real.r) return 'ok';
  if (real.r.replace(/(\d)\.0\b/g, '$1') === printed.text) return 'float-int';
  if (real.dict && [...printed.text].sort().join('') === [...real.r].sort().join('')) return 'dict-order';
  return 'other';
}

function replay(items) {
  const proc = spawnSync(PYTHON, ['-P', '-s', '-S', '-B', '-c', PY], {
    input: JSON.stringify(items), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 240000, killSignal: 'SIGKILL',
    env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', PYTHONHASHSEED: '0', PYTHONDONTWRITEBYTECODE: '1' },
  });
  if (proc.error || proc.status !== 0) throw new Error(`fidelity: python replay failed: ${proc.error?.message ?? proc.stderr}`);
  return JSON.parse(proc.stdout);
}

const ORDER = ['ok', 'float-int', 'dict-order', 'other'];
const zero = () => Object.fromEntries(ORDER.map(k => [k, 0]));
const closer = (a, b) => (ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b);
const keep = (list, x, n = 6) => { if (list.length < n) list.push(x); };

/**
 * Replays the bug-report transcripts of `entries` = [{ task, reference }] (a task of this bed and its reference module source).
 * Returns:
 *   statements  how every transcript line compares with real Python (against whichever of buggy/reference module fits better)
 *   sentences   per difficulty: consistent / contradict (the "I get" value is, or is not, what the sentence's transcript prints
 *               for that expression), plus how those split over blocks showing the bug (buggy and reference differ on some
 *               statement) and blocks showing correct behaviour only (the red herring: buggy and reference agree there)
 *   values      the sentences' expected / got values against real Python (same classes as statements)
 *   examples    a few offending lines for each non-ok class
 */
export function fidelity(entries) {
  const items = []; const meta = [];
  for (const { task, reference } of entries) {
    const mod = task.inputs.module_path.replace(/\.py$/, '');
    for (const block of replBlocks(task.inputs.bug_report)) {
      items.push({ mod, buggy: task.inputs.source, ref: reference, stmts: block.stmts.map(s => s.code) });
      meta.push({ task, block });
    }
  }
  const real = replay(items);
  const statements = zero(); const values = { expected: zero(), got: zero() };
  const sentences = {};
  const split = { contradictInBugBlock: 0, contradictInCorrectBlock: 0, consistentInBugBlock: 0, consistentInCorrectBlock: 0 };
  const examples = { 'float-int': [], 'dict-order': [], other: [], contradict: [] };
  meta.forEach(({ task, block }, i) => {
    const { buggy, ref } = real[i];
    const where = `d${task.difficulty} s${task.seed}`;
    block.stmts.forEach((s, k) => {
      const cls = closer(classify(s.printed, buggy[k]), classify(s.printed, ref[k]));
      statements[cls]++;
      if (cls !== 'ok') keep(examples[cls], `${where}: ${s.code} printed ${JSON.stringify(s.printed.text ?? s.printed.kind)} real ${JSON.stringify(ref[k].r ?? ref[k].n ?? ref[k].k)} / ${JSON.stringify(buggy[k].r ?? buggy[k].n ?? buggy[k].k)}`);
    });
    // A block shows the bug when the buggy and the reference module differ on some of its statements.
    const bugBlock = buggy.some((b, k) => JSON.stringify(b) !== JSON.stringify(ref[k]));
    const sent = block.sentence;
    if (!sent) return;
    const idx = block.stmts.map((s, k) => (s.code === sent.expr ? k : -1)).filter(k => k >= 0);
    // Consistent: the sentence's "I get" value is one of the values the transcript prints for that expression.
    const key = v => (v.kind === 'raise' ? 'raise' : v.text);
    const shown = idx.map(k => (block.stmts[k].printed.kind === 'raise' ? 'raise' : block.stmts[k].printed.text));
    const consistent = shown.includes(key(sent.got));
    (sentences[task.difficulty] ??= { consistent: 0, contradict: 0 })[consistent ? 'consistent' : 'contradict']++;
    split[`${consistent ? 'consistent' : 'contradict'}In${bugBlock ? 'Bug' : 'Correct'}Block`]++;
    if (!consistent) keep(examples.contradict, `${where}: ${sent.expr}: expected ${JSON.stringify(sent.expected)} got ${JSON.stringify(sent.got)}, transcript prints ${JSON.stringify(shown)}`);
    // The sentence's values against real Python: expected is the reference result; got is the buggy result (bug blocks only).
    const bestOf = (printed, side) => idx.map(k => classify(printed, side[k])).reduce(closer, 'other');
    values.expected[bestOf(sent.expected, ref)]++;
    if (bugBlock) values.got[bestOf(sent.got, buggy)]++;
  });
  return { statements, sentences, split, values, examples, blocks: meta.length };
}
