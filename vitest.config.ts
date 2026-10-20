import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const alias = { "@": path.resolve(__dirname, "src") };

// Two projects, one command, because they need opposite React builds.
//
// `node` runs the lib and route tests in-process against real Prisma, under the
// NODE_ENV the chain sets (production) so the shipped code paths are the ones
// under test - src/lib/prisma.ts's client memo and the startup checks only exist
// there.
//
// `components` renders the client components in jsdom, and React's act() - which
// @testing-library/react drives - is not exported from a production React build.
// Running it under NODE_ENV=production fails every render with "React.act is not
// a function", so that project pins development for its own workers instead of
// weakening the other one. The split is deliberate; the docblock at the top of
// each component file states the same environment, so the files still describe
// what they need.
export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          // Password tests exercise real bcryptjs at the production cost
          // (BCRYPT_COST = 12 in src/lib/auth.ts), and bcryptjs is pure-JS: a
          // single hash or compare is hundreds of milliseconds of CPU on one
          // core. Vitest runs every test file in a worker process in parallel,
          // so those operations queue on the shared libuv thread pool and a
          // cost-12 login loop can sit far past the 5s default. The rate-limit
          // test alone makes up to six of them. Timeouts are therefore given
          // headroom instead of cheapening the hashing, because lowering the
          // cost in tests would stop asserting the shipped path.
          testTimeout: 15_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: "components",
          environment: "jsdom",
          include: ["tests/unit/components/**/*.test.tsx"],
          env: { NODE_ENV: "development" },
          testTimeout: 15_000,
          hookTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "./coverage",
      include: ["src/lib/**/*.ts", "src/app/api/**/*.ts"],
      // Thresholds are global (not per-file): pure logic in src/lib is unit
      // tested in-process, while route handlers are additionally exercised by
      // HTTP-level integration tests that do not count toward v8 coverage.
      // Components are outside this scope by design - they are covered by the
      // render suite and the Playwright matrix, not by these thresholds.
      thresholds: {
        lines: 60,
        functions: 60,
        statements: 60,
        branches: 50,
      },
    },
  },
});
