import { useAtomValue } from "@effect/atom-react";
import {
  PlanId,
  THREAD_JUMP_KEYBINDING_COMMANDS,
  type MercurianProjectId,
} from "@t3tools/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  ArchiveIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleDotIcon,
  FolderGit2Icon,
  FolderPlusIcon,
  GitBranchIcon,
  MoreHorizontalIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  Trash2Icon,
} from "lucide-react";
import type { ReactNode } from "react";
import { memo, useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";

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
import { useClientSettings } from "../../hooks/useSettings";
import { cn, randomUUID } from "../../lib/utils";
import { usePlanDraftStore } from "../../planDraftStore";
import { useShortcutModifierState } from "../../shortcutModifierState";
import { useMarkPlanUnread, useMercurianTree } from "../../state/mercurian";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { resolveMercurianProjectExpanded, useUiStateStore } from "../../uiStateStore";
import { SidebarChromeFooter, SidebarChromeHeader } from "../sidebar/SidebarChrome";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  buildPlanRowMenuItems,
  enumerateJumpTargets,
  getVisiblePlansForProject,
  groupPlansByProject,
  partitionPlansByLifecycle,
  resolveAdjacentId,
  resolvePlanRowClassName,
  resolvePlanRowStatus,
  resolveProjectRowClassName,
  resolveRollupStatus,
  resolveTreeSelection,
  resolveWorkspaceRowClassName,
  sortProjectsForTree,
  type PlanRowMenuAction,
  type TreeSelection,
} from "./ProjectTreeSidebar.logic";
import { ManageProjectRepositoriesDialog } from "./ManageProjectRepositoriesDialog";
import { NewProjectDialog } from "./NewProjectDialog";
import { PlanStatusDot } from "./PlanStatusDot";
import { SettingsNav } from "./SettingsNav";

/**
 * The popup's icons, keyed by the same ids the native menu carries. The
 * platform menu draws its own chrome, so this is the popup's business alone.
 */
const PLAN_ROW_MENU_ICONS: Record<PlanRowMenuAction, ReactNode> = {
  "mark-unread": <CircleDotIcon />,
  archive: <ArchiveIcon />,
  delete: <Trash2Icon />,
};

const selectPlanPreviewCount = (settings: { readonly sidebarPlanPreviewCount: number }) =>
  settings.sidebarPlanPreviewCount;

const ICON_ACTION_BUTTON_CLASS =
  "inline-flex h-6 min-w-6 cursor-pointer items-center justify-center rounded-md px-[calc(--spacing(1)-1px)] text-muted-foreground/60 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring";

/**
 * The left sidebar: the project tree, then Workspace.
 *
 * Rows in the tree are projects and the plans nested under them. Coding
 * sessions are the designed third level and are absent because none exist
 * yet — the row model deliberately does not pre-build an empty level.
 */
