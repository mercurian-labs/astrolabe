import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { environmentPresentations } from "~/state/presentation";
import { serverEnvironment } from "~/state/server";

/**
 * Whether this environment offers "Share with guest": the user may create links there, and its
 * Guest links beta is on (Settings > Labs). The server refuses links while the beta is off.
 * Astrolabe: links travel over remote access, so builds without cloud config never offer them.
 */
export const canShareWithGuestAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(
    (get) =>
      hasCloudPublicConfig() &&
      get(serverEnvironment.createGuestShare.permissionAtom(environmentId)) &&
      get(environmentPresentations.serverConfigsAtom).get(environmentId)?.settings
        .guestSharingEnabled === true,
  ).pipe(Atom.withLabel(`guest-share:available:${environmentId}`)),
);
