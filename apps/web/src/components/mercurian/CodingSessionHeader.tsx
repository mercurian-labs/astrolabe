import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  MercurianRepositoryId,
  PlanId,
  ScopedThreadRef,
  SourceControlProviderKind,
  ThreadId,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { cn } from "../../lib/utils";
import { useRemoteOpenState } from "../../remoteOpen";
import { selectThreadRightPanelState, useRightPanelStore } from "../../rightPanelStore";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useRepositories } from "../../state/mercurianRepositories";
import { useRecreateLineBranch } from "../../state/mercurian";
import { useEnvironmentQuery } from "../../state/query";
import {
  primaryServerAvailableEditorsAtom,
  primaryServerKeybindingsAtom,
} from "../../state/server";
import { sourceControlEnvironment } from "../../state/sourceControl";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import GitActionsControl from "../GitActionsControl";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { resolveRenameCommit, shouldShowOpenInPicker } from "../chat/ChatHeader";
import { OpenInPicker } from "../chat/OpenInPicker";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { changeRequestsAllowed } from "./hostingProviders.logic";
import { SessionPreviewOffer } from "./SessionPreviewOffer";
import { SessionScriptsControl } from "./SessionScriptsControl";

export interface CodingSessionHeaderProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly threadTitle: string;
  readonly planId: PlanId | null;
  readonly planTitle: string | null;
  readonly threadRef: ScopedThreadRef;
  readonly worktreePath: string | null;
  readonly repositoryId: MercurianRepositoryId | null;
  readonly branch: string | null;
  readonly lineBranchMissingOid: string | null;
}

/** Session rename uses the same trim/reject/no-op contract as the parked thread header. */
export function resolveCodingSessionRename(input: {
  readonly title: string;
  readonly originalTitle: string;
}) {
  return resolveRenameCommit(input);
}