export default function ProjectTreeSidebar() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const selection = useMemo(() => resolveTreeSelection(pathname), [pathname]);
  const { snapshot } = useMercurianTree();
  const expandedById = useUiStateStore((state) => state.mercurianProjectExpandedById);
  const planPreviewCount = useClientSettings(selectPlanPreviewCount);
  // Lifted out of the rows: one computation feeds both what is drawn and what
  // the digits jump to, so a keycap can never point at a row that is not there.
  // Still deliberately forgotten between visits — a glance, not a preference.
  const [planListExpandedByProjectId, setPlanListExpandedByProjectId] = useState<
    Record<string, boolean>
  >({});
  const togglePlanList = useCallback((projectId: string) => {
    setPlanListExpandedByProjectId((expanded) => ({
      ...expanded,
      [projectId]: !(expanded[projectId] ?? false),
    }));
  }, []);

  const projects = useMemo(() => sortProjectsForTree(snapshot.projects), [snapshot.projects]);
  // The tree is the active listing. An archived plan is not destroyed, just
  // gone from here — Settings → Archived is where it waits.
  const plansByProject = useMemo(
    () => groupPlansByProject(partitionPlansByLifecycle(snapshot.plans).active),
    [snapshot.plans],
  );

  const { visiblePlansByProjectId, projectsWithHiddenPlans } = useMemo(() => {
    const visible = new Map<string, ProjectTreePlan[]>();
    const withHidden = new Set<string>();
    for (const project of projects) {
      const { visiblePlans, hasHiddenPlans } = getVisiblePlansForProject({
        plans: plansByProject.get(project.projectId) ?? [],
        activePlanId: selection.activePlanId,
        isPlanListExpanded: planListExpandedByProjectId[project.projectId] ?? false,
        previewLimit: planPreviewCount,
      });
      visible.set(project.projectId, visiblePlans);
      if (hasHiddenPlans) withHidden.add(project.projectId);
    }
    return { visiblePlansByProjectId: visible, projectsWithHiddenPlans: withHidden };
  }, [
    planListExpandedByProjectId,
    planPreviewCount,
    plansByProject,
    projects,
    selection.activePlanId,
  ]);

  const jumpTargets = useMemo(
    () =>
      enumerateJumpTargets({
        projects,
        visiblePlansByProjectId,
        isProjectExpanded: (projectId) => resolveMercurianProjectExpanded(expandedById, projectId),
      }),
    [expandedById, projects, visiblePlansByProjectId],
  );

  useTreeJumpShortcuts({ jumpTargets, activePlanId: selection.activePlanId });
  const jumpLabelByPlanId = useJumpHintLabels(jumpTargets);

  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      {selection.isSettingsActive ? (
        // Settings takes the panel over while you are in it, and the tree
        // returns when you leave.
        <SettingsNav pathname={pathname} />
      ) : (
        <SidebarContent>
          <SearchEntryRow />
          <ProjectTree
            selection={selection}
            projects={projects}
            plansByProject={plansByProject}
            visiblePlansByProjectId={visiblePlansByProjectId}
            projectsWithHiddenPlans={projectsWithHiddenPlans}
            planListExpandedByProjectId={planListExpandedByProjectId}
            onTogglePlanList={togglePlanList}
            jumpLabelByPlanId={jumpLabelByPlanId}
          />
          <WorkspaceGroup selection={selection} />
        </SidebarContent>
      )}
      <SidebarChromeFooter showSettingsRow={false} />
    </>
  );
}

/**
 * The digits and the bracket pair, over the rows that open a place.
 *
 * Mounted with the tree rather than with the rows, so it keeps working while
 * Settings has taken the panel over and while the sidebar is collapsed off
 * screen — the chords are muscle memory, not a property of what is visible.
 * Events the palette has already claimed are left alone: with the overlay open,
 * digits belong to its rows.
 */
function useTreeJumpShortcuts(input: {
  readonly jumpTargets: readonly string[];
  readonly activePlanId: string | null;
}) {
  const navigate = useNavigate();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { activePlanId, jumpTargets } = input;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (isCommandPaletteOpen()) return;

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
      if (jumpIndex === null) return;
      goTo(jumpTargets[jumpIndex] ?? null);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePlanId, jumpTargets, keybindings, navigate]);
}

/**
 * The keycaps, while the modifier is held and only then. The predicate is the
 * fork's: the held modifiers have to match a jump binding exactly, so adding
 * Shift or Alt hides the overlay rather than promising a chord that does
 * something else.
 */
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

/**
 * Floats at the row's right edge while the modifier is held. An overlay pill,
 * not an inline slot: the hint must not displace the timestamp or shift a
 * single row when it appears.
 */
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

/**
 * The way into the palette for people who reach for the pointer. The overlay
 * itself owes nothing to the sidebar — this row is an affordance, and the chord
 * beside it says so.
 */
