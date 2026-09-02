import type { ChangeTypes } from "@pierre/diffs";
import { describe, expect, it } from "vite-plus/test";

import { buildDiffFileTreeGitStatus, mapFileDiffChangeTypeToGitStatus } from "./diffFileTree";

describe("mapFileDiffChangeTypeToGitStatus", () => {
  it.each([
    ["change", "modified"],
    ["rename-pure", "renamed"],
    ["rename-changed", "renamed"],
    ["deleted", "deleted"],
  ] as const)("maps %s to %s regardless of scope", (changeType, expected) => {
    expect(mapFileDiffChangeTypeToGitStatus(changeType, "uncommitted")).toBe(expected);
    expect(mapFileDiffChangeTypeToGitStatus(changeType, "unstaged")).toBe(expected);
    expect(mapFileDiffChangeTypeToGitStatus(changeType, "staged")).toBe(expected);
    expect(mapFileDiffChangeTypeToGitStatus(changeType, "branch")).toBe(expected);
    expect(mapFileDiffChangeTypeToGitStatus(changeType, "turn")).toBe(expected);
  });

  it.each(["uncommitted", "unstaged"] as const)(
    "maps a new file to untracked in the %s scope, which folds in untracked diffs",
    (scope) => {
      expect(mapFileDiffChangeTypeToGitStatus("new", scope)).toBe("untracked");
    },
  );

  it.each(["staged", "branch", "turn"] as const)(
    "maps a new file to added in the %s scope, which never carries untracked files",
    (scope) => {
      expect(mapFileDiffChangeTypeToGitStatus("new", scope)).toBe("added");
    },
  );
});

describe("buildDiffFileTreeGitStatus", () => {
  it("builds a git-status entry per file using the file's path and mapped status", () => {
    const files: ReadonlyArray<{ filePath: string; fileDiff: { type: ChangeTypes } }> = [
      { filePath: "src/added.ts", fileDiff: { type: "new" } },
      { filePath: "src/modified.ts", fileDiff: { type: "change" } },
      { filePath: "src/removed.ts", fileDiff: { type: "deleted" } },
      { filePath: "src/renamed.ts", fileDiff: { type: "rename-pure" } },
    ];

    expect(buildDiffFileTreeGitStatus(files, "staged")).toEqual([
      { path: "src/added.ts", status: "added" },
      { path: "src/modified.ts", status: "modified" },
      { path: "src/removed.ts", status: "deleted" },
      { path: "src/renamed.ts", status: "renamed" },
    ]);
  });

  it("reclassifies new files as untracked in the unstaged scope", () => {
    const files: ReadonlyArray<{ filePath: string; fileDiff: { type: ChangeTypes } }> = [
      { filePath: "src/new-file.ts", fileDiff: { type: "new" } },
    ];

    expect(buildDiffFileTreeGitStatus(files, "unstaged")).toEqual([
      { path: "src/new-file.ts", status: "untracked" },
    ]);
  });

  it("returns an empty array for an empty file list", () => {
    expect(buildDiffFileTreeGitStatus([], "branch")).toEqual([]);
  });
});
