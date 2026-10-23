import { Keyboard, Pressable, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { GlassSurface } from "../../components/ui/GlassSurface";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";
import {
  WORKSPACE_DOCK,
  WORKSPACE_TABS,
  WORKSPACE_TAB_ICONS,
  WORKSPACE_TAB_LABELS,
} from "./workspace-tabs-state";

export function WorkspaceDock(props: { readonly onNewTask: () => void }) {
  const workspace = useWorkspaceTabs()!;
  return (
    <View
      className="w-full flex-row items-center justify-between"
      style={{ gap: WORKSPACE_DOCK.gap }}
    >
      <GlassSurface
        style={{
          width: WORKSPACE_DOCK.tabWidth * WORKSPACE_TABS.length,
          height: WORKSPACE_DOCK.height,
          borderRadius: WORKSPACE_DOCK.height / 2,
        }}
      >
        <View className="flex-1 flex-row p-1" accessibilityRole="tablist">
          {WORKSPACE_TABS.map((tab) => {
            const selected = workspace.state.selectedTab === tab;
            return (
              <Pressable
                key={tab}
                accessibilityRole="tab"
                accessibilityLabel={WORKSPACE_TAB_LABELS[tab].title}
                accessibilityState={{ selected }}
                onPress={() => {
                  if (selected) return;
                  Keyboard.dismiss();
                  workspace.dispatch({ type: "select", tab });
                }}
                className={
                  selected
                    ? "flex-1 items-center justify-center rounded-full bg-subtle-strong"
                    : "flex-1 items-center justify-center rounded-full"
                }
              >
                <SymbolView
                  name={WORKSPACE_TAB_ICONS[tab]}
                  size={23}
                  tintColorClassName={selected ? "accent-focus" : "accent-icon"}
                />
              </Pressable>
            );
          })}
        </View>
      </GlassSurface>
      <GlassSurface
        style={{
          width: WORKSPACE_DOCK.height,
          height: WORKSPACE_DOCK.height,
          borderRadius: WORKSPACE_DOCK.height / 2,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New chat"
          onPress={props.onNewTask}
          className="flex-1 items-center justify-center"
        >
          <SymbolView name="square.and.pencil" size={23} tintColorClassName="accent-icon" />
        </Pressable>
      </GlassSurface>
    </View>
  );
}
