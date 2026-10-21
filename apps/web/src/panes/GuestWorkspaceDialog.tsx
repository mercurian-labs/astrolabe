import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { useComposerDraftStore } from "~/composerDraftStore";
import { readThreadShell, useThreadShell } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";
import type { Arrangement } from "./arrangement";
import { bringAlong, companionsOf, useGuestWorkspaceRequest } from "./guestWorkspace";
import type { StorageLike } from "./persistence";

/** Opens a thread's own workspace, as the sidebar does: a draft not yet sent at its draft. */
export function useOpenThreadRoute() {
  const navigate = useNavigate();
  return (ref: ScopedThreadRef) => {
    const draftId =
      readThreadShell(ref) === null ? useComposerDraftStore.getState().getDraftIdByRef(ref) : null;
    if (draftId) void navigate({ to: "/draft/$draftId", params: { draftId } });
    else void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  };
}

function ThreadName({ threadKey }: { threadKey: string }) {
  const shell = useThreadShell(parseScopedThreadKey(threadKey));
  // A thread not yet sent has no title of its own.
  return <>{shell?.title ?? "New thread"}</>;
}

/**
 * "Open in its own workspace" for a guest: which of the threads it is with here come along as
 * guests, all of them at first, then the guest's workspace opens with it as the host.
 */
export function GuestWorkspaceDialog({
  hostKey,
  arrangement,
  storage,
}: {
  hostKey: string;
  arrangement: Arrangement;
  storage: StorageLike | null;
}) {
  const guest = useGuestWorkspaceRequest((store) => store.guest);
  const close = useGuestWorkspaceRequest((store) => store.close);
  if (guest === null) return null;
  return (
    <GuestWorkspaceChoice
      // A fresh choice, all ticked, each time the dialog opens.
      key={guest}
      guest={guest}
      companions={companionsOf(hostKey, arrangement, guest)}
      hostKey={hostKey}
      storage={storage}
      onClose={close}
    />
  );
}

function GuestWorkspaceChoice({
  guest,
  companions,
  hostKey,
  storage,
  onClose,
}: {
  guest: string;
  companions: readonly string[];
  hostKey: string;
  storage: StorageLike | null;
  onClose: () => void;
}) {
  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set(companions));
  const openThreadRoute = useOpenThreadRoute();
  const toggle = (key: string, checked: boolean) =>
    setKept((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  const go = () => {
    const ref = parseScopedThreadKey(guest);
    if (!ref) return onClose();
    bringAlong(
      storage,
      guest,
      companions.filter((key) => kept.has(key)),
    );
    onClose();
    openThreadRoute(ref);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-md">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            go();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              Open <ThreadName threadKey={guest} /> in its own workspace
            </DialogTitle>
            <DialogDescription>
              It becomes the main thread there. Choose which threads come along as guests; this
              workspace stays as it is.
            </DialogDescription>
          </DialogHeader>
          {companions.length > 0 ? (
            <DialogPanel>
              <div className="flex flex-col gap-2.5">
                {companions.map((key) => (
                  <label key={key} className="flex min-w-0 cursor-pointer items-center gap-2.5">
                    <Checkbox
                      checked={kept.has(key)}
                      onCheckedChange={(checked) => toggle(key, checked === true)}
                    />
                    <span className="min-w-0 truncate text-sm">
                      <ThreadName threadKey={key} />
                    </span>
                    {key === hostKey ? (
                      <span className="shrink-0 text-xs text-muted-foreground">main thread</span>
                    ) : null}
                  </label>
                ))}
              </div>
            </DialogPanel>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Open workspace</Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
