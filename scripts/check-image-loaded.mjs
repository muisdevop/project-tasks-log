// RA-23: the tag in the local store must be the image this build produced — judged by
// digest identity, not by clock time.
//
// `scripts/docker-build.sh` used to compare the tag's `Created` timestamp against the moment
// the script started. That catches the RA-21 case (build exits 0, nothing lands in the store,
// an old tag stays put) but it also rejects a build that genuinely succeeded: measured on
// 2026-10-11, a fully-cached rebuild exported and unpacked the tag in 0.2s and the script
// still failed with `IMAGE_STALE … created at 2026-10-11T15:51:13Z`, because a cached build
// reuses the cached config — including its `created` field. A gate that cries wolf is worse
// than no gate: the first developer it lies to goes back to a bare `docker build`, which is
// the exact defect RA-21 was raised for.
//
// buildx writes a metadata file describing the image it built. Its digests are content
// addressed, so equality with what the local store reports means "this tag is that image",
// whether the build was warm or cold — and a tag that never received the build differs.
//
// Both digest forms are accepted on purpose. With provenance/SBOM attestations (buildx's
// default here) the manifest the tag points at is a *manifest list*, and `docker image
// inspect` `.Id` reports that list's digest while the config digest is a different value;
// comparing only one of the two makes a correct build look stale.
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const [image, metadataFile] = process.argv.slice(2);
if (!image || !metadataFile) {
  console.error("usage: node scripts/check-image-loaded.mjs <image-reference> <buildx-metadata-file>");
  process.exit(64);
}

function fail(message, code) {
  console.error(message);
  process.exit(code);
}

let metadata;
try {
  metadata = JSON.parse(fs.readFileSync(metadataFile, "utf8"));
} catch (error) {
  fail(
    `IMAGE_UNVERIFIABLE: buildx metadata ${metadataFile} is missing or unreadable (${error.message}), ` +
      `so the build cannot be proved to have produced ${image}`,
    3,
  );
}

// `containerimage.config.digest` is a string; `containerimage.descriptor` is an object with a
// `digest`. Older/newer buildx versions populate one, both, or neither.
const digest = (value) =>
  typeof value === "string" ? value : (value?.digest ?? value?.["digest"] ?? "");
const built = [
  digest(metadata["containerimage.config.digest"]),
  digest(metadata["containerimage.descriptor"]),
].filter((d) => /^sha256:[0-9a-f]{64}$/.test(d));

if (built.length === 0) {
  fail(
    `IMAGE_UNVERIFIABLE: ${metadataFile} carries no config or descriptor digest ` +
      `(keys: ${Object.keys(metadata).join(", ") || "none"}) — refusing to call this build good`,
    3,
  );
}

let inspect;
try {
  inspect = execFileSync("docker", ["image", "inspect", image, "--format", "{{.Id}}\t{{json .RepoDigests}}"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
} catch {
  fail(
    `IMAGE_MISSING: ${image} is not in the local image store after the build — on a ` +
      `docker-container/buildx driver the build only wrote to the cache; add --load`,
    2,
  );
}

const [localId, repoDigestsJson] = inspect.split("\t");
const repoDigests = JSON.parse(repoDigestsJson || "[]");
const local = [localId, ...repoDigests.map((rd) => rd.slice(rd.lastIndexOf("@") + 1))];

if (built.some((d) => local.includes(d))) {
  console.log(
    `IMAGE_LOADED ${image} built=${built.join(",")} local=${local.join(",")}`,
  );
  process.exit(0);
}

fail(
  `IMAGE_STALE: ${image} in the local store (${local.join(",")}) is not the image this build ` +
    `produced (${built.join(",")}). The build did not land on this tag.`,
  1,
);
