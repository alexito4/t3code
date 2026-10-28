import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("~/hooks/useSettings", () => ({
  useClientSettings: (select: (settings: { redesignEnabled: boolean }) => unknown) =>
    select({ redesignEnabled: false }),
  useEnvironmentIdentificationMode: () => "none",
}));
vi.mock("../SidebarStageBackdrop", () => ({
  StageBackdropButtonArt: ({ variant }: { variant: string }) => `stage-${variant}`,
  useSidebarStageBackdropVariant: () => null,
}));

import { parseComposerSideQuestion } from "../../composer-logic";
import { ComposerPrimaryActions } from "./ComposerPrimaryActions";

const noop = () => {};

function renderPendingActions(isRunning: boolean, isSideQuestion: boolean) {
  return renderToStaticMarkup(
    createElement(ComposerPrimaryActions, {
      compact: true,
      canOperateThread: true,
      pendingAction: {
        questionIndex: 0,
        isLastQuestion: true,
        canAdvance: true,
        isResponding: false,
        isComplete: true,
      },
      isRunning,
      canInterrupt: isRunning,
      isSideQuestion,
      showPlanFollowUpPrompt: false,
      promptHasText: false,
      isSendBusy: false,
      sendDisabledReason: null,
      isEnvironmentUnavailable: false,
      isPreparingWorktree: false,
      hasSendableContent: false,
      onPreviousPendingQuestion: noop,
      onInterrupt: noop,
      onImplementPlanInNewThread: noop,
    }),
  );
}

function renderSideQuestionSendButton(showPlanFollowUpPrompt: boolean) {
  return renderToStaticMarkup(
    createElement(ComposerPrimaryActions, {
      compact: true,
      canOperateThread: true,
      pendingAction: null,
      isRunning: false,
      canInterrupt: false,
      isSideQuestion: true,
      showPlanFollowUpPrompt,
      promptHasText: true,
      isSendBusy: false,
      sendDisabledReason: null,
      isEnvironmentUnavailable: false,
      isPreparingWorktree: false,
      hasSendableContent: true,
      onPreviousPendingQuestion: noop,
      onInterrupt: noop,
      onImplementPlanInNewThread: noop,
    }),
  );
}

describe("ComposerPrimaryActions side questions", () => {
  it("labels side questions as Ask even when a plan is active", () => {
    const markup = renderSideQuestionSendButton(true);

    expect(markup).toContain('aria-label="Ask in side chat"');
    expect(markup).not.toContain("Refine");
  });

  it("keeps pending-answer controls when the custom answer starts with /btw", () => {
    const isSideQuestion =
      parseComposerSideQuestion("/btw custom answer", {
        sideQuestionsSupported: true,
        isServerThread: true,
        hasPendingUserInput: true,
      }) !== null;
    const markup = renderPendingActions(true, isSideQuestion);

    expect(markup).toContain("Submit");
    expect(markup).not.toContain('aria-label="Ask in side chat"');
  });
});
