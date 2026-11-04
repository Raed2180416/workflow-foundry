"""Load the verifier lab into candidate views and features, keeping labels in a separate structure.

Labels (`Y`) are read from the lab rows for scoring and fitting only; the feature path receives `candidate_view(...)`,
never the row. Telemetry comes from the run's results.jsonl through the allowlist in features.telemetry_view."""
import gzip
import json
import os
import time

from features import FEATURE_VERSION, candidate_view, config_view, features

AUTOBENCH = '/var/tmp/foundry-work/autobench'
REFUSE_RUN = ('devcheck', 'test')

# Other designs' per-row outputs that may serve as features (label fields are dropped on load).
CC_HARD = {'effect.nonempty', 'text.incomplete', 'text.placeholder', 'text.date_anchor', 'target.recipients_known',
           'target.refs_composite', 'target.named_outputs', 'target.literals', 'log.tracker_written'}


def load_rows(vlab):
    rows = [json.loads(l) for l in open(os.path.join(vlab, 'dataset.jsonl'))]
    for r in rows:
        if any(s in r['run'] for s in REFUSE_RUN):
            raise SystemExit(f'refusing run {r["run"]}')
    return [r for r in rows if r['outcome'] and r['canonical']]


def load_telemetry(runs, root=AUTOBENCH):
    """(run, task) -> fork-0 object of the run's results.jsonl. Only telemetry_view() ever reads it."""
    idx = {}
    for run in sorted(runs):
        if any(s in run for s in REFUSE_RUN):
            raise SystemExit(f'refusing run {run}')
        p = os.path.join(root, run, 'results.jsonl')
        for line in open(p):
            x = json.loads(line)
            forks = x.get('forks') or []
            idx[(run, x['task'])] = forks[0] if forks else None
    return idx


def build_candidates(vlab, cache=None):
    """Returns (cands, meta): cands[i] = {'rid', 'feat'}, meta[i] = row bookkeeping for eval (task, arm, fold, label,
    cost). Cached to `cache` (JSON) keyed by FEATURE_VERSION and the dataset's size and mtime."""
    ds = os.path.join(vlab, 'dataset.jsonl')
    key = f'{FEATURE_VERSION}|{os.path.getsize(ds)}|{int(os.path.getmtime(ds))}'
    if cache and os.path.exists(cache):
        c = json.load(open(cache))
        if c.get('key') == key:
            return c['cands'], c['meta'], c['timing']
    rows = load_rows(vlab)
    tel = load_telemetry({r['run'] for r in rows})
    cands, meta = [], []
    t_feat = []
    for r in rows:
        w0 = json.load(gzip.open(os.path.join(vlab, r['worlds']['initial'])))
        cfg = config_view(r['harness'], r['actor'], date_note=not r['arm'].endswith('-pre'))
        t0 = time.perf_counter()
        view = candidate_view(r, tel.get((r['run'], r['task'])), w0, cfg)
        feat = features(view)
        t_feat.append(time.perf_counter() - t0)
        cands.append({'rid': r['rowId'], 'feat': feat})
        fork = tel.get((r['run'], r['task'])) or {}
        mtok = (((fork.get('tokens') or {}).get('byModel') or {}).get('mercury-3') or {}).get('total', 0)
        meta.append({'rid': r['rowId'], 'task': r['task'], 'arm': r['arm'], 'fold': r['fold'], 'domain': r['domain'],
                     'y': int(r['label']['task_completed_correctly'] == 1), 'pc': r['label']['partial_credit'],
                     'cost': r.get('costUsd') or 0.0, 'mercuryTokens': mtok})
    timing = {'meanFeatureMs': 1000 * sum(t_feat) / len(t_feat), 'maxFeatureMs': 1000 * max(t_feat)}
    if cache:
        json.dump({'key': key, 'cands': cands, 'meta': meta, 'timing': timing}, open(cache, 'w'))
    return cands, meta, timing


def load_views_for_consensus(vlab):
    """Light views (diff only) for pool consensus features; no labels."""
    out = {}
    for r in load_rows(vlab):
        out[r['rowId']] = {'diff': r['diff']}
    return out


def load_code_checks(path):
    """code-checks per-row outputs -> rid -> features (label fields y/pc are never copied)."""
    out = {}
    if not path or not os.path.exists(path):
        return out
    for line in open(path):
        x = json.loads(line)
        v = (x.get('v') or {}).get('facts') or {}
        checks = x.get('checks') or {}
        failed = [k for k, s in checks.items() if s == 'fail']
        out[x['rowId']] = {
            'x.cc_score': float(v.get('score', 0.0)),
            'x.cc_accept': 1.0 if v.get('accept') else 0.0,
            'x.cc_hard_fails': float(sum(1 for k in failed if k in CC_HARD)),
            'x.cc_soft_fails': float(sum(1 for k in failed if k not in CC_HARD)),
        }
    return out


def load_judge(path):
    """diverse-judges Haiku judgments -> rid -> features (judge outputs only)."""
    out = {}
    if not path or not os.path.exists(path):
        return out
    for line in open(path):
        x = json.loads(line)
        v = x.get('verdict') or {}
        if not x.get('ok'):
            out[x['rowId']] = {'x.j_p': 0.5, 'x.j_pass': 0.0, 'x.j_req': 0.5, 'x.j_notmet': 0.0, 'x.j_ok': 0.0}
            continue
        out[x['rowId']] = {
            'x.j_p': float(v.get('confidence', 0.5)),
            'x.j_pass': 1.0 if v.get('pass') else 0.0,
            'x.j_req': float(v.get('reqScore', 0.5)),
            'x.j_notmet': float(v.get('notMet', 0)),
            'x.j_ok': 1.0,
        }
    return out
