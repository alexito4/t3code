/**
 * Builds a portable, single-file Markdown export of a thread for sharing
 * outside its environment — see docs/user/thread-sidebar.md ("Export a thread").
 *
 * Pure and platform-agnostic so both the server (fast path, one RPC) and the
 * web client (fallback path, for servers that predate the fast path) can
 * assemble the exact same output from whatever data each already fetched.
 *
 * The export has no access control of its own beyond whatever gated reading
 * the thread in the first place: whatever it contains (including any secrets
 * a user pasted into it) goes into the file verbatim, unredacted, by design.
 */
import type {
  ChatAttachment,
  OrchestrationExportThreadResult,
  OrchestrationThread,
  OrchestrationThreadActivity,
  OrchestrationMessage,
} from "@t3tools/contracts";

import { sanitizeBranchFragment } from "./git.ts";

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
