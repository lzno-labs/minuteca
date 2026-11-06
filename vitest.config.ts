import { defineConfig } from "vitest/config";

// Tests live in tests/: server tests run in Node, web tests in Node too (pure logic only).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.{js,ts}"],
    environment: "node",
  },
});
