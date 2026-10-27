import { useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { type NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { EnvironmentId, ModelSelection, ThreadId } from "@t3tools/contracts";
import { View } from "react-native";

import { buildModelOptions, groupByProvider } from "../../lib/modelOptions";
import { resolveProviderOptionDescriptors } from "../../lib/providerOptions";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { patchSideQuestionState, sideQuestionStateAtom } from "../../state/side-questions";
import { useThreadSelection } from "../../state/use-thread-selection";
import { ThreadSettingsPickerScreen } from "./ThreadSettingsSheet";

export type SideChatSettingsRouteParams = {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
};

/** The side chat's own model and traits, picked within the thread's provider. */
export function SideChatSettingsRouteScreen({
  route,
}: StaticScreenProps<SideChatSettingsRouteParams>) {
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();
  const { selectedThread, selectedEnvironmentRuntime } = useThreadSelection();
  const threadKey = scopedThreadKey(route.params.environmentId, route.params.threadId);
  const sideQuestionState = useAtomValue(sideQuestionStateAtom(threadKey));

  if (!selectedThread || !sideQuestionState) {
    return <View className="flex-1 bg-sheet" />;
  }

  const modelSelection = sideQuestionState.modelSelection;
  const modelOptions = buildModelOptions(
    selectedEnvironmentRuntime?.serverConfig ?? null,
    modelSelection,
    undefined,
    selectedThread.projectId,
  );
  const currentModelOption =
    modelOptions.find(
      (option) =>
        option.selection.instanceId === modelSelection.instanceId &&
        option.selection.model === modelSelection.model,
    ) ?? null;
  const updateModelSelection = (selection: ModelSelection) =>
    patchSideQuestionState(threadKey, { modelSelection: selection });

  return (
    <ThreadSettingsPickerScreen
      environmentId={selectedThread.environmentId}
      projectId={selectedThread.projectId}
      title="Side chat settings"
      showRuntime={false}
      providerGroups={groupByProvider(modelOptions).filter(
        (group) => group.providerKey === modelSelection.instanceId,
      )}
      selectedModel={modelSelection}
      // The side chat's follow-up draft carries prompt-controlled traits such as ultrathink.
      prompt={sideQuestionState.draft}
      onPromptChange={(draft) => patchSideQuestionState(threadKey, { draft })}
      onSelectModel={(option) => updateModelSelection(option.selection)}
      optionDescriptors={resolveProviderOptionDescriptors({
        capabilities: currentModelOption?.capabilities,
        selections: modelSelection.options,
      })}
      onUpdateOptionSelections={(options) => updateModelSelection({ ...modelSelection, options })}
      runtimeMode={selectedThread.runtimeMode}
      onUpdateRuntimeMode={() => undefined}
      onClose={() => navigation.goBack()}
    />
  );
}
