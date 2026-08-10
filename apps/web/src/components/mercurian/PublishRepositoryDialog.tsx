import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  MercurianRepository,
  SourceControlDiscoveryResult,
  SourceControlRepositoryVisibility,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { CloudUploadIcon, GlobeIcon, LockIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useSourceControlPublishRepositoryAction } from "../../lib/sourceControlActions";
import { cn } from "../../lib/utils";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useRefreshRepositories } from "../../state/mercurianRepositories";
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
import { HostingProviderMark } from "./HostingProvidersSection";
import {
  providerLabel,
  providerPathHint,
  readyProviderKinds,
  type RepositoryProviderKind,
} from "./hostingProviders.logic";

function accountForProvider(
  discovery: SourceControlDiscoveryResult | null,
  provider: RepositoryProviderKind,
): string | null {
  const item = discovery?.sourceControlProviders.find((candidate) => candidate.kind === provider);
  return item === undefined ? null : Option.getOrNull(item.auth.account);
}

function prefillRepository(
  discovery: SourceControlDiscoveryResult | null,
  provider: RepositoryProviderKind,
  repositoryName: string,
): string {
  const account = accountForProvider(discovery, provider);
  return account === null ? repositoryName : `${account}/${repositoryName}`;
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return typeof error === "string" && error.trim().length > 0
    ? error
    : "Could not publish this repository.";
}

export function PublishRepositoryDialog({
  repository,
  discovery,
  open,
  onOpenChange,
}: {
  readonly repository: MercurianRepository | null;
  readonly discovery: SourceControlDiscoveryResult | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const environmentId = usePrimaryEnvironmentId();
  const refreshRepositories = useRefreshRepositories();
  const readyProviders = useMemo(() => readyProviderKinds(discovery), [discovery]);
  const [provider, setProvider] = useState<RepositoryProviderKind | null>(null);
  const [repositoryPath, setRepositoryPath] = useState("");
  const [visibility, setVisibility] = useState<SourceControlRepositoryVisibility>("private");
  const [refusal, setRefusal] = useState<string | null>(null);
  const actionScope = useMemo(
    () => ({ environmentId, cwd: repository?.path ?? null }),
    [environmentId, repository?.path],
  );
  const action = useSourceControlPublishRepositoryAction(actionScope);

  useEffect(() => {
    if (!open || repository === null) return;
    const first = readyProviders[0] ?? null;
    setProvider(first);
    setRepositoryPath(
      first === null ? repository.name : prefillRepository(discovery, first, repository.name),
    );
    setVisibility("private");
    setRefusal(null);
  }, [discovery, open, readyProviders, repository]);

  const selectProvider = useCallback(
    (next: RepositoryProviderKind) => {
      setProvider(next);
      if (repository !== null) {
        setRepositoryPath(prefillRepository(discovery, next, repository.name));
      }
    },
    [discovery, repository],
  );

  const canPublish =
    provider !== null &&
    repository !== null &&
    repositoryPath.trim().split("/").filter(Boolean).length >= 2 &&
    !action.isPending;

  const publish = useCallback(async () => {
    if (!canPublish || provider === null || repository === null) return;
    setRefusal(null);
    const result = await action.run({
      provider,
      repository: repositoryPath.trim(),
      visibility,
      remoteName: "origin",
      protocol: "ssh",
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        setRefusal(errorText(squashAtomCommandFailure(result)));
      }
      return;
    }
    await refreshRepositories();
    onOpenChange(false);
  }, [
    action,
    canPublish,
    onOpenChange,
    provider,
    refreshRepositories,
    repository,
    repositoryPath,
    visibility,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Publish repository</DialogTitle>
        </DialogHeader>
        <DialogPanel className="space-y-5">
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Hosting provider</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {readyProviders.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={provider === kind}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm",
                    provider === kind
                      ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                      : "border-border hover:bg-accent/40",
                  )}
                  onClick={() => selectProvider(kind)}
                >
                  <HostingProviderMark provider={kind} tone="ready" />
                  <span className="font-medium text-foreground">{providerLabel(kind)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="mercurian-publish-repository"
              className="text-xs font-medium text-foreground"
            >
              Repository
            </label>
            <Input
              id="mercurian-publish-repository"
              value={repositoryPath}
              onChange={(event) => setRepositoryPath(event.target.value)}
              placeholder={provider === null ? "owner/repository" : providerPathHint(provider)}
              disabled={action.isPending}
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Visibility</p>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { value: "private", label: "Private", Icon: LockIcon },
                  { value: "public", label: "Public", Icon: GlobeIcon },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={visibility === option.value}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm",
                    visibility === option.value
                      ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                      : "border-border hover:bg-accent/40",
                  )}
                  onClick={() => setVisibility(option.value)}
                  disabled={action.isPending}
                >
                  <option.Icon className="size-4 text-muted-foreground" />
                  <span className="font-medium text-foreground">{option.label}</span>
                </button>
              ))}
            </div>
          </div>

          {refusal === null ? null : <p className="text-sm text-destructive">{refusal}</p>}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={action.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void publish()} disabled={!canPublish}>
            {action.isPending ? (
              <Spinner className="size-4" />
            ) : (
              <CloudUploadIcon className="size-4" />
            )}
            Publish repository
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
