#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import subprocess
from pathlib import Path
from typing import Any

CODE_EXTS = {
    '.py', '.pyi', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts',
    '.rs', '.go', '.java', '.kt', '.kts', '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp',
    '.cs', '.fs', '.fsx', '.rb', '.php', '.swift', '.scala', '.sql', '.proto', '.graphql',
    '.sh', '.bash', '.zsh', '.fish', '.lua', '.dart', '.ex', '.exs', '.erl', '.hrl',
}
CONFIG_EXTS = {'.json', '.toml', '.yaml', '.yml', '.ini', '.cfg', '.conf', '.lock', '.xml'}
CONFIG_NAMES = {
    'package.json', 'tsconfig.json', 'pyproject.toml', 'Cargo.toml', 'Cargo.lock',
    'go.mod', 'go.sum', 'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
    'Makefile', 'Justfile', 'CMakeLists.txt', 'build.gradle', 'build.gradle.kts',
    'pom.xml', 'requirements.txt', 'uv.lock', 'pnpm-lock.yaml', 'yarn.lock',
}


def run_bytes(args: list[str], cwd: Path) -> bytes:
    return subprocess.check_output(args, cwd=cwd, stderr=subprocess.DEVNULL)


def git_root(cwd: str | Path) -> Path | None:
    try:
        out = run_bytes(['git', 'rev-parse', '--show-toplevel'], Path(cwd)).decode().strip()
        return Path(out)
    except Exception:
        return None


def _zlist(data: bytes) -> list[str]:
    return [x.decode(errors='surrogateescape') for x in data.split(b'\0') if x]


def changed_paths(root: Path) -> list[str]:
    paths: set[str] = set()
    try:
        paths.update(_zlist(run_bytes(['git', 'diff', '--name-only', '-z', 'HEAD', '--'], root)))
    except Exception:
        # Unborn repositories: tracked files have no HEAD yet.
        try:
            paths.update(_zlist(run_bytes(['git', 'ls-files', '-z'], root)))
        except Exception:
            pass
    try:
        paths.update(_zlist(run_bytes(['git', 'ls-files', '--others', '--exclude-standard', '-z'], root)))
    except Exception:
        pass
    return sorted(paths)


def file_digest(root: Path, rel: str) -> str:
    p = root / rel
    if not p.exists():
        return 'MISSING'
    if p.is_symlink():
        return 'SYMLINK:' + os.readlink(p)
    if not p.is_file():
        return 'NONFILE'
    h = hashlib.sha256()
    try:
        with p.open('rb') as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b''):
                h.update(chunk)
        return h.hexdigest()
    except Exception as exc:
        return f'UNREADABLE:{type(exc).__name__}'


def snapshot(root: Path) -> dict[str, Any]:
    try:
        head = run_bytes(['git', 'rev-parse', 'HEAD'], root).decode().strip()
    except Exception:
        head = 'UNBORN'
    files = {rel: file_digest(root, rel) for rel in changed_paths(root)}
    payload = json.dumps({'head': head, 'files': files}, sort_keys=True, separators=(',', ':')).encode()
    return {'head': head, 'files': files, 'fingerprint': hashlib.sha256(payload).hexdigest()}


def paths_changed_since(before: dict[str, Any], after: dict[str, Any]) -> list[str]:
    if before.get('head') != after.get('head'):
        return ['<git-head>'] + sorted(set(before.get('files', {})) | set(after.get('files', {})))
    b = before.get('files', {})
    a = after.get('files', {})
    return sorted(p for p in set(b) | set(a) if b.get(p) != a.get(p))


def needs_verification(paths: list[str]) -> bool:
    for rel in paths:
        if rel == '<git-head>':
            return True
        p = Path(rel)
        if p.name in CONFIG_NAMES or p.suffix.lower() in CODE_EXTS | CONFIG_EXTS:
            return True
        parts = {x.lower() for x in p.parts}
        if parts & {'migrations', 'schemas', 'schema', 'config', 'configs', 'infra', '.github'}:
            return True
    return False


def receipt_path(root: Path) -> Path:
    raw = run_bytes(['git', 'rev-parse', '--git-path', 'grok-research-verification.json'], root).decode().strip()
    p = Path(raw)
    if not p.is_absolute():
        p = root / p
    return p


def load_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def atomic_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True) + '\n')
    os.chmod(tmp, 0o600)
    tmp.replace(path)
