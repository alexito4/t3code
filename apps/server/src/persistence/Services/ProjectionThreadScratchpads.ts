import { IsoDateTime, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionThreadScratchpad = Schema.Struct({
  threadId: ThreadId,
  content: Schema.String,
  updatedAt: IsoDateTime,
});
export type ProjectionThreadScratchpad = typeof ProjectionThreadScratchpad.Type;

export const GetProjectionThreadScratchpadInput = Schema.Struct({
  threadId: ThreadId,
});
export type GetProjectionThreadScratchpadInput = typeof GetProjectionThreadScratchpadInput.Type;

export const DeleteProjectionThreadScratchpadInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteProjectionThreadScratchpadInput =
  typeof DeleteProjectionThreadScratchpadInput.Type;

export interface ProjectionThreadScratchpadRepositoryShape {
  readonly upsert: (
    row: ProjectionThreadScratchpad,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getByThreadId: (
    input: GetProjectionThreadScratchpadInput,
  ) => Effect.Effect<Option.Option<ProjectionThreadScratchpad>, ProjectionRepositoryError>;
  readonly deleteByThreadId: (
    input: DeleteProjectionThreadScratchpadInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionThreadScratchpadRepository extends Context.Service<
  ProjectionThreadScratchpadRepository,
  ProjectionThreadScratchpadRepositoryShape
>()("t3/persistence/Services/ProjectionThreadScratchpads/ProjectionThreadScratchpadRepository") {}
