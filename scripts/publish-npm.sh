#!/usr/bin/env bash
set -euo pipefail

# Publish @hol-org/hashnet-mcp to npm with a single command.
# Prerequisites:
# - npm logged in with publish rights to the @hol-org scope
# - pnpm installed (or corepack enabled)
# - clean git state (optional guard below)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Ensuring clean working tree"
if ! git -C "$ROOT" diff --quiet; then
  echo "Working tree is dirty. Commit or stash changes before publishing." >&2
  exit 1
fi

echo "==> Installing dependencies"
pnpm install

echo "==> Building artifacts"
pnpm build

echo "==> Running smoke tests"
pnpm test:run

echo "==> Packing npm tarball (dry run)"
cd "$ROOT"
npm pack --dry-run >/tmp/hashnet-mcp-pack.log
tarball="$(grep '@hol-org/hashnet-mcp' /tmp/hashnet-mcp-pack.log | awk '{print $1}')"
if [[ -z "$tarball" ]]; then
  echo "Failed to create tarball. See /tmp/hashnet-mcp-pack.log" >&2
  exit 1
fi
echo "Pack succeeded: $tarball"
rm -f "$tarball"

echo "==> Publishing to npm (@hol-org/hashnet-mcp@latest)"
npm publish --access public

echo "Publish complete. Verify with:"
echo "  npm info @hol-org/hashnet-mcp"
echo "Consumers can run:"
echo "  npx @hol-org/hashnet-mcp@latest up"
