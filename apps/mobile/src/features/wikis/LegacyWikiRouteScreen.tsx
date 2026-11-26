/* oxlint-disable t3code/no-untranslated-copy -- Astrolabe-only copy, shipped in English. */
import { useAtomSet } from "@effect/atom-react";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { parseProjectRootId, type EnvironmentId, type WikiId } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { LoadingScreen } from "../../components/LoadingScreen";
import { useEnvironmentQuery } from "../../state/query";
import { repositoryScopeAtom } from "../../state/repositories";
import { wikiEnvironment } from "../../state/wiki";
import { useWorkspaceTabs } from "../layout/workspace/WorkspaceTabsContext";
import { legacyWikiRedirect, type LegacyWikiParams } from "./wikiRoutes";

/**
 * Astrolabe: an old wiki link, kept working for one release. The server still knows each old
 * wiki's id, so its index says which project root it became; the document opens there, and a
 * change request, or a wiki it can't find, lands on Projects.
 */
export function LegacyWikiRouteScreen({ route }: StaticScreenProps<LegacyWikiParams>) {
  const navigation = useNavigation();
  const workspace = useWorkspaceTabs();
  const setScope = useAtomSet(repositoryScopeAtom);
  const { params } = route;
  const environmentId = params.environmentId as EnvironmentId;
  const known = parseProjectRootId(params.wikiId) !== null;
  const index = useEnvironmentQuery(
    known
      ? null
      : wikiEnvironment.index({ environmentId, input: { wikiId: params.wikiId as WikiId } }),
  );
  const settled = known || index.data !== null || index.error !== null;
  const redirect = settled ? legacyWikiRedirect(params, index.data?.wikiId ?? null) : null;
  const redirected = useRef(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a link resolved on the server replaces this screen in the native stack
  useEffect(() => {
    if (redirect === null || redirected.current) return;
    redirected.current = true;
    if (redirect.kind === "document") {
      navigation.dispatch(StackActions.replace("ProjectDocument", redirect.params));
      return;
    }
    if (redirect.projectId !== null) setScope(`${params.environmentId}:${redirect.projectId}`);
    workspace?.dispatch({ type: "select", tab: "repositories" });
    navigation.dispatch(StackActions.popToTop());
  }, [redirect, navigation, workspace, setScope, params.environmentId]);

  return <LoadingScreen message="Opening…" />;
}
