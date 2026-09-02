import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef, TurnId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

export type DiffPanelGitScope = "uncommitted" | "unstaged" | "staged" | "branch";

export type DiffPanelSelection =
  | { kind: "branch"; baseRef: string | null }
  | { kind: "uncommitted" }
  | { kind: "unstaged" }
  | { kind: "staged" }
  | { kind: "turn"; turnId: TurnId; filePath: string | null; revealRequestId: number };

export type DiffRenderMode = "stacked" | "split";

/** A pending "scroll this file into view" request for a thread's diff panel. */
export interface DiffPanelFileReveal {
  filePath: string;
  revealRequestId: number;
}

const DEFAULT_SELECTION: DiffPanelSelection = { kind: "branch", baseRef: null };
const DEFAULT_WORKING_TREE_SELECTION: DiffPanelSelection = { kind: "uncommitted" };

interface DiffPanelStoreState {
  byThreadKey: Record<string, DiffPanelSelection>;
  branchBaseRefByThreadKey: Record<string, string | null>;
  /**
   * File-reveal requests for scopes other than `turn`. The `turn` variant
   * carries its own `filePath`/`revealRequestId` (set alongside the turn
   * itself by `selectTurn`), since opening a turn's diff and revealing one of
   * its files is one atomic action from the caller's perspective. Every other
   * scope selects a file after the scope is already active (e.g. clicking a
   * row in the file-tree sidebar), so it's tracked independently here instead
   * of being duplicated onto each scope's selection variant.
   */
  fileRevealByThreadKey: Record<string, DiffPanelFileReveal | undefined>;
  diffRenderMode: DiffRenderMode;
  fileTreeVisible: boolean;
  setDiffRenderMode: (mode: DiffRenderMode) => void;
  setFileTreeVisible: (visible: boolean) => void;
  selectGitScope: (ref: ScopedThreadRef, scope: DiffPanelGitScope) => void;
  selectBranchBaseRef: (ref: ScopedThreadRef, baseRef: string | null) => void;
  selectTurn: (ref: ScopedThreadRef, turnId: TurnId, filePath?: string) => void;
  reconcileTurnSelection: (ref: ScopedThreadRef, availableTurnIds: ReadonlyArray<TurnId>) => void;
  /** Reveal (scroll to) a file in the diff currently showing for `ref`, whatever its scope. */
  revealFile: (ref: ScopedThreadRef, filePath: string) => void;
  removeThread: (ref: ScopedThreadRef) => void;
}

function normalizeBaseRef(baseRef: string | null): string | null {
  const normalized = baseRef?.trim();
  return normalized ? normalized : null;
}

export const useDiffPanelStore = create<DiffPanelStoreState>()(
  persist(
    (set) => ({
      byThreadKey: {},
      branchBaseRefByThreadKey: {},
      fileRevealByThreadKey: {},
      diffRenderMode: "stacked",
      fileTreeVisible: true,
      setDiffRenderMode: (diffRenderMode) => set({ diffRenderMode }),
      setFileTreeVisible: (fileTreeVisible) => set({ fileTreeVisible }),
      selectGitScope: (ref, scope) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const previous = state.byThreadKey[threadKey];
          const previousBaseRef =
            previous?.kind === "branch"
              ? previous.baseRef
              : (state.branchBaseRefByThreadKey[threadKey] ?? null);
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]:
                scope === "branch" ? { kind: "branch", baseRef: previousBaseRef } : { kind: scope },
            },
            branchBaseRefByThreadKey:
              previous?.kind === "branch"
                ? { ...state.branchBaseRefByThreadKey, [threadKey]: previous.baseRef }
                : state.branchBaseRefByThreadKey,
          };
        }),
      selectBranchBaseRef: (ref, baseRef) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const normalizedBaseRef = normalizeBaseRef(baseRef);
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: { kind: "branch", baseRef: normalizedBaseRef },
            },
            branchBaseRefByThreadKey: {
              ...state.branchBaseRefByThreadKey,
              [threadKey]: normalizedBaseRef,
            },
          };
        }),
      selectTurn: (ref, turnId, filePath) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const previous = state.byThreadKey[threadKey];
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: {
                kind: "turn",
                turnId,
                filePath: filePath?.trim() || null,
                revealRequestId: previous?.kind === "turn" ? previous.revealRequestId + 1 : 1,
              },
            },
          };
        }),
      reconcileTurnSelection: (ref, availableTurnIds) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const previous = state.byThreadKey[threadKey];
          const latestTurnId = availableTurnIds[0];
          if (
            previous?.kind !== "turn" ||
            latestTurnId === undefined ||
            availableTurnIds.includes(previous.turnId)
          ) {
            return state;
          }
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: { ...previous, turnId: latestTurnId },
            },
          };
        }),
      revealFile: (ref, filePath) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const trimmedFilePath = filePath.trim();
          if (!trimmedFilePath) return state;
          const previous = state.byThreadKey[threadKey];
          if (previous?.kind === "turn") {
            return {
              byThreadKey: {
                ...state.byThreadKey,
                [threadKey]: {
                  ...previous,
                  filePath: trimmedFilePath,
                  revealRequestId: previous.revealRequestId + 1,
                },
              },
            };
          }
          const previousReveal = state.fileRevealByThreadKey[threadKey];
          return {
            fileRevealByThreadKey: {
              ...state.fileRevealByThreadKey,
              [threadKey]: {
                filePath: trimmedFilePath,
                revealRequestId: (previousReveal?.revealRequestId ?? 0) + 1,
              },
            },
          };
        }),
      removeThread: (ref) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          if (
            !(threadKey in state.byThreadKey) &&
            !(threadKey in state.branchBaseRefByThreadKey) &&
            !(threadKey in state.fileRevealByThreadKey)
          ) {
            return state;
          }
          const { [threadKey]: _removed, ...byThreadKey } = state.byThreadKey;
          const { [threadKey]: _removedBaseRef, ...branchBaseRefByThreadKey } =
            state.branchBaseRefByThreadKey;
          const { [threadKey]: _removedReveal, ...fileRevealByThreadKey } =
            state.fileRevealByThreadKey;
          return { byThreadKey, branchBaseRefByThreadKey, fileRevealByThreadKey };
        }),
    }),
    {
      name: "t3code:diff-panel-state:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        byThreadKey: state.byThreadKey,
        branchBaseRefByThreadKey: state.branchBaseRefByThreadKey,
        diffRenderMode: state.diffRenderMode,
        fileTreeVisible: state.fileTreeVisible,
      }),
    },
  ),
);

export function selectThreadDiffPanelSelection(
  byThreadKey: Record<string, DiffPanelSelection>,
  ref: ScopedThreadRef | null | undefined,
  hasWorkingTreeChanges = false,
): DiffPanelSelection {
  if (!ref) return DEFAULT_SELECTION;
  return (
    byThreadKey[scopedThreadKey(ref)] ??
    (hasWorkingTreeChanges ? DEFAULT_WORKING_TREE_SELECTION : DEFAULT_SELECTION)
  );
}

/**
 * The pending file-reveal request for a non-`turn` scope. `turn` selections
 * carry their own `filePath`/`revealRequestId` (see `DiffPanelFileReveal`'s
 * doc comment) and are read directly off the `DiffPanelSelection`.
 */
export function selectThreadFileReveal(
  fileRevealByThreadKey: Record<string, DiffPanelFileReveal | undefined>,
  ref: ScopedThreadRef | null | undefined,
): DiffPanelFileReveal | null {
  if (!ref) return null;
  return fileRevealByThreadKey[scopedThreadKey(ref)] ?? null;
}
