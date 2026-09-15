import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { ProjectionThreadScratchpadRepository } from "../persistence/Services/ProjectionThreadScratchpads.ts";

export const getThreadScratchpad = Effect.fn("orchestration.getThreadScratchpad")(
  function* (input: { readonly threadId: ThreadId }) {
    const repository = yield* ProjectionThreadScratchpadRepository;
    const row = yield* repository.getByThreadId({ threadId: input.threadId }).pipe(Effect.orDie);
    return Option.match(row, {
      onNone: () => ({ threadId: input.threadId, content: "", updatedAt: null }),
      onSome: (found) => ({
        threadId: found.threadId,
        content: found.content,
        updatedAt: found.updatedAt,
      }),
    });
  },
);
