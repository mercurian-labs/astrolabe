import type { CatalogEntry } from "./catalog";

type ModuleClassification<Category extends string> = Readonly<{
  category: Category;
  reason: string;
}>;

export type MercurianClassificationCategory =
  | "requires-live-workspace"
  | "composition-shell"
  | "deferred";

export type UiInventoryCategory = "catalogued" | "infrastructure-only" | "unreviewed";

const MERCURIAN_SOURCE_PREFIX = "src/components/mercurian/";
const UI_SOURCE_PREFIX = "src/components/ui/";

export const MERCURIAN_CLASSIFICATIONS: Readonly<
  Record<string, ModuleClassification<MercurianClassificationCategory>>
> = {
  "src/components/mercurian/AddRepositoryDialog.tsx": {
    category: "requires-live-workspace",
    reason:
      "Repository discovery, folder validation, cloning, and persistence all depend on the active environment.",
  },
  "src/components/mercurian/AddRepositoryFlow.tsx": {
    category: "requires-live-workspace",
    reason:
      "Repository discovery, folder validation, cloning, and persistence all depend on the active environment.",
  },
  "src/components/mercurian/ArchivedPlansPanel.tsx": {
    category: "requires-live-workspace",
    reason:
      "Its empty and grouped archive states come from the live Mercurian tree and invoke restore or delete commands.",
  },
  "src/components/mercurian/CodingSessionDraftSheet.tsx": {
    category: "requires-live-workspace",
    reason:
      "The draft resolves environment settings, repositories, branches, and the current planning model before starting a session.",
  },
  "src/components/mercurian/CodingSessionHeader.tsx": {
    category: "requires-live-workspace",
    reason:
      "The header coordinates router links, repository state, thread commands, source control, previews, and scripts.",
  },
  "src/components/mercurian/ConnectTrackerDialog.tsx": {
    category: "requires-live-workspace",
    reason:
      "Submitting the dialog creates a real tracker connection through the active environment state.",
  },
  "src/components/mercurian/ExperimentsSettings.tsx": {
    category: "deferred",
    reason:
      "A future entry should show the development-only experiment rows with their switches off and on.",
  },
  "src/components/mercurian/HostingProvidersSection.tsx": {
    category: "requires-live-workspace",
    reason:
      "Provider standing and refresh behavior are queried from source control for the primary environment.",
  },
  "src/components/mercurian/ImportIssueDialog.tsx": {
    category: "requires-live-workspace",
    reason:
      "Its connection, issue-search, import, and navigation states require live tracker and router data.",
  },
  "src/components/mercurian/ManageProjectRepositoriesDialog.tsx": {
    category: "requires-live-workspace",
    reason:
      "The choices and save action are backed by the environment's repositories and project membership state.",
  },
  "src/components/mercurian/MemoryPage.tsx": {
    category: "requires-live-workspace",
    reason:
      "Project scope, memory designation, index refresh, note reads, and deep-link navigation depend on live workspace and router state.",
  },
  "src/components/mercurian/memoryMarkdown.tsx": {
    category: "composition-shell",
    reason:
      "The renderer is exercised through the catalogued MemoryNoteReader, which supplies link resolution and navigation behavior.",
  },
  "src/components/mercurian/NewProjectDialog.tsx": {
    category: "requires-live-workspace",
    reason:
      "Its repository choices and project creation sequence use the live Mercurian repositories and command state.",
  },
  "src/components/mercurian/PlanMentionSources.tsx": {
    category: "requires-live-workspace",
    reason:
      "This nonvisual search fan-out reads project repositories and performs environment-scoped path searches.",
  },
  "src/components/mercurian/PlanModelPicker.tsx": {
    category: "requires-live-workspace",
    reason:
      "Available planning models and provider resolution come from the primary environment's settings.",
  },
  "src/components/mercurian/PlanTraitsPicker.tsx": {
    category: "requires-live-workspace",
    reason:
      "The depth levels it offers come from the resolved provider instance's live model descriptors.",
  },
  "src/components/mercurian/PlanningSpace.tsx": {
    category: "composition-shell",
    reason:
      "This route-level workspace composes the catalogued timeline, graph, composer, and artifact surfaces rather than owning one isolated state.",
  },
  "src/components/mercurian/PreferencesSettings.tsx": {
    category: "requires-live-workspace",
    reason:
      "Preference values and update commands are supplied by the active environment's settings state.",
  },
  "src/components/mercurian/PublishRepositoryDialog.tsx": {
    category: "requires-live-workspace",
    reason:
      "Publishing requires a real repository, source-control providers, environment commands, and a post-publish refresh.",
  },
  "src/components/mercurian/RepositoriesPage.tsx": {
    category: "requires-live-workspace",
    reason:
      "Its discovery, provider, project-assignment, script, publish, and removal states all derive from the current environment.",
  },
  "src/components/mercurian/RepositoryScriptsDialog.tsx": {
    category: "requires-live-workspace",
    reason:
      "The editor is initialized from a repository record and persists scripts through the environment repository store.",
  },
  "src/components/mercurian/SearchPalette.tsx": {
    category: "requires-live-workspace",
    reason:
      "Search results and actions combine router state, the live Mercurian tree, keybindings, and project creation.",
  },
  "src/components/mercurian/SessionPlanPanel.tsx": {
    category: "requires-live-workspace",
    reason:
      "Loading, empty, and plan-body states are resolved from live plan detail and checkpoint text queries.",
  },
  "src/components/mercurian/SessionPreviewOffer.tsx": {
    category: "requires-live-workspace",
    reason:
      "The offer depends on ports discovered for a real thread and opens them through the active preview environment.",
  },
  "src/components/mercurian/SessionScriptsControl.tsx": {
    category: "requires-live-workspace",
    reason:
      "Script availability and actions coordinate the live terminal, preview environment, and right-panel state.",
  },
  "src/components/mercurian/SettingsEmptyPage.tsx": {
    category: "deferred",
    reason:
      "A future entry should show the icon, title, and explanatory copy for an intentionally empty settings destination.",
  },
  "src/components/mercurian/SettingsNav.tsx": {
    category: "requires-live-workspace",
    reason:
      "Selected destinations, back behavior, and navigation actions are coupled to the application router.",
  },
  "src/components/mercurian/SidebarPlanHoverCard.tsx": {
    category: "deferred",
    reason:
      "A future entry should show the delayed open hover card and its pointer-safe handoff from trigger to popup.",
  },
  "src/components/mercurian/SplitSheet.tsx": {
    category: "deferred",
    reason:
      "A future entry should show atomic, multi-repository split, and already-landed implementation states.",
  },
  "src/components/mercurian/TrackersSettings.tsx": {
    category: "requires-live-workspace",
    reason:
      "Loading, empty, connected, and disconnect states are backed by live tracker connections.",
  },
};

