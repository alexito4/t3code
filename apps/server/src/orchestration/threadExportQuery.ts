/**
 * Server-side fast path for exporting a thread: one RPC does everything,
 * because the server already has git and the filesystem for the diff and
 * image attachments. The actual markdown assembly is shared with the web
 * client's fallback path — see `@t3tools/shared/threadExport`.
 */
import { OrchestrationExportThreadError, type ThreadId } from "@t3tools/contracts";
import { buildThreadExportMarkdown } from "@t3tools/shared/threadExport";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";

import { resolveAttachmentPath } from "../attachmentStore.ts";
import * as CheckpointDiffQuery from "../checkpointing/CheckpointDiffQuery.ts";
import * as ServerConfig from "../config.ts";
import * as ProjectionSnapshotQuery from "./Services/ProjectionSnapshotQuery.ts";

/**
 * Reads a thread's full detail, its full-thread diff (when it has any
 * checkpoints), and inlines its image attachments as base64 data URLs —
 * everything else about the shape of the export lives in
 * `buildThreadExportMarkdown`, which this only feeds.
 */
export const exportThread = Effect.fn("orchestration.exportThread")(function* (input: {
  readonly threadId: ThreadId;
}) {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const checkpointDiffQuery = yield* CheckpointDiffQuery.CheckpointDiffQuery;
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;

  const threadOption = yield* projectionSnapshotQuery.getThreadDetailById(input.threadId).pipe(
    Effect.mapError(
      (cause) =>
        new OrchestrationExportThreadError({
          message: "Failed to load thread for export.",
          cause,
        }),
    ),
  );
  if (Option.isNone(threadOption)) {
    return yield* new OrchestrationExportThreadError({
      message: `Thread '${input.threadId}' not found.`,
    });
  }
  const thread = threadOption.value;

  const latestCheckpointTurnCount = thread.checkpoints.reduce(
    (max, checkpoint) => Math.max(max, checkpoint.checkpointTurnCount),
    0,
  );
  const diff =
    latestCheckpointTurnCount > 0
      ? (yield* checkpointDiffQuery
          .getFullThreadDiff({ threadId: input.threadId, toTurnCount: latestCheckpointTurnCount })
          .pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationExportThreadError({
                  message: "Failed to load the thread's code changes for export.",
                  cause,
                }),
            ),
          )).diff
      : "";

  const imageAttachments = thread.messages.flatMap((message) =>
    (message.attachments ?? []).filter((attachment) => attachment.type === "image"),
  );
  const imageDataUrlsByAttachmentId = new Map<string, string>();
  for (const attachment of imageAttachments) {
    if (imageDataUrlsByAttachmentId.has(attachment.id)) continue;
    const path = resolveAttachmentPath({ attachmentsDir: config.attachmentsDir, attachment });
    if (!path) continue;
    // Missing/unreadable image files skip inlining rather than failing the
    // whole export — the rest of the thread is still worth sharing.
    const bytes = yield* fileSystem.readFile(path).pipe(Effect.option);
    if (Option.isNone(bytes)) continue;
    imageDataUrlsByAttachmentId.set(
      attachment.id,
      `data:${attachment.mimeType};base64,${Encoding.encodeBase64(bytes.value)}`,
    );
  }

  return buildThreadExportMarkdown({
    thread,
    diff,
    exportedAt: DateTime.formatIso(yield* DateTime.now),
    imageDataUrlsByAttachmentId,
  });
});
