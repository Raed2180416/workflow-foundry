#!/usr/bin/env python3
"""Run the ORIGINAL corpus normaliser's n8n classification on n8n JSON files and print its verdicts as JSON.

Used by app/test/n8n-import.test.mjs to check that app/importers/n8n.mjs is a faithful port. It loads
research/corpus-20261006/scripts/automation-normalize.py by path and repeats the per-file part of its
n8n_items() (L441-L479), which is hard-wired to /opt/corpus paths. Workflow files are data only.

Usage: python3 -I app/importers/normaliser-parity.py FILE.json [FILE.json ...]
"""
import importlib.util, json, os, sys, types

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, '..', '..', 'research', 'corpus-20261006', 'scripts', 'automation-normalize.py')
if 'yaml' not in sys.modules:
    try:
        import yaml  # noqa: F401  (the n8n path never uses it)
    except ImportError:
        sys.modules['yaml'] = types.ModuleType('yaml')
spec = importlib.util.spec_from_file_location('automation_normalize', SCRIPT)
norm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(norm)


def verdict_of(wf):
    g = norm.Graph(False)
    names, retry, ext = {}, 0, set()
    per_node = []
    for node in wf.get('nodes') or []:
        t = node.get('type', '')
        r = norm.n8n_node(t, node.get('parameters'), node)
        if r is None:
            continue
        cat, eff, asy, x, opdesc = r
        if node.get('retryOnFail'):
            retry += 1
        if node.get('onError') in ('continueRegularOutput', 'continueErrorOutput'):
            x = set(x) | {'error-branch'}
        conn = norm.n8n_connector(t)
        g.add(node['name'], t, cat, eff, t.split('.')[-1], **{'async': asy, 'connectors': [conn] if conn else [], 'ext': x})
        names[node['name']] = node
        per_node.append({'name': node['name'], 'category': cat, 'effects': eff, 'connector': conn})
    for src, conns in (wf.get('connections') or {}).items():
        srcnode = names.get(src)
        for ctype, outputs in (conns or {}).items():
            for port, targets in enumerate(outputs or []):
                for tgt in targets or []:
                    kind = 'data'
                    if ctype == 'ai_tool':
                        kind = 'control'
                    elif ctype == 'error':
                        kind = 'error'
                    elif ctype == 'main' and srcnode is not None and srcnode.get('onError') == 'continueErrorOutput' \
                            and port == len(outputs) - 1 and len(outputs) >= 2:
                        kind = 'error'
                    g.edge(src, tgt.get('node'), kind, port if ctype == 'main' else f'{ctype}:{port}', tool=(ctype == 'ai_tool'))
    if retry:
        ext.add('retry-policy')
    base = norm.base_item('n8n', 'x', 'https://example.invalid/x', 'r', 'MIT', 'e', True, 'raw', 't')
    item = norm.finalize(g, base, [], ext, norm.ORACLE_NONE, '', 'n8n parity check')
    return {'verdict': item['ir']['verdict'], 'nodes': per_node}


out = {}
for path in sys.argv[1:]:
    with open(path, encoding='utf-8') as fh:
        data = json.load(fh)
    wf = data if isinstance(data.get('nodes'), list) else (data.get('workflow') or {})
    out[path] = verdict_of(wf)
json.dump(out, sys.stdout)
