import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "public/**/*.test.js", "deploy/**/*.test.ts"],
    environment: "node",
  },
});
