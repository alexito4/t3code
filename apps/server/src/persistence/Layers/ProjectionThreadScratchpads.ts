import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionThreadScratchpadInput,
  GetProjectionThreadScratchpadInput,
  ProjectionThreadScratchpad,
  ProjectionThreadScratchpadRepository,
  type ProjectionThreadScratchpadRepositoryShape,
} from "../Services/ProjectionThreadScratchpads.ts";

const makeProjectionThreadScratchpadRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionThreadScratchpadRow = SqlSchema.void({
    Request: ProjectionThreadScratchpad,
    execute: (row) => sql`
      INSERT INTO projection_thread_scratchpads (thread_id, content, updated_at)
      VALUES (${row.threadId}, ${row.content}, ${row.updatedAt})
      ON CONFLICT (thread_id)
      DO UPDATE SET
        content = excluded.content,
        updated_at = excluded.updated_at
    `,
  });

  const getProjectionThreadScratchpadRow = SqlSchema.findOneOption({
    Request: GetProjectionThreadScratchpadInput,
    Result: ProjectionThreadScratchpad,
    execute: ({ threadId }) => sql`
      SELECT
        thread_id AS "threadId",
        content,
        updated_at AS "updatedAt"
      FROM projection_thread_scratchpads
      WHERE thread_id = ${threadId}
    `,
  });

  const deleteProjectionThreadScratchpadRow = SqlSchema.void({
    Request: DeleteProjectionThreadScratchpadInput,
    execute: ({ threadId }) => sql`
      DELETE FROM projection_thread_scratchpads
      WHERE thread_id = ${threadId}
    `,
  });

  const upsert: ProjectionThreadScratchpadRepositoryShape["upsert"] = (row) =>
    upsertProjectionThreadScratchpadRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadScratchpadRepository.upsert:query")),
    );

  const getByThreadId: ProjectionThreadScratchpadRepositoryShape["getByThreadId"] = (input) =>
    getProjectionThreadScratchpadRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadScratchpadRepository.getByThreadId:query"),
      ),
    );

  const deleteByThreadId: ProjectionThreadScratchpadRepositoryShape["deleteByThreadId"] = (input) =>
    deleteProjectionThreadScratchpadRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadScratchpadRepository.deleteByThreadId:query"),
      ),
    );

  return {
    upsert,
    getByThreadId,
    deleteByThreadId,
  } satisfies ProjectionThreadScratchpadRepositoryShape;
});

export const ProjectionThreadScratchpadRepositoryLive = Layer.effect(
  ProjectionThreadScratchpadRepository,
  makeProjectionThreadScratchpadRepository,
);
