import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import {
  ProviderAuthCancelInput,
  ProviderAuthCompleteInput,
  ProviderAuthState,
  ProviderInstallCancelInput,
  ProviderInstallState,
  ProviderSetupError,
  ProviderSetupInput,
} from "./providerSetup.ts";

import { ExternalLauncherError, LaunchEditorInput } from "./editor.ts";
import {
  AuthAccessStreamError,
  AuthAccessStreamEvent,
  EnvironmentAuthorizationError,
} from "./auth.ts";
import {
  BackgroundPolicySnapshot,
  ClientActivityReportInput,
  HostPowerSnapshot,
} from "./background.ts";
import {
  FilesystemBrowseInput,
  FilesystemBrowseResult,
  FilesystemBrowseError,
} from "./filesystem.ts";
import {
  AssetAccessError,
  AssetCreateUrlInput,
  AssetCreateUrlResult,
  AttachmentCreateUploadUrlInput,
  AttachmentCreateUploadUrlResult,
  AttachmentDeleteInput,
  AttachmentUploadSigningKeyError,
} from "./assets.ts";
import {
  GitActionProgressEvent,
  VcsSwitchRefInput,
  VcsSwitchRefResult,
  GitCommandError,
  VcsCreateRefInput,
  VcsCreateRefResult,
  VcsCreateWorktreeInput,
  VcsCreateWorktreeResult,
  VcsInitInput,
  VcsListRefsInput,
  VcsListRefsResult,
  GitManagerServiceError,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  VcsPullInput,
  GitPullRequestRefInput,
  VcsPullResult,
  VcsRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  VcsStatusInput,
  VcsStatusResult,
  VcsStatusStreamEvent,
} from "./git.ts";
import {
  ReviewDiffFileContentsInput,
  ReviewDiffFileContentsResult,
  ReviewDiffPreviewError,
  ReviewDiffPreviewInput,
  ReviewDiffPreviewResult,
} from "./review.ts";
import { KeybindingsConfigError } from "./keybindings.ts";
import {
  ClientOrchestrationCommand,
  ORCHESTRATION_WS_METHODS,
  OrchestrationDispatchCommandError,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetSnapshotError,
  OrchestrationSearchThreadsError,
  OrchestrationSearchThreadsInput,
  OrchestrationGetTurnDiffError,
  OrchestrationGetTurnDiffInput,
  OrchestrationRpcSchemas,
  OrchestrationGetWorkflowScriptError,
} from "./orchestration.ts";
import {
  MERCURIAN_WS_METHODS,
  MercurianArchivePlanInput,
  MercurianCreateProjectInput,
  MercurianDeletePlanInput,
  MercurianEnsureProjectRuntimeInput,
  MercurianEnsureProjectRuntimeResult,
  MercurianGetPlanTextAtInput,
  MercurianForkLineInput,
  MercurianOpenLineInput,
  MercurianLineResult,
  MercurianGetSpecAtInput,
  MercurianImportPlanInput,
  MercurianMarkPlanUnreadInput,
  MercurianPlanningError,
  MercurianProject,
  MercurianProjectNotFoundError,
  MercurianSavePlanRevisionInput,
  MercurianSaveSpecRevisionInput,
  MercurianRefreshSpecInput,
  MercurianRefreshSpecResult,
  MercurianSubscribePlanInput,
  MercurianSubscribeTreeInput,
  MercurianSubscribeWorktreeSlotsInput,
  MercurianReadLineUncommittedDiffInput,
  MercurianReadLineUncommittedDiffResult,
  MercurianRecreateLineBranchInput,
  MercurianRecreateLineBranchResult,
  MercurianPlanAcknowledged,
  MercurianUnarchivePlanInput,
  MercurianVisitPlanInput,
  PlanDeleteBlockedError,
  PlanImportResult,
  PlanNotFoundError,
  PlanningTreeStreamItem,
  WorktreeSlotStreamItem,
  PlanRevision,
  PlanSpecRevision,
  PlanStreamItem,
  SpecAt,
  SpecRevisionOutdatedError,
  SpecRefreshUnavailableError,
  PlanTextAt,
  PlanTurnActiveError,
} from "./mercurian.ts";
import {
  MERCURIAN_REPOSITORY_WS_METHODS,
  MercurianAddRepositoryInput,
  MercurianRefreshRepositoriesInput,
  MercurianRemoveRepositoryInput,
  MercurianRepositoriesStreamItem,
  MercurianRepository,
  MercurianRepositoryError,
  MercurianRepositoryNotFoundError,
  MercurianSaveRepositoryScriptsInput,
  MercurianSetProjectRepositoriesInput,
  MercurianSubscribeRepositoriesInput,
  RepositoryAlreadyRegisteredError,
  RepositoryHasLiveWorktreesError,
  RepositoryPathInvalidError,
} from "./mercurianRepositories.ts";
import {
  MERCURIAN_MEMORY_WS_METHODS,
  MemoryNotDesignatedError,
  MemorySourceInvalidError,
  MemorySourcesStreamItem,
  MemoryIndex,
  MercurianLineMemoryChanges,
  MemoryNote,
  MercurianDesignateMemorySourceInput,
  MercurianGenerateProductMapInput,
  MercurianMemoryError,
  MercurianReadMemoryIndexInput,
  MercurianReadMemoryNoteInput,
  MercurianReadLineMemoryChangesInput,
  MercurianMarkMemoryChangeReviewedInput,
  MercurianRevertMemoryChangeInput,
  MercurianMergeMemoryHomeInput,
  MercurianMergeMemoryHomeResult,
  MemoryReviewBlockedError,
  MergeMemoryHomeBlockedError,
  MercurianRemoveMemorySourceInput,
  MercurianSubscribeMemorySourcesInput,
  ProductMapAlreadyExistsError,
  ProductMapCycleError,
} from "./mercurianMemory.ts";
import {
  MERCURIAN_TRACKER_WS_METHODS,
  MercurianConnectTrackerInput,
  MercurianDisconnectTrackerInput,
  MercurianListTrackerIssuesInput,
  MercurianSubscribeTrackersInput,
  MercurianTrackerError,
  TrackerAuthError,
  TrackerConnection,
  TrackerConnectionNotFoundError,
  TrackerIssuePage,
  TrackersStreamItem,
  TrackerUnreachableError,
} from "./mercurianTrackers.ts";
import {
  MERCURIAN_WORKSPACE_WS_METHODS,
  MercurianSubscribeWorkspaceSettingsInput,
  MercurianWorkspaceError,
  WorkspaceSettingsStreamItem,
} from "./mercurianWorkspace.ts";
import {
  ProviderUploadFeedbackError,
  ProviderUploadFeedbackInput,
  ProviderUploadFeedbackResult,
} from "./provider.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import {
  PullRequestActionInput,
  PullRequestActivity,
  PullRequestCommentInput,
  PullRequestCommentUpdateInput,
  PullRequestDetail,
  PullRequestDiffFileContentsInput,
  PullRequestDiffFileContentsResult,
  PullRequestInvalidateInput,
  PullRequestListInput,
  PullRequestListResult,
  PullRequestListStatsInput,
  PullRequestListStatsResult,
  PullRequestOperationError,
  PullRequestReactionInput,
  PullRequestRef,
  PullRequestSummary,
  PullRequestReviewerCandidateList,
  PullRequestReviewerRequestInput,
  PullRequestLabelCandidateList,
  PullRequestLabelChangeInput,
  PullRequestSubmitReviewInput,
  PullRequestThreadCommentsInput,
  PullRequestThreadCommentsResult,
  PullRequestThreadReplyInput,
  PullRequestThreadResolutionInput,
  PullRequestUnavailableError,
  PullRequestUpdateInput,
} from "./pullRequest.ts";
import {
  RelayClientInstallFailedError,
  RelayClientInstallProgressEventSchema,
  RelayClientStatusSchema,
} from "./relayClient.ts";
import {
  ProjectListEntriesError,
  ProjectListEntriesInput,
  ProjectListEntriesResult,
  ProjectReadFileError,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectSearchContentsError,
  ProjectSearchContentsInput,
  ProjectSearchContentsResult,
  ProjectSearchEntriesError,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileError,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project.ts";
import {
  TerminalAttachInput,
  TerminalAttachStreamEvent,
  TerminalClearInput,
  TerminalCloseInput,
  TerminalError,
  TerminalEvent,
  TerminalMetadataStreamEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "./terminal.ts";
import {
  DiscoveredLocalServerList,
  ConfiguredLocalServerUrls,
  PreviewCloseInput,
  PreviewError,
  PreviewEvent,
  PreviewListInput,
  PreviewListResult,
  PreviewNavigateInput,
  PreviewOpenInput,
  PreviewRefreshInput,
  PreviewReportStatusInput,
  PreviewResizeInput,
  PreviewSessionSnapshot,
} from "./preview.ts";
import {
  PreviewAutomationError,
  PreviewAutomationHost,
  PreviewAutomationHostFocus,
  PreviewAutomationResponse,
  PreviewAutomationStreamEvent,
} from "./previewAutomation.ts";
import {
  ServerConfigStreamEvent,
  DesktopUpdateCommitInput,
  ServerConfig,
  ServerProviderUpdateError,
  ServerProviderUpdateInput,
  ServerLifecycleStreamEvent,
  ServerRemoveKeybindingInput,
  ServerRemoveKeybindingResult,
  ServerProviderUpdatedPayload,
  ServerSelfUpdateError,
  ServerSelfUpdateInput,
  ServerSelfUpdateProgressEvent,
  ServerSelfUpdateResult,
  ServerTraceDiagnosticsResult,
  ServerProcessDiagnosticsResult,
  ServerProcessResourceHistoryInput,
  ServerProcessResourceHistoryResult,
  ServerSignalProcessInput,
  ServerSignalProcessResult,
  ServerUpsertKeybindingInput,
  ServerUpsertKeybindingResult,
} from "./server.ts";
import {
  ResourceTelemetryHistory,
  ResourceTelemetryHistoryInput,
  ResourceTelemetryRetryResult,
  ResourceTelemetrySnapshot,
} from "./resourceTelemetry.ts";
import { UsagePricing, UsageReadError, UsageSummary, UsageSummaryInput } from "./usage.ts";
import { ServerSettings, ServerSettingsError, ServerSettingsPatch } from "./settings.ts";
import {
  SourceControlCloneRepositoryInput,
  SourceControlCloneRepositoryResult,
  SourceControlDiscoveryResult,
  SourceControlPublishRepositoryInput,
  SourceControlPublishRepositoryResult,
  SourceControlRepositoryError,
  SourceControlRepositoryInfo,
  SourceControlRepositoryLookupInput,
} from "./sourceControl.ts";
import { VcsError } from "./vcs.ts";

export const WS_METHODS = {
  // Project registry methods
  projectsList: "projects.list",
  projectsAdd: "projects.add",
  projectsRemove: "projects.remove",
  projectsListEntries: "projects.listEntries",
  projectsReadFile: "projects.readFile",
  projectsSearchContents: "projects.searchContents",
  projectsSearchEntries: "projects.searchEntries",
  projectsWriteFile: "projects.writeFile",

  // Shell methods
  shellOpenInEditor: "shell.openInEditor",

  // Filesystem methods
  filesystemBrowse: "filesystem.browse",
  assetsCreateUrl: "assets.createUrl",
  attachmentsCreateUploadUrl: "attachments.createUploadUrl",
  attachmentsDelete: "attachments.delete",

  // Provider methods
  providerUploadFeedback: "provider.uploadFeedback",
  providerAuthStart: "provider.auth.start",
  providerAuthComplete: "provider.auth.complete",
  providerAuthCancel: "provider.auth.cancel",
  providerAuthLogout: "provider.auth.logout",
  providerAuthSubscribe: "provider.auth.subscribe",
  providerInstallStart: "provider.install.start",
  providerInstallCancel: "provider.install.cancel",
  providerInstallSubscribe: "provider.install.subscribe",
  providerInstallRemove: "provider.install.remove",

  // VCS methods
  vcsPull: "vcs.pull",
  vcsRefreshStatus: "vcs.refreshStatus",
  vcsListRefs: "vcs.listRefs",
  vcsCreateWorktree: "vcs.createWorktree",
  vcsRemoveWorktree: "vcs.removeWorktree",
  vcsCreateRef: "vcs.createRef",
  vcsSwitchRef: "vcs.switchRef",
  vcsInit: "vcs.init",

  // Git workflow methods
  gitRunStackedAction: "git.runStackedAction",
  gitResolvePullRequest: "git.resolvePullRequest",
  gitPreparePullRequestThread: "git.preparePullRequestThread",

  // Review methods
  reviewGetDiffPreview: "review.getDiffPreview",
  reviewGetDiffFileContents: "review.getDiffFileContents",

  // Terminal methods
  terminalOpen: "terminal.open",
  terminalAttach: "terminal.attach",
  terminalWrite: "terminal.write",
  terminalResize: "terminal.resize",
  terminalClear: "terminal.clear",
  terminalRestart: "terminal.restart",
  terminalClose: "terminal.close",

  // Preview methods
  previewOpen: "preview.open",
  previewNavigate: "preview.navigate",
  previewResize: "preview.resize",
  previewRefresh: "preview.refresh",
  previewClose: "preview.close",
  previewList: "preview.list",
  previewReportStatus: "preview.reportStatus",
  previewAutomationConnect: "previewAutomation.connect",
  previewAutomationRespond: "previewAutomation.respond",
  previewAutomationFocusHost: "previewAutomation.focusHost",

  // Server meta
  serverProbe: "server.probe",
  serverGetConfig: "server.getConfig",
  serverRefreshProviders: "server.refreshProviders",
  serverUpdateProvider: "server.updateProvider",
  serverUpdateServer: "server.updateServer",
  serverUpdateServerWithProgress: "server.updateServerWithProgress",
  serverCommitDesktopUpdate: "server.commitDesktopUpdate",
  serverUpsertKeybinding: "server.upsertKeybinding",
  serverRemoveKeybinding: "server.removeKeybinding",
  serverGetSettings: "server.getSettings",
  serverUpdateSettings: "server.updateSettings",
  serverDiscoverSourceControl: "server.discoverSourceControl",
  serverGetTraceDiagnostics: "server.getTraceDiagnostics",
  serverGetProcessDiagnostics: "server.getProcessDiagnostics",
  serverGetProcessResourceHistory: "server.getProcessResourceHistory",
  serverGetResourceTelemetryHistory: "server.getResourceTelemetryHistory",
  serverRetryResourceTelemetry: "server.retryResourceTelemetry",
  serverSignalProcess: "server.signalProcess",
  serverReportClientActivity: "server.reportClientActivity",
  serverReportHostPowerState: "server.reportHostPowerState",
  serverGetBackgroundPolicy: "server.getBackgroundPolicy",
  serverGetUsageSummary: "server.getUsageSummary",
  serverRefreshUsageRates: "server.refreshUsageRates",

  // Cloud environment methods
  cloudGetRelayClientStatus: "cloud.getRelayClientStatus",
  cloudInstallRelayClient: "cloud.installRelayClient",

  // Pull request methods
  pullRequestsList: "pullRequests.list",
  pullRequestsListStats: "pullRequests.listStats",
  pullRequestsSummary: "pullRequests.summary",
  pullRequestsDetail: "pullRequests.detail",
  pullRequestsActivity: "pullRequests.activity",
  pullRequestsThreadComments: "pullRequests.threadComments",
  pullRequestsDiffFileContents: "pullRequests.diffFileContents",
  pullRequestsRunAction: "pullRequests.runAction",
  pullRequestsUpdate: "pullRequests.update",
  pullRequestsComment: "pullRequests.comment",
  pullRequestsUpdateComment: "pullRequests.updateComment",
  pullRequestsSubmitReview: "pullRequests.submitReview",
  pullRequestsReplyToThread: "pullRequests.replyToThread",
  pullRequestsSetThreadResolution: "pullRequests.setThreadResolution",
  pullRequestsSetReaction: "pullRequests.setReaction",
  pullRequestsInvalidate: "pullRequests.invalidate",
  pullRequestsReviewerCandidates: "pullRequests.reviewerCandidates",
  pullRequestsRequestReviewers: "pullRequests.requestReviewers",
  pullRequestsLabelCandidates: "pullRequests.labelCandidates",
  pullRequestsSetLabels: "pullRequests.setLabels",

  // Source control methods
  sourceControlLookupRepository: "sourceControl.lookupRepository",
  sourceControlCloneRepository: "sourceControl.cloneRepository",
  sourceControlPublishRepository: "sourceControl.publishRepository",

  // Streaming subscriptions
  subscribeVcsStatus: "subscribeVcsStatus",
  subscribeTerminalEvents: "subscribeTerminalEvents",
  subscribeTerminalMetadata: "subscribeTerminalMetadata",
  subscribePreviewEvents: "subscribePreviewEvents",
  subscribeDiscoveredLocalServers: "subscribeDiscoveredLocalServers",
  subscribeServerConfig: "subscribeServerConfig",
  subscribeServerLifecycle: "subscribeServerLifecycle",
  subscribeAuthAccess: "subscribeAuthAccess",
  subscribeBackgroundPolicy: "subscribeBackgroundPolicy",
  subscribeResourceTelemetry: "subscribeResourceTelemetry",
} as const;

export const WsServerUpsertKeybindingRpc = Rpc.make(WS_METHODS.serverUpsertKeybinding, {
  payload: ServerUpsertKeybindingInput,
  success: ServerUpsertKeybindingResult,
  error: Schema.Union([KeybindingsConfigError, EnvironmentAuthorizationError]),
});

export const WsServerRemoveKeybindingRpc = Rpc.make(WS_METHODS.serverRemoveKeybinding, {
  payload: ServerRemoveKeybindingInput,
  success: ServerRemoveKeybindingResult,
  error: Schema.Union([KeybindingsConfigError, EnvironmentAuthorizationError]),
});

export const WsServerProbeRpc = Rpc.make(WS_METHODS.serverProbe, {
  payload: Schema.Struct({}),
  success: Schema.Struct({}),
  error: EnvironmentAuthorizationError,
});

export const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfig,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError, EnvironmentAuthorizationError]),
});

