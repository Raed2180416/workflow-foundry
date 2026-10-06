#!/usr/bin/env bash
# Idempotent installer for Node.js v24.21.0 (linux-x64) into /opt/node24 (ROADMAP §5.0).
#
# Source:  https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz
# sha256:  fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6
#          (nodejs.org dist/v24.21.0/SHASUMS256.txt; pinned here, never fetched at run time)
#
# - Already installed (v24.21.0 at the prefix, symlinks correct): no-op, no network access.
# - Otherwise: download over HTTPS, verify the pinned sha256, REFUSE on mismatch, extract into a
#   staging directory next to the prefix and rename it into place.
# - Symlinks node, npm and npx into the bin dir. It does not run npm, corepack or any install
#   hook, and it never overwrites a regular file or a different Node version at the prefix.
#
# Usage: scripts/setup-node24.sh [--check]
#   --check   verify only; exit 0 when installed and linked, 1 otherwise; never downloads.
# Env (for testing in a scratch location only): FOUNDRY_NODE24_PREFIX (default /opt/node24),
#   FOUNDRY_NODE24_BIN_DIR (default /root/.local/bin).
set -euo pipefail

NODE_VERSION="v24.21.0"
NODE_DIST="node-${NODE_VERSION}-linux-x64"
NODE_TARBALL="${NODE_DIST}.tar.xz"
NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_TARBALL}"
NODE_SHA256="fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6"
PREFIX="${FOUNDRY_NODE24_PREFIX:-/opt/node24}"
BIN_DIR="${FOUNDRY_NODE24_BIN_DIR:-/root/.local/bin}"
LINKS=(node npm npx)

log() { printf 'setup-node24: %s\n' "$*"; }
die() { printf 'setup-node24: ERROR: %s\n' "$1" >&2; exit "${2:-1}"; }

CHECK_ONLY=0
case "${1:-}" in
  "") ;;
  --check) CHECK_ONLY=1 ;;
  *) die "usage: $0 [--check]" 2 ;;
esac

[ "$(uname -s)" = "Linux" ] || die "only linux is supported (found $(uname -s))" 2
[ "$(uname -m)" = "x86_64" ] || die "only x86_64 is supported (found $(uname -m))" 2

installed_version() {
  if [ -x "$PREFIX/bin/node" ]; then "$PREFIX/bin/node" --version 2>/dev/null || true; fi
}

links_ok() {
  local b
  for b in "${LINKS[@]}"; do
    [ -L "$BIN_DIR/$b" ] && [ "$(readlink "$BIN_DIR/$b")" = "$PREFIX/bin/$b" ] || return 1
  done
}

ensure_links() {
  mkdir -p "$BIN_DIR"
  local b link target current
  for b in "${LINKS[@]}"; do
    link="$BIN_DIR/$b"; target="$PREFIX/bin/$b"
    [ -e "$target" ] || die "missing $target after install" 5
    if [ -L "$link" ]; then
      current="$(readlink "$link")"
      [ "$current" = "$target" ] && continue
      log "relinking $link (was -> $current)"
    elif [ -e "$link" ]; then
      die "$link exists and is not a symlink; refusing to overwrite it" 6
    else
      log "linking $link -> $target"
    fi
    ln -sfn "$target" "$link"
  done
}

current="$(installed_version)"
if [ "$CHECK_ONLY" = 1 ]; then
  if [ "$current" = "$NODE_VERSION" ] && links_ok; then
    log "ok: node $NODE_VERSION at $PREFIX; ${LINKS[*]} linked in $BIN_DIR"; exit 0
  fi
  log "not ready: installed='${current:-none}', links $(links_ok && echo ok || echo missing/incorrect)"; exit 1
fi

if [ "$current" = "$NODE_VERSION" ]; then
  if links_ok; then
    log "node $NODE_VERSION already installed at $PREFIX and linked in $BIN_DIR; nothing to do"
    exit 0
  fi
  log "node $NODE_VERSION already installed at $PREFIX; fixing symlinks only"
  ensure_links
else
  if [ -e "$PREFIX" ] && [ -n "$(ls -A "$PREFIX" 2>/dev/null)" ]; then
    die "$PREFIX exists but does not hold node $NODE_VERSION (found '${current:-unknown}'); refusing to overwrite. Remove it manually and re-run." 3
  fi
  command -v curl >/dev/null || die "curl is required" 2
  command -v sha256sum >/dev/null || die "sha256sum is required" 2
  command -v xz >/dev/null || die "xz is required to extract $NODE_TARBALL" 2

  parent="$(dirname "$PREFIX")"
  mkdir -p "$parent"
  staging="$(mktemp -d "$parent/.node24-staging.XXXXXX")"
  trap 'rm -rf "$staging"' EXIT

  log "downloading $NODE_URL"
  curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --connect-timeout 20 --max-time 600 \
    -o "$staging/$NODE_TARBALL" "$NODE_URL"

  actual="$(sha256sum "$staging/$NODE_TARBALL" | cut -d' ' -f1)"
  if [ "$actual" != "$NODE_SHA256" ]; then
    die "sha256 mismatch for $NODE_TARBALL: expected $NODE_SHA256, got $actual; refusing to install" 4
  fi
  log "sha256 verified: $actual"

  mkdir "$staging/x"
  tar -xJf "$staging/$NODE_TARBALL" -C "$staging/x" --no-same-owner
  [ -x "$staging/x/$NODE_DIST/bin/node" ] || die "tarball did not contain $NODE_DIST/bin/node" 5
  got="$("$staging/x/$NODE_DIST/bin/node" --version)"
  [ "$got" = "$NODE_VERSION" ] || die "extracted node reports $got, expected $NODE_VERSION" 5

  [ -d "$PREFIX" ] && rmdir "$PREFIX"   # only reached when empty (checked above)
  mv "$staging/x/$NODE_DIST" "$PREFIX"
  printf 'url=%s\nsha256=%s\ninstalled_at=%s\n' "$NODE_URL" "$NODE_SHA256" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    > "$PREFIX/.foundry-install-receipt"
  log "installed node $NODE_VERSION into $PREFIX"
  ensure_links
fi

final="$("$BIN_DIR/node" --version)"
[ "$final" = "$NODE_VERSION" ] || die "$BIN_DIR/node reports $final, expected $NODE_VERSION" 5
resolved="$(command -v node || true)"
if [ "$(readlink -f "$resolved" 2>/dev/null)" != "$(readlink -f "$PREFIX/bin/node")" ]; then
  log "warning: 'node' on PATH resolves to ${resolved:-nothing}; put $BIN_DIR first on PATH"
fi
log "ok: node $final"
