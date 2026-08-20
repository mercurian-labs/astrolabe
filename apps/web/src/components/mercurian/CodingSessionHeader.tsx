import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, PlanId, ThreadId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { useCallback, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { resolveRenameCommit } from "../chat/ChatHeader";
import { toastManager } from "../ui/toast";
import { SessionPreviewOffer } from "./SessionPreviewOffer";

export interface CodingSessionHeaderProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly threadTitle: string;
  readonly planId: PlanId | null;
  readonly planTitle: string | null;
}

/** Session rename uses the same trim/reject/no-op contract as the parked thread header. */
export function resolveCodingSessionRename(input: {
  readonly title: string;
  readonly originalTitle: string;
}) {
  return resolveRenameCommit(input);
}

export function CodingSessionHeader(props: CodingSessionHeaderProps) {
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
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
      <SessionPreviewOffer environmentId={props.environmentId} threadId={props.threadId} />
    </WorkspaceBreadcrumb>
  );
}
