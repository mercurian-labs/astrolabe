/* oxlint-disable t3code/no-untranslated-copy -- Astrolabe-only copy, shipped in English. */
import { createSectionSidebar } from "../sidebar/SectionSidebar";

/** Astrolabe: the Changes section's sidebar (pull requests and the wikis' change requests). */
const sidebar = createSectionSidebar();

export function PullRequestsSidebar() {
  return <sidebar.Frame title="Changes" />;
}

export const PullRequestsSidebarPortal = sidebar.Portal;
