import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Globe2Icon } from "lucide-react";

import { useThreadDiscoveredPorts } from "../../portDiscoveryState";
import { isPreviewSupportedInRuntime } from "../../previewStateStore";
import { previewEnvironment } from "../../state/preview";
import { useAtomCommand } from "../../state/use-atom-command";
import { openDiscoveredPort } from "../preview/openDiscoveredPort";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { sessionPreviewOffers } from "./SessionPreviewOffer.logic";

export function SessionPreviewOffer(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  if (!isPreviewSupportedInRuntime()) return null;
  return <DesktopSessionPreviewOffer {...props} />;
}

function DesktopSessionPreviewOffer(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const ports = useThreadDiscoveredPorts(props);
  const offers = sessionPreviewOffers(ports);
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const threadRef = scopeThreadRef(props.environmentId, props.threadId);

  if (offers.length === 0) return null;

  return offers.map((offer) => (
    <WorkspaceBreadcrumbItem key={`${offer.port.host}:${offer.port.port}`}>
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-border bg-muted/45 px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Open ${offer.label}`}
        onClick={() => {
          void openDiscoveredPort({ threadRef, port: offer.port, openPreview }).then((result) => {
            if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
            const error = squashAtomCommandFailure(result);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Unable to open preview",
                description:
                  error instanceof Error ? error.message : "The preview could not be opened.",
              }),
            );
          });
        }}
      >
        <Globe2Icon className="size-3" />
        {offer.label}
      </button>
    </WorkspaceBreadcrumbItem>
  ));
}
