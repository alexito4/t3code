import * as Schema from "effect/Schema";

import { IsoDateTime, ThreadId } from "./baseSchemas.ts";

/**
 * A thread's freeform personal notes, not part of the conversation the agent sees. This fork
 * keeps them out of orchestration entirely: plain get/set RPCs over their own table, gated by the
 * `scratchpad` environment capability.
 */
export const THREAD_SCRATCHPAD_MAX_CHARS = 200_000;

export const ThreadScratchpadGetInput = Schema.Struct({
  threadId: ThreadId,
});
export type ThreadScratchpadGetInput = typeof ThreadScratchpadGetInput.Type;

export const ThreadScratchpad = Schema.Struct({
  threadId: ThreadId,
  // "" for a thread that has never had one -- not an error, and not Option/
  // nullable, since an absent scratchpad and an emptied one render identically.
  content: Schema.String,
  updatedAt: Schema.NullOr(IsoDateTime),
});
export type ThreadScratchpad = typeof ThreadScratchpad.Type;

/** Replaces the whole document; clearing it is a plain empty-string set. */
export const ThreadScratchpadSetInput = Schema.Struct({
  threadId: ThreadId,
  content: Schema.String.check(Schema.isMaxLength(THREAD_SCRATCHPAD_MAX_CHARS)),
});
export type ThreadScratchpadSetInput = typeof ThreadScratchpadSetInput.Type;

export class ThreadScratchpadError extends Schema.TaggedError<ThreadScratchpadError>()(
  "ThreadScratchpadError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
