import { type NavigationTab } from "./navigation-tab-order";
import { NativeStackScreenOptions } from "../../../native/StackHeader";
import { RepositoriesScreen } from "../../repositories/RepositoriesScreen";
import { UsageRouteScreen } from "../../usage/UsageRouteScreen";
import { WorkflowsScreen } from "../../workflows/WorkflowsScreen";

export function WorkspaceExtraTab(props: {
  tab: Exclude<NavigationTab, "threads" | "pullRequests" | "issues">;
}) {
  // Astrolabe: Projects is a list with its own search, like Agents and Changes.
  if (props.tab === "repositories") return <RepositoriesScreen />;
  return (
    <>
      <NativeStackScreenOptions options={{ headerSearchBarOptions: undefined }} />
      {props.tab === "workflows" ? <WorkflowsScreen /> : <UsageRouteScreen workspace />}
    </>
  );
}
