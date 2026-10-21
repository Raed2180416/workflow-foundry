"""Load the pinned SOP-Bench sources (research/sopbench-20261021/ACQUISITION.md) as DATA, without the package's own
__init__ files: only the modules the bridge needs are loaded, each from its file path, after stub packages are
registered in sys.modules (so `amazon_sop_bench.<pkg>` never executes a package __init__, the CLI, the agents' model
clients, dotenv or rich). The real files loaded: types.py, tools/base.py, tools/manager.py, benchmarks/registry.py,
benchmarks/loader.py, benchmarks/__init__.py (load_benchmark), evaluation/parser.py, evaluation/metrics.py,
evaluation/evaluator.py, agents/base.py. Stubbed: utils/logging.py (a stdlib logger to stderr; the real one only adds a
rich handler), config.py (get_config with save_traces=False: no trace files) and evaluation/reporter.py (no reports).

Imported only by experiments/sopbench/bridge.py, which runs in corpus/sop-bench-venv with `python -I` from a neutral
working directory and receives the clone path as an argument.
"""
from __future__ import annotations

import importlib.util
import logging
import sys
import types
from pathlib import Path

PKG = "amazon_sop_bench"


def _stub(name: str, **attrs):
    m = types.ModuleType(name)
    m.__path__ = []  # a package with no search path: submodules resolve only from sys.modules
    for k, v in attrs.items():
        setattr(m, k, v)
    sys.modules[name] = m
    return m


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def get_logger(name=None, *a, **k):
    lg = logging.getLogger(f"upstream.{name}")
    if not lg.handlers:
        h = logging.StreamHandler(sys.stderr)
        h.setFormatter(logging.Formatter("%(levelname)s upstream %(name)s: %(message)s"))
        lg.addHandler(h)
        lg.setLevel(logging.ERROR)
        lg.propagate = False
    return lg


class _Config:
    save_traces = False
    output_dir = Path("results")
    max_tokens = 0
    temperature = 0.0
    aws_model_id = None


class _Reporter:
    @staticmethod
    def _sanitize_model_id(model_id):
        return str(model_id).replace("/", "_").replace(":", "_")


class Upstream:
    """The loaded upstream modules. `root` is the clone (corpus/sop-bench)."""

    def __init__(self, root: str | Path):
        self.root = Path(root).resolve()
        self.src = self.root / "src" / PKG
        self.data = self.src / "benchmarks" / "data"
        if not (self.src / "evaluation" / "parser.py").is_file():
            raise FileNotFoundError(f"not a SOP-Bench clone: {self.root}")
        for k in [k for k in sys.modules if k == PKG or k.startswith(PKG + ".")]:
            del sys.modules[k]
        _stub(PKG)
        _stub(f"{PKG}.utils")
        _stub(f"{PKG}.utils.logging", get_logger=get_logger)
        _stub(f"{PKG}.config", get_config=lambda: _Config(), Config=_Config, set_config=lambda *a, **k: None)
        _stub(f"{PKG}.tools")
        _stub(f"{PKG}.benchmarks")
        _stub(f"{PKG}.evaluation")
        _stub(f"{PKG}.evaluation.reporter", ResultReporter=_Reporter)
        _stub(f"{PKG}.agents")
        self.types = _load(f"{PKG}.types", self.src / "types.py")
        self.tools_base = _load(f"{PKG}.tools.base", self.src / "tools" / "base.py")
        self.manager = _load(f"{PKG}.tools.manager", self.src / "tools" / "manager.py")
        self.registry = _load(f"{PKG}.benchmarks.registry", self.src / "benchmarks" / "registry.py")
        self.loader = _load(f"{PKG}.benchmarks.loader", self.src / "benchmarks" / "loader.py")
        # benchmarks/__init__.py: load_benchmark(name) = BenchmarkLoader().load(name) (imports only the two above).
        bench_init = _load(f"{PKG}.benchmarks.__init__", self.src / "benchmarks" / "__init__.py")
        for n in ("load_benchmark", "list_benchmarks", "BenchmarkLoader", "BenchmarkRegistry", "BenchmarkNotFoundError"):
            if hasattr(bench_init, n):
                setattr(sys.modules[f"{PKG}.benchmarks"], n, getattr(bench_init, n))
        self.parser = _load(f"{PKG}.evaluation.parser", self.src / "evaluation" / "parser.py")
        self.metrics = _load(f"{PKG}.evaluation.metrics", self.src / "evaluation" / "metrics.py")
        self.agents_base = _load(f"{PKG}.agents.base", self.src / "agents" / "base.py")
        self.evaluator = _load(f"{PKG}.evaluation.evaluator", self.src / "evaluation" / "evaluator.py")

    def output_parser(self):
        return self.parser.OutputParser()

    def benchmark_loader(self):
        return self.loader.BenchmarkLoader()
