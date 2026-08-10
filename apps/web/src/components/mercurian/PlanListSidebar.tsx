import { useAtomValue } from "@effect/atom-react";
import { autoAnimate } from "@formkit/auto-animate";
import {
  PlanId,
  THREAD_JUMP_KEYBINDING_COMMANDS,
  type ContextMenuItem,
  type MercurianProject,
  type MercurianProjectId,
  type PlanTreeRow,
} from "@t3tools/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ChevronDownIcon,
  CircleDashedIcon,
  CircleDotIcon,
  FolderIcon,
  FolderPlusIcon,
  GitBranchIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { isCommandPaletteOpen, openCommandPalette } from "../../commandPaletteBus";
import { isElectron } from "../../env";
import { usePlanLifecycleActions } from "../../hooks/usePlanLifecycleActions";
import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
  shouldShowThreadJumpHintsForModifiers,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from "../../keybindings";
import { readLocalApi } from "../../localApi";
import { cn, randomUUID } from "../../lib/utils";
import { usePlanDraftStore, type PlanDraft } from "../../planDraftStore";
import { useShortcutModifierState } from "../../shortcutModifierState";
import { useMarkPlanUnread, useMercurianTree } from "../../state/mercurian";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { SidebarChromeFooter, SidebarChromeHeader } from "../sidebar/SidebarChrome";
import { Menu, MenuItem, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import {
  SidebarContent,
  SidebarGroup,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  buildPlanRowMenuItems,
  resolveAdjacentId,
  resolvePlanRowActions,
  sortProjectsForTree,
  type PlanRowMenuAction,
} from "./ProjectTreeSidebar.logic";
import {
  listJumpTargets,
  pageArchivedPlans,
  partitionSidebarPlans,
  resolveDraftRows,
  resolvePlanCardStatus,
  resolveSidebarSelection,
} from "./PlanListSidebar.logic";
import { ManageProjectRepositoriesDialog } from "./ManageProjectRepositoriesDialog";
import { NewProjectDialog } from "./NewProjectDialog";
import { SettingsNav } from "./SettingsNav";

const ICON_ACTION_BUTTON_CLASS =
  "inline-flex h-6 min-w-6 cursor-pointer items-center justify-center rounded-md px-[calc(--spacing(1)-1px)] text-muted-foreground/60 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring";

const PLAN_ROW_MENU_ICONS: Record<PlanRowMenuAction, ReactNode> = {
  "mark-unread": <CircleDotIcon />,
  archive: <ArchiveIcon />,
  delete: <Trash2Icon />,
};

type ArchivedPlanRowAction = "restore" | "delete";

const ARCHIVED_ROW_MENU_ICONS: Record<ArchivedPlanRowAction, ReactNode> = {
  restore: <ArchiveRestoreIcon />,
  delete: <Trash2Icon />,
};

function compactSidebarTimeLabel(label: string): string {
  if (label === "just now") return "now";
  return label.endsWith(" ago") ? label.slice(0, -4) : label;
}

/** Mercurian's flat plan list, scoped across projects rather than nested under them. */
export default function PlanListSidebar() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const selection = useMemo(() => resolveSidebarSelection(pathname), [pathname]);
  const { snapshot } = useMercurianTree();
  const projects = useMemo(() => sortProjectsForTree(snapshot.projects), [snapshot.projects]);
  const [projectScopeId, setProjectScopeId] = useState<string | null>(null);
  const [archivedPage, setArchivedPage] = useState(0);
  const [isArchivedExpanded, setIsArchivedExpanded] = useState(false);
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [managedProjectId, setManagedProjectId] = useState<MercurianProjectId | null>(null);

  const scopedProject = useMemo(
    () => projects.find((project) => project.projectId === projectScopeId) ?? null,
    [projectScopeId, projects],
  );
  const { active, archived } = useMemo(
    () => partitionSidebarPlans(snapshot.plans, projectScopeId),
    [projectScopeId, snapshot.plans],
  );
  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.projectId, project.name] as const)),
    [projects],
  );
  // Count-only selection: typing inside an existing invested draft updates its
  // row, without repainting every plan card around it.
  const investedDraftCount = usePlanDraftStore(
    (state) => resolveDraftRows(state.draftsById, projectScopeId).length,
  );
  const jumpTargets = useMemo(() => listJumpTargets(active), [active]);
  useTreeJumpShortcuts({ jumpTargets, activePlanId: selection.activePlanId });
  const jumpLabelByPlanId = useJumpHintLabels(jumpTargets);
  const archivedPageRows = useMemo(
    () => pageArchivedPlans(archived, archivedPage),
    [archived, archivedPage],
  );
  const managedProject = useMemo(
    () => projects.find((project) => project.projectId === managedProjectId) ?? null,
    [managedProjectId, projects],
  );

  const handleScopeChange = useCallback((projectId: string | null) => {
    setProjectScopeId(projectId);
    setArchivedPage(0);
  }, []);

  const attachListAutoAnimateRef = useCallback((node: HTMLUListElement | null) => {
    if (!node) return;
    autoAnimate(node, { duration: 150, easing: "ease-out" });
  }, []);

  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      {selection.isSettingsActive ? (
        <SettingsNav pathname={pathname} />
      ) : (
        <SidebarContent
          className="gap-0"
          fixedHeader={
            <PlanListHeader
              projects={projects}
              projectScopeId={projectScopeId}
              scopedProject={scopedProject}
              onProjectScopeChange={handleScopeChange}
              onManageProject={setManagedProjectId}
              onNewProject={() => setIsNewProjectOpen(true)}
            />
          }
        >
          <SidebarGroup className="ps-[calc(var(--sidebar-content-inset)+1px)] pe-[var(--sidebar-content-inset)] pb-1 pt-0">
            <ul ref={attachListAutoAnimateRef} role="list" className="flex flex-col gap-px">
              <PlanDraftBlock
                activeDraftId={selection.activeDraftId}
                projectNameById={projectNameById}
                projectScopeId={projectScopeId}
              />
              {active.map((plan) => (
                <PlanCard
                  key={plan.planId}
                  plan={plan}
                  projectName={projectNameById.get(plan.projectId) ?? "Unknown project"}
                  isActive={selection.activePlanId === plan.planId}
                  jumpLabel={jumpLabelByPlanId.get(plan.planId) ?? null}
                />
              ))}
              {archived.length > 0 ? (
                <ArchivedShelfHeader
                  count={archived.length}
                  expanded={isArchivedExpanded}
                  onToggle={() => setIsArchivedExpanded((expanded) => !expanded)}
                />
              ) : null}
              {isArchivedExpanded
                ? archivedPageRows.visible.map((plan) => (
                    <ArchivedPlanRow
                      key={plan.planId}
                      plan={plan}
                      isActive={selection.activePlanId === plan.planId}
                    />
                  ))
                : null}
              {isArchivedExpanded && archivedPageRows.hiddenCount > 0 ? (
                <li className="list-none">
                  <button
                    type="button"
                    onClick={() => setArchivedPage((page) => page + 1)}
                    className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-sidebar-muted-foreground/55 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                  >
                    <PlusIcon aria-hidden className="size-4 shrink-0" />
                    Show {archivedPageRows.nextPageCount} more
                  </button>
                </li>
              ) : null}
              {projects.length === 0 ? (
                <SidebarEmptyState onAddProject={() => setIsNewProjectOpen(true)}>
                  No projects yet
                </SidebarEmptyState>
              ) : investedDraftCount + active.length + archived.length === 0 ? (
                <SidebarEmptyState>
                  {scopedProject === null
                    ? "No plans yet"
                    : `No plans in ${scopedProject.name} yet`}
                </SidebarEmptyState>
              ) : null}
            </ul>
          </SidebarGroup>
        </SidebarContent>
      )}
      <SidebarChromeFooter
        showUsageRow={false}
        extraRows={<RepositoriesFooterRow isActive={selection.isRepositoriesActive} />}
      />
      <NewProjectDialog open={isNewProjectOpen} onOpenChange={setIsNewProjectOpen} />
      <ManageProjectRepositoriesDialog
        open={managedProject !== null}
        projectId={managedProject?.projectId ?? null}
        projectName={managedProject?.name ?? ""}
        onOpenChange={(open) => {
          if (!open) setManagedProjectId(null);
        }}
      />
    </>
  );
}

