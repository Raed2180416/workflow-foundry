#!/bin/bash
# D16 install for the family factory: isolated venv, exact pins, wheels only, hashes required, no deps resolution.
set -euo pipefail
cd /var/tmp/foundry-work/benches/factory
df -h / | tail -1
E=(env -i PATH=/usr/bin:/bin:/root/.local/bin HOME=/tmp UV_CACHE_DIR=/var/tmp/foundry-work/benches/factory/uv-cache
   SSL_CERT_FILE=/root/.ccr/ca-bundle.crt HTTPS_PROXY="${HTTPS_PROXY:-}" UV_NO_CONFIG=1)
"${E[@]}" uv venv --python /usr/bin/python3 venv
"${E[@]}" uv pip install --python venv/bin/python --no-deps --only-binary :all: --require-hashes -r requirements.lock
venv/bin/python -I -c "import holidays, hypothesis, dateutil, sortedcontainers; print(holidays.__version__, hypothesis.__version__, dateutil.__version__)"
venv/bin/python -I -m pip --version 2>/dev/null || true
du -sh venv uv-cache dl
