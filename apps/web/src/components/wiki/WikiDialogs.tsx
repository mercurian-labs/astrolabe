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

/** Registers an existing git repository's folder as a wiki. */
export function AddWikiFolderDialog({
  environmentId,
  open,
  onOpenChange,
  onAdded,
}: {
  readonly environmentId: EnvironmentId;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onAdded: (wiki: WikiSummary) => void;
}) {
  const canRegister = useAtomValue(wikiEnvironment.register.permissionAtom(environmentId));
  const register = useWikiCommand(wikiEnvironment.register);
  const [root, setRoot] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const absolute = root.trim().startsWith("/") || /^[A-Za-z]:[\\/]/.test(root.trim());
  return (
    <WikiFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add a folder"
      description="Use an existing git repository of markdown notes as a wiki. Its files stay where they are."
      submitLabel="Add wiki"
      canSubmit={canRegister && absolute}
      busy={busy}
      error={
        error ?? (canRegister ? null : "You don't have permission to add wikis on this server.")
      }
      onSubmit={async () => {
        setBusy(true);
        setError(null);
        const outcome = await register({
          environmentId,
          input: { root: root.trim(), ...(name.trim() ? { name: name.trim() } : {}) },
        });
        setBusy(false);
        if (outcome.ok) {
          onOpenChange(false);
          onAdded(outcome.value);
        } else if (outcome.message) {
          setError(outcome.message);
        }
      }}
    >
      <Field label="Folder" hint="The absolute path of the repository's top-level folder.">
        {(id) => (
          <Input
            id={id}
            autoFocus
            placeholder="/Users/you/notes"
            value={root}
            onChange={(event) => setRoot(event.target.value)}
          />
        )}
      </Field>
      <Field label="Name" hint="Optional. Defaults to the folder's name.">
        {(id) => <Input id={id} value={name} onChange={(event) => setName(event.target.value)} />}
      </Field>
    </WikiFormDialog>
  );
}

/** Creates a new, empty wiki repository. */
export function NewWikiDialog({
  environmentId,
  open,
  onOpenChange,
  onCreated,
}: {
  readonly environmentId: EnvironmentId;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreated: (wiki: WikiSummary) => void;
}) {
  const canCreate = useAtomValue(wikiEnvironment.create.permissionAtom(environmentId));
  const create = useWikiCommand(wikiEnvironment.create);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <WikiFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New wiki"
      description="Start an empty wiki. Astrolabe creates its git repository on this server."
      submitLabel="Create wiki"
      canSubmit={canCreate && name.trim().length > 0}
      busy={busy}
      error={
        error ?? (canCreate ? null : "You don't have permission to create wikis on this server.")
      }
      onSubmit={async () => {
        setBusy(true);
        setError(null);
        const outcome = await create({ environmentId, input: { name: name.trim() } });
        setBusy(false);
        if (outcome.ok) {
          onOpenChange(false);
          onCreated(outcome.value);
        } else if (outcome.message) {
          setError(outcome.message);
        }
      }}
    >
      <Field label="Name">
        {(id) => (
          <Input
            id={id}
            autoFocus
            placeholder="Research notes"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
    </WikiFormDialog>
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
