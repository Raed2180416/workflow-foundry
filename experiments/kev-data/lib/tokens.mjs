// Real Qwen3.5 token counts and Kev's own fits() (JUDGE-PROGRAM.md §1.0 state budget, §2.3 rule 6,
// §10 global acceptance 6). The pinned tokenizer (Qwen/Qwen3.5-0.8B-Base@dc7cdfe2) and Kev's code
// (5e42a7a0) run in /opt/kev-venv under `python -I`, offline, one process per batch: Kev's import
// costs about 5 s and the tokenizer about 1.5 s, so callers batch every record of a file into one
// call. Nothing here trains, serves or downloads.
//   count     len(kev.model.user_tokens(tok, text)) per text (no special tokens)
//   measure   kev.data.materialize(record), then kev.model.fits(rec, tok, **training_context(max_state))
//             - the factory's admission rule - plus the state and packed token counts
//   measure_job  measure at max_state, then the job max_state (the fitting records' p99.9 state tokens,
//             clamped to [floor, max_state]) and fits() again at it, in the same process (§2.3 rule 6)
//   load_file kev.data.load_records(path) + materialize + fits for every line of a Kev JSONL file
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export const PYTHON = process.env.KEV_DATA_PYTHON ?? '/opt/kev-venv/bin/python';
export const KEV = Object.freeze({ root: process.env.KEV_DATA_KEV_ROOT ?? '/home/user/jaredpalmer/kev', commit: '5e42a7a03f28134853dd3ff77461457e921e5ec1' });
export const TOKENIZER = Object.freeze({ repo: 'Qwen/Qwen3.5-0.8B-Base', revision: 'dc7cdfe2ee4154fa7e30f5b51ca41bfa40174e68' });
export const HF_HOME = process.env.KEV_DATA_HF_HOME ?? '/opt/hf-cache';
export const KEV_MAX_STATE = Object.freeze({ training: 384, bridge: 8192, served: 65536 });   // kev.model MAX_STATE, bridge maxState, SERVE_MAX_STATE

const MARK = '@@KEV_DATA_JSON@@';
const PY = String.raw`
import sys, json, math
kev_root, repo, rev, mark = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
sys.path.insert(0, kev_root)
req = json.loads(sys.stdin.read())
from kev.model import load_tokenizer, user_tokens, fits, encode, training_context
tok = load_tokenizer(repo, revision=rev)
def measure(rec, ctx, render):
    st = len(user_tokens(tok, rec["state"])) + 1
    ok = bool(fits(rec, tok, **ctx))
    packed, err = None, None
    try:
        packed = len(encode(tok, rec, max_state=ctx["max_state"], max_branch=ctx["max_branch"], strict=True)["ids"])
    except ValueError as e:
        err = str(e)[:300]
    out = {"ok": True, "fits": ok, "stateTokens": st, "packedTokens": packed, "error": err}
    if render: out["stateText"] = rec["state"]
    return out
results = []
for op in req["ops"]:
    kind = op["op"]
    if kind == "count":
        results.append({"counts": [len(user_tokens(tok, t)) for t in op["texts"]]})
    elif kind == "measure":
        from kev.data import materialize
        ctx = training_context(op["maxState"]); res = []
        for r in op["records"]:
            for q in r.get("questions", {}).values():
                if isinstance(q, dict): q.setdefault("src", "kevdata_" + q.get("type", "choice"))
            try:
                rec = materialize(r)
            except Exception as e:
                res.append({"ok": False, "fits": False, "error": type(e).__name__ + ": " + str(e)[:300]}); continue
            res.append(measure(rec, ctx, op.get("render", False)))
        results.append({"results": res, "context": ctx})
    elif kind == "measure_job":
        from kev.data import materialize
        ms = op["maxState"]; ctx = training_context(ms); res = []; recs = []
        for r in op["records"]:
            for q in r.get("questions", {}).values():
                if isinstance(q, dict): q.setdefault("src", "kevdata_" + q.get("type", "choice"))
            try:
                rec = materialize(r)
            except Exception as e:
                res.append({"ok": False, "fits": False, "error": type(e).__name__ + ": " + str(e)[:300]}); recs.append(None); continue
            res.append(measure(rec, ctx, False)); recs.append(rec)
        xs = sorted(x["stateTokens"] for x in res if x["fits"])
        job, jres = None, None
        if xs:
            n = len(xs); i = min(n - 1, max(0, math.ceil(op["q"] * n) - 1))
            job = min(ms, op["cap"], max(op["floor"], xs[i]))
            if job < ms:
                jctx = training_context(job)
                jres = [measure(rec, jctx, False) for rec, x in zip(recs, res) if x["fits"]]
        results.append({"results": res, "context": ctx, "job": {"maxState": job, "results": jres}})
    elif kind == "load_file":
        from kev.data import load_records, materialize
        ctx = training_context(op["maxState"])
        recs = load_records(op["path"], source=op.get("source", "custom")); res = []
        for r in recs:
            m = r["_meta"]
            try:
                item = measure(materialize(r), ctx, False)
            except Exception as e:
                item = {"ok": False, "fits": False, "error": type(e).__name__ + ": " + str(e)[:300]}
            item.update({"id": m["id"], "source": m["source"], "variant": m["variant"], "questions": sorted(r["questions"]),
                         "src": sorted({q["src"] for q in r["questions"].values()})})
            res.append(item)
        results.append({"records": len(recs), "results": res, "context": ctx})
    else:
        raise ValueError("unknown op " + kind)
print(mark + json.dumps(results))
`;

