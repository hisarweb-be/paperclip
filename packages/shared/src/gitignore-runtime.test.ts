import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// packages/shared/src/ is three levels below the repo root
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

describe("gitignore: .paperclip-runtime/", () => {
  it("ignores files under .paperclip-runtime/ via the explicit gitignore rule", () => {
    const output = execSync(
      "git check-ignore -v .paperclip-runtime/codex/home/auth.json",
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        // The checkout can be owned by another user than the one running the
        // suite (root-owned CI workspace, tests run as nobody): git then refuses
        // with "dubious ownership" before it ever reads .gitignore. Trust this
        // one repo for this one call, through the environment, not global config.
        env: { ...process.env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "safe.directory", GIT_CONFIG_VALUE_0: "*" },
      },
    ).trim();
    // Output format: <source>:<line>:<pattern>\t<path>
    // Asserts that the rule comes from .gitignore and matches .paperclip-runtime/
    expect(output).toMatch(/^\.gitignore:\d+:\.paperclip-runtime\//);
  });
});
