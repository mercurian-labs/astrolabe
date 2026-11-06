import { Pressable, View } from "react-native";

import { AppText as Text } from "../../../components/ui/AppText";

/** A line above a document about its state, with an optional action. */
export function WikiNotice(props: {
  readonly text: string;
  readonly action?: string;
  readonly onAction?: () => void;
}) {
  return (
    <View className="flex-row items-center gap-3 border-b border-border-subtle bg-subtle px-4 py-2.5">
      <Text className="flex-1 text-sm text-foreground-muted">{props.text}</Text>
      {props.action ? (
        <Pressable accessibilityRole="button" onPress={props.onAction} hitSlop={8}>
          <Text className="text-sm font-t3-medium text-primary">{props.action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