export const WsServerRefreshProvidersRpc = Rpc.make(WS_METHODS.serverRefreshProviders, {
  payload: Schema.Struct({
    /**
     * When supplied, only refresh this specific provider instance. When
     * omitted, refresh all configured instances — the legacy `refresh()`
     * behaviour retained for transports that still dispatch untargeted
     * refreshes.
     */
    instanceId: Schema.optional(ProviderInstanceId),
    cwd: Schema.optional(TrimmedNonEmptyString),
    /** Explicit user request. Background status refreshes must not open agent sessions. */
    refreshModels: Schema.optional(Schema.Boolean),
  }),
  success: ServerProviderUpdatedPayload,
  error: Schema.Union([EnvironmentAuthorizationError, ProviderSetupError]),
});

export const WsServerUpdateProviderRpc = Rpc.make(WS_METHODS.serverUpdateProvider, {
  payload: ServerProviderUpdateInput,
  success: ServerProviderUpdatedPayload,
  error: Schema.Union([ServerProviderUpdateError, EnvironmentAuthorizationError]),
});

const ProviderSetupRpcError = Schema.Union([ProviderSetupError, EnvironmentAuthorizationError]);

export const WsProviderAuthStartRpc = Rpc.make(WS_METHODS.providerAuthStart, {
  payload: ProviderSetupInput,
  success: ProviderAuthState,
  error: ProviderSetupRpcError,
});

