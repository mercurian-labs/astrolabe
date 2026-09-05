import { useAtomValue } from "@effect/atom-react";
import { MercurianProjectId, type MercurianProject, type PlanTreeRow } from "@t3tools/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  BookOpenIcon,
  CircleDotIcon,
  FolderIcon,
  FolderPlusIcon,
  GitBranchIcon,
  PaletteIcon,
  ScrollTextIcon,
  SettingsIcon,
  SquarePenIcon,
} from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";

import { onOpenCommandPalette } from "../../commandPaletteBus";
import {
  composerDraftHasUserContent,
  DraftId,
  useComposerDraftStore,
} from "../../composerDraftStore";
import { useDesignLabOverridesStore } from "../../designLabOverrides";
import { resolveShortcutCommand, threadJumpIndexFromCommand } from "../../keybindings";
import { isTerminalFocused } from "../../lib/terminalFocus";
import { useNewMercurianThreadHandler } from "../../hooks/useHandleNewMercurianThread";
import { useProjectScopeStore } from "../../projectScopeStore";
import { useMercurianTree } from "../../state/mercurian";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useMemorySourceForProject, useReadMemoryIndex } from "../../state/mercurianMemory";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import {
  ADDON_ICON_CLASS,
  enumerateCommandPaletteItems,
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
  type CommandPaletteGroup,
  type CommandPaletteSubmenuItem,
} from "../CommandPalette.logic";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { CommandPaletteResults } from "../CommandPaletteResults";
import { CommandDialog, CommandDialogPopup } from "../ui/command";
import { ImportIssueDialog } from "./ImportIssueDialog";
import { NewProjectDialog } from "./NewProjectDialog";
import { PlanStatusDot } from "./PlanStatusDot";
import {
  partitionPlansByLifecycle,
  resolvePlanRowStatus,
  sortPlansNewestFirst,
  sortProjectsForTree,
} from "./planListing.logic";
import {
  buildSearchPaletteGroups,
  composeEmptyQueryPlanRows,
  filterSearchPaletteGroups,
  noteItemValue,
  planItemValue,
  projectItemValue,
  resolveCurrentProjectId,
  resolveProjectPick,
  SEARCH_PALETTE_SECTIONS,
  type SearchPaletteResult,
} from "./SearchPalette.logic";

interface PaletteDraft {
  readonly draftId: DraftId;
  readonly projectId: string;
  readonly prompt: string;
  readonly createdAt: string;
}

type PaletteResult =
  | SearchPaletteResult<PlanTreeRow, MercurianProject, { readonly name: string }>
  | { readonly kind: "draft"; readonly draft: PaletteDraft };

/**
 * The Search Palette: one chord, from anywhere, over everything you can go to
 * and what you can start.
 *
 * It is an overlay rather than a panel, which is the whole reason it works with
 * the sidebar collapsed — nothing about it lives in the tree except the search
 * row that opens it. Picking always lands on work: a project resolves to a thread
 * before it navigates, never to a container.
 */
