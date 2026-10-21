import json, re, collections, importlib
import labels; importlib.reload(labels)
from load import load_all
from universe import universe
A = load_all()
def parse(al):
    if al.strip() == '-': return [], []
    full, part = [], []
    for t in al.split():
        (part if t.startswith('~') else full).append(int(t.lstrip('~A')))
    return full, part
def verdict(res, full, part, U, n):
    if res is None: return 'absent'
    if res == 'N': return 'N'
    if not full and not part: return 'U+' if res == 'T' else 'FRu'
    truth = all(U[i]['per'][n] for i in full + part)
    if res == 'T': return 'TA' if truth else 'FA'
    return 'TR' if not truth else 'FR'
FR_CANON = [('compile-neg', 'negative content rule compiled as a recipient ban'), ('negcand', 'excluded-recipient list overlaps a required recipient'),
            ('unobservable', 'app not re-read by the check (blind)'), ('kind', 'wrong app/record kind in the compiled check'),
            ('mech-field', 'field semantics (tag list vs equality; verb as field)'), ('mech-dm', 'check mechanics (DM channel)'),
            ('instruction', 'instruction/rationale sentence compiled as a literal'), ('template', 'prompt placeholder kept as a literal'),
            ('merge', 'values from another item merged into the check'), ('wronglit', 'wrong literal value'), ('overstrict', 'over-strict: sheet-wide literal required in every row'),
            ('notstored', 'literal the target record does not store'), ('inverse', 'demands an effect the grader forbids'), ('notasked', 'check of something not asked'),
            ('ungraded', 'requirement the grader does not test'), ('judged', 'judged-check (checker) error'), ('wrongent', 'wrong entity')]
FA_CANON = [('judged', 'checker accepted a wrong world'), ('weak-derived', 'weak: derived value (count/total/date math) not compiled'), ('weak', 'weak: graded literal/aspect not in the check'),
            ('wronglit', 'check encodes a wrong value (ledger error), agent complied'), ('wrongent', 'check encodes a wrong entity/scope (ledger error), agent complied'), ('then fa', 'wrong requirement enforced by repair')]
def canon(cause, table):
    c = cause.lower()
    for k, v in table:
        if k in c: return v
    return 'UNEXPLAINED: ' + cause[:60]
rows = []
for a in A:
    t = a['task']; U = universe(a); lab = labels.L[t]
    rs = sorted(a['checks'])
    for p in a['pcs']['pcs']:
        al, cause = lab['c'][p['id']]
        full, part = parse(al)
        per = {}
        for n in rs:
            r = [x for x in a['checks'][n] if x['id'] == p['id']]
            res = None if not r else ('T' if r[0]['pass'] is True else 'F' if r[0]['pass'] is False else 'N')
            per[n] = verdict(res, full, part, U, n)
        rows.append(dict(task=t, id=p['id'], hard=p['hard'], type=p['type'], full=full, part=part, cause=cause, per=per, r0=per.get(0), fin=per[rs[-1]] if rs else None, last=rs[-1] if rs else None))
json.dump(rows, open('check_rows.json', 'w'))
