import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";

function makeReadModel(
  input: { readonly archivedAt?: string | null } = {},
): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      {
        id: ThreadId.make("thread-1"),
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        pullRequests: [],
        latestTurn: null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: input.archivedAt ?? null,
        settledOverride: null,
        settledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        pinnedAt: null,
        pinOrderKey: null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
    ],
    updatedAt: NOW,
  };
}

it.layer(NodeServices.layer)("scratchpad thread decider", (it) => {
  it.effect("sets a thread's scratchpad content", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.scratchpad.set",
          commandId: CommandId.make("cmd-scratchpad"),
          threadId: ThreadId.make("thread-1"),
          content: "notes about this thread",
        },
        readModel: makeReadModel(),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("thread.scratchpad-set");
      if (events[0]?.type === "thread.scratchpad-set") {
        expect(events[0].payload.threadId).toBe("thread-1");
        expect(events[0].payload.content).toBe("notes about this thread");
        // A genuine write stamps the command's own clock time, not the
        // thread's previous updatedAt from the read-model fixture.
        expect(events[0].payload.updatedAt).not.toBe(NOW);
      }
    }),
  );

  it.effect("clearing the scratchpad is a plain empty-string set", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.scratchpad.set",
          commandId: CommandId.make("cmd-scratchpad-clear"),
          threadId: ThreadId.make("thread-1"),
          content: "",
        },
        readModel: makeReadModel(),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events[0]?.type).toBe("thread.scratchpad-set");
      if (events[0]?.type === "thread.scratchpad-set") {
        expect(events[0].payload.content).toBe("");
      }
    }),
  );

  it.effect("succeeds on an archived thread -- notes are not conversation state", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.scratchpad.set",
          commandId: CommandId.make("cmd-scratchpad-archived"),
          threadId: ThreadId.make("thread-1"),
          content: "still editable",
        },
        readModel: makeReadModel({ archivedAt: NOW }),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events[0]?.type).toBe("thread.scratchpad-set");
    }),
  );

  it.effect("rejects setting the scratchpad of a nonexistent thread", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "thread.scratchpad.set",
          commandId: CommandId.make("cmd-scratchpad-missing"),
          threadId: ThreadId.make("thread-missing"),
          content: "notes",
        },
        readModel: makeReadModel(),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );
});
