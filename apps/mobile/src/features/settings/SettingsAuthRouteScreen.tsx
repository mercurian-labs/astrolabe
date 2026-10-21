import { StackActions, useNavigation } from "@react-navigation/native";
import { useLayoutEffect, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import {
  cancelCloudSignIn,
  type CloudAccountUser,
  deleteCloudAccount,
  openCloudAccountSettings,
  openCloudSignInPage,
  signOutCloudAccount,
  startCloudSignIn,
  useCloudAccountState,
} from "../cloud/account";
import { hasCloudPublicConfig } from "../cloud/publicConfig";
import { T3ConnectProfilePage } from "../cloud/T3ConnectProfilePage";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsScreen, SettingsScreenContent } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";

export function SettingsAuthRouteScreen() {
  const navigation = useNavigation();

  useLayoutEffect(() => {
    if (!hasCloudPublicConfig()) {
      navigation.dispatch(StackActions.replace("SettingsContent"));
    }
  }, [navigation]);

  return hasCloudPublicConfig() ? <ConfiguredSettingsAuthRouteScreen /> : null;
}

/**
 * The Astrolabe account: sign in with a device code approved in the browser
 * sheet, then manage the account. Sign-in methods, passkeys and passwords
 * live on app.astrolabe.sh; deletion happens here, as the App Store requires.
 */
function ConfiguredSettingsAuthRouteScreen() {
  const account = useCloudAccountState();
  const insets = useSafeAreaInsets();
  const [showT3Connect, setShowT3Connect] = useState(false);

  if (showT3Connect && account.status === "signedIn") {
    return (
      <View collapsable={false} className="flex-1 bg-sheet">
        <AppBar
          title="T3 Connect"
          sidebar={false}
          onBack={() => setShowT3Connect(false)}
          hideBottomBorder
        />
        <SettingsScreenContent>
          <T3ConnectProfilePage />
        </SettingsScreenContent>
      </View>
    );
  }

  return (
    <SettingsScreen title="Account">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {account.status === "loading" ? (
          <AppActivityIndicator />
        ) : account.status === "signedOut" ? (
          <SignedOutSection deviceSignIn={account.deviceSignIn} />
        ) : (
          <SignedInSections user={account.user} onOpenT3Connect={() => setShowT3Connect(true)} />
        )}
      </ScrollView>
    </SettingsScreen>
  );
}

function SignedOutSection(props: {
  readonly deviceSignIn: { readonly userCode: string; readonly verificationUrl: string } | null;
}) {
  const { deviceSignIn } = props;
  if (!deviceSignIn) {
    return (
      <SettingsSection title="Sign in">
        <SettingsRow
          icon="person.badge.plus"
          label="Sign in"
          value="Reach your machines from anywhere with T3 Connect."
          onPress={startCloudSignIn}
        />
      </SettingsSection>
    );
  }
  return (
    <SettingsSection title="Approve this code">
      <Text
        accessibilityLabel="Sign-in code"
        className="py-4 text-center font-mono text-3xl tracking-widest text-foreground"
      >
        {deviceSignIn.userCode}
      </Text>
      <SettingsRow
        icon="safari"
        label="Open sign-in page"
        value="Astrolabe signs in as soon as you approve."
        onPress={() => openCloudSignInPage(deviceSignIn.verificationUrl)}
      />
      <SettingsRow icon="xmark" label="Cancel" onPress={cancelCloudSignIn} />
    </SettingsSection>
  );
}

function SignedInSections(props: {
  readonly user: CloudAccountUser;
  readonly onOpenT3Connect: () => void;
}) {
  const navigation = useNavigation();
  const { user } = props;
  const onWaitlist = user.access === "waitlisted" || user.access === "declined";
  const closeAccount = () => navigation.dispatch(StackActions.popTo("SettingsContent"));

  const confirmDelete = () => {
    Dialog.alert(
      onWaitlist ? "Leave the waitlist?" : "Delete your Astrolabe account?",
      onWaitlist
        ? "This deletes your account and gives up your place on the list."
        : "This deletes your account, unlinks your machines from T3 Connect, and removes this account from your devices. Organizations you own alone are deleted too. It can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: onWaitlist ? "Leave" : "Delete",
          style: "destructive",
          onPress: () => void deleteAccount(),
        },
      ],
    );
  };

  const deleteAccount = async () => {
    const result = await deleteCloudAccount().catch(
      (): { readonly _tag: "Failed"; readonly message: string } => ({
        _tag: "Failed",
        message: "Check your connection and try again.",
      }),
    );
    switch (result._tag) {
      case "Deleted":
        closeAccount();
        return;
      case "SignInAgain":
        Dialog.alert(
          "Sign in again",
          "For your security, sign in again before deleting your account.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Sign in",
              onPress: () => void signOutCloudAccount().then(startCloudSignIn),
            },
          ],
        );
        return;
      case "OwnsSharedOrganization":
        Dialog.alert(
          "Your account was not deleted",
          "You own an organization with other members. Hand it over or remove them first.",
        );
        return;
      case "Failed":
        Dialog.alert("Your account was not deleted", result.message);
        return;
    }
  };

  return (
    <>
      <SettingsSection title={user.name || user.email}>
        {onWaitlist ? (
          <Text className="px-4 py-3 text-sm text-foreground-muted">
            You're on the waitlist. T3 Connect turns on once your account is approved, and we'll
            email you when it is.
          </Text>
        ) : null}
        <SettingsRow icon="globe" label="T3 Connect" onPress={props.onOpenT3Connect} />
        <SettingsRow
          icon="person.crop.circle"
          label="Manage sign-in methods"
          value={user.email}
          onPress={openCloudAccountSettings}
        />
      </SettingsSection>
      <SettingsSection>
        <SettingsRow
          icon="arrow.uturn.backward"
          label="Sign out"
          onPress={() => {
            closeAccount();
            void signOutCloudAccount();
          }}
        />
        <SettingsRow
          icon="trash"
          label={onWaitlist ? "Leave the waitlist" : "Delete account"}
          onPress={confirmDelete}
        />
      </SettingsSection>
    </>
  );
}
