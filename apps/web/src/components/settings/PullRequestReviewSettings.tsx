import { useRef } from "react";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";

import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { Textarea } from "../ui/textarea";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function PullRequestReviewSettingsSection() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const instructionsRef = useRef<HTMLTextAreaElement>(null);
  const instructions = settings.pullRequestReviewInstructions;
  const defaultInstructions = DEFAULT_UNIFIED_SETTINGS.pullRequestReviewInstructions;

  return (
    <SettingsSection title="Pull requests">
      <SettingsRow
        {...searchableSetting("pull-request-review-instructions")}
        description='The checklist the "Review this PR" action hands the agent, alongside the pull request itself.'
        resetAction={
          instructions !== defaultInstructions ? (
            <SettingResetButton
              label="review checklist"
              onClick={() => updateSettings({ pullRequestReviewInstructions: defaultInstructions })}
            />
          ) : null
        }
      >
        <div className="mt-3 max-w-2xl pb-3.5">
          <Textarea
            key={instructions}
            ref={instructionsRef}
            defaultValue={instructions}
            onBlur={(event) => {
              const next = event.target.value.trim();
              if (next.length > 0 && next !== instructions) {
                updateSettings({ pullRequestReviewInstructions: next });
              }
            }}
            rows={4}
            placeholder={defaultInstructions}
            aria-label="Pull request review checklist"
          />
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}
