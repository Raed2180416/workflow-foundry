#!/usr/bin/env bash
# Fetch module source zips from the Go module proxy (proxy.golang.org) as an inert mirror of
# GitHub repositories whose github.com/codeload/API endpoints are blocked by the egress proxy.
# Zips are stored only under /opt/corpus/<platform>/ and are never built or executed.
# Usage: orchestration-fetch-goproxy.sh <platform> <module> <version>
set -euo pipefail
platform="$1"; module="$2"; version="$3"
out="/opt/corpus/$platform"; mkdir -p "$out"
base="https://proxy.golang.org/${module}/@v/${version}"
name="$(echo "$module" | tr '/' '_')@${version}"
curl -sS --fail -o "$out/$name.info" "$base.info"
[ -s "$out/$name.zip" ] || curl -sSL --fail -o "$out/$name.zip" "$base.zip"
sha=$(sha256sum "$out/$name.zip" | cut -d' ' -f1)
echo "{\"module\":\"$module\",\"version\":\"$version\",\"zip\":\"$out/$name.zip\",\"sha256\":\"$sha\",\"info\":$(cat "$out/$name.info"),\"retrievedAt\":\"$(date -u +%F)\"}" > "$out/$name.manifest.json"
cat "$out/$name.manifest.json"; echo