export function CodingSessionHeader(props: CodingSessionHeaderProps) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const remoteOpenState = useRemoteOpenState(props.environmentId);
  const availableEditors = useAtomValue(primaryServerAvailableEditorsAtom);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { snapshot: repositoriesSnapshot } = useRepositories();
  const repository = useMemo(
    () =>
      repositoriesSnapshot.repositories.find(
        (candidate) => candidate.repositoryId === props.repositoryId,
      ) ?? null,
    [props.repositoryId, repositoriesSnapshot.repositories],
  );
  const discovery = useEnvironmentQuery(
    sourceControlEnvironment.discovery({ environmentId: props.environmentId, input: {} }),
  );
  const rightPanelOpen = useRightPanelStore((state) =>
    selectThreadRightPanelState(state.byThreadKey, props.threadRef),
  ).isOpen;
  const discoveryData = discovery.data;
  const changeRequestsGate = useCallback(
    (provider: SourceControlProviderKind | null) => changeRequestsAllowed(provider, discoveryData),
    [discoveryData],
  );
  const showOpenInPicker =
    props.worktreePath !== null &&
    shouldShowOpenInPicker({
      activeProjectName: repository?.name ?? props.worktreePath,
      activeThreadEnvironmentId: props.environmentId,
      primaryEnvironmentId,
      remoteOpenMode: remoteOpenState.mode,
    });
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const recreateLineBranch = useRecreateLineBranch();
  const [renaming, setRenaming] = useState<{ threadId: ThreadId; title: string } | null>(null);
  if (renaming !== null && renaming.threadId !== props.threadId) setRenaming(null);
  const renameTitle = renaming?.threadId === props.threadId ? renaming.title : null;
  const renameCommittedRef = useRef(false);

  const startRename = useCallback(() => {
    renameCommittedRef.current = false;
    setRenaming({ threadId: props.threadId, title: props.threadTitle });
  }, [props.threadId, props.threadTitle]);
  const commitRename = useCallback(
    (title: string) => {
      setRenaming(null);
      const resolution = resolveCodingSessionRename({
        title,
        originalTitle: props.threadTitle,
      });
      if (resolution.action === "reject-empty") {
        toastManager.add({ type: "warning", title: "Session title cannot be empty" });
        return;
      }
      if (resolution.action === "noop") return;
      void updateThreadMetadata({
        environmentId: props.environmentId,
        input: { threadId: props.threadId, title: resolution.title },
      }).then((result) => {
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add({
            type: "error",
            title: "Failed to rename session",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
      });
    },
    [props.environmentId, props.threadId, props.threadTitle, updateThreadMetadata],
  );
  const handleRenameKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        renameCommittedRef.current = true;
        commitRename(event.currentTarget.value);
      } else if (event.key === "Escape") {
        renameCommittedRef.current = true;
        setRenaming(null);
      }
    },
    [commitRename],
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <WorkspaceBreadcrumb ariaLabel="Coding session breadcrumb" className="flex-1">
          <WorkspaceBreadcrumbItem>
            {props.planId === null || props.planTitle === null ? (
              <Link
                className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                to="/"
              >
                Plans
              </Link>
            ) : (
              <Link
                className="max-w-40 truncate rounded-sm transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                to="/plans/$planId"
                params={{ planId: props.planId }}
              >
                {props.planTitle}
              </Link>
            )}
          </WorkspaceBreadcrumbItem>
          <WorkspaceBreadcrumbSeparator />
          <WorkspaceBreadcrumbItem current className="flex-1">
            {renameTitle === null ? (
              <button
                type="button"
                aria-label={`Rename session ${props.threadTitle}`}
                className="min-w-0 max-w-full cursor-pointer truncate rounded-sm text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                onClick={startRename}
              >
                {props.threadTitle}
              </button>
            ) : (
              <input
                autoFocus
                aria-label="Session title"
                className="min-w-0 flex-1 rounded-sm bg-transparent text-sm font-medium text-foreground outline-none ring-1 ring-ring/50 focus:ring-ring"
                defaultValue={renameTitle}
                onBlur={(event) => {
                  if (renameCommittedRef.current) return;
                  commitRename(event.currentTarget.value);
                }}
                onFocus={(event) => event.currentTarget.select()}
                onKeyDown={handleRenameKeyDown}
              />
            )}
          </WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>
        <div
          data-chat-header-actions
          className={cn(
            "flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3",
            rightPanelOpen ? "pr-0" : "pr-16",
          )}
        >
          {props.worktreePath !== null && repository !== null ? (
            <SessionScriptsControl
              threadRef={props.threadRef}
              worktreePath={props.worktreePath}
              repository={repository}
              keybindings={keybindings}
            />
          ) : null}
          {showOpenInPicker ? (
            <OpenInPicker
              environmentId={props.environmentId}
              keybindings={keybindings}
              availableEditors={availableEditors}
              openInCwd={props.worktreePath}
            />
          ) : null}
          {props.worktreePath !== null ? (
            <GitActionsControl
              gitCwd={props.worktreePath}
              activeThreadRef={props.threadRef}
              changeRequestsAllowed={changeRequestsGate}
            />
          ) : null}
          <WorkspaceBreadcrumb ariaLabel="Session previews">
            <SessionPreviewOffer environmentId={props.environmentId} threadId={props.threadId} />
          </WorkspaceBreadcrumb>
        </div>
      </div>
      {props.lineBranchMissingOid === null || props.branch === null ? null : (
        <div
          role="alert"
          className="flex items-center gap-2 border-t border-destructive/20 px-2 pt-1 text-xs text-destructive-foreground"
        >
          <span className="min-w-0 flex-1 truncate">
            Branch <code>{props.branch}</code> no longer exists in this repository
          </span>
          <Button
            size="xs"
            type="button"
            variant="outline"
            onClick={() => void recreateLineBranch({ threadId: props.threadId })}
          >
            Recreate at {props.lineBranchMissingOid.slice(0, 7)}
          </Button>
        </div>
      )}
    </div>
  );
}
