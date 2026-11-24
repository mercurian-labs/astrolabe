import React from "react";
import ReactDOM from "react-dom/client";

import "@fontsource-variable/inter";
import "./index.css";

import { ManagedRelayAuthProvider } from "./cloud/managedAuth";
import { hasCloudPublicConfig } from "./cloud/publicConfig";
import { startAppServices } from "./appInit";
import { AppRoot } from "./AppRoot";
import { whenLocaleReady } from "./i18n/runtime";
import { reloadOnceForChunkLoadError } from "./lib/chunkReloadGuard";

const router = startAppServices();

// A failed split-chunk fetch usually means the hashed assets went stale under
// a deploy; one guarded reload picks up the fresh index.html.
let reloadScheduled = false;
window.addEventListener("vite:preloadError", (event) => {
  if (reloadOnceForChunkLoadError()) {
    reloadScheduled = true;
    event.preventDefault();
  }
});

const app = <AppRoot router={router} />;

export const startup = router
  .load()
  // Settings have usually hydrated by then; English resolves without a chunk load.
  .then(whenLocaleReady)
  .then(() => {
    // Route chunk failures resolve router.load() and surface later through the error boundary.
    if (reloadScheduled) return;
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        {hasCloudPublicConfig() ? <ManagedRelayAuthProvider>{app}</ManagedRelayAuthProvider> : app}
      </React.StrictMode>,
    );
  })
  .catch((error: unknown) => {
    if (reloadScheduled) return;
    throw error;
  });
