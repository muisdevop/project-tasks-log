/**
 * PF-05 — client bundle measurement + budget gate.
 *
 * Reads the route-level stats Next.js emits at
 * `.next/diagnostics/route-bundle-stats.json` (produced by `next build`), turns
 * them into a readable table with real transfer sizes (gzip), and fails the
 * build pipeline when a route exceeds the documented budget.
 *
 * Usage: `npm run build && npm run bundle:budget`
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const STATS_FILE = ".next/diagnostics/route-bundle-stats.json";
const KB = 1024;

/**
 * Budget (measured 2026-10-07, after the PF-05 code-splitting work landed):
 * the heaviest route ships ~583 KB uncompressed / ~185 KB gzipped of initial
 * JS, and the shared framework shell is ~470 KB of that. The caps below are
 * today's numbers plus a 15% regression margin — they are a ratchet, not an
 * aspiration: raising one must be a deliberate, explained change.
 */
const BUDGETS = {
  // Any single route's initial (non-lazy) JS.
  perRouteUncompressedKB: 660,
  // Shared chunks pulled in by every route.
  sharedUncompressedKB: 620,
  // Largest individual chunk file.
  largestChunkUncompressedKB: 400,
};

function kb(bytes) {
  return bytes / KB;
}

function main() {
  if (!fs.existsSync(STATS_FILE)) {
    console.error(`Missing ${STATS_FILE}. Run \`npm run build\` first.`);
    process.exit(1);
  }

  const stats = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
  const gzipCache = new Map();
  const sizeOf = (chunkPath) => {
    // The manifest uses Windows separators regardless of platform.
    const relative = chunkPath.split(/[\\/]/).slice(1).join(path.sep); // strip ".next"
    const absolute = path.join(".next", relative);
    if (!gzipCache.has(absolute)) {
      const raw = fs.readFileSync(absolute);
      gzipCache.set(absolute, { raw: raw.length, gzip: zlib.gzipSync(raw).length });
    }
    return gzipCache.get(absolute);
  };

  const failures = [];
  const rows = stats
    .map((route) => {
      let gzip = 0;
      for (const chunk of route.firstLoadChunkPaths) {
        try {
          gzip += sizeOf(chunk).gzip;
        } catch {
          // A chunk referenced by the manifest but already pruned: ignore.
        }
      }
      const uncompressedKB = kb(route.firstLoadUncompressedJsBytes);
      if (uncompressedKB > BUDGETS.perRouteUncompressedKB) {
        failures.push(
          `${route.route}: ${uncompressedKB.toFixed(1)} KB initial JS > ${BUDGETS.perRouteUncompressedKB} KB budget`,
        );
      }
      return {
        route: route.route,
        uncompressedKB,
        gzipKB: kb(gzip),
        chunks: route.firstLoadChunkPaths.length,
      };
    })
    .sort((a, b) => b.uncompressedKB - a.uncompressedKB);

  console.log("Route                                    initial JS      gzip  chunks");
  console.log("-".repeat(72));
  for (const row of rows) {
    console.log(
      `${row.route.padEnd(40)} ${row.uncompressedKB.toFixed(1).padStart(8)} KB ${row.gzipKB
        .toFixed(1)
        .padStart(8)} KB ${String(row.chunks).padStart(6)}`,
    );
  }

  const shared = [...new Set(stats.flatMap((r) => r.firstLoadChunkPaths))].filter((chunk) => {
    const routes = stats.filter((r) => r.firstLoadChunkPaths.includes(chunk));
    return routes.length === stats.length;
  });
  const sharedBytes = shared.reduce((sum, chunk) => {
    try {
      return sum + sizeOf(chunk).raw;
    } catch {
      return sum;
    }
  }, 0);
  console.log(
    `\nShared by every route: ${shared.length} chunk(s), ${kb(sharedBytes).toFixed(1)} KB uncompressed (budget ${BUDGETS.sharedUncompressedKB} KB)`,
  );
  if (kb(sharedBytes) > BUDGETS.sharedUncompressedKB) {
    failures.push(`shared chunks: ${kb(sharedBytes).toFixed(1)} KB > ${BUDGETS.sharedUncompressedKB} KB budget`);
  }

  const allChunks = [...new Set(stats.flatMap((r) => r.firstLoadChunkPaths))];
  const largest = allChunks
    .map((chunk) => ({ chunk, ...safeSize(chunk) }))
    .filter((entry) => entry.raw)
    .sort((a, b) => b.raw - a.raw)[0];
  if (largest) {
    console.log(
      `Largest chunk: ${kb(largest.raw).toFixed(1)} KB / ${kb(largest.gzip).toFixed(1)} KB gzip (${largest.chunk})`,
    );
    if (kb(largest.raw) > BUDGETS.largestChunkUncompressedKB) {
      failures.push(
        `chunk ${largest.chunk}: ${kb(largest.raw).toFixed(1)} KB > ${BUDGETS.largestChunkUncompressedKB} KB budget`,
      );
    }
  }

  console.log(
    `\nLazy-only code (not in any initial load): ${lazyOnlyChunks(stats, allChunks).join(", ") || "none"}`,
  );

  if (failures.length) {
    console.error(`\nBundle budget exceeded:\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log(`\nWithin budget (${BUDGETS.perRouteUncompressedKB} KB per route).`);
}

function safeSize(chunkPath) {
  const relative = chunkPath.split(/[\\/]/).slice(1).join(path.sep);
  const absolute = path.join(".next", relative);
  if (!fs.existsSync(absolute)) return { raw: 0, gzip: 0 };
  const raw = fs.readFileSync(absolute);
  return { chunk: chunkPath, raw: raw.length, gzip: zlib.gzipSync(raw).length };
}

/**
 * Chunks that exist on disk but no route loads initially — proof that the
 * TipTap editor and the export builder are genuinely code-split (PF-05).
 */
function lazyOnlyChunks(stats, initialChunks) {
  const chunksDir = path.join(".next", "static", "chunks");
  if (!fs.existsSync(chunksDir)) return [];
  const initial = new Set(initialChunks.map((c) => path.basename(c)));
  return fs
    .readdirSync(chunksDir)
    .filter((name) => name.endsWith(".js") && !initial.has(name) && !name.startsWith("turbopack-"))
    .map((name) => `${name} (${kb(fs.statSync(path.join(chunksDir, name)).size).toFixed(0)} KB)`);
}

main();
