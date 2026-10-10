#!/usr/bin/env node
// RA-09's invariant as a repo script, not a one-off.
//
// npm only *warns* about `engines` by default, so a dependency that cannot run on the
// Node the image ships can install cleanly and die later inside a test worker. This
// walks every installed package (including nested `node_modules`, which is where the
// offenders usually hide — `@prisma/streams-local` arrived as a transitive of
// `@prisma/dev`) and refuses the tree if any declared `engines.node` excludes a runtime
// this project is supposed to work on.
//
// It complements `scripts/engine-strict-probe.sh`: this one reads ranges across the
// whole installed tree, that one proves npm's own engine-strict refusal in the base
// image. Neither replaces the other.
//
// Usage: node scripts/check-engines.mjs [20.19.2,24.18.0]
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const semver = createRequire(import.meta.url)("semver");

const runtimes = (process.argv[2] ?? "20.19.2,24.18.0").split(",").map((v) => v.trim()).filter(Boolean);
const root = process.cwd();

const offenders = [];
let packageJsonFiles = 0;
let declaringEngines = 0;

// A plain depth-unbounded walk of `node_modules`, counting every directory that owns a
// `package.json`. This deliberately over-counts relative to "one manifest per installed
// package name": nested `node_modules` trees and the shims packages ship inside them are
// exactly where an `engines` violation hides (`@prisma/streams-local` arrived as a
// transitive of `@prisma/dev`, pinned to an exact version by its parent).
const stack = [join(root, "node_modules")];
while (stack.length) {
  const dir = stack.pop();
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    continue;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === ".bin" || entry.name === ".cache") continue;
    const full = join(dir, entry.name);
    const manifestPath = join(full, "package.json");
    stack.push(full);
    if (!existsSync(manifestPath)) continue;
    packageJsonFiles += 1;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      continue;
    }
    const range = manifest.engines?.node;
    if (!range) continue;
    declaringEngines += 1;
    const excluded = runtimes.filter((version) => {
      try {
        return !semver.satisfies(version, range, { includePrerelease: true });
      } catch {
        // An unparseable range is not a pass; name it so it can be reviewed.
        return false;
      }
    });
    if (excluded.length) {
      offenders.push(`${manifest.name ?? full}@${manifest.version ?? "?"} requires "${range}", excludes ${excluded.join(", ")}`);
    }
  }
}

console.log(`### ENGINES SWEEP runtimes=${runtimes.join(",")}`);
console.log(
  JSON.stringify({
    packageJsonFiles,
    declaringEnginesNode: declaringEngines,
    excludingEitherRuntime: offenders.length,
  }),
);
for (const line of offenders) console.log(`  ${line}`);

if (offenders.length) {
  console.error(
    `${offenders.length} installed package(s) declare engines.node that excludes a runtime this ` +
      `project supports. npm would only warn about this, and the suite would fail later at runtime. ` +
      `Pin or override the package, or move the runtime — see docs/security.md section 8.`,
  );
  process.exit(1);
}
