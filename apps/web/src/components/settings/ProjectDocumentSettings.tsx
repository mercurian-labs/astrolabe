import type { EnvironmentId } from "@t3tools/contracts";
import { Fragment } from "react";

import { WikiCanvasSettings } from "./WikiCanvasSettings";
import { WikiLocationSettings } from "./WikiLocationSettings";
import { WikiMapBackgrounds } from "./WikiMapBackgrounds";

/**
 * Astrolabe: how documents behave on each server the project has a checkout on: where new files
 * land, canvases, and map backgrounds. Each is the server's, so it holds for its every project.
 */
export function ProjectDocumentSettings({
  members,
}: {
  readonly members: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly environmentLabel: string | null;
  }>;
}) {
  const servers = [...new Map(members.map((member) => [member.environmentId, member])).values()];
  return servers.map(({ environmentId, environmentLabel }) => {
    const serverLabel = servers.length < 2 ? null : environmentLabel;
    return (
      <Fragment key={environmentId}>
        <WikiLocationSettings environmentId={environmentId} serverLabel={serverLabel} />
        <WikiCanvasSettings environmentId={environmentId} serverLabel={serverLabel} />
        <WikiMapBackgrounds environmentId={environmentId} serverLabel={serverLabel} />
      </Fragment>
    );
  });
}
