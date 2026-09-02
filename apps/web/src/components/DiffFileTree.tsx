import type { FileDiffMetadata } from "@pierre/diffs";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { useEffect, useMemo, useRef } from "react";

import { buildDiffFileTreeGitStatus, type DiffFileTreeGitStatusScope } from "~/lib/diffFileTree";
import { cn } from "~/lib/utils";
import { T3_PIERRE_ICONS } from "~/pierre-icons";

const TREE_UNSAFE_CSS = `
  :host {
    --trees-bg-override: transparent;
    --trees-selected-bg-override: color-mix(in srgb, currentColor 12%, transparent);
    --trees-hover-bg-override: color-mix(in srgb, currentColor 7%, transparent);
    --trees-border-color-override: color-mix(in srgb, currentColor 14%, transparent);
    --trees-font-family-override: var(--font-sans);
    --trees-font-size-override: 12px;
  }
  button[data-type='item'] { border-radius: 5px; }
`;

export interface DiffFileTreeFile {
  filePath: string;
  fileKey: string;
  fileDiff: Pick<FileDiffMetadata, "type">;
}

interface DiffFileTreeProps {
  files: ReadonlyArray<DiffFileTreeFile>;
  gitStatusScope: DiffFileTreeGitStatusScope;
  selectedFilePath: string | null;
  selectedFileRevealRequestId: number;
  onOpenFile: (filePath: string) => void;
  resolvedTheme: "light" | "dark";
  className?: string;
}

/**
 * Codex-style file-tree sidebar for the diff panel: the changed-file paths
 * for whatever's currently selected (a git scope or a turn), badged with
 * `@pierre/trees`' built-in `gitStatus` decoration. Clicking a row reveals
 * that file in the diff view via `onOpenFile`; it doesn't own scrolling
 * itself, since the diff view's own virtualized scroller does that.
 */
export function DiffFileTree({
  files,
  gitStatusScope,
  selectedFilePath,
  selectedFileRevealRequestId,
  onOpenFile,
  resolvedTheme,
  className,
}: DiffFileTreeProps) {
  const paths = useMemo(() => files.map((file) => file.filePath), [files]);
  const gitStatus = useMemo(
    () => buildDiffFileTreeGitStatus(files, gitStatusScope),
    [files, gitStatusScope],
  );

  // Guards the echo from `item.select()` below: without it, the reveal sync
  // effect's own selection would re-enter `onOpenFile` and fight the caller
  // over which file is "current".
  const syncingSelectionRef = useRef(false);
  const handledRevealRef = useRef<{ path: string; revealId: number } | null>(null);

  const { model } = useFileTree({
    density: "compact",
    flattenEmptyDirectories: true,
    // Diffs are typically a handful of files; showing every folder expanded
    // avoids a click-to-expand step for what's almost always the whole tree.
    initialExpansion: "open",
    icons: T3_PIERRE_ICONS,
    onSelectionChange: (selectedPaths) => {
      if (syncingSelectionRef.current) return;
      const path = selectedPaths.at(-1);
      if (path) onOpenFile(path);
    },
    paths: [],
    search: false,
    unsafeCSS: TREE_UNSAFE_CSS,
  });

  useEffect(() => {
    model.resetPaths(paths);
  }, [model, paths]);

  useEffect(() => {
    model.setGitStatus(gitStatus);
  }, [model, gitStatus]);

  useEffect(() => {
    if (!selectedFilePath) {
      handledRevealRef.current = null;
      return;
    }
    const revealRequest = { path: selectedFilePath, revealId: selectedFileRevealRequestId };
    const handledReveal = handledRevealRef.current;
    if (
      handledReveal?.path === revealRequest.path &&
      handledReveal.revealId === revealRequest.revealId
    ) {
      return;
    }
    handledRevealRef.current = revealRequest;
    const item = model.getItem(selectedFilePath);
    if (!item) return;

    syncingSelectionRef.current = true;
    for (const path of model.getSelectedPaths()) {
      model.getItem(path)?.deselect();
    }
    item.select();
    model.scrollToPath(selectedFilePath, { offset: "center" });
    queueMicrotask(() => {
      syncingSelectionRef.current = false;
    });
  }, [model, paths, selectedFilePath, selectedFileRevealRequestId]);

  return (
    <div className={cn("flex min-h-0 flex-col bg-background", className)}>
      <FileTree
        model={model}
        aria-label="Changed files"
        className="min-h-0 flex-1 overflow-hidden"
        style={{
          colorScheme: resolvedTheme,
          ["--trees-fg-override" as string]: "var(--contrast-foreground)",
        }}
      />
    </div>
  );
}
