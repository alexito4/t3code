import * as Schema from "effect/Schema";

import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";

/**
 * Side chat (`/btw`): stateless questions answered from a thread's context without writing to
 * the thread. Fork-owned (closed upstream PR #8296); servers advertise it with the
 * `sideQuestions` environment capability.
 */
export const SIDE_QUESTION_WS_METHODS = {
  askSideQuestion: "orchestration.askSideQuestion",
  cancelSideQuestion: "orchestration.cancelSideQuestion",
} as const;

export const OrchestrationSideQuestionTurn = Schema.Struct({
  question: TrimmedNonEmptyString.check(Schema.isMaxLength(20_000)),
  answer: Schema.String.check(Schema.isMaxLength(20_000)),
});
export type OrchestrationSideQuestionTurn = typeof OrchestrationSideQuestionTurn.Type;

export const ORCHESTRATION_SIDE_QUESTION_MAX_PREVIOUS_TURNS = 50;

export const OrchestrationAskSideQuestionInput = Schema.Struct({
  threadId: ThreadId,
  requestId: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(100))),
  question: TrimmedNonEmptyString.check(Schema.isMaxLength(20_000)),
  modelSelection: Schema.optional(ModelSelection),
  previousTurns: Schema.optional(
    Schema.Array(OrchestrationSideQuestionTurn).check(
      Schema.isMaxLength(ORCHESTRATION_SIDE_QUESTION_MAX_PREVIOUS_TURNS),
    ),
  ),
});
export type OrchestrationAskSideQuestionInput = typeof OrchestrationAskSideQuestionInput.Type;

export const OrchestrationAskSideQuestionResult = Schema.Struct({
  answer: Schema.String,
});
export type OrchestrationAskSideQuestionResult = typeof OrchestrationAskSideQuestionResult.Type;

export const OrchestrationCancelSideQuestionInput = Schema.Struct({
  threadId: ThreadId,
  requestId: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
});
export type OrchestrationCancelSideQuestionInput = typeof OrchestrationCancelSideQuestionInput.Type;

export const OrchestrationCancelSideQuestionResult = Schema.Struct({
  cancelled: Schema.Boolean,
});
export type OrchestrationCancelSideQuestionResult =
  typeof OrchestrationCancelSideQuestionResult.Type;
