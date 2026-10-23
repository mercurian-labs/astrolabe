import type { DpopFailureReason } from "@t3tools/contracts";
import type { RelayEnvironmentStatusResponse, RelayProtectedError } from "@t3tools/contracts/relay";

export const DPOP_CLOCK_HINT =
  "Hint: Check that automatic date and time is enabled on both devices, then try again.";

/** Older servers omit the DPoP category, but newer servers can also omit it for
 * a credential failure that happens after proof verification. */
export const DPOP_UNKNOWN_HINT =
  "Hint: Try again. If it still fails, clock skew may be the cause; check that automatic date and time is enabled on both devices.";

export const DPOP_RETRY_HINT = "Hint: Try again. If the problem continues, copy the trace ID.";

function dpopFailureHint(reason: DpopFailureReason | undefined): string {
  if (reason === "time_window") return DPOP_CLOCK_HINT;
  if (reason === undefined) return DPOP_UNKNOWN_HINT;
  return DPOP_RETRY_HINT;
}

export function dpopFailureMessage(message: string, reason: DpopFailureReason | undefined): string {
  return `${message} ${dpopFailureHint(reason)}`;
}

export function relayProtectedErrorMessage(error: RelayProtectedError): string {
  switch (error._tag) {
    case "RelayAuthInvalidError":
      switch (error.reason) {
        case "missing_bearer":
        case "invalid_bearer":
          return "Remote access rejected your Astrolabe session.";
        case "invalid_dpop":
          return dpopFailureMessage(
            "Remote access rejected the request signature.",
            error.dpopFailureReason,
          );
        case "not_authorized":
          return "Remote access rejected the request.";
      }
    case "RelayEnvironmentLinkProofExpiredError":
      return "Remote access rejected an expired environment link proof.";
    case "RelayEnvironmentLinkProofInvalidError":
      return `Remote access rejected the environment link proof (${error.reason}).`;
    case "RelayEnvironmentConnectNotAuthorizedError":
      // "Not authorized" covers non-auth causes too; surface the reason so a
      // missing link does not read as a credential problem.
      if (error.reason === "environment_link_not_found") {
        return "Remote access has no active link for this environment. If it was removed from your account, link it again on that machine.";
      }
      if (error.reason === "managed_endpoint_allocation_not_ready") {
        return "The environment's remote access tunnel is still being set up.";
      }
      if (error.reason === "endpoint_provider_not_managed") {
        return "This environment is linked only to publish agent activity, so it cannot accept connections. On that computer, open Settings > Connections and turn remote access on.";
      }
      return error.reason
        ? `Remote access rejected the connection request (${error.reason}).`
        : "Remote access rejected the connection request.";
    case "RelayEnvironmentEndpointUnavailableError":
      return `Remote access could not reach the environment (${error.reason}).`;
    case "RelayEnvironmentEndpointTimedOutError":
      return "Remote access timed out while contacting the environment.";
    case "RelayEnvironmentLinkFailedError":
      return `Could not turn on remote access for this environment (${error.reason}).`;
    case "RelayEnvironmentLinkUnavailableError":
      return `Could not set up the remote access tunnel (${error.reason}).${
        error.provisioningStage ? ` Failed stage: ${error.provisioningStage}.` : ""
      }`;
    case "RelayEnvironmentLinkLimitExceededError":
      return `Could not turn on remote access: this account already has its maximum of ${error.maxTunnels} remote access tunnels. Turn off remote access for another environment to free one up.`;
    case "RelayAgentActivityPublishProofExpiredError":
      return "Remote access rejected an expired agent activity proof.";
    case "RelayAgentActivityPublishProofInvalidError":
      return `Remote access rejected the agent activity proof (${error.reason}).`;
    case "RelayInternalError":
      return `Remote access encountered an internal error (${error.reason}).`;
  }
}

// The relay cuts off a request it cannot finish in time with a 504 that no
// endpoint declares, so the client sees only the status.
export const RELAY_GATEWAY_TIMEOUT_MESSAGE =
  "Remote access timed out before it finished the request (HTTP 504). Try again in a few minutes. If it keeps failing, copy the trace ID when you report it.";

export function relayRequestFailureDetail(error: {
  readonly relayError?: RelayProtectedError | undefined;
  readonly status?: number | undefined;
}): string | null {
  if (error.relayError) return relayProtectedErrorMessage(error.relayError);
  if (error.status === 504) return RELAY_GATEWAY_TIMEOUT_MESSAGE;
  if (error.status !== undefined)
    return `Remote access returned an unexpected HTTP ${error.status}.`;
  return null;
}

const RELAY_TUNNEL_RELEASED_MESSAGE =
  "Offline for a while, so its remote access tunnel was removed. Start Astrolabe on that computer and update it to the latest version to reconnect.";

export function relayOfflineReasonMessage(
  status: Pick<RelayEnvironmentStatusResponse, "offlineReason">,
): string | null {
  switch (status.offlineReason) {
    case "tunnel_released":
      return RELAY_TUNNEL_RELEASED_MESSAGE;
    case undefined:
      return null;
  }
}
