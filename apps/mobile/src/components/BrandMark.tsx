import Constants from "expo-constants";
import { View } from "react-native";

import { AppText as Text } from "./ui/AppText";
import { AstrolabeWordmark } from "./brand/AstrolabeMarks";
import { resolveMobileStageLabel } from "../lib/mobileBranding";

export function BrandMark(props: { readonly compact?: boolean; readonly stageLabel?: string }) {
  const compact = props.compact ?? false;
  const stageLabel =
    props.stageLabel ?? resolveMobileStageLabel(Constants.expoConfig?.extra?.appVariant);

  return (
    <View className="items-center gap-2">
      <View className="flex-row items-center gap-2">
        <AstrolabeWordmark accessibilityLabel="Astrolabe" height={compact ? 28 : 36} />
        <View className="rounded-full bg-subtle px-2 py-1">
          <Text className="text-3xs font-t3-bold tracking-[1.1px] uppercase text-foreground-muted">
            {stageLabel}
          </Text>
        </View>
      </View>
      {!compact ? (
        <Text className="text-xs font-medium text-foreground-muted">
          Mobile control surface for your live coding environments
        </Text>
      ) : null}
    </View>
  );
}
