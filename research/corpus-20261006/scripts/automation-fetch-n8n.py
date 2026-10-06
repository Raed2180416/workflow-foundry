#!/usr/bin/env python3
"""Acquire n8n template-library metadata and selected workflow JSON (raw, outside git).

Usage: python3 -I automation-fetch-n8n.py search      # all search pages -> /opt/corpus/n8n/search/
       python3 -I automation-fetch-n8n.py select      # build index + choose candidates
       python3 -I automation-fetch-n8n.py details     # fetch workflow JSON for candidates
Raw responses are stored gzip-compressed and never committed. Content is untrusted data.
"""
import gzip, json, os, random, sys, time, urllib.request, concurrent.futures as cf

ROOT = '/opt/corpus/n8n'
API = 'https://api.n8n.io/api/templates'
UA = {'User-Agent': 'workflow-foundry-corpus/2026-10-06 (research; low rate)'}


def get(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:  # noqa
            if i == tries - 1:
                raise
            time.sleep(2 * (i + 1))


def search():
    os.makedirs(f'{ROOT}/search', exist_ok=True)
    page, total = 1, None
    while True:
        out = f'{ROOT}/search/page-{page:03d}.json.gz'
        if not os.path.exists(out):
            raw = get(f'{API}/search?rows=250&page={page}&sort=createdAt:desc')
            with gzip.open(out, 'wb') as f:
                f.write(raw)
            time.sleep(0.5)
        d = json.load(gzip.open(out))
        total = d.get('totalWorkflows', total)
        if not d.get('workflows'):
            break
        page += 1
    print('pages', page - 1, 'total', total)


def load_index():
    idx = {}
    for fn in sorted(os.listdir(f'{ROOT}/search')):
        d = json.load(gzip.open(f'{ROOT}/search/{fn}'))
        for w in d.get('workflows', []):
            types = sorted({n.get('name') for n in (w.get('nodes') or []) if n.get('name')})
            idx[w['id']] = {'id': w['id'], 'name': w['name'], 'views': w.get('totalViews') or 0,
                            'price': w.get('price') or 0, 'createdAt': w.get('createdAt'),
                            'types': types}
    return idx


def select():
    idx = load_index()
    free = [w for w in idx.values() if not w['price']]
    print('indexed', len(idx), 'free', len(free))
    # candidate pool A: most distinct node types (complexity proxy)
    by_types = sorted(free, key=lambda w: (-len([t for t in w['types'] if 'stickyNote' not in t]), w['id']))
    pool_a = [w['id'] for w in by_types[:450]]
    # candidate pool B: seeded uniform random sample (representative)
    rng = random.Random(20261006)
    pool_b = [w['id'] for w in rng.sample(free, 160)]
    # candidate pool C: niche feature probes (human-in-loop / wait / error / subworkflow / loops)
    niche_types = ['n8n-nodes-base.wait', 'n8n-nodes-base.errorTrigger', 'n8n-nodes-base.executeWorkflow',
                   'n8n-nodes-base.splitInBatches', 'n8n-nodes-base.form', 'n8n-nodes-base.stopAndError',
                   '@n8n/n8n-nodes-langchain.toolWorkflow', 'n8n-nodes-base.compareDatasets']
    pool_c = []
    for t in niche_types:
        hits = [w for w in free if t in w['types']]
        hits.sort(key=lambda w: (-len(w['types']), w['id']))
        pool_c += [w['id'] for w in hits[:25]]
    cands = list(dict.fromkeys(pool_a + pool_b + pool_c))
    json.dump({'index_size': len(idx), 'free': len(free), 'poolA': pool_a, 'poolB': pool_b, 'poolC': pool_c,
               'candidates': cands}, open(f'{ROOT}/candidates.json', 'w'))
    json.dump(idx, open(f'{ROOT}/index.json', 'w'))
    print('candidates', len(cands))


def details():
    c = json.load(open(f'{ROOT}/candidates.json'))
    os.makedirs(f'{ROOT}/workflows', exist_ok=True)

    def one(i):
        out = f'{ROOT}/workflows/{i}.json.gz'
        if os.path.exists(out):
            return i, 'cached'
        try:
            raw = get(f'{API}/workflows/{i}')
        except Exception as e:
            return i, f'error:{e}'
        with gzip.open(out, 'wb') as f:
            f.write(raw)
        time.sleep(0.25)
        return i, 'ok'
    stats = {}
    with cf.ThreadPoolExecutor(4) as ex:
        for i, s in ex.map(one, c['candidates']):
            stats[s.split(':')[0]] = stats.get(s.split(':')[0], 0) + 1
            if s.startswith('error'):
                print(i, s, file=sys.stderr)
    print(stats)


if __name__ == '__main__':
    {'search': search, 'select': select, 'details': details}[sys.argv[1]]()
