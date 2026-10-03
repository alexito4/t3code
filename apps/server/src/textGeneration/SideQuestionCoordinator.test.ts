import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  MessageId,
  type ModelSelection,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import type { ProjectionRecordFilter } from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SideQuestionCoordinator from "./SideQuestionCoordinator.ts";
import * as TextGeneration from "./TextGeneration.ts";
import { SIDE_QUESTION_CONTEXT_MAX_BYTES } from "./TextGenerationPrompts.ts";

const defaultThreadId = ThreadId.make("thread:side-question");
const projectId = ProjectId.make("project:side-question");
const defaultModelSelection: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5-codex",
};
const at = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");

const itemBase = (id: string, ordinal: number, runId: RunId | null = null) => ({
  id: TurnItemId.make(id),
  threadId: defaultThreadId,
  runId,
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

const userMessage = (
  id: string,
  ordinal: number,
  text: string,
  runId: RunId | null = null,
): OrchestrationV2TurnItem => ({
  ...itemBase(id, ordinal, runId),
  type: "user_message",
  createdBy: "user",
  creationSource: "web",
  messageId: MessageId.make(`message:${id}`),
  inputIntent: "turn_start",
  text,
  attachments: [],
});

const assistantMessage = (
  id: string,
  ordinal: number,
  text: string,
  runId: RunId | null = null,
): OrchestrationV2TurnItem => ({
  ...itemBase(id, ordinal, runId),
  type: "assistant_message",
  messageId: MessageId.make(`message:${id}`),
  text,
  streaming: false,
});

/** The coordinator with thread reads and text generation stubbed out. */
const makeCoordinator = (
  input: {
    readonly worktreePath?: string | null;
    readonly runs?: ReadonlyArray<{ readonly id: RunId; readonly status: string }>;
    readonly turnItems?: ReadonlyArray<OrchestrationV2TurnItem>;
    readonly onRead?: (filter: ProjectionRecordFilter | undefined) => void;
    readonly answer?: TextGeneration.TextGeneration["Service"]["answerSideQuestion"];
  } = {},
) =>
  SideQuestionCoordinator.make.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          getThreadRecords: (_threadId, _fields, filter) =>
            Effect.sync(() => {
              input.onRead?.(filter);
              return {
                thread: {
                  id: defaultThreadId,
                  projectId,
                  modelSelection: defaultModelSelection,
                  worktreePath: input.worktreePath ?? null,
                },
                runs: input.runs ?? [],
                turnItems: input.turnItems ?? [],
              } as unknown as OrchestrationV2ThreadProjection;
            }),
        }),
        Layer.mock(ProjectStore.ProjectStoreV2)({
          get: () =>
            Effect.succeed(
              Option.some({
                projectId,
                title: "Project",
                workspaceRoot: "/repo",
                defaultModelSelection: null,
                defaultThreadEnvMode: null,
                autoPull: false,
                faviconPath: null,
                projectIcon: null,
                scripts: [],
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
                deletedAt: null,
              }),
            ),
        }),
        Layer.mock(TextGeneration.TextGeneration)({
          answerSideQuestion:
            input.answer ?? (() => Effect.die("answerSideQuestion is not stubbed in this test")),
        }),
      ),
    ),
  );

