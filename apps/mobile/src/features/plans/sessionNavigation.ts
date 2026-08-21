import { CommonActions, StackActions, type NavigationAction } from "@react-navigation/native";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

interface SessionNavigationDispatcher {
  readonly dispatch: (action: NavigationAction) => void;
}

export function navigateToCodingSession(
  navigation: SessionNavigationDispatcher,
  input: { readonly environmentId: EnvironmentId | string; readonly threadId: ThreadId | string },
  options?: { readonly replace?: boolean },
): void {
  const params = {
    environmentId: String(input.environmentId),
    threadId: String(input.threadId),
  };
  navigation.dispatch(
    options?.replace === true
      ? StackActions.replace("Session", params)
      : CommonActions.navigate({ name: "Session", params }),
  );
}
