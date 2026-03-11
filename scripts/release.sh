#!/bin/bash
set -euo pipefail

# ─── Release Script ───
# Dry-run build locally, then tag and push to trigger GitHub Actions release.
#
# Usage:
#   ./scripts/release.sh [version]
#
# Examples:
#   ./scripts/release.sh 0.1.0    # bump version, verify build, tag, push
#   ./scripts/release.sh          # verify build and tag current version

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}▸${NC} $1"; }
warn()  { echo -e "${YELLOW}▸${NC} $1"; }
error() { echo -e "${RED}✕${NC} $1" >&2; exit 1; }

# ─── Preflight ───

command -v pnpm >/dev/null || error "pnpm not found"

if [ -n "$(git status --porcelain)" ]; then
  error "Working tree is dirty. Commit or stash changes first."
fi

# ─── Version ───

if [ -n "${1:-}" ]; then
  VERSION="$1"
  info "Bumping version to $VERSION"
  pnpm pkg set version="$VERSION"
  git add package.json
  git commit -m "chore: bump version to $VERSION"
fi

VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"
info "Version: $VERSION ($TAG)"

# ─── Local dry-run build ───

info "Installing dependencies..."
pnpm install

info "Building (electron-vite)..."
pnpm build

info "Packaging dry-run (no sign/notarize)..."
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --dir

info "Local build passed!"

# ─── Tag and push ───

read -p "Push tag $TAG to trigger release? [y/N] " confirm
[[ "$confirm" =~ ^[Yy]$ ]] || { info "Aborted."; exit 0; }

# Clean up existing tag if needed
git tag -d "$TAG" 2>/dev/null || true
git push origin ":refs/tags/$TAG" 2>/dev/null || true

git push origin main
git tag "$TAG"
git push origin "$TAG"

info "Tag $TAG pushed. Watch the release at:"
echo ""
echo "  https://github.com/SignorCrypto/agents-kb/actions"
echo ""
