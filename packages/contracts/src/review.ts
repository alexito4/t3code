import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { GitCommandError } from "./git.ts";
import { VcsError } from "./vcs.ts";

/** Git object ids are lowercase hex, sized by the repository's SHA-1 or SHA-256 object format. */
const GitObjectId = TrimmedNonEmptyString.check(
  Schema.isPattern(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
);

export const ReviewDiffPreviewInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  baseRef: Schema.optional(TrimmedNonEmptyString),
  /**
   * Fork: requests one commit's first-parent diff instead of the working tree and branch range.
   * A per-file request for a `commit` source sends it too. Servers without the `reviewCommits`
   * capability ignore it.
   */
  commitSha: Schema.optional(GitObjectId),
  /**
   * Fork: requests the branch commit listing on its own, skipping every patch this preview
   * builds. Ignored alongside `commitSha`, which already scopes the response to one commit.
   */
  commitsOnly: Schema.optionalKey(Schema.Boolean),
  ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
  /**
   * Fork: also return the Staged and Unstaged halves of Uncommitted. Opt-in so clients that
   * do not know those source kinds never receive them; servers without the
   * `reviewStagedAndUnstaged` capability ignore it.
   */
  includeStagedAndUnstaged: Schema.optionalKey(Schema.Boolean),
  file: Schema.optionalKey(
    Schema.Struct({
      path: Schema.NonEmptyString,
      previousPath: Schema.NullOr(Schema.NonEmptyString),
      sourceKind: Schema.Literals(["working-tree", "staged", "unstaged", "branch-range", "commit"]),
    }),
  ),
});
export type ReviewDiffPreviewInput = typeof ReviewDiffPreviewInput.Type;

export const ReviewDiffPreviewSourceKind = Schema.Literals([
  "working-tree",
  "staged",
  "unstaged",
  "branch-range",
  "commit",
]);
export type ReviewDiffPreviewSourceKind = typeof ReviewDiffPreviewSourceKind.Type;

export const ReviewBranchCommit = Schema.Struct({
  sha: GitObjectId,
  subject: Schema.String,
  committedAt: Schema.DateTimeUtc,
});
export type ReviewBranchCommit = typeof ReviewBranchCommit.Type;

export const ReviewDiffFileStat = Schema.Struct({
  path: Schema.String,
  previousPath: Schema.NullOr(Schema.String),
  additions: Schema.Number,
  deletions: Schema.Number,
});
export type ReviewDiffFileStat = typeof ReviewDiffFileStat.Type;

export const ReviewDiffPreviewSource = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: ReviewDiffPreviewSourceKind,
  title: TrimmedNonEmptyString,
  baseRef: Schema.NullOr(TrimmedNonEmptyString),
  headRef: Schema.NullOr(TrimmedNonEmptyString),
  diff: Schema.String,
  diffHash: TrimmedNonEmptyString,
  truncated: Schema.Boolean,
  /** Complete statistics, independent of patch limits. Absent on older servers. */
  files: Schema.optionalKey(Schema.Array(ReviewDiffFileStat)),
});
export type ReviewDiffPreviewSource = typeof ReviewDiffPreviewSource.Type;

export const ReviewDiffFileContentsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  sourceKind: ReviewDiffPreviewSourceKind,
  changeType: Schema.Literals(["change", "rename-pure", "rename-changed", "new", "deleted"]),
  baseRef: Schema.NullOr(TrimmedNonEmptyString),
  headRef: Schema.NullOr(TrimmedNonEmptyString),
  oldPath: TrimmedNonEmptyString,
  newPath: TrimmedNonEmptyString,
});
export type ReviewDiffFileContentsInput = typeof ReviewDiffFileContentsInput.Type;

export const ReviewDiffFileContentsResult = Schema.Struct({
  oldContents: Schema.String,
  newContents: Schema.String,
});
export type ReviewDiffFileContentsResult = typeof ReviewDiffFileContentsResult.Type;

export const ReviewDiffPreviewResult = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  generatedAt: Schema.DateTimeUtc,
  sources: Schema.Array(ReviewDiffPreviewSource),
  /**
   * Fork: the commits between the Changes base and HEAD, newest first and capped by the server.
   * Empty without a base and for single-commit or per-file previews. Absent from official
   * servers, so both keys decode to a default.
   */
  branchCommits: Schema.Array(ReviewBranchCommit).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  branchCommitsTruncated: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type ReviewDiffPreviewResult = typeof ReviewDiffPreviewResult.Type;

export const ReviewDiffPreviewError = Schema.Union([VcsError, GitCommandError]);
export type ReviewDiffPreviewError = typeof ReviewDiffPreviewError.Type;