function PlanListHeader(props: {
  readonly projects: readonly MercurianProject[];
  readonly projectScopeId: string | null;
  readonly scopedProject: MercurianProject | null;
  readonly onProjectScopeChange: (projectId: string | null) => void;
  readonly onManageProject: (projectId: MercurianProjectId) => void;
  readonly onNewProject: () => void;
}) {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const openDraftForProject = usePlanDraftStore((state) => state.openDraftForProject);
  const [projectScopeMenuOpen, setProjectScopeMenuOpen] = useState(false);
  const searchShortcutLabel = shortcutLabelForCommand(keybindings, "commandPalette.toggle");
  const newPlanShortcutLabel = shortcutLabelForCommand(keybindings, "plan.new");

  const startPlanInProject = useCallback(
    (projectId: string) => {
      if (isMobile) setOpenMobile(false);
      const draft = openDraftForProject(projectId, randomUUID(), new Date().toISOString());
      void navigate({ to: "/plans/draft/$draftId", params: { draftId: draft.draftId } });
    },
    [isMobile, navigate, openDraftForProject, setOpenMobile],
  );

  const handleNewPlan = useCallback(() => {
    const targetProject =
      props.scopedProject ?? (props.projects.length === 1 ? props.projects[0] : null);
    if (targetProject !== null && targetProject !== undefined) {
      startPlanInProject(targetProject.projectId);
      return;
    }
    if (isMobile) setOpenMobile(false);
    openCommandPalette({ open: "new-plan-in" });
  }, [isMobile, props.projects, props.scopedProject, setOpenMobile, startPlanInProject]);

  return (
    <SidebarGroup className="relative z-[1] gap-1 p-[var(--sidebar-content-inset)]">
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => openCommandPalette()}
        >
          <SearchIcon className="size-4 shrink-0 text-sidebar-muted-foreground/80" />
          <span className="min-w-0 flex-1 truncate text-left">Search</span>
          {searchShortcutLabel === null ? null : (
            <span className="shrink-0 font-mono text-[11px] text-sidebar-muted-foreground/60">
              {searchShortcutLabel}
            </span>
          )}
        </button>
        <div className="shrink-0">
          <Tooltip>
            <TooltipTrigger
              render={
                <SidebarMenuButton
                  size="icon"
                  type="button"
                  className="relative focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                  onClick={handleNewPlan}
                  disabled={props.projects.length === 0}
                  aria-label="New plan"
                />
              }
            >
              <SquarePenIcon />
              <span
                className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
                aria-hidden="true"
              />
            </TooltipTrigger>
            <TooltipPopup side="right">
              {newPlanShortcutLabel ? `New plan (${newPlanShortcutLabel})` : "New plan"}
            </TooltipPopup>
          </Tooltip>
        </div>
      </div>
      {props.projects.length > 0 ? (
        <div className="flex items-center gap-1">
          <Menu open={projectScopeMenuOpen} onOpenChange={setProjectScopeMenuOpen}>
            <MenuTrigger
              render={
                <SidebarMenuButton
                  aria-label="Filter plans by project"
                  className="min-w-0 flex-1 ps-[calc(var(--sidebar-row-content-inset)-1px)] focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                />
              }
            >
              <FolderIcon className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {props.scopedProject?.name ?? "All projects"}
              </span>
              <ChevronDownIcon className="-mr-px size-4 shrink-0" />
            </MenuTrigger>
            <MenuPopup align="start" className="w-(--anchor-width)">
              <MenuRadioGroup
                value={props.projectScopeId ?? "all"}
                onValueChange={(value) =>
                  props.onProjectScopeChange(value === "all" ? null : (value as string))
                }
              >
                <MenuRadioItem
                  value="all"
                  closeOnClick
                  className="h-8 min-h-8 px-1 py-0 text-sm font-medium [&>span:last-child]:flex [&>span:last-child]:min-w-0 [&>span:last-child]:items-center [&>span:last-child]:gap-2"
                >
                  <FolderIcon className="size-4 shrink-0" />
                  <span className="min-w-0 truncate text-sm">All projects</span>
                </MenuRadioItem>
                {props.projects.map((project) => (
                  <MenuRadioItem
                    key={project.projectId}
                    value={project.projectId}
                    closeOnClick
                    className="h-8 min-h-8 px-1 py-0 text-sm font-medium [&>span:last-child]:flex [&>span:last-child]:min-w-0 [&>span:last-child]:items-center [&>span:last-child]:gap-2"
                  >
                    <FolderIcon className="size-4 shrink-0" />
                    <span className="min-w-0 truncate text-sm">{project.name}</span>
                    <button
                      type="button"
                      aria-label={`Manage repositories for ${project.name}`}
                      title={`Manage repositories for ${project.name}`}
                      className="ml-auto inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-icon-muted outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setProjectScopeMenuOpen(false);
                        props.onManageProject(project.projectId);
                      }}
                    >
                      <SettingsIcon className="size-3.5" />
                    </button>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuPopup>
          </Menu>
          <Tooltip>
            <TooltipTrigger
              render={
                <SidebarMenuButton
                  size="icon"
                  className="relative shrink-0 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                  onClick={props.onNewProject}
                  type="button"
                  aria-label="New project"
                />
              }
            >
              <FolderPlusIcon />
              <span
                className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
                aria-hidden="true"
              />
            </TooltipTrigger>
            <TooltipPopup side="right">New project</TooltipPopup>
          </Tooltip>
        </div>
      ) : null}
    </SidebarGroup>
  );
}

