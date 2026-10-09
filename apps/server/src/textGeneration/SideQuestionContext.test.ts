import { describe, expect, it } from "vite-plus/test";
import {
  MessageId,
  type OrchestrationV2TurnItem,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  fitSideQuestionContext,
  formatSideQuestionConversation,
  isSideQuestionContextWithinLimit,
  SIDE_QUESTION_CONTEXT_MAX_BYTES,
  sideQuestionContextEntries,
} from "./SideQuestionContext.ts";

describe("side question context", () => {
  it("rejects context above the provider-safe limit", () => {
    expect(isSideQuestionContextWithinLimit("a".repeat(SIDE_QUESTION_CONTEXT_MAX_BYTES))).toBe(
      true,
    );
    expect(isSideQuestionContextWithinLimit("a".repeat(SIDE_QUESTION_CONTEXT_MAX_BYTES + 1))).toBe(
      false,
    );
  });

  it("uses the conversation and finished tool calls without unfinished replies or tool output", () => {
    const at = DateTime.makeUnsafe("2026-08-26T10:00:00.000Z");
    const base = (id: string, ordinal: number) => ({
      id: TurnItemId.make(id),
      threadId: ThreadId.make("thread-side-question"),
      runId: null,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal,
      status: "completed" as const,
      title: null,
      startedAt: at,
      completedAt: at,
      updatedAt: at,
    });
    const items: ReadonlyArray<OrchestrationV2TurnItem> = [
      {
        ...base("user", 1),
        type: "user_message",
        createdBy: "user",
        creationSource: "web",
        messageId: MessageId.make("message-user"),
        inputIntent: "turn_start",
        text: "Find the reconnect bug",
        attachments: [],
      },
      {
        ...base("command", 2),
        type: "command_execution",
        title: "Ran grep",
        input: "grep -rn token session.ts",
        output: "FULL_COMMAND_OUTPUT",
        exitCode: 0,
      },
      {
        ...base("running", 3),
        status: "running",
        type: "command_execution",
        title: "Running tests",
        input: "pnpm test",
      },
      {
        ...base("answer", 4),
        type: "assistant_message",
        messageId: MessageId.make("message-answer"),
        text: "The stored token was stale",
        streaming: false,
      },
      {
        ...base("streaming", 5),
        type: "assistant_message",
        messageId: MessageId.make("message-streaming"),
        text: "unfinished reply",
        streaming: true,
      },
    ];

    const context = sideQuestionContextEntries(items).join("\n\n");

    expect(context).toContain("USER:\nFind the reconnect bug");
    expect(context).toContain("TOOL:\nRan grep\n");
    expect(context).toContain("grep -rn token session.ts");
    expect(context).toContain("ASSISTANT:\nThe stored token was stale");
    expect(context).not.toContain("FULL_COMMAND_OUTPUT");
    expect(context).not.toContain("Running tests");
    expect(context).not.toContain("unfinished reply");
    expect(context.indexOf("Find the reconnect bug")).toBeLessThan(context.indexOf("Ran grep"));
  });

  it("keeps the newest context entries that fit and marks what was dropped", () => {
    expect(fitSideQuestionContext(["USER:\noldest", "USER:\nmiddle", "USER:\nnewest"], 50)).toBe(
      "[Earlier content truncated]\n\nUSER:\nnewest",
    );
  });

  it("leaves context that fits untouched", () => {
    expect(fitSideQuestionContext(["USER:\nfirst", "ASSISTANT:\nsecond"], 1_000)).toBe(
      "USER:\nfirst\n\nASSISTANT:\nsecond",
    );
  });

  it("clips an oversized newest entry within the byte budget", () => {
    const fitted = fitSideQuestionContext([`TOOL:\n${"é".repeat(100)}`], 64);

    expect(fitted.startsWith("[Earlier content truncated]\n\nTOOL:\né")).toBe(true);
    expect(Buffer.byteLength(fitted)).toBeLessThanOrEqual(64);
    expect(fitted).not.toContain("\uFFFD");
  });

  it("formats earlier side turns with distinct roles", () => {
    expect(
      formatSideQuestionConversation([
        {
          question: "What caused the reconnect bug?",
          answer: "The stored token was stale.",
        },
      ]),
    ).toBe(
      "SIDE USER:\nWhat caused the reconnect bug?\n\nSIDE ASSISTANT:\nThe stored token was stale.",
    );
  });
});
