import type { MenuAction } from "@react-native-menu/menu";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackHeaderItem } from "@react-navigation/native-stack";
import { useCallback, useMemo, type ReactElement } from "react";

import { Menu } from "../../components/ui/Menu";
import { withNativeGlassHeaderItem } from "../layout/native-glass-header-items";
import { signOutCloudAccount, startCloudSignIn, useCloudAccountState } from "./account";
import { hasCloudPublicConfig } from "./publicConfig";

export interface AccountMenuItem {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly icon:
    | "person.badge.plus"
    | "person.crop.circle"
    | "person.2"
    | "gearshape"
    | "arrow.uturn.backward";
  readonly destructive?: boolean;
  readonly onPress: () => void;
}

/**
 * Settings and the cloud account behind one header button, as on web: a gear
 * until you sign in, a person after. Null where it is just a Settings button:
 * builds without sign-in, and while the session is still loading.
 */
export interface AccountMenu {
  readonly icon: "gearshape" | "person.crop.circle";
  readonly accessibilityLabel: string;
  readonly title?: string;
  readonly items: ReadonlyArray<AccountMenuItem>;
}

/** Opens the settings sheet on Settings, or straight on Account or Workspaces. */
export function useOpenSettings() {
  const navigation = useNavigation();
  return useCallback(
    (screen: "Settings" | "SettingsAuth" | "SettingsWorkspaces" = "Settings") =>
      screen === "Settings"
        ? navigation.navigate("SettingsSheet", {
            screen: "SettingsContent",
            params: { screen: "Settings" },
          })
        : navigation.navigate("SettingsSheet", { screen }),
    [navigation],
  );
}

export function useAccountMenu(): AccountMenu | null {
  const account = useCloudAccountState();
  const openSettings = useOpenSettings();
  return useMemo(() => {
    if (!hasCloudPublicConfig() || account.status === "loading") return null;
    const settings: AccountMenuItem = {
      id: "settings",
      title: "Settings",
      icon: "gearshape",
      onPress: () => openSettings(),
    };
    if (account.status === "signedOut") {
      return {
        icon: "gearshape",
        accessibilityLabel: "Settings",
        items: [
          {
            id: "sign-in",
            title: "Sign in",
            icon: "person.badge.plus",
            // The Account screen shows the code while the browser sheet asks for it.
            onPress: () => {
              openSettings("SettingsAuth");
              startCloudSignIn();
            },
          },
          settings,
        ],
      };
    }
    const { user } = account;
    const onWaitlist = user.access === "waitlisted" || user.access === "declined";
    return {
      icon: "person.crop.circle",
      accessibilityLabel: user.name || user.email,
      title: user.name || user.email,
      items: [
        {
          id: "account",
          title: "Account",
          subtitle: onWaitlist ? "On the waitlist" : user.email,
          icon: "person.crop.circle",
          onPress: () => openSettings("SettingsAuth"),
        },
        {
          id: "workspaces",
          title: "Workspaces",
          icon: "person.2",
          onPress: () => openSettings("SettingsWorkspaces"),
        },
        settings,
        {
          id: "sign-out",
          title: "Sign out",
          icon: "arrow.uturn.backward",
          destructive: true,
          onPress: () => void signOutCloudAccount(),
        },
      ],
    };
  }, [account, openSettings]);
}

/** The menu as a navigation-bar item, or the plain Settings button. */
export function accountHeaderItem(
  menu: AccountMenu | null,
  openSettings: () => void,
): NativeStackHeaderItem {
  if (!menu) {
    return withNativeGlassHeaderItem({
      type: "button",
      axisBehavior: "horizontalOnly",
      label: "Settings",
      accessibilityLabel: "Open settings",
      icon: { type: "sfSymbol" as const, name: "gearshape" as const },
      onPress: openSettings,
    });
  }
  return withNativeGlassHeaderItem({
    type: "menu",
    axisBehavior: "horizontalOnly",
    label: "",
    accessibilityLabel: menu.accessibilityLabel,
    icon: { type: "sfSymbol" as const, name: menu.icon },
    menu: {
      title: menu.title,
      items: menu.items.map((item) => ({
        type: "action" as const,
        label: item.title,
        description: item.subtitle,
        icon: { type: "sfSymbol" as const, name: item.icon },
        destructive: item.destructive,
        onPress: item.onPress,
      })),
    },
  });
}

/**
 * Wraps an icon button in the account menu, or hands it the Settings press
 * where there is no menu. `renderButton` gets no `onPress` inside the menu,
 * which opens on tap.
 */
export function AccountMenuButton(props: {
  readonly onOpenSettings?: () => void;
  readonly renderButton: (button: {
    readonly icon: AccountMenu["icon"];
    readonly accessibilityLabel: string;
    readonly onPress?: () => void;
  }) => ReactElement;
}) {
  const menu = useAccountMenu();
  const openSettings = useOpenSettings();
  const actions = useMemo<MenuAction[]>(
    () =>
      menu?.items.map((item) => ({
        id: item.id,
        title: item.title,
        subtitle: item.subtitle,
        image: item.icon,
        attributes: item.destructive ? { destructive: true } : undefined,
      })) ?? [],
    [menu],
  );
  if (!menu) {
    return props.renderButton({
      icon: "gearshape",
      accessibilityLabel: "Open settings",
      onPress: props.onOpenSettings ?? (() => openSettings()),
    });
  }
  return (
    <Menu
      title={menu.title}
      actions={actions}
      onPressAction={({ nativeEvent }) =>
        menu.items.find((item) => item.id === nativeEvent.event)?.onPress()
      }
    >
      {props.renderButton({ icon: menu.icon, accessibilityLabel: menu.accessibilityLabel })}
    </Menu>
  );
}
