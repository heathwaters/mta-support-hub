import { defineConfig } from "vitest/config";
import path from "node:path";

// Skip @t3-oss/env-nextjs validation during tests — individual tests either
// mock the env or validate the SSL guard in isolation. Tests never open a
// real DB connection.
process.env.SKIP_ENV_VALIDATION = "1";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["lib/**/*.ts", "app/api/**/*.ts"],
      exclude: ["**/*.test.ts", "**/node_modules/**"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
