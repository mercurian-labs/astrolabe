import { projectKindStore, type ProjectKind } from "../projects/projectFilter";

/**
 * Astrolabe: which kind of project the Change Requests section lists when no one project is
 * picked: all, every repository's pull requests, or every wiki's change requests. Kept on the
 * device beside the list's other preferences; the project picked lives in the route, the wiki
 * picked in `changeRequestWikiScope`.
 */
export type ChangeRequestKind = ProjectKind;

export const changeRequestKindStore = projectKindStore("astrolabe:change-request-kind:v1");

export const useChangeRequestKind = changeRequestKindStore.useValue;
