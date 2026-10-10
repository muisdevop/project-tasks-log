#!/bin/sh
# RA-09, measured in the runtime the product actually ships on.
#
# `.npmrc` sets `engine-strict=true`, so on Node 20 an `engines` violation is a hard
# refusal at install time, while a newer developer machine only prints a warning and
# the defect surfaces later as a dead test worker. `scripts/check-engines.mjs` reads
# the ranges; this proves npm's own behaviour by running the real install inside the
# digest-pinned base image. `--ignore-scripts` keeps it toolchain-free — engine-strict
# is enforced during install, not by a lifecycle script.
#
# Only the manifests are copied, so nothing here can touch the working tree.
set -eu
IMAGE="${ENGINES_PROBE_IMAGE:-node:20-alpine3.20}"
PROBE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/engine-strict-probe.XXXXXX")"
trap 'rm -rf "$PROBE_DIR"' EXIT

# Git Bash reports /tmp as an MSYS mount point, but the Docker daemon does not share
# that namespace: a `-v /tmp/...` source resolves inside the VM, so the container sees an
# empty directory and npm fails with a misleading "no package-lock.json". `cygpath -u`
# would shorten it straight back to /tmp, so the drive letter is rewritten by hand into
# the `/c/...` form Docker Desktop understands. `cygpath` exists only on MSYS, so Linux
# keeps /tmp untouched and CI is unaffected.
if command -v cygpath >/dev/null 2>&1; then
  WINDOWS_PATH="$(cygpath -m "$PROBE_DIR")"
  case "$WINDOWS_PATH" in
    [A-Za-z]:*)
      PROBE_DIR="/$(printf %.1s "$WINDOWS_PATH" | tr 'A-Z' 'a-z')${WINDOWS_PATH#?:}"
      ;;
  esac
fi

cp package.json package-lock.json .npmrc "$PROBE_DIR/"
test -s "$PROBE_DIR/package-lock.json" || { echo "PROBE_INPUT_MISSING: copied lockfile is empty"; exit 2; }

echo "### engine-strict install probe in $IMAGE"
echo "### host manifest dir $PROBE_DIR"
# The manifests are mounted read-only and the install runs in the image's own filesystem.
# Installing onto a bind mount instead would leave ~800 packages owned by the container's
# root, and the cleanup trap above then fails as the CI runner user - which is exactly how
# this step first went red on GitHub Actions.
# `MSYS_NO_PATHCONV` stops Git Bash rewriting the `:/manifests` target into `;W:`.
MSYS_NO_PATHCONV=1 docker run --rm -v "$PROBE_DIR:/manifests:ro" "$IMAGE" \
  sh -c 'set -eu
    mkdir /probe
    cp -a /manifests/. /probe/
    cd /probe
    # Fail with the reason, not with npm'"'"'s EUSAGE: an invisible bind source is the one
    # way this probe can lose its input.
    test -s package-lock.json || { echo "PROBE_INPUT_MISSING: /probe has no package-lock.json; bind source was not visible to the daemon"; exit 2; }
    echo "node $(node -v) / npm $(npm -v)"
    npm ci --include=dev --ignore-scripts'
echo "PROBE_EXIT=0 engine-strict accepts the manifest set on $(echo "$IMAGE" | cut -d: -f2)"
