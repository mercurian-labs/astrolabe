import {
  AuthAccessReadScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthRelayReadScope,
  AuthRelayWriteScope,
  AuthReviewWriteScope,
  AuthTerminalOperateScope,
  MERCURIAN_REPOSITORY_WS_METHODS,
  MERCURIAN_TRACKER_WS_METHODS,
  MERCURIAN_WORKSPACE_WS_METHODS,
  MERCURIAN_WS_METHODS,
  ORCHESTRATION_WS_METHODS,
  type AuthEnvironmentScope,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";

type WsRpcMethod = RpcGroup.Rpcs<typeof WsRpcGroup>["_tag"];

/**
 * Keep authorization coverage coupled to the RPC group itself. Adding an RPC to
 * `WsRpcGroup` without choosing a scope is a type error instead of a production
 * runtime failure.
 */
export const RPC_REQUIRED_SCOPES = {
  [ORCHESTRATION_WS_METHODS.dispatchCommand]: AuthOrchestrationOperateScope,
  [ORCHESTRATION_WS_METHODS.getTurnDiff]: AuthOrchestrationReadScope,
  [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: AuthOrchestrationReadScope,
  [ORCHESTRATION_WS_METHODS.searchThreads]: AuthOrchestrationReadScope,
  [ORCHESTRATION_WS_METHODS.subscribeShell]: AuthOrchestrationReadScope,
  [ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot]: AuthOrchestrationReadScope,
  [ORCHESTRATION_WS_METHODS.subscribeThread]: AuthOrchestrationReadScope,
  // Planning is workspace orchestration in the same trust domain; a
  // Mercurian-specific scope would force re-pairing for a boundary that does
  // not exist yet. Revisit with shared workspaces.
  [MERCURIAN_WS_METHODS.subscribeTree]: AuthOrchestrationReadScope,
  [MERCURIAN_WS_METHODS.subscribePlan]: AuthOrchestrationReadScope,
  [MERCURIAN_WS_METHODS.getPlanTextAt]: AuthOrchestrationReadScope,
  [MERCURIAN_WS_METHODS.createProject]: AuthOrchestrationOperateScope,
  [MERCURIAN_WS_METHODS.createPlan]: AuthOrchestrationOperateScope,
  [MERCURIAN_WS_METHODS.appendPlanMessage]: AuthOrchestrationOperateScope,
  [MERCURIAN_WS_METHODS.savePlanRevision]: AuthOrchestrationOperateScope,
  // A plan's disappearance, reversible or not.
  [MERCURIAN_WS_METHODS.archivePlan]: AuthOrchestrationOperateScope,
  [MERCURIAN_WS_METHODS.unarchivePlan]: AuthOrchestrationOperateScope,
  [MERCURIAN_WS_METHODS.deletePlan]: AuthOrchestrationOperateScope,
  // Attention is state every window reads, so recording it is a write.
  [MERCURIAN_WS_METHODS.visitPlan]: AuthOrchestrationOperateScope,
  [MERCURIAN_WS_METHODS.markPlanUnread]: AuthOrchestrationOperateScope,
  // The registry is the same trust domain by the same reasoning: reading what
  // code the app can reach, and changing it, are workspace orchestration.
  [MERCURIAN_REPOSITORY_WS_METHODS.subscribeRepositories]: AuthOrchestrationReadScope,
  [MERCURIAN_REPOSITORY_WS_METHODS.addRepository]: AuthOrchestrationOperateScope,
  [MERCURIAN_REPOSITORY_WS_METHODS.removeRepository]: AuthOrchestrationOperateScope,
  [MERCURIAN_REPOSITORY_WS_METHODS.saveRepositoryScripts]: AuthOrchestrationOperateScope,
  [MERCURIAN_REPOSITORY_WS_METHODS.setProjectRepositories]: AuthOrchestrationOperateScope,
  // Tracker connections likewise: connecting and disconnecting are operations;
  // seeing where a connection stands, and reading the issues it reaches, are
  // reads.
  [MERCURIAN_TRACKER_WS_METHODS.subscribeTrackers]: AuthOrchestrationReadScope,
  [MERCURIAN_TRACKER_WS_METHODS.listTrackerIssues]: AuthOrchestrationReadScope,
  [MERCURIAN_TRACKER_WS_METHODS.connectTracker]: AuthOrchestrationOperateScope,
  [MERCURIAN_TRACKER_WS_METHODS.disconnectTracker]: AuthOrchestrationOperateScope,
  // Workspace settings likewise: the planning model is workspace configuration,
  // and it names no instance, so it carries no machine-scoped authority.
  [MERCURIAN_WORKSPACE_WS_METHODS.subscribeWorkspaceSettings]: AuthOrchestrationReadScope,
  [MERCURIAN_WORKSPACE_WS_METHODS.setPlanningModel]: AuthOrchestrationOperateScope,
  [WS_METHODS.serverProbe]: AuthOrchestrationReadScope,
  [WS_METHODS.serverGetConfig]: AuthOrchestrationReadScope,
  [WS_METHODS.serverRefreshProviders]: AuthOrchestrationOperateScope,
  [WS_METHODS.serverUpdateProvider]: AuthOrchestrationOperateScope,
  [WS_METHODS.serverUpdateServer]: AuthOrchestrationOperateScope,
  [WS_METHODS.serverUpdateServerWithProgress]: AuthOrchestrationOperateScope,
  [WS_METHODS.serverUpsertKeybinding]: AuthOrchestrationOperateScope,
  [WS_METHODS.serverRemoveKeybinding]: AuthOrchestrationOperateScope,
  [WS_METHODS.serverGetSettings]: AuthOrchestrationReadScope,
  [WS_METHODS.serverUpdateSettings]: AuthOrchestrationOperateScope,
  [WS_METHODS.serverDiscoverSourceControl]: AuthOrchestrationReadScope,
  [WS_METHODS.serverGetTraceDiagnostics]: AuthOrchestrationReadScope,
  [WS_METHODS.serverGetProcessDiagnostics]: AuthOrchestrationReadScope,
  [WS_METHODS.serverGetProcessResourceHistory]: AuthOrchestrationReadScope,
  [WS_METHODS.serverGetResourceTelemetryHistory]: AuthOrchestrationReadScope,
  [WS_METHODS.serverRetryResourceTelemetry]: AuthOrchestrationOperateScope,
  [WS_METHODS.serverSignalProcess]: AuthOrchestrationOperateScope,
  [WS_METHODS.serverReportClientActivity]: AuthOrchestrationReadScope,
  [WS_METHODS.serverReportHostPowerState]: AuthOrchestrationOperateScope,
  [WS_METHODS.serverGetBackgroundPolicy]: AuthOrchestrationReadScope,
  [WS_METHODS.cloudGetRelayClientStatus]: AuthRelayReadScope,
  [WS_METHODS.cloudInstallRelayClient]: AuthRelayWriteScope,
  [WS_METHODS.sourceControlLookupRepository]: AuthOrchestrationReadScope,
  [WS_METHODS.sourceControlCloneRepository]: AuthOrchestrationOperateScope,
  [WS_METHODS.sourceControlPublishRepository]: AuthOrchestrationOperateScope,
  [WS_METHODS.projectsListEntries]: AuthOrchestrationReadScope,
  [WS_METHODS.projectsReadFile]: AuthOrchestrationReadScope,
  [WS_METHODS.projectsSearchContents]: AuthOrchestrationReadScope,
  [WS_METHODS.projectsSearchEntries]: AuthOrchestrationReadScope,
  [WS_METHODS.projectsWriteFile]: AuthOrchestrationOperateScope,
  [WS_METHODS.shellOpenInEditor]: AuthOrchestrationOperateScope,
  [WS_METHODS.filesystemBrowse]: AuthOrchestrationReadScope,
  [WS_METHODS.assetsCreateUrl]: AuthOrchestrationReadScope,
  [WS_METHODS.subscribeVcsStatus]: AuthOrchestrationReadScope,
  [WS_METHODS.subscribeResourceTelemetry]: AuthOrchestrationReadScope,
  [WS_METHODS.vcsRefreshStatus]: AuthOrchestrationReadScope,
  [WS_METHODS.vcsPull]: AuthOrchestrationOperateScope,
  [WS_METHODS.gitRunStackedAction]: AuthOrchestrationOperateScope,
  [WS_METHODS.gitResolvePullRequest]: AuthOrchestrationOperateScope,
  [WS_METHODS.gitPreparePullRequestThread]: AuthOrchestrationOperateScope,
  [WS_METHODS.vcsListRefs]: AuthOrchestrationReadScope,
  [WS_METHODS.vcsCreateWorktree]: AuthOrchestrationOperateScope,
  [WS_METHODS.vcsRemoveWorktree]: AuthOrchestrationOperateScope,
  [WS_METHODS.vcsCreateRef]: AuthOrchestrationOperateScope,
  [WS_METHODS.vcsSwitchRef]: AuthOrchestrationOperateScope,
  [WS_METHODS.vcsInit]: AuthOrchestrationOperateScope,
  [WS_METHODS.reviewGetDiffPreview]: AuthReviewWriteScope,
  [WS_METHODS.terminalOpen]: AuthTerminalOperateScope,
  [WS_METHODS.terminalAttach]: AuthTerminalOperateScope,
  [WS_METHODS.terminalWrite]: AuthTerminalOperateScope,
  [WS_METHODS.terminalResize]: AuthTerminalOperateScope,
  [WS_METHODS.terminalClear]: AuthTerminalOperateScope,
  [WS_METHODS.terminalRestart]: AuthTerminalOperateScope,
  [WS_METHODS.terminalClose]: AuthTerminalOperateScope,
  [WS_METHODS.subscribeTerminalEvents]: AuthTerminalOperateScope,
  [WS_METHODS.subscribeTerminalMetadata]: AuthTerminalOperateScope,
  [WS_METHODS.previewOpen]: AuthOrchestrationOperateScope,
  [WS_METHODS.previewNavigate]: AuthOrchestrationOperateScope,
  [WS_METHODS.previewResize]: AuthOrchestrationOperateScope,
  [WS_METHODS.previewRefresh]: AuthOrchestrationOperateScope,
  [WS_METHODS.previewClose]: AuthOrchestrationOperateScope,
  [WS_METHODS.previewList]: AuthOrchestrationReadScope,
  [WS_METHODS.previewReportStatus]: AuthOrchestrationOperateScope,
  [WS_METHODS.previewAutomationConnect]: AuthOrchestrationOperateScope,
  [WS_METHODS.previewAutomationRespond]: AuthOrchestrationOperateScope,
  [WS_METHODS.previewAutomationFocusHost]: AuthOrchestrationOperateScope,
  [WS_METHODS.subscribePreviewEvents]: AuthOrchestrationReadScope,
  [WS_METHODS.subscribeDiscoveredLocalServers]: AuthOrchestrationReadScope,
  [WS_METHODS.subscribeServerConfig]: AuthOrchestrationReadScope,
  [WS_METHODS.subscribeServerLifecycle]: AuthOrchestrationReadScope,
  [WS_METHODS.subscribeAuthAccess]: AuthAccessReadScope,
  [WS_METHODS.subscribeBackgroundPolicy]: AuthOrchestrationReadScope,
} as const satisfies Readonly<Record<WsRpcMethod, AuthEnvironmentScope>>;

export function requiredScopeForRpcMethod(method: string): AuthEnvironmentScope {
  if (!Object.hasOwn(RPC_REQUIRED_SCOPES, method)) {
    throw new Error(`RPC method ${method} has no declared authorization scope.`);
  }
  const requiredScope = RPC_REQUIRED_SCOPES[method as WsRpcMethod];
  if (requiredScope === undefined) {
    throw new Error(`RPC method ${method} has no declared authorization scope.`);
  }
  return requiredScope;
}
