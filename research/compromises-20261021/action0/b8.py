# Compromise register B8 check (2026-10-21, FIXES.md Action 0): how many of the fetched n8n templates were created
# after a June 2026 training cutoff? Reads only date metadata (createdAt) from each fetched file and from index.json;
# no description text is read out or printed. The templates are local only (no open licence), never committed.
#   python3 -I research/compromises-20261021/action0/b8.py /opt/corpus/n8n
import json, gzip, os, sys, collections
root = sys.argv[1]
wf = os.path.join(root, 'workflows'); files = sorted(os.listdir(wf))
def created(o):
    # breadth-first search for a 'createdAt' string, keys only
    q = [o]
    while q:
        x = q.pop(0)
        if isinstance(x, dict):
            if isinstance(x.get('createdAt'), str): return x['createdAt']
            q.extend(v for v in x.values() if isinstance(v, (dict, list)))
        elif isinstance(x, list):
            q.extend(v for v in x[:5] if isinstance(v, (dict, list)))
    return None
dates = {}; bad = 0
for f in files:
    try: d = json.load(gzip.open(os.path.join(wf, f), 'rt'))
    except Exception: bad += 1; continue
    c = created(d)
    if c: dates[f.split('.')[0]] = c[:10]
print('files', len(files), 'with createdAt', len(dates), 'unreadable', bad)
print('by year', dict(sorted(collections.Counter(v[:4] for v in dates.values()).items())))
print('2026 by month', dict(sorted(collections.Counter(v[:7] for v in dates.values() if v >= '2026').items())))
print('created >= 2026-07-01 (after a June 2026 cutoff):', sum(v >= '2026-07-01' for v in dates.values()))
idx = json.load(open(os.path.join(root, 'index.json')))
agree = sum(1 for k, v in dates.items() if k in idx and (idx[k].get('createdAt') or '')[:10] == v)
print('index.json createdAt agrees with file createdAt for', agree, 'of', len(dates))
