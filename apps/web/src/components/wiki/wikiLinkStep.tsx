import { AuthSourceControlWriteScope } from "@t3tools/contracts";
import type { EnvironmentId, ProjectId, WikiId } from "@t3tools/contracts";
import { BookOpenIcon, FolderGit2Icon, XIcon } from "lucide-react";

import { readEnvironmentScope } from "~/state/session";
import { wikiEnvironment } from "~/state/wiki";
import { ITEM_ICON_CLASS, type CommandPaletteGroup } from "../CommandPalette.logic";
import { useRepositories } from "../repositories/useRepositories";
import { useWikiCommand, useWikiOverviews } from "./wikiEnvironment";

/** What was just added, so the palette can offer to link it: a repository to a wiki, or back. */
export type WikiLinkStep =
  | {
      readonly kind: "repository";
      readonly environmentId: EnvironmentId;
      readonly projectId: ProjectId;
      readonly title: string;
    }
  | {
      readonly kind: "wiki";
      readonly environmentId: EnvironmentId;
      readonly wikiId: WikiId;
      readonly name: string;
    };

export const WIKI_LINK_GROUP = "wiki-link";

/**
 * Astrolabe: the step after adding a repository or a wiki, which offers to link it to a wiki or a
 * repository on the same server. `offers` says whether there is anything to link it to.
 */
export function useWikiLinkStep() {
  const { overviews } = useWikiOverviews();
  const repositories = useRepositories();
  const link = useWikiCommand(wikiEnvironment.setProjectLink, "Failed to link");
  const candidates = (step: WikiLinkStep) =>
    step.kind === "repository"
      ? overviews
          .filter((overview) => overview.environmentId === step.environmentId)
          .map((overview) => ({
            key: overview.wiki.wikiId,
            title: overview.wiki.name,
            wikiId: overview.wiki.wikiId,
            projectId: step.projectId,
          }))
      : repositories
          .filter((repository) => repository.environmentId === step.environmentId)
          .map((repository) => ({
            key: repository.id,
            title: repository.title,
            wikiId: step.wikiId,
            projectId: repository.id,
          }));

  return {
    offers: (step: WikiLinkStep) =>
      readEnvironmentScope(step.environmentId, AuthSourceControlWriteScope) &&
      candidates(step).length > 0,
    group: (step: WikiLinkStep): CommandPaletteGroup => {
      const Icon = step.kind === "repository" ? BookOpenIcon : FolderGit2Icon;
      return {
        value: WIKI_LINK_GROUP,
        label:
          step.kind === "repository"
            ? `Link ${step.title} to a wiki, where its research and plans live`
            : `Link ${step.name} to the repository it plans`,
        items: [
          ...candidates(step).map((candidate) => ({
            kind: "action" as const,
            value: `action:wiki-link:${candidate.key}`,
            searchTerms: [candidate.title],
            title: candidate.title,
            icon: <Icon className={ITEM_ICON_CLASS} />,
            run: async () => {
              await link({
                environmentId: step.environmentId,
                input: { wikiId: candidate.wikiId, projectId: candidate.projectId, linked: true },
              });
            },
          })),
          {
            kind: "action" as const,
            value: "action:wiki-link:skip",
            searchTerms: ["not now", "skip"],
            title: "Not now",
            description: "Link it later in its settings",
            icon: <XIcon className={ITEM_ICON_CLASS} />,
            run: async () => {},
          },
        ],
      };
    },
  };
}
