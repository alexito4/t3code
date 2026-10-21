import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import { describe, expect } from "vite-plus/test";

import { ProviderInstanceId } from "@t3tools/contracts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import { createModelSelection } from "@t3tools/shared/model";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as TextGeneration from "./TextGeneration.ts";

const makeStubTextGeneration = (
  overrides: Partial<TextGeneration.TextGeneration["Service"]>,
): TextGeneration.TextGeneration["Service"] =>
  TextGeneration.TextGeneration.of({
    generateCommitMessage: () =>
      Effect.die("generateCommitMessage stub not configured for this test"),
    generatePrContent: () => Effect.die("generatePrContent stub not configured for this test"),
    generateBranchName: () => Effect.die("generateBranchName stub not configured for this test"),
    generateThreadTitle: () => Effect.die("generateThreadTitle stub not configured for this test"),
    answerSideQuestion: () => Effect.die("answerSideQuestion stub not configured for this test"),
    generateReviewGuide: () => Effect.die("generateReviewGuide stub not configured for this test"),
    ...overrides,
  });

const makeStubInstance = (
  instanceId: ProviderInstanceId,
  textGeneration: TextGeneration.TextGeneration["Service"],
): ProviderInstance =>
  ({
    instanceId,
    driverKind: instanceId as unknown as ProviderInstance["driverKind"],
    continuationIdentity: {
      driverKind: instanceId as unknown as ProviderInstance["driverKind"],
      continuationKey: `${instanceId}:test`,
    },
    displayName: undefined,
    enabled: true,
    snapshot: {} as ProviderInstance["snapshot"],
    orchestrationAdapter: {} as ProviderInstance["orchestrationAdapter"],
    textGeneration,
  }) satisfies ProviderInstance;

const makeStubRegistry = (
  instances: ReadonlyArray<ProviderInstance>,
): ProviderInstanceRegistry.ProviderInstanceRegistry["Service"] => {
  const byId = new Map(instances.map((instance) => [instance.instanceId, instance] as const));
  return {
    getInstance: (id) => Effect.succeed(byId.get(id)),
    listInstances: Effect.succeed(instances),
    listUnavailable: Effect.succeed([]),
    streamChanges: Stream.empty,
    subscribeChanges: Effect.flatMap(PubSub.unbounded<void>(), (pubsub) =>
      PubSub.subscribe(pubsub),
    ),
  };
};

describe("TextGeneration.make", () => {
  it.effect("routes a side question through the selected provider instance", () =>
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("cursor_work");
      const seenQuestions: string[] = [];
      const instance = makeStubInstance(
        instanceId,
        makeStubTextGeneration({
          answerSideQuestion: (input) => {
            seenQuestions.push(input.question);
            return Effect.succeed({ answer: "The reconnect token was stale." });
          },
        }),
      );
      const tg = yield* TextGeneration.make.pipe(
        Effect.provideService(
          ProviderInstanceRegistry.ProviderInstanceRegistry,
          makeStubRegistry([instance]),
        ),
        Effect.provide(
          Layer.mock(SourceControlProviderRegistry.SourceControlProviderRegistry)({
            resolveLink: () => Effect.die("answerSideQuestion must not fetch source control links"),
          }),
        ),
      );

      const result = yield* tg.answerSideQuestion({
        cwd: process.cwd(),
        question: "What failed?",
        context: "USER:\nInvestigate reconnects",
        modelSelection: createModelSelection(instanceId, "cursor-model"),
      });

      expect(result.answer).toBe("The reconnect token was stale.");
      expect(seenQuestions).toEqual(["What failed?"]);
    }),
  );
});
