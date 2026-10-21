"""Label-free features for the learned selector (AutomationBench verifier lab, design "learned-selector").

What a candidate (one task attempt: a request plus the world an agent left behind) may contribute:
  - the lab's verifier view: the request (system + user), the world's own date, the connected services, the diff;
  - the acting agent's own write log and its pipeline's own checks (A1-C) or prose ledger (A1);
  - run telemetry, through an explicit ALLOWLIST of results.jsonl fork fields (counts of calls, steps, tokens, the
    pipeline's termination reason and ledger statistics);
  - the harness configuration the runner chose (harness, acting and planning model family, date note);
  - the initial world WITHOUT its meta block (the agent could not read it).
Never: the label, partial credit, any grader field (n_scored, n_passed, failed_types, grade_error, n_assertions,
contract hashes), the task name, domain, run id, arm id, source paths or cost. `candidate_view` builds the only object
the feature functions see, and `assert_clean_view` refuses one that carries a forbidden key.

H7/H8: every feature is a generic signal (counts, ratios, generic text patterns). No task names, grader strings or
hidden assertions are encoded here; the hygiene test greps this file for benchmark identifiers.
"""
import json
import math
import re
from datetime import datetime, timedelta, timezone

FEATURE_VERSION = 'ls-features-v1'

# Keys that must never appear in a candidate view or its telemetry (anywhere in the nesting).
FORBIDDEN_KEYS = frozenset({
    'label', 'task', 'domain', 'run', 'arm', 'rowId', 'source', 'costUsd', 'partial_credit', 'task_completed_correctly',
    'n_scored', 'n_passed', 'failed_types', 'failedTypes', 'failedTypeCounts', 'grade_error', 'n_assertions',
    'contract_sha256', 'example_id', 'host', 'prep', 'worlds', 'canonical', 'fold', 'y', 'pc',
})

# ---------------------------------------------------------------------------------------------------------------
# Telemetry allowlist: (path in the results.jsonl fork object, transform). Anything not listed is never read.
# ---------------------------------------------------------------------------------------------------------------
TELEMETRY_NUMERIC = [
    ('steps',), ('turns',), ('durationMs',), ('nestedModelUses',),
    ('session', 'modelResponses'), ('session', 'toolResponses'), ('session', 'textOnlyResponses'),
    ('session', 'compactions'), ('session', 'l5Flags'), ('session', 'numTurns'), ('session', 'resultEvents'),
    ('session', 'sessionToolUses'), ('session', 'parallelToolResponses'), ('session', 'subagentResponses'),
    ('session', 'worldCommandResponses'), ('session', 'maxWorldResponse'), ('session', 'unmappedWorldSteps'),
    ('session', 'extraModelCalls'), ('session', 'codeSteps'), ('session', 'sessionSteps'), ('session', 'worldSteps'),
    ('usage', 'worldSteps'), ('usage', 'worldCalls'), ('usage', 'reads'), ('usage', 'searches'), ('usage', 'writes'),
    ('usage', 'helpers'), ('usage', 'invalid'),
    ('tokens', 'input'), ('tokens', 'output'), ('tokens', 'cachedInput'), ('tokens', 'total'),
    ('pipeline', 'rounds'),
    ('pipeline', 'inventory', 'steps'), ('pipeline', 'inventory', 'calls'), ('pipeline', 'inventory', 'connected'),
    ('pipeline', 'inventory', 'outOfScope'), ('pipeline', 'inventory', 'records'), ('pipeline', 'inventory', 'truncated'),
    ('pipeline', 'inventory', 'entities'), ('pipeline', 'inventory', 'titleProbes'), ('pipeline', 'inventory', 'precedents'),
    ('pipeline', 'inventory', 'chars'), ('pipeline', 'inventory', 'errors'),
    ('pipeline', 'ledger', 'readersOk'), ('pipeline', 'ledger', 'readers'), ('pipeline', 'ledger', 'items'),
    ('pipeline', 'ledger', 'positive'), ('pipeline', 'ledger', 'negative'), ('pipeline', 'ledger', 'majority'),
    ('pipeline', 'ledger', 'conflicts'), ('pipeline', 'ledger', 'settledByCode'), ('pipeline', 'ledger', 'adjudicated'),
    ('pipeline', 'ledger', 'droppedNegatives'), ('pipeline', 'ledger', 'literals'), ('pipeline', 'ledger', 'unverifiedLiterals'),
    ('pipeline', 'ledger', 'checks'), ('pipeline', 'ledger', 'hardChecks'), ('pipeline', 'ledger', 'judgedChecks'),
    ('pipeline', 'ledger', 'mappedChecks'), ('pipeline', 'ledger', 'trueAtStart'),
    ('pipeline', 'termination', 'failingHard'),
    ('ledger', 'bytes'), ('ledger', 'lines'), ('ledger', 'items'), ('ledger', 'requirements'), ('ledger', 'forbidden'),
    ('ledger', 'superseded'), ('ledger', 'flagged'), ('ledger', 'withSource'), ('ledger', 'withDate'), ('ledger', 'checked'),
    ('ledger', 'planItems'), ('ledger', 'verificationItems'),
]
TELEMETRY_FLAGS = [
    ('sessionError',), ('harnessError',), ('session', 'stopReason'), ('session', 'violations'),
    ('ledger', 'present'), ('ledger', 'hasPlan'), ('ledger', 'hasVerification'), ('ledger', 'truncated'),
    ('pipeline', 'ledger', 'today'),
]
TELEMETRY_STRINGS = [('session', 'resultSubtype'), ('pipeline', 'termination', 'reason')]


