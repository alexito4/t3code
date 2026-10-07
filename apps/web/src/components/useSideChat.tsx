import type {
  AssistantCitation,
  EnvironmentId,
  ModelSelection,
  ScopedThreadRef,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import {
  sideQuestionCancellationSucceeded,
  sideQuestionPreviousTurns,
} from "@t3tools/client-runtime/state/orchestration";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  canAskComposerSideQuestion,
  formatAssistantCitationForComposer,
  parseComposerSideQuestion,
} from "../composer-logic";
import { type ComposerThreadTarget, useComposerDraftStore } from "../composerDraftStore";
import { randomUUID } from "../lib/utils";
import { type RightPanelSurface, useRightPanelStore } from "../rightPanelStore";
import { orchestrationEnvironment } from "../state/orchestration";
import { useAtomCommand } from "../state/use-atom-command";
import type { ChatComposerHandle } from "./chat/ChatComposer";
import {
  SideQuestionMinimized,
  SideQuestionPanel,
  type SideQuestionTurn,
} from "./SideQuestionPanel";
import { stackedThreadToast, toastManager } from "./ui/toast";

type SideQuestionState = {
  readonly mode: "panel" | "minimized" | "hidden";
  readonly turns: ReadonlyArray<SideQuestionTurn>;
  readonly modelSelection: ModelSelection;
  /** Text queued for the side chat's draft, e.g. from "Ask in side chat" on a selection. */
  readonly draftSeed?: { readonly text: string; readonly nonce: number } | undefined;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An error occurred.";
}

/**
 * Side chat (`/btw`): view-local questions answered from the thread's context without writing
 * to it. Owns the per-thread conversations and renders the right-panel surface and the
 * minimized composer attachment, so ChatView only wires the entry points.
 */
