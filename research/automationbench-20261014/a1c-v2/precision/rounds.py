import json
from load import load_all
cuts=json.load(open('cuts.json'))
def round_grades(t):
    R=json.load(open(f'replay3/{t}.json'))
    out={}
    for n,c in cuts[t]['cuts'].items():
        r=R['all'] if c==cuts[t]['nsteps'] else R[str(c)]
        out[int(n)]=r
    return out
