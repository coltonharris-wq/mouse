#!/bin/bash
set -euo pipefail

# ============================================
# King Mouse Tarball Build
# For 8GB disk VMs — uses tmpfs (RAM) for build + pnpm store
# Requires: Node 22+, 32GB RAM
# ============================================

BUILD_DIR="/mnt/build"
PNPM_STORE="/mnt/pnpm-store"
OUTPUT_TAR="/opt/mouse-os.tar.gz"
REPO_URL="https://github.com/coltonharris-wq/mouse.git"

echo "=== Phase 1: Setup tmpfs ==="
sudo mkdir -p "$BUILD_DIR" "$PNPM_STORE"
sudo mount -t tmpfs -o size=12G tmpfs "$BUILD_DIR"
sudo mount -t tmpfs -o size=4G tmpfs "$PNPM_STORE"
sudo chown "$(whoami):$(whoami)" "$BUILD_DIR" "$PNPM_STORE"

echo "=== Phase 2: Install Node 22 (if needed) ==="
if ! node --version 2>/dev/null | grep -q "^v2[2-9]"; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi
corepack enable pnpm 2>/dev/null || npm install -g pnpm

echo "=== Phase 3: Clone fork ==="
cd "$BUILD_DIR"
git clone --depth 1 "$REPO_URL" .

echo "=== Phase 4: Install deps (store in RAM) ==="
pnpm config set store-dir "$PNPM_STORE"
pnpm install --no-frozen-lockfile

echo "=== Phase 5: Build UI (A2UI/Canvas) ==="
pnpm ui:build

echo "=== Phase 6: Build main ==="
pnpm build

echo "=== Phase 7: Prune dev deps ==="
pnpm prune --prod 2>/dev/null || true

echo "=== Phase 8: Create tarball ==="
sudo mkdir -p /opt
tar -czf "$OUTPUT_TAR" \
    --exclude='.git' \
    --exclude='test' \
    --exclude='test-fixtures' \
    --exclude='*.test.ts' \
    --exclude='*.test.js' \
    -C "$BUILD_DIR" .

echo "=== Phase 9: Cleanup ==="
cd /
sudo umount "$BUILD_DIR" 2>/dev/null || true
sudo umount "$PNPM_STORE" 2>/dev/null || true
pnpm config delete store-dir 2>/dev/null || true

echo "=== Done ==="
ls -lh "$OUTPUT_TAR"
echo ""
echo "Tarball ready at: $OUTPUT_TAR"
echo "Next: upload to GitHub Releases, S3, or R2"
echo "Then update your VM provisioning script to use the tarball URL"
