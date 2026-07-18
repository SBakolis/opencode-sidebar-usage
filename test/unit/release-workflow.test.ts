import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(import.meta.dirname, "../../.github/workflows/release.yml");

describe("release workflow", () => {
  it("publishes validated semantic releases from release:* labels on merged PRs", () => {
    expect(existsSync(workflowPath)).toBe(true);

    const workflow = readFileSync(workflowPath, "utf8");

    // Triggered when a PR is closed (then filtered to merged-only at job level).
    expect(workflow).toContain("pull_request");
    expect(workflow).toContain("types: [closed]");
    expect(workflow).toContain("github.event.pull_request.merged == true");

    // Bump is selected from the release:* labels on the merged PR.
    expect(workflow).toContain("release:major");
    expect(workflow).toContain("release:minor");
    expect(workflow).toContain("release:patch");

    // Permissions for provenance + pushing the version-bump commit.
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("contents: write");

    // Version bump + validation pipeline.
    expect(workflow).toContain('npm version "$BUMP" --no-git-tag-version');
    expect(workflow).toContain("npm run typecheck");
    expect(workflow).toContain("npm run lint");
    expect(workflow).toContain("npm test");
    expect(workflow).toContain("npm publish");

    // Only one release at a time.
    expect(workflow).toContain("concurrency:");

    // Release is cut from main (preserves the original "release must be on
    // main" invariant that the tag-based flow enforced via merge-base).
    expect(workflow).toContain("ref: main");
  });

  it("does not use the legacy slash tags anymore", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    expect(workflow).not.toContain("release/major");
    expect(workflow).not.toContain("release/minor");
    expect(workflow).not.toContain("release/patch");
    expect(workflow).not.toContain("git merge-base --is-ancestor");
  });
});
