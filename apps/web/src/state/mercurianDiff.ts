import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { MERCURIAN_WS_METHODS } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";

/** The line's ref-backed delta beyond its branch, independent of slot ownership. */
export const lineUncommittedDiff = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:mercurian:line-uncommitted-diff",
  tag: MERCURIAN_WS_METHODS.readLineUncommittedDiff,
  staleTimeMs: 5_000,
});
