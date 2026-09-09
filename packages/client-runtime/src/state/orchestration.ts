import { ORCHESTRATION_WS_METHODS, type ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { HttpClient } from "effect/unstable/http";

import {
  createEnvironmentCommand,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";
import { exportThreadViaFallback } from "./threadExportFallback.ts";
import { ThreadSnapshotLoader } from "./threadSnapshotHttp.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export function createOrchestrationEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<
    EnvironmentRegistry | ThreadSnapshotLoader | HttpClient.HttpClient | R,
    E
  >,
) {
  return {
    turnDiff: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:turn-diff",
      tag: ORCHESTRATION_WS_METHODS.getTurnDiff,
    }),
    workflowScript: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:workflow-script",
      tag: ORCHESTRATION_WS_METHODS.getWorkflowScript,
      // Scripts are immutable per run: cache generously.
      staleTimeMs: 300_000,
      idleTtlMs: 300_000,
    }),
    fullThreadDiff: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:full-thread-diff",
      tag: ORCHESTRATION_WS_METHODS.getFullThreadDiff,
    }),
    exportThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:orchestration:export-thread",
      tag: ORCHESTRATION_WS_METHODS.exportThread,
    }),
    // Used when the environment's server predates orchestration.exportThread
    // (e.g. an official, unmodified server) — see threadExportFallback.ts.
    exportThreadFallback: createEnvironmentCommand(runtime, {
      label: "environment-data:orchestration:export-thread-fallback",
      execute: (input: { readonly threadId: ThreadId }) => exportThreadViaFallback(input),
    }),
    threadSearch: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:thread-search",
      tag: ORCHESTRATION_WS_METHODS.searchThreads,
      staleTimeMs: 30_000,
      idleTtlMs: 60_000,
    }),
    archivedShellSnapshot: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestration:archived-shell-snapshot",
      tag: ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot,
    }),
  };
}
