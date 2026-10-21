import type { EnvironmentId, WikiSummary } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { TriangleAlertIcon } from "lucide-react";
import { useState } from "react";

import { ensureLocalApi } from "~/localApi";
import { useEnvironmentQuery } from "~/state/query";
import { wikiEnvironment } from "~/state/wiki";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
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
import { describeIndexError, summarizeMirror, type MirrorTone } from "./wiki.logic";
import { WikiMirrorDialog } from "./WikiDialogs";
import { useWikiCommand } from "./wikiEnvironment";
import { closeWikiTabs } from "./wikiPanes";
import { WikiPart } from "./WikiParts";

const MIRROR_BADGE: Record<MirrorTone, "outline" | "success" | "warning" | "error" | "secondary"> =
  {
    none: "outline",
    ok: "success",
    pending: "secondary",
    warning: "warning",
    error: "error",
  };

function WikiMirrorBadge({ wiki }: { readonly wiki: WikiSummary }) {
  const summary = summarizeMirror(wiki.mirror, formatRelativeTimeLabel);
  if (summary.tone === "none") return null;
  return <Badge variant={MIRROR_BADGE[summary.tone]}>{summary.label}</Badge>;
}

/**
 * A wiki's settings, opened from its row in the wiki filter as a project's are from the project
 * filter: where it lives, how it stands, its mirror, and removing it. Removing unregisters the
 * wiki; its files stay.
 */
export function WikiSettingsDialog({
  environmentId,
  wiki,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly wiki: WikiSummary;
  readonly onClose: () => void;
}) {
  const index = useEnvironmentQuery(
    wikiEnvironment.index({ environmentId, input: { wikiId: wiki.wikiId } }),
  );
  const canPush = useAtomValue(wikiEnvironment.pushMirror.permissionAtom(environmentId));
  const canRemove = useAtomValue(wikiEnvironment.remove.permissionAtom(environmentId));
  const pushMirror = useWikiCommand(wikiEnvironment.pushMirror, "Couldn't push to the mirror");
  const remove = useWikiCommand(wikiEnvironment.remove, "Couldn't remove the wiki");
  const [mirrorOpen, setMirrorOpen] = useState(false);
  const mirror = summarizeMirror(wiki.mirror, formatRelativeTimeLabel);
  const errors = (index.data?.errors ?? []).map(describeIndexError);

  return (
    <>
      <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
        <DialogPopup className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{wiki.name}</DialogTitle>
            <DialogDescription>
              Edits are saved to change requests; main changes only when one is merged.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-5">
              <dl className="grid gap-4 sm:grid-cols-2">
                <WikiPart.Fact label="Folder">
                  <span className="break-all">{wiki.root}</span>
                </WikiPart.Fact>
                <WikiPart.Fact label="Main line">{wiki.mainBranch}</WikiPart.Fact>
                <WikiPart.Fact label="Documents">
                  {index.data === null ? "…" : index.data.notes.length}
                </WikiPart.Fact>
                <WikiPart.Fact label="Open change requests">
                  {wiki.openChangeRequests}
                </WikiPart.Fact>
                <WikiPart.Fact label="Mirror">
                  {wiki.mirror ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="break-all">{wiki.mirror.url}</span>
                      <WikiMirrorBadge wiki={wiki} />
                    </span>
                  ) : (
                    mirror.label
                  )}
                </WikiPart.Fact>
              </dl>
              {wiki.mirror?.lastError ? (
                <Alert variant="error">
                  <TriangleAlertIcon />
                  <AlertTitle>The last push to the mirror failed</AlertTitle>
                  <AlertDescription>{wiki.mirror.lastError}</AlertDescription>
                </Alert>
              ) : null}
              {mirror.tone === "warning" ? (
                <Alert variant="warning">
                  <TriangleAlertIcon />
                  <AlertTitle>A push overwrote the mirror</AlertTitle>
                  <AlertDescription>
                    Commits made on the mirror directly were replaced by this wiki's main line.
                  </AlertDescription>
                </Alert>
              ) : null}
              {errors.length > 0 ? (
                <Alert variant="warning">
                  <TriangleAlertIcon />
                  <AlertTitle>Needs attention</AlertTitle>
                  <AlertDescription>
                    <WikiPart.ErrorList errors={errors} />
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button
              variant="destructive-outline"
              className="sm:me-auto"
              disabled={!canRemove}
              onClick={async () => {
                const confirmed = await ensureLocalApi().dialogs.confirm(
                  `Remove “${wiki.name}” from Astrolabe? Its folder and git history stay on disk at ${wiki.root}; you can add the folder again later.`,
                  { variant: "destructive" },
                );
                if (!confirmed) return;
                const outcome = await remove({ environmentId, input: { wikiId: wiki.wikiId } });
                if (!outcome.ok) return;
                closeWikiTabs(
                  (tab) => tab.environmentId === environmentId && tab.wikiId === wiki.wikiId,
                );
                onClose();
              }}
            >
              Remove wiki…
            </Button>
            {wiki.mirror ? (
              <Button
                variant="outline"
                disabled={!canPush}
                onClick={() => void pushMirror({ environmentId, input: { wikiId: wiki.wikiId } })}
              >
                Push to mirror now
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setMirrorOpen(true)}>
              {wiki.mirror ? "Mirror settings…" : "Set up a mirror…"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      {mirrorOpen ? (
        <WikiMirrorDialog
          environmentId={environmentId}
          wiki={wiki}
          open
          onOpenChange={setMirrorOpen}
        />
      ) : null}
    </>
  );
}