const PlanDraftBlock = memo(function PlanDraftBlock(props: {
  readonly activeDraftId: string | null;
  readonly projectNameById: ReadonlyMap<string, string>;
  readonly projectScopeId: string | null;
}) {
  const draftsById = usePlanDraftStore((state) => state.draftsById);
  const discardDraft = usePlanDraftStore((state) => state.discardDraft);
  const drafts = useMemo(
    () => resolveDraftRows(draftsById, props.projectScopeId),
    [draftsById, props.projectScopeId],
  );

  if (drafts.length === 0) return null;
  return (
    <>
      {drafts.map((draft) => (
        <PlanDraftRow
          key={draft.draftId}
          draft={draft}
          projectName={props.projectNameById.get(draft.projectId) ?? "Unknown project"}
          isActive={draft.draftId === props.activeDraftId}
          onDiscard={discardDraft}
        />
      ))}
      <li
        aria-hidden
        data-testid="plan-sidebar-draft-divider"
        className="mx-2.5 my-1.5 h-px list-none bg-sidebar-border/60"
      />
    </>
  );
});

const PlanDraftRow = memo(function PlanDraftRow(props: {
  readonly draft: PlanDraft;
  readonly projectName: string;
  readonly isActive: boolean;
  readonly onDiscard: (draftId: string) => void;
}) {
  const navigate = useNavigate();
  const preview = props.draft.text.trim().split("\n", 1)[0] ?? "";
  const activate = useCallback(() => {
    void navigate({
      to: "/plans/draft/$draftId",
      params: { draftId: props.draft.draftId },
    });
  }, [navigate, props.draft.draftId]);

  return (
    <li className="list-none py-0.5">
      <div
        role="button"
        tabIndex={0}
        data-testid="plan-sidebar-draft-row"
        className={cn(
          "group/sidebar-row relative w-full cursor-pointer overflow-hidden rounded-md text-left text-sidebar-foreground outline-none select-none",
          props.isActive
            ? "bg-sidebar-row-active"
            : "bg-amber-400/[0.04] hover:bg-amber-400/[0.08]",
        )}
        onClick={activate}
        onKeyDown={(event) => activateRowFromKeyboard(event, activate)}
      >
        <div className="relative z-10 px-[var(--sidebar-row-content-inset)] py-[var(--sidebar-content-inset)]">
          <div className="flex h-5 min-w-0 items-center gap-1.5">
            <SquarePenIcon
              aria-hidden
              className="size-3 shrink-0 text-amber-600 dark:text-amber-300/80"
            />
            <FolderIcon className="size-4 shrink-0 text-muted-foreground/60" />
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-secondary-label">
              {props.projectName}
            </span>
            <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-end">
              <button
                type="button"
                aria-label={`Discard draft in ${props.projectName}`}
                title="Discard draft"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  props.onDiscard(props.draft.draftId);
                }}
                className="pointer-events-none inline-flex cursor-pointer items-center rounded-md bg-transparent px-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/sidebar-row:pointer-events-auto group-hover/sidebar-row:opacity-100 max-sm:pointer-events-auto max-sm:opacity-100"
              >
                <XIcon className="size-3" />
              </button>
            </span>
          </div>
          <div className="mt-0.5 truncate text-sm font-medium text-foreground/90">{preview}</div>
        </div>
      </div>
    </li>
  );
});

