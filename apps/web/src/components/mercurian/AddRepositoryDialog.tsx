import type { SourceControlDiscoveryResult } from "@t3tools/contracts";
import { CheckIcon, ChevronRightIcon, FolderIcon, LinkIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  appendBrowsePathSegment,
  ensureBrowseDirectoryPath,
  getBrowseDirectoryPath,
} from "../../lib/projectPaths";
import { cn } from "../../lib/utils";
import { usePrimaryEnvironment, usePrimaryEnvironmentId } from "../../state/environments";
import { filesystemEnvironment } from "../../state/filesystem";
import { useAddRepository } from "../../state/mercurianRepositories";
import { useEnvironmentQuery } from "../../state/query";
import { sourceControlEnvironment } from "../../state/sourceControl";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import {
  buildProviderReadiness,
  deriveCloneDestination,
  providerLabel,
  providerPathHint,
  sortProviderKinds,
  type RepositoryProviderKind,
} from "./AddRepositoryDialog.logic";

/**
 * The three ways a repository enters.
 *
 * Folder and URL are the local-first phase, and they are complete on their
 * own. The provider paths are designed in and gate on detection: a row enables
 * only when its command-line tool is both installed and signed in, and
 * otherwise stands there disabled saying which of the two is missing. A
 * machine where none of them ever enables has lost nothing.
 */
type AddMode = "folder" | "url" | RepositoryProviderKind;

interface AddRepositoryDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

const MODE_ROW_CLASS =
  "flex w-full items-center gap-2.5 rounded-lg border border-transparent px-3 py-2.5 text-left text-sm transition-colors";

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return "Could not add the repository.";
}

export function AddRepositoryDialog({ open, onOpenChange }: AddRepositoryDialogProps) {
  const [mode, setMode] = useState<AddMode | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setMode(null);
        onOpenChange(nextOpen);
      }}
    >
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === null ? "Add a repository" : modeTitle(mode)}</DialogTitle>
        </DialogHeader>
        {mode === null ? (
          <ModePicker onPick={setMode} />
        ) : mode === "folder" ? (
          <FolderPath onBack={() => setMode(null)} onDone={() => onOpenChange(false)} />
        ) : (
          <ClonePath mode={mode} onBack={() => setMode(null)} onDone={() => onOpenChange(false)} />
        )}
      </DialogPopup>
    </Dialog>
  );
}

function modeTitle(mode: AddMode): string {
  if (mode === "folder") return "Pick a folder";
  if (mode === "url") return "Clone a git URL";
  return `Clone from ${providerLabel(mode)}`;
}

function useDiscovery(): SourceControlDiscoveryResult | null {
  const environmentId = usePrimaryEnvironmentId();
  const { data } = useEnvironmentQuery(
    environmentId === null
      ? null
      : sourceControlEnvironment.discovery({ environmentId, input: {} }),
  );
  return data;
}

function ModePicker({ onPick }: { readonly onPick: (mode: AddMode) => void }) {
  const discovery = useDiscovery();
  const readiness = useMemo(() => buildProviderReadiness(discovery), [discovery]);
  const providerKinds = useMemo(() => sortProviderKinds(readiness), [readiness]);

  return (
    <DialogPanel className="space-y-1">
      <button
        type="button"
        className={cn(MODE_ROW_CLASS, "hover:border-border hover:bg-accent/50")}
        onClick={() => onPick("folder")}
      >
        <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-foreground">Pick a local folder</span>
          <span className="block text-xs text-muted-foreground">
            Any directory on this machine. Git is not required.
          </span>
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/60" />
      </button>
      <button
        type="button"
        className={cn(MODE_ROW_CLASS, "hover:border-border hover:bg-accent/50")}
        onClick={() => onPick("url")}
      >
        <LinkIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-foreground">Clone a git URL</span>
          <span className="block text-xs text-muted-foreground">
            Clone into a folder here, then register it.
          </span>
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/60" />
      </button>

      <div className="pt-2">
        <span className="px-3 text-xs font-medium text-muted-foreground">Hosting providers</span>
      </div>
      {providerKinds.map((kind) => {
        const { ready, reason } = readiness[kind];
        return (
          <button
            key={kind}
            type="button"
            disabled={!ready}
            className={cn(
              MODE_ROW_CLASS,
              ready
                ? "hover:border-border hover:bg-accent/50"
                : "cursor-not-allowed text-muted-foreground/70",
            )}
            onClick={() => onPick(kind)}
          >
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block font-medium",
                  ready ? "text-foreground" : "text-foreground/60",
                )}
              >
                {providerLabel(kind)}
              </span>
              {/* Detection, not configuration: the row says what the machine
                  reported, and there is nothing here to set. */}
              <span className="block text-xs text-muted-foreground">
                {ready ? `Clone by ${providerPathHint(kind)}` : (reason ?? "Not available here.")}
              </span>
            </span>
            {ready ? (
              <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/60" />
            ) : null}
          </button>
        );
      })}
    </DialogPanel>
  );
}

/** The setting that already says where this machine keeps its code. */
function useAddBaseDirectory(): string {
  const environment = usePrimaryEnvironment();
  return environment?.serverConfig?.settings?.addProjectBaseDirectory?.trim() ?? "";
}

