import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthRelayReadScope,
  AuthRelayWriteScope,
  MERCURIAN_MEMORY_WS_METHODS,
  MERCURIAN_WS_METHODS,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { RPC_REQUIRED_SCOPES, requiredScopeForRpcMethod } from "./RpcAuthorization.ts";

describe("RPC authorization scopes", () => {
  it("declares exactly one scope for every RPC in the server group", () => {
    expect(new Set(Object.keys(RPC_REQUIRED_SCOPES))).toEqual(new Set(WsRpcGroup.requests.keys()));
  });

  it("authorizes background policy reporting and observation deliberately", () => {
    expect(requiredScopeForRpcMethod(WS_METHODS.serverReportClientActivity)).toBe(
      AuthOrchestrationReadScope,
    );
    expect(requiredScopeForRpcMethod(WS_METHODS.serverReportHostPowerState)).toBe(
      AuthOrchestrationOperateScope,
    );
    expect(requiredScopeForRpcMethod(WS_METHODS.serverGetBackgroundPolicy)).toBe(
      AuthOrchestrationReadScope,
    );
    expect(requiredScopeForRpcMethod(WS_METHODS.subscribeBackgroundPolicy)).toBe(
      AuthOrchestrationReadScope,
    );
  });

  it("allows relay status reads without granting relay installation access", () => {
    expect(requiredScopeForRpcMethod(WS_METHODS.cloudGetRelayClientStatus)).toBe(
      AuthRelayReadScope,
    );
    expect(requiredScopeForRpcMethod(WS_METHODS.cloudInstallRelayClient)).toBe(AuthRelayWriteScope);
  });

  it("separates memory reads from review, revert, and merge mutations", () => {
    expect(requiredScopeForRpcMethod(MERCURIAN_MEMORY_WS_METHODS.readLineMemoryChanges)).toBe(
      AuthOrchestrationReadScope,
    );
    for (const method of [
      MERCURIAN_MEMORY_WS_METHODS.readMemoryCatalog,
      MERCURIAN_MEMORY_WS_METHODS.readMemoryDashboard,
      MERCURIAN_MEMORY_WS_METHODS.readMemoryDocument,
      MERCURIAN_MEMORY_WS_METHODS.readMemoryComparison,
      MERCURIAN_MEMORY_WS_METHODS.subscribeMemoryInvalidations,
    ])
      expect(requiredScopeForRpcMethod(method)).toBe(AuthOrchestrationReadScope);
    for (const method of [
      MERCURIAN_MEMORY_WS_METHODS.markMemoryChangeReviewed,
      MERCURIAN_MEMORY_WS_METHODS.revertMemoryChange,
      MERCURIAN_MEMORY_WS_METHODS.mergeMemoryHome,
    ]) {
      expect(requiredScopeForRpcMethod(method)).toBe(AuthOrchestrationOperateScope);
    }
  });

  it("allows reconstruction inspection with read access", () => {
    expect(requiredScopeForRpcMethod(MERCURIAN_WS_METHODS.getReconstruction)).toBe(
      AuthOrchestrationReadScope,
    );
