import type { ModelSelection, ScopedThreadRef, ServerProvider } from "@t3tools/contracts";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import { createModelSelection } from "@t3tools/shared/model";
import { MessageCirclePlus, Minimize2Icon } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { useMediaQuery } from "../hooks/useMediaQuery";
import ChatMarkdown from "./ChatMarkdown";
import { getAppModelOptionsForInstance } from "../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  resolveSelectableProviderInstanceEntry,
  sortProviderInstanceEntries,
} from "../providerInstances";
import { ComposerBanner } from "./chat/ComposerBanner";
import { ComposerSurface } from "./chat/ComposerSurface";
import { getComposerProviderState } from "./chat/composerProviderState";
import { MessageCopyButton } from "./chat/MessageCopyButton";
import { ProviderModelPicker } from "./chat/ProviderModelPicker";
import { TraitsPicker } from "./chat/TraitsPicker";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { Spinner } from "./ui/spinner";

export type SideQuestionTurn = {
  readonly question: string;
  readonly id: string;
  readonly answer: string;
  readonly status: "loading" | "success" | "error" | "stopped";
};

export function SideQuestionPanel(props: {
  readonly cwd: string | undefined;
  readonly threadRef?: ScopedThreadRef;
  readonly turns: ReadonlyArray<SideQuestionTurn>;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly settings: UnifiedSettings;
  readonly modelSelection: ModelSelection;
  readonly onMinimize: () => void;
  readonly onModelSelectionChange: (selection: ModelSelection) => void;
  readonly onStop: () => void;
  readonly onSubmit: (question: string, modelSelection: ModelSelection) => void;
  /**
   * Text to prepend to the draft, e.g. from "Ask in side chat" on a message
   * selection. Bump `nonce` to seed again — the panel stays mounted across a
   * thread's whole side-chat session, so a changed prop value alone wouldn't
   * otherwise distinguish a repeat request from the one already applied.
   */
  readonly draftSeed?: { readonly text: string; readonly nonce: number } | undefined;
}) {
  const [draft, setDraft] = useState("");
  const appliedDraftSeedNonceRef = useRef<number | null>(null);
  useEffect(() => {
    const seed = props.draftSeed;
    if (!seed || appliedDraftSeedNonceRef.current === seed.nonce) return;
    appliedDraftSeedNonceRef.current = seed.nonce;
    setDraft((current) => {
      const trimmed = current.trimStart();
      return trimmed.length === 0 ? `${seed.text} ` : `${seed.text}\n\n${trimmed}`;
    });
  }, [props.draftSeed]);
  const isMobileViewport = useMediaQuery("max-sm");
  const pending = props.turns.at(-1)?.status === "loading";
  const providerEntries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(
          deriveProviderInstanceEntries(props.providers),
          props.settings,
        ),
      ),
    [props.providers, props.settings],
  );
  const modelOptionsByInstance = useMemo(
    () =>
      new Map(
        providerEntries.map((entry) => [
          entry.instanceId,
          getAppModelOptionsForInstance(props.settings, entry),
        ]),
      ),
    [providerEntries, props.settings],
  );
  const activeEntry =
    resolveSelectableProviderInstanceEntry(providerEntries, props.modelSelection.instanceId) ??
    null;
  const activeModelSelection = activeEntry
    ? activeEntry.instanceId === props.modelSelection.instanceId
      ? props.modelSelection
      : createModelSelection(
          activeEntry.instanceId,
          modelOptionsByInstance.get(activeEntry.instanceId)?.[0]?.slug ??
            props.modelSelection.model,
        )
    : props.modelSelection;
  const selectModel = (instanceId: ModelSelection["instanceId"], model: string) => {
    const entry = providerEntries.find((candidate) => candidate.instanceId === instanceId);
    if (!entry) return;
    const providerState = getComposerProviderState({
      provider: entry.driverKind,
      model,
      models: entry.models,
      modelOptions:
        instanceId === props.modelSelection.instanceId ? props.modelSelection.options : undefined,
      planModeEnabled: props.settings.planModeEnabled,
    });
    props.onModelSelectionChange(
      createModelSelection(instanceId, model, providerState.modelOptionsForDispatch),
    );
  };
  const submitDraft = () => {
    const question = draft.trim();
    if (!question || pending) return;
    props.onSubmit(question, activeModelSelection);
    setDraft("");
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitDraft();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div
        className="flex h-10 min-h-10 shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-background px-4 in-data-[preview-panel-mode=inline]:mb-3 in-data-[preview-panel-mode=inline]:h-7 in-data-[preview-panel-mode=inline]:min-h-7 in-data-[preview-panel-mode=inline]:border-b-transparent"
        data-surface-subheader
      >
        <div className="min-w-0 truncate text-muted-foreground text-xs">
          Ask without interrupting the main agent.
        </div>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost-muted"
          aria-label="Minimize side chat"
          onClick={props.onMinimize}
        >
          <Minimize2Icon className="size-3.5" />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1" scrollFade>
        <div className="space-y-5 p-4" aria-live="polite">
          {props.turns.map((turn) => (
            <div key={turn.id} className="space-y-2.5">
              <div className="group flex flex-col items-end gap-1">
                <div className="relative max-w-[80%] rounded-2xl bg-message p-3 text-message-foreground text-sm whitespace-pre-wrap wrap-break-word">
                  {turn.question}
                </div>
                <div className="flex w-full max-w-[80%] items-center justify-end pe-1 text-xs tabular-nums opacity-0 transition-opacity duration-200 pointer-coarse:opacity-100 focus-within:opacity-100 group-hover:opacity-100">
                  <MessageCopyButton text={turn.question} variant="ghost" />
                </div>
              </div>
              {turn.status === "loading" ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Spinner aria-hidden="true" className="size-4" />
                  Thinking…
                </div>
              ) : turn.status === "error" ? (
                <div className="text-destructive text-sm">{turn.answer}</div>
              ) : turn.status === "stopped" ? (
                <div className="text-muted-foreground text-sm">Stopped</div>
              ) : (
                <ChatMarkdown
                  text={turn.answer}
                  cwd={props.cwd}
                  {...(props.threadRef ? { threadRef: props.threadRef } : {})}
                  className="text-sm"
                />
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      <div data-side-question-composer-dock="true" className="shrink-0 px-3 pt-3 pb-13">
        <form data-side-question-composer-shell="true" onSubmit={submit}>
          <ComposerSurface.Shell>
            <ComposerSurface.Host>
              <ComposerSurface.Main>
                <div data-chat-composer-surface="true" className="rounded-3xl">
                  <div className="relative px-3 pb-2 pt-3.5 sm:px-4 sm:pt-4">
                    <textarea
                      className="field-sizing-content block max-h-50 min-h-17.5 w-full resize-none overflow-y-auto bg-transparent p-0 text-sm outline-none max-sm:min-h-20.5"
                      value={draft}
                      aria-label={
                        props.turns.length === 0 ? "Start a side chat" : "Continue the side chat"
                      }
                      placeholder={
                        props.turns.length === 0
                          ? "Ask without interrupting the agent…"
                          : "Continue the side chat…"
                      }
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        // Enter asks, Shift+Enter adds a line; touch keyboards keep Return for lines.
                        if (
                          event.nativeEvent.isComposing ||
                          event.key !== "Enter" ||
                          event.shiftKey ||
                          isMobileViewport
                        ) {
                          return;
                        }
                        event.preventDefault();
                        submitDraft();
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 px-3 pb-3 sm:px-4 sm:pb-4">
                    <div className="flex min-w-0 items-center gap-1">
                      {activeEntry ? (
                        <>
                          <ProviderModelPicker
                            size="xs"
                            activeInstanceId={activeModelSelection.instanceId}
                            model={activeModelSelection.model}
                            lockedProvider={null}
                            instanceEntries={providerEntries}
                            modelOptionsByInstance={modelOptionsByInstance}
                            terminalOpen={false}
                            triggerAriaLabel="Side chat model"
                            onInstanceModelChange={selectModel}
                          />
                          <TraitsPicker
                            provider={activeEntry.driverKind}
                            instanceId={activeEntry.instanceId}
                            models={activeEntry.models}
                            model={activeModelSelection.model}
                            prompt=""
                            onPromptChange={() => undefined}
                            modelOptions={activeModelSelection.options}
                            allowPromptInjectedEffort={false}
                            planModeEnabled={props.settings.planModeEnabled}
                            onModelOptionsChange={(options) =>
                              props.onModelSelectionChange(
                                createModelSelection(
                                  activeModelSelection.instanceId,
                                  activeModelSelection.model,
                                  options,
                                ),
                              )
                            }
                          />
                        </>
                      ) : null}
                    </div>
                    {pending ? (
                      <button
                        type="button"
                        className="flex size-9 cursor-pointer items-center justify-center rounded-full bg-destructive/90 text-white shadow-xs shadow-destructive/24 inset-shadow-control-highlight transition-all duration-150 hover:scale-105 hover:bg-destructive active:inset-shadow-control-pressed active:shadow-none sm:size-8"
                        aria-label="Stop side chat"
                        onClick={props.onStop}
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 12 12"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <rect x="2" y="2" width="8" height="8" rx="1.5" />
                        </svg>
                      </button>
                    ) : (
                      <button
                        type="submit"
                        className="relative isolate flex size-9 items-center justify-center overflow-hidden rounded-full bg-message-action text-message-action-foreground shadow-xs transition-all duration-150 enabled:cursor-pointer enabled:shadow-message-action/24 enabled:inset-shadow-control-highlight hover:scale-105 hover:bg-message-action-hover active:inset-shadow-control-pressed active:shadow-none disabled:pointer-events-none disabled:opacity-64 disabled:shadow-none sm:size-8 [&_svg]:pointer-events-none"
                        disabled={draft.trim().length === 0}
                        aria-label="Ask follow-up"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 14 14"
                          fill="none"
                          aria-hidden="true"
                          className="size-3.5"
                        >
                          <path
                            d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </ComposerSurface.Main>
            </ComposerSurface.Host>
          </ComposerSurface.Shell>
        </form>
      </div>
    </div>
  );
}

export function SideQuestionMinimized(props: {
  readonly question: string;
  readonly status: SideQuestionTurn["status"];
  readonly onDismiss: () => void;
  readonly onRestore: () => void;
}) {
  return (
    <ComposerBanner.Attachment>
      <ComposerBanner.Root
        data-chat-composer-side-question="true"
        variant={props.status === "error" ? "error" : "info"}
        className="relative z-0"
      >
        <ComposerBanner.Row>
          <ComposerBanner.Content>
            <button
              type="button"
              aria-label="Open side chat"
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 self-stretch text-left text-muted-foreground hover:text-foreground"
              onClick={props.onRestore}
              onPointerDown={(event) => event.preventDefault()}
            >
              <MessageCirclePlus aria-hidden className="size-3.5 shrink-0" />
              <span className="shrink-0 font-medium text-foreground">Side chat</span>
              <span className="min-w-0 flex-1 truncate">{props.question}</span>
              {props.status === "loading" ? (
                <Spinner aria-hidden="true" className="size-3.5 shrink-0" />
              ) : (
                <span className="shrink-0">
                  {props.status === "error"
                    ? "Needs attention"
                    : props.status === "stopped"
                      ? "Stopped"
                      : "Answered"}
                </span>
              )}
            </button>
          </ComposerBanner.Content>
          <ComposerBanner.Actions>
            <ComposerBanner.Dismiss
              aria-label="Dismiss side chat"
              onClick={props.onDismiss}
              onPointerDown={(event) => event.preventDefault()}
            />
          </ComposerBanner.Actions>
        </ComposerBanner.Row>
      </ComposerBanner.Root>
    </ComposerBanner.Attachment>
  );
}
