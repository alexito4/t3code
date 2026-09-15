import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { createRef, useEffect, useMemo } from "react";

import { threadEnvironment } from "~/state/threads";
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
  const setScratchpad = useAtomCommand(threadEnvironment.setScratchpad);
  const session = useMemo(() => {
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
  }, [environmentId, setScratchpad, threadId]);

  // StrictMode replays effect setup. A retired scratchpad session stays inert,
  // while the replay gets a fresh coordinator instead of reusing a disposed one.
  useEffect(session.setup, [session]);
  return session;
}
