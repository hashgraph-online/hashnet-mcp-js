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

echo "==> Verifying npm auth"
if ! npm whoami >/tmp/npm-whoami.log 2>&1; then
  echo "npm is not authenticated or lacks access to the @hol-org scope. See /tmp/npm-whoami.log" >&2
  exit 1
fi
echo "npm user: $(cat /tmp/npm-whoami.log)"

echo "==> Installing dependencies"
pnpm install

echo "==> Building artifacts"
pnpm build

echo "==> Running smoke tests"
pnpm test:run

echo "==> Checking version availability"
PKG_VERSION="$(node -p \"require('./package.json').version\")"
if npm view @hol-org/hashnet-mcp@${PKG_VERSION} version >/tmp/npm-view.log 2>&1; then
  echo "Version ${PKG_VERSION} is already published. Bump version before publishing." >&2
  exit 1
fi

echo "==> Packing npm tarball (dry run)"
cd "$ROOT"
npm pack --dry-run --json >/tmp/hashnet-mcp-pack.json
tarball="$(node -e \"const data=require('/tmp/hashnet-mcp-pack.json'); console.log((data[0]||{}).filename||'');\")"
if [[ -z "$tarball" ]]; then
  echo "Failed to create tarball. See /tmp/hashnet-mcp-pack.json" >&2
  exit 1
fi
echo "Pack succeeded: $tarball"
rm -f "$tarball"

echo "==> Publishing to npm (@hol-org/hashnet-mcp@latest)"
PUBLISH_ARGS=(--access public)
if [[ -n "${NPM_OTP:-}" ]]; then
  PUBLISH_ARGS+=(--otp "${NPM_OTP}")
fi
set -x
npm publish "${PUBLISH_ARGS[@]}"
set +x

echo "Publish complete. Verify with:"
echo "  npm info @hol-org/hashnet-mcp"
echo "Consumers can run:"
echo "  npx @hol-org/hashnet-mcp@latest up"
