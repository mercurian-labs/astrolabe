import type { EnvironmentId, WikiSummary } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { TriangleAlertIcon } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";

import { wikiEnvironment } from "~/state/wiki";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
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
import { Spinner } from "../ui/spinner";
import { useWikiCommand } from "./wikiEnvironment";
import { WikiPart } from "./WikiParts";

/** One form dialog: title, fields, an inline error, and the submit button. */
function WikiFormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  canSubmit,
  busy,
  error,
  onSubmit,
  children,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: ReactNode;
  readonly submitLabel: string;
  readonly canSubmit: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSubmit: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-md">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (canSubmit && !busy) onSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              {children}
              {error ? (
                <Alert variant="error">
                  <TriangleAlertIcon />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || busy}>
              {busy ? <Spinner /> : null}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * Mirror settings: the remote main is pushed to after every merge, one way. Shows the last push,
 * its error, and whether a push replaced commits made on the mirror directly.
 */
export function WikiMirrorDialog({
  environmentId,
  wiki,
  open,
  onOpenChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly wiki: WikiSummary;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const canSet = useAtomValue(wikiEnvironment.setMirror.permissionAtom(environmentId));
  const canPush = useAtomValue(wikiEnvironment.pushMirror.permissionAtom(environmentId));
  const setMirror = useWikiCommand(wikiEnvironment.setMirror);
  const pushMirror = useWikiCommand(wikiEnvironment.pushMirror);
  const mirror = wiki.mirror;
  const [url, setUrl] = useState(mirror?.url ?? "");
  const [busy, setBusy] = useState<"save" | "clear" | "push" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const trimmed = url.trim();
  const act = async (action: "save" | "clear" | "push") => {
    setBusy(action);
    setError(null);
    const outcome =
      action === "push"
        ? await pushMirror({ environmentId, input: { wikiId: wiki.wikiId } })
        : await setMirror({
            environmentId,
            input: { wikiId: wiki.wikiId, url: action === "clear" ? null : trimmed },
          });
    setBusy(null);
    if (!outcome.ok) {
      if (outcome.message) setError(outcome.message);
      return;
    }
    if (action === "clear") setUrl("");
  };
  return (
    <WikiFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Mirror"
      description="Push the main line to a git remote after every merge. The push is one way: commits made on the mirror directly are overwritten."
      submitLabel="Save"
      canSubmit={canSet && trimmed.length > 0 && trimmed !== mirror?.url}
      busy={busy === "save"}
      error={error ?? (canSet ? null : "You don't have permission to change this wiki.")}
      onSubmit={() => void act("save")}
    >
      <Field label="Remote URL">
        {(id) => (
          <Input
            id={id}
            placeholder="git@github.com:you/notes.git"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        )}
      </Field>
      {mirror ? (
        <>
          <dl className="grid grid-cols-2 gap-3">
            <WikiPart.Fact label="Last push">
              {mirror.lastPushedAt
                ? `${formatRelativeTimeLabel(mirror.lastPushedAt)}${
                    mirror.lastPushedCommit ? ` · ${mirror.lastPushedCommit.slice(0, 7)}` : ""
                  }`
                : "Not pushed yet"}
            </WikiPart.Fact>
          </dl>
          {mirror.lastError ? (
            <Alert variant="error">
              <TriangleAlertIcon />
              <AlertTitle>The last push failed</AlertTitle>
              <AlertDescription>{mirror.lastError}</AlertDescription>
            </Alert>
          ) : null}
          {mirror.overwroteRemoteAt ? (
            <Alert variant="warning">
              <TriangleAlertIcon />
              <AlertTitle>A push overwrote the mirror</AlertTitle>
              <AlertDescription>
                {`On ${new Date(mirror.overwroteRemoteAt).toLocaleString()}, commits made on the mirror directly were replaced by this wiki's main line. Make changes here, through change requests.`}
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!canPush || busy !== null}
              onClick={() => void act("push")}
            >
              {busy === "push" ? <Spinner /> : null}
              Push now
            </Button>
            <Button
              variant="destructive-outline"
              size="sm"
              disabled={!canSet || busy !== null}
              onClick={() => void act("clear")}
            >
              {busy === "clear" ? <Spinner /> : null}
              Stop mirroring
            </Button>
          </div>
        </>
      ) : null}
    </WikiFormDialog>
  );
}
