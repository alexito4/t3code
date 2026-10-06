import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

import {
  IsoDateTime,
  ThreadId,
  type ThreadScratchpad,
  type ThreadScratchpadSetInput,
} from "@t3tools/contracts";

import { PersistenceDecodeError, PersistenceSqlError } from "./Errors.ts";

export type ThreadScratchpadRepositoryError = PersistenceSqlError | PersistenceDecodeError;

const ThreadScratchpadRow = Schema.Struct({
  threadId: ThreadId,
  content: Schema.String,
  updatedAt: IsoDateTime,
});

const ThreadScratchpadLookup = Schema.Struct({ threadId: ThreadId });

/**
 * This fork's per-thread scratchpad notes, one row per thread replaced whole on every write.
 * Plain reads and writes rather than orchestration commands: the event store is shared with the
 * official app, whose closed decoder rejects event types it does not know.
 */
export class ThreadScratchpadRepository extends Context.Service<
  ThreadScratchpadRepository,
  {
    /** A thread that never had notes reads as empty content rather than an error. */
    readonly get: (
      threadId: ThreadId,
    ) => Effect.Effect<ThreadScratchpad, ThreadScratchpadRepositoryError>;
    readonly set: (
      input: ThreadScratchpadSetInput,
    ) => Effect.Effect<void, ThreadScratchpadRepositoryError>;
  }
>()("t3/persistence/ThreadScratchpads/ThreadScratchpadRepository") {}

function toSqlOrDecodeError(operation: string) {
  return (cause: unknown): ThreadScratchpadRepositoryError =>
    Schema.isSchemaError(cause)
      ? PersistenceDecodeError.fromSchemaError(operation, cause)
      : new PersistenceSqlError({ operation, cause });
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // This fork-only table is not a numbered migration on purpose. The migrator skips every ID at or
  // below the highest one recorded, and this database is shared with the official app, so a fork
  // migration ID would silently hide upstream's next migration with that number. The name predates
  // V2, when this was an orchestration projection; it stays so existing notes carry over.
  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_scratchpads (
      thread_id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `.pipe(Effect.orDie);

  const upsertRow = SqlSchema.void({
    Request: ThreadScratchpadRow,
    execute: (row) => sql`
      INSERT INTO projection_thread_scratchpads (thread_id, content, updated_at)
      VALUES (${row.threadId}, ${row.content}, ${row.updatedAt})
      ON CONFLICT (thread_id)
      DO UPDATE SET
        content = excluded.content,
        updated_at = excluded.updated_at
    `,
  });

  const findRow = SqlSchema.findOneOption({
    Request: ThreadScratchpadLookup,
    Result: ThreadScratchpadRow,
    execute: ({ threadId }) => sql`
      SELECT
        thread_id AS "threadId",
        content,
        updated_at AS "updatedAt"
      FROM projection_thread_scratchpads
      WHERE thread_id = ${threadId}
    `,
  });

  return ThreadScratchpadRepository.of({
    get: (threadId) =>
      findRow({ threadId }).pipe(
        Effect.map(
          Option.getOrElse((): ThreadScratchpad => ({ threadId, content: "", updatedAt: null })),
        ),
        Effect.mapError(toSqlOrDecodeError("getThreadScratchpad")),
      ),
    set: (input) =>
      DateTime.now.pipe(
        Effect.flatMap((now) =>
          upsertRow({
            threadId: input.threadId,
            content: input.content,
            updatedAt: DateTime.formatIso(now),
          }),
        ),
        Effect.mapError(toSqlOrDecodeError("setThreadScratchpad")),
      ),
  });
});

export const layer = Layer.effect(ThreadScratchpadRepository, make);
