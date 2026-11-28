import type {
  EnvironmentId,
  IssueTrackerConnectionList,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { resolveIssueLinkTarget } from "@t3tools/client-runtime/issue-links";
import type { MouseEvent } from "react";

import { showIssue } from "../components/issue/issueWorkspace";
import { PULL_REQUESTS_PANEL_REF, useRightPanelStore } from "../rightPanelStore";
import { useProjects, useServerConfigs } from "../state/entities";

/**
 * Opens an issue link beside the thread, and says whether it did. Anything else — a host no
 * project here is on, a link that merely looks like one — is left alone for the caller to handle
 * as the ordinary link it is. Mirrors `useOpenChangeRequestLink`: a reader following a link the
 * agent wrote is reading the thread, and should still be reading it afterwards.
 */
export function useOpenIssueLink(
  threadRef?: ScopedThreadRef,
  panelRef?: ScopedThreadRef,
): (
  event: Pick<
    MouseEvent<HTMLElement>,
    "preventDefault" | "stopPropagation" | "metaKey" | "ctrlKey"
  >,
  targetUrl: string,
  targetEnvironmentId?: EnvironmentId,
  trackers?: IssueTrackerConnectionList,
) => boolean {
  const allProjects = useProjects();
  const serverConfigs = useServerConfigs();
  return (event, targetUrl, targetEnvironmentId, trackers) => {
    if (event.metaKey || event.ctrlKey) return false;
    const resolvedPanelRef = panelRef ?? threadRef;
    // A list page's panel ref is a placeholder, not an environment; the link names its own.
    const environmentId = threadRef?.environmentId ?? targetEnvironmentId;
    if (resolvedPanelRef === undefined || environmentId === undefined) return false;
    if (serverConfigs.get(environmentId)?.environment.capabilities.issues !== true) return false;
    const target = resolveIssueLinkTarget({
      url: targetUrl,
      projects: allProjects.filter((project) => project.environmentId === environmentId),
      trackers,
    });
    if (target === null) return false;
    event.preventDefault();
    event.stopPropagation();
    const surface = {
      projectId: target.ref.projectId,
      tracker: target.ref.tracker,
      ...(target.ref.host === undefined ? {} : { host: target.ref.host }),
      scope: target.ref.scope,
      key: target.ref.key,
      url: targetUrl,
    };
    // Astrolabe: off a thread (a pull request's or issue's tab) the issue shows in the shared
    // panes' tab in front, as a pull request link does there.
    if (resolvedPanelRef === PULL_REQUESTS_PANEL_REF) {
      showIssue({ ...surface, environmentId }, "replace");
      return true;
    }
    useRightPanelStore.getState().openIssue(resolvedPanelRef, {
      ...(resolvedPanelRef.environmentId === environmentId ? {} : { environmentId }),
      ...surface,
    });
    return true;
  };
}
