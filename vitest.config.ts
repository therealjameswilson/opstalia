import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    pool: "vmThreads",
    maxWorkers: 4,
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
    coverage: {
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.{ts,tsx}", "worker/src/**/*.ts"]
    }
  }
});
