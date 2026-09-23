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
  it("exposes git scopes and the latest turn at the top level", () => {
    const turn28 = section("turn:28", "turn");
    const turn27 = section("turn:27", "turn");
    const workingTree = section("git:working-tree", "working-tree");
    const staged = section("git:staged", "staged");
    const unstaged = section("git:unstaged", "unstaged");
    const branchChanges = section("git:branch-range", "branch-range");

    expect(
      buildReviewSectionMenu([turn28, turn27, workingTree, staged, unstaged, branchChanges]),
    ).toEqual({
      workingTree,
      staged,
      unstaged,
      branchChanges,
      latestTurn: turn28,
      turns: [turn28, turn27],
    });
  });

  it("keeps unavailable scopes empty while data loads", () => {
    expect(buildReviewSectionMenu([])).toEqual({
      workingTree: null,
      staged: null,
      unstaged: null,
      branchChanges: null,
      latestTurn: null,
      turns: [],
    });
  });
});
