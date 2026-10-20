#!/bin/sh
# RA-21, and the reason the AGENTS.md docker gate is a script and not a remembered command.
#
# This host builds with the docker-container/buildx driver, where a plain `docker build`
# exits 0 and puts the result *only* in the build cache — never in the local image store.
# The gate then boots whatever the tag last pointed at: a passing smoke run against an image
# from before the fix. Measured on 2026-10-11: `docker build` exited 0 and the new tag was
# absent from `docker images` until `--load` was added.
#
# So: build with `--load`, then prove the tag in the local store *is* the image that build
# produced. The proof is the buildx metadata file's content digests compared against what
# `docker image inspect` reports — see scripts/check-image-loaded.mjs for why an earlier
# revision's `Created`-timestamp comparison was replaced (RA-23: it rejected a real,
# fully-cached build, and a gate that produces false failures gets bypassed).
set -eu
IMAGE="${1:-gid-task-flow:local}"
META="${TMPDIR:-/tmp}/gid-docker-build-metadata-$$.json"
rm -f "$META"
trap 'rm -f "$META"' EXIT

docker build --load --metadata-file "$META" -t "$IMAGE" .

# `--load` and the identity check are both required: without the flag nothing reaches the
# store, and with it a tag can still be the one that was already there.
node scripts/check-image-loaded.mjs "$IMAGE" "$META"