function FolderPath({
  onBack,
  onDone,
}: {
  readonly onBack: () => void;
  readonly onDone: () => void;
}) {
  const environmentId = usePrimaryEnvironmentId();
  const baseDirectory = useAddBaseDirectory();
  const [path, setPath] = useState(() =>
    baseDirectory.length === 0 ? "~/" : ensureBrowseDirectoryPath(baseDirectory),
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const addRepository = useAddRepository();

  const browse = useEnvironmentQuery(
    environmentId === null
      ? null
      : filesystemEnvironment.browse({
          environmentId,
          input: { partialPath: getBrowseDirectoryPath(path) || "~/" },
        }),
  );

  const submit = useCallback(async () => {
    const trimmed = path.trim();
    if (trimmed.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    const result = await addRepository({ path: trimmed });
    setIsSubmitting(false);
    if (result.ok) {
      onDone();
      return;
    }
    setError(errorText(result.error));
  }, [addRepository, isSubmitting, onDone, path]);

  return (
    <>
      <DialogPanel className="space-y-3">
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-foreground">Folder</span>
          <Input
            aria-label="Repository folder"
            autoFocus
            value={path}
            onChange={(event) => setPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
          />
        </div>
        {/* Browse-as-you-type over the same door the rest of the app browses
            through — nothing here reads the filesystem on its own. */}
        <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
          {browse.data === null ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {browse.isPending ? "Reading…" : "Nothing to show here."}
            </p>
          ) : (
            <ul>
              {browse.data.entries.map((entry) => (
                <li key={entry.fullPath}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground hover:bg-accent/50"
                    onClick={() => setPath(appendBrowsePathSegment(path, entry.name))}
                  >
                    <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{entry.name}</span>
                  </button>
                </li>
              ))}
              {browse.data.entries.length === 0 ? (
                <li className="px-3 py-2 text-xs text-muted-foreground">No folders here.</li>
              ) : null}
            </ul>
          )}
        </div>
        {error === null ? null : <p className="text-xs text-destructive">{error}</p>}
      </DialogPanel>
      <DialogFooter>
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button disabled={path.trim().length === 0 || isSubmitting} onClick={() => void submit()}>
          {isSubmitting ? <Spinner className="size-4" /> : null}
          Add repository
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Clone, then register — two steps, sequenced on the client.
 *
 * A failed clone registers nothing, and the second step is cheap, so there is
 * no compensation to write: at worst a cloned directory sits there
 * unregistered, which the folder path picks straight up.
 */
function ClonePath({
  mode,
  onBack,
  onDone,
}: {
  readonly mode: "url" | RepositoryProviderKind;
  readonly onBack: () => void;
  readonly onDone: () => void;
}) {
  const environmentId = usePrimaryEnvironmentId();
  const baseDirectory = useAddBaseDirectory();
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [touchedDestination, setTouchedDestination] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCloning, setIsCloning] = useState(false);
  const addRepository = useAddRepository();
  const cloneRepository = useAtomCommand(sourceControlEnvironment.cloneRepository, {
    reportFailure: false,
  });
  const lookupRepository = useAtomQueryRunner(sourceControlEnvironment.repository, {
    reportFailure: false,
  });

  // The destination follows the source until someone edits it, and then it is
  // theirs.
  useEffect(() => {
    if (touchedDestination) return;
    setDestination(deriveCloneDestination(baseDirectory, source));
  }, [baseDirectory, source, touchedDestination]);

  const submit = useCallback(async () => {
    const trimmedSource = source.trim();
    const trimmedDestination = destination.trim();
    if (
      trimmedSource.length === 0 ||
      trimmedDestination.length === 0 ||
      isCloning ||
      environmentId === null
    ) {
      return;
    }
    setIsCloning(true);
    setError(null);

    const cloneInput =
      mode === "url"
        ? { remoteUrl: trimmedSource, destinationPath: trimmedDestination }
        : { provider: mode, repository: trimmedSource, destinationPath: trimmedDestination };

    if (mode !== "url") {
      // Resolve the short path first, so a typo fails before anything lands on
      // disk — the palette's sequence, kept.
      const lookup = await lookupRepository({
        environmentId,
        input: { provider: mode, repository: trimmedSource },
      });
      if (lookup._tag !== "Success") {
        setIsCloning(false);
        setError("Could not find that repository.");
        return;
      }
    }

    const cloned = await cloneRepository({ environmentId, input: cloneInput });
    if (cloned._tag !== "Success") {
      setIsCloning(false);
      setError("Clone failed.");
      return;
    }

    const added = await addRepository({ path: cloned.value.cwd });
    setIsCloning(false);
    if (added.ok) {
      onDone();
      return;
    }
    setError(errorText(added.error));
  }, [
    addRepository,
    cloneRepository,
    destination,
    environmentId,
    isCloning,
    lookupRepository,
    mode,
    onDone,
    source,
  ]);

  return (
    <>
      <DialogPanel className="space-y-3">
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-foreground">
            {mode === "url" ? "Clone URL" : `${providerLabel(mode)} repository`}
          </span>
          <Input
            aria-label={mode === "url" ? "Clone URL" : "Repository"}
            autoFocus
            placeholder={mode === "url" ? "https://…" : providerPathHint(mode)}
            value={source}
            onChange={(event) => setSource(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-foreground">Clone into</span>
          <Input
            aria-label="Destination folder"
            value={destination}
            onChange={(event) => {
              setTouchedDestination(true);
              setDestination(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
          />
        </div>
        {error === null ? null : <p className="text-xs text-destructive">{error}</p>}
      </DialogPanel>
      <DialogFooter>
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button
          disabled={source.trim().length === 0 || destination.trim().length === 0 || isCloning}
          onClick={() => void submit()}
        >
          {isCloning ? <Spinner className="size-4" /> : <CheckIcon className="size-4" />}
          Clone and add
        </Button>
      </DialogFooter>
    </>
  );
}
