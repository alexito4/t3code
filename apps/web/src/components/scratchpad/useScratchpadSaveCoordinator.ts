import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { createRef, useEffect, useState } from "react";

import { orchestrationEnvironment } from "~/state/orchestration";
import { useAtomCommand } from "~/state/use-atom-command";

import { FileSaveCoordinator } from "../files/fileSaveCoordinator";

const SCRATCHPAD_SAVE_DEBOUNCE_MS = 500;

interface ScratchpadSaveOptions {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}

export function useScratchpadSaveCoordinator({
  environmentId,
  threadId,
}: ScratchpadSaveOptions): Pick<FileSaveCoordinator, "change"> {
  const setScratchpad = useScratchpadWriter();
  // A session owns the pending debounce, so it must outlive rerenders and be
  // replaced only when what it writes to changes.
  const inputs = { environmentId, threadId, setScratchpad };
  const [current, setCurrent] = useState(() => ({
    inputs,
    session: createScratchpadSaveSession(inputs),
  }));
  if (
    current.inputs.environmentId !== environmentId ||
    current.inputs.threadId !== threadId ||
    current.inputs.setScratchpad !== setScratchpad
  ) {
    setCurrent({ inputs, session: createScratchpadSaveSession(inputs) });
  }
  const session = current.session;

  // StrictMode replays effect setup. A retired scratchpad session stays inert,
  // while the replay gets a fresh coordinator instead of reusing a disposed one.
  useEffect(session.setup, [session]);
  return session;
}

function useScratchpadWriter() {
  return useAtomCommand(orchestrationEnvironment.setThreadScratchpad);
}

function createScratchpadSaveSession({
  environmentId,
  threadId,
  setScratchpad,
}: ScratchpadSaveOptions & {
  setScratchpad: ReturnType<typeof useScratchpadWriter>;
}) {
  const coordinatorRef = createRef<FileSaveCoordinator>();
  return {
    change: (contents: string) => coordinatorRef.current?.change(contents),
    setup: () => {
      const coordinator = new FileSaveCoordinator({
        debounceMs: SCRATCHPAD_SAVE_DEBOUNCE_MS,
        onPendingChange: () => {},
        persist: (nextContents) =>
          setScratchpad({ environmentId, input: { threadId, content: nextContents } }),
        onConfirmed: () => {},
      });
      coordinatorRef.current = coordinator;
      return () => {
        coordinatorRef.current = null;
        coordinator.dispose();
      };
    },
  };
}
