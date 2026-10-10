import type { ScopedThreadRef } from "@t3tools/contracts";
import { isWindowsAbsolutePath, normalizeProjectPathForComparison } from "@t3tools/shared/path";

import type { DiffPanelGitScope } from "./diffPanelStore";
import { useRightPanelStore } from "./rightPanelStore";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";

interface OpenDiffFilePrimaryActionInput {
  readonly threadRef: ScopedThreadRef | null;
  readonly filePath: string;
  readonly activeCwd: string | undefined;
  readonly repositoryRoot?: string | undefined;
  readonly openInEditor: (targetPath: string) => void;
}

function normalizedRelativePathSegments(filePath: string): ReadonlyArray<string> | null {
  if (filePath.startsWith("/") || isWindowsAbsolutePath(filePath) || /^[a-zA-Z]:/.test(filePath)) {
    return null;
  }

  const segments = filePath
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.length === 0 || segments.includes("..")) return null;
  return segments;
}

function repositoryRelativeWorkspaceSegments(
  workspaceRoot: string | undefined,
  repositoryRoot: string | undefined,
): ReadonlyArray<string> | null {
  if (!workspaceRoot || !repositoryRoot) return null;

  const normalizedWorkspaceRoot = normalizeProjectPathForComparison(workspaceRoot);
  const normalizedRepositoryRoot = normalizeProjectPathForComparison(repositoryRoot);
  if (normalizedWorkspaceRoot === normalizedRepositoryRoot) return [];

  const separator = normalizedRepositoryRoot.includes("\\") ? "\\" : "/";
  const repositoryPrefix = normalizedRepositoryRoot.endsWith(separator)
    ? normalizedRepositoryRoot
    : `${normalizedRepositoryRoot}${separator}`;
  if (!normalizedWorkspaceRoot.startsWith(repositoryPrefix)) return null;

  return normalizedWorkspaceRoot
    .slice(repositoryPrefix.length)
    .split(/[\\/]+/)
    .filter(Boolean);
}

export function resolveDiffPathForWorkspace(input: {
  readonly filePath: string;
  readonly workspaceRoot: string | undefined;
  readonly repositoryRoot: string | undefined;
}): string | null {
  const fileSegments = normalizedRelativePathSegments(input.filePath);
  if (!fileSegments) return null;

  const workspaceSegments = repositoryRelativeWorkspaceSegments(
    input.workspaceRoot,
    input.repositoryRoot,
  );
  if (!workspaceSegments || workspaceSegments.length === 0) {
    return fileSegments.join("/");
  }

  const caseInsensitive = input.repositoryRoot
    ? isWindowsAbsolutePath(input.repositoryRoot)
    : false;
  const belongsToWorkspace = workspaceSegments.every((segment, index) => {
    const candidate = fileSegments[index];
    if (candidate === undefined) return false;
    return caseInsensitive ? candidate.toLowerCase() === segment : candidate === segment;
  });
  if (!belongsToWorkspace) return null;

  const relativeSegments = fileSegments.slice(workspaceSegments.length);
  return relativeSegments.length > 0 ? relativeSegments.join("/") : null;
}

export function openDiffFilePrimaryAction({
  threadRef,
  filePath,
  activeCwd,
  repositoryRoot,
  openInEditor,
}: OpenDiffFilePrimaryActionInput): void {
  const workspaceFilePath = resolveDiffPathForWorkspace({
    filePath,
    workspaceRoot: activeCwd,
    repositoryRoot,
  });
  if (!workspaceFilePath) return;

  if (threadRef) {
    useRightPanelStore.getState().openFile(threadRef, workspaceFilePath);
    return;
  }

  openInEditor(activeCwd ? resolvePathLinkTarget(workspaceFilePath, activeCwd) : workspaceFilePath);
}

export interface DiffFileStagingActions {
  readonly canStage: boolean;
  readonly canUnstage: boolean;
  readonly canDiscard: boolean;
}

const NO_STAGING_ACTIONS: DiffFileStagingActions = {
  canStage: false,
  canUnstage: false,
  canDiscard: false,
};

/**
 * Decides which per-file stage/unstage/discard buttons the diff panel shows
 * for the active Git scope. Only the working-tree scopes (Uncommitted,
 * Unstaged, Staged) get any buttons -- Changes and historical (turn/commit)
 * diffs are read-only.
 *
 * Judgment call: Uncommitted (`git diff HEAD`) doesn't tell us, per file,
 * whether its change is staged, unstaged, or both, so there's no unambiguous
 * "unstage" action to offer there. "Stage" is still offered because `git add`
 * on an already-staged file is a harmless no-op, and "discard" is
 * well-defined regardless (see the git driver's `discardFile`): it always
 * reverts the file to HEAD (or deletes it if never committed) rather than
 * clearing only the staged or only the unstaged half of a change.
 */
export function resolveDiffFileStagingActions(
  gitScope: DiffPanelGitScope,
  isHistoricalSelection: boolean,
): DiffFileStagingActions {
  if (isHistoricalSelection) return NO_STAGING_ACTIONS;

  switch (gitScope) {
    case "staged":
      return { canStage: false, canUnstage: true, canDiscard: true };
    case "unstaged":
    case "unstaged-only":
      return { canStage: true, canUnstage: false, canDiscard: true };
    case "branch":
      return NO_STAGING_ACTIONS;
  }
}
