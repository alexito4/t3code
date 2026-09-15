import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { type SelectedLineRange } from "@pierre/diffs";
import { Editor } from "@pierre/diffs/editor";
import { EditProvider, File, Virtualizer } from "@pierre/diffs/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { buildScratchpadReviewComment } from "~/reviewCommentContext";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { useTheme } from "~/hooks/useTheme";
import { orchestrationEnvironment } from "~/state/orchestration";

import { DiffCommentAnnotation } from "../diffs/DiffCommentAnnotation";
import {
  type FileCommentAnnotationEntry,
  type FileCommentAnnotationGroup,
  type FileCommentLineAnnotation,
  formatFileCommentRange,
  nextFileCommentId,
  normalizeFileCommentRange,
  remapFileCommentAnnotations,
} from "../files/fileCommentAnnotations";
import { installFileEditorDismissal } from "../files/fileEditorDismissal";
import { fileContentRevision } from "../files/fileContentRevision";
import { useScratchpadSaveCoordinator } from "./useScratchpadSaveCoordinator";

interface ScratchpadPanelProps {
  threadRef: ScopedThreadRef;
  composerDraftTarget: ScopedThreadRef | DraftId;
}

export default function ScratchpadPanel({ threadRef, composerDraftTarget }: ScratchpadPanelProps) {
  const result = useAtomValue(
    orchestrationEnvironment.threadScratchpad({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    }),
  );
  if (result._tag === "Failure") {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-xs text-muted-foreground">
        Could not load the scratchpad.
      </div>
    );
  }
  if (result._tag !== "Success") {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-xs text-muted-foreground">
        Loading…
      </div>
    );
  }
  return (
    <ScratchpadEditor
      key={threadRef.threadId}
      threadRef={threadRef}
      composerDraftTarget={composerDraftTarget}
      initialContent={result.value.content}
    />
  );
}

