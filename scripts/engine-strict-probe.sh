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

cp package.json package-lock.json .npmrc "$PROBE_DIR/"

echo "### engine-strict install probe in $IMAGE"
# `MSYS_NO_PATHCONV` is for Git Bash on Windows, which otherwise rewrites the bind
# target `:/w` into `;W:` and the container fails to start before npm runs at all.
MSYS_NO_PATHCONV=1 docker run --rm -v "$PROBE_DIR:/w" "$IMAGE" \
  sh -c 'cd /w && echo "node $(node -v) / npm $(npm -v)" && npm ci --include=dev --ignore-scripts'
echo "PROBE_EXIT=0 engine-strict accepts the manifest set on $(echo "$IMAGE" | cut -d: -f2)"
