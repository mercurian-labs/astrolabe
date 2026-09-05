import { ArchiveIcon, ArchiveRestoreIcon, Trash2Icon } from "lucide-react";
import { useMemo } from "react";

import { usePlanLifecycleActions } from "../../hooks/usePlanLifecycleActions";
import { useMercurianTree } from "../../state/mercurian";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { groupArchivedPlansByProject, resolveArchivedRowActions } from "./ArchivedPlansPanel.logic";

/**
 * Settings → Archived: the reversible half of the thread lifecycle.
 *
 * Archived threads grouped by project, each restorable in one click. Delete
 * appears beside Restore only for a thread that is still fully private — once
 * anything has been published, archive is the only disappearance a thread has,
 * so there is nothing here to offer.
 *
 * The page reads the same live tree snapshot the sidebar does, which is why an
 * archive performed in one window makes a row appear here in another with no
 * refresh: there is one source, and it is already subscribed.
 */
export function ArchivedPlansPanel() {
  const { snapshot, isPending } = useMercurianTree();
  const { unarchivePlan, deletePlan } = usePlanLifecycleActions();

  const groups = useMemo(
    () => groupArchivedPlansByProject({ projects: snapshot.projects, plans: snapshot.plans }),
    [snapshot.plans, snapshot.projects],
  );

  if (groups.length === 0) {
    return (
      <SettingsPageContainer>
        <Empty className="flex-1">
          <EmptyHeader className="max-w-md">
            <div className="mx-auto mb-4 flex size-10 items-center justify-center rounded-xl border border-border/70 bg-background/70 text-muted-foreground">
              <ArchiveIcon className="size-5" />
            </div>
            <EmptyTitle className="text-foreground text-xl">
              {isPending ? "Loading archived threads" : "No archived threads"}
            </EmptyTitle>
            <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
              Archiving is how a thread leaves the tree without being destroyed. Anything archived
              waits here, grouped by project, and comes back where it was.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </SettingsPageContainer>
    );
  }

  return (
    <SettingsPageContainer>
      {groups.map(({ project, plans }) => (
        <SettingsSection key={project.projectId} title={project.name}>
          {plans.map((plan) => {
            const { canDelete } = resolveArchivedRowActions(plan);
            return (
              <SettingsRow
                key={plan.planId}
                title={plan.title}
                description={
                  <>
                    Archived {formatRelativeTimeLabel(plan.archivedAt ?? plan.createdAt)}
                    {" · Created "}
                    {formatRelativeTimeLabel(plan.createdAt)}
                  </>
                }
                control={
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 cursor-pointer gap-1.5 px-2.5"
                      onClick={() => void unarchivePlan(plan.planId)}
                    >
                      <ArchiveRestoreIcon className="size-3.5" />
                      <span>Restore</span>
                    </Button>
                    {canDelete ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0 cursor-pointer gap-1.5 px-2.5 text-destructive-foreground"
                        onClick={() => void deletePlan(plan.planId)}
                      >
                        <Trash2Icon className="size-3.5" />
                        <span>Delete</span>
                      </Button>
                    ) : null}
                  </>
                }
              />
            );
          })}
        </SettingsSection>
      ))}
    </SettingsPageContainer>
  );
}
