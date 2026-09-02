import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, TurnId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  selectThreadDiffPanelSelection,
  selectThreadFileReveal,
  useDiffPanelStore,
} from "./diffPanelStore";

const THREAD_REF = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-1"));

describe("diffPanelStore", () => {
  beforeEach(() =>
    useDiffPanelStore.setState({
      byThreadKey: {},
      branchBaseRefByThreadKey: {},
      fileRevealByThreadKey: {},
      diffRenderMode: "stacked",
      fileTreeVisible: true,
    }),
  );

  it("keeps the selected render mode in panel and persisted state", async () => {
    useDiffPanelStore.getState().setDiffRenderMode("split");

    expect(useDiffPanelStore.getState().diffRenderMode).toBe("split");
    expect(
      useDiffPanelStore.persist.getOptions().partialize?.(useDiffPanelStore.getState()),
    ).toMatchObject({ diffRenderMode: "split" });

    const { name, storage } = useDiffPanelStore.persist.getOptions();
    if (!name) throw new Error("Expected diff panel persistence to have a storage name");
    const persisted = await storage?.getItem(name);
    expect(persisted?.state).toMatchObject({ diffRenderMode: "split" });

    useDiffPanelStore.setState({ diffRenderMode: "stacked" });
    if (persisted) await storage?.setItem(name, persisted);
    await useDiffPanelStore.persist.rehydrate();

    expect(useDiffPanelStore.getState().diffRenderMode).toBe("split");
  });

  it("defaults each thread to branch changes when the working tree is clean", () => {
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: null });
  });

  it("defaults each thread to working changes when the working tree is dirty", () => {
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF, true),
    ).toEqual({ kind: "uncommitted" });
  });

  it("preserves an explicit scope selection when the working tree state changes", () => {
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "branch");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF, true),
    ).toEqual({ kind: "branch", baseRef: null });
  });

  it("clears incompatible selection fields when changing scopes", () => {
    const store = useDiffPanelStore.getState();
    store.selectTurn(THREAD_REF, TurnId.make("turn-1"), "src/app.ts");
    store.selectGitScope(THREAD_REF, "uncommitted");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "uncommitted" });

    useDiffPanelStore.getState().selectBranchBaseRef(THREAD_REF, " origin/main ");
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: "origin/main" });
  });

  it("selects the unstaged scope", () => {
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "unstaged");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "unstaged" });
  });

  it("selects the staged scope", () => {
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "staged");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "staged" });
  });

  it("increments the reveal request when opening the same turn file again", () => {
    const turnId = TurnId.make("turn-1");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, turnId, "src/app.ts");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, turnId, "src/app.ts");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "turn", turnId, filePath: "src/app.ts", revealRequestId: 2 });
  });

  it("restores the selected branch base after visiting another scope", () => {
    useDiffPanelStore.getState().selectBranchBaseRef(THREAD_REF, "origin/main");
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "uncommitted");
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "branch");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: "origin/main" });
  });

  it("reconciles a missing turn selection to the latest available turn", () => {
    const missingTurnId = TurnId.make("turn-missing");
    const latestTurnId = TurnId.make("turn-latest");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, missingTurnId, "src/app.ts");
    useDiffPanelStore.getState().reconcileTurnSelection(THREAD_REF, [latestTurnId]);

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({
      kind: "turn",
      turnId: latestTurnId,
      filePath: "src/app.ts",
      revealRequestId: 1,
    });
  });

  it("keeps the file-tree visibility in panel and persisted state", async () => {
    useDiffPanelStore.getState().setFileTreeVisible(false);

    expect(useDiffPanelStore.getState().fileTreeVisible).toBe(false);
    expect(
      useDiffPanelStore.persist.getOptions().partialize?.(useDiffPanelStore.getState()),
    ).toMatchObject({ fileTreeVisible: false });

    const { name, storage } = useDiffPanelStore.persist.getOptions();
    if (!name) throw new Error("Expected diff panel persistence to have a storage name");
    const persisted = await storage?.getItem(name);
    expect(persisted?.state).toMatchObject({ fileTreeVisible: false });

    useDiffPanelStore.setState({ fileTreeVisible: true });
    if (persisted) await storage?.setItem(name, persisted);
    await useDiffPanelStore.persist.rehydrate();

    expect(useDiffPanelStore.getState().fileTreeVisible).toBe(false);
  });

  it("reveals a file for a non-turn scope without disturbing the scope selection", () => {
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "uncommitted");
    useDiffPanelStore.getState().revealFile(THREAD_REF, "src/app.ts");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "uncommitted" });
    expect(
      selectThreadFileReveal(useDiffPanelStore.getState().fileRevealByThreadKey, THREAD_REF),
    ).toEqual({ filePath: "src/app.ts", revealRequestId: 1 });
  });

  it("increments the reveal request when revealing the same file again in a non-turn scope", () => {
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "branch");
    useDiffPanelStore.getState().revealFile(THREAD_REF, "src/app.ts");
    useDiffPanelStore.getState().revealFile(THREAD_REF, "src/other.ts");

    expect(
      selectThreadFileReveal(useDiffPanelStore.getState().fileRevealByThreadKey, THREAD_REF),
    ).toEqual({ filePath: "src/other.ts", revealRequestId: 2 });
  });

  it("reveals a file for the turn scope through the turn selection itself", () => {
    const turnId = TurnId.make("turn-1");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, turnId);
    useDiffPanelStore.getState().revealFile(THREAD_REF, "src/app.ts");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "turn", turnId, filePath: "src/app.ts", revealRequestId: 2 });
    expect(
      selectThreadFileReveal(useDiffPanelStore.getState().fileRevealByThreadKey, THREAD_REF),
    ).toBeNull();
  });

  it("clears a thread's file reveal when the thread is removed", () => {
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "staged");
    useDiffPanelStore.getState().revealFile(THREAD_REF, "src/app.ts");
    useDiffPanelStore.getState().removeThread(THREAD_REF);

    expect(
      selectThreadFileReveal(useDiffPanelStore.getState().fileRevealByThreadKey, THREAD_REF),
    ).toBeNull();
  });
});