let kevChecked = null;
export function checkKevPin() {
  if (kevChecked) return kevChecked;
  if (!existsSync(PYTHON)) throw new Error(`KEV_ENV: ${PYTHON} not found`);
  const r = spawnSync('git', ['-C', KEV.root, 'rev-parse', 'HEAD'], { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  const head = r.stdout?.trim();
  if (r.status !== 0 || head !== KEV.commit) throw new Error(`KEV_PIN: Kev checkout ${KEV.root} is at ${head || '?'}, pinned ${KEV.commit}`);
  return (kevChecked = { python: PYTHON, kev: KEV, tokenizer: TOKENIZER });
}

// Run several ops in one Python process. Returns one result per op.
export function kevBatch(ops, { timeoutMs = 20 * 60 * 1000 } = {}) {
  checkKevPin();
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', LANG: 'C.UTF-8',
    HF_HOME, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_DATASETS_OFFLINE: '1', TOKENIZERS_PARALLELISM: 'false',
    TRANSFORMERS_VERBOSITY: 'error', PYTHONDONTWRITEBYTECODE: '1' };
  const r = spawnSync(PYTHON, ['-I', '-c', PY, KEV.root, TOKENIZER.repo, TOKENIZER.revision, MARK],
    { input: JSON.stringify({ ops }), encoding: 'utf8', env, maxBuffer: 1 << 30, timeout: timeoutMs });
  const line = (r.stdout ?? '').split('\n').find(l => l.startsWith(MARK));
  if (r.status !== 0 || !line) throw new Error(`KEV_PYTHON: exit ${r.status ?? r.signal}: ${(r.stderr ?? '').trim().split('\n').slice(-5).join(' | ')}`);
  return JSON.parse(line.slice(MARK.length));
}

export const countTokens = texts => kevBatch([{ op: 'count', texts }])[0].counts;
export const measureRecords = (records, { maxState = KEV_MAX_STATE.bridge, render = false } = {}) => kevBatch([{ op: 'measure', records, maxState, render }])[0].results;
export const fitsRecords = (records, opts) => measureRecords(records, opts).map(r => r.fits);
// Both admission passes of a build in one Python process: { results (at maxState), job: { maxState, results }
// } where job.results is aligned to the records that fit at maxState (null when the job maxState is
// maxState itself). The job maxState is jobMaxState() of the fitting records' state tokens; the build
// recomputes it in JS and refuses a mismatch.
export function measureForJob(records, { maxState = KEV_MAX_STATE.bridge } = {}) {
  const [r] = kevBatch([{ op: 'measure_job', records, maxState, q: JOB_QUANTILE, floor: KEV_MAX_STATE.training, cap: KEV_MAX_STATE.bridge }]);
  return { results: r.results, job: r.job };
}
export const validateKevFile = (path, { maxState = KEV_MAX_STATE.bridge, source = 'custom' } = {}) => kevBatch([{ op: 'load_file', path, maxState, source }])[0];

// The documented estimate the program replaces (beds/lib/canonical.mjs estimateTokens).
export const bytes4 = text => Math.ceil(Buffer.byteLength(String(text)) / 4);
export function quantile(xs, q) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))] : NaN;
}
// A job's maxState (§2.3 rule 6): the build's 99.9th percentile of real state tokens, within Kev's
// training range [384, 65536] and the bridge's 8192.
export const JOB_QUANTILE = 0.999;
export const jobMaxState = stateTokens => Math.min(KEV_MAX_STATE.bridge, Math.max(KEV_MAX_STATE.training, quantile(stateTokens, JOB_QUANTILE)));