export const UI_CLASSIFICATIONS: Readonly<
  Record<string, ModuleClassification<Exclude<UiInventoryCategory, "catalogued" | "unreviewed">>>
> = {
  "src/components/ui/form.tsx": {
    category: "infrastructure-only",
    reason:
      "This module is a thin semantic and layout wrapper around the Base UI form root, while visible controls live in their own modules.",
  },
};

export function cataloguedMercurianSourcePaths(
  entries: ReadonlyArray<CatalogEntry>,
  modulePaths: ReadonlyArray<string>,
): ReadonlySet<string> {
  const knownModulePaths = new Set(modulePaths);
  const catalogued = new Set<string>();

  for (const entry of entries) {
    if (knownModulePaths.has(entry.sourcePath)) catalogued.add(entry.sourcePath);
    if (entry.group) {
      const groupedPath = `${MERCURIAN_SOURCE_PREFIX}${entry.group}.tsx`;
      if (knownModulePaths.has(groupedPath)) catalogued.add(groupedPath);
    }
  }

  return catalogued;
}

export function declaredMercurianModulePaths(
  entries: ReadonlyArray<CatalogEntry>,
): ReadonlyArray<string> {
  const modulePaths = new Set(Object.keys(MERCURIAN_CLASSIFICATIONS));
  for (const entry of entries) {
    if (entry.sourcePath.startsWith(MERCURIAN_SOURCE_PREFIX) && entry.sourcePath.endsWith(".tsx")) {
      modulePaths.add(entry.sourcePath);
    }
    if (entry.group) modulePaths.add(`${MERCURIAN_SOURCE_PREFIX}${entry.group}.tsx`);
  }
  return [...modulePaths].sort();
}

export type MercurianCoverageRow = Readonly<{
  modulePath: string;
  category: "catalogued" | MercurianClassificationCategory | "unclassified";
  reason?: string;
}>;

export function mercurianCoverageRows(
  entries: ReadonlyArray<CatalogEntry>,
  modulePaths: ReadonlyArray<string>,
): ReadonlyArray<MercurianCoverageRow> {
  const catalogued = cataloguedMercurianSourcePaths(entries, modulePaths);
  return modulePaths.map((modulePath) => {
    if (catalogued.has(modulePath)) return { modulePath, category: "catalogued" };
    const classification = MERCURIAN_CLASSIFICATIONS[modulePath];
    return classification === undefined
      ? { modulePath, category: "unclassified" }
      : { modulePath, ...classification };
  });
}

export type UiInventoryRow = Readonly<{
  modulePath: string;
  category: UiInventoryCategory;
  reason?: string;
}>;

export function declaredUiModulePaths(entries: ReadonlyArray<CatalogEntry>): ReadonlyArray<string> {
  const modulePaths = new Set(Object.keys(UI_CLASSIFICATIONS));
  for (const { sourcePath } of entries) {
    if (sourcePath.startsWith(UI_SOURCE_PREFIX) && sourcePath.endsWith(".tsx")) {
      modulePaths.add(sourcePath);
    }
  }
  return [...modulePaths].sort();
}

export function uiInventoryRows(
  entries: ReadonlyArray<CatalogEntry>,
  modulePaths: ReadonlyArray<string>,
): ReadonlyArray<UiInventoryRow> {
  const knownModulePaths = new Set(modulePaths);
  const catalogued = new Set(
    entries.map(({ sourcePath: path }) => path).filter((path) => knownModulePaths.has(path)),
  );

  return modulePaths.map((modulePath) => {
    if (catalogued.has(modulePath)) return { modulePath, category: "catalogued" };
    const classification = UI_CLASSIFICATIONS[modulePath];
    return classification === undefined
      ? { modulePath, category: "unreviewed" }
      : { modulePath, ...classification };
  });
}
