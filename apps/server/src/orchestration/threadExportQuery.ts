/**
 * Builds a portable, single-file Markdown export of a thread for sharing
 * outside its environment — see docs/user/thread-sidebar.md ("Export a thread").
 *
 * The export has no access control of its own beyond the read scope that
 * gates this RPC: whatever the thread contains (including any secrets a user
 * pasted into it) goes into the file verbatim, unredacted, by design.
 */
import {
  type ChatAttachment,
  OrchestrationExportThreadError,
  type OrchestrationExportThreadResult,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
  type OrchestrationMessage,
  type ThreadId,
} from "@t3tools/contracts";
import { sanitizeBranchFragment } from "@t3tools/shared/git";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";

import { resolveAttachmentPath } from "../attachmentStore.ts";
import * as CheckpointDiffQuery from "../checkpointing/CheckpointDiffQuery.ts";
import * as ServerConfig from "../config.ts";
import * as ProjectionSnapshotQuery from "./Services/ProjectionSnapshotQuery.ts";

const EXPORT_SCHEMA_VERSION = 1;

function formatAttachmentNote(attachment: ChatAttachment): string {
  const sizeKb = Math.max(1, Math.round(attachment.sizeBytes / 1024));
  return `📎 *${attachment.name}* (${attachment.mimeType}, ${sizeKb} KB) — not included in this export.`;
}

function renderMessage(
  message: OrchestrationMessage,
  imageDataUrlsByAttachmentId: ReadonlyMap<string, string>,
): string {
  const attachmentsMarkdown = (message.attachments ?? [])
    .map((attachment) => {
      if (attachment.type !== "image") return formatAttachmentNote(attachment);
      const dataUrl = imageDataUrlsByAttachmentId.get(attachment.id);
      return dataUrl ? `![${attachment.name}](${dataUrl})` : formatAttachmentNote(attachment);
    })
    .join("\n\n");

  return [
    `### ${message.role} — ${message.createdAt}`,
    "",
    message.text.trim().length > 0 ? message.text : "*(empty message)*",
    attachmentsMarkdown,
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");
}

function renderActivity(activity: OrchestrationThreadActivity): string {
  const payloadJson =
    activity.payload === undefined ? null : JSON.stringify(activity.payload, null, 2);
  return [
    `### tool — ${activity.createdAt}`,
    "",
    `**${activity.kind}**: ${activity.summary}`,
    payloadJson ? ["```json", payloadJson, "```"].join("\n") : "",
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");
}

interface TimelineEntry {
  readonly createdAt: string;
  readonly render: () => string;
}

/** @internal exported for unit tests; not part of the module's public surface. */
export function buildThreadExportMarkdown(input: {
  readonly thread: OrchestrationThread;
  readonly diff: string;
  readonly exportedAt: string;
  readonly imageDataUrlsByAttachmentId: ReadonlyMap<string, string>;
}): OrchestrationExportThreadResult {
  const { thread, diff, exportedAt, imageDataUrlsByAttachmentId } = input;

  const timeline: TimelineEntry[] = [
    ...thread.messages.map((message) => ({
      createdAt: message.createdAt,
      render: () => renderMessage(message, imageDataUrlsByAttachmentId),
    })),
    ...thread.activities.map((activity) => ({
      createdAt: activity.createdAt,
      render: () => renderActivity(activity),
    })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const transcript = timeline.map((entry) => entry.render()).join("\n\n---\n\n");

  const preamble = [
    `# ${thread.title}`,
    "",
    "This is a T3 Code conversation, exported for sharing outside its original environment.",
    "It contains the full message transcript, tool activity, and code changes from the thread,",
    "followed by a machine-readable JSON block carrying the same data for tools that parse it.",
    "",
    `- **Provider**: ${thread.session?.providerName ?? "unknown"}`,
    `- **Branch**: ${thread.branch ?? "(none)"}`,
    `- **Created**: ${thread.createdAt}`,
    `- **Exported**: ${exportedAt}`,
  ].join("\n");

  const diffSection =
    diff.trim().length > 0
      ? ["## Code changes", "", "```diff", diff, "```"].join("\n")
      : ["## Code changes", "", "No code changes were made in this thread."].join("\n");

  const structuredData = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt,
    thread,
    diff,
  };
  const jsonSection = [
    "## Structured data",
    "",
    "```json",
    JSON.stringify(structuredData, null, 2),
    "```",
  ].join("\n");

  return {
    markdown: [preamble, "## Conversation", transcript, diffSection, jsonSection].join("\n\n"),
    suggestedFileName: `${sanitizeBranchFragment(thread.title)}.md`,
  };
}

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
