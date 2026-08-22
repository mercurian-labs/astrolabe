import { type StaticScreenProps } from "@react-navigation/native";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useMemo } from "react";

import { useMercurianTree } from "../../state/mercurian";
import { ThreadRouteScreen } from "../threads/ThreadRouteScreen";
import { CodingSessionScreenProvider } from "./SessionScreenContext";

type Props = StaticScreenProps<{
  readonly environmentId: string;
  readonly threadId: string;
}>;

export function CodingSessionScreen(props: Props) {
  const environmentId = EnvironmentId.make(props.route.params.environmentId);
  const threadId = ThreadId.make(props.route.params.threadId);
  const tree = useMercurianTree(environmentId);
  const owningPlan =
    tree.snapshot.plans.find((plan) =>
      plan.codingSessions.some((session) => session.threadId === threadId),
    ) ?? null;
  const sessionRecord =
    owningPlan?.codingSessions.find((session) => session.threadId === threadId) ?? null;
  const context = useMemo(
    () => ({
      planId: owningPlan?.planId ?? null,
      planTitle: owningPlan?.title ?? "Sessions",
      sessionRecord,
    }),
    [owningPlan?.planId, owningPlan?.title, sessionRecord],
  );

  return (
    <CodingSessionScreenProvider value={context}>
      <ThreadRouteScreen {...props} />
    </CodingSessionScreenProvider>
  );
}
