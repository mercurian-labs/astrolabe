import { T } from "gt-react";

import { createSectionSidebar } from "../sidebar/SectionSidebar";

/** Astrolabe: the Issues section's sidebar; its list is `IssuesPage`'s. */
const sidebar = createSectionSidebar();

export function IssuesSidebar() {
  return <sidebar.Frame title={<T context="page title, list of issues">Issues</T>} />;
}

export const IssuesSidebarPortal = sidebar.Portal;
