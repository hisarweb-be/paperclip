import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // A stale `tsc` build can leave compiled *.test.js files in dist/; never run them.
    exclude: [...configDefaults.exclude, "**/dist/**"],
  },
});
