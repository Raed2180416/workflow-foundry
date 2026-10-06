#!/usr/bin/env python3
"""Shallow, sparse, blob-filtered clones of the licensed template directories used by the automation
cluster (no LFS, no submodules, hooks disabled, nothing built or installed). Raw -> /opt/corpus/<platform>/repo.
Pass `--pin` to check out the exact SHAs recorded in automation-ledger.md instead of the default branch HEAD.
Usage: python3 -I automation-fetch-git.py [--pin]
"""
import os, subprocess, sys

REPOS = [
    ('langflow', 'https://github.com/langflow-ai/langflow', '504c02fc47e76087b82b0e7cbe4186e9cdd916d4',
     ['/LICENSE', '/src/backend/base/langflow/initial_setup/starter_projects/']),
    ('flowise', 'https://github.com/FlowiseAI/Flowise', '9291856d1ea4a4ceea9f8fef8ce14f4f6c81e8eb',
     ['/LICENSE.md', '/packages/server/marketplaces/']),
    ('coze', 'https://github.com/coze-dev/coze-studio', 'fefb05ff27be1da939612fbf9faf5db62583b8ae',
     ['/LICENSE-APACHE', '/backend/domain/workflow/internal/canvas/examples/', '/backend/domain/workflow/entity/node_meta.go']),
]
GIT = ['git', '-c', 'core.hooksPath=/dev/null', '-c', 'filter.lfs.smudge=', '-c', 'filter.lfs.required=false']


def run(*a):
    subprocess.run(list(a), check=True)


pin = '--pin' in sys.argv
for name, url, sha, paths in REPOS:
    d = f'/opt/corpus/{name}/repo'
    if not os.path.isdir(d):
        os.makedirs(os.path.dirname(d), exist_ok=True)
        run(*GIT, 'clone', '-q', '--depth', '1', '--filter=blob:none', '--no-checkout', '--no-recurse-submodules', url, d)
    run(*GIT, '-C', d, 'sparse-checkout', 'set', '--no-cone', *paths)
    if pin:
        run(*GIT, '-C', d, 'fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', sha)
        run(*GIT, '-C', d, 'checkout', '-q', sha)
    else:
        run(*GIT, '-C', d, 'checkout', '-q')
    print(name, subprocess.run(['git', '-C', d, 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip())
