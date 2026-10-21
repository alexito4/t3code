import { describe, expect, it } from "vite-plus/test";

import { buildSideQuestionPrompt } from "./textGenerationPrompts.ts";
import { normalizeCliError } from "./textGenerationUtils.ts";

describe("buildSideQuestionPrompt", () => {
  it("asks for a tool-free answer that stays outside the main conversation", () => {
    const result = buildSideQuestionPrompt({
      question: "What did we learn?",
      context: "USER:\nInvestigate reconnects",
    });

    expect(result.prompt).toContain("Do not use tools");
    expect(result.prompt).toContain("Do not continue or influence the main coding task");
    expect(result.prompt).toContain("What did we learn?");
    expect(result.prompt).toContain("Investigate reconnects");
  });
});

describe("normalizeCliError", () => {
  it("does not expose CLI failure details in the public error message", () => {
    const result = normalizeCliError(
      "codex",
      "generateCommitMessage",
      new Error("request failed with access_token=secret-token"),
      "Failed to generate a commit message",
    );

    expect(result.detail).toBe("Failed to generate a commit message");
    expect(result.message).not.toContain("secret-token");
  });
});
