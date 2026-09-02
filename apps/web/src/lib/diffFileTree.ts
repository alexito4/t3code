import type { ChangeTypes, FileDiffMetadata } from "@pierre/diffs";
import type { GitStatus, GitStatusEntry } from "@pierre/trees";

import type { DiffPanelGitScope } from "../diffPanelStore";

/** Every scope the diff file-tree can badge, including checkpoint turn diffs. */
export type DiffFileTreeGitStatusScope = DiffPanelGitScope | "turn";

/**
 * `getReviewDiffPreview` (GitVcsDriverCore.ts) folds untracked files into the
 * `uncommitted` and `unstaged` sources via `readUntrackedReviewDiffs`, which
 * diffs each untracked file against `/dev/null` -- the same patch shape as a
 * real added file (`ChangeTypes: 'new'`). `staged` and `branch` diffs, and
 * checkpoint turn diffs, never include untracked files: git only ever diffs
 * tracked content there. So a `new`-type file only means "genuinely
 * untracked" in these two scopes; everywhere else it's a real, git-added file.
 */
const SCOPES_WHERE_NEW_FILES_ARE_UNTRACKED: ReadonlySet<DiffFileTreeGitStatusScope> = new Set([
  "uncommitted",
  "unstaged",
]);

export function mapFileDiffChangeTypeToGitStatus(
  changeType: ChangeTypes,
  scope: DiffFileTreeGitStatusScope,
): GitStatus {
  switch (changeType) {
    case "new":
      return SCOPES_WHERE_NEW_FILES_ARE_UNTRACKED.has(scope) ? "untracked" : "added";
    case "deleted":
      return "deleted";
    case "rename-pure":
    case "rename-changed":
      return "renamed";
    case "change":
    default:
      return "modified";
  }
}

export function buildDiffFileTreeGitStatus(
  files: ReadonlyArray<{ filePath: string; fileDiff: Pick<FileDiffMetadata, "type"> }>,
  scope: DiffFileTreeGitStatusScope,
): GitStatusEntry[] {
  return files.map((file) => ({
    path: file.filePath,
    status: mapFileDiffChangeTypeToGitStatus(file.fileDiff.type, scope),
  }));
}
