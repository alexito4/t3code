import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  selectThreadDiffPanelSelection,
  useDiffPanelSessionStore,
  useDiffPanelStore,
} from "./diffPanelStore";

const THREAD_REF = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-1"));
const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER_COMMIT_SHA = "89abcdef0123456789abcdef0123456789abcdef";

describe("diffPanelStore", () => {
  beforeEach(() => {
    useDiffPanelStore.setState({
      byThreadKey: {},
      branchBaseRefByThreadKey: {},
    });
    useDiffPanelSessionStore.setState({ collapsedFileKeysByScopeKey: {} });
  });

  it("retains fold choices when a panel consumer returns with fresh defaults", () => {
    const scopeKey = "environment-1:thread-1:branch";
    const defaults = new Set(["src/app.ts", "src/index.ts"]);
    useDiffPanelSessionStore.getState().updateCollapsedFileKeys(scopeKey, defaults, (current) => {
      const next = new Set(current);
      next.delete("src/app.ts");
      return next;
    });

    expect(useDiffPanelSessionStore.getState().collapsedFileKeysByScopeKey[scopeKey]).toEqual(
      new Set(["src/index.ts"]),
    );

    useDiffPanelSessionStore.getState().updateCollapsedFileKeys(scopeKey, new Set(), (current) => {
      const next = new Set(current);
      next.delete("src/index.ts");
      return next;
    });
    expect(useDiffPanelSessionStore.getState().collapsedFileKeysByScopeKey[scopeKey]).toEqual(
      new Set(),
    );

    useDiffPanelSessionStore
      .getState()
      .updateCollapsedFileKeys(scopeKey, defaults, (current) => current);
    expect(useDiffPanelSessionStore.getState().collapsedFileKeysByScopeKey[scopeKey]).toEqual(
      new Set(),
    );
    expect(defaults).toEqual(new Set(["src/app.ts", "src/index.ts"]));
  });

  it("keeps the branch base while visiting the Staged and Unstaged views", () => {
    const store = useDiffPanelStore.getState();
    store.selectBranchBaseRef(THREAD_REF, "origin/main");
    store.selectGitScope(THREAD_REF, "staged");
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "staged" });

    store.selectGitScope(THREAD_REF, "unstaged-only");
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "unstaged-only" });

    store.selectGitScope(THREAD_REF, "branch");
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: "origin/main" });
  });

  it("keeps the branch base while a commit is selected and after leaving it", () => {
    const store = useDiffPanelStore.getState();
    store.selectBranchBaseRef(THREAD_REF, "origin/main");
    store.selectCommit(THREAD_REF, COMMIT_SHA, "origin/main");
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "commit", commitSha: COMMIT_SHA, baseRef: "origin/main" });

    store.selectGitScope(THREAD_REF, "branch");
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: "origin/main" });
  });

  it("falls back to Changes when a selected commit leaves the branch range", () => {
    const store = useDiffPanelStore.getState();
    store.selectBranchBaseRef(THREAD_REF, "origin/main");
    store.selectCommit(THREAD_REF, COMMIT_SHA, "origin/main");
    store.reconcileCommitSelection(THREAD_REF, [OTHER_COMMIT_SHA], true);

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: "origin/main" });
  });

  it("keeps a commit selection that is still in the branch range", () => {
    const store = useDiffPanelStore.getState();
    store.selectCommit(THREAD_REF, COMMIT_SHA, null);
    store.reconcileCommitSelection(THREAD_REF, [OTHER_COMMIT_SHA, COMMIT_SHA], true);

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "commit", commitSha: COMMIT_SHA, baseRef: null });
  });

  it("keeps a commit selection when the listed commits are capped", () => {
    const store = useDiffPanelStore.getState();
    store.selectCommit(THREAD_REF, COMMIT_SHA, null);
    store.reconcileCommitSelection(THREAD_REF, [OTHER_COMMIT_SHA], false);

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "commit", commitSha: COMMIT_SHA, baseRef: null });
  });

  it("falls back to Changes when the branch range is completely empty", () => {
    const store = useDiffPanelStore.getState();
    store.selectCommit(THREAD_REF, COMMIT_SHA, null);
    store.reconcileCommitSelection(THREAD_REF, [], true);

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: null });
  });

  it("returns to the Changes base after a commit listed under another base leaves", () => {
    const store = useDiffPanelStore.getState();
    store.selectBranchBaseRef(THREAD_REF, "origin/release");
    store.selectGitScope(THREAD_REF, "unstaged");
    // Uncommitted lists commits against the automatic base.
    store.selectCommit(THREAD_REF, COMMIT_SHA, null);
    store.reconcileCommitSelection(THREAD_REF, [], true);

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: "origin/release" });
  });
});
