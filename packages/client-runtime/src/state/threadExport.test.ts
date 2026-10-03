import { describe, expect, it } from "@effect/vitest";
import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  EnvironmentId,
  MessageId,
  NodeId,
  ORCHESTRATION_V2_WS_METHODS,
  OrchestrationGetFullThreadDiffError,
  OrchestrationV2ThreadDetailSnapshot,
  RunId,
  TurnItemId,
  WS_METHODS,
  type OrchestrationGetFullThreadDiffInput,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import { remoteHttpClientLayer } from "../rpc/http.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import type { RpcSession } from "../rpc/session.ts";
import { v2Now, v2Projection, v2ThreadId } from "./orchestrationV2TestFixtures.ts";
import { createThreadExportCommand } from "./threadExport.ts";

const encodeThreadSnapshot = Schema.encodeSync(OrchestrationV2ThreadDetailSnapshot);

const environmentId = EnvironmentId.make("environment-1");
const httpBaseUrl = "https://environment.test";
const runId = RunId.make("run-1");
const userMessage: OrchestrationV2TurnItem = {
  id: TurnItemId.make("item-user"),
  threadId: v2ThreadId,
  runId,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 0,
  status: "completed",
  title: null,
  startedAt: v2Now,
  completedAt: v2Now,
  updatedAt: v2Now,
  type: "user_message",
  createdBy: "user",
  creationSource: "web",
  messageId: MessageId.make("msg-user"),
  inputIntent: "turn_start",
  text: "Here's what I see.",
  attachments: [
    {
      type: "image",
      id: "thread-v2-11111111-1111-1111-1111-111111111111",
      name: "screenshot.png",
      mimeType: "image/png",
      sizeBytes: 3,
    },
  ],
};
const projection: OrchestrationV2ThreadProjection = {
  ...v2Projection,
  runs: [
    {
      id: runId,
      threadId: v2ThreadId,
      ordinal: 1,
      providerInstanceId: v2Projection.thread.providerInstanceId,
      modelSelection: v2Projection.thread.modelSelection,
      providerThreadId: null,
      userMessageId: MessageId.make("msg-user"),
      rootNodeId: null,
      activeAttemptId: null,
      status: "completed",
      requestedAt: v2Now,
      startedAt: v2Now,
      completedAt: v2Now,
      checkpointId: null,
      contextHandoffId: null,
    },
  ],
  checkpoints: [
    {
      id: CheckpointId.make("checkpoint-1"),
      threadId: v2ThreadId,
      scopeId: CheckpointScopeId.make("scope-1"),
      runId,
      nodeId: NodeId.make("node-1"),
      parentCheckpointId: null,
      ordinalWithinScope: 1,
      appRunOrdinal: 1,
      ref: CheckpointRef.make("refs/t3/checkpoint-1"),
      status: "ready",
      files: [],
      capturedAt: v2Now,
    },
  ],
  turnItems: [userMessage],
  visibleTurnItems: [
    {
      position: 0,
      visibility: "local",
      sourceThreadId: v2ThreadId,
      sourceItemId: userMessage.id,
      item: userMessage,
    },
  ],
};

const exportThread = Effect.fn("exportThreadForTest")(function* (
  getFullThreadDiff: (
    input: OrchestrationGetFullThreadDiffInput,
  ) => Effect.Effect<{ readonly diff: string }, OrchestrationGetFullThreadDiffError>,
) {
  const fetchedUrls: string[] = [];
  const fetchFn: typeof fetch = async (request) => {
    const url = new URL(String(request));
    fetchedUrls.push(url.pathname);
    return url.pathname === "/api/assets/screenshot"
      ? new Response(new TextEncoder().encode("PNG"))
      : Response.json(encodeThreadSnapshot({ snapshotSequence: 1, projection }));
  };
  const client = {
    [ORCHESTRATION_V2_WS_METHODS.getFullThreadDiff]: getFullThreadDiff,
    [WS_METHODS.assetsCreateUrl]: () =>
      Effect.succeed({ relativeUrl: "/api/assets/screenshot", expiresAt: 0 }),
  } as unknown as WsRpcProtocolClient;
  const target = new PrimaryConnectionTarget({
    environmentId,
    label: "Environment",
    httpBaseUrl,
    wsBaseUrl: "wss://environment.test",
  });
  const prepared: PreparedConnection = {
    environmentId,
    label: "Environment",
    httpBaseUrl,
    socketUrl: "wss://environment.test/ws",
    httpAuthorization: null,
    target,
  };
  const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
    target,
    state: yield* SubscriptionRef.make<SupervisorConnectionState>({
      ...AVAILABLE_CONNECTION_STATE,
      phase: "connected" as const,
    }),
    session: yield* SubscriptionRef.make(Option.some({ client } as RpcSession)),
    prepared: yield* SubscriptionRef.make(Option.some(prepared)),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  });
  const environments = EnvironmentRegistry.EnvironmentRegistry.of({
    run: (_id, effect) =>
      Effect.provideService(effect, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
    followStream: (_id, stream) =>
      Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
  } as EnvironmentRegistry.EnvironmentRegistry["Service"]);
  const registry = AtomRegistry.make();
  yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
  const command = createThreadExportCommand(
    Atom.runtime(
      Layer.mergeAll(
        Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environments),
        remoteHttpClientLayer(fetchFn),
      ),
    ),
  );
  const result = yield* Effect.promise(() =>
    command.run(registry, { environmentId, input: { threadId: v2ThreadId } }),
  );
  if (result._tag !== "Success") throw new Error("Expected the export to succeed.");
  return { markdown: result.value.markdown, fetchedUrls };
});

describe("createThreadExportCommand", () => {
  it.effect("exports the full HTTP projection, its full-thread diff, and inlined images", () =>
    Effect.gen(function* () {
      const diffRequests: OrchestrationGetFullThreadDiffInput[] = [];
      const { markdown, fetchedUrls } = yield* exportThread((input) => {
        diffRequests.push(input);
        return Effect.succeed({ diff: "diff --git a/x b/x\n+added\n" });
      });

      expect(fetchedUrls).toEqual([
        `/api/orchestration/threads/${v2ThreadId}`,
        "/api/assets/screenshot",
      ]);
      expect(diffRequests).toEqual([{ threadId: v2ThreadId, toTurnCount: 1 }]);
      expect(markdown).toContain("+added");
      expect(markdown).toContain("![screenshot.png](data:image/png;base64,UE5H)");
    }),
  );

  it.effect("still exports when the thread's code changes cannot be read", () =>
    Effect.gen(function* () {
      const { markdown } = yield* exportThread(() =>
        Effect.fail(new OrchestrationGetFullThreadDiffError({ message: "Checkpoint missing." })),
      );

      expect(markdown).toContain("Here's what I see.");
      expect(markdown).toContain("Code changes are unavailable for this thread.");
    }),
  );
});
