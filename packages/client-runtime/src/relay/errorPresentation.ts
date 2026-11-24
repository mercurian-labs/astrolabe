import type { DpopFailureReason } from "@t3tools/contracts";
import type { RelayEnvironmentStatusResponse, RelayProtectedError } from "@t3tools/contracts/relay";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

import { type MarkedText, resolveMarkedText } from "../errors/translatable.ts";

export const DPOP_CLOCK_HINT = msg(
  "Hint: Check that automatic date and time is enabled on both devices, then try again.",
);

/** Older servers omit the DPoP category, but newer servers can also omit it for
 * a credential failure that happens after proof verification. */
export const DPOP_UNKNOWN_HINT = msg(
  "Hint: Try again. If it still fails, clock skew may be the cause; check that automatic date and time is enabled on both devices.",
);

export const DPOP_RETRY_HINT = msg("Hint: Try again. If the problem continues, copy the trace ID.");

function dpopFailureHint(reason: DpopFailureReason | undefined): string {
  if (reason === "time_window") return DPOP_CLOCK_HINT;
  if (reason === undefined) return DPOP_UNKNOWN_HINT;
  return DPOP_RETRY_HINT;
}

export function dpopFailureText(
  message: string,
  reason: DpopFailureReason | undefined,
): MarkedText {
  return [message, dpopFailureHint(reason)];
}

/** The relay's refusal as marked sentences, for errors that carry `i18nMessage`. */
export function relayProtectedErrorText(error: RelayProtectedError): MarkedText {
  switch (error._tag) {
    case "RelayAuthInvalidError":
      switch (error.reason) {
        case "missing_bearer":
        case "invalid_bearer":
          return [msg("Remote access rejected your Astrolabe session.")];
        case "invalid_dpop":
          return dpopFailureText(
            msg("Remote access rejected the request signature."),
            error.dpopFailureReason,
          );
        case "not_authorized":
          return [msg("Remote access rejected the request.")];
      }
    case "RelayEnvironmentLinkProofExpiredError":
      return [msg("Remote access rejected an expired environment link proof.")];
    case "RelayEnvironmentLinkProofInvalidError":
      return [
        msg("Remote access rejected the environment link proof ({reason}).", {
          reason: error.reason,
        }),
      ];
    case "RelayEnvironmentConnectNotAuthorizedError":
      // "Not authorized" covers non-auth causes too; surface the reason so a
      // missing link does not read as a credential problem.
      if (error.reason === "environment_link_not_found") {
        return [
          msg(
            "Remote access has no active link for this environment. If it was removed from your account, link it again on that machine.",
          ),
        ];
      }
      if (error.reason === "managed_endpoint_allocation_not_ready") {
        return [msg("The environment's remote access tunnel is still being set up.")];
      }
      if (error.reason === "endpoint_provider_not_managed") {
        return [
          msg(
            "This environment is linked only to publish agent activity, so it cannot accept connections. On that computer, open Settings > Sharing & access and turn remote access on.",
          ),
        ];
      }
      return error.reason
        ? [
            msg("Remote access rejected the connection request ({reason}).", {
              reason: error.reason,
            }),
          ]
        : [msg("Remote access rejected the connection request.")];
    case "RelayEnvironmentEndpointUnavailableError":
      return [
        msg("Remote access could not reach the environment ({reason}).", { reason: error.reason }),
      ];
    case "RelayEnvironmentEndpointTimedOutError":
      return [msg("Remote access timed out while contacting the environment.")];
    case "RelayEnvironmentLinkFailedError":
      return [
        msg("Could not turn on remote access for this environment ({reason}).", {
          reason: error.reason,
        }),
      ];
    case "RelayEnvironmentLinkUnavailableError":
      return error.provisioningStage
        ? [
            msg("Could not set up the remote access tunnel ({reason}). Failed stage: {stage}.", {
              reason: error.reason,
              stage: error.provisioningStage,
            }),
          ]
        : [
            msg("Could not set up the remote access tunnel ({reason}).", {
              reason: error.reason,
            }),
          ];
    case "RelayEnvironmentLinkLimitExceededError":
      return [
        msg(
          "Could not turn on remote access: this account already has its maximum of {maxTunnels} remote access tunnels. Turn off remote access for another environment to free one up.",
          { maxTunnels: error.maxTunnels },
        ),
      ];
    case "RelayAgentActivityPublishProofExpiredError":
      return [msg("Remote access rejected an expired agent activity proof.")];
    case "RelayAgentActivityPublishProofInvalidError":
      return [
        msg("Remote access rejected the agent activity proof ({reason}).", {
          reason: error.reason,
        }),
      ];
    case "RelayInternalError":
      return [
        msg("Remote access encountered an internal error ({reason}).", { reason: error.reason }),
      ];
  }
}

export function relayProtectedErrorMessage(
  error: RelayProtectedError,
  resolve: MFunctionType = mFallback,
): string {
  return resolveMarkedText(relayProtectedErrorText(error), resolve);
}

// The relay cuts off a request it cannot finish in time with a 504 that no
// endpoint declares, so the client sees only the status.
export const RELAY_GATEWAY_TIMEOUT_MESSAGE = msg(
  "Remote access timed out before it finished the request (HTTP 504). Try again in a few minutes. If it keeps failing, copy the trace ID when you report it.",
);

export function relayRequestFailureText(error: {
  readonly relayError?: RelayProtectedError | undefined;
  readonly status?: number | undefined;
}): MarkedText | null {
  if (error.relayError) return relayProtectedErrorText(error.relayError);
  if (error.status === 504) return [RELAY_GATEWAY_TIMEOUT_MESSAGE];
  if (error.status !== undefined)
    return [msg("Remote access returned an unexpected HTTP {status}.", { status: error.status })];
  return null;
}

export function relayRequestFailureDetail(
  error: {
    readonly relayError?: RelayProtectedError | undefined;
    readonly status?: number | undefined;
  },
  resolve: MFunctionType = mFallback,
): string | null {
  const text = relayRequestFailureText(error);
  return text === null ? null : resolveMarkedText(text, resolve);
}

export function relayOfflineReasonMessage(
  status: Pick<RelayEnvironmentStatusResponse, "offlineReason">,
  resolve: MFunctionType = mFallback,
): string | null {
  switch (status.offlineReason) {
    case "tunnel_released":
      return resolve(
        msg(
          "Offline for a while, so its remote access tunnel was removed. Start Astrolabe on that computer and update it to the latest version to reconnect.",
        ),
      );
    case undefined:
      return null;
  }
}
