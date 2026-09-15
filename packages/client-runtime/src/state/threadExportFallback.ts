/**
 * Client-only fallback for exporting a thread against a server that predates
 * `orchestration.exportThread` (the fast path in `apps/server`) — an official
 * upstream server, for instance. Everything this needs is an existing,
 * long-standing official API: the thread-snapshot HTTP endpoint (unwindowed
 * when no turn limit is given), the `getFullThreadDiff` RPC, and the
 * `assets.createUrl` RPC already used to render inline attachments. The
 * markdown assembly itself is shared with the server's fast path — see
 * `@t3tools/shared/threadExport`.
 */
import {
  ORCHESTRATION_WS_METHODS,
  WS_METHODS,
  type OrchestrationExportThreadResult,
  type ThreadId,
} from "@t3tools/contracts";
import { buildThreadExportMarkdown } from "@t3tools/shared/threadExport";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpClient } from "effect/unstable/http";

import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import { request } from "../rpc/client.ts";
import { ThreadSnapshotLoader } from "./threadSnapshotHttp.ts";

export class ThreadExportFallbackUnavailableError extends Schema.TaggedError<ThreadExportFallbackUnavailableError>()(
  "ThreadExportFallbackUnavailableError",
  {
    reason: Schema.Literals(["not-connected", "not-found"]),
    threadId: Schema.String,
  },
) {
  override get message(): string {
    return this.reason === "not-connected"
      ? "This environment is not currently connected."
      : `Thread '${this.threadId}' not found.`;
  }
}

/**
 * Reads a thread's full detail over HTTP (bypassing the client's normal
 * paginated scrollback so a long thread exports in full, not just its
 * recently-loaded turns), its full-thread diff, and its image attachments —
 * each fetched through an RPC any official server already answers.
 */
export const exportThreadViaFallback = Effect.fn("clientRuntime.state.exportThreadViaFallback")(
  function* (input: { readonly threadId: ThreadId }) {
    const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
    const preparedOption = yield* SubscriptionRef.get(supervisor.prepared);
    if (Option.isNone(preparedOption)) {
      return yield* new ThreadExportFallbackUnavailableError({
        reason: "not-connected",
        threadId: input.threadId,
      });
    }
    const prepared = preparedOption.value;

    const loader = yield* ThreadSnapshotLoader;
    const snapshotOption = yield* loader.load(prepared, input.threadId);
    if (Option.isNone(snapshotOption)) {
      return yield* new ThreadExportFallbackUnavailableError({
        reason: "not-found",
        threadId: input.threadId,
      });
    }
    const thread = snapshotOption.value.thread;

    const latestCheckpointTurnCount = thread.checkpoints.reduce(
      (max, checkpoint) => Math.max(max, checkpoint.checkpointTurnCount),
      0,
    );
    const diff =
      latestCheckpointTurnCount > 0
        ? (yield* request(ORCHESTRATION_WS_METHODS.getFullThreadDiff, {
            threadId: input.threadId,
            toTurnCount: latestCheckpointTurnCount,
          })).diff
        : "";

    const imageAttachments = thread.messages.flatMap((message) =>
      (message.attachments ?? []).filter((attachment) => attachment.type === "image"),
    );
    const imageDataUrlsByAttachmentId = new Map<string, string>();
    for (const attachment of imageAttachments) {
      if (imageDataUrlsByAttachmentId.has(attachment.id)) continue;
      // A signed URL or a missing/unreadable image skips inlining rather than
      // failing the whole export — the rest of the thread is still worth
      // sharing.
      const assetOption = yield* request(WS_METHODS.assetsCreateUrl, {
        resource: {
          _tag: "attachment",
          attachmentId: attachment.id,
          fileName: attachment.name,
          mimeType: attachment.mimeType,
        },
      }).pipe(Effect.option);
      if (Option.isNone(assetOption)) continue;
      const absoluteUrl = new URL(assetOption.value.relativeUrl, prepared.httpBaseUrl).href;
      const dataUrlOption = yield* HttpClient.get(absoluteUrl).pipe(
        Effect.flatMap((response) => response.arrayBuffer),
        Effect.map(
          (buffer) =>
            `data:${attachment.mimeType};base64,${Encoding.encodeBase64(new Uint8Array(buffer))}`,
        ),
        Effect.option,
      );
      if (Option.isNone(dataUrlOption)) continue;
      imageDataUrlsByAttachmentId.set(attachment.id, dataUrlOption.value);
    }

    return buildThreadExportMarkdown({
      thread,
      diff,
      exportedAt: DateTime.formatIso(yield* DateTime.now),
      imageDataUrlsByAttachmentId,
    }) satisfies OrchestrationExportThreadResult;
  },
);
