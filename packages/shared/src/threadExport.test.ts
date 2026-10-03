import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  MessageId,
  NodeId,
  OrchestrationV2ThreadProjectionJson,
  ProjectId,
  ProviderInstanceId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
  type ChatFileAttachment,
  type ChatImageAttachment,
  type OrchestrationV2Checkpoint,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  buildThreadExportMarkdown,
  latestFullThreadDiffTurnCount,
  threadExportImageAttachments,
} from "./threadExport.ts";

const CREATED_AT = "2026-01-01T00:00:00.000Z";
const EXPORTED_AT = "2026-01-02T00:00:00.000Z";
const at = (iso: string) => DateTime.makeUnsafe(iso);
const decodeProjectionJson = Schema.decodeUnknownSync(OrchestrationV2ThreadProjectionJson);

const threadId = ThreadId.make("thread-1");
const providerInstanceId = ProviderInstanceId.make("claudeAgent");
const completedRunId = RunId.make("run-1");
const rolledBackRunId = RunId.make("run-2");

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

function makeRun(id: RunId, ordinal: number, status: OrchestrationV2Run["status"]) {
  return {
    id,
    threadId,
    ordinal,
    providerInstanceId,
    modelSelection: { instanceId: providerInstanceId, model: "claude-sonnet-4-6" },
    providerThreadId: null,
    userMessageId: MessageId.make(`msg-${id}`),
    rootNodeId: null,
    activeAttemptId: null,
    status,
    requestedAt: at(CREATED_AT),
    startedAt: at(CREATED_AT),
    completedAt: at(CREATED_AT),
    checkpointId: null,
    contextHandoffId: null,
  } satisfies OrchestrationV2Run;
}

function itemBase(id: string, minute: number, runId: RunId | null = completedRunId) {
  const time = at(`2026-01-01T00:0${minute}:00.000Z`);
  return {
    id: TurnItemId.make(id),
    threadId,
    runId,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: minute,
    status: "completed",
    title: null,
    startedAt: time,
    completedAt: time,
    updatedAt: time,
  } as const;
}

function makeCheckpoint(
  ordinal: number,
  runId: RunId,
  status: OrchestrationV2Checkpoint["status"] = "ready",
): OrchestrationV2Checkpoint {
  return {
    id: CheckpointId.make(`checkpoint-${ordinal}`),
    threadId,
    scopeId: CheckpointScopeId.make("scope-1"),
    runId,
    nodeId: NodeId.make("node-1"),
    parentCheckpointId: null,
    ordinalWithinScope: ordinal,
    appRunOrdinal: ordinal,
    ref: CheckpointRef.make(`refs/t3/checkpoint-${ordinal}`),
    status,
    files: [],
    capturedAt: at(CREATED_AT),
  };
}

// Listed out of position order: the export follows `position`, not array order.
const items: ReadonlyArray<OrchestrationV2TurnItem> = [
  {
    ...itemBase("item-assistant", 5),
    type: "assistant_message",
    messageId: MessageId.make("msg-assistant"),
    text: "Done, see the diff.",
    streaming: false,
  },
  {
    ...itemBase("item-user", 0),
    type: "user_message",
    createdBy: "user",
    creationSource: "web",
    messageId: MessageId.make("msg-user"),
    inputIntent: "turn_start",
    text: "Please fix the login bug.",
    attachments: [imageAttachment, fileAttachment],
  },
  {
    ...itemBase("item-reasoning", 1),
    type: "reasoning",
    text: "Secret chain of thought.",
    streaming: false,
  },
  {
    ...itemBase("item-command", 2),
    type: "command_execution",
    input: "grep -rn login",
    exitCode: 1,
  },
  {
    ...itemBase("item-file", 3),
    type: "file_change",
    fileName: "src/login.ts",
    additions: 3,
    deletions: 1,
  },
  {
    ...itemBase("item-approval", 4),
    type: "approval_request",
    requestId: RuntimeRequestId.make("request-1"),
    requestKind: "command",
    prompt: "Run the test suite?",
  },
  {
    ...itemBase("item-rolled-back", 6, rolledBackRunId),
    type: "assistant_message",
    messageId: MessageId.make("msg-rolled-back"),
    text: "This answer was rolled back.",
    streaming: false,
  },
];

