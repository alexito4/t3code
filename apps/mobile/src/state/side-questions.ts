import type { ModelSelection } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "./atom-registry";

export type SideQuestionTurn = {
  readonly question: string;
  readonly id: string;
  readonly answer: string;
  readonly status: "loading" | "success" | "error" | "stopped";
};

export type SideQuestionState = {
  readonly mode: "expanded" | "minimized" | "hidden";
  readonly turns: ReadonlyArray<SideQuestionTurn>;
  readonly draft: string;
  readonly modelSelection: ModelSelection;
};

type SideQuestionsByThread = Readonly<Record<string, SideQuestionState>>;

/** Lives outside the thread body, which remounts per thread, so the settings sheet can edit it too. */
const sideQuestionsAtom = Atom.make<SideQuestionsByThread>({}).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:side-questions"),
);

export const sideQuestionStateAtom = Atom.family((threadKey: string) =>
  Atom.map(sideQuestionsAtom, (states): SideQuestionState | null => states[threadKey] ?? null),
);

export function updateSideQuestions(
  update: (current: SideQuestionsByThread) => SideQuestionsByThread,
): void {
  appAtomRegistry.update(sideQuestionsAtom, update);
}

export function patchSideQuestionState(
  threadKey: string,
  patch: Partial<Pick<SideQuestionState, "mode" | "draft" | "modelSelection">>,
): void {
  updateSideQuestions((current) => {
    const state = current[threadKey];
    return state ? { ...current, [threadKey]: { ...state, ...patch } } : current;
  });
}

/** Whether `requestId` is still the latest unanswered question; a stop or a newer turn replaces it. */
export function sideQuestionAwaitsAnswer(threadKey: string, requestId: string): boolean {
  const latest = appAtomRegistry.get(sideQuestionsAtom)[threadKey]?.turns.at(-1);
  return latest?.id === requestId && latest.status === "loading";
}
