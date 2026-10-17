#!/usr/bin/env bash
# Verify a *published* release, not just the local tree: registry metadata,
# provenance attestation, the exact tarball bytes, and whether the published
# extension actually loads in a real pi runtime.
#
# Usage: ./scripts/verify-release.sh [version]   (default: the registry's latest)
set -euo pipefail

REPO_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$REPO_DIR"

PACKAGE=$(node -p "require('./package.json').name")
LOCAL_VERSION=$(node -p "require('./package.json').version")
ENCODED=$(node -p "encodeURIComponent(require('./package.json').name)")

packument=$(mktemp)
work=$(mktemp -d)
cleanup() { rm -rf "$packument" "$work"; }
trap cleanup EXIT

if ! curl -fsS "https://registry.npmjs.org/$ENCODED" -o "$packument"; then
  echo "FAIL: could not read the registry packument for $PACKAGE (network?)" >&2
  exit 1
fi

# Read the packument as JSON; mktemp gives no extension, so require() would
# parse it as JavaScript.
meta() {
  node -e '
    const fs = require("fs");
    const [file, version, field] = process.argv.slice(1);
    const p = JSON.parse(fs.readFileSync(file, "utf8"));
    const v = p.versions[version];
    if (!v) { console.error(`FAIL: version ${version} is not on the registry`); process.exit(1); }
    if (field === "tarball") process.stdout.write(v.dist.tarball);
    else if (field === "shasum") process.stdout.write(v.dist.shasum);
    else if (field === "latest") process.stdout.write(p["dist-tags"].latest);
    else if (field === "provenance") {
      const att = v.dist.attestations;
      if (!att || !att.provenance) { console.error("FAIL: no provenance attestation on this version"); process.exit(1); }
      process.stdout.write(att.provenance.predicateType);
    } else if (field === "published") process.stdout.write(v.version);
    else { console.error(`unknown field ${field}`); process.exit(1); }
  ' "$packument" "$VERSION" "$1"
}

VERSION=${1:-}
if [ -z "$VERSION" ]; then
  VERSION=$(node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8"))["dist-tags"].latest)' "$packument")
fi
echo "verifying $PACKAGE@$VERSION"

LATEST=$(meta latest)
PROVENANCE=$(meta provenance)
EXPECTED_SHA=$(meta shasum)
TARBALL=$(meta tarball)

echo "  version exists:  yes"
echo "  dist-tag latest: $LATEST$( [ "$LATEST" = "$VERSION" ] && echo '' || echo ' (not this version)')"
echo "  provenance:      $PROVENANCE"
echo "  registry shasum: $EXPECTED_SHA"

mkdir -p "$work/pkg"
curl -fsSL "$TARBALL" -o "$work/release.tgz"
if command -v shasum >/dev/null 2>&1; then
  ACTUAL_SHA=$(shasum -a 1 "$work/release.tgz" | cut -d' ' -f1)
else
  ACTUAL_SHA=$(sha1sum "$work/release.tgz" | cut -d' ' -f1)
fi
if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
  echo "FAIL: downloaded tarball shasum $ACTUAL_SHA does not match $EXPECTED_SHA" >&2
  exit 1
fi
echo "  tarball bytes:   match the registry"

tar -xzf "$work/release.tgz" -C "$work/pkg"
extracted="$work/pkg/package"

PUBLISHED_VERSION=$(node -p "require('$extracted/package.json').version")
if [ "$PUBLISHED_VERSION" != "$VERSION" ]; then
  echo "FAIL: the tarball contains version $PUBLISHED_VERSION, expected $VERSION" >&2
  exit 1
fi
echo "  tarball content: version $PUBLISHED_VERSION"

if [ "$VERSION" = "$LOCAL_VERSION" ]; then
  if ! diff -q "$extracted/index.ts" "$REPO_DIR/index.ts" >/dev/null; then
    echo "FAIL: the published index.ts differs from the working tree at version $LOCAL_VERSION" >&2
    exit 1
  fi
  echo "  working tree:    published index.ts matches"
else
  echo "  working tree:    skipped index.ts parity ($VERSION vs local $LOCAL_VERSION)"
fi

LOAD_DIR="$extracted" EXPECTED_COMMAND=go-on-mode "$REPO_DIR/scripts/verify-load.sh"
echo "OK: $PACKAGE@$VERSION verified (registry, provenance, bytes, runtime load)"
