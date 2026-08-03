import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    pool: "threads",
    maxWorkers: 4,
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
    coverage: {
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.{ts,tsx}", "worker/src/**/*.ts"]
    }
  }
});
