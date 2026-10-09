import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Password tests exercise real bcryptjs at the production cost (BCRYPT_COST
    // = 12 in src/lib/auth.ts), and bcryptjs is pure-JS: a single hash or
    // compare is hundreds of milliseconds of CPU on one core. Vitest runs every
    // test file in a worker process in parallel, so those operations queue on
    // the shared libuv thread pool and a cost-12 login loop can sit far past
    // the 5s default. The rate-limit test alone makes up to six of them.
    // Timeouts are therefore given headroom instead of cheapening the hashing,
    // because lowering the cost in tests would stop asserting the shipped path.
    testTimeout: 15_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "./coverage",
      include: ["src/lib/**/*.ts", "src/app/api/**/*.ts"],
      // Thresholds are global (not per-file): pure logic in src/lib is unit
      // tested in-process, while route handlers are additionally exercised by
      // HTTP-level integration tests that do not count toward v8 coverage.
      thresholds: {
        lines: 60,
        functions: 60,
        statements: 60,
        branches: 50,
      },
    },
  },
});
