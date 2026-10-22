import { useNavigation } from "@react-navigation/native";
import { use, useCallback, useMemo, type ReactNode } from "react";
import { Platform, View, useWindowDimensions } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";

import { CompactBrandTitle } from "../../components/CompactBrandTitle";
import {
  AndroidHeaderIconButton,
  AndroidScreenHeader,
} from "../../components/ui/AndroidScreenHeader";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import {
  useDeviceType,
  useNativeColumnLayoutMetrics,
  useNativeLayoutMetrics,
} from "../../native/native-layout-metrics";
import { AccountMenuButton } from "../cloud/accountMenu";
import { HomeRouteScreen } from "../home/HomeRouteScreen";
import { dispatchHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";
import { WorkspaceConnectionTitle } from "../home/WorkspaceConnectionTitle";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { PullRequestsScreen } from "../pull-requests/PullRequestsScreen";
import { RepositoriesScreen } from "../repositories/RepositoriesScreen";
import { WikisScreen } from "../wikis/WikisScreen";
import {
  WorkspaceTabsContext,
  WorkspaceTabsProvider,
  useWorkspaceTabs,
} from "./WorkspaceTabsContext";
import { WorkspaceToolbar } from "./WorkspaceToolbar";
import {
  WORKSPACE_DOCK,
  WORKSPACE_TAB_LABELS,
  workspaceToolbarHeight,
  type WorkspaceTab,
} from "./workspace-tabs-state";
import { WorkspaceSidebarTabs } from "./WorkspaceSidebarTabs";
import { useSidebarWorkspaceTabs, useSystemWorkspaceTabBar } from "./useSystemWorkspaceTabBar";

const TAB_SCREENS: Readonly<Record<WorkspaceTab, () => ReactNode>> = {
  threads: () => <HomeRouteScreen />,
  pullRequests: () => <PullRequestsScreen />,
  wikis: () => <WikisScreen />,
  repositories: () => <RepositoriesScreen />,
};

function WorkspaceRootTitle(props: {
  readonly maxWidth: number;
  readonly onOpenEnvironments: () => void;
}) {
  const { state } = useWorkspaceTabs()!;
  return (
    <View style={{ width: props.maxWidth, minHeight: 32, justifyContent: "center" }}>
      <WorkspaceConnectionTitle
        brand={
          <CompactBrandTitle
            accessibilityLabel={`Astrolabe, ${WORKSPACE_TAB_LABELS[state.selectedTab].title}`}
          />
        }
        maxWidth={props.maxWidth}
        onPress={props.onOpenEnvironments}
      />
    </View>
  );
}

function WorkspaceRootContent() {
  const navigation = useNavigation();
  const { width: windowWidth } = useWindowDimensions();
  const { layout } = useAdaptiveWorkspaceLayout();
  const primaryColumn = use(NativePrimaryColumnContext);
  const columnMetrics = useNativeColumnLayoutMetrics();
  const nativeMetrics = useNativeLayoutMetrics();
  const deviceType = useDeviceType();
  const systemTabBar = useSystemWorkspaceTabBar();
  const sidebarTabs = useSidebarWorkspaceTabs();
  const sidebarPicker = sidebarTabs === "picker";
  const sidebarNavigation =
    primaryColumn !== null &&
    (layout.usesSplitView ||
      deviceType === "pad" ||
      (nativeMetrics !== null && nativeMetrics.verticalBarEdge !== "none"));
  const width = columnMetrics?.width ?? windowWidth;
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardState((keyboard) => keyboard.height);
  const workspace = useWorkspaceTabs()!;
  const { state } = workspace;
  const renderHeaderTitle = useCallback(
    () => (
      <WorkspaceRootTitle
        maxWidth={Math.max(0, width - 160)}
        onOpenEnvironments={() =>
          navigation.navigate("SettingsSheet", {
            screen: "SettingsContent",
            params: { screen: "SettingsEnvironments" },
          })
        }
      />
    ),
    [width, navigation],
  );
  const tab = state.tabs[state.selectedTab];
  const bottomClearance =
    Platform.OS === "ios"
      ? Math.max(insets.bottom, keyboardHeight) +
        (systemTabBar || sidebarTabs || tab.searchMode !== "resting"
          ? 16
          : WORKSPACE_DOCK.height + WORKSPACE_DOCK.bottomGap + 16)
      : keyboardHeight > 0 && tab.searchMode !== "resting"
        ? keyboardHeight + 64
        : Math.max(insets.bottom, 12) + workspaceToolbarHeight(tab.searchMode) + 16;
  const context = useMemo(() => ({ ...workspace, bottomClearance }), [workspace, bottomClearance]);

  return (
    <WorkspaceTabsContext value={context}>
      <View
        className={sidebarPicker ? "flex-1 bg-drawer" : "flex-1 bg-screen"}
        style={sidebarPicker ? { paddingTop: insets.top } : undefined}
      >
        {Platform.OS === "ios" ? (
          <NativeStackScreenOptions
            optionsVersion={[state.selectedTab, state.selectionRevision, width, sidebarNavigation]}
            options={{
              title: WORKSPACE_TAB_LABELS[state.selectedTab].title,
              headerShown: true,
              unstable_headerLeftItems: () => [],
              headerTitle: renderHeaderTitle,
              ...(state.selectedTab === "threads" ? {} : { nativeSidebarFilter: undefined }),
            }}
          />
        ) : (
          <AndroidScreenHeader
            title="Astrolabe"
            titleContent={renderHeaderTitle()}
            actions={[
              {
                accessibilityLabel: WORKSPACE_TAB_LABELS[state.selectedTab].search,
                icon: "magnifyingglass",
                onPress: () => {
                  dispatchHardwareKeyboardCommand("focusSearch");
                },
              },
            ]}
            trailing={
              <AccountMenuButton
                renderButton={(button) => <AndroidHeaderIconButton {...button} />}
              />
            }
          />
        )}
        {sidebarPicker ? <WorkspaceSidebarTabs /> : null}
        <SafeAreaInsetsContext value={sidebarPicker ? { ...insets, top: 0 } : insets}>
          {TAB_SCREENS[state.selectedTab]()}
        </SafeAreaInsetsContext>
        <WorkspaceToolbar
          sidebar={sidebarNavigation}
          onNewTask={() => navigation.navigate("NewTaskSheet", { screen: "NewTask" })}
        />
      </View>
    </WorkspaceTabsContext>
  );
}

export function WorkspaceRootScreen() {
  const { layout } = useAdaptiveWorkspaceLayout();
  const workspace = useWorkspaceTabs();
  return Platform.OS === "android" && layout.usesSplitView ? (
    <HomeRouteScreen />
  ) : workspace ? (
    <WorkspaceRootContent />
  ) : (
    <WorkspaceTabsProvider>
      <WorkspaceRootContent />
    </WorkspaceTabsProvider>
  );
}
