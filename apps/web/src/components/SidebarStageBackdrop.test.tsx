import { describe, expect, it } from "vite-plus/test";

import {
  resolveEnvironmentIdentificationPillLabel,
  resolveSidebarStageBackdropVariant,
} from "./SidebarStageBackdrop";

// Personal fork builds (see ALEX.md) report a "Personal" stage label.
describe("SidebarStageBackdrop personal stage", () => {
  it("resolves the sunset artwork for personal builds", () => {
    expect(resolveSidebarStageBackdropVariant("Personal")).toBe("personal");
    expect(resolveSidebarStageBackdropVariant("Personal", "none")).toBeNull();
  });

  it("labels personal environments", () => {
    expect(resolveEnvironmentIdentificationPillLabel("personal")).toBe("Personal");
  });
});
