import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(import.meta.dirname, "../../.github/workflows/release.yml");

describe("release workflow", () => {
  it("publishes validated semantic releases from reusable control tags", () => {
    expect(existsSync(workflowPath)).toBe(true);

    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("release/major");
    expect(workflow).toContain("release/minor");
    expect(workflow).toContain("release/patch");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("git merge-base --is-ancestor");
    expect(workflow).toContain('npm version "$BUMP" --no-git-tag-version');
    expect(workflow).toContain("npm run typecheck");
    expect(workflow).toContain("npm run lint");
    expect(workflow).toContain("npm test");
    expect(workflow).toContain("npm publish");
    expect(workflow).toContain("concurrency:");
  });
});
