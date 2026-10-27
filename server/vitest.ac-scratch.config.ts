import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Scratch config: this worktree's node_modules symlinks into another checkout,
// so @paperclipai/* would otherwise resolve to that checkout's source. Pin the
// workspace packages to THIS tree so the test exercises the branch under review.
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@paperclipai\/paperclip-runner$/, replacement: here("../packages/paperclip-runner/src/index.ts") },
      { find: /^@paperclipai\/shared$/, replacement: here("../packages/shared/src/index.ts") },
      { find: /^@paperclipai\/db$/, replacement: here("../packages/db/src/index.ts") },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    hookTimeout: 120000,
    teardownTimeout: 60000,
    testTimeout: 60000,
    isolate: true,
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    pool: "forks",
    sequence: { concurrent: false, hooks: "list" },
    setupFiles: ["./src/__tests__/setup-supertest.ts"],
  },
});
