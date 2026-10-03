/**
 * Builds a portable, single-file Markdown export of a thread for sharing
 * outside its environment — see docs/user/thread-sidebar.md ("Export a thread").
 *
 * Pure, so the client can assemble it from data any official server already
 * serves (`@t3tools/client-runtime/state/thread-export` gathers it). The
 * readable transcript follows the chat timeline minus reasoning; the embedded
 * JSON block keeps the whole projection for a future re-import.
 *
 * The export has no access control of its own beyond whatever gated reading
 * the thread in the first place: whatever it contains (including any secrets
 * a user pasted into it) goes into the file verbatim, unredacted, by design.
 */
import {
  OrchestrationV2ThreadProjectionJson,
  type ChatAttachment,
  type ChatImageAttachment,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import { sanitizeBranchFragment } from "./git.ts";
import { createOrchestrationV2TurnItemVisibility } from "./orchestrationV2Timeline.ts";

/** Version 2 embeds an `OrchestrationV2ThreadProjectionJson`; version 1 carried a V1 thread. */
const EXPORT_SCHEMA_VERSION = 2;

const encodeProjection = Schema.encodeSync(OrchestrationV2ThreadProjectionJson);

export interface ThreadExport {
  readonly markdown: string;
  readonly suggestedFileName: string;
}

/**
 * The newest run count `orchestration.getFullThreadDiff` accepts: ready
 * checkpoints of completed runs, as CheckpointDiffQuery requires. Zero when
 * there are none (no Git project, or history migrated from V1), in which case
 * the thread's code changes are unavailable.
 */
export function latestFullThreadDiffTurnCount(
  projection: Pick<OrchestrationV2ThreadProjection, "runs" | "checkpoints">,
): number {
  const completedRunIds = new Set(
    projection.runs.flatMap((run) => (run.status === "completed" ? [run.id] : [])),
  );
  let latest = 0;
  for (const checkpoint of projection.checkpoints) {
    if (
      checkpoint.status === "ready" &&
      checkpoint.appRunOrdinal !== null &&
      checkpoint.runId !== null &&
      completedRunIds.has(checkpoint.runId)
    ) {
      latest = Math.max(latest, checkpoint.appRunOrdinal);
    }
  }
  return latest;
}

/** Timeline items in display order, hiding what the chat view hides. */
function transcriptItems(
  projection: OrchestrationV2ThreadProjection,
): ReadonlyArray<OrchestrationV2TurnItem> {
  const isVisible = createOrchestrationV2TurnItemVisibility({
    runs: projection.runs,
    attempts: projection.attempts,
    items: projection.turnItems,
  });
  return projection.visibleTurnItems
    .filter((row) => row.visibility !== "local" || isVisible(row.item))
    .sort((left, right) => left.position - right.position)
    .map((row) => row.item);
}

/** Image attachments shown in the transcript, which the caller may inline as data URLs. */
export function threadExportImageAttachments(
  projection: OrchestrationV2ThreadProjection,
): ReadonlyArray<ChatImageAttachment> {
  return transcriptItems(projection).flatMap((item) =>
    item.type === "user_message" || item.type === "assistant_message"
      ? (item.attachments ?? []).filter(
          (attachment): attachment is ChatImageAttachment => attachment.type === "image",
        )
      : [],
  );
}

/** Fences `content` with more backticks than any run inside it, so nothing closes it early. */
function fenced(info: string, content: string): string {
  const longestRun = (content.match(/`+/g) ?? []).reduce(
    (longest, run) => Math.max(longest, run.length),
    0,
  );
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return [`${fence}${info}`, content, fence].join("\n");
}

function blockquote(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function paragraphs(parts: ReadonlyArray<string | null | undefined>): string {
  return parts.filter((part): part is string => part != null && part.length > 0).join("\n\n");
}

function formatAttachmentNote(attachment: ChatAttachment): string {
  const sizeKb = Math.max(1, Math.round(attachment.sizeBytes / 1024));
  return `📎 *${attachment.name}* (${attachment.mimeType}, ${sizeKb} KB) — not included in this export.`;
}

interface RenderContext {
  readonly imageDataUrlsByAttachmentId: ReadonlyMap<string, string>;
  readonly approvalDecisionsByRequestId: ReadonlyMap<string, string>;
}

function renderMessage(
  role: string,
  item: Extract<OrchestrationV2TurnItem, { type: "user_message" | "assistant_message" }>,
  context: RenderContext,
): string {
  const timestamp = DateTime.formatIso(item.startedAt ?? item.completedAt ?? item.updatedAt);
  const attachments = (item.attachments ?? []).map((attachment) => {
    const dataUrl =
      attachment.type === "image"
        ? context.imageDataUrlsByAttachmentId.get(attachment.id)
        : undefined;
    return dataUrl ? `![${attachment.name}](${dataUrl})` : formatAttachmentNote(attachment);
  });
  return paragraphs([
    `### ${role} — ${timestamp}`,
    item.text.trim().length > 0 ? item.text : "*(empty message)*",
    ...attachments,
  ]);
}

/** One transcript entry, or null for items the readable transcript leaves to the JSON block. */
function renderTurnItem(item: OrchestrationV2TurnItem, context: RenderContext): string | null {
  switch (item.type) {
    case "user_message":
      return renderMessage("User", item, context);
    case "assistant_message":
      return renderMessage("Assistant", item, context);
    case "reasoning":
    case "checkpoint":
      // Reasoning stays in the JSON only; checkpoints are covered by "Code changes".
      return null;
    case "proposed_plan":
      return paragraphs(["**Proposed plan**", item.markdown]);
    case "todo_list":
      return paragraphs([
        "**Plan**",
        item.explanation,
        item.steps
          .map(
            (step) =>
              `- [${step.status === "completed" ? "x" : " "}] ${step.text}${
                step.status === "running" ? " *(in progress)*" : ""
              }`,
          )
          .join("\n"),
      ]);
    case "user_input_request":
      return paragraphs([
        "**Question**",
        item.questions.map((question) => `- ${question.header}: ${question.question}`).join("\n"),
      ]);
    case "approval_request": {
      const decision = context.approvalDecisionsByRequestId.get(item.requestId);
      return paragraphs([
        `**Approval requested** (${item.requestKind})${decision ? ` — ${decision}` : ""}`,
        item.prompt ? blockquote(item.prompt) : null,
      ]);
    }
    case "file_change": {
      const counts =
        item.additions === undefined && item.deletions === undefined
          ? ""
          : ` (+${item.additions ?? 0} −${item.deletions ?? 0})`;
      return `**Changed** \`${item.fileName}\`${counts}`;
    }
    case "command_execution": {
      const outcome =
        item.exitCode !== undefined
          ? ` — exit ${item.exitCode}`
          : item.outputIndicatesFailure === true
            ? " — failed"
            : "";
      return paragraphs([`**Command**${outcome}`, fenced("sh", item.input)]);
    }
    case "file_search":
      return `**Searched files**${item.pattern ? ` for \`${item.pattern}\`` : ""}${
        item.results ? ` (${item.results.length} results)` : ""
      }`;
    case "web_search":
      return `**Searched the web**${
        item.patterns && item.patterns.length > 0 ? `: ${item.patterns.join(", ")}` : ""
      }`;
    case "subagent":
      return paragraphs([
        `**Subagent** (${item.driver}, ${item.status})`,
        item.prompt.trim().length > 0 ? blockquote(item.prompt) : null,
        item.result,
      ]);
    case "dynamic_tool":
      return paragraphs([
        `**Tool** \`${item.toolName ?? "unknown"}\``,
        fenced("json", JSON.stringify({ input: item.input, output: item.output }, null, 2)),
      ]);
    case "error":
      return `**Error** (${item.failure.class}): ${item.failure.message}`;
    case "notification":
      return `*Notification (${item.outcome}): ${item.summary}*`;
    case "system_notice":
    case "run_interrupt_request":
    case "run_interrupt_result":
      return item.message.trim().length > 0 ? `*${item.message.trim()}*` : null;
    case "compaction":
      return "*Context compacted*";
    case "handoff":
      return `*Handed off to ${item.toModel ?? item.toProviderInstanceId}*`;
    case "fork":
      return `*Forked into thread ${item.targetThreadId}*`;
    case "thread_created":
      return `*Started thread ${item.targetThreadId} (${item.targetModel})*`;
    default:
      item satisfies never;
      return null;
  }
}