it.layer(NodeServices.layer)("SideQuestionCoordinator", (it) => {
  it.effect("answers from the thread's turn items without writing to the thread", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const rolledBackRunId = RunId.make("run:rolled-back");
        const received: Array<TextGeneration.SideQuestionGenerationInput> = [];
        const filters: Array<ProjectionRecordFilter | undefined> = [];
        const sideModelSelection: ModelSelection = {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-sonnet-4-5",
          options: [{ id: "reasoningEffort", value: "high" }],
        };
        // Only the record read is stubbed, so any dispatch to the thread would die.
        const coordinator = yield* makeCoordinator({
          worktreePath: "/repo/.worktrees/side",
          runs: [{ id: rolledBackRunId, status: "rolled_back" }],
          turnItems: [
            userMessage("older", 1, "Older context"),
            {
              ...itemBase("command", 2),
              type: "command_execution",
              title: "Ran grep",
              input: "grep -rn token",
              output: "FULL_TOOL_OUTPUT",
              exitCode: 0,
            },
            assistantMessage("current", 3, "Current context"),
            userMessage("undone", 4, "Undone by a checkpoint restore", rolledBackRunId),
          ],
          onRead: (filter) => filters.push(filter),
          answer: (generation) =>
            Effect.sync(() => {
              received.push(generation);
              return { answer: "It uses the active thread context." };
            }),
        });

        const result = yield* coordinator.ask({
          threadId: defaultThreadId,
          question: "How does this work?",
          modelSelection: sideModelSelection,
          previousTurns: [{ question: "What did we inspect?", answer: "The reconnect flow." }],
        });

        assert.deepEqual(result, { answer: "It uses the active thread context." });
        assert.lengthOf(received, 1);
        const generation = received[0]!;
        assert.equal(generation.cwd, "/repo/.worktrees/side");
        assert.equal(generation.question, "How does this work?");
        assert.deepEqual(generation.modelSelection, sideModelSelection);
        assert.include(generation.context, "SIDE USER:\nWhat did we inspect?");
        assert.include(generation.context, "SIDE ASSISTANT:\nThe reconnect flow.");
        assert.include(generation.context, "grep -rn token");
        assert.notInclude(generation.context, "FULL_TOOL_OUTPUT");
        assert.notInclude(generation.context, "Undone by a checkpoint restore");
        assert.isBelow(
          generation.context.indexOf("Older context"),
          generation.context.indexOf("Current context"),
        );
        assert.notInclude(filters[0]?.turnItemTypes ?? [], "reasoning");
      }),
    ),
  );

  it.effect("answers long threads from the newest context that fits on the thread's model", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const received: Array<TextGeneration.SideQuestionGenerationInput> = [];
        const coordinator = yield* makeCoordinator({
          turnItems: [
            userMessage("oversized", 1, "a".repeat(SIDE_QUESTION_CONTEXT_MAX_BYTES)),
            userMessage("newest", 2, "Latest finding"),
          ],
          answer: (generation) =>
            Effect.sync(() => {
              received.push(generation);
              return { answer: "From the latest finding." };
            }),
        });

        const result = yield* coordinator.ask({
          threadId: defaultThreadId,
          question: "What did we find?",
        });

        assert.deepEqual(result, { answer: "From the latest finding." });
        const generation = received[0]!;
        assert.equal(generation.cwd, "/repo");
        assert.deepEqual(generation.modelSelection, defaultModelSelection);
        assert.include(generation.context, "[Earlier content truncated]");
        assert.include(generation.context, "USER:\nLatest finding");
        assert.notInclude(generation.context, "a".repeat(100));
      }),
    ),
  );

  it.effect("coalesces matching side questions without sharing different answers", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const singleFlight = yield* makeCoordinator();
        const input = {
          threadId: defaultThreadId,
          question: "Same question",
          context: "Same context",
          modelSelection: defaultModelSelection,
        };
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        let generationCount = 0;
        const generation = Effect.gen(function* () {
          generationCount += 1;
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);
          return { answer: "Shared answer" };
        });

        const first = yield* singleFlight
          .run({ ...input, requestId: "shared-1" }, generation)
          .pipe(Effect.forkChild);
        yield* Deferred.await(started);
        const second = yield* singleFlight
          .run({ ...input, requestId: "shared-2" }, generation)
          .pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        yield* Deferred.succeed(release, undefined);

        assert.deepEqual(yield* Fiber.join(first), { answer: "Shared answer" });
        assert.deepEqual(yield* Fiber.join(second), { answer: "Shared answer" });
        assert.equal(generationCount, 1);

        const firstDistinctStarted = yield* Deferred.make<void>();
        const secondDistinctStarted = yield* Deferred.make<void>();
        const releaseDistinct = yield* Deferred.make<void>();
        const firstDistinct = yield* singleFlight
          .run(
            { ...input, requestId: "distinct-1", question: "First question" },
            Deferred.succeed(firstDistinctStarted, undefined).pipe(
              Effect.andThen(Deferred.await(releaseDistinct)),
              Effect.as({ answer: "First answer" }),
            ),
          )
          .pipe(Effect.forkChild);
        const secondDistinct = yield* singleFlight
          .run(
            { ...input, requestId: "distinct-2", question: "Second question" },
            Deferred.succeed(secondDistinctStarted, undefined).pipe(
              Effect.andThen(Deferred.await(releaseDistinct)),
              Effect.as({ answer: "Second answer" }),
            ),
          )
          .pipe(Effect.forkChild);
        yield* Deferred.await(firstDistinctStarted);
        yield* Deferred.await(secondDistinctStarted);
        yield* Deferred.succeed(releaseDistinct, undefined);

        assert.deepEqual(yield* Fiber.join(firstDistinct), { answer: "First answer" });
        assert.deepEqual(yield* Fiber.join(secondDistinct), { answer: "Second answer" });
      }),
    ),
  );

  it.effect("does not share matching questions from different context snapshots", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const singleFlight = yield* makeCoordinator();
        const firstStarted = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const request = {
          threadId: defaultThreadId,
          question: "Same follow-up",
          modelSelection: defaultModelSelection,
        };
        const first = yield* singleFlight
          .run(
            { ...request, requestId: "context-1", context: "First context" },
            Deferred.succeed(firstStarted, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.as({ answer: "First history answer" }),
            ),
          )
          .pipe(Effect.forkChild);
        const second = yield* singleFlight
          .run(
            { ...request, requestId: "context-2", context: "Second context" },
            Deferred.await(release).pipe(Effect.as({ answer: "Second history answer" })),
          )
          .pipe(Effect.forkChild);

        yield* Deferred.await(firstStarted);
        yield* Effect.yieldNow;
        yield* Deferred.succeed(release, undefined);

        assert.deepEqual(yield* Fiber.join(first), { answer: "First history answer" });
        assert.deepEqual(yield* Fiber.join(second), { answer: "Second history answer" });
      }),
    ),
  );

  it.effect("rejects duplicate active side-question request IDs", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const singleFlight = yield* makeCoordinator();
        const started = yield* Deferred.make<void>();
        const interrupted = yield* Deferred.make<void>();
        const request = {
          threadId: defaultThreadId,
          requestId: "duplicate-id",
          question: "First question",
          context: "Current context",
          modelSelection: defaultModelSelection,
        };
        const first = yield* singleFlight
          .run(
            request,
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
            ),
          )
          .pipe(Effect.forkChild);
        yield* Deferred.await(started);

        let duplicateStarted = false;
        const duplicateExit = yield* singleFlight
          .run(
            { ...request, question: "Second question" },
            Effect.sync(() => {
              duplicateStarted = true;
              return { answer: "Duplicate answer" };
            }),
          )
          .pipe(Effect.exit);
        assert.isTrue(duplicateExit._tag === "Failure");
        assert.isFalse(duplicateStarted);

        yield* singleFlight.cancel(request);
        yield* Deferred.await(interrupted);
        assert.isTrue((yield* Fiber.await(first))._tag === "Failure");
      }),
    ),
  );

  it.effect("keeps shared side-question work alive after the first caller is canceled", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const singleFlight = yield* makeCoordinator();
        const input = {
          threadId: defaultThreadId,
          question: "Why SQLite?",
          context: "Same context",
          modelSelection: defaultModelSelection,
        };
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        let generationCount = 0;
        const generation = Effect.gen(function* () {
          generationCount += 1;
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);
          return { answer: "For local durability." };
        });

        const owner = yield* singleFlight
          .run({ ...input, requestId: "caller-1" }, generation)
          .pipe(Effect.forkChild);
        yield* Deferred.await(started);
        const follower = yield* singleFlight
          .run({ ...input, requestId: "caller-2" }, generation)
          .pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(owner);
        yield* Deferred.succeed(release, undefined);

        assert.deepEqual(yield* Fiber.join(follower), { answer: "For local durability." });
        assert.equal(generationCount, 1);

        assert.deepEqual(
          yield* singleFlight.run(
            { ...input, requestId: "caller-3" },
            Effect.sync(() => {
              generationCount += 1;
              return { answer: "Fresh answer" };
            }),
          ),
          { answer: "Fresh answer" },
        );
        assert.equal(generationCount, 2);
      }),
    ),
  );

  it.effect("cancels the provider after the last side-question caller stops", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const singleFlight = yield* makeCoordinator();
        const started = yield* Deferred.make<void>();
        const interrupted = yield* Deferred.make<void>();
        const request = {
          threadId: defaultThreadId,
          requestId: "stop-me",
          question: "Keep going?",
          context: "Current context",
          modelSelection: defaultModelSelection,
        };
        const generation = Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
        );

        const caller = yield* singleFlight.run(request, generation).pipe(Effect.forkChild);
        yield* Deferred.await(started);
        assert.isTrue(yield* singleFlight.cancel(request));
        yield* Deferred.await(interrupted);
        assert.isTrue((yield* Fiber.await(caller))._tag === "Failure");
      }),
    ),
  );

  it.effect("cancels the provider after the last side-question caller disconnects", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const singleFlight = yield* makeCoordinator();
        const started = yield* Deferred.make<void>();
        const interrupted = yield* Deferred.make<void>();
        const request = {
          threadId: defaultThreadId,
          requestId: "disconnect-me",
          question: "Keep going?",
          context: "Current context",
          modelSelection: defaultModelSelection,
        };
        const generation = Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
        );

        const caller = yield* singleFlight.run(request, generation).pipe(Effect.forkChild);
        yield* Deferred.await(started);
        yield* Fiber.interrupt(caller);
        yield* Deferred.await(interrupted);
      }),
    ),
  );

  it.effect("does not start a side-question provider after an early stop", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const singleFlight = yield* makeCoordinator();
        const request = {
          threadId: defaultThreadId,
          requestId: "stop-before-start",
          question: "Start later?",
          context: "Current context",
          modelSelection: defaultModelSelection,
        };
        let started = false;

        assert.isTrue(yield* singleFlight.cancel(request));
        const exit = yield* singleFlight
          .run(
            request,
            Effect.sync(() => {
              started = true;
              return { answer: "Too late" };
            }),
          )
          .pipe(Effect.exit);

        assert.isTrue(exit._tag === "Failure");
        assert.isFalse(started);
      }),
    ),
  );

  it.effect("bounds remembered early side-question stops", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const singleFlight = yield* makeCoordinator();
        const request = (requestId: string) => ({
          threadId: defaultThreadId,
          requestId,
          question: "Start later?",
          context: "Current context",
          modelSelection: defaultModelSelection,
        });

        for (let index = 0; index <= 1_024; index += 1) {
          yield* singleFlight.cancel(request(`bounded-${index}`));
        }

        assert.deepEqual(
          yield* singleFlight.run(
            request("bounded-0"),
            Effect.succeed({ answer: "Oldest stop expired" }),
          ),
          { answer: "Oldest stop expired" },
        );
        let newestStarted = false;
        const newestExit = yield* singleFlight
          .run(
            request("bounded-1024"),
            Effect.sync(() => {
              newestStarted = true;
              return { answer: "Too late" };
            }),
          )
          .pipe(Effect.exit);
        assert.isTrue(newestExit._tag === "Failure");
        assert.isFalse(newestStarted);
      }),
    ),
  );
});