const PlanCard = memo(function PlanCard(props: {
  readonly plan: PlanTreeRow;
  readonly projectName: string;
  readonly isActive: boolean;
  readonly jumpLabel: string | null;
}) {
  const navigate = useNavigate();
  const markPlanUnread = useMarkPlanUnread();
  const { archivePlan, deletePlan } = usePlanLifecycleActions();
  const cardStatus = resolvePlanCardStatus(props.plan);
  const items = useMemo(() => buildPlanRowMenuItems(props.plan), [props.plan]);
  const activate = useCallback(() => {
    void navigate({ to: "/plans/$planId", params: { planId: props.plan.planId } });
  }, [navigate, props.plan.planId]);

  const runAction = useCallback(
    async (action: PlanRowMenuAction) => {
      const planId = PlanId.make(props.plan.planId);
      if (action === "mark-unread") {
        await markPlanUnread(planId);
      } else if (action === "archive") {
        await archivePlan(planId);
      } else {
        await deletePlan(planId);
      }
    },
    [archivePlan, deletePlan, markPlanUnread, props.plan.planId],
  );

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      const api = readLocalApi();
      if (api === undefined) return;
      event.preventDefault();
      void (async () => {
        const clicked = await api.contextMenu.show(items, {
          x: event.clientX,
          y: event.clientY,
        });
        if (clicked !== null) await runAction(clicked);
      })();
    },
    [items, runAction],
  );

  return (
    <li className="list-none py-0.5 [content-visibility:auto] [contain-intrinsic-size:auto_64px]">
      <div
        role="button"
        tabIndex={0}
        data-testid="plan-sidebar-card"
        className={cn(
          "group/sidebar-row relative w-full cursor-pointer overflow-hidden rounded-md text-left outline-none select-none",
          props.isActive
            ? "bg-sidebar-row-active text-sidebar-foreground"
            : "bg-transparent text-sidebar-foreground hover:bg-sidebar-row-hover",
        )}
        onClick={activate}
        onKeyDown={(event) => activateRowFromKeyboard(event, activate)}
        onContextMenu={handleContextMenu}
      >
        <div className="relative z-10 px-[var(--sidebar-row-content-inset)] py-[var(--sidebar-content-inset)]">
          <div className="flex h-5 min-w-0 items-center gap-1.5">
            <FolderIcon className="size-4 shrink-0 text-muted-foreground/60" />
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-secondary-label">
              {props.projectName}
            </span>
            <span className="group/sidebar-status-slot relative ml-auto flex h-5 min-w-8 shrink-0 items-stretch justify-end text-xs">
              <span className="pointer-events-none self-center justify-self-end tabular-nums text-secondary-label transition-opacity group-focus-within/sidebar-row:absolute group-focus-within/sidebar-row:right-0 group-focus-within/sidebar-row:opacity-0 group-hover/sidebar-row:absolute group-hover/sidebar-row:right-0 group-hover/sidebar-row:opacity-0 max-sm:absolute max-sm:right-0 max-sm:opacity-0">
                <PlanCardStatusLabel status={cardStatus.slot} updatedAt={props.plan.updatedAt} />
              </span>
              <span className="pointer-events-none absolute inset-y-0 right-0 flex items-stretch opacity-0 transition-opacity group-focus-within/sidebar-row:pointer-events-auto group-focus-within/sidebar-row:static group-focus-within/sidebar-row:opacity-100 group-hover/sidebar-row:pointer-events-auto group-hover/sidebar-row:static group-hover/sidebar-row:opacity-100 max-sm:pointer-events-auto max-sm:static max-sm:opacity-100">
                <button
                  type="button"
                  aria-label={`Archive ${props.plan.title}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void runAction("archive");
                  }}
                  className="-mr-0.5 inline-flex cursor-pointer items-center gap-1 rounded-md bg-transparent px-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ArchiveIcon className="size-3.5" />
                  Archive
                </button>
                <PlanRowMenu title={props.plan.title} items={items} runAction={runAction} />
              </span>
            </span>
          </div>
          <div className="mt-1 flex min-w-0">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                cardStatus.unread
                  ? "font-semibold text-foreground"
                  : "font-medium text-foreground/90",
              )}
            >
              {props.plan.title}
            </span>
          </div>
        </div>
        {props.jumpLabel === null ? null : <JumpHintBadge label={props.jumpLabel} />}
      </div>
    </li>
  );
});

function PlanCardStatusLabel(props: {
  readonly status: "awaiting-input" | "working" | null;
  readonly updatedAt: string;
}) {
  if (props.status === "working") {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-sky-600 opacity-75 dark:text-sky-400">
        <CircleDashedIcon aria-hidden className="size-4 shrink-0" />
        <span role="status">Working</span>
      </span>
    );
  }
  if (props.status === "awaiting-input") {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-indigo-600 dark:text-indigo-300">
        <span role="status">Input</span>
      </span>
    );
  }
  return compactSidebarTimeLabel(formatRelativeTimeLabel(props.updatedAt));
}

function PlanRowMenu(props: {
  readonly title: string;
  readonly items: readonly ContextMenuItem<PlanRowMenuAction>[];
  readonly runAction: (action: PlanRowMenuAction) => Promise<void>;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label={`Actions for ${props.title}`}
            className={cn(ICON_ACTION_BUTTON_CLASS, "h-full")}
            onClick={(event) => event.stopPropagation()}
          />
        }
      >
        <MoreHorizontalIcon className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="end" side="bottom">
        {props.items.map((item) => (
          <MenuItem
            key={item.id}
            variant={item.destructive === true ? "destructive" : "default"}
            onClick={(event) => {
              event.stopPropagation();
              void props.runAction(item.id);
            }}
          >
            {PLAN_ROW_MENU_ICONS[item.id]}
            <span>{item.label}</span>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

function ArchivedShelfHeader(props: {
  readonly count: number;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <li className="list-none">
      <button
        type="button"
        onClick={props.onToggle}
        aria-expanded={props.expanded}
        data-testid="plan-sidebar-archived-shelf-toggle"
        className="mb-1 mt-3 flex w-full cursor-pointer items-center gap-2 px-2.5 text-left"
      >
        <span className="text-xs font-medium text-muted-foreground/50">
          {props.expanded ? "Archived" : `Archived (${props.count})`}
        </span>
        <span className="h-px flex-1 bg-sidebar-border/60" />
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-3 text-muted-foreground/50 transition-transform",
            props.expanded && "rotate-180",
          )}
        />
      </button>
    </li>
  );
}

const ArchivedPlanRow = memo(function ArchivedPlanRow(props: {
  readonly plan: PlanTreeRow;
  readonly isActive: boolean;
}) {
  const navigate = useNavigate();
  const { unarchivePlan, deletePlan } = usePlanLifecycleActions();
  const items = useMemo<readonly ContextMenuItem<ArchivedPlanRowAction>[]>(
    () => [
      { id: "restore", label: "Restore" },
      ...(resolvePlanRowActions(props.plan).canDelete
        ? ([{ id: "delete", label: "Delete", destructive: true }] as const)
        : []),
    ],
    [props.plan],
  );
  const activate = useCallback(() => {
    void navigate({ to: "/plans/$planId", params: { planId: props.plan.planId } });
  }, [navigate, props.plan.planId]);
  const runAction = useCallback(
    async (action: ArchivedPlanRowAction) => {
      const planId = PlanId.make(props.plan.planId);
      if (action === "restore") await unarchivePlan(planId);
      else await deletePlan(planId);
    },
    [deletePlan, props.plan.planId, unarchivePlan],
  );
  const handleContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      const api = readLocalApi();
      if (api === undefined) return;
      event.preventDefault();
      void (async () => {
        const clicked = await api.contextMenu.show(items, {
          x: event.clientX,
          y: event.clientY,
        });
        if (clicked !== null) await runAction(clicked);
      })();
    },
    [items, runAction],
  );
  const archivedAt = props.plan.archivedAt ?? props.plan.createdAt;

  return (
    <li className="list-none [content-visibility:auto] [contain-intrinsic-size:auto_34px]">
      <div
        role="button"
        tabIndex={0}
        data-testid="plan-sidebar-archived-row"
        className={cn(
          "group/sidebar-row relative flex h-9 w-full cursor-pointer items-center gap-2.5 overflow-hidden rounded-md px-2.5 text-left text-sidebar-muted-foreground/75 outline-none select-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
          props.isActive && "bg-sidebar-row-active text-sidebar-foreground",
        )}
        onClick={activate}
        onKeyDown={(event) => activateRowFromKeyboard(event, activate)}
        onContextMenu={handleContextMenu}
      >
        <span
          className={cn(
            "shrink-0 transition-opacity",
            !props.isActive && "opacity-40 group-hover/sidebar-row:opacity-100",
          )}
        >
          <FolderIcon className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-normal text-secondary-label group-hover/sidebar-row:text-foreground">
          {props.plan.title}
        </span>
        <span className="relative ml-auto flex h-6 min-w-8 shrink-0 items-center justify-end">
          <span className="inline-flex justify-end text-xs tabular-nums text-secondary-label transition-opacity group-focus-within/sidebar-row:opacity-0 group-hover/sidebar-row:opacity-0 max-sm:opacity-0">
            {compactSidebarTimeLabel(formatRelativeTimeLabel(archivedAt))}
          </span>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-stretch opacity-0 transition-opacity group-focus-within/sidebar-row:pointer-events-auto group-focus-within/sidebar-row:opacity-100 group-hover/sidebar-row:pointer-events-auto group-hover/sidebar-row:opacity-100 max-sm:pointer-events-auto max-sm:opacity-100">
            <button
              type="button"
              aria-label={`Restore ${props.plan.title}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void runAction("restore");
              }}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-transparent px-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArchiveRestoreIcon className="size-3.5" />
              Restore
            </button>
            <Menu>
              <MenuTrigger
                render={
                  <button
                    type="button"
                    aria-label={`Actions for ${props.plan.title}`}
                    className={cn(ICON_ACTION_BUTTON_CLASS, "h-full")}
                    onClick={(event) => event.stopPropagation()}
                  />
                }
              >
                <MoreHorizontalIcon className="size-3.5" />
              </MenuTrigger>
              <MenuPopup align="end" side="bottom">
                {items.map((item) => (
                  <MenuItem
                    key={item.id}
                    variant={item.destructive === true ? "destructive" : "default"}
                    onClick={(event) => {
                      event.stopPropagation();
                      void runAction(item.id);
                    }}
                  >
                    {ARCHIVED_ROW_MENU_ICONS[item.id]}
                    <span>{item.label}</span>
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          </span>
        </span>
      </div>
    </li>
  );
});

