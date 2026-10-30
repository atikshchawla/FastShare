import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Frontend unit tests for the pure `lib/` math (CODE_AUDIT P1-11).
 * No DOM: everything tested here is plain TypeScript, so jsdom/happy-dom
 * is deliberately not installed — if a test needs a DOM, it belongs in an
 * e2e suite instead.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
});
