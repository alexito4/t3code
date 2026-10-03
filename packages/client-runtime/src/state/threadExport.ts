/**
 * "Export thread…": gathers everything `@t3tools/shared/threadExport` needs
 * through APIs an official server already answers — the full thread snapshot
 * over HTTP, `orchestration.getFullThreadDiff`, and signed attachment URLs —
 * so the export works against any environment, with no fork-only server code.
 */
import { ORCHESTRATION_V2_WS_METHODS, WS_METHODS, type ThreadId } from "@t3tools/contracts";
import {
  buildThreadExportMarkdown,
  latestFullThreadDiffTurnCount,
  threadExportImageAttachments,
} from "@t3tools/shared/threadExport";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpClient } from "effect/unstable/http";
import { Atom } from "effect/unstable/reactivity";

import * as RemoteEnvironmentAuthorization from "../authorization/service.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as ManagedRelay from "../relay/managedRelay.ts";
import { request } from "../rpc/client.ts";
import { resolveAssetUrl } from "./assets.ts";
import { createEnvironmentCommand } from "./runtime.ts";
import { fetchEnvironmentThreadSnapshot } from "./threadSnapshotHttp.ts";

// A long thread's full projection is far larger than a cold-open snapshot.
const THREAD_EXPORT_SNAPSHOT_TIMEOUT_MS = 60_000;

/** @public Required to name the error in consumers' inferred export results. */
export class ThreadExportConnectionNotReadyError extends Data.TaggedError(
  "ThreadExportConnectionNotReadyError",
)<{ readonly message: string }> {}

const exportThread = Effect.fn("clientRuntime.state.exportThread")(function* (input: {
  readonly threadId: ThreadId;
}) {
  const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
  const prepared = yield* SubscriptionRef.get(supervisor.prepared);
  if (Option.isNone(prepared)) {
    return yield* new ThreadExportConnectionNotReadyError({
      message: "This environment is not currently connected.",
    });
  }
  // The full, unwindowed projection: the WebSocket projection and the default
  // snapshot loader return only the recent window of a long thread.
  const { projection } = yield* fetchEnvironmentThreadSnapshot({
    prepared: prepared.value,
    threadId: input.threadId,
    signer: yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner),
    remoteAuthorization: yield* Effect.serviceOption(
      RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization,
    ),
    timeoutMs: THREAD_EXPORT_SNAPSHOT_TIMEOUT_MS,
  });

  // A missing diff only loses the "Code changes" section, so it never fails the export.
  const toTurnCount = latestFullThreadDiffTurnCount(projection);
  const diff =
    toTurnCount === 0
      ? null
      : yield* request(ORCHESTRATION_V2_WS_METHODS.getFullThreadDiff, {
          threadId: input.threadId,
          toTurnCount,
          // The server hides whitespace-only changes by default; an export keeps the exact
          // changes so a future re-import can apply the diff.
          ignoreWhitespace: false,
        }).pipe(
          Effect.map((result) => result.diff),
          Effect.catch((error) =>
            Effect.logWarning("Could not load the thread's code changes for export.", {
              threadId: input.threadId,
              error,
            }).pipe(Effect.as(null)),
          ),
        );

  const httpClient = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  const imageDataUrlsByAttachmentId = new Map<string, string>();
  for (const attachment of threadExportImageAttachments(projection)) {
    if (imageDataUrlsByAttachmentId.has(attachment.id)) continue;
    // A missing or unreadable image is noted instead of inlined rather than
    // failing the whole export — the rest of the thread is still worth sharing.
    const dataUrl = yield* Effect.gen(function* () {
      const asset = yield* request(WS_METHODS.assetsCreateUrl, {
        resource: {
          _tag: "attachment",
          attachmentId: attachment.id,
          fileName: attachment.name,
          mimeType: attachment.mimeType,
        },
      });
      const url = resolveAssetUrl(prepared.value.httpBaseUrl, asset.relativeUrl);
      if (url === null) return Option.none<string>();
      const response = yield* httpClient.get(url);
      const bytes = new Uint8Array(yield* response.arrayBuffer);
      return Option.some(`data:${attachment.mimeType};base64,${Encoding.encodeBase64(bytes)}`);
    }).pipe(Effect.orElseSucceed(Option.none<string>));
    if (Option.isSome(dataUrl)) imageDataUrlsByAttachmentId.set(attachment.id, dataUrl.value);
  }

  return buildThreadExportMarkdown({
    projection,
    diff,
    exportedAt: DateTime.formatIso(yield* DateTime.now),
    imageDataUrlsByAttachmentId,
  });
});

/** Web and desktop only: mobile has no export entry point. */
export function createThreadExportCommand<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | HttpClient.HttpClient | R, E>,
) {
  return createEnvironmentCommand(runtime, {
    label: "environment-data:orchestration:export-thread",
    execute: (input: { readonly threadId: ThreadId }) => exportThread(input),
  });
}