export function SearchPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  // The chord and the bus both mean "start a thread, ask me where" when there is
  // no project to assume. The palette opens straight into the picker.
  const [openInProjectPicker, setOpenInProjectPicker] = useState(false);
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [importDialog, setImportDialog] = useState<{
    readonly projectId: MercurianProjectId | null;
    readonly open: boolean;
  }>({ projectId: null, open: false });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const pathname = useLocation({ select: (location) => location.pathname });
  const { snapshot } = useMercurianTree();
  const environmentId = usePrimaryEnvironmentId();
  const draftThreadsByThreadKey = useComposerDraftStore((state) => state.draftThreadsByThreadKey);
  const draftsByThreadKey = useComposerDraftStore((state) => state.draftsByThreadKey);
  const newMercurianThread = useNewMercurianThreadHandler();

  const activePlans = useMemo(
    () => partitionPlansByLifecycle(snapshot.plans).active,
    [snapshot.plans],
  );
  const mercurianProjectIdByOrchestrationProjectId = useMemo(
    () =>
      new Map(
        snapshot.projects.flatMap((project) =>
          project.orchestrationProjectId == null
            ? []
            : [[String(project.orchestrationProjectId), String(project.projectId)] as const],
        ),
      ),
    [snapshot.projects],
  );
  const drafts = useMemo<PaletteDraft[]>(
    () =>
      Object.entries(draftThreadsByThreadKey).flatMap(([draftId, session]) => {
        if (session.promotedTo != null || session.environmentId !== environmentId) return [];
        const projectId = mercurianProjectIdByOrchestrationProjectId.get(session.projectId);
        const composer = draftsByThreadKey[draftId];
        if (projectId === undefined || !composerDraftHasUserContent(composer)) return [];
        return [
          {
            draftId: DraftId.make(draftId),
            projectId,
            prompt: composer?.prompt ?? "",
            createdAt: session.createdAt,
          },
        ];
      }),
    [
      draftThreadsByThreadKey,
      draftsByThreadKey,
      environmentId,
      mercurianProjectIdByOrchestrationProjectId,
    ],
  );
  const draftProjectIdById = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(draftThreadsByThreadKey).flatMap(([draftId, session]) => {
          if (session.promotedTo != null || session.environmentId !== environmentId) return [];
          const projectId = mercurianProjectIdByOrchestrationProjectId.get(session.projectId);
          return projectId === undefined ? [] : [[draftId, projectId]];
        }),
      ),
    [draftThreadsByThreadKey, environmentId, mercurianProjectIdByOrchestrationProjectId],
  );
  const currentProjectId = useMemo(
    () => resolveCurrentProjectId({ pathname, plans: activePlans, draftProjectIdById }),
    [activePlans, draftProjectIdById, pathname],
  );

  const startPlanInProject = useCallback(
    (projectId: string) => {
      const project = snapshot.projects.find((candidate) => candidate.projectId === projectId);
      if (project !== undefined) void newMercurianThread(project);
    },
    [newMercurianThread, snapshot.projects],
  );

  const startNewPlan = useCallback(() => {
    if (currentProjectId !== null) {
      setOpen(false);
      startPlanInProject(currentProjectId);
      return;
    }
    setOpenInProjectPicker(true);
    setOpen(true);
  }, [currentProjectId, startPlanInProject]);

  const openImportDialog = useCallback((projectId: string) => {
    setImportDialog({ projectId: MercurianProjectId.make(projectId), open: true });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: { terminalFocus: isTerminalFocused() },
      });
      if (command === "commandPalette.toggle") {
        event.preventDefault();
        event.stopPropagation();
        setOpenInProjectPicker(false);
        setOpen((wasOpen) => !wasOpen);
        return;
      }
      if (command === "plan.new") {
        event.preventDefault();
        event.stopPropagation();
        startNewPlan();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keybindings, startNewPlan]);

  useEffect(
    () =>
      onOpenCommandPalette((detail) => {
        setOpenInProjectPicker(detail.open === "new-plan-in");
        setOpen(true);
      }),
    [],
  );

  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen}>
        {open ? (
          <CommandDialogPopup
            aria-label="Search palette"
            className="overflow-hidden p-0"
            data-command-palette="true"
            data-testid="search-palette"
            onBackdropPointerDown={() => setOpen(false)}
          >
            <SearchPaletteDialog
              openInProjectPicker={openInProjectPicker}
              plans={activePlans}
              drafts={drafts}
              projects={snapshot.projects}
              currentProjectId={currentProjectId}
              setOpen={setOpen}
              startPlanInProject={startPlanInProject}
              openImportDialog={openImportDialog}
              openNewProjectDialog={() => setIsNewProjectOpen(true)}
            />
          </CommandDialogPopup>
        ) : null}
      </CommandDialog>
      {importDialog.projectId === null ? null : (
        <ImportIssueDialog
          open={importDialog.open}
          projectId={importDialog.projectId}
          onOpenChange={(open) => setImportDialog((current) => ({ ...current, open }))}
          onImported={(planId) => {
            void navigate({ to: "/threads/$planId", params: { planId } });
          }}
        />
      )}
      <NewProjectDialog open={isNewProjectOpen} onOpenChange={setIsNewProjectOpen} />
    </>
  );
}

