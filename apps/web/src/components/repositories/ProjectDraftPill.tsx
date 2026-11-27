import { useAtomValue } from "@effect/atom-react";
import { draftLabel, wikiPullRequestHost } from "@t3tools/client-runtime/wikiLogic";
import type { EnvironmentId, ProjectId, WikiChangeRequest } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { ChevronDownIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useState } from "react";

import { wikiEnvironment } from "~/state/wiki";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { pullRequestTabKey } from "../pullRequest/pullRequestWorkspace";
import { useWikiCommand } from "../wiki/wikiEnvironment";
import { useWikiDraftActions } from "../wiki/WikiDraftPill";
import type { WikiDraftEdits } from "../wiki/WikiNoteView";

/**
 * Astrolabe: a hosted repository's draft, in a document's header where the branch would be. Edits
 * save here by themselves and never reach the host until the person opens a pull request (D3);
 * the host takes it as a draft pull request where it can.
 */
export function ProjectDraftPill({
  environmentId,
  projectId,
  draft,
  changeRequests,
  edits,
  onOpenTab,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly draft: WikiChangeRequest;
  readonly changeRequests: ReadonlyArray<WikiChangeRequest>;
  readonly edits: WikiDraftEdits;
  readonly onOpenTab: (key: string) => void;
}) {
  const gt = useGT();
  const actions = useWikiDraftActions({ environmentId, draft, changeRequests, ...edits });
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  return (
    <>
      <Menu open={open} onOpenChange={setOpen}>
        <MenuTrigger
          render={<Button variant="outline" size="xs" />}
          aria-label={gt("Draft actions")}
        >
          {draftLabel(draft)}
          <ChevronDownIcon />
        </MenuTrigger>
        <MenuPopup align="start">
          <MenuItem
            disabled={!actions.canAct}
            onClick={() =>
              void edits.flush().then((flushed) => {
                if (flushed) setAsking(true);
              })
            }
          >
            {gt("Open pull request…")}
          </MenuItem>
          <MenuSeparator />
          <MenuItem disabled={!actions.canAct} variant="destructive" onClick={actions.discard}>
            {gt("Discard draft…")}
          </MenuItem>
        </MenuPopup>
      </Menu>
      {actions.dialogs}
      {asking ? (
        <OpenPullRequestDialog
          environmentId={environmentId}
          projectId={projectId}
          draft={draft}
          onClose={() => setAsking(false)}
          onOpenTab={onOpenTab}
        />
      ) : null}
    </>
  );
}

function OpenPullRequestDialog({
  environmentId,
  projectId,
  draft,
  onClose,
  onOpenTab,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly draft: WikiChangeRequest;
  readonly onClose: () => void;
  readonly onOpenTab: (key: string) => void;
}) {
  const gt = useGT();
  const id = useId();
  const [title, setTitle] = useState(draft.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A draft made a pull request stays one when the host then refuses it: trying again publishes.
  const [promoted, setPromoted] = useState(false);
  const promote = useWikiCommand(wikiEnvironment.promoteDraft);
  const publish = useWikiCommand(wikiEnvironment.publishChangeRequest);
  const canPublish = useAtomValue(
    wikiEnvironment.publishChangeRequest.permissionAtom(environmentId),
  );
  const canSubmit = title.trim().length > 0 && !busy && canPublish;
  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    const target = { wikiId: draft.wikiId, changeRequestId: draft.changeRequestId };
    const made = promoted
      ? null
      : await promote({ environmentId, input: { ...target, title: title.trim() } });
    if (made?.ok) setPromoted(true);
    const published =
      made === null || made.ok ? await publish({ environmentId, input: target }) : made;
    setBusy(false);
    if (!published.ok) {
      setError(published.message ?? gt("That was cancelled."));
      return;
    }
    onClose();
    const pullRequest = published.value.pullRequest ?? null;
    const host = pullRequest === null ? null : wikiPullRequestHost(pullRequest.url);
    const key =
      pullRequest === null || host === null
        ? null
        : pullRequestTabKey({
            environmentId,
            projectId,
            host,
            repository: pullRequest.repository,
            number: pullRequest.number,
          });
    toastManager.add({
      type: "success",
      title: gt("Pull request opened"),
      ...(pullRequest === null
        ? {}
        : { description: `${pullRequest.repository} #${pullRequest.number}` }),
    });
    if (key !== null) onOpenTab(key);
  };
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogPopup className="sm:max-w-md">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{gt("Open pull request")}</DialogTitle>
            <DialogDescription>
              {gt(
                "Your draft goes to the host as a pull request, a draft one where the host has them. Your main checkout stays as it is.",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-title`}>{gt("Title")}</Label>
                <Input
                  id={`${id}-title`}
                  autoFocus
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              {error === null ? null : (
                <Alert variant="error">
                  <TriangleAlertIcon />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              {gt("Cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {busy ? <Spinner /> : null}
              {gt("Open pull request")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
