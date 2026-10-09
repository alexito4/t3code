/**
 * Thread context for side questions: which turn items a side question sees, how they are
 * formatted, and how a long thread is trimmed to the byte budget. The prompt itself lives in
 * provider-core's `buildSideQuestionPrompt`; these helpers stay in the server because they
 * project turn items through the V2 wire projection.
 *
 * @module textGeneration/SideQuestionContext
 */
import * as NodeBuffer from "node:buffer";
import type { OrchestrationV2TurnItem } from "@t3tools/contracts";

import { projectTurnItemForWire } from "../orchestration-v2/WireProjection.ts";

// Same marker the shared prompt builders use when they truncate earlier content.
const EARLIER_CONTENT_TRUNCATION_MARKER = "[Earlier content truncated]\n\n";

export const SIDE_QUESTION_CONTEXT_MAX_BYTES = 512 * 1024;

/**
 * Turn items a side question is answered against: the conversation and the tool calls the
 * agent made. Thinking traces are working notes, not conversation — see ThreadTitleContext.ts.
 */
export const SIDE_QUESTION_CONTEXT_ITEM_TYPES = [
  "user_message",
  "assistant_message",
  "command_execution",
  "file_change",
  "file_search",
  "web_search",
  "dynamic_tool",
] as const satisfies ReadonlyArray<OrchestrationV2TurnItem["type"]>;

export function isSideQuestionContextWithinLimit(context: string): boolean {
  return NodeBuffer.Buffer.byteLength(context, "utf8") <= SIDE_QUESTION_CONTEXT_MAX_BYTES;
}

/** A finished tool call as the timeline shows it, without full outputs or diffs. */
function sideQuestionToolDetail(item: OrchestrationV2TurnItem): unknown {
  const projected = projectTurnItemForWire(item);
  switch (projected.type) {
    case "command_execution":
      return { command: projected.input, exitCode: projected.exitCode };
    case "file_change":
      return {
        file: projected.fileName,
        additions: projected.additions,
        deletions: projected.deletions,
      };
    case "file_search":
      return { pattern: projected.pattern, results: projected.results };
    case "web_search":
      return { queries: projected.patterns, results: projected.results };
    case "dynamic_tool":
      return { tool: projected.toolName, input: projected.input, output: projected.output };
    default:
      return undefined;
  }
}

/** Formatted context entries from turn items in thread order, oldest first. */
export function sideQuestionContextEntries(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
): Array<string> {
  return items.flatMap((item) => {
    switch (item.type) {
      case "user_message":
        return [`USER:\n${item.text}`];
      case "assistant_message":
        return item.streaming ? [] : [`ASSISTANT:\n${item.text}`];
      default: {
        const detail = item.status === "completed" ? sideQuestionToolDetail(item) : undefined;
        return detail === undefined
          ? []
          : [`TOOL:\n${item.title ?? item.type}\n${JSON.stringify(detail)}`];
      }
    }
  });
}

/** Bytes left for thread context once the earlier side conversation is included. */
export function sideQuestionThreadContextBudget(conversationSection: string): number {
  if (!conversationSection) return SIDE_QUESTION_CONTEXT_MAX_BYTES;
  return SIDE_QUESTION_CONTEXT_MAX_BYTES - NodeBuffer.Buffer.byteLength(conversationSection) - 2;
}

/**
 * Keeps the newest entries that fit in `maxBytes`, so a long thread loses its oldest context
 * instead of failing the side question.
 */
export function fitSideQuestionContext(entries: ReadonlyArray<string>, maxBytes: number): string {
  const budget = maxBytes - NodeBuffer.Buffer.byteLength(EARLIER_CONTENT_TRUNCATION_MARKER);
  const kept: Array<string> = [];
  let used = 0;
  let truncated = false;
  for (const entry of entries.toReversed()) {
    const size = NodeBuffer.Buffer.byteLength(entry) + (kept.length > 0 ? 2 : 0);
    if (used + size > budget) {
      // An oversized newest entry (usually a tool payload) keeps its head; the streaming
      // decode drops a multi-byte character cut in half.
      if (kept.length === 0 && budget > 0) {
        const head = NodeBuffer.Buffer.from(entry).subarray(0, budget);
        kept.push(new TextDecoder().decode(head, { stream: true }));
      }
      truncated = true;
      break;
    }
    kept.push(entry);
    used += size;
  }
  const context = kept.toReversed().join("\n\n");
  return truncated ? `${EARLIER_CONTENT_TRUNCATION_MARKER}${context}` : context;
}

export function formatSideQuestionConversation(
  turns: ReadonlyArray<{ question: string; answer: string }>,
): string {
  return turns
    .flatMap((turn) => [`SIDE USER:\n${turn.question}`, `SIDE ASSISTANT:\n${turn.answer}`])
    .join("\n\n");
}