def _get(o, path):
    for k in path:
        if not isinstance(o, dict) or k not in o:
            return None
        o = o[k]
    return o


def telemetry_view(fork):
    """Copy only allowlisted telemetry out of a results.jsonl fork object (None for a missing fork)."""
    if not fork:
        return {'num': {}, 'flag': {}, 'str': {}, 'checkRounds': []}
    num = {}
    for p in TELEMETRY_NUMERIC:
        v = _get(fork, p)
        if isinstance(v, bool):
            v = int(v)
        if isinstance(v, (int, float)):
            num['.'.join(p)] = float(v)
    flag = {}
    for p in TELEMETRY_FLAGS:
        v = _get(fork, p)
        if v is None:
            continue
        if isinstance(v, (list, dict)):
            flag['.'.join(p)] = 1.0 if len(v) else 0.0
        elif isinstance(v, str):
            flag['.'.join(p)] = 1.0 if v and v not in ('none', 'unset') else 0.0
        else:
            flag['.'.join(p)] = 1.0 if v else 0.0
    st = {}
    for p in TELEMETRY_STRINGS:
        v = _get(fork, p)
        if isinstance(v, str):
            st['.'.join(p)] = v
    rounds = []
    for c in (_get(fork, ('pipeline', 'checks')) or []):
        if isinstance(c, dict):
            rounds.append({k: float(c[k]) for k in ('checks', 'pass', 'fail', 'undecided', 'hardFail', 'judged')
                           if isinstance(c.get(k), (int, float))})
    return {'num': num, 'flag': flag, 'str': st, 'checkRounds': rounds}


def config_view(harness, actor, date_note):
    """The runner's configuration for this fork: harness and model families (runtime knowledge, not a label)."""
    a = (actor or '').lower()
    m = re.search(r'([a-z0-9.\-]+) acting', a)
    acting_id = m.group(1) if m else a.split(' ')[0]
    family = lambda s: 'sonnet' if 'sonnet' in s else ('haiku' if 'haiku' in s else ('mercury' if 'mercury' in s else 'other'))
    acting = family(acting_id)
    planner = 'none'
    if harness == 'A1-C':
        planner = family(a.split(' ')[0]) if m else acting
    return {'harness': harness, 'acting': acting, 'planner': planner, 'dateNote': bool(date_note)}


def strip_meta(world):
    return {k: v for k, v in (world or {}).items() if k != 'meta'}


def candidate_view(row, fork, world0, config):
    """The only object the feature functions see. `row` is a lab dataset row; only allowlisted parts are copied."""
    v = {
        'prompt': {'system': row['prompt']['system'], 'user': row['prompt']['user']},
        'today': row.get('today'),
        'services': list(row.get('services') or []),
        'diff': row['diff'],
        'writes': row.get('writes') or {'n': 0, 'shown': 0, 'calls': []},
        'selfCheck': row.get('selfCheck'),
        'telemetry': telemetry_view(fork),
        'config': dict(config),
        'world0': strip_meta(world0),
    }
    assert_clean_view(v)
    return v


