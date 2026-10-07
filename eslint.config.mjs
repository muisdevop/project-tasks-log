import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated/throwaway output that is not project source:
    // the Playwright matrix builds its own dev artifacts in .next-e2e so it can
    // never poison the developer's .next cache, and the tooling below writes the
    // rest. Linting them floods the report with thousands of fake findings.
    ".next-e2e/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    ".playwright-e2e/**",
    "audit-report/**",
  ]),
]);

export default eslintConfig;
