import { describe, expect, it } from "vite-plus/test";

import type { ReviewSectionItem, ReviewSectionKind } from "./reviewModel";
import { buildReviewSectionMenu } from "./review-section-menu";

function section(id: string, kind: ReviewSectionKind): ReviewSectionItem {
  return {
    id,
    kind,
    title: id,
    subtitle: null,
    diff: null,
    isLoading: false,
  };
}

describe("buildReviewSectionMenu", () => {
  it("exposes the fork's Staged and Unstaged scopes next to Uncommitted", () => {
    const workingTree = section("git:working-tree", "working-tree");
    const unstaged = section("git:unstaged", "unstaged");
    const staged = section("git:staged", "staged");

    expect(buildReviewSectionMenu([workingTree, staged, unstaged])).toMatchObject({
      workingTree,
      unstaged,
      staged,
    });
  });

  it("leaves Staged and Unstaged empty when the server does not return them", () => {
    expect(
      buildReviewSectionMenu([section("git:working-tree", "working-tree")]),
    ).toMatchObject({ unstaged: null, staged: null });
  });
});
