import json
from load import load_all
cuts=json.load(open('cuts.json'))
def flat(o, p='', out=None):
    if out is None: out={}
    if isinstance(o, dict):
        for k,v in o.items(): flat(v, f'{p}/{k}', out)
    elif isinstance(o, list):
        # key list items by id when possible
        for i,v in enumerate(o):
            k = v.get('id') if isinstance(v, dict) and 'id' in v else i
            flat(v, f'{p}[{k}]', out)
    else: out[p]=o
    return out
def worlds(a):
    t=a['task']; R=json.load(open(f'replay3/{t}.json')); W={}
    for n,c in cuts[t]['cuts'].items():
        W[int(n)] = json.load(open(f"{a['dir']}/final-world.json")) if c==cuts[t]['nsteps'] else R[str(c)]['world']
    return W
def diff(w0, w1):
    f0, f1 = flat(w0), flat(w1)
    ch = [k for k in set(f0)|set(f1) if f0.get(k, '<none>') != f1.get(k, '<none>')]
    return ch