export function buildThreadExportMarkdown(input: {
  readonly projection: OrchestrationV2ThreadProjection;
  /** Full-thread diff; null when the thread's code changes are unavailable. */
  readonly diff: string | null;
  readonly exportedAt: string;
  readonly imageDataUrlsByAttachmentId: ReadonlyMap<string, string>;
}): ThreadExport {
  const { projection, diff, exportedAt } = input;
  const { thread } = projection;
  const context: RenderContext = {
    imageDataUrlsByAttachmentId: input.imageDataUrlsByAttachmentId,
    approvalDecisionsByRequestId: new Map(
      projection.runtimeRequests.flatMap((request) =>
        request.decision === undefined ? [] : [[request.id, request.decision]],
      ),
    ),
  };

  const entries = transcriptItems(projection).flatMap((item) => {
    const rendered = renderTurnItem(item, context);
    return rendered === null ? [] : [rendered];
  });

  const preamble = [
    `# ${thread.title}`,
    "",
    "This is a T3 Code conversation, exported for sharing outside its original environment.",
    "It contains the message transcript, tool activity (without command output), and code",
    "changes from the thread, followed by a machine-readable JSON block carrying the thread's",
    "data for tools that parse it.",
    "",
    `- **Provider**: ${thread.providerInstanceId}`,
    `- **Model**: ${thread.modelSelection.model}`,
    `- **Branch**: ${thread.branch ?? "(none)"}`,
    `- **Created**: ${DateTime.formatIso(thread.createdAt)}`,
    `- **Exported**: ${exportedAt}`,
  ].join("\n");

  const diffBody =
    diff === null
      ? "Code changes are unavailable for this thread. Threads outside a Git repository, threads migrated from an older version of T3 Code, and threads whose checkpoints could not be read have no recorded diff."
      : diff.trim().length > 0
        ? fenced("diff", diff)
        : "No code changes were made in this thread.";

  const structuredData = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt,
    projection: encodeProjection(projection),
    diff,
  };

  return {
    markdown: paragraphs([
      preamble,
      "## Conversation",
      entries.length > 0 ? entries.join("\n\n---\n\n") : "*(no messages)*",
      "## Code changes",
      diffBody,
      "## Structured data",
      fenced("json", JSON.stringify(structuredData, null, 2)),
    ]),
    suggestedFileName: `${sanitizeBranchFragment(thread.title)}.md`,
  };
}