function SidebarEmptyState(props: {
  readonly children: ReactNode;
  readonly onAddProject?: (() => void) | undefined;
}) {
  return (
    <li className="flex list-none flex-col items-center gap-2 px-2 py-6 text-center text-xs text-muted-foreground/60">
      <span>{props.children}</span>
      {props.onAddProject === undefined ? null : (
        <button
          type="button"
          onClick={props.onAddProject}
          className="inline-flex items-center gap-1.5 rounded-md border border-sidebar-border px-2.5 py-1 text-[11px] font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
        >
          <PlusIcon className="-mx-0.5 size-3" />
          Add project
        </button>
      )}
    </li>
  );
}

function RepositoriesFooterRow({ isActive }: { readonly isActive: boolean }) {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        onClick={() => {
          if (isMobile) setOpenMobile(false);
          void navigate({ to: "/repositories" });
        }}
      >
        <GitBranchIcon />
        <span>Repositories</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function activateRowFromKeyboard(event: ReactKeyboardEvent, activate: () => void) {
  if ((event.target as HTMLElement).closest("button, a, input")) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  activate();
}

/** Digits and bracket traversal over visible active cards only. */
function useTreeJumpShortcuts(input: {
  readonly jumpTargets: readonly string[];
  readonly activePlanId: string | null;
}) {
  const navigate = useNavigate();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { activePlanId, jumpTargets } = input;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || isCommandPaletteOpen()) return;
      const command = resolveShortcutCommand(event, keybindings, {
        platform: navigator.platform,
      });
      const goTo = (planId: string | null) => {
        if (planId === null) return;
        event.preventDefault();
        event.stopPropagation();
        void navigate({ to: "/plans/$planId", params: { planId } });
      };
      const direction = threadTraversalDirectionFromCommand(command);
      if (direction !== null) {
        goTo(resolveAdjacentId({ ids: jumpTargets, currentId: activePlanId, direction }));
        return;
      }
      const jumpIndex = threadJumpIndexFromCommand(command ?? "");
      if (jumpIndex !== null) goTo(jumpTargets[jumpIndex] ?? null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePlanId, jumpTargets, keybindings, navigate]);
}

function useJumpHintLabels(jumpTargets: readonly string[]): ReadonlyMap<string, string> {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const modifiers = useShortcutModifierState();
  const shouldShow = shouldShowThreadJumpHintsForModifiers(modifiers, keybindings, {
    platform: navigator.platform,
  });
  return useMemo(
    () =>
      shouldShow
        ? new Map(
            jumpTargets
              .slice(0, THREAD_JUMP_KEYBINDING_COMMANDS.length)
              .map((planId, index) => [planId, String(index + 1)] as const),
          )
        : new Map<string, string>(),
    [jumpTargets, shouldShow],
  );
}

function JumpHintBadge({ label }: { readonly label: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute end-1.5 top-1/2 z-10 inline-flex h-5 -translate-y-1/2 items-center rounded-full border border-border/80 bg-background/95 px-1.5 font-mono text-[10px] font-medium tracking-tight text-foreground shadow-sm"
    >
      {label}
    </span>
  );
}