export function useSideChat(input: {
  readonly environmentId: EnvironmentId;
  readonly threadKey: string;
  readonly threadRef: ScopedThreadRef | null;
  readonly thread:
    | { readonly id: ThreadId; readonly modelSelection: ModelSelection }
    | null
    | undefined;
  /** The environment advertises the `sideQuestions` capability. */
  readonly supported: boolean;
  readonly isServerThread: boolean;
  readonly hasPendingUserInput: boolean;
  readonly surfaces: ReadonlyArray<RightPanelSurface>;
  readonly cwd: string | undefined;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly settings: UnifiedSettings;
  readonly composerDraftTarget: ComposerThreadTarget;
}) {
  const { environmentId, threadKey, threadRef, thread, composerDraftTarget } = input;
  const askSideQuestion = useAtomCommand(orchestrationEnvironment.askSideQuestion, {
    reportFailure: false,
  });
  const cancelSideQuestion = useAtomCommand(orchestrationEnvironment.cancelSideQuestion, {
    reportFailure: false,
  });
  const [sideQuestionsByThread, setSideQuestionsByThread] = useState<
    Record<string, SideQuestionState>
  >({});
  const state = sideQuestionsByThread[threadKey] ?? null;
  const requestRef = useRef<Record<string, string>>({});
  const available =
    threadRef !== null &&
    canAskComposerSideQuestion({
      sideQuestionsSupported: input.supported,
      isServerThread: input.isServerThread,
      hasPendingUserInput: input.hasPendingUserInput,
    });

  const updateState = useCallback(
    (update: (state: SideQuestionState) => SideQuestionState) =>
      setSideQuestionsByThread((current) => {
        const existing = current[threadKey];
        return existing ? { ...current, [threadKey]: update(existing) } : current;
      }),
    [threadKey],
  );
  const setMode = useCallback(
    (mode: SideQuestionState["mode"]) => updateState((existing) => ({ ...existing, mode })),
    [updateState],
  );
  const openPanel = useCallback(() => {
    if (threadRef) useRightPanelStore.getState().open(threadRef, "side-question");
  }, [threadRef]);

  // A restored panel layout can name a side chat this view no longer holds.
  useEffect(() => {
    if (!threadRef || state) return;
    if (input.surfaces.some((surface) => surface.kind === "side-question")) {
      useRightPanelStore.getState().closeSurface(threadRef, "side-question");
    }
  }, [input.surfaces, state, threadRef]);

  const addSurface = useCallback(() => {
    if (!thread || !available) return;
    if (state) {
      setMode("panel");
    } else {
      setSideQuestionsByThread((current) => ({
        ...current,
        [threadKey]: { mode: "panel", modelSelection: thread.modelSelection, turns: [] },
      }));
    }
    openPanel();
  }, [available, openPanel, setMode, state, thread, threadKey]);

  const askSelection = useCallback(
    (citation: AssistantCitation) => {
      if (!thread || !available) return false;
      const text = formatAssistantCitationForComposer(citation, citation.comment).trim();
      setSideQuestionsByThread((current) => {
        const existing = current[threadKey];
        const draftSeed = { text, nonce: (existing?.draftSeed?.nonce ?? 0) + 1 };
        return {
          ...current,
          [threadKey]: existing
            ? { ...existing, mode: "panel", draftSeed }
            : { mode: "panel", modelSelection: thread.modelSelection, turns: [], draftSeed },
        };
      });
      openPanel();
      return true;
    },
    [available, openPanel, thread, threadKey],
  );

  const onSurfacesClosed = useCallback(
    (surfaces: readonly RightPanelSurface[]) => {
      if (surfaces.some((surface) => surface.kind === "side-question")) setMode("hidden");
    },
    [setMode],
  );

  const finishTurn = useCallback(
    (requestId: string, turn: SideQuestionTurn) =>
      updateState((existing) =>
        existing.turns.at(-1)?.id === requestId
          ? { ...existing, turns: [...existing.turns.slice(0, -1), turn] }
          : existing,
      ),
    [updateState],
  );

  const submit = useCallback(
    async (question: string, mode: "new" | "follow-up", modelSelection?: ModelSelection) => {
      if (!thread || !threadRef) return;
      if (state?.turns.at(-1)?.status === "loading") return;

      const previousTurns = mode === "new" ? [] : sideQuestionPreviousTurns(state?.turns ?? []);
      const retainedTurns = mode === "new" ? [] : (state?.turns ?? []);
      const requestId = randomUUID();
      const resolvedModelSelection =
        modelSelection ??
        (mode === "new" ? thread.modelSelection : (state?.modelSelection ?? thread.modelSelection));
      requestRef.current[threadKey] = requestId;
      setSideQuestionsByThread((current) => ({
        ...current,
        [threadKey]: {
          mode: "panel",
          modelSelection: resolvedModelSelection,
          turns: [...retainedTurns, { id: requestId, question, answer: "", status: "loading" }],
        },
      }));
      openPanel();

      const result = await askSideQuestion({
        environmentId,
        input: {
          threadId: thread.id,
          requestId,
          question,
          modelSelection: resolvedModelSelection,
          previousTurns,
        },
      });
      if (requestRef.current[threadKey] !== requestId) return;

      if (result._tag === "Success") {
        finishTurn(requestId, {
          id: requestId,
          question,
          answer: result.value.answer,
          status: "success",
        });
        return;
      }

      // A failed first question goes back to an empty composer so it is not lost.
      const draftStore = useComposerDraftStore.getState();
      if (mode === "new" && !draftStore.getComposerDraft(composerDraftTarget)?.prompt) {
        draftStore.setPrompt(composerDraftTarget, `/btw ${question}`);
      }
      finishTurn(requestId, {
        id: requestId,
        question,
        answer: errorMessage(squashAtomCommandFailure(result)),
        status: "error",
      });
    },
    [
      askSideQuestion,
      composerDraftTarget,
      environmentId,
      finishTurn,
      openPanel,
      state,
      thread,
      threadKey,
      threadRef,
    ],
  );

  const stop = useCallback(async () => {
    if (!thread) return;
    const latest = state?.turns.at(-1);
    if (!latest || latest.status !== "loading") return;
    const requestId = latest.id;
    const result = await cancelSideQuestion({
      environmentId,
      input: { threadId: thread.id, requestId },
    });
    if (!sideQuestionCancellationSucceeded(result) || requestRef.current[threadKey] !== requestId) {
      return;
    }
    requestRef.current[threadKey] = `stopped:${requestId}`;
    updateState((existing) => {
      const current = existing.turns.at(-1);
      return current?.id === requestId && current.status === "loading"
        ? {
            ...existing,
            turns: [...existing.turns.slice(0, -1), { ...current, answer: "", status: "stopped" }],
          }
        : existing;
    });
  }, [cancelSideQuestion, environmentId, state, thread, threadKey, updateState]);

  /**
   * Handles a composer send when it is a `/btw` side question; returns false for anything the
   * main conversation should send.
   */
  const sendFromComposer = (send: {
    readonly prompt: string;
    readonly sendContext: ReturnType<ChatComposerHandle["getSendContext"]> | undefined;
    readonly hasDirectAnnotation: boolean;
    readonly clearComposer: () => void;
  }): boolean => {
    const question = parseComposerSideQuestion(send.prompt.trim(), {
      sideQuestionsSupported: input.supported,
      isServerThread: input.isServerThread,
      hasPendingUserInput: input.hasPendingUserInput,
    });
    if (question === null) return false;
    if (question.length === 0) {
      if (state) {
        setMode("panel");
        openPanel();
      } else {
        toastManager.add(
          stackedThreadToast({
            type: "info",
            title: "No side chat yet",
            description: "Add a question after /btw.",
          }),
        );
      }
      return true;
    }

    const context = send.sendContext;
    const hasAttachments =
      send.hasDirectAnnotation ||
      (context?.images.length ?? 0) > 0 ||
      (context?.files.length ?? 0) > 0 ||
      (context?.terminalContexts.length ?? 0) > 0 ||
      (context?.previewAnnotations.length ?? 0) > 0 ||
      (context?.reviewComments.length ?? 0) > 0 ||
      (context?.threadContexts.length ?? 0) > 0;
    if (hasAttachments) {
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: "Side chats are text only",
          description: "Remove draft attachments and context, then try /btw again.",
        }),
      );
      return true;
    }
    if (state?.turns.at(-1)?.status === "loading") return true;

    send.clearComposer();
    void submit(question, "new", context?.selectedModelSelection);
    return true;
  };

  const panel =
    state?.mode === "panel" && threadRef ? (
      <SideQuestionPanel
        key={threadKey}
        cwd={input.cwd}
        threadRef={threadRef}
        turns={state.turns}
        providers={input.providers}
        settings={input.settings}
        modelSelection={state.modelSelection}
        draftSeed={state.draftSeed}
        onMinimize={() => {
          setMode("minimized");
          useRightPanelStore.getState().closeSurface(threadRef, "side-question");
        }}
        onSubmit={(question, modelSelection) => {
          void submit(question, "follow-up", modelSelection);
        }}
        onStop={stop}
        onModelSelectionChange={(modelSelection) =>
          updateState((existing) => ({ ...existing, modelSelection }))
        }
      />
    ) : null;

  const latestTurn = state?.turns.at(-1) ?? null;
  const minimizedBanner =
    state?.mode === "minimized" && latestTurn ? (
      <SideQuestionMinimized
        question={latestTurn.question}
        status={latestTurn.status}
        onDismiss={() => setMode("hidden")}
        onRestore={() => {
          setMode("panel");
          openPanel();
        }}
      />
    ) : null;

  return {
    available,
    addSurface,
    askSelection,
    onSurfacesClosed,
    sendFromComposer,
    panel,
    minimizedBanner,
  };
}
