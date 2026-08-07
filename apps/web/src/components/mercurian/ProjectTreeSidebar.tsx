import type { MercurianProjectId } from "@t3tools/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderGit2Icon,
  FolderPlusIcon,
  GitBranchIcon,
  SettingsIcon,
  SquarePenIcon,
} from "lucide-react";
import { memo, useCallback, useMemo, useState, type MouseEvent } from "react";

import { isElectron } from "../../env";
import { useClientSettings } from "../../hooks/useSettings";
import { cn, randomUUID } from "../../lib/utils";
import { usePlanDraftStore } from "../../planDraftStore";
import { useCreateMercurianProject, useMercurianTree } from "../../state/mercurian";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { resolveMercurianProjectExpanded, useUiStateStore } from "../../uiStateStore";
import { SidebarChromeFooter, SidebarChromeHeader } from "../sidebar/SidebarChrome";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
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
  getVisiblePlansForProject,
  groupPlansByProject,
  resolvePlanRowClassName,
  resolveProjectRowClassName,
  resolveTreeSelection,
  resolveWorkspaceRowClassName,
  sortProjectsForTree,
  type TreeSelection,
} from "./ProjectTreeSidebar.logic";
import { ManageProjectRepositoriesDialog } from "./ManageProjectRepositoriesDialog";
import { SettingsNav } from "./SettingsNav";

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

  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      {selection.isSettingsActive ? (
        // Settings takes the panel over while you are in it, and the tree
        // returns when you leave.
        <SettingsNav pathname={pathname} />
      ) : (
        <SidebarContent>
          <ProjectTree selection={selection} />
          <WorkspaceGroup selection={selection} />
        </SidebarContent>
      )}
      <SidebarChromeFooter showSettingsRow={false} />
    </>
  );
}

function ProjectTree({ selection }: { readonly selection: TreeSelection }) {
  const { snapshot } = useMercurianTree();
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const projects = useMemo(() => sortProjectsForTree(snapshot.projects), [snapshot.projects]);
  const plansByProject = useMemo(() => groupPlansByProject(snapshot.plans), [snapshot.plans]);

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
        {projects.length === 0 ? (
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
            {projects.map((project) => (
              <ProjectTreeRow
                key={project.projectId}
                projectId={project.projectId}
                name={project.name}
                plans={plansByProject.get(project.projectId) ?? []}
                activePlanId={selection.activePlanId}
              />
            ))}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
      <NewProjectDialog open={isNewProjectOpen} onOpenChange={setIsNewProjectOpen} />
    </SidebarGroup>
  );
}

interface ProjectTreeRowProps {
  readonly projectId: MercurianProjectId;
  readonly name: string;
  readonly plans: ReadonlyArray<{
    readonly planId: string;
    readonly title: string;
    readonly updatedAt: string;
  }>;
  readonly activePlanId: string | null;
}

const ProjectTreeRow = memo(function ProjectTreeRow({
  projectId,
  name,
  plans,
  activePlanId,
}: ProjectTreeRowProps) {
  const navigate = useNavigate();
  const expandedById = useUiStateStore((state) => state.mercurianProjectExpandedById);
  const setExpanded = useUiStateStore((state) => state.setMercurianProjectExpanded);
  const openDraftForProject = usePlanDraftStore((state) => state.openDraftForProject);
  const planPreviewCount = useClientSettings(selectPlanPreviewCount);
  // Deliberately forgotten between visits: show-more is a glance, not a preference.
  const [isPlanListExpanded, setIsPlanListExpanded] = useState(false);
  const [isRepositoriesOpen, setIsRepositoriesOpen] = useState(false);

  const isExpanded = resolveMercurianProjectExpanded(expandedById, projectId);
  const containsSelection =
    activePlanId !== null && plans.some((plan) => plan.planId === activePlanId);

  const { visiblePlans, hasHiddenPlans } = useMemo(
    () =>
      getVisiblePlansForProject({
        plans,
        activePlanId,
        isPlanListExpanded,
        previewLimit: planPreviewCount,
      }),
    [activePlanId, isPlanListExpanded, planPreviewCount, plans],
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
            <SidebarMenuSubItem key={plan.planId} className="w-full">
              <SidebarMenuSubButton
                render={<button type="button" />}
                className={cn(resolvePlanRowClassName({ isActive: plan.planId === activePlanId }))}
                onClick={() => {
                  void navigate({ to: "/plans/$planId", params: { planId: plan.planId } });
                }}
              >
                <span className="min-w-0 flex-1 truncate">{plan.title}</span>
                <span className="shrink-0 text-[11px] text-sidebar-muted-foreground/60">
                  {formatRelativeTimeLabel(plan.updatedAt)}
                </span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
          {hasHiddenPlans ? (
            <SidebarMenuSubItem className="w-full">
              <SidebarMenuSubButton
                render={<button type="button" />}
                size="sm"
                className="h-8 w-full translate-x-0 justify-start px-2 text-left text-xs text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                onClick={() => setIsPlanListExpanded((expanded) => !expanded)}
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

function NewProjectDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const createProject = useCreateMercurianProject();
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = useCallback(async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    const project = await createProject(trimmed);
    setIsSubmitting(false);
    if (project !== null) {
      setName("");
      onOpenChange(false);
    }
  }, [createProject, isSubmitting, name, onOpenChange]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setName("");
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Project name</span>
            <Input
              aria-label="Project name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={name.trim().length === 0 || isSubmitting} onClick={() => void submit()}>
            Create
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
