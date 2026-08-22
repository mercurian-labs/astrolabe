import type { PlanningModelSelection, ServerProvider } from "@t3tools/contracts";
import { Modal, Platform, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { useThemeColor } from "../../lib/useThemeColor";
import { planModelOptions } from "./planModelSheet.logic";

export function PlanModelSheet(props: {
  readonly visible: boolean;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly selection: PlanningModelSelection | null;
  readonly disabled: boolean;
  readonly onSelect: (selection: PlanningModelSelection) => void;
  readonly onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const checkColor = useThemeColor("--color-primary-foreground");
  const options = planModelOptions(props.providers, props.selection);

  return (
    <Modal
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType={Platform.OS === "ios" ? "fade" : "none"}
      visible={props.visible}
      onRequestClose={props.onClose}
    >
      <View className="flex-1 justify-end">
        <Pressable
          accessibilityLabel="Close model picker"
          className="absolute inset-0 bg-backdrop"
          onPress={props.onClose}
        />
        <View
          className="overflow-hidden rounded-t-[24px] border border-b-0 border-border bg-sheet"
          style={{ maxHeight: height * 0.75, paddingBottom: insets.bottom + 12 }}
        >
          <Pressable
            accessibilityLabel="Close model picker"
            accessibilityRole="button"
            onPress={props.onClose}
            className="items-center pb-2 pt-2.5"
          >
            <View className="h-1 w-9 rounded-full bg-subtle-strong" />
          </Pressable>
          <Text className="px-5 pb-2 text-base font-t3-bold text-foreground">Planning model</Text>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 8 }}>
            {options.length === 0 ? (
              <Text className="px-3 py-6 text-sm text-foreground-muted">
                No provider models are available on this machine.
              </Text>
            ) : (
              options.map((option) => {
                const selected =
                  option.selection.provider === props.selection?.provider &&
                  option.selection.model === props.selection.model;
                return (
                  <Pressable
                    key={option.key}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: props.disabled, selected }}
                    disabled={props.disabled}
                    onPress={() => {
                      props.onSelect(option.selection);
                      props.onClose();
                    }}
                    className={cn(
                      "flex-row items-center gap-3 rounded-xl px-3 py-3.5 active:opacity-70",
                      selected ? "bg-primary" : "bg-transparent",
                      props.disabled && "opacity-45",
                    )}
                  >
                    <View className="min-w-0 flex-1">
                      <Text
                        numberOfLines={1}
                        className={cn(
                          "text-sm font-t3-medium",
                          selected ? "text-primary-foreground" : "text-foreground",
                        )}
                      >
                        {option.modelLabel}
                      </Text>
                      <Text
                        className={cn(
                          "text-xs",
                          selected ? "text-primary-foreground" : "text-foreground-muted",
                        )}
                      >
                        {option.providerLabel}
                        {option.signedIn ? "" : " · Sign-in required to send"}
                      </Text>
                    </View>
                    {selected ? (
                      <SymbolView
                        name="checkmark"
                        size={14}
                        tintColor={checkColor}
                        type="monochrome"
                      />
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
