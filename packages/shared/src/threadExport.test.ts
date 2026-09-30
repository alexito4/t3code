import {
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ChatFileAttachment,
  type ChatImageAttachment,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildThreadExportMarkdown } from "./threadExport.ts";

const CREATED_AT = "2026-01-01T00:00:00.000Z";
const EXPORTED_AT = "2026-01-02T00:00:00.000Z";

function makeThread(overrides: Partial<OrchestrationThread> = {}): OrchestrationThread {
  return {
    id: ThreadId.make("thread-1"),
    projectId: ProjectId.make("project-1"),
    title: "Fix login bug",
    modelSelection: {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-sonnet-4-6",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "fix/login-bug",
    worktreePath: null,
    latestTurn: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    pullRequests: [],
    session: {
      threadId: ThreadId.make("thread-1"),
      status: "idle",
      providerName: "Claude",
      runtimeMode: "full-access",
      activeTurnId: null,
      lastError: null,
      updatedAt: CREATED_AT,
    },
    ...overrides,
  };
}

describe("buildThreadExportMarkdown", () => {
  it("includes the title and thread metadata in the preamble", () => {
    const { markdown } = buildThreadExportMarkdown({
      thread: makeThread(),
      diff: "",
      exportedAt: EXPORTED_AT,
      imageDataUrlsByAttachmentId: new Map(),
    });

    expect(markdown).toContain("# Fix login bug");
    expect(markdown).toContain("**Provider**: Claude");
    expect(markdown).toContain("**Branch**: fix/login-bug");
    expect(markdown).toContain(`**Created**: ${CREATED_AT}`);
    expect(markdown).toContain(`**Exported**: ${EXPORTED_AT}`);
  });

  it("renders messages chronologically interleaved with activity", () => {
    const thread = makeThread({
      messages: [
        {
          id: MessageId.make("msg-2"),
          role: "assistant",
          text: "Done, see the diff.",
          turnId: null,
          streaming: false,
          createdAt: "2026-01-01T00:02:00.000Z",
          updatedAt: "2026-01-01T00:02:00.000Z",
        },
        {
          id: MessageId.make("msg-1"),
          role: "user",
          text: "Please fix the login bug.",
          turnId: null,
          streaming: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      activities: [
        {
          id: EventId.make("activity-1"),
          tone: "tool",
          kind: "exec",
          summary: "Ran `grep -rn login`",
          payload: { command: "grep -rn login" },
          turnId: null,
          createdAt: "2026-01-01T00:01:00.000Z",
        } satisfies OrchestrationThreadActivity,
      ],
    });

    const { markdown } = buildThreadExportMarkdown({
      thread,
      diff: "",
      exportedAt: EXPORTED_AT,
      imageDataUrlsByAttachmentId: new Map(),
    });

    const userIndex = markdown.indexOf("Please fix the login bug.");
    const execIndex = markdown.indexOf("Ran `grep -rn login`");
    const doneIndex = markdown.indexOf("Done, see the diff.");
    expect(userIndex).toBeGreaterThan(-1);
    expect(execIndex).toBeGreaterThan(userIndex);
    expect(doneIndex).toBeGreaterThan(execIndex);
    expect(markdown).toContain('"command": "grep -rn login"');
  });

  it("inlines images that have a resolved data URL and notes the rest", () => {
    const imageAttachment: ChatImageAttachment = {
      type: "image",
      id: "thread-1-11111111-1111-1111-1111-111111111111",
      name: "screenshot.png",
      mimeType: "image/png",
      sizeBytes: 1024,
    };
    const fileAttachment: ChatFileAttachment = {
      type: "file",
      id: "thread-1-22222222-2222-2222-2222-222222222222",
      name: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 2048,
    };
    const thread = makeThread({
      messages: [
        {
          id: MessageId.make("msg-1"),
          role: "user",
          text: "Here's what I see.",
          attachments: [imageAttachment, fileAttachment],
          turnId: null,
          streaming: false,
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        },
      ],
    });

    const { markdown } = buildThreadExportMarkdown({
      thread,
      diff: "",
      exportedAt: EXPORTED_AT,
      imageDataUrlsByAttachmentId: new Map([[imageAttachment.id, "data:image/png;base64,AAAA"]]),
    });

    expect(markdown).toContain("![screenshot.png](data:image/png;base64,AAAA)");
    expect(markdown).toContain("notes.txt");
    expect(markdown).toContain("not included in this export");
  });

  it("notes an image attachment whose bytes could not be resolved", () => {
    const imageAttachment: ChatImageAttachment = {
      type: "image",
      id: "thread-1-33333333-3333-3333-3333-333333333333",
      name: "missing.png",
      mimeType: "image/png",
      sizeBytes: 512,
    };
    const thread = makeThread({
      messages: [
        {
          id: MessageId.make("msg-1"),
          role: "user",
          text: "See attached.",
          attachments: [imageAttachment],
          turnId: null,
          streaming: false,
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        },
      ],
    });

    const { markdown } = buildThreadExportMarkdown({
      thread,
      diff: "",
      exportedAt: EXPORTED_AT,
      imageDataUrlsByAttachmentId: new Map(),
    });

    expect(markdown).not.toContain("![missing.png]");
    expect(markdown).toContain("missing.png");
    expect(markdown).toContain("not included in this export");
  });

  it("embeds a non-empty diff as a fenced diff block", () => {
    const diff = "diff --git a/x b/x\n+added\n";
    const { markdown } = buildThreadExportMarkdown({
      thread: makeThread(),
      diff,
      exportedAt: EXPORTED_AT,
      imageDataUrlsByAttachmentId: new Map(),
    });

    expect(markdown).toContain("## Code changes");
    expect(markdown).toContain(["```diff", diff, "```"].join("\n"));
  });

  it("notes when a thread has no code changes", () => {
    const { markdown } = buildThreadExportMarkdown({
      thread: makeThread(),
      diff: "",
      exportedAt: EXPORTED_AT,
      imageDataUrlsByAttachmentId: new Map(),
    });

    expect(markdown).toContain("No code changes were made in this thread.");
  });

  it("embeds a parseable structured-data block carrying the thread and diff", () => {
    const thread = makeThread();
    const diff = "diff --git a/x b/x\n";
    const { markdown } = buildThreadExportMarkdown({
      thread,
      diff,
      exportedAt: EXPORTED_AT,
      imageDataUrlsByAttachmentId: new Map(),
    });

    const jsonBlockMatch = markdown.match(/## Structured data\n\n```json\n([\s\S]*?)\n```/);
    expect(jsonBlockMatch).not.toBeNull();
    const parsed = JSON.parse(jsonBlockMatch![1]!);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.exportedAt).toBe(EXPORTED_AT);
    expect(parsed.diff).toBe(diff);
    expect(parsed.thread.id).toBe(thread.id);
    expect(parsed.thread.title).toBe(thread.title);
  });

  it("derives the suggested file name from the thread title", () => {
    const { suggestedFileName } = buildThreadExportMarkdown({
      thread: makeThread({ title: "Fix Login Bug!!" }),
      diff: "",
      exportedAt: EXPORTED_AT,
      imageDataUrlsByAttachmentId: new Map(),
    });

    expect(suggestedFileName).toBe("fix-login-bug.md");
  });
});