export const WsProviderAuthCompleteRpc = Rpc.make(WS_METHODS.providerAuthComplete, {
  payload: ProviderAuthCompleteInput,
  success: ProviderAuthState,
  error: ProviderSetupRpcError,
});

export const WsProviderAuthCancelRpc = Rpc.make(WS_METHODS.providerAuthCancel, {
  payload: ProviderAuthCancelInput,
  success: ProviderAuthState,
  error: ProviderSetupRpcError,
});

export const WsProviderAuthLogoutRpc = Rpc.make(WS_METHODS.providerAuthLogout, {
  payload: ProviderSetupInput,
  success: ProviderAuthState,
  error: ProviderSetupRpcError,
});

export const WsProviderAuthSubscribeRpc = Rpc.make(WS_METHODS.providerAuthSubscribe, {
  payload: ProviderSetupInput,
  success: ProviderAuthState,
  error: ProviderSetupRpcError,
  stream: true,
});

export const WsProviderInstallStartRpc = Rpc.make(WS_METHODS.providerInstallStart, {
  payload: ProviderSetupInput,
  success: ProviderInstallState,
  error: ProviderSetupRpcError,
});

export const WsProviderInstallCancelRpc = Rpc.make(WS_METHODS.providerInstallCancel, {
  payload: ProviderInstallCancelInput,
  success: ProviderInstallState,
  error: ProviderSetupRpcError,
});

export const WsProviderInstallSubscribeRpc = Rpc.make(WS_METHODS.providerInstallSubscribe, {
  payload: ProviderSetupInput,
  success: ProviderInstallState,
  error: ProviderSetupRpcError,
  stream: true,
});

export const WsProviderInstallRemoveRpc = Rpc.make(WS_METHODS.providerInstallRemove, {
  payload: ProviderSetupInput,
  success: ProviderInstallState,
  error: ProviderSetupRpcError,
});

export const WsServerUpdateServerRpc = Rpc.make(WS_METHODS.serverUpdateServer, {
  payload: ServerSelfUpdateInput,
  success: ServerSelfUpdateResult,
  error: Schema.Union([ServerSelfUpdateError, EnvironmentAuthorizationError]),
});

export const WsServerUpdateServerWithProgressRpc = Rpc.make(
  WS_METHODS.serverUpdateServerWithProgress,
  {
    payload: ServerSelfUpdateInput,
    success: ServerSelfUpdateProgressEvent,
    error: Schema.Union([ServerSelfUpdateError, EnvironmentAuthorizationError]),
    stream: true,
  },
);

export const WsServerCommitDesktopUpdateRpc = Rpc.make(WS_METHODS.serverCommitDesktopUpdate, {
  payload: DesktopUpdateCommitInput,
  success: ServerSelfUpdateResult,
  error: Schema.Union([ServerSelfUpdateError, EnvironmentAuthorizationError]),
});

export const WsServerGetSettingsRpc = Rpc.make(WS_METHODS.serverGetSettings, {
  payload: Schema.Struct({}),
  success: ServerSettings,
  error: Schema.Union([ServerSettingsError, EnvironmentAuthorizationError]),
});

export const WsServerUpdateSettingsRpc = Rpc.make(WS_METHODS.serverUpdateSettings, {
  payload: Schema.Struct({ patch: ServerSettingsPatch }),
  success: ServerSettings,
  error: Schema.Union([ServerSettingsError, EnvironmentAuthorizationError]),
});

export const WsServerDiscoverSourceControlRpc = Rpc.make(WS_METHODS.serverDiscoverSourceControl, {
  payload: Schema.Struct({}),
  success: SourceControlDiscoveryResult,
  error: EnvironmentAuthorizationError,
});

export const WsServerGetTraceDiagnosticsRpc = Rpc.make(WS_METHODS.serverGetTraceDiagnostics, {
  payload: Schema.Struct({}),
  success: ServerTraceDiagnosticsResult,
  error: EnvironmentAuthorizationError,
});

export const WsServerGetProcessDiagnosticsRpc = Rpc.make(WS_METHODS.serverGetProcessDiagnostics, {
  payload: Schema.Struct({}),
  success: ServerProcessDiagnosticsResult,
  error: EnvironmentAuthorizationError,
});

export const WsServerGetProcessResourceHistoryRpc = Rpc.make(
  WS_METHODS.serverGetProcessResourceHistory,
  {
    payload: ServerProcessResourceHistoryInput,
    success: ServerProcessResourceHistoryResult,
    error: EnvironmentAuthorizationError,
  },
);

export const WsServerGetResourceTelemetryHistoryRpc = Rpc.make(
  WS_METHODS.serverGetResourceTelemetryHistory,
  {
    payload: ResourceTelemetryHistoryInput,
    success: ResourceTelemetryHistory,
    error: EnvironmentAuthorizationError,
  },
);

export const WsServerRetryResourceTelemetryRpc = Rpc.make(WS_METHODS.serverRetryResourceTelemetry, {
  payload: Schema.Struct({}),
  success: ResourceTelemetryRetryResult,
  error: EnvironmentAuthorizationError,
});

export const WsServerGetUsageSummaryRpc = Rpc.make(WS_METHODS.serverGetUsageSummary, {
  payload: UsageSummaryInput,
  success: UsageSummary,
  error: Schema.Union([EnvironmentAuthorizationError, UsageReadError]),
});

/**
 * Refetches the model rate table ahead of its daily TTL, so a model released
 * since the last fetch gets priced. The next usage summary uses the new table.
 */
export const WsServerRefreshUsageRatesRpc = Rpc.make(WS_METHODS.serverRefreshUsageRates, {
  payload: Schema.Struct({}),
  success: UsagePricing,
  error: EnvironmentAuthorizationError,
});

export const WsServerSignalProcessRpc = Rpc.make(WS_METHODS.serverSignalProcess, {
  payload: ServerSignalProcessInput,
  success: ServerSignalProcessResult,
  error: EnvironmentAuthorizationError,
});

export const WsCloudGetRelayClientStatusRpc = Rpc.make(WS_METHODS.cloudGetRelayClientStatus, {
  payload: Schema.Struct({}),
  success: RelayClientStatusSchema,
  error: EnvironmentAuthorizationError,
});

export const WsCloudInstallRelayClientRpc = Rpc.make(WS_METHODS.cloudInstallRelayClient, {
  payload: Schema.Struct({}),
  success: RelayClientInstallProgressEventSchema,
  error: Schema.Union([RelayClientInstallFailedError, EnvironmentAuthorizationError]),
  stream: true,
});

export const WsServerReportClientActivityRpc = Rpc.make(WS_METHODS.serverReportClientActivity, {
  payload: ClientActivityReportInput,
  error: EnvironmentAuthorizationError,
});

export const WsServerReportHostPowerStateRpc = Rpc.make(WS_METHODS.serverReportHostPowerState, {
  payload: HostPowerSnapshot,
  error: EnvironmentAuthorizationError,
});

export const WsServerGetBackgroundPolicyRpc = Rpc.make(WS_METHODS.serverGetBackgroundPolicy, {
  payload: Schema.Struct({}),
  success: BackgroundPolicySnapshot,
  error: EnvironmentAuthorizationError,
});

const PullRequestRpcError = Schema.Union([
  PullRequestUnavailableError,
  PullRequestOperationError,
  EnvironmentAuthorizationError,
]);

export const WsPullRequestsListRpc = Rpc.make(WS_METHODS.pullRequestsList, {
  payload: PullRequestListInput,
  success: PullRequestListResult,
  error: PullRequestRpcError,
});

/**
 * The line counts for rows already on the page. Its own call because on GitHub the pair costs
 * 40-60% of the listing read that answers everything else on the row, so the rows arrive first
 * and their stats a moment later.
 */
export const WsPullRequestsListStatsRpc = Rpc.make(WS_METHODS.pullRequestsListStats, {
  payload: PullRequestListStatsInput,
  success: PullRequestListStatsResult,
  error: PullRequestRpcError,
});

