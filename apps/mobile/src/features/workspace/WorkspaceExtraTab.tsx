import { type NavigationTab } from "./navigation-tab-order";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { RepositoriesScreen } from "../repositories/RepositoriesScreen";
import { UsageRouteScreen } from "../usage/UsageRouteScreen";
import { WikisScreen } from "../wikis/WikisScreen";

export function WorkspaceExtraTab(props: {
  tab: Exclude<NavigationTab, "threads" | "pullRequests">;
}) {
  // Astrolabe: Wikis and Projects are lists with their own search, like Agents and Changes.
  if (props.tab === "wikis") return <WikisScreen />;
  if (props.tab === "repositories") return <RepositoriesScreen />;
  return (
    <>
      <NativeStackScreenOptions options={{ headerSearchBarOptions: undefined }} />
      <UsageRouteScreen workspace />
    </>
  );
}