def assert_clean_view(v):
    """Refuse a view that carries a forbidden key at the top level, in telemetry, config or selfCheck."""
    bad = [k for k in v if k in FORBIDDEN_KEYS]
    for part in ('telemetry', 'config'):
        bad += [f'{part}.{k}' for k in _walk_keys(v.get(part)) if k in FORBIDDEN_KEYS]
    sc = v.get('selfCheck')
    if isinstance(sc, dict):
        bad += [f'selfCheck.{k}' for k in sc if k in FORBIDDEN_KEYS]
    if bad:
        raise ValueError(f'forbidden keys in candidate view: {bad}')


def _walk_keys(o):
    if isinstance(o, dict):
        for k, x in o.items():
            yield k
            yield from _walk_keys(x)
    elif isinstance(o, list):
        for x in o:
            yield from _walk_keys(x)


# ---------------------------------------------------------------------------------------------------------------
# Generic text patterns (no task strings).
# ---------------------------------------------------------------------------------------------------------------
RE_INCOMPLETE_STRONG = re.compile(
    r"\b(could not|couldn't|cannot|can't|unable to|not able to|failed to|no access|not connected|tbd|to be determined|"
    r"lorem ipsum|placeholder|not yet (?:available|calculated|determined)|will be (?:sent|provided|updated|calculated) once)\b",
    re.I)
RE_INCOMPLETE_WEAK = re.compile(
    r"\b(pending|unknown|n/a|please confirm|please verify|not found|missing|unclear|to follow|will follow|"
    r"i was unable|we were unable|need(?:s)? (?:more|additional) information)\b", re.I)
RE_PLACEHOLDER = re.compile(r"\{\{[^}]{0,40}\}\}|\[(?:[A-Z][A-Za-z _]{1,30})\]|<(?:[A-Z][A-Za-z _]{1,30})>|\bX{3,}\b|\$X+\b")
RE_EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
RE_CHANNEL = re.compile(r"(?<![\w&])#([a-z0-9][a-z0-9_\-]{1,40})")
RE_SNAKE_ID = re.compile(r"\b[a-z][a-z0-9]*_[a-z0-9_]+\b")
RE_CODE_ID = re.compile(r"\b[A-Z]{1,6}-?\d{2,}(?:-\d+)?\b")
RE_QUOTED = re.compile(r"[\"“']([^\"”'\n]{3,60})[\"”']")
RE_ISO_DATE = re.compile(r"\b(20\d\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b")
RE_MONTH_DATE = re.compile(
    r"\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(20\d\d)\b")
RE_NUMBER = re.compile(r"(?<![\w.])\$?\d[\d,]*(?:\.\d+)?%?")
RE_VERIF_DONE = re.compile(r"\b(done|verified|complete[d]?|confirmed|matches|ok)\b|✓|✅", re.I)
RE_VERIF_NEG = re.compile(
    r"\b(not done|not verified|skipped|failed|could not|couldn't|unable|blocked|partial(?:ly)?|pending|incomplete|"
    r"not (?:sent|created|updated|posted)|mismatch|error)\b|✗|❌", re.I)

MONTHS = {m: i + 1 for i, m in enumerate(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
                                          'September', 'October', 'November', 'December'])}

BOOKKEEPING_PATH = re.compile(
    r"(^|\.)(is_read|read|unread|seen|is_unread|updated_at|updated|modified\w*|last_modified\w*|last_\w*|etag|version|"
    r"label_ids|labels|date_updated|date_modified|\w+_at|\w+_time|\w+_date_time|\w+date)$", re.I)
TEXT_KEYS = re.compile(r"(body|text|content|message|subject|title|name|summary|description|notes?|comment\w*|desc|"
                       r"values?|cells|fields|item_name|topic|user_message|email_subject|value_\w+)$", re.I)
TARGET_KEYS = ['to', 'channel_id', 'channel', 'recipient', 'to_number', 'phone', 'email', 'assignee', 'parent_id',
               'board_id', 'list', 'list_id', 'project', 'projects', 'workspace', 'spreadsheet_id', 'worksheet_id',
               'applicationId', 'tableName', 'parent_page', 'calendarid', 'author_id', 'task_id', 'item_id', 'recordId']
SKIP_SIG_KEYS = re.compile(r"^(id|uuid|ts|thread_id|message_id|envelope_id|row_id|created\w*|updated\w*|date\w*|"
                           r"internal_date|last_\w+|\w+_at|\w+_time|join_url|start_url|password|account_sid|sid|"
                           r"label_ids|is_read|size_estimate|snippet)$", re.I)


