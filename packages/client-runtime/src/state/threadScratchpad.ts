/**
 * This fork's per-thread scratchpad: fetched on demand and replaced whole through plain RPCs,
 * outside orchestration. Only servers advertising the `scratchpad` capability serve them.
 */
import { type EnvironmentId, type ThreadId, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { request } from "../rpc/client.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentCommand,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

export function createThreadScratchpadAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  // Saves and appends share one lane per thread: an append reads and then rewrites the whole
  // document, so it must not interleave with the editor's own debounced saves.
  const scheduler = createAtomCommandScheduler();
  const concurrency = {
    mode: "serial" as const,
    key: (target: {
      readonly environmentId: EnvironmentId;
      readonly input: { threadId: ThreadId };
    }) => JSON.stringify([target.environmentId, target.input.threadId]),
  };
  return {
    threadScratchpad: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:thread-scratchpad",
      tag: WS_METHODS.threadScratchpadGet,
      // No staleTime/idleTtl: this client is also the writer while the panel
      // is open, so the cache must never outlive its own local edits.
    }),
    setThreadScratchpad: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:thread-scratchpad:set",
      tag: WS_METHODS.threadScratchpadSet,
      scheduler,
      concurrency,
    }),
    /**
     * Appends text as a read-then-write pair: the wire only replaces the whole document, so "add
     * this to my notes" reads the current content first and writes it back with the text added.
     */
    appendThreadScratchpad: createEnvironmentCommand(runtime, {
      label: "environment-data:thread-scratchpad:append",
      execute: (input: { readonly threadId: ThreadId; readonly text: string }) =>
        Effect.gen(function* () {
          const current = yield* request(WS_METHODS.threadScratchpadGet, {
            threadId: input.threadId,
          });
          const content =
            current.content.trim().length > 0 ? `${current.content}\n\n${input.text}` : input.text;
          yield* request(WS_METHODS.threadScratchpadSet, { threadId: input.threadId, content });
          return { content };
        }),
      scheduler,
      concurrency,
    }),
  };
}
