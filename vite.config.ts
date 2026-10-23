import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Most tests build a full template (fit, mesh, flatten, slits), which takes seconds;
    // vitest's 5 s default made the suite flaky on a busy machine.
    testTimeout: 60_000,
  },
});