function ScratchpadEditor({
  threadRef,
  composerDraftTarget,
  initialContent,
}: ScratchpadPanelProps & { initialContent: string }) {
  const { resolvedTheme } = useTheme();
  const addReviewComment = useComposerDraftStore((store) => store.addReviewComment);
  const removeReviewComment = useComposerDraftStore((store) => store.removeReviewComment);
  const saveCoordinator = useScratchpadSaveCoordinator({
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
  });

  const [contents, setContents] = useState(initialContent);
  const [lineAnnotations, setLineAnnotations] = useState<FileCommentLineAnnotation[]>([]);
  const [selectedRange, setSelectedRange] = useState<SelectedLineRange | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  const editor = useMemo(
    () =>
      new Editor<FileCommentAnnotationGroup>({
        persistState: true,
        persistStateStorage: "inMemory",
        onChange: (file, nextLineAnnotations) => {
          setContents(file.contents);
          saveCoordinator.change(file.contents);
          if (nextLineAnnotations) {
            const remapped = remapFileCommentAnnotations(
              nextLineAnnotations as FileCommentLineAnnotation[],
            );
            setLineAnnotations(remapped);
            for (const annotation of remapped) {
              for (const entry of annotation.metadata.entries) {
                if (entry.kind !== "comment") continue;
                addReviewComment(
                  composerDraftTarget,
                  buildScratchpadReviewComment({
                    id: entry.id,
                    threadId: threadRef.threadId,
                    startLine: entry.startLine,
                    endLine: entry.endLine,
                    text: entry.text,
                    contents: file.contents,
                  }),
                );
              }
            }
          }
        },
      }),
    [addReviewComment, composerDraftTarget, saveCoordinator, threadRef.threadId],
  );

  useEffect(
    () => () => {
      editor.cleanUp();
    },
    [editor],
  );

  const removeAnnotationEntry = useCallback(
    (entryId: string) => {
      setSelectedRange(null);
      removeReviewComment(composerDraftTarget, entryId);
      setLineAnnotations((current) =>
        current.flatMap((annotation) => {
          const entries = annotation.metadata.entries.filter((entry) => entry.id !== entryId);
          return entries.length > 0 ? [{ ...annotation, metadata: { entries } }] : [];
        }),
      );
    },
    [composerDraftTarget, removeReviewComment],
  );

  const submitAnnotationEntry = useCallback(
    (entryId: string, text: string) => {
      setSelectedRange(null);
      const entry = lineAnnotations
        .flatMap((annotation) => annotation.metadata.entries)
        .find((candidate) => candidate.id === entryId);
      if (entry) {
        addReviewComment(
          composerDraftTarget,
          buildScratchpadReviewComment({
            id: entry.id,
            threadId: threadRef.threadId,
            startLine: entry.startLine,
            endLine: entry.endLine,
            text,
            contents,
          }),
        );
      }
      setLineAnnotations((current) =>
        current.map((annotation) => ({
          ...annotation,
          metadata: {
            entries: annotation.metadata.entries.map((annotationEntry) =>
              annotationEntry.id === entryId
                ? { ...annotationEntry, kind: "comment" as const, text }
                : annotationEntry,
            ),
          },
        })),
      );
    },
    [addReviewComment, composerDraftTarget, contents, lineAnnotations, threadRef.threadId],
  );

  const beginComment = useCallback(
    (range: SelectedLineRange) => {
      editor.setSelections([]);
      editor.blur();
      const { startLine, endLine } = normalizeFileCommentRange(range);
      const draftEntry: FileCommentAnnotationEntry = {
        id: nextFileCommentId(),
        kind: "draft",
        startLine,
        endLine,
        text: "",
      };
      setLineAnnotations((current) => {
        const withoutDraft = current.flatMap((annotation) => {
          const entries = annotation.metadata.entries.filter((entry) => entry.kind !== "draft");
          return entries.length > 0 ? [{ ...annotation, metadata: { entries } }] : [];
        });
        const existingIndex = withoutDraft.findIndex(
          (annotation) => annotation.lineNumber === endLine,
        );
        if (existingIndex < 0) {
          return [...withoutDraft, { lineNumber: endLine, metadata: { entries: [draftEntry] } }];
        }
        return withoutDraft.map((annotation, index) =>
          index === existingIndex
            ? { ...annotation, metadata: { entries: [...annotation.metadata.entries, draftEntry] } }
            : annotation,
        );
      });
    },
    [editor],
  );

  const hasOpenCommentForm = lineAnnotations.some((annotation) =>
    annotation.metadata.entries.some((entry) => entry.kind === "draft"),
  );

  useEffect(() => {
    const root = surfaceRef.current;
    if (!root) return;
    return installFileEditorDismissal({
      root,
      editor,
      isBlocked: () => hasOpenCommentForm,
      onDismiss: () => setSelectedRange(null),
    });
  }, [editor, hasOpenCommentForm]);

  const handleLineSelectionEnd = useCallback(
    (range: SelectedLineRange | null) => {
      setSelectedRange(range);
      if (range) beginComment(range);
    },
    [beginComment],
  );

  return (
    <EditProvider editor={editor}>
      <div ref={surfaceRef} className="flex min-h-0 flex-1">
        <Virtualizer
          className="file-preview-virtualizer min-h-0 flex-1 overflow-auto"
          config={{ overscrollSize: 600, intersectionObserverMargin: 1200 }}
        >
          <File<FileCommentAnnotationGroup>
            file={{
              name: "Scratchpad",
              contents,
              cacheKey: `scratchpad:${threadRef.threadId}:${fileContentRevision(contents)}`,
            }}
            options={{
              disableFileHeader: true,
              enableGutterUtility: !hasOpenCommentForm,
              enableLineSelection: !hasOpenCommentForm,
              onGutterUtilityClick: setSelectedRange,
              onLineSelectionChange: setSelectedRange,
              onLineSelectionEnd: handleLineSelectionEnd,
              overflow: "wrap",
              theme: resolveDiffThemeName(resolvedTheme),
              preferredHighlighter: PREFERRED_HIGHLIGHTER,
              themeType: resolvedTheme,
            }}
            selectedLines={selectedRange}
            lineAnnotations={lineAnnotations}
            renderAnnotation={(annotation) => (
              <div className="py-1">
                {annotation.metadata.entries.map((entry) => (
                  <DiffCommentAnnotation
                    key={entry.id}
                    kind={entry.kind}
                    rangeLabel={formatFileCommentRange(entry.startLine, entry.endLine)}
                    text={entry.text}
                    onCancel={() => removeAnnotationEntry(entry.id)}
                    onComment={(text) => submitAnnotationEntry(entry.id, text)}
                    onDelete={() => removeAnnotationEntry(entry.id)}
                  />
                ))}
              </div>
            )}
            className="min-h-full"
            contentEditable
          />
        </Virtualizer>
      </div>
    </EditProvider>
  );
}