def _strings(o, keyfilter=None, key=''):
    """All string leaves under o (optionally only under keys matching keyfilter)."""
    if isinstance(o, str):
        if keyfilter is None or keyfilter.search(key or ''):
            yield o
    elif isinstance(o, dict):
        for k, x in o.items():
            yield from _strings(x, keyfilter if keyfilter is None or not keyfilter.search(k) else None, k)
    elif isinstance(o, list):
        for x in o:
            yield from _strings(x, keyfilter, key)


def _lg(x):
    return math.log1p(max(0.0, float(x)))


def _parse_today(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace('Z', '+00:00')).astimezone(timezone.utc).replace(tzinfo=None)
    except Exception:
        return None


def _dates_in(text):
    out = []
    for y, m, d in RE_ISO_DATE.findall(text):
        try:
            out.append(datetime(int(y), int(m), int(d)))
        except ValueError:
            pass
    for mon, d, y in RE_MONTH_DATE.findall(text):
        try:
            out.append(datetime(int(y), MONTHS[mon], int(d)))
        except ValueError:
            pass
    return out


def _sig(record):
    """Content signature of a created record: its non-bookkeeping scalar fields (for duplicate detection)."""
    items = []
    for k, x in sorted(record.items()):
        if SKIP_SIG_KEYS.match(k):
            continue
        if isinstance(x, (dict, list)):
            x = json.dumps(x, sort_keys=True)[:400]
        items.append((k, str(x)[:400]))
    return tuple(items)


def _target(record):
    src = record.get('params') if isinstance(record.get('params'), dict) else record
    for k in TARGET_KEYS:
        if k in src and src[k] not in (None, '', []):
            v = src[k]
            if isinstance(v, list):
                v = ','.join(sorted(str(e) for e in v))
            return f'{k}={str(v).lower()[:80]}'
    return ''


def effect_atoms(view):
    """Coarse effect atoms of a candidate (for consensus): what kind of effect, where, on which target or record."""
    atoms = set()
    for c in view['diff']['changes']:
        app, coll, op = c.get('app'), c.get('coll'), c.get('op')
        if op == 'created':
            atoms.add((app, coll, 'c', _target(c.get('record') or {})))
        elif op == 'updated':
            paths = [p for p in (c.get('fields') or {}) if not BOOKKEEPING_PATH.search(p)]
            for p in paths:
                atoms.add((app, coll, 'u', str(c.get('id')), p))
        elif op == 'deleted':
            atoms.add((app, coll, 'd', str(c.get('id'))))
        elif op == 'set':
            atoms.add((app, coll, 's'))
    return atoms


def prompt_ids(text):
    ids = set()
    ids |= {e.lower() for e in RE_EMAIL.findall(text)}
    ids |= {'#' + c.lower() for c in RE_CHANNEL.findall(text)}
    ids |= {s for s in RE_SNAKE_ID.findall(text) if len(s) >= 4}
    ids |= set(RE_CODE_ID.findall(text))
    return ids


def _world_index(world0):
    """Collection sizes and a lowercased string blob of the initial world (connected apps only)."""
    sizes = {}
    for app, colls in world0.items():
        if not isinstance(colls, dict):
            continue
        for coll, recs in colls.items():
            if isinstance(recs, list):
                sizes[(app, coll)] = len(recs)
            elif isinstance(recs, dict):
                sizes[(app, coll)] = len(recs)
    return sizes


