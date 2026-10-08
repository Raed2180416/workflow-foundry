# Dev-only: regenerates fixtures/original/parsed.pyyaml.json, the PyYAML parse the Node YAML reader is tested against.
# python3 -I controls/parse-with-pyyaml.py fixtures/original/garbage_day_garage.yaml > fixtures/original/parsed.pyyaml.json   (PyYAML 6.0.1, safe_load)
import sys, json, yaml
with open(sys.argv[1]) as f:
    data = yaml.safe_load(f)
json.dump(data, sys.stdout, indent=1, sort_keys=False)
