import type {
  SourceControlDiscoveryResult,
  SourceControlProviderDiscoveryItem,
  SourceControlProviderKind,
} from "@t3tools/contracts";
import { CloudIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useRefreshRepositories } from "../../state/mercurianRepositories";
import { useEnvironmentQuery } from "../../state/query";
import { sourceControlEnvironment } from "../../state/sourceControl";
import { AzureDevOpsIcon, BitbucketIcon, GitHubIcon, GitLabIcon, type Icon } from "../Icons";
import { RedactedSensitiveText } from "../settings/RedactedSensitiveText";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { providerStanding, type RepositoryProviderKind } from "./hostingProviders.logic";

const EMPTY_DISCOVERY: SourceControlDiscoveryResult = {
  versionControlSystems: [],
  sourceControlProviders: [],
};

export const HOSTING_PROVIDER_ICONS: Partial<Record<SourceControlProviderKind, Icon>> = {
  github: GitHubIcon,
  gitlab: GitLabIcon,
  bitbucket: BitbucketIcon,
  "azure-devops": AzureDevOpsIcon,
};

type RepositoryProviderDiscoveryItem = SourceControlProviderDiscoveryItem & {
  readonly kind: RepositoryProviderKind;
};

function isRepositoryProviderDiscoveryItem(
  provider: SourceControlProviderDiscoveryItem,
): provider is RepositoryProviderDiscoveryItem {
  return provider.kind !== "unknown";
}

export function HostingProviderMark({
  provider,
  tone = "neutral",
}: {
  readonly provider: SourceControlProviderKind;
  readonly tone?: "ready" | "warning" | "neutral";
}) {
  const ProviderIcon = HOSTING_PROVIDER_ICONS[provider] ?? CloudIcon;
  return (
    <span className="relative inline-flex size-5 shrink-0 items-center justify-center">
      <ProviderIcon className="size-4.5 text-foreground/80" aria-hidden />
      <span
        className={cn(
          "pointer-events-none absolute -left-0.5 -top-0.5 size-2 rounded-full ring-2 ring-background",
          tone === "ready"
            ? "bg-success"
            : tone === "warning"
              ? "bg-warning"
              : "bg-muted-foreground/35",
        )}
        aria-hidden
      />
    </span>
  );
}

/** Machine standing for hosting tools. Detection only: no switches and no login flow. */
export function HostingProvidersSection() {
  const environmentId = usePrimaryEnvironmentId();
  const discovery = useEnvironmentQuery(
    environmentId === null
      ? null
      : sourceControlEnvironment.discovery({ environmentId, input: {} }),
  );
  const refreshRepositories = useRefreshRepositories();
  const [isRefreshingRepositories, setIsRefreshingRepositories] = useState(false);
  const result = discovery.data ?? EMPTY_DISCOVERY;
  const providers = result.sourceControlProviders.filter(isRepositoryProviderDiscoveryItem);

  const rescan = async () => {
    discovery.refresh();
    setIsRefreshingRepositories(true);
    await refreshRepositories();
    setIsRefreshingRepositories(false);
  };
  const isRefreshing = discovery.isPending || isRefreshingRepositories;

  return (
    <section
      className="border-b border-border px-3 py-4 sm:px-5"
      aria-labelledby="hosting-providers-title"
    >
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div>
          <h2 id="hosting-providers-title" className="text-sm font-semibold text-foreground">
            Hosting providers
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground/80">
            Detected on this machine. Sign-in stays with each provider&rsquo;s own tool.
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => void rescan()}
                disabled={isRefreshing}
                aria-label="Rescan hosting providers and repositories"
              >
                <RefreshCwIcon className={cn("size-3.5", isRefreshing && "animate-spin")} />
              </Button>
            }
          />
          <TooltipPopup side="left">Rescan hosting providers and repository remotes</TooltipPopup>
        </Tooltip>
      </div>

      {discovery.data === null && discovery.isPending ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      ) : providers.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
          No hosting-provider probes were reported. Rescan to ask this machine again.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {providers.map((provider) => {
            const standing = providerStanding(result, provider.kind);
            return (
              <li key={provider.kind} className="rounded-xl border border-border/70 px-3 py-2.5">
                <div className="flex items-start gap-2.5">
                  <HostingProviderMark
                    provider={provider.kind}
                    tone={
                      standing.kind === "authenticated"
                        ? "ready"
                        : standing.kind === "not-signed-in"
                          ? "warning"
                          : "neutral"
                    }
                  />
                  <div className="min-w-0 text-xs">
                    <p className="font-medium text-foreground">{standing.label}</p>
                    <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1 text-muted-foreground">
                      <span>{standing.summary}</span>
                      {standing.account === null ? null : (
                        <>
                          <span aria-hidden>as</span>
                          <RedactedSensitiveText
                            value={standing.account}
                            ariaLabel={`Toggle ${standing.label} account visibility`}
                            revealTooltip="Click to reveal account"
                            hideTooltip="Click to hide account"
                          />
                        </>
                      )}
                    </p>
                    {standing.remedy === null ? null : (
                      <p className="mt-1 text-muted-foreground/80">{standing.remedy}</p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
