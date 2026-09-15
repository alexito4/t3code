/**
 * Appends text to a thread's scratchpad as a read-then-write pair: the wire
 * protocol only exposes thread.scratchpad.set (replaces the whole document),
 * not an append primitive, so "add this to my notes" reads the current
 * content first and writes it back with the new text tacked on.
 */
import { ORCHESTRATION_WS_METHODS, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { request } from "../rpc/client.ts";
import { setThreadScratchpad } from "../operations/commands.ts";

export const appendToThreadScratchpad = Effect.fn("clientRuntime.state.appendToThreadScratchpad")(
  function* (input: { readonly threadId: ThreadId; readonly text: string }) {
    const current = yield* request(ORCHESTRATION_WS_METHODS.getThreadScratchpad, {
      threadId: input.threadId,
    });
    const content =
      current.content.trim().length > 0 ? `${current.content}\n\n${input.text}` : input.text;
    yield* setThreadScratchpad({ threadId: input.threadId, content });
    return { content };
  },
);