def features(view):
    """Feature dict (name -> float) for one candidate view. Pure function of the view."""
    f = {}
    diff = view['diff']
    changes = diff.get('changes') or []
    services = set(view.get('services') or [])
    created = [c for c in changes if c.get('op') == 'created']
    updated = [c for c in changes if c.get('op') == 'updated']
    deleted = [c for c in changes if c.get('op') == 'deleted']
    meaningful_upd = [c for c in updated if any(not BOOKKEEPING_PATH.search(p) for p in (c.get('fields') or {}))]
    f['d.n_changes'] = _lg(len(changes))
    f['d.empty'] = 1.0 if not changes else 0.0
    f['d.n_created'] = _lg(len(created))
    f['d.n_updated'] = _lg(len(updated))
    f['d.n_updated_meaningful'] = _lg(len(meaningful_upd))
    f['d.only_bookkeeping'] = 1.0 if changes and not created and not deleted and not meaningful_upd else 0.0
    f['d.n_deleted'] = _lg(len(deleted))
    f['d.any_deleted'] = 1.0 if deleted else 0.0
    f['d.n_action_records'] = _lg(len(diff.get('actionRecords') or []))
    apps = {c.get('app') for c in changes if c.get('op') != 'updated' or c in meaningful_upd}
    f['d.n_apps_effect'] = float(len(apps))
    f['d.frac_services_effect'] = len(apps & services) / len(services) if services else 0.0
    f['d.n_apps_outside_services'] = float(len(apps - services))

    # Duplicates among created records (same content signature, or same target+subject-like text).
    sigs, dups = {}, 0
    for c in created:
        s = (c.get('app'), c.get('coll'), _sig(c.get('record') or {}))
        dups += 1 if s in sigs else 0
        sigs[s] = 1
    f['d.dup_created'] = _lg(dups)
    tgt_text, dups2 = {}, 0
    for c in created:
        r = c.get('record') or {}
        head = ' '.join(str(r.get(k, ''))[:80] for k in ('subject', 'title', 'name', 'summary', 'topic', 'email_subject'))
        key = (c.get('app'), c.get('coll'), _target(r), head.strip().lower())
        if key[2] or key[3]:
            dups2 += 1 if key in tgt_text else 0
            tgt_text[key] = 1
    f['d.dup_target_title'] = _lg(dups2)

    # Output text (created records + after-values of updated text-like fields).
    texts = []
    for c in created:
        texts += list(_strings(c.get('record') or {}, TEXT_KEYS))
    for c in meaningful_upd:
        for p, ba in (c.get('fields') or {}).items():
            if BOOKKEEPING_PATH.search(p):
                continue
            before, after = (ba[0], ba[1]) if isinstance(ba, list) and len(ba) == 2 else (None, ba)
            if isinstance(before, list) and isinstance(after, list):
                prev = {json.dumps(e, sort_keys=True, default=str) for e in before}
                after = [e for e in after if json.dumps(e, sort_keys=True, default=str) not in prev]
            texts += list(_strings(after))
    out = '\n'.join(texts)
    f['t.len'] = _lg(len(out))
    f['t.n_texts'] = _lg(len(texts))
    f['t.incomplete_strong'] = _lg(len(RE_INCOMPLETE_STRONG.findall(out)))
    f['t.incomplete_weak'] = _lg(len(RE_INCOMPLETE_WEAK.findall(out)))
    f['t.placeholder'] = _lg(len(RE_PLACEHOLDER.findall(out)))
    f['t.n_numbers'] = _lg(len(RE_NUMBER.findall(out)))
    recips = set()
    for c in created:
        r = c.get('record') or {}
        for k in ('to', 'cc', 'channel_id', 'to_number', 'recipient'):
            v = r.get(k)
            if isinstance(v, list):
                recips |= {str(e).lower() for e in v}
            elif v:
                recips.add(str(v).lower())
    f['t.n_recipients'] = _lg(len(recips))

    # Dates written vs the world's own date and vs the content clock of the initial world.
    today = _parse_today(view.get('today'))
    w0_text_dates = []
    for app, colls in view['world0'].items():
        if app not in services or not isinstance(colls, dict):
            continue
        for s in _strings(colls):
            if len(w0_text_dates) > 4000:
                break
            w0_text_dates += _dates_in(s[:2000])
    content_clock = sorted(w0_text_dates)[len(w0_text_dates) // 2] if w0_text_dates else None
    out_dates = _dates_in(out)
    f['dt.n_out_dates'] = _lg(len(out_dates))
    if out_dates and today:
        f['dt.frac_near_today'] = sum(abs((d - today).days) <= 120 for d in out_dates) / len(out_dates)
    else:
        f['dt.frac_near_today'] = 0.5
    if out_dates and content_clock:
        f['dt.frac_near_content'] = sum(abs((d - content_clock).days) <= 120 for d in out_dates) / len(out_dates)
    else:
        f['dt.frac_near_content'] = 0.5
    f['dt.today_vs_content_gap'] = (_lg(abs((today - content_clock).days)) if today and content_clock else 0.0)

    # Prompt and scope.
    user = view['prompt']['user'] or ''
    f['p.len'] = _lg(len(user))
    f['p.n_services'] = float(len(services))
    ids = prompt_ids(user)
    eff_blob = json.dumps([c.get('record') or c.get('fields') or c.get('id') for c in changes], default=str).lower()
    write_blob = ' '.join((w.get('url') or '') + ' ' + (w.get('body') or '') for w in (view['writes'].get('calls') or [])).lower()
    blob = eff_blob + ' ' + write_blob
    f['p.n_ids'] = _lg(len(ids))
    f['p.frac_ids_in_effects'] = (sum(1 for i in ids if i.lower().lstrip('#') in blob) / len(ids)) if ids else 0.5
    emails = {i for i in ids if '@' in i}
    f['p.frac_emails_in_effects'] = (sum(1 for e in emails if e in eff_blob) / len(emails)) if emails else 0.5
    f['p.has_emails'] = 1.0 if emails else 0.0
    quoted = {q.strip() for q in RE_QUOTED.findall(user) if q.strip()}
    f['p.n_quoted'] = _lg(len(quoted))
    f['p.frac_quoted_in_outputs'] = (sum(1 for q in quoted if q.lower() in out.lower()) / len(quoted)) if quoted else 0.5

    sizes = _world_index(view['world0'])
    f['w.records'] = _lg(sum(n for (a, _), n in sizes.items() if a in services))
    cov = []
    for (app, coll) in {(c.get('app'), c.get('coll')) for c in meaningful_upd}:
        n = sizes.get((app, coll)) or 0
        k = len({str(c.get('id')) for c in meaningful_upd if c.get('app') == app and c.get('coll') == coll})
        if n:
            cov.append(min(1.0, k / n))
    f['w.update_coverage_mean'] = sum(cov) / len(cov) if cov else 0.0
    f['w.update_coverage_max'] = max(cov) if cov else 0.0
    f['w.n_entities_touched'] = _lg(len({(c.get('app'), c.get('coll'), str(c.get('id'))) for c in changes}))

    # The agent's own write log.
    calls = view['writes'].get('calls') or []
    nw = float(view['writes'].get('n') or 0)
    errs = [w for w in calls if w.get('looksError')]
    f['w.n_writes'] = _lg(nw)
    f['w.n_write_errors'] = _lg(len(errs))
    f['w.frac_write_errors'] = len(errs) / len(calls) if calls else 0.0
    f['w.last_write_error'] = 1.0 if calls and calls[-1].get('looksError') else 0.0
    f['w.unconnected_errors'] = _lg(sum(1 for w in errs if re.search(r'not connected|no \w+ account|401|403',
                                                                      w.get('result') or '', re.I)))
    f['w.notfound_errors'] = _lg(sum(1 for w in errs if re.search(r'404|not found', w.get('result') or '', re.I)))
    f['w.n_write_hosts'] = float(len({re.sub(r'^https?://([^/]+).*$', r'\1', w.get('url') or w.get('tool') or '')
                                      for w in calls}))
    f['w.writes_per_change'] = (nw / len(changes)) if changes else nw

    # The pipeline's own checks (A1-C) or the prose ledger (A1).
    sc = view.get('selfCheck') or {}
    kind = sc.get('kind')
    f['sc.is_a1c'] = 1.0 if kind == 'a1c-checks' else 0.0
    f['sc.is_a1'] = 1.0 if kind == 'a1-prose-ledger' else 0.0
    if kind == 'a1c-checks':
        checks = sc.get('checks') or []
        n = len(checks)
        f['sc.n_checks'] = _lg(sc.get('nChecks') or n)
        f['sc.n_fail'] = _lg(sc.get('nFail') or 0)
        f['sc.n_undecided'] = _lg(sc.get('nUndecided') or 0)
        f['sc.hard_fail'] = _lg(sc.get('hardFail') or 0)
        f['sc.all_pass'] = 1.0 if sc.get('allPass') else 0.0
        f['sc.rounds'] = float(sc.get('rounds') or 0)
        f['sc.frac_pass'] = (sum(1 for c in checks if c.get('pass') is True) / n) if n else 0.0
        f['sc.n_by_checker'] = _lg(sum(1 for c in checks if c.get('by') == 'checker'))
        f['sc.fail_by_code'] = _lg(sum(1 for c in checks if c.get('pass') is False and c.get('by') == 'code'))
        f['sc.fail_by_checker'] = _lg(sum(1 for c in checks if c.get('pass') is False and c.get('by') == 'checker'))
        f['sc.n_negative'] = _lg(sum(1 for c in checks if c.get('polarity') == 'negative'))
        f['sc.fail_negative'] = _lg(sum(1 for c in checks if c.get('polarity') == 'negative' and c.get('pass') is False))
        term = sc.get('termination') or ''
        f['sc.term_all_pass'] = 1.0 if term == 'all checks pass' else 0.0
        f['sc.term_max_rounds'] = 1.0 if term.startswith('max repair') else 0.0
        f['sc.term_advisory'] = 1.0 if term.startswith('only advisory') else 0.0
    elif kind == 'a1-prose-ledger':
        ver = sc.get('verification') or ''
        lines = [l for l in ver.split('\n') if l.strip().startswith(('-', '*')) or re.match(r'\s*\d+[.)]', l)]
        f['sc.a1_ver_items'] = _lg(len(lines))
        f['sc.a1_ver_done'] = _lg(sum(1 for l in lines if RE_VERIF_DONE.search(l) and not RE_VERIF_NEG.search(l)))
        f['sc.a1_ver_neg'] = _lg(sum(1 for l in lines if RE_VERIF_NEG.search(l)))
        f['sc.a1_ver_frac_neg'] = (sum(1 for l in lines if RE_VERIF_NEG.search(l)) / len(lines)) if lines else 0.0
        f['sc.a1_no_verification'] = 1.0 if not ver.strip() else 0.0
        f['sc.a1_ledger_chars'] = _lg(sc.get('ledgerChars') or len(sc.get('ledger') or ''))

    # Run telemetry (allowlisted).
    tel = view['telemetry']
    for k, x in tel['num'].items():
        f['r.' + k] = _lg(x)
    for k, x in tel['flag'].items():
        f['r.' + k] = x
    f['r.success'] = 1.0 if tel['str'].get('session.resultSubtype') == 'success' else 0.0
    rounds = tel.get('checkRounds') or []
    if rounds:
        first, last = rounds[0], rounds[-1]
        f['r.checks_first_fail'] = _lg(first.get('fail', 0))
        f['r.checks_last_fail'] = _lg(last.get('fail', 0))
        f['r.checks_fail_drop'] = (first.get('fail', 0) - last.get('fail', 0)) / max(1.0, first.get('checks', 1))
        f['r.checks_last_hardfail'] = _lg(last.get('hardFail', 0))

    # Harness configuration.
    cfg = view['config']
    f['c.A0'] = 1.0 if cfg['harness'] == 'A0' else 0.0
    f['c.A1'] = 1.0 if cfg['harness'] == 'A1' else 0.0
    f['c.A1C'] = 1.0 if cfg['harness'] == 'A1-C' else 0.0
    f['c.acting_sonnet'] = 1.0 if cfg['acting'] == 'sonnet' else 0.0
    f['c.planner_mercury'] = 1.0 if cfg['planner'] == 'mercury' else 0.0
    f['c.planner_sonnet'] = 1.0 if cfg['planner'] == 'sonnet' else 0.0
    f['c.date_note'] = 1.0 if cfg['dateNote'] else 0.0
    return f


IDENTITY_PREFIX = 'c.'


def consensus_features(views):
    """Pool-relative features: how much of each candidate's effects the other candidates in the same pool share.
    `views` is the list of candidate views for ONE task's pool; returns one dict per view (same order)."""
    atoms = [effect_atoms(v) for v in views]
    nchg = [len(v['diff'].get('changes') or []) for v in views]
    out = []
    for i, a in enumerate(atoms):
        others = [b for j, b in enumerate(atoms) if j != i]
        if not others:
            out.append({'k.jacc_mean': 0.5, 'k.jacc_max': 0.5, 'k.support': 0.5, 'k.rel_size': 0.0, 'k.pool_n': 0.0})
            continue
        def jac(x, y):
            return len(x & y) / len(x | y) if (x | y) else 1.0
        js = [jac(a, b) for b in others]
        sup = (sum(1 for t in a if sum(1 for b in others if t in b) >= max(1, len(others) / 2)) / len(a)) if a else 0.0
        med = sorted(nchg)[len(nchg) // 2]
        out.append({'k.jacc_mean': sum(js) / len(js), 'k.jacc_max': max(js), 'k.support': sup,
                    'k.rel_size': math.log1p(nchg[i]) - math.log1p(med), 'k.pool_n': math.log(len(views))})
    return out