function SearchPaletteDialog(props: {
  readonly openInProjectPicker: boolean;
  readonly plans: ReadonlyArray<PlanTreeRow>;
  readonly drafts: ReadonlyArray<PaletteDraft>;
  readonly projects: ReadonlyArray<MercurianProject>;
  readonly currentProjectId: string | null;
  readonly setOpen: (open: boolean) => void;
  readonly startPlanInProject: (projectId: string) => void;
  readonly openImportDialog: (projectId: string) => void;
  readonly openNewProjectDialog: () => void;
}) {
  const { openNewProjectDialog, setOpen, startPlanInProject } = props;
  const navigate = useNavigate();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [highlightedItemValue, setHighlightedItemValue] = useState<string | null>(null);
  // One level deep is all this palette needs: the project pickers behind the
  // creation and import actions. The stack shape is the fork's so a second view
  // costs nothing.
  const [pickerGroups, setPickerGroups] = useState<ReadonlyArray<CommandPaletteGroup> | null>(null);
  const projectScopeId = useProjectScopeStore((state) => state.projectScopeId);
  const scopedProject =
    props.projects.find((project) => project.projectId === projectScopeId) ?? null;
  const memorySource = useMemorySourceForProject(scopedProject?.projectId ?? null);
  const readMemoryIndex = useReadMemoryIndex();
  const [memoryNoteNames, setMemoryNoteNames] = useState<ReadonlyArray<string>>([]);

  useEffect(() => {
    if (scopedProject === null || memorySource === null) {
      setMemoryNoteNames([]);
      return;
    }
    let active = true;
    void readMemoryIndex(scopedProject.projectId).then((result) => {
      if (active) setMemoryNoteNames(result.ok ? result.value.notes.map((note) => note.name) : []);
    });
    return () => {
      active = false;
    };
  }, [memorySource, readMemoryIndex, scopedProject]);

  const projectNameById = useMemo(
    () =>
      new Map<string, string>(
        props.projects.map((project) => [project.projectId, project.name] as const),
      ),
    [props.projects],
  );
  const plansByProject = useMemo(() => {
    const grouped = new Map<string, PlanTreeRow[]>();
    for (const plan of props.plans) {
      const existing = grouped.get(plan.projectId);
      if (existing === undefined) {
        grouped.set(plan.projectId, [plan]);
      } else {
        existing.push(plan);
      }
    }
    return grouped;
  }, [props.plans]);

  const runResult = useCallback(
    (result: PaletteResult): void => {
      switch (result.kind) {
        case "draft":
          void navigate({
            to: "/threads/draft/$draftId",
            params: { draftId: result.draft.draftId },
          });
          return;
        case "plan":
          void navigate({ to: "/threads/$planId", params: { planId: result.plan.planId } });
          return;
        case "project": {
          const pick = resolveProjectPick(plansByProject.get(result.project.projectId) ?? []);
          if (pick.kind === "open-plan") {
            void navigate({ to: "/threads/$planId", params: { planId: pick.planId } });
            return;
          }
          startPlanInProject(result.project.projectId);
          return;
        }
        case "note":
          void navigate({ to: "/memory", search: { note: result.note.name } });
          return;
        case "section":
          void navigate({
            to:
              result.section === "memory"
                ? "/memory"
                : result.section === "repositories"
                  ? "/repositories"
                  : "/settings",
          });
          return;
        case "action":
          if (result.action === "new-project") {
            openNewProjectDialog();
            return;
          }
          if (result.action === "open-settings") {
            void navigate({ to: "/settings" });
            return;
          }
          // "New thread" with a project in hand never asks; without one it does,
          // which is the picker below rather than a run.
          if (props.currentProjectId !== null) {
            startPlanInProject(props.currentProjectId);
          }
          return;
      }
    },
    [navigate, openNewProjectDialog, plansByProject, props.currentProjectId, startPlanInProject],
  );

  const projectPickerItems = useMemo<CommandPaletteActionItem[]>(
    () =>
      sortProjectsForTree(props.projects).map((project) => ({
        kind: "action",
        value: `new-plan-in:${project.projectId}`,
        searchTerms: [project.name],
        title: project.name,
        icon: <FolderIcon className={ITEM_ICON_CLASS} />,
        run: async () => {
          startPlanInProject(project.projectId);
        },
      })),
    [props.projects, startPlanInProject],
  );

  const projectPickerGroups = useMemo<ReadonlyArray<CommandPaletteGroup>>(
    () => [{ value: "projects", label: "New thread in", items: projectPickerItems }],
    [projectPickerItems],
  );

  const importProjectPickerGroups = useMemo<ReadonlyArray<CommandPaletteGroup>>(
    () => [
      {
        value: "projects",
        label: "Import into",
        items: sortProjectsForTree(props.projects).map((project) => ({
          kind: "action",
          value: `import-issue-into:${project.projectId}`,
          searchTerms: [project.name],
          title: project.name,
          icon: <FolderIcon className={ITEM_ICON_CLASS} />,
          run: async () => props.openImportDialog(project.projectId),
        })),
      },
    ],
    [props.openImportDialog, props.projects],
  );

  const actionItems = useMemo<
    ReadonlyArray<CommandPaletteActionItem | CommandPaletteSubmenuItem>
  >(() => {
    const newPlanBase = {
      value: "action:new-plan",
      searchTerms: ["New thread", "create thread", "start"],
      title: "New thread",
      icon: <SquarePenIcon className={ITEM_ICON_CLASS} />,
    } as const;

    const newPlan: CommandPaletteActionItem | CommandPaletteSubmenuItem =
      props.currentProjectId !== null
        ? {
            ...newPlanBase,
            kind: "action",
            description: projectNameById.get(props.currentProjectId),
            run: async () => runResult({ kind: "action", action: "new-plan" }),
          }
        : {
            ...newPlanBase,
            kind: "submenu",
            addonIcon: <SquarePenIcon className={ADDON_ICON_CLASS} />,
            groups: projectPickerGroups,
            // Nowhere to put a thread yet: "New project" sits right beneath.
            ...(props.projects.length === 0 ? { disabled: true } : {}),
          };

    const importIssueBase = {
      value: "action:import-issue",
      searchTerms: ["Import from a tracker", "import issue", "tracker"],
      title: "Import from a tracker",
      icon: <CircleDotIcon className={ITEM_ICON_CLASS} />,
    } as const;

    const importProjectId = props.currentProjectId;
    const importIssue: CommandPaletteActionItem | CommandPaletteSubmenuItem =
      importProjectId !== null
        ? {
            ...importIssueBase,
            kind: "action",
            description: projectNameById.get(importProjectId),
            run: async () => props.openImportDialog(importProjectId),
          }
        : {
            ...importIssueBase,
            kind: "submenu",
            addonIcon: <CircleDotIcon className={ADDON_ICON_CLASS} />,
            groups: importProjectPickerGroups,
            ...(props.projects.length === 0 ? { disabled: true } : {}),
          };

    return [
      newPlan,
      importIssue,
      {
        kind: "action",
        value: "action:new-project",
        searchTerms: ["New project", "create project", "add project"],
        title: "New project",
        icon: <FolderPlusIcon className={ITEM_ICON_CLASS} />,
        run: async () => runResult({ kind: "action", action: "new-project" }),
      },
      {
        kind: "action",
        value: "action:open-settings",
        searchTerms: ["Open settings", "preferences", "keybindings"],
        title: "Open settings",
        icon: <SettingsIcon className={ITEM_ICON_CLASS} />,
        run: async () => runResult({ kind: "action", action: "open-settings" }),
      },
      ...(import.meta.env.DEV
        ? [
            {
              kind: "action" as const,
              value: "action:design-lab",
              searchTerms: ["design lab", "axes", "catalog"],
              title: "Open Design Lab",
              icon: <PaletteIcon className={ITEM_ICON_CLASS} />,
              run: async () => {
                await navigate({
                  to: "/design-lab",
                  search: useDesignLabOverridesStore.getState().lastLabLocation ?? {},
                });
              },
            },
          ]
        : []),
    ];
  }, [
    importProjectPickerGroups,
    projectNameById,
    projectPickerGroups,
    props.currentProjectId,
    props.openImportDialog,
    props.projects.length,
    navigate,
    runResult,
  ]);

  const planItems = useMemo<CommandPaletteActionItem[]>(() => {
    // The empty query's order is also the source order typing ranks against,
    // so urgency stays the tiebreak between equally good matches.
    const ordered =
      query.trim().length === 0
        ? composeEmptyQueryPlanRows(props.plans)
        : sortPlansNewestFirst(props.plans);

    return ordered.map((plan) => {
      const projectName = projectNameById.get(plan.projectId) ?? "";
      const status = resolvePlanRowStatus(plan);
      return {
        kind: "action",
        value: planItemValue(plan.planId),
        searchTerms: [plan.title, projectName],
        title: plan.title,
        description: projectName,
        timestamp: formatRelativeTimeLabel(plan.updatedAt),
        icon: <ScrollTextIcon className={ITEM_ICON_CLASS} />,
        ...(status === null ? {} : { titleLeadingContent: <PlanStatusDot status={status} /> }),
        run: async () => runResult({ kind: "plan", plan, projectName }),
      };
    });
  }, [projectNameById, props.plans, query, runResult]);

  const draftItems = useMemo<CommandPaletteActionItem[]>(
    () =>
      props.drafts
        .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((draft) => {
          const projectName = projectNameById.get(draft.projectId) ?? "";
          const firstLine = draft.prompt.trim().split("\n", 1)[0] ?? "";
          return {
            kind: "action",
            value: `draft:${draft.draftId}`,
            searchTerms: [firstLine, projectName, "draft"],
            title: firstLine.length > 0 ? firstLine : "Draft with attachments",
            description: projectName,
            timestamp: formatRelativeTimeLabel(draft.createdAt),
            icon: <SquarePenIcon className={ITEM_ICON_CLASS} />,
            run: async () => runResult({ kind: "draft", draft }),
          };
        }),
    [projectNameById, props.drafts, runResult],
  );

  const projectItems = useMemo<CommandPaletteActionItem[]>(
    () =>
      sortProjectsForTree(props.projects).map((project) => ({
        kind: "action",
        value: projectItemValue(project.projectId),
        searchTerms: [project.name],
        title: project.name,
        icon: <FolderIcon className={ITEM_ICON_CLASS} />,
        run: async () => runResult({ kind: "project", project }),
      })),
    [props.projects, runResult],
  );

  const noteItems = useMemo<CommandPaletteActionItem[]>(
    () =>
      query.trim().length === 0
        ? []
        : memoryNoteNames.map((name) => ({
            kind: "action",
            value: noteItemValue(name),
            searchTerms: [name, "memory note"],
            title: name,
            description: scopedProject?.name,
            icon: <BookOpenIcon className={ITEM_ICON_CLASS} />,
            run: async () => runResult({ kind: "note", note: { name } }),
          })),
    [memoryNoteNames, query, runResult, scopedProject?.name],
  );

  const sectionItems = useMemo<CommandPaletteActionItem[]>(
    () =>
      SEARCH_PALETTE_SECTIONS.map((section) => ({
        kind: "action",
        value: `section:${section.section}`,
        searchTerms: [...section.searchTerms],
        title: section.label,
        icon:
          section.section === "memory" ? (
            <BookOpenIcon className={ITEM_ICON_CLASS} />
          ) : section.section === "repositories" ? (
            <GitBranchIcon className={ITEM_ICON_CLASS} />
          ) : (
            <SettingsIcon className={ITEM_ICON_CLASS} />
          ),
        run: async () => runResult({ kind: "section", section: section.section }),
      })),
    [runResult],
  );

  const rootGroups = useMemo(
    () =>
      buildSearchPaletteGroups({
        actionItems,
        planItems: [...draftItems, ...planItems],
        projectItems,
        noteItems,
        sectionItems,
      }),
    [actionItems, draftItems, noteItems, planItems, projectItems, sectionItems],
  );

  const activeGroups = pickerGroups ?? rootGroups;
  const displayedGroups = useMemo(() => {
    const filtered = filterSearchPaletteGroups({ groups: activeGroups, query: deferredQuery });
    // The digits name what you are looking at, so they are assigned after
    // filtering — a hint that points at a row you cannot see is a lie.
    return filtered.map((group) =>
      group.value === "plans"
        ? {
            ...group,
            items: enumerateCommandPaletteItems(
              group.items.filter(
                (item): item is CommandPaletteActionItem => item.kind === "action",
              ),
            ),
          }
        : group,
    );
  }, [activeGroups, deferredQuery]);

  const openProjectPicker = useCallback(() => {
    setPickerGroups(projectPickerGroups);
    setHighlightedItemValue(null);
    setQuery("");
  }, [projectPickerGroups]);

  // The chord that means "new thread" with no project in hand opens straight into
  // the picker; the palette is the question.
  useEffect(() => {
    if (!props.openInProjectPicker || props.projects.length === 0) return;
    openProjectPicker();
  }, [openProjectPicker, props.openInProjectPicker, props.projects.length]);

  const executeItem = useCallback(
    (item: CommandPaletteActionItem | CommandPaletteSubmenuItem): void => {
      if (item.disabled) return;
      if (item.kind === "submenu") {
        setPickerGroups(item.groups);
        setHighlightedItemValue(null);
        setQuery("");
        return;
      }
      setOpen(false);
      void item.run();
    },
    [setOpen],
  );

  const popView = useCallback(() => {
    setPickerGroups(null);
    setHighlightedItemValue(null);
    setQuery("");
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    const command = resolveShortcutCommand(event, keybindings, {
      platform: navigator.platform,
    });
    if (threadJumpIndexFromCommand(command ?? "") === null) return;
    const matchingItem = displayedGroups
      .flatMap((group) => group.items)
      .find((item) => item.shortcutCommand === command);
    if (!matchingItem) return;
    event.preventDefault();
    event.stopPropagation();
    executeItem(matchingItem);
  }

  const isInPicker = pickerGroups !== null;

  return (
    <CommandPaletteContent
      key={isInPicker ? "picker" : "root"}
      aria-label="Search palette"
      inputProps={{
        placeholder: isInPicker
          ? "Which project?"
          : "Search threads, projects, and actions...  (> for actions)",
        ...(isInPicker
          ? {
              wrapperClassName: "[&_[data-slot=autocomplete-start-addon]]:pointer-events-auto",
              startAddon: (
                <button
                  type="button"
                  className="flex cursor-pointer items-center"
                  aria-label="Back"
                  onClick={popView}
                >
                  <ArrowLeftIcon />
                </button>
              ),
            }
          : {}),
        onKeyDown: handleKeyDown,
      }}
      mode="none"
      onItemHighlighted={(value) => {
        setHighlightedItemValue(typeof value === "string" ? value : null);
      }}
      onValueChange={setQuery}
      panelClassName="max-h-[min(28rem,70vh)]"
      showBackHint={isInPicker}
      value={query}
    >
      <CommandPaletteResults
        emptyStateMessage={
          deferredQuery.startsWith(">") ? "No matching actions." : "Nothing matches that."
        }
        groups={displayedGroups}
        highlightedItemValue={highlightedItemValue}
        isActionsOnly={deferredQuery.startsWith(">")}
        keybindings={keybindings}
        onExecuteItem={executeItem}
      />
    </CommandPaletteContent>
  );
}
