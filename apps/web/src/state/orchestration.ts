import { createOrchestrationEnvironmentAtoms } from "@t3tools/client-runtime/state/orchestration";
import { createThreadExportCommand } from "@t3tools/client-runtime/state/thread-export";

import { connectionAtomRuntime } from "../connection/runtime";

export const orchestrationEnvironment = createOrchestrationEnvironmentAtoms(connectionAtomRuntime);

export const exportThreadCommand = createThreadExportCommand(connectionAtomRuntime);