function SearchEntryRow() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const shortcutLabel = shortcutLabelForCommand(keybindings, "commandPalette.toggle");

  return (
    <SidebarGroup className="pb-0">
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <button
              type="button"
              className={cn(
                resolveWorkspaceRowClassName({ isActive: false }),
                "flex items-center gap-2",
              )}
              onClick={() => openCommandPalette()}
            >
              <SearchIcon className="size-4 shrink-0 opacity-70" />
              <span className="flex-1 truncate">Search…</span>
              {shortcutLabel === null ? null : (
                <span className="shrink-0 font-mono text-[11px] text-sidebar-muted-foreground/60">
                  {shortcutLabel}
                </span>
              )}
            </button>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function ProjectTree(props: {
  readonly selection: TreeSelection;
  readonly projects: ReadonlyArray<{
    readonly projectId: MercurianProjectId;
    readonly name: string;
  }>;
  readonly plansByProject: ReadonlyMap<string, ProjectTreePlan[]>;
  readonly visiblePlansByProjectId: ReadonlyMap<string, ProjectTreePlan[]>;
  readonly projectsWithHiddenPlans: ReadonlySet<string>;
  readonly planListExpandedByProjectId: Readonly<Record<string, boolean>>;
  readonly onTogglePlanList: (projectId: string) => void;
  readonly jumpLabelByPlanId: ReadonlyMap<string, string>;
}) {
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);

  return (
    <SidebarGroup>
      <div className="flex items-center justify-between pe-1">
        <SidebarGroupLabel>Projects</SidebarGroupLabel>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="New project"
                className={ICON_ACTION_BUTTON_CLASS}
                onClick={() => setIsNewProjectOpen(true)}
              >
                <FolderPlusIcon className="size-3.5" />
              </button>
            }
          />
          <TooltipPopup side="bottom">New project</TooltipPopup>
        </Tooltip>
      </div>
      <SidebarGroupContent>
        {props.projects.length === 0 ? (
          <Empty className="gap-2 p-4 text-left">
            <EmptyHeader>
              <EmptyTitle className="text-sm font-medium">No projects yet</EmptyTitle>
              <EmptyDescription className="text-xs">
                A project is where plans live. Create one to start planning.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <SidebarMenu>
            {props.projects.map((project) => (
              <ProjectTreeRow
                key={project.projectId}
                projectId={project.projectId}
                name={project.name}
                plans={props.plansByProject.get(project.projectId) ?? EMPTY_PLANS}
                visiblePlans={props.visiblePlansByProjectId.get(project.projectId) ?? EMPTY_PLANS}
                hasHiddenPlans={props.projectsWithHiddenPlans.has(project.projectId)}
                isPlanListExpanded={props.planListExpandedByProjectId[project.projectId] ?? false}
                onTogglePlanList={props.onTogglePlanList}
                activePlanId={props.selection.activePlanId}
                jumpLabelByPlanId={props.jumpLabelByPlanId}
              />
            ))}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
      <NewProjectDialog open={isNewProjectOpen} onOpenChange={setIsNewProjectOpen} />
    </SidebarGroup>
  );
}

const EMPTY_PLANS: ProjectTreePlan[] = [];

interface ProjectTreePlan {
  readonly planId: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly hasPendingInput: boolean;
  readonly isWorking: boolean;
  readonly visitedAt?: string | undefined;
  readonly hasPublishedCommits: boolean;
}

interface ProjectTreeRowProps {
  readonly projectId: MercurianProjectId;
  readonly name: string;
  readonly plans: ReadonlyArray<ProjectTreePlan>;
  readonly visiblePlans: ReadonlyArray<ProjectTreePlan>;
  readonly hasHiddenPlans: boolean;
  readonly isPlanListExpanded: boolean;
  readonly onTogglePlanList: (projectId: string) => void;
  readonly activePlanId: string | null;
  readonly jumpLabelByPlanId: ReadonlyMap<string, string>;
}

const ProjectTreeRow = memo(function ProjectTreeRow({
  projectId,
  name,
  plans,
  visiblePlans,
  hasHiddenPlans,
  isPlanListExpanded,
  onTogglePlanList,
  activePlanId,
  jumpLabelByPlanId,
}: ProjectTreeRowProps) {
  const navigate = useNavigate();
  const expandedById = useUiStateStore((state) => state.mercurianProjectExpandedById);
  const setExpanded = useUiStateStore((state) => state.setMercurianProjectExpanded);
  const openDraftForProject = usePlanDraftStore((state) => state.openDraftForProject);
  const [isRepositoriesOpen, setIsRepositoriesOpen] = useState(false);

  const isExpanded = resolveMercurianProjectExpanded(expandedById, projectId);
  const containsSelection =
    activePlanId !== null && plans.some((plan) => plan.planId === activePlanId);

  /**
   * Collapsed, a project speaks for its plans; expanded, they speak for
   * themselves. Rolling up under an open project would say the same thing
   * twice.
   */
  const rollupStatus = useMemo(
    () => (isExpanded ? null : resolveRollupStatus(plans.map(resolvePlanRowStatus))),
    [isExpanded, plans],
  );

  const handleNewPlan = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();
      const draft = openDraftForProject(projectId, randomUUID(), new Date().toISOString());
      void navigate({ to: "/plans/draft/$draftId", params: { draftId: draft.draftId } });
    },
    [navigate, openDraftForProject, projectId],
  );

  const handleManageRepositories = useCallback((event: MouseEvent) => {
    event.stopPropagation();
    setIsRepositoriesOpen(true);
  }, []);

  return (
    <SidebarMenuItem>
      <div className="group/project-header relative flex items-center">
        <button
          type="button"
          className={cn(
            resolveProjectRowClassName({ containsSelection }),
            "flex items-center gap-1 pe-8",
          )}
          aria-expanded={isExpanded}
          onClick={() => setExpanded(projectId, !isExpanded)}
        >
          {isExpanded ? (
            <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
          ) : (
            <ChevronRightIcon className="size-3.5 shrink-0 opacity-60" />
          )}
          <span className="truncate">{name}</span>
          {rollupStatus === null ? null : <PlanStatusDot status={rollupStatus} />}
        </button>
        <div className="absolute end-0.5 top-1/2 flex -translate-y-1/2 items-center opacity-0 transition-opacity duration-150 group-hover/project-header:opacity-100 group-focus-within/project-header:opacity-100 max-sm:opacity-100">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={`Repositories for ${name}`}
                  className={ICON_ACTION_BUTTON_CLASS}
                  onClick={handleManageRepositories}
                >
                  <FolderGit2Icon className="size-3.5" />
                </button>
              }
            />
            <TooltipPopup side="top">Repositories</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={`New plan in ${name}`}
                  className={ICON_ACTION_BUTTON_CLASS}
                  onClick={handleNewPlan}
                >
                  <SquarePenIcon className="size-3.5" />
                </button>
              }
            />
            <TooltipPopup side="top">New plan</TooltipPopup>
          </Tooltip>
        </div>
      </div>

      <ManageProjectRepositoriesDialog
        open={isRepositoriesOpen}
        projectId={projectId}
        projectName={name}
        onOpenChange={setIsRepositoriesOpen}
      />

      {isExpanded ? (
        <SidebarMenuSub className="mx-0.5 my-0 w-full translate-x-0 gap-0.5 border-l-0 px-1 py-0">
          {plans.length === 0 ? (
            <SidebarMenuSubItem className="w-full">
              <div className="flex h-8 w-full items-center px-2 text-left text-xs text-sidebar-muted-foreground/75">
                <span>No plans yet</span>
              </div>
            </SidebarMenuSubItem>
          ) : null}
          {visiblePlans.map((plan) => (
            <PlanTreeRow
              key={plan.planId}
              plan={plan}
              isActive={plan.planId === activePlanId}
              jumpLabel={jumpLabelByPlanId.get(plan.planId) ?? null}
            />
          ))}
          {hasHiddenPlans ? (
            <SidebarMenuSubItem className="w-full">
              <SidebarMenuSubButton
                render={<button type="button" />}
                size="sm"
                className="h-8 w-full translate-x-0 justify-start px-2 text-left text-xs text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                onClick={() => onTogglePlanList(projectId)}
              >
                <span>{isPlanListExpanded ? "Show less" : "Show more"}</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ) : null}
        </SidebarMenuSub>
      ) : null}
    </SidebarMenuItem>
  );
});

