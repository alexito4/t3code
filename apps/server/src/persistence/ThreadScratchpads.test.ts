import { assert, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "./Sqlite.ts";
import * as ThreadScratchpads from "./ThreadScratchpads.ts";

const readScratchpad = (threadId: ThreadId) =>
  ThreadScratchpads.ThreadScratchpadRepository.use((scratchpads) => scratchpads.get(threadId));

it.effect("reads an untouched thread as empty, then stores and replaces its notes", () =>
  Effect.gen(function* () {
    const scratchpads = yield* ThreadScratchpads.ThreadScratchpadRepository;
    const threadId = ThreadId.make("thread-scratchpad");

    assert.deepStrictEqual(yield* readScratchpad(threadId), {
      threadId,
      content: "",
      updatedAt: null,
    });

    yield* scratchpads.set({ threadId, content: "first draft of notes" });
    assert.deepStrictEqual(yield* readScratchpad(threadId), {
      threadId,
      content: "first draft of notes",
      updatedAt: "1970-01-01T00:00:00.000Z",
    });

    // A second write replaces the one row in place, stamped with the write's own time.
    yield* TestClock.adjust("1 second");
    yield* scratchpads.set({ threadId, content: "revised notes" });
    assert.deepStrictEqual(yield* readScratchpad(threadId), {
      threadId,
      content: "revised notes",
      updatedAt: "1970-01-01T00:00:01.000Z",
    });

    const otherThreadId = ThreadId.make("thread-other");
    assert.deepStrictEqual(yield* readScratchpad(otherThreadId), {
      threadId: otherThreadId,
      content: "",
      updatedAt: null,
    });
  }).pipe(
    Effect.provide(ThreadScratchpads.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory))),
  ),
);

it.effect("keeps notes already stored in the table from before V2", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE projection_thread_scratchpads (
        thread_id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `;
    yield* sql`
      INSERT INTO projection_thread_scratchpads (thread_id, content, updated_at)
      VALUES ('thread-v1', 'notes from V1', '2026-03-24T00:00:01.000Z')
    `;

    const threadId = ThreadId.make("thread-v1");
    assert.deepStrictEqual(
      yield* readScratchpad(threadId).pipe(Effect.provide(ThreadScratchpads.layer)),
      { threadId, content: "notes from V1", updatedAt: "2026-03-24T00:00:01.000Z" },
    );
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);