export const WsPullRequestsSummaryRpc = Rpc.make(WS_METHODS.pullRequestsSummary, {
  payload: PullRequestRef,
  success: PullRequestSummary,
  error: PullRequestRpcError,
});

export const WsPullRequestsDetailRpc = Rpc.make(WS_METHODS.pullRequestsDetail, {
  payload: PullRequestRef,
  success: PullRequestDetail,
  error: PullRequestRpcError,
});

export const WsPullRequestsActivityRpc = Rpc.make(WS_METHODS.pullRequestsActivity, {
  payload: PullRequestRef,
  success: PullRequestActivity,
  error: PullRequestRpcError,
});

export const WsPullRequestsThreadCommentsRpc = Rpc.make(WS_METHODS.pullRequestsThreadComments, {
  payload: PullRequestThreadCommentsInput,
  success: PullRequestThreadCommentsResult,
  error: PullRequestRpcError,
});

export const WsPullRequestsDiffFileContentsRpc = Rpc.make(WS_METHODS.pullRequestsDiffFileContents, {
  payload: PullRequestDiffFileContentsInput,
  success: PullRequestDiffFileContentsResult,
  error: PullRequestRpcError,
});

export const WsPullRequestsRunActionRpc = Rpc.make(WS_METHODS.pullRequestsRunAction, {
  payload: PullRequestActionInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

export const WsPullRequestsUpdateRpc = Rpc.make(WS_METHODS.pullRequestsUpdate, {
  payload: PullRequestUpdateInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

export const WsPullRequestsCommentRpc = Rpc.make(WS_METHODS.pullRequestsComment, {
  payload: PullRequestCommentInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

export const WsPullRequestsUpdateCommentRpc = Rpc.make(WS_METHODS.pullRequestsUpdateComment, {
  payload: PullRequestCommentUpdateInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

export const WsPullRequestsSubmitReviewRpc = Rpc.make(WS_METHODS.pullRequestsSubmitReview, {
  payload: PullRequestSubmitReviewInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

export const WsPullRequestsReplyToThreadRpc = Rpc.make(WS_METHODS.pullRequestsReplyToThread, {
  payload: PullRequestThreadReplyInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

export const WsPullRequestsSetThreadResolutionRpc = Rpc.make(
  WS_METHODS.pullRequestsSetThreadResolution,
  {
    payload: PullRequestThreadResolutionInput,
    success: Schema.Void,
    error: PullRequestRpcError,
  },
);

export const WsPullRequestsSetReactionRpc = Rpc.make(WS_METHODS.pullRequestsSetReaction, {
  payload: PullRequestReactionInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

export const WsPullRequestsInvalidateRpc = Rpc.make(WS_METHODS.pullRequestsInvalidate, {
  payload: PullRequestInvalidateInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

/**
 * Read on its own rather than as part of the detail: the people who may be asked are only wanted
 * once somebody opens the menu, and reading them with every change request would spend a request
 * per host on a list nobody looked at.
 */
export const WsPullRequestsReviewerCandidatesRpc = Rpc.make(
  WS_METHODS.pullRequestsReviewerCandidates,
  {
    payload: PullRequestRef,
    success: PullRequestReviewerCandidateList,
    error: PullRequestRpcError,
  },
);

export const WsPullRequestsRequestReviewersRpc = Rpc.make(WS_METHODS.pullRequestsRequestReviewers, {
  payload: PullRequestReviewerRequestInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

/** Read when the label menu opens, for the same reason the reviewer candidates are. */
export const WsPullRequestsLabelCandidatesRpc = Rpc.make(WS_METHODS.pullRequestsLabelCandidates, {
  payload: PullRequestRef,
  success: PullRequestLabelCandidateList,
  error: PullRequestRpcError,
});

export const WsPullRequestsSetLabelsRpc = Rpc.make(WS_METHODS.pullRequestsSetLabels, {
  payload: PullRequestLabelChangeInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

export const WsSourceControlLookupRepositoryRpc = Rpc.make(
  WS_METHODS.sourceControlLookupRepository,
  {
    payload: SourceControlRepositoryLookupInput,
    success: SourceControlRepositoryInfo,
    error: Schema.Union([SourceControlRepositoryError, EnvironmentAuthorizationError]),
  },
);

export const WsSourceControlCloneRepositoryRpc = Rpc.make(WS_METHODS.sourceControlCloneRepository, {
  payload: SourceControlCloneRepositoryInput,
  success: SourceControlCloneRepositoryResult,
  error: Schema.Union([SourceControlRepositoryError, EnvironmentAuthorizationError]),
});

export const WsSourceControlPublishRepositoryRpc = Rpc.make(
  WS_METHODS.sourceControlPublishRepository,
  {
    payload: SourceControlPublishRepositoryInput,
    success: SourceControlPublishRepositoryResult,
    error: Schema.Union([SourceControlRepositoryError, EnvironmentAuthorizationError]),
  },
);

export const WsProjectsSearchEntriesRpc = Rpc.make(WS_METHODS.projectsSearchEntries, {
  payload: ProjectSearchEntriesInput,
  success: ProjectSearchEntriesResult,
  error: Schema.Union([ProjectSearchEntriesError, EnvironmentAuthorizationError]),
});

export const WsProjectsSearchContentsRpc = Rpc.make(WS_METHODS.projectsSearchContents, {
  payload: ProjectSearchContentsInput,
  success: ProjectSearchContentsResult,
  error: Schema.Union([ProjectSearchContentsError, EnvironmentAuthorizationError]),
});

export const WsProjectsListEntriesRpc = Rpc.make(WS_METHODS.projectsListEntries, {
  payload: ProjectListEntriesInput,
  success: ProjectListEntriesResult,
  error: Schema.Union([ProjectListEntriesError, EnvironmentAuthorizationError]),
});

export const WsProjectsReadFileRpc = Rpc.make(WS_METHODS.projectsReadFile, {
  payload: ProjectReadFileInput,
  success: ProjectReadFileResult,
  error: Schema.Union([ProjectReadFileError, EnvironmentAuthorizationError]),
});

export const WsProjectsWriteFileRpc = Rpc.make(WS_METHODS.projectsWriteFile, {
  payload: ProjectWriteFileInput,
  success: ProjectWriteFileResult,
  error: Schema.Union([ProjectWriteFileError, EnvironmentAuthorizationError]),
});

export const WsShellOpenInEditorRpc = Rpc.make(WS_METHODS.shellOpenInEditor, {
  payload: LaunchEditorInput,
  error: Schema.Union([ExternalLauncherError, EnvironmentAuthorizationError]),
});

export const WsFilesystemBrowseRpc = Rpc.make(WS_METHODS.filesystemBrowse, {
  payload: FilesystemBrowseInput,
  success: FilesystemBrowseResult,
  error: Schema.Union([FilesystemBrowseError, EnvironmentAuthorizationError]),
});

export const WsAssetsCreateUrlRpc = Rpc.make(WS_METHODS.assetsCreateUrl, {
  payload: AssetCreateUrlInput,
  success: AssetCreateUrlResult,
  error: Schema.Union([AssetAccessError, EnvironmentAuthorizationError]),
});

export const WsAttachmentsCreateUploadUrlRpc = Rpc.make(WS_METHODS.attachmentsCreateUploadUrl, {
  payload: AttachmentCreateUploadUrlInput,
  success: AttachmentCreateUploadUrlResult,
  error: Schema.Union([AttachmentUploadSigningKeyError, EnvironmentAuthorizationError]),
});

export const WsAttachmentsDeleteRpc = Rpc.make(WS_METHODS.attachmentsDelete, {
  payload: AttachmentDeleteInput,
  error: EnvironmentAuthorizationError,
});

export const WsProviderUploadFeedbackRpc = Rpc.make(WS_METHODS.providerUploadFeedback, {
  payload: ProviderUploadFeedbackInput,
  success: ProviderUploadFeedbackResult,
  error: Schema.Union([ProviderUploadFeedbackError, EnvironmentAuthorizationError]),
});

export const WsSubscribeVcsStatusRpc = Rpc.make(WS_METHODS.subscribeVcsStatus, {
  payload: VcsStatusInput,
  success: VcsStatusStreamEvent,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
  stream: true,
});

export const WsVcsPullRpc = Rpc.make(WS_METHODS.vcsPull, {
  payload: VcsPullInput,
  success: VcsPullResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

export const WsVcsRefreshStatusRpc = Rpc.make(WS_METHODS.vcsRefreshStatus, {
  payload: VcsStatusInput,
  success: VcsStatusResult,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
});

export const WsGitRunStackedActionRpc = Rpc.make(WS_METHODS.gitRunStackedAction, {
  payload: GitRunStackedActionInput,
  success: GitActionProgressEvent,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
  stream: true,
});

export const WsGitResolvePullRequestRpc = Rpc.make(WS_METHODS.gitResolvePullRequest, {
  payload: GitPullRequestRefInput,
  success: GitResolvePullRequestResult,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
});

export const WsGitPreparePullRequestThreadRpc = Rpc.make(WS_METHODS.gitPreparePullRequestThread, {
  payload: GitPreparePullRequestThreadInput,
  success: GitPreparePullRequestThreadResult,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
});

export const WsVcsListRefsRpc = Rpc.make(WS_METHODS.vcsListRefs, {
  payload: VcsListRefsInput,
  success: VcsListRefsResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

export const WsVcsCreateWorktreeRpc = Rpc.make(WS_METHODS.vcsCreateWorktree, {
  payload: VcsCreateWorktreeInput,
  success: VcsCreateWorktreeResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

export const WsVcsRemoveWorktreeRpc = Rpc.make(WS_METHODS.vcsRemoveWorktree, {
  payload: VcsRemoveWorktreeInput,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

export const WsVcsCreateRefRpc = Rpc.make(WS_METHODS.vcsCreateRef, {
  payload: VcsCreateRefInput,
  success: VcsCreateRefResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

export const WsVcsSwitchRefRpc = Rpc.make(WS_METHODS.vcsSwitchRef, {
  payload: VcsSwitchRefInput,
  success: VcsSwitchRefResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

export const WsVcsInitRpc = Rpc.make(WS_METHODS.vcsInit, {
  payload: VcsInitInput,
  error: Schema.Union([VcsError, EnvironmentAuthorizationError]),
});

/**
 * Ephemeral live diff preview for compact/mobile surfaces.
 * Not the persisted T3 Review model. Future review sessions should use
 * review.open* + review.getSnapshot.
 */
export const WsReviewGetDiffPreviewRpc = Rpc.make(WS_METHODS.reviewGetDiffPreview, {
  payload: ReviewDiffPreviewInput,
  success: ReviewDiffPreviewResult,
  error: Schema.Union([ReviewDiffPreviewError, EnvironmentAuthorizationError]),
});

export const WsReviewGetDiffFileContentsRpc = Rpc.make(WS_METHODS.reviewGetDiffFileContents, {
  payload: ReviewDiffFileContentsInput,
  success: ReviewDiffFileContentsResult,
  error: Schema.Union([ReviewDiffPreviewError, EnvironmentAuthorizationError]),
});

export const WsTerminalOpenRpc = Rpc.make(WS_METHODS.terminalOpen, {
  payload: TerminalOpenInput,
  success: TerminalSessionSnapshot,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

export const WsTerminalAttachRpc = Rpc.make(WS_METHODS.terminalAttach, {
  payload: TerminalAttachInput,
  success: TerminalAttachStreamEvent,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
  stream: true,
});

export const WsTerminalWriteRpc = Rpc.make(WS_METHODS.terminalWrite, {
  payload: TerminalWriteInput,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

export const WsTerminalResizeRpc = Rpc.make(WS_METHODS.terminalResize, {
  payload: TerminalResizeInput,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

export const WsTerminalClearRpc = Rpc.make(WS_METHODS.terminalClear, {
  payload: TerminalClearInput,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

export const WsTerminalRestartRpc = Rpc.make(WS_METHODS.terminalRestart, {
  payload: TerminalRestartInput,
  success: TerminalSessionSnapshot,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

export const WsTerminalCloseRpc = Rpc.make(WS_METHODS.terminalClose, {
  payload: TerminalCloseInput,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

export const WsPreviewOpenRpc = Rpc.make(WS_METHODS.previewOpen, {
  payload: PreviewOpenInput,
  success: PreviewSessionSnapshot,
  error: Schema.Union([PreviewError, EnvironmentAuthorizationError]),
});

export const WsPreviewNavigateRpc = Rpc.make(WS_METHODS.previewNavigate, {
  payload: PreviewNavigateInput,
  success: PreviewSessionSnapshot,
  error: Schema.Union([PreviewError, EnvironmentAuthorizationError]),
});

export const WsPreviewResizeRpc = Rpc.make(WS_METHODS.previewResize, {
  payload: PreviewResizeInput,
  success: PreviewSessionSnapshot,
  error: Schema.Union([PreviewError, EnvironmentAuthorizationError]),
});

export const WsPreviewRefreshRpc = Rpc.make(WS_METHODS.previewRefresh, {
  payload: PreviewRefreshInput,
  error: Schema.Union([PreviewError, EnvironmentAuthorizationError]),
});

export const WsPreviewCloseRpc = Rpc.make(WS_METHODS.previewClose, {
  payload: PreviewCloseInput,
  error: Schema.Union([PreviewError, EnvironmentAuthorizationError]),
});

export const WsPreviewListRpc = Rpc.make(WS_METHODS.previewList, {
  payload: PreviewListInput,
  success: PreviewListResult,
  error: EnvironmentAuthorizationError,
});

export const WsPreviewReportStatusRpc = Rpc.make(WS_METHODS.previewReportStatus, {
  payload: PreviewReportStatusInput,
  error: Schema.Union([PreviewError, EnvironmentAuthorizationError]),
});

export const WsPreviewAutomationConnectRpc = Rpc.make(WS_METHODS.previewAutomationConnect, {
  payload: PreviewAutomationHost,
  success: PreviewAutomationStreamEvent,
  error: Schema.Union([PreviewAutomationError, EnvironmentAuthorizationError]),
  stream: true,
});

export const WsPreviewAutomationRespondRpc = Rpc.make(WS_METHODS.previewAutomationRespond, {
  payload: PreviewAutomationResponse,
  error: Schema.Union([PreviewAutomationError, EnvironmentAuthorizationError]),
});

export const WsPreviewAutomationFocusHostRpc = Rpc.make(WS_METHODS.previewAutomationFocusHost, {
  payload: PreviewAutomationHostFocus,
  error: EnvironmentAuthorizationError,
});

export const WsSubscribePreviewEventsRpc = Rpc.make(WS_METHODS.subscribePreviewEvents, {
  payload: Schema.Struct({}),
  success: PreviewEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

export const WsSubscribeDiscoveredLocalServersRpc = Rpc.make(
  WS_METHODS.subscribeDiscoveredLocalServers,
  {
    payload: Schema.Struct({
      configuredUrls: Schema.optional(ConfiguredLocalServerUrls),
    }),
    success: DiscoveredLocalServerList,
    error: EnvironmentAuthorizationError,
    stream: true,
  },
);

export const WsOrchestrationDispatchCommandRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.dispatchCommand,
  {
    payload: ClientOrchestrationCommand,
    success: OrchestrationRpcSchemas.dispatchCommand.output,
    error: Schema.Union([OrchestrationDispatchCommandError, EnvironmentAuthorizationError]),
  },
);

export const WsOrchestrationGetWorkflowScriptRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getWorkflowScript,
  {
    payload: OrchestrationRpcSchemas.getWorkflowScript.input,
    success: OrchestrationRpcSchemas.getWorkflowScript.output,
    error: Schema.Union([OrchestrationGetWorkflowScriptError, EnvironmentAuthorizationError]),
  },
);

export const WsOrchestrationGetTurnDiffRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getTurnDiff, {
  payload: OrchestrationGetTurnDiffInput,
  success: OrchestrationRpcSchemas.getTurnDiff.output,
  error: Schema.Union([OrchestrationGetTurnDiffError, EnvironmentAuthorizationError]),
});

export const WsOrchestrationGetFullThreadDiffRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getFullThreadDiff,
  {
    payload: OrchestrationGetFullThreadDiffInput,
    success: OrchestrationRpcSchemas.getFullThreadDiff.output,
    error: Schema.Union([OrchestrationGetFullThreadDiffError, EnvironmentAuthorizationError]),
  },
);

export const WsOrchestrationSearchThreadsRpc = Rpc.make(ORCHESTRATION_WS_METHODS.searchThreads, {
  payload: OrchestrationSearchThreadsInput,
  success: OrchestrationRpcSchemas.searchThreads.output,
  error: Schema.Union([OrchestrationSearchThreadsError, EnvironmentAuthorizationError]),
});

export const WsOrchestrationGetArchivedShellSnapshotRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot,
  {
    payload: OrchestrationRpcSchemas.getArchivedShellSnapshot.input,
    success: OrchestrationRpcSchemas.getArchivedShellSnapshot.output,
    error: Schema.Union([OrchestrationGetSnapshotError, EnvironmentAuthorizationError]),
  },
);

export const WsOrchestrationSubscribeShellRpc = Rpc.make(ORCHESTRATION_WS_METHODS.subscribeShell, {
  payload: OrchestrationRpcSchemas.subscribeShell.input,
  success: OrchestrationRpcSchemas.subscribeShell.output,
  error: Schema.Union([OrchestrationGetSnapshotError, EnvironmentAuthorizationError]),
  stream: true,
});

export const WsOrchestrationSubscribeThreadRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.subscribeThread,
  {
    payload: OrchestrationRpcSchemas.subscribeThread.input,
    success: OrchestrationRpcSchemas.subscribeThread.output,
    error: Schema.Union([OrchestrationGetSnapshotError, EnvironmentAuthorizationError]),
    stream: true,
  },
);

export const WsSubscribeTerminalEventsRpc = Rpc.make(WS_METHODS.subscribeTerminalEvents, {
  payload: Schema.Struct({}),
  success: TerminalEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

export const WsSubscribeTerminalMetadataRpc = Rpc.make(WS_METHODS.subscribeTerminalMetadata, {
  payload: Schema.Struct({}),
  success: TerminalMetadataStreamEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

export const WsSubscribeServerConfigRpc = Rpc.make(WS_METHODS.subscribeServerConfig, {
  payload: Schema.Struct({
    /**
     * Whether this client understands `environmentThemesUpdated` events.
     * Already-shipped clients decode the stream against the old event union
     * and would die on an unknown member, so the server emits the theme
     * stream only to subscribers that ask for it. Absent on old clients;
     * dropped by old servers.
     */
    environmentThemes: Schema.optional(Schema.Boolean),
    /** Whether this client understands `usageLimitSourcesUpdated` events. */
    usageLimitSources: Schema.optional(Schema.Boolean),
  }),
  success: ServerConfigStreamEvent,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError, EnvironmentAuthorizationError]),
  stream: true,
});

export const WsSubscribeServerLifecycleRpc = Rpc.make(WS_METHODS.subscribeServerLifecycle, {
  payload: Schema.Struct({}),
  success: ServerLifecycleStreamEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

export const WsSubscribeAuthAccessRpc = Rpc.make(WS_METHODS.subscribeAuthAccess, {
  payload: Schema.Struct({}),
  success: AuthAccessStreamEvent,
  error: Schema.Union([AuthAccessStreamError, EnvironmentAuthorizationError]),
  stream: true,
});

export const WsSubscribeBackgroundPolicyRpc = Rpc.make(WS_METHODS.subscribeBackgroundPolicy, {
  payload: Schema.Struct({}),
  success: BackgroundPolicySnapshot,
  error: EnvironmentAuthorizationError,
  stream: true,
});

export const WsSubscribeResourceTelemetryRpc = Rpc.make(WS_METHODS.subscribeResourceTelemetry, {
  payload: Schema.Struct({}),
  success: ResourceTelemetrySnapshot,
  error: EnvironmentAuthorizationError,
  stream: true,
});

// Mercurian planning. The tree subscription re-sends a whole (small) snapshot
// on change rather than carrying sequenced deltas — projects and plans are few
// and move only on discrete human acts.
export const WsMercurianSubscribeTreeRpc = Rpc.make(MERCURIAN_WS_METHODS.subscribeTree, {
  payload: MercurianSubscribeTreeInput,
  success: PlanningTreeStreamItem,
  error: Schema.Union([MercurianPlanningError, EnvironmentAuthorizationError]),
  stream: true,
});

export const WsMercurianSubscribeWorktreeSlotsRpc = Rpc.make(
  MERCURIAN_WS_METHODS.subscribeWorktreeSlots,
  {
    payload: MercurianSubscribeWorktreeSlotsInput,
    success: WorktreeSlotStreamItem,
    error: Schema.Union([MercurianPlanningError, EnvironmentAuthorizationError]),
    stream: true,
  },
);

export const WsMercurianReadLineUncommittedDiffRpc = Rpc.make(
  MERCURIAN_WS_METHODS.readLineUncommittedDiff,
  {
    payload: MercurianReadLineUncommittedDiffInput,
    success: MercurianReadLineUncommittedDiffResult,
    error: Schema.Union([MercurianPlanningError, EnvironmentAuthorizationError]),
  },
);

export const WsMercurianRecreateLineBranchRpc = Rpc.make(MERCURIAN_WS_METHODS.recreateLineBranch, {
  payload: MercurianRecreateLineBranchInput,
  success: MercurianRecreateLineBranchResult,
  error: Schema.Union([MercurianPlanningError, EnvironmentAuthorizationError]),
});

export const WsMercurianCreateProjectRpc = Rpc.make(MERCURIAN_WS_METHODS.createProject, {
  payload: MercurianCreateProjectInput,
  success: MercurianProject,
  error: Schema.Union([MercurianPlanningError, EnvironmentAuthorizationError]),
});

// Import is selection, not synchronization: this is the only method that turns
// an issue into anything Mercurian stores, and it is idempotent by origin — a
// second import of one issue answers with the plan the first one made.
export const WsMercurianImportPlanRpc = Rpc.make(MERCURIAN_WS_METHODS.importPlan, {
  payload: MercurianImportPlanInput,
  success: PlanImportResult,
  error: Schema.Union([
    MercurianProjectNotFoundError,
    MercurianPlanningError,
    EnvironmentAuthorizationError,
  ]),
});

export const WsMercurianEnsureProjectRuntimeRpc = Rpc.make(
  MERCURIAN_WS_METHODS.ensureProjectRuntime,
  {
    payload: MercurianEnsureProjectRuntimeInput,
    success: MercurianEnsureProjectRuntimeResult,
    error: Schema.Union([
      MercurianProjectNotFoundError,
      MercurianPlanningError,
      EnvironmentAuthorizationError,
    ]),
  },
);

export const WsMercurianForkLineRpc = Rpc.make(MERCURIAN_WS_METHODS.forkLine, {
  payload: MercurianForkLineInput,
  success: MercurianLineResult,
  error: Schema.Union([PlanNotFoundError, MercurianPlanningError, EnvironmentAuthorizationError]),
});

export const WsMercurianOpenLineRpc = Rpc.make(MERCURIAN_WS_METHODS.openLine, {
  payload: MercurianOpenLineInput,
  success: MercurianLineResult,
  error: Schema.Union([PlanNotFoundError, MercurianPlanningError, EnvironmentAuthorizationError]),
});

export const WsMercurianSavePlanRevisionRpc = Rpc.make(MERCURIAN_WS_METHODS.savePlanRevision, {
  payload: MercurianSavePlanRevisionInput,
  success: PlanRevision,
  error: Schema.Union([
    PlanNotFoundError,
    PlanTurnActiveError,
    MercurianPlanningError,
    EnvironmentAuthorizationError,
  ]),
});

export const WsMercurianSaveSpecRevisionRpc = Rpc.make(MERCURIAN_WS_METHODS.saveSpecRevision, {
  payload: MercurianSaveSpecRevisionInput,
  success: PlanSpecRevision,
  error: Schema.Union([
    PlanNotFoundError,
    PlanTurnActiveError,
    SpecRevisionOutdatedError,
    MercurianPlanningError,
    EnvironmentAuthorizationError,
  ]),
});

export const WsMercurianRefreshSpecRpc = Rpc.make(MERCURIAN_WS_METHODS.refreshSpec, {
  payload: MercurianRefreshSpecInput,
  success: MercurianRefreshSpecResult,
  error: Schema.Union([
    PlanNotFoundError,
    PlanTurnActiveError,
    SpecRevisionOutdatedError,
    SpecRefreshUnavailableError,
    TrackerConnectionNotFoundError,
    TrackerAuthError,
    TrackerUnreachableError,
    MercurianPlanningError,
    MercurianTrackerError,
    EnvironmentAuthorizationError,
  ]),
});

// Attention, recorded. Both write one plan's visited-at and answer with
// nothing: the change they made comes back on the tree subscription, where
// every other row fact already lives. Neither joins the environment
// subscription group — they are unary acts, not streams.
export const WsMercurianVisitPlanRpc = Rpc.make(MERCURIAN_WS_METHODS.visitPlan, {
  payload: MercurianVisitPlanInput,
  success: MercurianPlanAcknowledged,
  error: Schema.Union([PlanNotFoundError, MercurianPlanningError, EnvironmentAuthorizationError]),
});

export const WsMercurianMarkPlanUnreadRpc = Rpc.make(MERCURIAN_WS_METHODS.markPlanUnread, {
  payload: MercurianMarkPlanUnreadInput,
  success: MercurianPlanAcknowledged,
  error: Schema.Union([PlanNotFoundError, MercurianPlanningError, EnvironmentAuthorizationError]),
});

// The plan lifecycle, answering the same way and for the same reason. Archive
// is every plan's disappearance and is reversible; delete exists only while a
// plan is fully private, and refuses once anything it holds has been published.
export const WsMercurianArchivePlanRpc = Rpc.make(MERCURIAN_WS_METHODS.archivePlan, {
  payload: MercurianArchivePlanInput,
  success: MercurianPlanAcknowledged,
  error: Schema.Union([PlanNotFoundError, MercurianPlanningError, EnvironmentAuthorizationError]),
});

export const WsMercurianUnarchivePlanRpc = Rpc.make(MERCURIAN_WS_METHODS.unarchivePlan, {
  payload: MercurianUnarchivePlanInput,
  success: MercurianPlanAcknowledged,
  error: Schema.Union([PlanNotFoundError, MercurianPlanningError, EnvironmentAuthorizationError]),
});

export const WsMercurianDeletePlanRpc = Rpc.make(MERCURIAN_WS_METHODS.deletePlan, {
  payload: MercurianDeletePlanInput,
  success: MercurianPlanAcknowledged,
  error: Schema.Union([
    PlanNotFoundError,
    PlanDeleteBlockedError,
    MercurianPlanningError,
    EnvironmentAuthorizationError,
  ]),
});

// The planning space's read path. Unlike the tree, a plan carries sequenced
// events: the commit store is already the totally-ordered log, so the cursor
// is `commits.sequence` and resume is bounded-gap-replay-else-snapshot.
export const WsMercurianSubscribePlanRpc = Rpc.make(MERCURIAN_WS_METHODS.subscribePlan, {
  payload: MercurianSubscribePlanInput,
  success: PlanStreamItem,
  error: Schema.Union([PlanNotFoundError, MercurianPlanningError, EnvironmentAuthorizationError]),
  stream: true,
});

// The plan as of an earlier commit. History above a commit is frozen, so this
// is a unary read rather than anything the subscription has to carry: the
// timeline's revisions deliberately travel without their text.
export const WsMercurianGetPlanTextAtRpc = Rpc.make(MERCURIAN_WS_METHODS.getPlanTextAt, {
  payload: MercurianGetPlanTextAtInput,
  success: PlanTextAt,
  error: Schema.Union([PlanNotFoundError, MercurianPlanningError, EnvironmentAuthorizationError]),
});

export const WsMercurianGetSpecAtRpc = Rpc.make(MERCURIAN_WS_METHODS.getSpecAt, {
  payload: MercurianGetSpecAtInput,
  success: SpecAt,
  error: Schema.Union([PlanNotFoundError, MercurianPlanningError, EnvironmentAuthorizationError]),
});

// Mercurian repositories. Same snapshot-re-emit shape as the tree, and for the
// same reason: a repository set moves when a person adds, removes, or
// reassigns one. Project sets ride this snapshot rather than the tree's —
// including the removal cascade, whose signal is this store's.
export const WsMercurianSubscribeRepositoriesRpc = Rpc.make(
  MERCURIAN_REPOSITORY_WS_METHODS.subscribeRepositories,
  {
    payload: MercurianSubscribeRepositoriesInput,
    success: MercurianRepositoriesStreamItem,
    error: Schema.Union([MercurianRepositoryError, EnvironmentAuthorizationError]),
    stream: true,
  },
);

export const WsMercurianRefreshRepositoriesRpc = Rpc.make(
  MERCURIAN_REPOSITORY_WS_METHODS.refreshRepositories,
  {
    payload: MercurianRefreshRepositoriesInput,
    success: Schema.Void,
    error: Schema.Union([MercurianRepositoryError, EnvironmentAuthorizationError]),
  },
);

export const WsMercurianAddRepositoryRpc = Rpc.make(MERCURIAN_REPOSITORY_WS_METHODS.addRepository, {
  payload: MercurianAddRepositoryInput,
  success: MercurianRepository,
  error: Schema.Union([
    RepositoryPathInvalidError,
    RepositoryAlreadyRegisteredError,
    MercurianRepositoryError,
    EnvironmentAuthorizationError,
  ]),
});

export const WsMercurianRemoveRepositoryRpc = Rpc.make(
  MERCURIAN_REPOSITORY_WS_METHODS.removeRepository,
  {
    payload: MercurianRemoveRepositoryInput,
    success: Schema.Void,
    error: Schema.Union([
      MercurianRepositoryNotFoundError,
      RepositoryHasLiveWorktreesError,
      MercurianRepositoryError,
      EnvironmentAuthorizationError,
    ]),
  },
);

export const WsMercurianSaveRepositoryScriptsRpc = Rpc.make(
  MERCURIAN_REPOSITORY_WS_METHODS.saveRepositoryScripts,
  {
    payload: MercurianSaveRepositoryScriptsInput,
    success: MercurianRepository,
    error: Schema.Union([
      MercurianRepositoryNotFoundError,
      MercurianRepositoryError,
      EnvironmentAuthorizationError,
    ]),
  },
);

export const WsMercurianSetProjectRepositoriesRpc = Rpc.make(
  MERCURIAN_REPOSITORY_WS_METHODS.setProjectRepositories,
  {
    payload: MercurianSetProjectRepositoriesInput,
    success: Schema.Void,
    error: Schema.Union([
      MercurianProjectNotFoundError,
      MercurianRepositoryNotFoundError,
      MercurianRepositoryError,
      EnvironmentAuthorizationError,
    ]),
  },
);

export const WsMercurianSubscribeMemorySourcesRpc = Rpc.make(
  MERCURIAN_MEMORY_WS_METHODS.subscribeMemorySources,
  {
    payload: MercurianSubscribeMemorySourcesInput,
    success: MemorySourcesStreamItem,
    error: Schema.Union([MercurianMemoryError, EnvironmentAuthorizationError]),
    stream: true,
  },
);

export const WsMercurianDesignateMemorySourceRpc = Rpc.make(
  MERCURIAN_MEMORY_WS_METHODS.designateMemorySource,
  {
    payload: MercurianDesignateMemorySourceInput,
    success: Schema.Void,
    error: Schema.Union([
      MemorySourceInvalidError,
      MercurianMemoryError,
      EnvironmentAuthorizationError,
    ]),
  },
);

export const WsMercurianRemoveMemorySourceRpc = Rpc.make(
  MERCURIAN_MEMORY_WS_METHODS.removeMemorySource,
  {
    payload: MercurianRemoveMemorySourceInput,
    success: Schema.Void,
    error: Schema.Union([MercurianMemoryError, EnvironmentAuthorizationError]),
  },
);

export const WsMercurianReadMemoryIndexRpc = Rpc.make(MERCURIAN_MEMORY_WS_METHODS.readMemoryIndex, {
  payload: MercurianReadMemoryIndexInput,
  success: MemoryIndex,
  error: Schema.Union([
    MemoryNotDesignatedError,
    MemorySourceInvalidError,
    MercurianMemoryError,
    EnvironmentAuthorizationError,
  ]),
});

export const WsMercurianReadMemoryNoteRpc = Rpc.make(MERCURIAN_MEMORY_WS_METHODS.readMemoryNote, {
  payload: MercurianReadMemoryNoteInput,
  success: MemoryNote,
  error: Schema.Union([
    MemoryNotDesignatedError,
    MemorySourceInvalidError,
    MercurianMemoryError,
    EnvironmentAuthorizationError,
  ]),
});

export const WsMercurianReadLineMemoryChangesRpc = Rpc.make(
  MERCURIAN_MEMORY_WS_METHODS.readLineMemoryChanges,
  {
    payload: MercurianReadLineMemoryChangesInput,
    success: MercurianLineMemoryChanges,
    error: Schema.Union([
      MemoryNotDesignatedError,
      MemorySourceInvalidError,
      MercurianMemoryError,
      EnvironmentAuthorizationError,
    ]),
  },
);

export const WsMercurianMarkMemoryChangeReviewedRpc = Rpc.make(
  MERCURIAN_MEMORY_WS_METHODS.markMemoryChangeReviewed,
  {
    payload: MercurianMarkMemoryChangeReviewedInput,
    success: Schema.Void,
    error: Schema.Union([
      MemoryNotDesignatedError,
      MemorySourceInvalidError,
      MercurianMemoryError,
      EnvironmentAuthorizationError,
    ]),
  },
);

export const WsMercurianRevertMemoryChangeRpc = Rpc.make(
  MERCURIAN_MEMORY_WS_METHODS.revertMemoryChange,
  {
    payload: MercurianRevertMemoryChangeInput,
    success: Schema.Void,
    error: Schema.Union([
      MemoryNotDesignatedError,
      MemorySourceInvalidError,
      MemoryReviewBlockedError,
      MercurianMemoryError,
      EnvironmentAuthorizationError,
    ]),
  },
);

export const WsMercurianMergeMemoryHomeRpc = Rpc.make(MERCURIAN_MEMORY_WS_METHODS.mergeMemoryHome, {
  payload: MercurianMergeMemoryHomeInput,
  success: MercurianMergeMemoryHomeResult,
  error: Schema.Union([
    MemoryNotDesignatedError,
    MemorySourceInvalidError,
    MemoryReviewBlockedError,
    MergeMemoryHomeBlockedError,
    MercurianMemoryError,
    EnvironmentAuthorizationError,
  ]),
});

export const WsMercurianGenerateProductMapRpc = Rpc.make(
  MERCURIAN_MEMORY_WS_METHODS.generateProductMap,
  {
    payload: MercurianGenerateProductMapInput,
    success: Schema.Void,
    error: Schema.Union([
      MemoryNotDesignatedError,
      MemorySourceInvalidError,
      ProductMapAlreadyExistsError,
      ProductMapCycleError,
      MercurianMemoryError,
      EnvironmentAuthorizationError,
    ]),
  },
);

// Workspace-scoped seeds are few and small, so the read is a whole-value
// re-send rather than a sequenced log.
export const WsMercurianSubscribeWorkspaceSettingsRpc = Rpc.make(
  MERCURIAN_WORKSPACE_WS_METHODS.subscribeWorkspaceSettings,
  {
    payload: MercurianSubscribeWorkspaceSettingsInput,
    success: WorkspaceSettingsStreamItem,
    error: Schema.Union([MercurianWorkspaceError, EnvironmentAuthorizationError]),
    stream: true,
  },
);

// Mercurian trackers. Four methods and not one of them writes tracker-ward:
// connections are pull-only by construction, so "no operation anywhere writes
// to the tracker" is a property of this list rather than a rule to remember.
export const WsMercurianSubscribeTrackersRpc = Rpc.make(
  MERCURIAN_TRACKER_WS_METHODS.subscribeTrackers,
  {
    payload: MercurianSubscribeTrackersInput,
    success: TrackersStreamItem,
    error: Schema.Union([MercurianTrackerError, EnvironmentAuthorizationError]),
    stream: true,
  },
);

// The credential's one crossing, client→server. The answer is the connection —
// label and standing — and never the token: there is nothing to redact because
// nothing comes back.
export const WsMercurianConnectTrackerRpc = Rpc.make(MERCURIAN_TRACKER_WS_METHODS.connectTracker, {
  payload: MercurianConnectTrackerInput,
  success: TrackerConnection,
  error: Schema.Union([
    TrackerAuthError,
    TrackerUnreachableError,
    MercurianTrackerError,
    EnvironmentAuthorizationError,
  ]),
});

export const WsMercurianDisconnectTrackerRpc = Rpc.make(
  MERCURIAN_TRACKER_WS_METHODS.disconnectTracker,
  {
    payload: MercurianDisconnectTrackerInput,
    success: Schema.Void,
    error: Schema.Union([
      TrackerConnectionNotFoundError,
      MercurianTrackerError,
      EnvironmentAuthorizationError,
    ]),
  },
);

// Fetched live, never stored — no issue row exists anywhere in Mercurian's
// schema, which is what "import is selection, not synchronization" is at this
// layer. The page carries the minimal common shape and nothing else.
export const WsMercurianListTrackerIssuesRpc = Rpc.make(
  MERCURIAN_TRACKER_WS_METHODS.listTrackerIssues,
  {
    payload: MercurianListTrackerIssuesInput,
    success: TrackerIssuePage,
    error: Schema.Union([
      TrackerConnectionNotFoundError,
      TrackerAuthError,
      TrackerUnreachableError,
      MercurianTrackerError,
      EnvironmentAuthorizationError,
    ]),
  },
);

export const WsRpcGroup = RpcGroup.make(
  WsServerProbeRpc,
  WsServerGetConfigRpc,
  WsServerRefreshProvidersRpc,
  WsServerUpdateProviderRpc,
  WsProviderAuthStartRpc,
  WsProviderAuthCompleteRpc,
  WsProviderAuthCancelRpc,
  WsProviderAuthLogoutRpc,
  WsProviderAuthSubscribeRpc,
  WsProviderInstallStartRpc,
  WsProviderInstallCancelRpc,
  WsProviderInstallSubscribeRpc,
  WsProviderInstallRemoveRpc,
  WsServerUpdateServerRpc,
  WsServerUpdateServerWithProgressRpc,
  WsServerCommitDesktopUpdateRpc,
  WsServerUpsertKeybindingRpc,
  WsServerRemoveKeybindingRpc,
  WsServerGetSettingsRpc,
  WsServerUpdateSettingsRpc,
  WsServerDiscoverSourceControlRpc,
  WsServerGetTraceDiagnosticsRpc,
  WsServerGetProcessDiagnosticsRpc,
  WsServerGetProcessResourceHistoryRpc,
  WsServerGetResourceTelemetryHistoryRpc,
  WsServerRetryResourceTelemetryRpc,
  WsServerGetUsageSummaryRpc,
  WsServerRefreshUsageRatesRpc,
  WsServerSignalProcessRpc,
  WsServerReportClientActivityRpc,
  WsServerReportHostPowerStateRpc,
  WsServerGetBackgroundPolicyRpc,
  WsCloudGetRelayClientStatusRpc,
  WsCloudInstallRelayClientRpc,
  WsPullRequestsListRpc,
  WsPullRequestsListStatsRpc,
  WsPullRequestsSummaryRpc,
  WsPullRequestsDetailRpc,
  WsPullRequestsActivityRpc,
  WsPullRequestsThreadCommentsRpc,
  WsPullRequestsDiffFileContentsRpc,
  WsPullRequestsRunActionRpc,
  WsPullRequestsUpdateRpc,
  WsPullRequestsCommentRpc,
  WsPullRequestsUpdateCommentRpc,
  WsPullRequestsSubmitReviewRpc,
  WsPullRequestsReplyToThreadRpc,
  WsPullRequestsSetThreadResolutionRpc,
  WsPullRequestsSetReactionRpc,
  WsPullRequestsInvalidateRpc,
  WsPullRequestsReviewerCandidatesRpc,
  WsPullRequestsRequestReviewersRpc,
  WsPullRequestsLabelCandidatesRpc,
  WsPullRequestsSetLabelsRpc,
  WsSourceControlLookupRepositoryRpc,
  WsSourceControlCloneRepositoryRpc,
  WsSourceControlPublishRepositoryRpc,
  WsProjectsListEntriesRpc,
  WsProjectsReadFileRpc,
  WsProjectsSearchContentsRpc,
  WsProjectsSearchEntriesRpc,
  WsProjectsWriteFileRpc,
  WsShellOpenInEditorRpc,
  WsFilesystemBrowseRpc,
  WsAssetsCreateUrlRpc,
  WsAttachmentsCreateUploadUrlRpc,
  WsAttachmentsDeleteRpc,
  WsProviderUploadFeedbackRpc,
  WsSubscribeVcsStatusRpc,
  WsVcsPullRpc,
  WsVcsRefreshStatusRpc,
  WsGitRunStackedActionRpc,
  WsGitResolvePullRequestRpc,
  WsGitPreparePullRequestThreadRpc,
  WsVcsListRefsRpc,
  WsVcsCreateWorktreeRpc,
  WsVcsRemoveWorktreeRpc,
  WsVcsCreateRefRpc,
  WsVcsSwitchRefRpc,
  WsVcsInitRpc,
  WsReviewGetDiffPreviewRpc,
  WsReviewGetDiffFileContentsRpc,
  WsTerminalOpenRpc,
  WsTerminalAttachRpc,
  WsTerminalWriteRpc,
  WsTerminalResizeRpc,
  WsTerminalClearRpc,
  WsTerminalRestartRpc,
  WsTerminalCloseRpc,
  WsSubscribeTerminalEventsRpc,
  WsSubscribeTerminalMetadataRpc,
  WsPreviewOpenRpc,
  WsPreviewNavigateRpc,
  WsPreviewResizeRpc,
  WsPreviewRefreshRpc,
  WsPreviewCloseRpc,
  WsPreviewListRpc,
  WsPreviewReportStatusRpc,
  WsPreviewAutomationConnectRpc,
  WsPreviewAutomationRespondRpc,
  WsPreviewAutomationFocusHostRpc,
  WsSubscribePreviewEventsRpc,
  WsSubscribeDiscoveredLocalServersRpc,
  WsSubscribeServerConfigRpc,
  WsSubscribeServerLifecycleRpc,
  WsSubscribeAuthAccessRpc,
  WsSubscribeBackgroundPolicyRpc,
  WsSubscribeResourceTelemetryRpc,
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationGetWorkflowScriptRpc,
  WsOrchestrationGetTurnDiffRpc,
  WsOrchestrationGetFullThreadDiffRpc,
  WsOrchestrationSearchThreadsRpc,
  WsOrchestrationGetArchivedShellSnapshotRpc,
  WsOrchestrationSubscribeShellRpc,
  WsOrchestrationSubscribeThreadRpc,
  WsMercurianSubscribeTreeRpc,
  WsMercurianSubscribeWorktreeSlotsRpc,
  WsMercurianReadLineUncommittedDiffRpc,
  WsMercurianRecreateLineBranchRpc,
  WsMercurianCreateProjectRpc,
  WsMercurianEnsureProjectRuntimeRpc,
  WsMercurianForkLineRpc,
  WsMercurianOpenLineRpc,
  WsMercurianImportPlanRpc,
  WsMercurianSavePlanRevisionRpc,
  WsMercurianSaveSpecRevisionRpc,
  WsMercurianRefreshSpecRpc,
  WsMercurianVisitPlanRpc,
  WsMercurianMarkPlanUnreadRpc,
  WsMercurianArchivePlanRpc,
  WsMercurianUnarchivePlanRpc,
  WsMercurianDeletePlanRpc,
  WsMercurianSubscribePlanRpc,
  WsMercurianGetPlanTextAtRpc,
  WsMercurianGetSpecAtRpc,
  WsMercurianSubscribeRepositoriesRpc,
  WsMercurianRefreshRepositoriesRpc,
  WsMercurianAddRepositoryRpc,
  WsMercurianRemoveRepositoryRpc,
  WsMercurianSaveRepositoryScriptsRpc,
  WsMercurianSetProjectRepositoriesRpc,
  WsMercurianSubscribeMemorySourcesRpc,
  WsMercurianDesignateMemorySourceRpc,
  WsMercurianRemoveMemorySourceRpc,
  WsMercurianReadMemoryIndexRpc,
  WsMercurianReadMemoryNoteRpc,
  WsMercurianReadLineMemoryChangesRpc,
  WsMercurianMarkMemoryChangeReviewedRpc,
  WsMercurianRevertMemoryChangeRpc,
  WsMercurianMergeMemoryHomeRpc,
  WsMercurianGenerateProductMapRpc,
  WsMercurianSubscribeWorkspaceSettingsRpc,
  WsMercurianSubscribeTrackersRpc,
  WsMercurianConnectTrackerRpc,
  WsMercurianDisconnectTrackerRpc,
  WsMercurianListTrackerIssuesRpc,
);
