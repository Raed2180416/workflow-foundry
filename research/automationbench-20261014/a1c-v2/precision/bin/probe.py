import sys, json, asyncio, importlib.util, traceback
bridge_path, inp, world = sys.argv[1:4]
spec = importlib.util.spec_from_file_location('bridge_mod', bridge_path)
B = importlib.util.module_from_spec(spec); spec.loader.exec_module(B)
B.SHIM.install('record')
row = B.load_json(inp)
r = B.Rollout(row, 50, B.load_world(world), 0)
asyncio.run(r.setup())
from automationbench.rubric.registry import AssertionRegistry
info = r.state['info']; info = json.loads(info) if isinstance(info, str) else info
for a in info['assertions']:
    try:
        print(a['type'], AssertionRegistry.check(r.state['world'], a))
    except Exception as e:
        print(a['type'], 'EXC', type(e).__name__, str(e)[:300])