/**
 * One plan row, and the one menu it answers to.
 *
 * The verbs come from `buildPlanRowMenuItems` and are shown two ways, never
 * two lists: the platform's own context menu where there is one, and a popup
 * the row owns everywhere else. The web app has no context-menu primitive —
 * `readLocalApi()` is undefined outside the desktop shell — so without the
 * popup these acts would exist on desktop only, and archive and delete are not
 * desktop features.
 */
const PlanTreeRow = memo(function PlanTreeRow({
  plan,
  isActive,
  jumpLabel,
}: {
  readonly plan: ProjectTreePlan;
  readonly isActive: boolean;
  readonly jumpLabel: string | null;
}) {
  const navigate = useNavigate();
  const markPlanUnread = useMarkPlanUnread();
  const { archivePlan, deletePlan } = usePlanLifecycleActions();
  const status = resolvePlanRowStatus(plan);
  const items = useMemo(() => buildPlanRowMenuItems(plan), [plan]);

  const runAction = useCallback(
    async (action: PlanRowMenuAction) => {
      const planId = PlanId.make(plan.planId);
      if (action === "mark-unread") {
        await markPlanUnread(planId);
        return;
      }
      if (action === "archive") {
        await archivePlan(planId);
        return;
      }
      await deletePlan(planId);
    },
    [archivePlan, deletePlan, markPlanUnread, plan.planId],
  );

  const handleContextMenu = useCallback(
    (event: MouseEvent) => {
      const api = readLocalApi();
      // No native menu here: the row's own popup is the way in, and letting
      // the browser menu open is better than swallowing the gesture.
      if (api === undefined) return;
      event.preventDefault();
      void (async () => {
        const clicked = await api.contextMenu.show(items, {
          x: event.clientX,
          y: event.clientY,
        });
        if (clicked !== null) {
          await runAction(clicked);
        }
      })();
    },
    [items, runAction],
  );

  return (
    <SidebarMenuSubItem className="group/plan-row relative w-full">
      <SidebarMenuSubButton
        render={<button type="button" />}
        className={cn(resolvePlanRowClassName({ isActive }), "flex items-center gap-1.5")}
        onClick={() => {
          void navigate({ to: "/plans/$planId", params: { planId: plan.planId } });
        }}
        onContextMenu={handleContextMenu}
      >
        {status === null ? null : <PlanStatusDot status={status} />}
        <span className="min-w-0 flex-1 truncate">{plan.title}</span>
        {/* The timestamp yields on hover to the row's verbs, so a plan row
            stays a title until you reach for it. */}
        <span className="shrink-0 text-[11px] text-sidebar-muted-foreground/60 group-hover/plan-row:invisible group-focus-within/plan-row:invisible">
          {formatRelativeTimeLabel(plan.updatedAt)}
        </span>
      </SidebarMenuSubButton>
      {jumpLabel === null ? null : <JumpHintBadge label={jumpLabel} />}
      <Menu>
        <MenuTrigger
          render={
            <button
              type="button"
              aria-label={`Actions for ${plan.title}`}
              className={cn(
                ICON_ACTION_BUTTON_CLASS,
                "absolute end-1.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-150 group-hover/plan-row:opacity-100 group-focus-within/plan-row:opacity-100 data-[popup-open]:opacity-100 max-sm:opacity-100",
              )}
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontalIcon className="size-3.5" />
            </button>
          }
        />
        <MenuPopup align="end" side="bottom">
          {items.map((item) => (
            <MenuItem
              key={item.id}
              variant={item.destructive === true ? "destructive" : "default"}
              onClick={() => void runAction(item.id)}
            >
              {PLAN_ROW_MENU_ICONS[item.id]}
              <span>{item.label}</span>
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    </SidebarMenuSubItem>
  );
});

function WorkspaceGroup({ selection }: { readonly selection: TreeSelection }) {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const go = useCallback(
    (to: "/repositories" | "/settings") => {
      if (isMobile) {
        setOpenMobile(false);
      }
      void navigate({ to });
    },
    [isMobile, navigate, setOpenMobile],
  );

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Workspace</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <button
              type="button"
              className={cn(
                resolveWorkspaceRowClassName({ isActive: selection.isRepositoriesActive }),
                "flex items-center gap-2",
              )}
              onClick={() => go("/repositories")}
            >
              <GitBranchIcon className="size-4 shrink-0 opacity-70" />
              <span className="truncate">Repositories</span>
            </button>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <button
              type="button"
              className={cn(
                resolveWorkspaceRowClassName({ isActive: selection.isSettingsActive }),
                "flex items-center gap-2",
              )}
              onClick={() => go("/settings")}
            >
              <SettingsIcon className="size-4 shrink-0 opacity-70" />
              <span className="truncate">Settings</span>
            </button>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