function makeProjection(
  overrides: Partial<OrchestrationV2ThreadProjection> = {},
): OrchestrationV2ThreadProjection {
  return {
    thread: {
      id: threadId,
      projectId: ProjectId.make("project-1"),
      title: "Fix login bug",
      providerInstanceId,
      modelSelection: { instanceId: providerInstanceId, model: "claude-sonnet-4-6" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "fix/login-bug",
      worktreePath: null,
      activeProviderThreadId: null,
      lineage: { rootThreadId: threadId, parentThreadId: null, relationshipToParent: null },
      forkedFrom: null,
      createdBy: "user",
      creationSource: "web",
      createdAt: at(CREATED_AT),
      updatedAt: at(CREATED_AT),
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    },
    runs: [makeRun(completedRunId, 1, "completed"), makeRun(rolledBackRunId, 2, "rolled_back")],
    attempts: [],
    nodes: [],
    subagents: [],
    providerSessions: [],
    providerThreads: [],
    providerTurns: [],
    runtimeRequests: [
      {
        id: RuntimeRequestId.make("request-1"),
        nodeId: NodeId.make("node-1"),
        providerTurnId: null,
        nativeRequestRef: null,
        kind: "command",
        status: "resolved",
        responseCapability: { type: "message" },
        createdAt: at(CREATED_AT),
        resolvedAt: at(CREATED_AT),
        decision: "decline",
      },
    ],
    messages: [],
    plans: [],
    turnItems: items,
    checkpointScopes: [],
    checkpoints: [],
    contextHandoffs: [],
    contextTransfers: [],
    visibleTurnItems: items.map((item) => ({
      position: item.ordinal,
      visibility: "local",
      sourceThreadId: threadId,
      sourceItemId: item.id,
      item,
    })),
    updatedAt: at(CREATED_AT),
    ...overrides,
  };
}

function exportOf(
  input: {
    readonly projection?: OrchestrationV2ThreadProjection;
    readonly diff?: string | null;
    readonly images?: ReadonlyMap<string, string>;
  } = {},
) {
  return buildThreadExportMarkdown({
    projection: input.projection ?? makeProjection(),
    diff: input.diff === undefined ? "" : input.diff,
    exportedAt: EXPORTED_AT,
    imageDataUrlsByAttachmentId: input.images ?? new Map(),
  });
}

function parseStructuredData(markdown: string) {
  const match = markdown.match(/## Structured data\n\n(`{3,})json\n([\s\S]*?)\n\1/);
  expect(match).not.toBeNull();
  return JSON.parse(match![2]!);
}

describe("buildThreadExportMarkdown", () => {
  it("includes the title and thread metadata in the preamble", () => {
    const { markdown } = exportOf();

    expect(markdown).toContain("# Fix login bug");
    expect(markdown).toContain("**Provider**: claudeAgent");
    expect(markdown).toContain("**Model**: claude-sonnet-4-6");
    expect(markdown).toContain("**Branch**: fix/login-bug");
    expect(markdown).toContain(`**Created**: ${CREATED_AT}`);
    expect(markdown).toContain(`**Exported**: ${EXPORTED_AT}`);
  });

  it("renders the visible timeline in position order and leaves out reasoning", () => {
    const { markdown } = exportOf();

    const order = [
      "### User — 2026-01-01T00:00:00.000Z",
      "**Command** — exit 1",
      "**Changed** `src/login.ts` (+3 −1)",
      "**Approval requested** (command) — decline",
      "### Assistant — 2026-01-01T00:05:00.000Z",
    ].map((text) => markdown.indexOf(text));
    expect(order.every((index) => index > -1)).toBe(true);
    expect(order).toEqual([...order].sort((left, right) => left - right));
    expect(markdown).toContain(["```sh", "grep -rn login", "```"].join("\n"));
    expect(markdown).toContain("> Run the test suite?");

    const conversation = markdown.slice(0, markdown.indexOf("## Structured data"));
    expect(conversation).not.toContain("Secret chain of thought.");
    expect(conversation).not.toContain("This answer was rolled back.");
  });

  it("inlines images that have a resolved data URL and notes the rest", () => {
    const projection = makeProjection();
    expect(threadExportImageAttachments(projection)).toEqual([imageAttachment]);

    const { markdown } = exportOf({
      projection,
      images: new Map([[imageAttachment.id, "data:image/png;base64,AAAA"]]),
    });
    expect(markdown).toContain("![screenshot.png](data:image/png;base64,AAAA)");
    expect(markdown).toContain("📎 *notes.txt* (text/plain, 2 KB) — not included in this export.");

    const withoutImages = exportOf({ projection }).markdown;
    expect(withoutImages).not.toContain("![screenshot.png]");
    expect(withoutImages).toContain("📎 *screenshot.png*");
  });

  it("fences the diff so backticks inside it cannot close the block", () => {
    const diff = "diff --git a/README.md b/README.md\n ```sh\n+npm test\n ```\n";
    const { markdown } = exportOf({ diff });

    expect(markdown).toContain(["## Code changes", "", "````diff", diff, "````"].join("\n"));
  });

  it("distinguishes a thread without changes from one whose changes are unavailable", () => {
    expect(exportOf({ diff: "" }).markdown).toContain("No code changes were made in this thread.");

    const unavailable = exportOf({ diff: null }).markdown;
    expect(unavailable).toContain("Code changes are unavailable for this thread.");
    expect(parseStructuredData(unavailable).diff).toBeNull();
  });

  it("embeds the full projection as version 2 JSON that decodes back", () => {
    const projection = makeProjection();
    const diff = "diff --git a/x b/x\n";
    const data = parseStructuredData(exportOf({ projection, diff }).markdown);

    expect(data.schemaVersion).toBe(2);
    expect(data.exportedAt).toBe(EXPORTED_AT);
    expect(data.diff).toBe(diff);
    const decoded = decodeProjectionJson(data.projection);
    expect(decoded.thread.title).toBe("Fix login bug");
    // The JSON keeps what the readable transcript leaves out.
    expect(decoded.turnItems.map((item) => item.type)).toContain("reasoning");
    expect(decoded.visibleTurnItems).toHaveLength(projection.visibleTurnItems.length);
  });

  it("derives the suggested file name from the thread title", () => {
    const projection = makeProjection();
    const { suggestedFileName } = exportOf({
      projection: { ...projection, thread: { ...projection.thread, title: "Fix Login Bug!!" } },
    });

    expect(suggestedFileName).toBe("fix-login-bug.md");
  });
});

describe("latestFullThreadDiffTurnCount", () => {
  it("uses the newest ready checkpoint of a completed run", () => {
    const runningRunId = RunId.make("run-3");
    const projection = makeProjection({
      runs: [makeRun(completedRunId, 1, "completed"), makeRun(runningRunId, 3, "running")],
      checkpoints: [
        makeCheckpoint(1, completedRunId),
        makeCheckpoint(2, completedRunId, "missing"),
        makeCheckpoint(3, runningRunId),
      ],
    });

    expect(latestFullThreadDiffTurnCount(projection)).toBe(1);
  });

  it("is zero for a thread without checkpoints", () => {
    expect(latestFullThreadDiffTurnCount(makeProjection())).toBe(0);
  });
});
