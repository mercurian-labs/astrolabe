import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  DEFAULT_AUTOMATIC_GIT_FETCH_INTERVAL,
  AuthAccessStreamError,
  type AuthAccessStreamEvent,
  type AuthEnvironmentScope,
  AuthSessionId,
  ClientSurface,
  CommandId,
  type DiscoveredLocalServerList,
  EventId,
  type EditorId,
  type FileManagerRevealKind,
  type OrchestrationClientOrigin,
  type OrchestrationCommand,
  type GitActionProgressEvent,
  type GitRunStackedActionResult,
  type GitManagerServiceError,
  OrchestrationDispatchCommandError,
  type OrchestrationEvent,
  type OrchestrationShellStreamEvent,
  type OrchestrationShellStreamItem,
  type OrchestrationThreadStreamItem,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetSnapshotError,
  OrchestrationSearchThreadsError,
  OrchestrationGetTurnDiffError,
  ORCHESTRATION_WS_METHODS,
  MERCURIAN_WS_METHODS,
  MERCURIAN_REPOSITORY_WS_METHODS,
  MERCURIAN_MEMORY_WS_METHODS,
  MERCURIAN_TRACKER_WS_METHODS,
  MERCURIAN_WORKSPACE_WS_METHODS,
  MercurianCommitId,
  MercurianPlanningError,
  MercurianRepositoryError,
  MercurianMemoryError,
  ConfirmMemoryAmendmentBlockedError,
  MercurianTrackerError,
  MercurianWorkspaceError,
  isConfirmSplitsBlockedError,
  isConfirmMemoryAmendmentBlockedError,
  isCodingSessionBlockedError,
  isImplementBlockedError,
  isMercurianProjectNotFoundError,
  isMercurianRepositoryNotFoundError,
  isMemoryNotDesignatedError,
  isMemorySourceInvalidError,
  isProductMapAlreadyExistsError,
  isProductMapCycleError,
  isPlanDeleteBlockedError,
  isRepositoryAlreadyRegisteredError,
  isRepositoryHasLiveWorktreesError,
  isRepositoryPathInvalidError,
  isPlanNotFoundError,
  isPlanTurnActiveError,
  isSpecRevisionOutdatedError,
  specDocumentFromIssue,
  SpecRevisionOutdatedError,
  SpecRefreshUnavailableError,
  isSpecRefreshUnavailableError,
  isTrackerAuthError,
  isTrackerConnectionNotFoundError,
  isTrackerUnreachableError,
  type PlanId,
  type PlanStreamItem,
  type ProjectId,
  type ProjectEntriesFailure,
  type ProjectFileFailure,
  type ProjectFileOperation,
  ProjectListEntriesError,
  ProjectReadFileError,
  ProjectSearchContentsError,
  ProjectSearchEntriesError,
  ProjectWriteFileError,
  ProviderUploadFeedbackError,
  RelayClientInstallFailedError,
  type RelayClientInstallProgressEvent,
  type ServerSelfUpdateError,
  type ServerSelfUpdateProgressEvent,
  type FilesystemBrowseFailure,
  FilesystemBrowseError,
  AssetWorkspaceContextNotFoundError,
  AssetWorkspaceContextResolutionError,
  RpcClientId,
  EnvironmentAuthorizationError,
  ThreadId,
  type TerminalAttachStreamEvent,
  type TerminalError,
  type TerminalEvent,
  type TerminalMetadataStreamEvent,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import { resolveServerBackgroundActivitySettings } from "@t3tools/shared/backgroundActivitySettings";
import { HttpRouter, HttpServerRequest, HttpServerRespondable } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import * as CheckpointDiffQuery from "./checkpointing/CheckpointDiffQuery.ts";
import * as ServerConfig from "./config.ts";
import * as Keybindings from "./keybindings.ts";
import * as ExternalLauncher from "./process/externalLauncher.ts";
import {
  projectActivityEvent,
  projectThreadDetailSnapshot,
} from "./orchestration/ActivityPayloadProjection.ts";
import {
  cleanupFailedUploadedAttachments,
  normalizeDispatchCommand,
} from "./orchestration/Normalizer.ts";
import * as OrchestrationEngine from "./orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import * as PlanningAssistant from "./mercurian/assistant/PlanningAssistant.ts";
import { CommitId } from "./mercurian/commitTree/schema.ts";
import {
  normalizePlanAttachments,
  removePlanAttachments,
} from "./mercurian/planning/attachments.ts";
import * as PlanningStore from "./mercurian/planning/PlanningStore.ts";
import * as CodingSessionStore from "./mercurian/codingSessions/CodingSessionStore.ts";
import * as CodingSessionService from "./mercurian/codingSessions/CodingSessionService.ts";
import { toWireCodingSessionRecord } from "./mercurian/codingSessions/wire.ts";
import {
  toWirePlanCommitEvent,
  composePlanRowStatus,
  toWirePlanDetail,
  toWirePlanImport,
  toWirePlanMessage,
  toWirePlanRevision,
  toWirePlanSpecRevision,
  toWirePlanTextAt,
  toWireSpecAt,
  toWireProject,
  toWireTreeSnapshot,
} from "./mercurian/planning/wire.ts";
import * as RepositoryStore from "./mercurian/repositories/RepositoryStore.ts";
import * as MemorySourceStore from "./mercurian/memory/MemorySourceStore.ts";
import * as MemoryIndex from "./mercurian/memory/MemoryIndex.ts";
import { toWireMemorySourcesSnapshot } from "./mercurian/memory/wire.ts";
import * as WorkspaceSettingsStore from "./mercurian/workspace/WorkspaceSettingsStore.ts";
import { toWireRepositoriesSnapshot, toWireRepository } from "./mercurian/repositories/wire.ts";
import * as TrackerStore from "./mercurian/trackers/TrackerStore.ts";
import { toWireConnection, toWireTrackersSnapshot } from "./mercurian/trackers/wire.ts";
import {
  observeRpcEffect as instrumentRpcEffect,
  observeRpcStream as instrumentRpcStream,
  observeRpcStreamEffect as instrumentRpcStreamEffect,
} from "./observability/RpcInstrumentation.ts";
import * as ProviderRegistry from "./provider/Services/ProviderRegistry.ts";
import * as ProviderService from "./provider/Services/ProviderService.ts";
import * as ProviderMaintenanceRunner from "./provider/providerMaintenanceRunner.ts";
import * as ServerSelfUpdate from "./cloud/selfUpdate.ts";
import * as ServerLifecycleEvents from "./serverLifecycleEvents.ts";
import * as ServerRuntimeStartup from "./serverRuntimeStartup.ts";
import * as ServerSettings from "./serverSettings.ts";
import * as TerminalManager from "./terminal/Manager.ts";
import * as PreviewAutomationBroker from "./mcp/PreviewAutomationBroker.ts";
import * as PreviewManager from "./preview/Manager.ts";
import { issueAssetUrl } from "./assets/AssetAccess.ts";
import { deletePendingAttachment, issueAttachmentUploadUrl } from "./assets/AttachmentUpload.ts";
import * as PortScanner from "./preview/PortScanner.ts";
import * as WorkspaceEntries from "./workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "./workspace/WorkspaceFileSystem.ts";
import { readWorkflowScript } from "./orchestration/workflowScriptQuery.ts";
import * as WorkspacePaths from "./workspace/WorkspacePaths.ts";
import * as VcsStatusBroadcaster from "./vcs/VcsStatusBroadcaster.ts";
import * as VcsProvisioningService from "./vcs/VcsProvisioningService.ts";
import * as GitWorkflowService from "./git/GitWorkflowService.ts";
import * as ReviewService from "./review/ReviewService.ts";
import * as ProjectSetupScriptRunner from "./project/ProjectSetupScriptRunner.ts";
import * as ServerEnvironment from "./environment/ServerEnvironment.ts";
import * as RemoteOpenTargets from "./environment/RemoteOpenTargets.ts";
import * as BackgroundPolicy from "./background/BackgroundPolicy.ts";
import * as EnvironmentAuth from "./auth/EnvironmentAuth.ts";
import { requiredScopeForRpcMethod } from "./auth/RpcAuthorization.ts";
import * as ProcessDiagnostics from "./diagnostics/ProcessDiagnostics.ts";
import * as ProcessResourceMonitor from "./diagnostics/ProcessResourceMonitor.ts";
import * as ResourceTelemetry from "./resourceTelemetry/ResourceTelemetry.ts";
import * as AnalyticsService from "./telemetry/AnalyticsService.ts";
import * as UsageService from "./usage/UsageService.ts";
import * as TraceDiagnostics from "./diagnostics/TraceDiagnostics.ts";
import * as PullRequestService from "./pullRequest/PullRequestService.ts";
import * as SourceControlDiscovery from "./sourceControl/SourceControlDiscovery.ts";
import * as SourceControlRepositoryService from "./sourceControl/SourceControlRepositoryService.ts";
import * as AzureDevOpsCli from "./sourceControl/AzureDevOpsCli.ts";
import * as BitbucketApi from "./sourceControl/BitbucketApi.ts";
import * as GitHubCli from "./sourceControl/GitHubCli.ts";
import * as GitLabCli from "./sourceControl/GitLabCli.ts";
import * as SourceControlProviderRegistry from "./sourceControl/SourceControlProviderRegistry.ts";
import * as GitVcsDriver from "./vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "./vcs/VcsDriverRegistry.ts";
import * as VcsProjectConfig from "./vcs/VcsProjectConfig.ts";
import * as VcsProcess from "./vcs/VcsProcess.ts";
import * as PairingGrantStore from "./auth/PairingGrantStore.ts";
import * as SessionStore from "./auth/SessionStore.ts";
import { failEnvironmentAuthInvalid, failEnvironmentInternal } from "./auth/http.ts";
import * as RelayClient from "@t3tools/shared/relayClient";
const isOrchestrationDispatchCommandError = Schema.is(OrchestrationDispatchCommandError);

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
const CONFIG_DISCOVERY_TIMEOUT = Duration.seconds(5);

const resolveDiscoveryForConfig = <A, E, R>(
  discovery: Effect.Effect<A, E, R>,
  onTimeout: () => A,
) =>
  discovery.pipe(
    Effect.timeoutOption(CONFIG_DISCOVERY_TIMEOUT),
    Effect.map(Option.getOrElse(onTimeout)),
  );

export const resolveAvailableEditorsForConfig = <A, E, R>(
  discovery: Effect.Effect<ReadonlyArray<A>, E, R>,
) => resolveDiscoveryForConfig(discovery, () => []);

export const resolveFileManagerRevealKindForConfig = <E, R>(
  discovery: Effect.Effect<FileManagerRevealKind | undefined, E, R>,
) => resolveDiscoveryForConfig(discovery, () => undefined);

function unexpectedCompatibilityError(error: never): never {
  throw new Error(`Unhandled compatibility error: ${String(error)}`);
}

/** Preserve the setup runner's broader pre-refactor message normalization. */
function legacySetupFailureDescription(cause: unknown): string {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "message" in cause &&
    typeof cause.message === "string"
  ) {
    return cause.message;
  }
  return String(cause);
}

function projectEntriesFailureContext(error: WorkspaceEntries.WorkspaceEntriesError): {
  readonly failure: ProjectEntriesFailure;
  readonly normalizedCwd?: string;
  readonly timeout?: string;
  readonly detail?: string;
} {
  switch (error._tag) {
    case "WorkspaceRootNotExistsError":
      return {
        failure: "workspace_root_not_found",
        normalizedCwd: error.normalizedWorkspaceRoot,
      };
    case "WorkspaceRootCreateFailedError":
      return {
        failure: "workspace_root_create_failed",
        normalizedCwd: error.normalizedWorkspaceRoot,
      };
    case "WorkspaceRootStatFailedError":
      return {
        failure: "workspace_root_stat_failed",
        normalizedCwd: error.normalizedWorkspaceRoot,
        detail: error.phase,
      };
    case "WorkspaceRootNotDirectoryError":
      return {
        failure: "workspace_root_not_directory",
        normalizedCwd: error.normalizedWorkspaceRoot,
      };
    case "WorkspaceSearchIndexCreateFailed":
      return {
        failure: "search_index_create_failed",
        normalizedCwd: error.cwd,
        detail: error.reason,
      };
    case "WorkspaceSearchIndexScanTimedOut":
      return {
        failure: "search_index_scan_timed_out",
        normalizedCwd: error.cwd,
        timeout: error.timeout,
      };
    case "WorkspaceSearchIndexSearchFailed":
      return {
        failure: "search_index_search_failed",
        normalizedCwd: error.cwd,
        detail: error.reason,
      };
    default:
      return unexpectedCompatibilityError(error);
  }
}

function filesystemBrowseFailureContext(error: WorkspaceEntries.WorkspaceEntriesBrowseError): {
  readonly failure: FilesystemBrowseFailure;
  readonly parentPath?: string;
  readonly platform?: string;
} {
  switch (error._tag) {
    case "WorkspaceEntriesWindowsPathUnsupportedError":
      return { failure: "windows_path_unsupported", platform: error.platform };
    case "WorkspaceEntriesCurrentProjectRequiredError":
      return { failure: "current_project_required" };
    case "WorkspaceEntriesReadDirectoryError":
      return { failure: "read_directory_failed", parentPath: error.parentPath };
    default:
      return unexpectedCompatibilityError(error);
  }
}

function projectFileFailureContext(
  error:
    | WorkspaceFileSystem.WorkspaceFileSystemError
    | WorkspacePaths.WorkspacePathOutsideRootError,
): {
  readonly failure: ProjectFileFailure;
  readonly resolvedPath?: string;
  readonly resolvedWorkspaceRoot?: string;
  readonly operation?: ProjectFileOperation;
  readonly operationPath?: string;
} {
  switch (error._tag) {
    case "WorkspacePathOutsideRootError":
      return { failure: "workspace_path_outside_root" };
    case "WorkspaceFileSystemOperationError":
      return {
        failure: "operation_failed",
        resolvedPath: error.resolvedPath,
        operation: error.operation,
        operationPath: error.operationPath,
      };
    case "WorkspaceFilePathEscapeError":
      return {
        failure: "resolved_path_outside_root",
        resolvedPath: error.resolvedPath,
        resolvedWorkspaceRoot: error.resolvedWorkspaceRoot,
      };
    case "WorkspacePathNotFileError":
      return { failure: "path_not_file", resolvedPath: error.resolvedPath };
    case "WorkspaceBinaryFileError":
      return { failure: "binary_file", resolvedPath: error.resolvedPath };
    default:
      return unexpectedCompatibilityError(error);
  }
}

function projectSetupScriptCompatibilityDetail(
  error: ProjectSetupScriptRunner.ProjectSetupScriptRunnerError,
): string {
  switch (error._tag) {
    case "ProjectSetupScriptOperationError":
      return legacySetupFailureDescription(error.cause);
    case "ProjectSetupScriptProjectNotFoundError":
      return "Project was not found for setup script execution.";
    default:
      return unexpectedCompatibilityError(error);
  }
}

export function isThreadDetailEvent(event: OrchestrationEvent): event is Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.message-sent"
      | "thread.proposed-plan-upserted"
      | "thread.activity-appended"
      | "thread.turn-diff-completed"
      | "thread.reverted"
      | "thread.session-set";
  }
> {
  return (
    event.type === "thread.message-sent" ||
    event.type === "thread.proposed-plan-upserted" ||
    event.type === "thread.activity-appended" ||
    event.type === "thread.turn-diff-completed" ||
    event.type === "thread.reverted" ||
    event.type === "thread.session-set"
  );
}

export function isCodingSessionStatusEvent(event: OrchestrationEvent): event is Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.activity-appended"
      | "thread.session-set"
      | "thread.turn-start-requested"
      | "thread.turn-interrupt-requested"
      | "thread.approval-response-requested"
      | "thread.user-input-response-requested";
  }
> {
  return (
    event.type === "thread.activity-appended" ||
    event.type === "thread.session-set" ||
    event.type === "thread.turn-start-requested" ||
    event.type === "thread.turn-interrupt-requested" ||
    event.type === "thread.approval-response-requested" ||
    event.type === "thread.user-input-response-requested"
  );
}

export const codingSessionStatusChanges = (
  events: Stream.Stream<OrchestrationEvent>,
  getByThreadId: CodingSessionStore.CodingSessionStore["Service"]["getByThreadId"],
) =>
  events.pipe(
    Stream.filter(isCodingSessionStatusEvent),
    Stream.filterEffect((event) =>
      getByThreadId(event.payload.threadId).pipe(Effect.map(Option.isSome)),
    ),
  );

export const attachCreatedPullRequestToCodingSession = Effect.fn(
  "ws.attachCreatedPullRequestToCodingSession",
)(function* (
  codingSessionStore: Pick<
    CodingSessionStore.CodingSessionStore["Service"],
    "getByWorktreePath" | "attachPullRequest"
  >,
  cwd: string,
  result: GitRunStackedActionResult,
) {
  if (result.pr.status !== "created" || result.pr.url === undefined) return;
  const session = yield* codingSessionStore.getByWorktreePath(cwd);
  if (Option.isNone(session)) return;
  yield* codingSessionStore.attachPullRequest({
    threadId: session.value.threadId,
    prUrl: result.pr.url,
  });
});

const PROVIDER_STATUS_DEBOUNCE_MS = 200;

// When a resuming client's cursor is more than this many events behind the
// current head, skip the per-event catch-up replay and send a fresh shell
// snapshot instead. Replaying each intervening event costs a shell refetch;
// past this gap a single O(active-threads) snapshot is cheaper and bounded.
// Matches the event store's default page size (DEFAULT_READ_FROM_SEQUENCE_LIMIT).
const SHELL_RESUME_MAX_GAP = 1_000;

// Same bound for thread resume. The replay reads the *global* event range and
// filters per-thread afterwards, so a stale cursor far behind the head would
// otherwise decode every intervening event's payload — reconnects with cursors
// hundreds of thousands of events behind have OOM-killed servers on large
// databases. Past this gap the client is reset with a fresh thread snapshot.
const THREAD_RESUME_MAX_GAP = 1_000;

// Same bound for a planning space's resume. The replay here is already scoped
// to one history by the cursor query, so the cost is bounded by that plan's own
// commits — but a cursor further behind than this means the client has drifted
// far enough that one snapshot of a human-scale plan is the simpler answer.
const PLAN_RESUME_MAX_GAP = 1_000;

function toAuthAccessStreamEvent(
  change: PairingGrantStore.BootstrapCredentialChange | SessionStore.SessionCredentialChange,
  revision: number,
  currentSessionId: AuthSessionId,
): AuthAccessStreamEvent {
  switch (change.type) {
    case "pairingLinkUpserted":
      return {
        version: 1,
        revision,
        type: "pairingLinkUpserted",
        payload: change.pairingLink,
      };
    case "pairingLinkRemoved":
      return {
        version: 1,
        revision,
        type: "pairingLinkRemoved",
        payload: { id: change.id },
      };
    case "clientUpserted":
      return {
        version: 1,
        revision,
        type: "clientUpserted",
        payload: {
          ...change.clientSession,
          current: change.clientSession.sessionId === currentSessionId,
        },
      };
    case "clientRemoved":
      return {
        version: 1,
        revision,
        type: "clientRemoved",
        payload: { sessionId: change.sessionId },
      };
  }
}

const isClientSurface = Schema.is(ClientSurface);
const MAX_CLIENT_APP_VERSION_LENGTH = 64;
const MAX_CLIENT_DEVICE_MODEL_LENGTH = 80;

// Optional client identity announced on the /ws upgrade URL next to wsTicket.
// Lenient by design: absent or malformed values degrade to {} so a connection
// never fails over attribution metadata.
function readClientConnectionOrigin(
  request: HttpServerRequest.HttpServerRequest,
): OrchestrationClientOrigin {
  const url = HttpServerRequest.toURL(request);
  if (Option.isNone(url)) {
    return {};
  }
  const surface = url.value.searchParams.get("clientSurface");
  const appVersion = url.value.searchParams.get("clientAppVersion")?.trim() ?? "";
  return {
    ...(isClientSurface(surface) ? { surface } : {}),
    ...(appVersion !== "" && appVersion.length <= MAX_CLIENT_APP_VERSION_LENGTH
      ? { appVersion }
      : {}),
  };
}

const clientOriginAnalyticsProps = (origin: OrchestrationClientOrigin) => ({
  ...(origin.surface !== undefined ? { surface: origin.surface } : {}),
  ...(origin.appVersion !== undefined ? { appVersion: origin.appVersion } : {}),
});

function readMobileDeviceAnalyticsProps(request: HttpServerRequest.HttpServerRequest) {
  const url = HttpServerRequest.toURL(request);
  if (Option.isNone(url) || url.value.searchParams.get("clientSurface") !== "mobile") {
    return {};
  }

  const os = url.value.searchParams.get("clientOs");
  const rawOsMajorVersion = url.value.searchParams.get("clientOsMajorVersion") ?? "";
  const osMajorVersion = Number(rawOsMajorVersion);
  const deviceModel = url.value.searchParams.get("clientDeviceModel")?.trim() ?? "";

  return {
    ...(os === "iOS" || os === "Android" ? { os } : {}),
    ...(rawOsMajorVersion !== "" && Number.isInteger(osMajorVersion) && osMajorVersion > 0
      ? { osMajorVersion }
      : {}),
    ...(deviceModel !== "" && deviceModel.length <= MAX_CLIENT_DEVICE_MODEL_LENGTH
      ? { deviceModel }
      : {}),
  };
}

const makeWsRpcLayer = (
  currentSession: EnvironmentAuth.AuthenticatedSession,
  clientOrigin: OrchestrationClientOrigin,
  previewAutomationBroker: PreviewAutomationBroker.PreviewAutomationBroker["Service"],
) =>
  WsRpcGroup.toLayer(
    Effect.gen(function* () {
      const currentSessionId = currentSession.sessionId;
      const crypto = yield* Crypto.Crypto;
      const projectionSnapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
      const orchestrationEngine = yield* OrchestrationEngine.OrchestrationEngineService;
      const planningStore = yield* PlanningStore.PlanningStore;
      const codingSessionStore = yield* CodingSessionStore.CodingSessionStore;
      const codingSessionService = yield* CodingSessionService.CodingSessionService;
      const planningAssistant = yield* PlanningAssistant.PlanningAssistant;
      const repositoryStore = yield* RepositoryStore.RepositoryStore;
      const memorySourceStore = yield* MemorySourceStore.MemorySourceStore;
      const memoryIndex = yield* MemoryIndex.MemoryIndex;
      const trackerStore = yield* TrackerStore.TrackerStore;
      const workspaceSettingsStore = yield* WorkspaceSettingsStore.WorkspaceSettingsStore;
      const analytics = yield* AnalyticsService.AnalyticsService;
      // Every command dispatched on this connection carries the connecting
      // client's origin, including server-generated bootstrap sub-commands:
      // the client's request caused them.
      const hasClientOrigin =
        clientOrigin.surface !== undefined || clientOrigin.appVersion !== undefined;
      const dispatchFromClient: OrchestrationEngine.OrchestrationEngineShape["dispatch"] = (
        command,
      ) =>
        orchestrationEngine.dispatch(
          command,
          hasClientOrigin ? { origin: clientOrigin } : undefined,
        );
      const originProps = clientOriginAnalyticsProps(clientOrigin);
      const recordClientCommandAnalytics = (command: OrchestrationCommand) => {
        switch (command.type) {
          case "thread.create":
            return analytics.record("client.thread.started", originProps);
          case "thread.turn.start":
            return command.bootstrap?.createThread
              ? Effect.andThen(
                  analytics.record("client.thread.started", originProps),
                  analytics.record("client.turn.requested", originProps),
                )
              : analytics.record("client.turn.requested", originProps);
          default:
            return Effect.void;
        }
      };
      const checkpointDiffQuery = yield* CheckpointDiffQuery.CheckpointDiffQuery;
      const keybindings = yield* Keybindings.Keybindings;
      const externalLauncher = yield* ExternalLauncher.ExternalLauncher;
      const remoteOpenTargets = yield* RemoteOpenTargets.RemoteOpenTargets;
      const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
      const review = yield* ReviewService.ReviewService;
      const vcsProvisioning = yield* VcsProvisioningService.VcsProvisioningService;
      const vcsStatusBroadcaster = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
      const terminalManager = yield* TerminalManager.TerminalManager;
      const previewManager = yield* PreviewManager.PreviewManager;
      const portDiscovery = yield* PortScanner.PortDiscovery;
      const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
      const providerService = yield* ProviderService.ProviderService;
      const providerMaintenanceRunner = yield* ProviderMaintenanceRunner.ProviderMaintenanceRunner;
      const serverSelfUpdate = yield* ServerSelfUpdate.ServerSelfUpdate;
      const config = yield* ServerConfig.ServerConfig;
      const lifecycleEvents = yield* ServerLifecycleEvents.ServerLifecycleEvents;
      const serverSettings = yield* ServerSettings.ServerSettingsService;
      const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;
      const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
      const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
      const projectSetupScriptRunner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
      const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
      const backgroundPolicy = yield* BackgroundPolicy.BackgroundPolicy;
      const rpcClientIds = yield* Ref.make(new Set<RpcClientId>());
      yield* Effect.addFinalizer(() =>
        Ref.get(rpcClientIds).pipe(
          Effect.flatMap((clientIds) =>
            Effect.forEach(
              clientIds,
              (clientId) => backgroundPolicy.removeRpcClient(currentSessionId, clientId),
              {
                discard: true,
              },
            ),
          ),
          Effect.ignore,
        ),
      );
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const sourceControlDiscovery = yield* SourceControlDiscovery.SourceControlDiscovery;
      const automaticGitFetchInterval = serverSettings.getSettings.pipe(
        Effect.map(
          (settings) => resolveServerBackgroundActivitySettings(settings).automaticGitFetchInterval,
        ),
        Effect.catch((cause) =>
          Effect.logWarning("Failed to read automatic Git fetch interval setting", {
            detail: cause.message,
          }).pipe(Effect.as(DEFAULT_AUTOMATIC_GIT_FETCH_INTERVAL)),
        ),
      );
      const sourceControlRepositories =
        yield* SourceControlRepositoryService.SourceControlRepositoryService;
      const pullRequests = yield* PullRequestService.PullRequestService;
      const bootstrapCredentials = yield* PairingGrantStore.PairingGrantStore;
      const sessions = yield* SessionStore.SessionStore;
      const processDiagnostics = yield* ProcessDiagnostics.ProcessDiagnostics;
      const processResourceMonitor = yield* ProcessResourceMonitor.ProcessResourceMonitor;
      const resourceTelemetry = yield* ResourceTelemetry.ResourceTelemetry;
      const usage = yield* UsageService.UsageService;
      const relayClient = yield* RelayClient.RelayClient;
      const authorizationError = (requiredScope: AuthEnvironmentScope) =>
        new EnvironmentAuthorizationError({
          message: `The authenticated token is missing required scope: ${requiredScope}.`,
          requiredScope,
        });
      const authorizeEffect = <A, E, R>(
        requiredScope: AuthEnvironmentScope,
        effect: Effect.Effect<A, E, R>,
      ): Effect.Effect<A, E | EnvironmentAuthorizationError, R> =>
        currentSession.scopes.includes(requiredScope)
          ? effect
          : Effect.fail(authorizationError(requiredScope));
      const authorizeStream = <A, E, R>(
        requiredScope: AuthEnvironmentScope,
        stream: Stream.Stream<A, E, R>,
      ): Stream.Stream<A, E | EnvironmentAuthorizationError, R> =>
        currentSession.scopes.includes(requiredScope)
          ? stream
          : Stream.fail(authorizationError(requiredScope));
      const observeRpcEffect = <A, E, R>(
        method: string,
        effect: Effect.Effect<A, E, R>,
        traceAttributes?: Readonly<Record<string, unknown>>,
      ) =>
        instrumentRpcEffect(
          method,
          authorizeEffect(requiredScopeForRpcMethod(method), effect),
          traceAttributes,
        );
      const observeRpcStream = <A, E, R>(
        method: string,
        stream: Stream.Stream<A, E, R>,
        traceAttributes?: Readonly<Record<string, unknown>>,
      ) =>
        instrumentRpcStream(
          method,
          authorizeStream(requiredScopeForRpcMethod(method), stream),
          traceAttributes,
        );
      const observeRpcStreamEffect = <A, StreamError, StreamContext, EffectError, EffectContext>(
        method: string,
        effect: Effect.Effect<
          Stream.Stream<A, StreamError, StreamContext>,
          EffectError,
          EffectContext
        >,
        traceAttributes?: Readonly<Record<string, unknown>>,
      ) =>
        instrumentRpcStreamEffect(
          method,
          authorizeEffect(requiredScopeForRpcMethod(method), effect),
          traceAttributes,
        );
      const toDispatchCommandError = (cause: unknown, fallbackMessage: string) =>
        isOrchestrationDispatchCommandError(cause)
          ? cause
          : new OrchestrationDispatchCommandError({
              message: cause instanceof Error ? cause.message : fallbackMessage,
              cause,
            });
      const randomUUID = crypto.randomUUIDv4.pipe(
        Effect.mapError((cause) =>
          toDispatchCommandError(cause, "Failed to generate orchestration command identifier."),
        ),
      );
      const serverEventId = randomUUID.pipe(Effect.map(EventId.make));
      const serverCommandId = (tag: string) =>
        randomUUID.pipe(Effect.map((uuid) => CommandId.make(`server:${tag}:${uuid}`)));

      const loadAuthAccessSnapshot = () =>
        Effect.all({
          pairingLinks: serverAuth.listPairingLinks(),
          clientSessions: serverAuth.listClientSessions(currentSessionId),
        }).pipe(
          Effect.mapError(
            (error) =>
              new AuthAccessStreamError({
                message: error.message,
              }),
          ),
        );

      const appendSetupScriptActivity = (input: {
        readonly threadId: ThreadId;
        readonly kind: "setup-script.requested" | "setup-script.started" | "setup-script.failed";
        readonly summary: string;
        readonly createdAt: string;
        readonly payload: Record<string, unknown>;
        readonly tone: "info" | "error";
      }) =>
        Effect.all({
          commandId: serverCommandId("setup-script-activity"),
          activityId: serverEventId,
        }).pipe(
          Effect.flatMap(({ commandId, activityId }) =>
            dispatchFromClient({
              type: "thread.activity.append",
              commandId,
              threadId: input.threadId,
              activity: {
                id: activityId,
                tone: input.tone,
                kind: input.kind,
                summary: input.summary,
                payload: input.payload,
                turnId: null,
                createdAt: input.createdAt,
              },
              createdAt: input.createdAt,
            }),
          ),
        );

      const toBootstrapDispatchCommandCauseError = (cause: Cause.Cause<unknown>) => {
        const error = Cause.squash(cause);
        return isOrchestrationDispatchCommandError(error)
          ? error
          : new OrchestrationDispatchCommandError({
              message:
                error instanceof Error ? error.message : "Failed to bootstrap thread turn start.",
              cause,
            });
      };

      const toShellStreamEvent = (
        event: OrchestrationEvent,
      ): Effect.Effect<Option.Option<OrchestrationShellStreamEvent>, never, never> => {
        switch (event.type) {
          case "project.created":
          case "project.meta-updated":
            return projectUpsertOrRemove(event.payload.projectId, event.sequence);
          case "project.deleted":
            return Effect.succeed(
              Option.some({
                kind: "project-removed" as const,
                sequence: event.sequence,
                projectId: event.payload.projectId,
              }),
            );
          case "thread.deleted":
          case "thread.archived":
            return Effect.succeed(
              Option.some({
                kind: "thread-removed" as const,
                sequence: event.sequence,
                threadId: event.payload.threadId,
              }),
            );
          case "thread.unarchived":
            return threadUpsertOrRemove(event.payload.threadId, event.sequence);
          default:
            if (event.aggregateKind !== "thread") {
              return Effect.succeed(Option.none());
            }
            return threadUpsertOrRemove(ThreadId.make(event.aggregateId), event.sequence);
        }
      };

      // Coalescing makes each projection read represent every event for that
      // aggregate in the current window. Retry a typed persistence failure once
      // so a brief read failure cannot strand the shell at its previous state.
      // If both attempts fail, log and drop the stream item; treating an error as
      // a missing row would incorrectly remove a still-active aggregate.
      const retryShellProjectionRead = <A, E>(
        aggregateKind: "project" | "thread",
        aggregateId: string,
        read: Effect.Effect<A, E>,
      ): Effect.Effect<Option.Option<A>, never, never> =>
        read.pipe(
          Effect.retry({ times: 1 }),
          Effect.map(Option.some),
          Effect.tapError((error) =>
            Effect.logWarning("orchestration shell projection refetch failed", {
              aggregateKind,
              aggregateId,
              error,
            }),
          ),
          Effect.orElseSucceed(() => Option.none()),
        );

      const projectUpsertOrRemove = (
        projectId: ProjectId,
        sequence: number,
      ): Effect.Effect<Option.Option<OrchestrationShellStreamEvent>, never, never> =>
        retryShellProjectionRead(
          "project",
          projectId,
          projectionSnapshotQuery.getProjectShellById(projectId),
        ).pipe(
          Effect.map(
            Option.flatMap((project) =>
              Option.match(project, {
                onNone: () =>
                  Option.some<OrchestrationShellStreamEvent>({
                    kind: "project-removed" as const,
                    sequence,
                    projectId,
                  }),
                onSome: (nextProject) =>
                  Option.some<OrchestrationShellStreamEvent>({
                    kind: "project-upserted" as const,
                    sequence,
                    project: nextProject,
                  }),
              }),
            ),
          ),
        );

      // Refetch a thread's shell and emit an upsert if it is still active, or a
      // `thread-removed` if the projection has no active row for it. Emitting a
      // removal on a `none` (rather than dropping the event) is what keeps
      // coalescing correct: when a burst collapses a `thread.deleted`/`archived`
      // into a later refetchable event for the same thread, the refetch returns
      // `none` for the now-inactive row and this still tells the sidebar to drop
      // it. A `thread-removed` the client does not have is a harmless no-op. The
      // projection commits in the same transaction before the event publishes,
      // so a `none` reliably means the thread is deleted or archived, not
      // not-yet-persisted.
      const threadUpsertOrRemove = (
        threadId: ThreadId,
        sequence: number,
      ): Effect.Effect<Option.Option<OrchestrationShellStreamEvent>, never, never> =>
        retryShellProjectionRead(
          "thread",
          threadId,
          projectionSnapshotQuery.getThreadShellById(threadId),
        ).pipe(
          Effect.map(
            Option.flatMap((thread) =>
              Option.match(thread, {
                onNone: () =>
                  Option.some<OrchestrationShellStreamEvent>({
                    kind: "thread-removed" as const,
                    sequence,
                    threadId,
                  }),
                onSome: (nextThread) =>
                  Option.some<OrchestrationShellStreamEvent>({
                    kind: "thread-upserted" as const,
                    sequence,
                    thread: nextThread,
                  }),
              }),
            ),
          ),
        );

      // Turn a batch of domain events into shell stream items, coalescing by
      // aggregate first. `toShellStreamEvent` re-reads the *current* projected
      // shell for an aggregate, so within a batch only the latest event per
      // aggregate matters: a burst of streaming `thread.message-sent` deltas for
      // one thread collapses into a single shell refetch, and an unrelated
      // `thread.created` in the same batch is never stuck behind those DB reads.
      //
      // Input events arrive in ascending sequence; we keep the last (highest
      // sequence) event per aggregate, then re-sort ascending before emitting so
      // the client — which applies shell items strictly by increasing sequence
      // and drops any `sequence <= snapshotSequence` — never skips a coalesced
      // item. The refetch runs with bounded concurrency (order-preserving).
      const SHELL_REFETCH_CONCURRENCY = 8;
      const coalesceShellEvents = (
        events: ReadonlyArray<OrchestrationEvent>,
      ): Effect.Effect<ReadonlyArray<OrchestrationShellStreamEvent>, never, never> =>
        Effect.gen(function* () {
          if (events.length === 0) {
            return [];
          }
          const latestByAggregate = new Map<string, OrchestrationEvent>();
          for (const event of events) {
            latestByAggregate.set(`${event.aggregateKind}:${event.aggregateId}`, event);
          }
          const survivors = Array.from(latestByAggregate.values()).sort(
            (left, right) => left.sequence - right.sequence,
          );
          const shellEvents = yield* Effect.forEach(survivors, toShellStreamEvent, {
            concurrency: SHELL_REFETCH_CONCURRENCY,
          });
          return shellEvents.flatMap((option) => (Option.isSome(option) ? [option.value] : []));
        });

      // Small time/size window over which to coalesce shell events. The window
      // bounds the worst-case added latency for a brand-new thread to appear in
      // the sidebar (imperceptible), while collapsing high-frequency streaming
      // traffic so it can't serialize the shell stream behind per-event DB reads.
      const SHELL_COALESCE_WINDOW = Duration.millis(50);
      const SHELL_COALESCE_MAX_CHUNK = 512;
      const coalesceShellStream = <E, R>(
        stream: Stream.Stream<OrchestrationEvent, E, R>,
      ): Stream.Stream<OrchestrationShellStreamEvent, E, R> =>
        stream.pipe(
          Stream.groupedWithin(SHELL_COALESCE_MAX_CHUNK, SHELL_COALESCE_WINDOW),
          Stream.mapEffect(coalesceShellEvents),
          Stream.flatMap((items) => Stream.fromIterable(items)),
        );

      type ShellLiveInput =
        | { readonly kind: "event"; readonly event: OrchestrationEvent }
        | { readonly kind: "synchronized" };

      // A completion marker is queued alongside raw live events so it cannot
      // overtake an event still waiting in the coalescing window. Split each
      // batch at markers and coalesce only the event segments on either side.
      const coalesceShellLiveInputs = (
        inputs: ReadonlyArray<ShellLiveInput>,
      ): Effect.Effect<ReadonlyArray<OrchestrationShellStreamItem>, never, never> =>
        Effect.gen(function* () {
          const output: Array<OrchestrationShellStreamItem> = [];
          let pendingEvents: Array<OrchestrationEvent> = [];

          for (const input of inputs) {
            if (input.kind === "event") {
              pendingEvents.push(input.event);
              continue;
            }

            output.push(...(yield* coalesceShellEvents(pendingEvents)));
            pendingEvents = [];
            output.push({ kind: "synchronized" });
          }

          output.push(...(yield* coalesceShellEvents(pendingEvents)));
          return output;
        });

      const coalesceShellLiveStream = <E, R>(
        stream: Stream.Stream<ShellLiveInput, E, R>,
      ): Stream.Stream<OrchestrationShellStreamItem, E, R> =>
        stream.pipe(
          Stream.groupedWithin(SHELL_COALESCE_MAX_CHUNK, SHELL_COALESCE_WINDOW),
          Stream.mapEffect(coalesceShellLiveInputs),
          Stream.flatMap((items) => Stream.fromIterable(items)),
        );

      const dispatchBootstrapTurnStart = (
        command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
      ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> =>
        Effect.gen(function* () {
          const bootstrap = command.bootstrap;
          const { bootstrap: _bootstrap, ...finalTurnStartCommand } = command;
          let createdThread = false;
          let targetProjectId = bootstrap?.createThread?.projectId;
          let targetProjectCwd = bootstrap?.prepareWorktree?.projectCwd;
          let targetWorktreePath = bootstrap?.createThread?.worktreePath ?? null;

          const cleanupCreatedThread = () =>
            createdThread
              ? serverCommandId("bootstrap-thread-delete").pipe(
                  Effect.flatMap((commandId) =>
                    dispatchFromClient({
                      type: "thread.delete",
                      commandId,
                      threadId: command.threadId,
                    }),
                  ),
                  Effect.as(true),
                )
              : Effect.succeed(false);

          const recordSetupScriptLaunchFailure = (input: {
            readonly error: ProjectSetupScriptRunner.ProjectSetupScriptRunnerError;
            readonly requestedAt: string;
            readonly worktreePath: string;
          }) => {
            const detail = projectSetupScriptCompatibilityDetail(input.error);
            return appendSetupScriptActivity({
              threadId: command.threadId,
              kind: "setup-script.failed",
              summary: "Setup script failed to start",
              createdAt: input.requestedAt,
              payload: {
                detail,
                worktreePath: input.worktreePath,
              },
              tone: "error",
            }).pipe(
              Effect.ignoreCause({ log: false }),
              Effect.flatMap(() =>
                Effect.logWarning("bootstrap turn start failed to launch setup script", {
                  threadId: command.threadId,
                  worktreePath: input.worktreePath,
                  detail,
                }),
              ),
            );
          };

          const recordSetupScriptStarted = (input: {
            readonly requestedAt: string;
            readonly worktreePath: string;
            readonly scriptId: string;
            readonly scriptName: string;
            readonly terminalId: string;
          }) =>
            Effect.gen(function* () {
              const startedAt = yield* nowIso;
              const payload = {
                scriptId: input.scriptId,
                scriptName: input.scriptName,
                terminalId: input.terminalId,
                worktreePath: input.worktreePath,
              };
              yield* Effect.all([
                appendSetupScriptActivity({
                  threadId: command.threadId,
                  kind: "setup-script.requested",
                  summary: "Starting setup script",
                  createdAt: input.requestedAt,
                  payload,
                  tone: "info",
                }),
                appendSetupScriptActivity({
                  threadId: command.threadId,
                  kind: "setup-script.started",
                  summary: "Setup script started",
                  createdAt: startedAt,
                  payload,
                  tone: "info",
                }),
              ]).pipe(
                Effect.asVoid,
                Effect.catch((error) =>
                  Effect.logWarning(
                    "bootstrap turn start launched setup script but failed to record setup activity",
                    {
                      threadId: command.threadId,
                      worktreePath: input.worktreePath,
                      scriptId: input.scriptId,
                      terminalId: input.terminalId,
                      detail: error.message,
                    },
                  ),
                ),
              );
            });

          const runSetupProgram = () =>
            Effect.gen(function* () {
              if (!bootstrap?.runSetupScript || !targetWorktreePath) {
                return;
              }
              const worktreePath = targetWorktreePath;
              const requestedAt = yield* nowIso;
              yield* projectSetupScriptRunner
                .runForThread({
                  threadId: command.threadId,
                  ...(targetProjectId ? { projectId: targetProjectId } : {}),
                  ...(targetProjectCwd ? { projectCwd: targetProjectCwd } : {}),
                  worktreePath,
                })
                .pipe(
                  Effect.matchEffect({
                    onFailure: (error) =>
                      recordSetupScriptLaunchFailure({
                        error,
                        requestedAt,
                        worktreePath,
                      }),
                    onSuccess: (setupResult) => {
                      if (setupResult.status !== "started") {
                        return Effect.void;
                      }
                      return recordSetupScriptStarted({
                        requestedAt,
                        worktreePath,
                        scriptId: setupResult.scriptId,
                        scriptName: setupResult.scriptName,
                        terminalId: setupResult.terminalId,
                      });
                    },
                  }),
                );
            });

          const bootstrapProgram = Effect.gen(function* () {
            if (bootstrap?.createThread) {
              yield* dispatchFromClient({
                type: "thread.create",
                commandId: yield* serverCommandId("bootstrap-thread-create"),
                threadId: command.threadId,
                projectId: bootstrap.createThread.projectId,
                title: bootstrap.createThread.title,
                modelSelection: bootstrap.createThread.modelSelection,
                runtimeMode: bootstrap.createThread.runtimeMode,
                interactionMode: bootstrap.createThread.interactionMode,
                branch: bootstrap.createThread.branch,
                worktreePath: bootstrap.createThread.worktreePath,
                createdAt: bootstrap.createThread.createdAt,
              });
              createdThread = true;
            }

            if (bootstrap?.prepareWorktree) {
              let worktreeBaseRef = bootstrap.prepareWorktree.baseBranch;
              // "Start from origin" is a stored default; repos without an
              // origin remote fall back to the local base branch instead of
              // failing the whole bootstrap on `git fetch origin`.
              const startFromOrigin =
                bootstrap.prepareWorktree.startFromOrigin === true &&
                (yield* gitWorkflow.remoteExists({
                  cwd: bootstrap.prepareWorktree.projectCwd,
                  remoteName: "origin",
                }));
              if (startFromOrigin) {
                yield* gitWorkflow.fetchRemote({
                  cwd: bootstrap.prepareWorktree.projectCwd,
                  remoteName: "origin",
                });
                const resolvedRemoteBase = yield* gitWorkflow.resolveRemoteTrackingCommit({
                  cwd: bootstrap.prepareWorktree.projectCwd,
                  refName: bootstrap.prepareWorktree.baseBranch,
                  fallbackRemoteName: "origin",
                });
                worktreeBaseRef = resolvedRemoteBase.commitSha;
              }
              const worktree = yield* gitWorkflow.createWorktree({
                cwd: bootstrap.prepareWorktree.projectCwd,
                refName: worktreeBaseRef,
                newRefName: bootstrap.prepareWorktree.branch,
                baseRefName: bootstrap.prepareWorktree.baseBranch,
                path: null,
              });
              targetWorktreePath = worktree.worktree.path;
              yield* dispatchFromClient({
                type: "thread.meta.update",
                commandId: yield* serverCommandId("bootstrap-thread-meta-update"),
                threadId: command.threadId,
                branch: worktree.worktree.refName,
                worktreePath: targetWorktreePath,
              });
              yield* refreshGitStatus(targetWorktreePath);
            }

            yield* runSetupProgram();

            return yield* dispatchFromClient(finalTurnStartCommand);
          });

          return yield* bootstrapProgram.pipe(
            Effect.catchCause((cause) => {
              const dispatchError = toBootstrapDispatchCommandCauseError(cause);
              if (Cause.hasInterruptsOnly(cause)) {
                return Effect.fail(dispatchError);
              }
              return Effect.uninterruptible(cleanupCreatedThread()).pipe(
                Effect.matchCauseEffect({
                  onFailure: (cleanupCause) =>
                    Effect.logWarning("bootstrap thread cleanup failed", {
                      threadId: command.threadId,
                      detail: Cause.pretty(cleanupCause),
                    }).pipe(Effect.flatMap(() => Effect.fail(dispatchError))),
                  onSuccess: (threadDeleted) =>
                    Effect.fail(
                      threadDeleted
                        ? new OrchestrationDispatchCommandError({
                            message: dispatchError.message,
                            ...(dispatchError.cause !== undefined
                              ? { cause: dispatchError.cause }
                              : {}),
                            bootstrapThreadDisposition: "deleted",
                          })
                        : dispatchError,
                    ),
                }),
              );
            }),
          );
        });

      const dispatchNormalizedCommand = (
        normalizedCommand: OrchestrationCommand,
      ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> => {
        const dispatchEffect =
          normalizedCommand.type === "thread.turn.start" && normalizedCommand.bootstrap
            ? dispatchBootstrapTurnStart(normalizedCommand)
            : dispatchFromClient(normalizedCommand).pipe(
                Effect.mapError((cause) =>
                  toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
                ),
              );

        return startup
          .enqueueCommand(dispatchEffect)
          .pipe(
            Effect.mapError((cause) =>
              toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
            ),
          );
      };

      const loadServerConfig = Effect.gen(function* () {
        const keybindingsConfig = yield* keybindings.loadConfigState;
        const providers = yield* providerRegistry.getProviders;
        const settings = ServerSettings.redactServerSettingsForClient(
          yield* serverSettings.getSettings,
        );
        const environment = yield* serverEnvironment.getDescriptor;
        const auth = yield* serverAuth.getDescriptor();
        const availableEditors: ReadonlyArray<EditorId> = yield* resolveAvailableEditorsForConfig(
          externalLauncher.resolveAvailableEditors(),
        );
        const fileManagerRevealKind = availableEditors.includes("file-manager")
          ? yield* resolveFileManagerRevealKindForConfig(
              externalLauncher.resolveFileManagerRevealKind(),
            )
          : undefined;

        return {
          environment,
          auth,
          cwd: config.cwd,
          keybindingsConfigPath: config.keybindingsConfigPath,
          keybindings: keybindingsConfig.keybindings,
          issues: keybindingsConfig.issues,
          providers,
          availableEditors,
          // Same discovery-with-timeout treatment as editors: a slow probe
          // must not stall server.getConfig, so it degrades to no targets.
          remoteOpenTargets: yield* resolveAvailableEditorsForConfig(
            remoteOpenTargets.resolveTargets(),
          ),
          observability: {
            logsDirectoryPath: config.logsDir,
            localTracingEnabled: true,
            ...(config.otlpTracesUrl !== undefined ? { otlpTracesUrl: config.otlpTracesUrl } : {}),
            otlpTracesEnabled: config.otlpTracesUrl !== undefined,
            ...(config.otlpMetricsUrl !== undefined
              ? { otlpMetricsUrl: config.otlpMetricsUrl }
              : {}),
            otlpMetricsEnabled: config.otlpMetricsUrl !== undefined,
          },
          settings,
          shellResumeCompletionMarker: true,
          ...(fileManagerRevealKind === undefined
            ? {}
            : {
                shellRevealInFileManager: true,
                shellRevealInFileManagerKind: fileManagerRevealKind,
              }),
          threadResumeCompletionMarker: true,
          threadSnapshotPagination: true,
        };
      });

      const refreshGitStatus = (cwd: string) =>
        vcsStatusBroadcaster
          .refreshStatus(cwd)
          .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach, Effect.asVoid);

      // Status is composed at this read layer, never stored: the assistant
      // runtime says which plans are streaming or waiting on input, and the
      // rows carry it (ADR 002 §4).
      const loadPlanningTreeSnapshot = Effect.gen(function* () {
        const [snapshot, status, sessions] = yield* Effect.all([
          planningStore.getTreeSnapshot,
          planningAssistant.status,
          codingSessionStore.listAll,
        ]);
        const sessionsWithLiveStatus = yield* Effect.forEach(sessions, (session) =>
          session.endedAt !== null
            ? Effect.succeed([session, null] as const)
            : projectionSnapshotQuery.getThreadShellById(session.threadId).pipe(
                Effect.map(
                  (shell) =>
                    [
                      session,
                      Option.match(shell, {
                        onNone: () => null,
                        onSome: (value) => ({
                          isWorking: value.latestTurn?.state === "running",
                          hasPendingInput: value.hasPendingApprovals || value.hasPendingUserInput,
                        }),
                      }),
                    ] as const,
                ),
              ),
        );
        const composedStatus = new Map(status);
        const byPlan = new Map<PlanId, Array<ReturnType<typeof toWireCodingSessionRecord>>>();
        const liveStatusByPlan = new Map<
          PlanId,
          Array<(typeof sessionsWithLiveStatus)[number][1]>
        >();
        for (const [session, liveStatus] of sessionsWithLiveStatus) {
          const entries = byPlan.get(session.planId) ?? [];
          entries.push(toWireCodingSessionRecord(session));
          byPlan.set(session.planId, entries);
          const liveEntries = liveStatusByPlan.get(session.planId) ?? [];
          liveEntries.push(liveStatus);
          liveStatusByPlan.set(session.planId, liveEntries);
        }
        for (const [planId, liveStatuses] of liveStatusByPlan) {
          composedStatus.set(
            planId,
            composePlanRowStatus(composedStatus.get(planId), liveStatuses),
          );
        }
        return toWireTreeSnapshot(snapshot, composedStatus, byPlan);
      }).pipe(
        Effect.tapError((cause) =>
          Effect.logError("mercurian planning tree snapshot load failed", { cause }),
        ),
        Effect.mapError(
          (cause) => new MercurianPlanningError({ operation: "subscribeTree", cause }),
        ),
      );

      /**
       * A human message landed; the assistant replies. Forked and detached
       * on purpose: the append's success was never conditional on the reply
       * starting, and anything that prevents one arrives as a
       * `turn-refused` frame on the plan's own stream.
       */
      const kickOffPlanningTurn = (input: PlanningAssistant.StartTurnInput) =>
        planningAssistant.startTurn(input).pipe(Effect.forkDetach, Effect.asVoid);

      const loadTrackersSnapshot = trackerStore.getSnapshot.pipe(
        Effect.map(toWireTrackersSnapshot),
        Effect.tapError((cause) =>
          Effect.logError("mercurian trackers snapshot load failed", { cause }),
        ),
        Effect.mapError(
          (cause) => new MercurianTrackerError({ operation: "subscribeTrackers", cause }),
        ),
      );

      const loadRepositoriesSnapshot = repositoryStore.getSnapshot.pipe(
        Effect.map(toWireRepositoriesSnapshot),
        Effect.tapError((cause) =>
          Effect.logError("mercurian repositories snapshot load failed", { cause }),
        ),
        Effect.mapError(
          (cause) => new MercurianRepositoryError({ operation: "subscribeRepositories", cause }),
        ),
      );

      const loadMemorySourcesSnapshot = memorySourceStore.getSnapshot.pipe(
        Effect.map(toWireMemorySourcesSnapshot),
        Effect.tapError((cause) =>
          Effect.logError("mercurian memory sources snapshot load failed", { cause }),
        ),
        Effect.mapError(
          (cause) => new MercurianMemoryError({ operation: "subscribeMemorySources", cause }),
        ),
      );

      const loadWorkspaceSettingsSnapshot = workspaceSettingsStore.getSnapshot.pipe(
        Effect.tapError((cause) =>
          Effect.logError("mercurian workspace settings snapshot load failed", { cause }),
        ),
        Effect.mapError(
          (cause) =>
            new MercurianWorkspaceError({ operation: "subscribeWorkspaceSettings", cause }),
        ),
      );

      return WsRpcGroup.of({
        [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.dispatchCommand,
            Effect.gen(function* () {
              const normalizedCommand = yield* normalizeDispatchCommand(command);
              // Archive and settle both mean "done with this thread", so a
              // live provider session must not keep running background work
              // (PR monitors, dev servers, subagent fleets) after either
              // lands. The decider rejects settling a starting/running
              // session, so for settle this only ever stops an idle one; a
              // stopped session-set does not count as activity, so the stop
              // cannot un-settle the thread it follows.
              const parkingCommand =
                normalizedCommand.type === "thread.archive" ||
                normalizedCommand.type === "thread.settle"
                  ? normalizedCommand
                  : undefined;
              // Best-effort on purpose: the user's archive/settle must not
              // fail because this cleanup read blipped, so a failed read
              // logs and skips the stop instead of propagating.
              const shouldStopSessionAfterCommand = parkingCommand
                ? yield* projectionSnapshotQuery.getThreadShellById(parkingCommand.threadId).pipe(
                    Effect.map(
                      Option.match({
                        onNone: () => false,
                        onSome: (thread) =>
                          thread.session !== null && thread.session.status !== "stopped",
                      }),
                    ),
                    Effect.catchCause((cause) =>
                      Effect.logWarning(
                        "failed to read thread session state before session-stop check",
                        { threadId: parkingCommand.threadId, cause },
                      ).pipe(Effect.as(false)),
                    ),
                  )
                : false;
              const result = yield* dispatchNormalizedCommand(normalizedCommand).pipe(
                Effect.tapError(() => cleanupFailedUploadedAttachments(command, normalizedCommand)),
              );
              yield* recordClientCommandAnalytics(normalizedCommand);
              if (parkingCommand) {
                const parkingKind = parkingCommand.type === "thread.archive" ? "archive" : "settle";
                if (shouldStopSessionAfterCommand) {
                  yield* Effect.gen(function* () {
                    const stopCommand = yield* normalizeDispatchCommand({
                      type: "thread.session.stop",
                      commandId: CommandId.make(
                        `session-stop-for-${parkingKind}:${parkingCommand.commandId}`,
                      ),
                      threadId: parkingCommand.threadId,
                      createdAt: yield* nowIso,
                      // A settled thread can be re-engaged before this stop is
                      // decided; the decider then drops the stop instead of
                      // killing the new session. Archive stops stay
                      // unconditional: turn starts on archived threads are
                      // rejected, so there is no new session to protect.
                      ...(parkingKind === "settle" ? { onlyIfSettled: true } : {}),
                    });

                    yield* dispatchNormalizedCommand(stopCommand);
                  }).pipe(
                    Effect.catchCause((cause) =>
                      Effect.logWarning(`failed to stop provider session during ${parkingKind}`, {
                        threadId: parkingCommand.threadId,
                        cause,
                      }),
                    ),
                  );
                }

                // Terminals are user-opened panes, not thread background
                // work: archive removes the thread from view so they close
                // with it, but a settled thread stays reachable and may be
                // un-settled, so its terminals stay up.
                if (parkingCommand.type === "thread.archive") {
                  yield* terminalManager.close({ threadId: parkingCommand.threadId }).pipe(
                    Effect.catch((error) =>
                      Effect.logWarning("failed to close thread terminals after archive", {
                        threadId: parkingCommand.threadId,
                        error: error.message,
                      }),
                    ),
                  );
                }
              }
              return result;
            }).pipe(
              Effect.mapError((cause) =>
                isOrchestrationDispatchCommandError(cause)
                  ? cause
                  : new OrchestrationDispatchCommandError({
                      message: "Failed to dispatch orchestration command",
                      cause,
                    }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.getWorkflowScript]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getWorkflowScript,
            readWorkflowScript({ scriptPath: input.scriptPath }),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.getTurnDiff]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getTurnDiff,
            checkpointDiffQuery.getTurnDiff(input).pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetTurnDiffError({
                    message: "Failed to load turn diff",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getFullThreadDiff,
            checkpointDiffQuery.getFullThreadDiff(input).pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetFullThreadDiffError({
                    message: "Failed to load full thread diff",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.searchThreads]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.searchThreads,
            projectionSnapshotQuery.searchThreads(input).pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationSearchThreadsError({
                    message: "Failed to search threads",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.subscribeShell]: (input) =>
          observeRpcStreamEffect(
            ORCHESTRATION_WS_METHODS.subscribeShell,
            Effect.gen(function* () {
              // Coalesce the live shell stream per aggregate over a small window
              // so bursts of high-frequency events (streaming message deltas,
              // activity appends) collapse into a single shell refetch and never
              // serialize a brand-new thread's `thread.created` behind hundreds
              // of per-event DB reads. See coalesceShellStream.
              // Attach live delivery into a scope-bound buffer BEFORE loading any
              // snapshot or draining catch-up, otherwise an event published while
              // the snapshot query is in flight is lost (it is past the snapshot's
              // sequence but the live subscription is not attached yet). Every
              // path below emits from this same buffered live tail. Overlapping
              // events are deduped by sequence on the client.
              const liveBuffer = yield* Queue.unbounded<ShellLiveInput>();
              yield* Effect.forkScoped(
                orchestrationEngine.streamDomainEvents.pipe(
                  Stream.runForEach((event) =>
                    Queue.offer(liveBuffer, { kind: "event" as const, event }),
                  ),
                ),
                { startImmediately: true },
              );
              const bufferedLiveStream = coalesceShellLiveStream(Stream.fromQueue(liveBuffer));

              const loadSnapshot = projectionSnapshotQuery.getShellSnapshot().pipe(
                Effect.tapError((cause) =>
                  Effect.logError("orchestration shell snapshot load failed", { cause }),
                ),
                Effect.mapError(
                  (cause) =>
                    new OrchestrationGetSnapshotError({
                      message: "Failed to load orchestration shell snapshot",
                      cause,
                    }),
                ),
              );

              // Offer the completion marker into the same queue as live events.
              // Anything buffered while snapshot/replay work was in flight is
              // therefore delivered before the client is told it is synchronized.
              const synchronizedThenLive =
                input.requestCompletionMarker === true
                  ? Stream.concat(
                      Stream.fromEffect(
                        Queue.offer(liveBuffer, { kind: "synchronized" as const }).pipe(
                          Effect.andThen(Queue.takeAll(liveBuffer)),
                          Effect.flatMap(coalesceShellLiveInputs),
                        ),
                      ).pipe(Stream.flatMap((items) => Stream.fromIterable(items))),
                      bufferedLiveStream,
                    )
                  : bufferedLiveStream;

              // When the client already holds a shell snapshot (cached, or loaded
              // over HTTP) it passes that snapshot's sequence, and we resume by
              // replaying shell events after it instead of re-sending the whole
              // projects/threads list over the socket. If the client is too far
              // behind, we fall back to a fresh snapshot instead of an unbounded
              // replay (see below).
              if (input.afterSequence !== undefined) {
                const afterSequence = input.afterSequence;
                const headSequence = yield* orchestrationEngine.latestSequence;
                const replayGap = headSequence - afterSequence;
                // Gap too large: replaying every intervening event (each a shell
                // refetch) is far more expensive than a single O(active-threads)
                // snapshot. A cursor ahead of this engine's authoritative state
                // is also invalid, so reset it with a snapshot. Send the snapshot
                // followed by the buffered live tail, exactly as the
                // no-afterSequence path does.
                if (replayGap < 0 || replayGap > SHELL_RESUME_MAX_GAP) {
                  const snapshot = yield* loadSnapshot;
                  return Stream.concat(
                    Stream.make({ kind: "snapshot" as const, snapshot }),
                    synchronizedThenLive,
                  );
                }
                const catchUpStream = coalesceShellStream(
                  // Replay only through the head captured above. Newer events
                  // are already covered by the live subscription, so this bound
                  // cannot chase a moving event-store head or grow the live
                  // buffer indefinitely while waiting for an empty page.
                  orchestrationEngine.readEvents(afterSequence, replayGap),
                ).pipe(
                  Stream.mapError(
                    (cause) =>
                      new OrchestrationGetSnapshotError({
                        message: "Failed to replay orchestration shell events",
                        cause,
                      }),
                  ),
                );
                return Stream.concat(catchUpStream, synchronizedThenLive);
              }

              const snapshot = yield* loadSnapshot;
              return Stream.concat(
                Stream.make({
                  kind: "snapshot" as const,
                  snapshot,
                }),
                synchronizedThenLive,
              );
            }),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot]: (_input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot,
            projectionSnapshotQuery.getArchivedShellSnapshot().pipe(
              Effect.tapError((cause) =>
                Effect.logError("orchestration archived shell snapshot load failed", { cause }),
              ),
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetSnapshotError({
                    message: "Failed to load archived orchestration shell snapshot",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.subscribeThread]: (input) =>
          observeRpcStreamEffect(
            ORCHESTRATION_WS_METHODS.subscribeThread,
            Effect.gen(function* () {
              const isThisThreadDetailEvent = (event: OrchestrationEvent) =>
                event.aggregateKind === "thread" &&
                event.aggregateId === input.threadId &&
                isThreadDetailEvent(event);

              const liveStream = orchestrationEngine.streamDomainEvents.pipe(
                Stream.filter(isThisThreadDetailEvent),
                Stream.map((event) => ({
                  kind: "event" as const,
                  event: projectActivityEvent(event),
                })),
              );

              // Attach live delivery before reading either replay or snapshot state.
              // Otherwise an event published while the snapshot is loading is lost.
              const liveBuffer = yield* Queue.unbounded<OrchestrationThreadStreamItem>();
              yield* Effect.forkScoped(
                liveStream.pipe(Stream.runForEach((item) => Queue.offer(liveBuffer, item))),
              );
              const bufferedLiveStream = Stream.fromQueue(liveBuffer);

              // When the client already loaded the snapshot over HTTP it passes
              // that snapshot's sequence, and we resume the live subscription by
              // replaying persisted events after it instead of re-sending the
              // (potentially multi-KB) snapshot frame over the socket.
              //
              // The live PubSub subscription must be attached *before* draining
              // the catch-up replay, otherwise events published during the replay
              // window are dropped (they are past the persisted tail the replay
              // read, but the live stream is not yet subscribed). So fork the
              // live stream into a buffer bound to this stream's scope, then emit
              // catch-up followed by the buffered/ongoing live events. Overlapping
              // events are deduped by sequence on the client.
              //
              // The replay is bounded to the projection head captured below. The
              // catch-up range is normally tiny (a fresh HTTP snapshot sequence),
              // but a stale cached cursor can sit hundreds of thousands of global
              // events behind — replaying that decodes every intervening event
              // (including every other thread's tool payloads) only to discard
              // almost all of them, which has OOM-killed servers on large
              // databases. A truncated replay would silently drop this thread's
              // events, so past the gap cap we reset the client with a fresh
              // thread snapshot instead, exactly like subscribeShell above.
              if (input.afterSequence !== undefined) {
                const afterSequence = input.afterSequence;
                const headSequence = yield* orchestrationEngine.latestSequence;
                const replayGap = headSequence - afterSequence;
                if (replayGap >= 0 && replayGap <= THREAD_RESUME_MAX_GAP) {
                  const catchUpStream = orchestrationEngine
                    .readEvents(afterSequence, replayGap)
                    .pipe(
                      Stream.filter(isThisThreadDetailEvent),
                      Stream.map((event) => ({
                        kind: "event" as const,
                        event: projectActivityEvent(event),
                      })),
                      Stream.mapError(
                        (cause) =>
                          new OrchestrationGetSnapshotError({
                            message: `Failed to replay thread ${input.threadId} events`,
                            cause,
                          }),
                      ),
                    );
                  const afterCatchUp =
                    input.requestCompletionMarker === true
                      ? Stream.concat(
                          Stream.fromEffect(
                            Queue.offer(liveBuffer, { kind: "synchronized" as const }),
                          ).pipe(Stream.drain),
                          bufferedLiveStream,
                        )
                      : bufferedLiveStream;
                  return Stream.concat(catchUpStream, afterCatchUp);
                }
                // Gap too large (or cursor ahead of authoritative state): fall
                // through to the snapshot path so the client converges from a
                // fresh thread detail instead of an unbounded replay.
              }

              const snapshot = yield* projectionSnapshotQuery
                .getThreadDetailSnapshot(
                  input.threadId,
                  // Windowing the fallback snapshot is opt-in per subscription:
                  // clients that don't send turnLimit (including all
                  // pre-pagination clients) get the full thread, since they
                  // have no way to load older pages.
                  input.turnLimit === undefined ? undefined : { turnLimit: input.turnLimit },
                )
                .pipe(
                  Effect.mapError(
                    (cause) =>
                      new OrchestrationGetSnapshotError({
                        message: `Failed to load thread ${input.threadId}`,
                        cause,
                      }),
                  ),
                );

              if (Option.isNone(snapshot)) {
                return yield* new OrchestrationGetSnapshotError({
                  message: `Thread ${input.threadId} was not found`,
                  cause: input.threadId,
                });
              }

              const afterSnapshot =
                input.requestCompletionMarker === true
                  ? Stream.concat(
                      Stream.fromEffect(
                        Queue.offer(liveBuffer, { kind: "synchronized" as const }),
                      ).pipe(Stream.drain),
                      bufferedLiveStream,
                    )
                  : bufferedLiveStream;
              return Stream.concat(
                Stream.make({
                  kind: "snapshot" as const,
                  snapshot: projectThreadDetailSnapshot(snapshot.value),
                }),
                afterSnapshot,
              );
            }),
            { "rpc.aggregate": "orchestration" },
          ),
        [MERCURIAN_WS_METHODS.subscribeTree]: (_input) =>
          observeRpcStreamEffect(
            MERCURIAN_WS_METHODS.subscribeTree,
            Effect.gen(function* () {
              // Attach the change signals before the first snapshot query, so
              // a mutation landing while that query is in flight still
              // re-sends. The assistant's signal rides the same queue: a turn
              // starting, pausing on a question, or settling repaints the
              // tree's status facts within the same debounce.
              const changes = yield* Queue.unbounded<void>();
              const sessionStatusChanges = codingSessionStatusChanges(
                orchestrationEngine.streamDomainEvents,
                codingSessionStore.getByThreadId,
              ).pipe(
                Stream.mapError(
                  (cause) => new MercurianPlanningError({ operation: "subscribeTree", cause }),
                ),
              );
              yield* Effect.forkScoped(
                Stream.merge(
                  Stream.merge(
                    Stream.merge(planningStore.changes, planningAssistant.changes),
                    codingSessionStore.changes,
                  ),
                  sessionStatusChanges,
                ).pipe(Stream.runForEach(() => Queue.offer(changes, undefined))),
                { startImmediately: true },
              );
              const snapshot = yield* loadPlanningTreeSnapshot;
              return Stream.concat(
                Stream.make({ kind: "snapshot" as const, snapshot }),
                Stream.fromQueue(changes).pipe(
                  // The tree is one small value, so a burst of mutations is
                  // worth exactly one re-send: the latest.
                  Stream.debounce(Duration.millis(50)),
                  Stream.mapEffect(() => loadPlanningTreeSnapshot),
                  Stream.map((next) => ({ kind: "snapshot" as const, snapshot: next })),
                ),
              );
            }),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_WS_METHODS.createProject]: (input) =>
          observeRpcEffect(
            MERCURIAN_WS_METHODS.createProject,
            DateTime.now.pipe(
              Effect.flatMap((createdAt) =>
                planningStore.createProject({ name: input.name, createdAt }),
              ),
              Effect.map(toWireProject),
              Effect.mapError(
                (cause) => new MercurianPlanningError({ operation: "createProject", cause }),
              ),
            ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_WS_METHODS.createPlan]: (input) =>
          observeRpcEffect(
            MERCURIAN_WS_METHODS.createPlan,
            DateTime.now.pipe(
              Effect.flatMap((createdAt) =>
                Effect.gen(function* () {
                  // The bytes land before the history does: a commit records
                  // what a file already is, never a promise of one. A plan
                  // being born has no id yet, so its project names the files.
                  const attachments = yield* normalizePlanAttachments({
                    owner: input.projectId,
                    uploads: input.attachments,
                  });
                  const lastUsed = (yield* workspaceSettingsStore.getSnapshot).planningModel;
                  const created = yield* planningStore.createPlan({
                    projectId: input.projectId,
                    message: input.message,
                    attachments,
                    ...(input.modelChoice === undefined ? {} : { modelChoice: input.modelChoice }),
                    lastUsed,
                    createdAt,
                  });
                  // The birth message is a message: the assistant replies to
                  // it like any other.
                  const root = created.timeline[0];
                  if (root?._tag === "message") {
                    if (root.ranUnder !== undefined) {
                      yield* workspaceSettingsStore.recordLastUsedPlanningModel(root.ranUnder);
                    }
                    yield* kickOffPlanningTurn({
                      planId: created.plan.planId,
                      parentCommitId: root.commitId,
                      text: input.message,
                      ...(root.ranUnder === undefined ? {} : { ranUnder: root.ranUnder }),
                    });
                  }
                  return created;
                }),
              ),
              Effect.map(toWirePlanDetail),
              Effect.mapError((cause) =>
                isMercurianProjectNotFoundError(cause)
                  ? cause
                  : new MercurianPlanningError({ operation: "createPlan", cause }),
              ),
            ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_WS_METHODS.importPlan]: (input) =>
          observeRpcEffect(
            MERCURIAN_WS_METHODS.importPlan,
            DateTime.now.pipe(
              Effect.flatMap((createdAt) =>
                planningStore.importPlan({
                  projectId: input.projectId,
                  connectionId: input.connectionId,
                  issueId: input.issue.id,
                  issueUrl: input.issue.url,
                  // The issue's content becomes the root commit. Its `status`
                  // is deliberately not passed on: where an issue stands is a
                  // live tracker fact, and import stores no copy of it.
                  title: input.issue.title,
                  description: input.issue.description,
                  createdAt,
                }),
              ),
              Effect.map(toWirePlanImport),
              Effect.mapError((cause) =>
                isMercurianProjectNotFoundError(cause)
                  ? cause
                  : new MercurianPlanningError({ operation: "importPlan", cause }),
              ),
            ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_WS_METHODS.appendPlanMessage]: (input) =>
          observeRpcEffect(
            MERCURIAN_WS_METHODS.appendPlanMessage,
            DateTime.now.pipe(
              Effect.flatMap((createdAt) =>
                Effect.gen(function* () {
                  const attachments = yield* normalizePlanAttachments({
                    owner: input.planId,
                    uploads: input.attachments,
                  });
                  const lastUsed = (yield* workspaceSettingsStore.getSnapshot).planningModel;
                  const appended = yield* planningStore.appendMessage({
                    planId: input.planId,
                    text: input.text,
                    // Where the sender stood. A commit that already has a
                    // child is a legal parent — that append is the fork.
                    ...(input.parentCommitId === undefined
                      ? {}
                      : { parentCommitId: CommitId.make(input.parentCommitId) }),
                    attachments,
                    ...(input.modelChoice === undefined ? {} : { modelChoice: input.modelChoice }),
                    lastUsed,
                    createdAt,
                  });
                  if (appended.ranUnder !== undefined) {
                    yield* workspaceSettingsStore.recordLastUsedPlanningModel(appended.ranUnder);
                  }
                  yield* kickOffPlanningTurn({
                    planId: input.planId,
                    parentCommitId: appended.commitId,
                    text: input.text,
                    ...(appended.ranUnder === undefined ? {} : { ranUnder: appended.ranUnder }),
                  });
                  return appended;
                }),
              ),
              Effect.map(toWirePlanMessage),
              Effect.mapError((cause) =>
                isPlanNotFoundError(cause) || isPlanTurnActiveError(cause)
                  ? cause
                  : new MercurianPlanningError({ operation: "appendPlanMessage", cause }),
              ),
            ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_WS_METHODS.savePlanRevision]: (input) =>
          observeRpcEffect(
            MERCURIAN_WS_METHODS.savePlanRevision,
            DateTime.now.pipe(
              Effect.flatMap((createdAt) =>
                planningStore.savePlanRevision({
                  planId: input.planId,
                  text: input.text,
                  // An edit lands on the branch its author was standing on,
                  // not on whichever one last received a commit.
                  ...(input.parentCommitId === undefined
                    ? {}
                    : { parentCommitId: CommitId.make(input.parentCommitId) }),
                  createdAt,
                }),
              ),
              Effect.map(toWirePlanRevision),
              Effect.mapError((cause) =>
                isPlanNotFoundError(cause) || isPlanTurnActiveError(cause)
                  ? cause
                  : new MercurianPlanningError({ operation: "savePlanRevision", cause }),
              ),
            ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_WS_METHODS.saveSpecRevision]: (input) =>
          observeRpcEffect(
            MERCURIAN_WS_METHODS.saveSpecRevision,
            DateTime.now.pipe(
              Effect.flatMap((createdAt) =>
                planningStore.saveSpecRevision({
                  planId: input.planId,
                  document: input.document,
                  expectedSpecRevisionCommitId:
                    input.expectedSpecRevisionCommitId === null
                      ? null
                      : CommitId.make(input.expectedSpecRevisionCommitId),
                  ...(input.parentCommitId === undefined
                    ? {}
                    : { parentCommitId: CommitId.make(input.parentCommitId) }),
                  createdAt,
                }),
              ),
              Effect.map(toWirePlanSpecRevision),
              Effect.mapError((cause) =>
                isPlanNotFoundError(cause) ||
                isPlanTurnActiveError(cause) ||
                isSpecRevisionOutdatedError(cause)
                  ? cause
                  : new MercurianPlanningError({ operation: "saveSpecRevision", cause }),
              ),
            ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_WS_METHODS.refreshSpec]: (input) =>
          observeRpcEffect(
            MERCURIAN_WS_METHODS.refreshSpec,
            DateTime.now.pipe(
              Effect.flatMap((createdAt) =>
                Effect.gen(function* () {
                  const context = yield* planningStore.prepareSpecRefresh({
                    planId: input.planId,
                    parentCommitId: CommitId.make(input.parentCommitId),
                  });
                  if (context.origin === null) {
                    return yield* new SpecRefreshUnavailableError({ reason: "no-origin" });
                  }
                  if (context.local === null || context.upstreamBaseline === null) {
                    return yield* new SpecRefreshUnavailableError({ reason: "spec-missing" });
                  }
                  const issue = yield* trackerStore.getIssue({
                    connectionId: context.origin.connectionId,
                    issueId: context.origin.issueId,
                  });
                  if (issue === null) {
                    return yield* new SpecRefreshUnavailableError({ reason: "issue-not-found" });
                  }
                  const upstream = specDocumentFromIssue(issue.title, issue.description);
                  const reconciliation = {
                    kind: "reconciliation-required" as const,
                    base: context.upstreamBaseline,
                    local: context.local.document,
                    upstream,
                    expectedSpecRevisionCommitId: MercurianCommitId.make(
                      context.local.revisionCommitId,
                    ),
                  };

                  const confirming =
                    input.reviewedUpstream !== undefined && input.resolvedDocument !== undefined;
                  if (confirming) {
                    const upstreamMoved =
                      input.reviewedUpstream.goal !== upstream.goal ||
                      input.reviewedUpstream.acceptanceCriteria !== upstream.acceptanceCriteria;
                    if (
                      upstreamMoved ||
                      String(context.local.revisionCommitId) !==
                        String(input.expectedSpecRevisionCommitId)
                    ) {
                      return reconciliation;
                    }
                    const revision = yield* planningStore.saveTrackerSpecRevision({
                      planId: input.planId,
                      parentCommitId: CommitId.make(input.parentCommitId),
                      expectedSpecRevisionCommitId: CommitId.make(
                        input.expectedSpecRevisionCommitId,
                      ),
                      document: input.resolvedDocument,
                      issueId: context.origin.issueId,
                      sourceKind: "tracker-reconciliation",
                      upstream,
                      createdAt,
                    });
                    return {
                      kind: "committed" as const,
                      outcome: "reconciled" as const,
                      revision: toWirePlanSpecRevision(revision),
                    };
                  }

                  if (
                    input.reviewedUpstream !== undefined ||
                    input.resolvedDocument !== undefined ||
                    String(context.local.revisionCommitId) !==
                      String(input.expectedSpecRevisionCommitId)
                  ) {
                    return yield* new SpecRevisionOutdatedError({
                      expectedSpecRevisionCommitId: input.expectedSpecRevisionCommitId,
                      actualSpecRevisionCommitId: MercurianCommitId.make(
                        context.local.revisionCommitId,
                      ),
                    });
                  }

                  const classified = PlanningStore.classifySpecRefresh({
                    base: context.upstreamBaseline,
                    local: context.local.document,
                    upstream,
                  });
                  if (classified.kind === "unchanged") return classified;
                  if (classified.kind === "reconciliation-required") return reconciliation;

                  const revision = yield* planningStore.saveTrackerSpecRevision({
                    planId: input.planId,
                    parentCommitId: CommitId.make(input.parentCommitId),
                    expectedSpecRevisionCommitId: CommitId.make(input.expectedSpecRevisionCommitId),
                    document: classified.document,
                    issueId: context.origin.issueId,
                    sourceKind: "tracker-refresh",
                    createdAt,
                  });
                  return {
                    kind: "committed" as const,
                    outcome:
                      classified.kind === "committed-converged"
                        ? ("converged" as const)
                        : ("upstream" as const),
                    revision: toWirePlanSpecRevision(revision),
                  };
                }),
              ),
              Effect.mapError((cause) =>
                isPlanNotFoundError(cause) ||
                isPlanTurnActiveError(cause) ||
                isSpecRevisionOutdatedError(cause) ||
                isSpecRefreshUnavailableError(cause) ||
                isTrackerConnectionNotFoundError(cause) ||
                isTrackerAuthError(cause) ||
                isTrackerUnreachableError(cause)
                  ? cause
                  : new MercurianPlanningError({ operation: "refreshSpec", cause }),
              ),
            ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_WS_METHODS.tryImplement]: (input) =>
          observeRpcEffect(
            MERCURIAN_WS_METHODS.tryImplement,
            planningAssistant
              .tryImplement({
                planId: input.planId,
                ...(input.parentCommitId === undefined
                  ? {}
                  : { parentCommitId: CommitId.make(input.parentCommitId) }),
              })
              .pipe(
                Effect.as({}),
                Effect.mapError((cause) =>
                  isPlanNotFoundError(cause) ||
                  isPlanTurnActiveError(cause) ||
                  isImplementBlockedError(cause)
                    ? cause
                    : new MercurianPlanningError({ operation: "tryImplement", cause }),
                ),
              ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_WS_METHODS.confirmSplits]: (input) =>
          observeRpcEffect(
            MERCURIAN_WS_METHODS.confirmSplits,
            DateTime.now.pipe(
              Effect.flatMap((createdAt) =>
                planningStore.saveSplits({
                  planId: input.planId,
                  parentCommitId: CommitId.make(input.parentCommitId),
                  splits: input.splits,
                  createdAt,
                }),
              ),
              Effect.tap((revisions) =>
                Effect.forEach(
                  revisions,
                  (revision) =>
                    revision.split === undefined
                      ? Effect.void
                      : planningAssistant.publishImplementReady({
                          planId: input.planId,
                          ready: {
                            commitId: MercurianCommitId.make(revision.commitId),
                            ...revision.split,
                          },
                        }),
                  { discard: true },
                ),
              ),
              Effect.tap(() => planningAssistant.clearImplementProposal(input.planId)),
              Effect.map((revisions) =>
                revisions.map((revision) => MercurianCommitId.make(revision.commitId)),
              ),
              Effect.mapError((cause) =>
                isPlanNotFoundError(cause) ||
                isPlanTurnActiveError(cause) ||
                isConfirmSplitsBlockedError(cause)
                  ? cause
                  : new MercurianPlanningError({ operation: "confirmSplits", cause }),
              ),
            ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_WS_METHODS.confirmMemoryAmendment]: (input) =>
          observeRpcEffect(
            MERCURIAN_WS_METHODS.confirmMemoryAmendment,
            Effect.gen(function* () {
              const parentCommitId = CommitId.make(input.parentCommitId);
              yield* planningStore.assertNoActiveTurn({
                planId: input.planId,
                parentCommitId,
              });
              const proposal = yield* planningAssistant.memoryAmendmentProposal(input.planId);
              if (proposal === undefined) {
                return yield* new ConfirmMemoryAmendmentBlockedError({ reason: "no-proposal" });
              }
              const detail = yield* planningStore.getPlanSnapshot({ planId: input.planId });
              const memoryCommitSha = yield* memoryIndex.applyAmendment({
                projectId: detail.plan.projectId,
                proposal,
                planId: input.planId,
                planName: detail.plan.title,
              });
              const createdAt = yield* DateTime.now;
              const message = yield* planningStore.appendMemoryAmendment({
                planId: input.planId,
                parentCommitId,
                title: proposal.title,
                memoryCommitSha,
                notes: proposal.changes
                  .filter(({ path }) => path.endsWith(".md") && !path.startsWith("maps/"))
                  .map(({ path }) => path.slice(0, -3).split("/").at(-1)!),
                createdAt,
              });
              yield* planningAssistant.clearMemoryAmendment(input.planId);
              return MercurianCommitId.make(message.commitId);
            }).pipe(
              Effect.mapError((cause) =>
                isPlanNotFoundError(cause) ||
                isPlanTurnActiveError(cause) ||
                isConfirmMemoryAmendmentBlockedError(cause) ||
                cause._tag === "MercurianMemoryError"
                  ? cause
                  : new MercurianPlanningError({
                      operation: "confirmMemoryAmendment",
                      cause,
                    }),
              ),
            ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_WS_METHODS.cancelMemoryAmendment]: (input) =>
          observeRpcEffect(
            MERCURIAN_WS_METHODS.cancelMemoryAmendment,
            planningAssistant.cancelMemoryAmendment(input.planId).pipe(Effect.as({})),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_WS_METHODS.startCodingSession]: (input) =>
          observeRpcEffect(
            MERCURIAN_WS_METHODS.startCodingSession,
            codingSessionService
              .start(input)
              .pipe(
                Effect.mapError((cause) =>
                  isPlanNotFoundError(cause) ||
                  isMercurianRepositoryNotFoundError(cause) ||
                  isPlanTurnActiveError(cause) ||
                  isCodingSessionBlockedError(cause)
                    ? cause
                    : new MercurianPlanningError({ operation: "startCodingSession", cause }),
                ),
              ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_WS_METHODS.cancelImplementProposal]: (input) =>
          observeRpcEffect(
            MERCURIAN_WS_METHODS.cancelImplementProposal,
            planningAssistant.cancelImplementProposal(input.planId).pipe(Effect.as({})),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_WS_METHODS.visitPlan]: (input) =>
          observeRpcEffect(
            MERCURIAN_WS_METHODS.visitPlan,
            DateTime.now.pipe(
              // The act names the plan; the moment is ours. A client clock
              // could otherwise put a visit in the future and silence a row.
              Effect.flatMap((visitedAt) =>
                planningStore.recordPlanVisit({ planId: input.planId, visitedAt }),
              ),
              Effect.as({}),
              Effect.mapError((cause) =>
                isPlanNotFoundError(cause)
                  ? cause
                  : new MercurianPlanningError({ operation: "visitPlan", cause }),
              ),
            ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_WS_METHODS.markPlanUnread]: (input) =>
          observeRpcEffect(
            MERCURIAN_WS_METHODS.markPlanUnread,
            planningStore.markPlanUnread({ planId: input.planId }).pipe(
              Effect.as({}),
              Effect.mapError((cause) =>
                isPlanNotFoundError(cause)
                  ? cause
                  : new MercurianPlanningError({ operation: "markPlanUnread", cause }),
              ),
            ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_WS_METHODS.stopPlanningTurn]: (input) =>
          observeRpcEffect(
            MERCURIAN_WS_METHODS.stopPlanningTurn,
            // Idempotent by design: stopping a plan with nothing streaming is
            // not an error a person caused. The interrupted settle arrives on
            // the plan's own stream, not in this answer.
            planningAssistant
              .stopTurn({ planId: input.planId, turnId: input.turnId })
              .pipe(Effect.as({})),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_WS_METHODS.answerPlanningQuestion]: (input) =>
          observeRpcEffect(
            MERCURIAN_WS_METHODS.answerPlanningQuestion,
            planningAssistant
              .answerQuestion({
                planId: input.planId,
                turnId: input.turnId,
                answers: input.answers,
              })
              .pipe(Effect.as({})),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_WS_METHODS.archivePlan]: (input) =>
          observeRpcEffect(
            MERCURIAN_WS_METHODS.archivePlan,
            DateTime.now.pipe(
              // The stamp is the server's for the same reason a visit's is.
              Effect.flatMap((archivedAt) =>
                planningStore.archivePlan({ planId: input.planId, archivedAt }),
              ),
              // Archiving mid-reply keeps the record: the partial lands as an
              // interrupted commit, then the plan's session stops.
              Effect.tap(() =>
                planningAssistant.teardownPlan({ planId: input.planId, commitPartial: true }),
              ),
              Effect.as({}),
              Effect.mapError((cause) =>
                isPlanNotFoundError(cause)
                  ? cause
                  : new MercurianPlanningError({ operation: "archivePlan", cause }),
              ),
            ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_WS_METHODS.unarchivePlan]: (input) =>
          observeRpcEffect(
            MERCURIAN_WS_METHODS.unarchivePlan,
            planningStore.unarchivePlan({ planId: input.planId }).pipe(
              Effect.as({}),
              Effect.mapError((cause) =>
                isPlanNotFoundError(cause)
                  ? cause
                  : new MercurianPlanningError({ operation: "unarchivePlan", cause }),
              ),
            ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_WS_METHODS.deletePlan]: (input) =>
          observeRpcEffect(
            MERCURIAN_WS_METHODS.deletePlan,
            planningStore.deletePlan({ planId: input.planId }).pipe(
              // Bytes go after the rows that named them, never before: a
              // refused delete must leave the plan's images where they are.
              Effect.tap((deletion) => removePlanAttachments(deletion)),
              // The history is gone; a partial reply has nothing to land in.
              // Discard the turn and stop the plan's session.
              Effect.tap(() =>
                planningAssistant.teardownPlan({ planId: input.planId, commitPartial: false }),
              ),
              Effect.as({}),
              Effect.mapError((cause) =>
                isPlanNotFoundError(cause) || isPlanDeleteBlockedError(cause)
                  ? cause
                  : new MercurianPlanningError({ operation: "deletePlan", cause }),
              ),
            ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_WS_METHODS.getPlanTextAt]: (input) =>
          observeRpcEffect(
            MERCURIAN_WS_METHODS.getPlanTextAt,
            planningStore
              .getPlanTextAt({
                planId: input.planId,
                commitId: CommitId.make(input.commitId),
              })
              .pipe(
                Effect.map(toWirePlanTextAt),
                // A commit the client did not receive from this plan's own
                // subscription is a planning bug, not something to render.
                Effect.mapError((cause) =>
                  isPlanNotFoundError(cause)
                    ? cause
                    : new MercurianPlanningError({ operation: "getPlanTextAt", cause }),
                ),
              ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_WS_METHODS.measurePlanReconstruction]: (input) =>
          observeRpcEffect(
            MERCURIAN_WS_METHODS.measurePlanReconstruction,
            planningAssistant
              .measureReconstruction({
                planId: input.planId,
                parentCommitId: CommitId.make(input.commitId),
              })
              .pipe(
                Effect.mapError((cause) =>
                  isPlanNotFoundError(cause)
                    ? cause
                    : new MercurianPlanningError({
                        operation: "measurePlanReconstruction",
                        cause,
                      }),
                ),
              ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_WS_METHODS.getSpecAt]: (input) =>
          observeRpcEffect(
            MERCURIAN_WS_METHODS.getSpecAt,
            planningStore
              .getSpecAt({
                planId: input.planId,
                commitId: CommitId.make(input.commitId),
              })
              .pipe(
                Effect.map(toWireSpecAt),
                Effect.mapError((cause) =>
                  isPlanNotFoundError(cause)
                    ? cause
                    : new MercurianPlanningError({ operation: "getSpecAt", cause }),
                ),
              ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_WS_METHODS.subscribePlan]: (input) =>
          observeRpcStreamEffect(
            MERCURIAN_WS_METHODS.subscribePlan,
            Effect.gen(function* () {
              const toPlanStreamError = (cause: unknown) =>
                isPlanNotFoundError(cause)
                  ? cause
                  : new MercurianPlanningError({ operation: "subscribePlan", cause });

              // Attach the change signal before reading anything, so a commit
              // landing while the first query is in flight still reaches this
              // subscriber — it lands after the cursor either way.
              const changes = yield* Queue.unbounded<void>();
              yield* Effect.forkScoped(
                planningStore.changes.pipe(
                  Stream.runForEach(() => Queue.offer(changes, undefined)),
                ),
                { startImmediately: true },
              );
              const sessionChanges = yield* Queue.unbounded<void>();
              yield* Effect.forkScoped(
                codingSessionStore.changes.pipe(
                  Stream.filter((planId) => planId === input.planId),
                  Stream.runForEach(() => Queue.offer(sessionChanges, undefined)),
                ),
                { startImmediately: true },
              );

              // Turn frames attach with the same discipline: before the
              // snapshot read, so a delta landing while that query runs is
              // not lost. A delta the snapshot already contains replays with
              // an offset below the snapshot's text and folds away.
              const turnFrames = yield* Queue.unbounded<PlanStreamItem>();
              yield* Effect.forkScoped(
                planningAssistant
                  .frames(input.planId)
                  .pipe(Stream.runForEach((frame) => Queue.offer(turnFrames, frame))),
                { startImmediately: true },
              );

              const readSince = (afterSequence: number) =>
                planningStore
                  .listTimelineSince({ planId: input.planId, afterSequence })
                  .pipe(Effect.mapError(toPlanStreamError));

              // Resume when the client carries a cursor and the replay is
              // small enough to be worth sending as events. Unlike the thread
              // stream's replay this query is already scoped to one history,
              // so the cap is about wire payload, not about decoding an
              // unbounded global range.
              const resume =
                input.afterSequence === undefined
                  ? null
                  : yield* readSince(input.afterSequence).pipe(
                      Effect.map((events) => (events.length > PLAN_RESUME_MAX_GAP ? null : events)),
                    );

              const opening =
                resume === null
                  ? yield* planningStore.getPlanSnapshot({ planId: input.planId }).pipe(
                      Effect.flatMap((detail) =>
                        // The snapshot carries the partial turn, so a window
                        // opened — or reconnected — mid-turn joins coherently
                        // with no frame replay (ADR 002 §3).
                        Effect.all({
                          inFlightTurns: planningAssistant.inFlightTurns(input.planId),
                          inFlightImplement: planningAssistant.inFlightImplement(input.planId),
                          implementProposal: planningAssistant.implementProposal(input.planId),
                          memoryAmendmentProposal: planningAssistant.memoryAmendmentProposal(
                            input.planId,
                          ),
                        }).pipe(
                          Effect.map(
                            ({
                              inFlightTurns,
                              inFlightImplement,
                              implementProposal,
                              memoryAmendmentProposal,
                            }) => ({
                              cursor: detail.snapshotSequence,
                              items: [
                                {
                                  kind: "snapshot" as const,
                                  snapshot: {
                                    ...toWirePlanDetail(detail),
                                    inFlightTurns,
                                    ...(inFlightImplement === undefined
                                      ? {}
                                      : { inFlightImplement }),
                                    ...(implementProposal === undefined
                                      ? {}
                                      : { implementProposal }),
                                    ...(memoryAmendmentProposal === undefined
                                      ? {}
                                      : { memoryAmendmentProposal }),
                                  },
                                },
                              ] satisfies ReadonlyArray<PlanStreamItem>,
                            }),
                          ),
                        ),
                      ),
                      Effect.mapError(toPlanStreamError),
                    )
                  : {
                      cursor: resume.at(-1)?.item.sequence ?? input.afterSequence ?? 0,
                      items: resume.map(toWirePlanCommitEvent),
                    };

              const cursor = yield* Ref.make(opening.cursor);
              const readSessionFrame = codingSessionStore.listForPlan(input.planId).pipe(
                Effect.map((sessions) => ({
                  kind: "coding-sessions" as const,
                  sessions: sessions.map(toWireCodingSessionRecord),
                })),
                Effect.mapError(toPlanStreamError),
              );
              const openingSessionFrame = yield* readSessionFrame;

              // The change signal is not per-plan, so filtering *is* the
              // cursor query: a mutation on some other plan reads zero rows
              // for this history and emits nothing.
              const liveStream = Stream.fromQueue(changes).pipe(
                Stream.mapEffect(() =>
                  Effect.gen(function* () {
                    const events = yield* readSince(yield* Ref.get(cursor));
                    const last = events.at(-1);
                    if (last !== undefined) {
                      yield* Ref.set(cursor, last.item.sequence);
                    }
                    return events.map(toWirePlanCommitEvent);
                  }),
                ),
                Stream.flatMap(Stream.fromIterable),
              );

              return Stream.concat(
                Stream.fromIterable<PlanStreamItem>([
                  ...opening.items,
                  openingSessionFrame,
                  { kind: "synchronized" as const },
                ]),
                // Turn frames are transport beside the commit events: no
                // sequence, never resumable, and `synchronized` keeps meaning
                // caught-up-on-commits (ADR 002 §3).
                Stream.merge(
                  Stream.merge(liveStream, Stream.fromQueue(turnFrames)),
                  Stream.fromQueue(sessionChanges).pipe(Stream.mapEffect(() => readSessionFrame)),
                ),
              );
            }),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_REPOSITORY_WS_METHODS.subscribeRepositories]: (_input) =>
          observeRpcStreamEffect(
            MERCURIAN_REPOSITORY_WS_METHODS.subscribeRepositories,
            Effect.gen(function* () {
              // Attach the change signal before the first snapshot query, so a
              // mutation landing while that query is in flight still re-sends.
              const changes = yield* Queue.unbounded<void>();
              yield* Effect.forkScoped(
                repositoryStore.changes.pipe(
                  Stream.runForEach(() => Queue.offer(changes, undefined)),
                ),
                { startImmediately: true },
              );
              const snapshot = yield* loadRepositoriesSnapshot;
              return Stream.concat(
                Stream.make({ kind: "snapshot" as const, snapshot }),
                Stream.fromQueue(changes).pipe(
                  // One small value, so a burst of mutations is worth exactly
                  // one re-send: the latest.
                  Stream.debounce(Duration.millis(50)),
                  Stream.mapEffect(() => loadRepositoriesSnapshot),
                  Stream.map((next) => ({ kind: "snapshot" as const, snapshot: next })),
                ),
              );
            }),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_REPOSITORY_WS_METHODS.refreshRepositories]: (_input) =>
          observeRpcEffect(
            MERCURIAN_REPOSITORY_WS_METHODS.refreshRepositories,
            repositoryStore.refreshRepositories.pipe(
              Effect.mapError(
                (cause) =>
                  new MercurianRepositoryError({ operation: "refreshRepositories", cause }),
              ),
            ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_REPOSITORY_WS_METHODS.addRepository]: (input) =>
          observeRpcEffect(
            MERCURIAN_REPOSITORY_WS_METHODS.addRepository,
            DateTime.now.pipe(
              Effect.flatMap((createdAt) =>
                repositoryStore.addRepository({
                  path: input.path,
                  ...(input.name === undefined ? {} : { name: input.name }),
                  createdAt,
                }),
              ),
              Effect.map(toWireRepository),
              Effect.mapError((cause) =>
                isRepositoryPathInvalidError(cause) || isRepositoryAlreadyRegisteredError(cause)
                  ? cause
                  : new MercurianRepositoryError({ operation: "addRepository", cause }),
              ),
            ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_REPOSITORY_WS_METHODS.removeRepository]: (input) =>
          observeRpcEffect(
            MERCURIAN_REPOSITORY_WS_METHODS.removeRepository,
            repositoryStore
              .removeRepository({ repositoryId: input.repositoryId })
              .pipe(
                Effect.mapError((cause) =>
                  isMercurianRepositoryNotFoundError(cause) ||
                  isRepositoryHasLiveWorktreesError(cause)
                    ? cause
                    : new MercurianRepositoryError({ operation: "removeRepository", cause }),
                ),
              ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_REPOSITORY_WS_METHODS.saveRepositoryScripts]: (input) =>
          observeRpcEffect(
            MERCURIAN_REPOSITORY_WS_METHODS.saveRepositoryScripts,
            DateTime.now.pipe(
              Effect.flatMap((updatedAt) =>
                repositoryStore.saveScripts({
                  repositoryId: input.repositoryId,
                  scripts: input.scripts,
                  updatedAt,
                }),
              ),
              Effect.map(toWireRepository),
              Effect.mapError((cause) =>
                isMercurianRepositoryNotFoundError(cause)
                  ? cause
                  : new MercurianRepositoryError({ operation: "saveRepositoryScripts", cause }),
              ),
            ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_REPOSITORY_WS_METHODS.setProjectRepositories]: (input) =>
          observeRpcEffect(
            MERCURIAN_REPOSITORY_WS_METHODS.setProjectRepositories,
            DateTime.now.pipe(
              Effect.flatMap((addedAt) =>
                repositoryStore.setProjectRepositories({
                  projectId: input.projectId,
                  repositoryIds: input.repositoryIds,
                  addedAt,
                }),
              ),
              Effect.mapError((cause) =>
                isMercurianProjectNotFoundError(cause) || isMercurianRepositoryNotFoundError(cause)
                  ? cause
                  : new MercurianRepositoryError({ operation: "setProjectRepositories", cause }),
              ),
            ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_MEMORY_WS_METHODS.subscribeMemorySources]: (_input) =>
          observeRpcStreamEffect(
            MERCURIAN_MEMORY_WS_METHODS.subscribeMemorySources,
            Effect.gen(function* () {
              const changes = yield* Queue.unbounded<void>();
              yield* Effect.forkScoped(
                Stream.merge(memorySourceStore.changes, repositoryStore.changes).pipe(
                  Stream.runForEach(() => Queue.offer(changes, undefined)),
                ),
                { startImmediately: true },
              );
              const snapshot = yield* loadMemorySourcesSnapshot;
              return Stream.concat(
                Stream.make({ kind: "snapshot" as const, snapshot }),
                Stream.fromQueue(changes).pipe(
                  Stream.debounce(Duration.millis(50)),
                  Stream.mapEffect(() => loadMemorySourcesSnapshot),
                  Stream.map((next) => ({ kind: "snapshot" as const, snapshot: next })),
                ),
              );
            }),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_MEMORY_WS_METHODS.designateMemorySource]: (input) =>
          observeRpcEffect(
            MERCURIAN_MEMORY_WS_METHODS.designateMemorySource,
            DateTime.now.pipe(
              Effect.flatMap((now) =>
                memorySourceStore.designate({
                  projectId: input.projectId,
                  repositoryId: input.repositoryId,
                  ...(input.subpath === undefined ? {} : { subpath: input.subpath }),
                  now,
                }),
              ),
              Effect.mapError((cause) =>
                isMemorySourceInvalidError(cause)
                  ? cause
                  : new MercurianMemoryError({ operation: "designateMemorySource", cause }),
              ),
            ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_MEMORY_WS_METHODS.removeMemorySource]: (input) =>
          observeRpcEffect(
            MERCURIAN_MEMORY_WS_METHODS.removeMemorySource,
            memorySourceStore
              .remove(input.projectId)
              .pipe(
                Effect.mapError(
                  (cause) => new MercurianMemoryError({ operation: "removeMemorySource", cause }),
                ),
              ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_MEMORY_WS_METHODS.readMemoryIndex]: (input) =>
          observeRpcEffect(
            MERCURIAN_MEMORY_WS_METHODS.readMemoryIndex,
            memoryIndex
              .readIndex(input.projectId)
              .pipe(
                Effect.mapError((cause) =>
                  isMemoryNotDesignatedError(cause) || isMemorySourceInvalidError(cause)
                    ? cause
                    : new MercurianMemoryError({ operation: "readMemoryIndex", cause }),
                ),
              ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_MEMORY_WS_METHODS.readMemoryNote]: (input) =>
          observeRpcEffect(
            MERCURIAN_MEMORY_WS_METHODS.readMemoryNote,
            memoryIndex
              .readNote(input.projectId, input.name)
              .pipe(
                Effect.mapError((cause) =>
                  isMemoryNotDesignatedError(cause) || isMemorySourceInvalidError(cause)
                    ? cause
                    : new MercurianMemoryError({ operation: "readMemoryNote", cause }),
                ),
              ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_MEMORY_WS_METHODS.generateProductMap]: (input) =>
          observeRpcEffect(
            MERCURIAN_MEMORY_WS_METHODS.generateProductMap,
            memoryIndex
              .generateProductMap(input.projectId)
              .pipe(
                Effect.mapError((cause) =>
                  isMemoryNotDesignatedError(cause) ||
                  isMemorySourceInvalidError(cause) ||
                  isProductMapAlreadyExistsError(cause) ||
                  isProductMapCycleError(cause)
                    ? cause
                    : new MercurianMemoryError({ operation: "generateProductMap", cause }),
                ),
              ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_WORKSPACE_WS_METHODS.subscribeWorkspaceSettings]: (_input) =>
          observeRpcStreamEffect(
            MERCURIAN_WORKSPACE_WS_METHODS.subscribeWorkspaceSettings,
            Effect.gen(function* () {
              // Attach the change signal before the first snapshot query, so a
              // write landing while that query is in flight still re-sends.
              const changes = yield* Queue.unbounded<void>();
              yield* Effect.forkScoped(
                workspaceSettingsStore.changes.pipe(
                  Stream.runForEach(() => Queue.offer(changes, undefined)),
                ),
                { startImmediately: true },
              );
              const snapshot = yield* loadWorkspaceSettingsSnapshot;
              return Stream.concat(
                Stream.make({ kind: "snapshot" as const, snapshot }),
                Stream.fromQueue(changes).pipe(
                  // One small value: a burst of writes is worth exactly one
                  // re-send, the latest.
                  Stream.debounce(Duration.millis(50)),
                  Stream.mapEffect(() => loadWorkspaceSettingsSnapshot),
                  Stream.map((next) => ({ kind: "snapshot" as const, snapshot: next })),
                ),
              );
            }),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_TRACKER_WS_METHODS.subscribeTrackers]: (_input) =>
          observeRpcStreamEffect(
            MERCURIAN_TRACKER_WS_METHODS.subscribeTrackers,
            Effect.gen(function* () {
              // Attach the change signal before the first snapshot query, so a
              // connect landing while that query is in flight still re-sends.
              const changes = yield* Queue.unbounded<void>();
              yield* Effect.forkScoped(
                trackerStore.changes.pipe(Stream.runForEach(() => Queue.offer(changes, undefined))),
                { startImmediately: true },
              );
              const snapshot = yield* loadTrackersSnapshot;
              return Stream.concat(
                Stream.make({ kind: "snapshot" as const, snapshot }),
                Stream.fromQueue(changes).pipe(
                  // One small value, so a burst of mutations is worth exactly
                  // one re-send: the latest.
                  Stream.debounce(Duration.millis(50)),
                  Stream.mapEffect(() => loadTrackersSnapshot),
                  Stream.map((next) => ({ kind: "snapshot" as const, snapshot: next })),
                ),
              );
            }),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_TRACKER_WS_METHODS.connectTracker]: (input) =>
          observeRpcEffect(
            MERCURIAN_TRACKER_WS_METHODS.connectTracker,
            DateTime.now.pipe(
              Effect.flatMap((createdAt) => trackerStore.connect({ ...input, createdAt })),
              Effect.map(toWireConnection),
              // The two refusals travel because the dialog says something
              // different for each. Nothing else about the attempt does — in
              // particular the payload, which held the credential, is never
              // echoed into a cause.
              Effect.mapError((cause) =>
                isTrackerAuthError(cause) || isTrackerUnreachableError(cause)
                  ? cause
                  : new MercurianTrackerError({ operation: "connectTracker" }),
              ),
            ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_TRACKER_WS_METHODS.disconnectTracker]: (input) =>
          observeRpcEffect(
            MERCURIAN_TRACKER_WS_METHODS.disconnectTracker,
            trackerStore
              .disconnect({ connectionId: input.connectionId })
              .pipe(
                Effect.mapError((cause) =>
                  isTrackerConnectionNotFoundError(cause)
                    ? cause
                    : new MercurianTrackerError({ operation: "disconnectTracker", cause }),
                ),
              ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_TRACKER_WS_METHODS.listTrackerIssues]: (input) =>
          observeRpcEffect(
            MERCURIAN_TRACKER_WS_METHODS.listTrackerIssues,
            trackerStore
              .listIssues({
                connectionId: input.connectionId,
                ...(input.search === undefined ? {} : { search: input.search }),
                ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
              })
              .pipe(
                Effect.mapError((cause) =>
                  isTrackerConnectionNotFoundError(cause) ||
                  isTrackerAuthError(cause) ||
                  isTrackerUnreachableError(cause)
                    ? cause
                    : new MercurianTrackerError({ operation: "listTrackerIssues", cause }),
                ),
              ),
            { "rpc.aggregate": "mercurian" },
          ),
        [WS_METHODS.serverProbe]: (_input) =>
          observeRpcEffect(WS_METHODS.serverProbe, Effect.succeed({}), {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverGetConfig]: (_input) =>
          observeRpcEffect(WS_METHODS.serverGetConfig, loadServerConfig, {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverRefreshProviders]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverRefreshProviders,
            (input.instanceId !== undefined
              ? providerRegistry.refreshInstance(input.instanceId)
              : providerRegistry.refresh()
            ).pipe(Effect.map((providers) => ({ providers }))),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.providerUploadFeedback]: (input) =>
          observeRpcEffect(
            WS_METHODS.providerUploadFeedback,
            providerService.uploadFeedback(input).pipe(
              Effect.mapError(
                (cause) =>
                  new ProviderUploadFeedbackError({
                    threadId: input.threadId,
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "provider" },
          ),
        [WS_METHODS.serverUpdateProvider]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverUpdateProvider,
            providerMaintenanceRunner.updateProvider(input),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.serverUpdateServer]: (input) =>
          observeRpcEffect(WS_METHODS.serverUpdateServer, serverSelfUpdate.update(input), {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverUpdateServerWithProgress]: (input) =>
          observeRpcStream(
            WS_METHODS.serverUpdateServerWithProgress,
            Stream.callback<ServerSelfUpdateProgressEvent, ServerSelfUpdateError>((queue) =>
              serverSelfUpdate
                .update(input, (stage) =>
                  Queue.offer(queue, {
                    type: "progress",
                    stage,
                  }).pipe(Effect.asVoid),
                )
                .pipe(
                  Effect.flatMap((result) =>
                    Queue.offer(queue, {
                      type: "complete",
                      result,
                    }),
                  ),
                  Effect.catchTags({
                    ServerSelfUpdateError: (error) => Queue.fail(queue, error),
                  }),
                  Effect.andThen(Queue.end(queue)),
                  Effect.forkScoped,
                ),
            ),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverUpsertKeybinding]: (rule) =>
          observeRpcEffect(
            WS_METHODS.serverUpsertKeybinding,
            Effect.gen(function* () {
              const keybindingsConfig = yield* keybindings.upsertKeybindingRule(rule);
              return { keybindings: keybindingsConfig, issues: [] };
            }),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverRemoveKeybinding]: (rule) =>
          observeRpcEffect(
            WS_METHODS.serverRemoveKeybinding,
            Effect.gen(function* () {
              const keybindingsConfig = yield* keybindings.removeKeybindingRule(rule);
              return { keybindings: keybindingsConfig, issues: [] };
            }),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverGetSettings]: (_input) =>
          observeRpcEffect(
            WS_METHODS.serverGetSettings,
            serverSettings.getSettings.pipe(
              Effect.map(ServerSettings.redactServerSettingsForClient),
            ),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.serverUpdateSettings]: ({ patch }) =>
          observeRpcEffect(
            WS_METHODS.serverUpdateSettings,
            serverSettings
              .updateSettings(patch)
              .pipe(Effect.map(ServerSettings.redactServerSettingsForClient)),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.serverDiscoverSourceControl]: (_input) =>
          observeRpcEffect(
            WS_METHODS.serverDiscoverSourceControl,
            sourceControlDiscovery.discover,
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.serverGetTraceDiagnostics]: (_input) =>
          observeRpcEffect(
            WS_METHODS.serverGetTraceDiagnostics,
            TraceDiagnostics.readTraceDiagnostics({
              traceFilePath: config.serverTracePath,
              maxFiles: config.traceMaxFiles,
            }),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.serverGetProcessDiagnostics]: (_input) =>
          observeRpcEffect(WS_METHODS.serverGetProcessDiagnostics, processDiagnostics.read, {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverGetProcessResourceHistory]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverGetProcessResourceHistory,
            processResourceMonitor.readHistory(input),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.serverGetResourceTelemetryHistory]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverGetResourceTelemetryHistory,
            resourceTelemetry.readHistory(input),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.serverGetUsageSummary]: (input) =>
          observeRpcEffect(WS_METHODS.serverGetUsageSummary, usage.readSummary(input), {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverRetryResourceTelemetry]: (_input) =>
          observeRpcEffect(WS_METHODS.serverRetryResourceTelemetry, resourceTelemetry.retry, {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverSignalProcess]: (input) =>
          observeRpcEffect(WS_METHODS.serverSignalProcess, processDiagnostics.signal(input), {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverReportClientActivity]: (input, metadata) =>
          Ref.update(rpcClientIds, (clientIds) => {
            const next = new Set(clientIds);
            next.add(RpcClientId.make(metadata.client.id));
            return next;
          }).pipe(
            Effect.andThen(
              observeRpcEffect(
                WS_METHODS.serverReportClientActivity,
                backgroundPolicy.reportClientActivity(
                  currentSessionId,
                  RpcClientId.make(metadata.client.id),
                  input,
                ),
                { "rpc.aggregate": "server" },
              ),
            ),
          ),
        [WS_METHODS.serverReportHostPowerState]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverReportHostPowerState,
            backgroundPolicy.reportHostPowerState(input),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverGetBackgroundPolicy]: (_input) =>
          observeRpcEffect(WS_METHODS.serverGetBackgroundPolicy, backgroundPolicy.snapshot, {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.cloudGetRelayClientStatus]: (_input) =>
          observeRpcEffect(WS_METHODS.cloudGetRelayClientStatus, relayClient.resolve, {
            "rpc.aggregate": "cloud",
          }),
        [WS_METHODS.cloudInstallRelayClient]: (_input) =>
          observeRpcStream(
            WS_METHODS.cloudInstallRelayClient,
            Stream.callback<RelayClientInstallProgressEvent, RelayClientInstallFailedError>(
              (queue) =>
                relayClient
                  .installWithProgress((event) => Queue.offer(queue, event).pipe(Effect.asVoid))
                  .pipe(
                    Effect.flatMap((status) =>
                      Queue.offer(queue, {
                        type: "complete",
                        status,
                      }),
                    ),
                    Effect.catchTag("RelayClientInstallError", (error) =>
                      Queue.fail(
                        queue,
                        new RelayClientInstallFailedError({
                          reason: error.reason,
                          message: error.message,
                        }),
                      ),
                    ),
                    Effect.andThen(Queue.end(queue)),
                    Effect.forkScoped,
                  ),
            ),
            { "rpc.aggregate": "cloud" },
          ),
        [WS_METHODS.pullRequestsList]: (input) =>
          observeRpcEffect(WS_METHODS.pullRequestsList, pullRequests.list(input), {
            "rpc.aggregate": "pull-requests",
          }),
        [WS_METHODS.pullRequestsListStats]: (input) =>
          observeRpcEffect(WS_METHODS.pullRequestsListStats, pullRequests.listStats(input), {
            "rpc.aggregate": "pull-requests",
          }),
        [WS_METHODS.pullRequestsDetail]: (input) =>
          observeRpcEffect(WS_METHODS.pullRequestsDetail, pullRequests.detail(input), {
            "rpc.aggregate": "pull-requests",
          }),
        [WS_METHODS.pullRequestsActivity]: (input) =>
          observeRpcEffect(WS_METHODS.pullRequestsActivity, pullRequests.activity(input), {
            "rpc.aggregate": "pull-requests",
          }),
        [WS_METHODS.pullRequestsThreadComments]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsThreadComments,
            pullRequests.threadComments(input),
            {
              "rpc.aggregate": "pull-requests",
            },
          ),
        [WS_METHODS.pullRequestsDiffFileContents]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsDiffFileContents,
            pullRequests.diffFileContents(input),
            { "rpc.aggregate": "pull-requests" },
          ),
        [WS_METHODS.pullRequestsRunAction]: (input) =>
          observeRpcEffect(WS_METHODS.pullRequestsRunAction, pullRequests.runAction(input), {
            "rpc.aggregate": "pull-requests",
          }),
        [WS_METHODS.pullRequestsUpdate]: (input) =>
          observeRpcEffect(WS_METHODS.pullRequestsUpdate, pullRequests.update(input), {
            "rpc.aggregate": "pull-requests",
          }),
        [WS_METHODS.pullRequestsComment]: (input) =>
          observeRpcEffect(WS_METHODS.pullRequestsComment, pullRequests.comment(input), {
            "rpc.aggregate": "pull-requests",
          }),
        [WS_METHODS.pullRequestsUpdateComment]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsUpdateComment,
            pullRequests.updateComment(input),
            {
              "rpc.aggregate": "pull-requests",
            },
          ),
        [WS_METHODS.pullRequestsSubmitReview]: (input) =>
          observeRpcEffect(WS_METHODS.pullRequestsSubmitReview, pullRequests.submitReview(input), {
            "rpc.aggregate": "pull-requests",
          }),
        [WS_METHODS.pullRequestsReplyToThread]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsReplyToThread,
            pullRequests.replyToThread(input),
            { "rpc.aggregate": "pull-requests" },
          ),
        [WS_METHODS.pullRequestsSetThreadResolution]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsSetThreadResolution,
            pullRequests.setThreadResolution(input),
            { "rpc.aggregate": "pull-requests" },
          ),
        [WS_METHODS.pullRequestsSetReaction]: (input) =>
          observeRpcEffect(WS_METHODS.pullRequestsSetReaction, pullRequests.setReaction(input), {
            "rpc.aggregate": "pull-requests",
          }),
        [WS_METHODS.pullRequestsInvalidate]: (input) =>
          observeRpcEffect(WS_METHODS.pullRequestsInvalidate, pullRequests.invalidate(input), {
            "rpc.aggregate": "pull-requests",
          }),
        [WS_METHODS.pullRequestsReviewerCandidates]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsReviewerCandidates,
            pullRequests.reviewerCandidates(input),
            { "rpc.aggregate": "pull-requests" },
          ),
        [WS_METHODS.pullRequestsRequestReviewers]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsRequestReviewers,
            pullRequests.requestReviewers(input),
            { "rpc.aggregate": "pull-requests" },
          ),
        [WS_METHODS.sourceControlLookupRepository]: (input) =>
          observeRpcEffect(
            WS_METHODS.sourceControlLookupRepository,
            sourceControlRepositories.lookupRepository(input),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.sourceControlCloneRepository]: (input) =>
          observeRpcEffect(
            WS_METHODS.sourceControlCloneRepository,
            sourceControlRepositories.cloneRepository(input),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.sourceControlPublishRepository]: (input) =>
          observeRpcEffect(
            WS_METHODS.sourceControlPublishRepository,
            sourceControlRepositories
              .publishRepository(input)
              .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.projectsSearchEntries]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsSearchEntries,
            workspaceEntries.search(input).pipe(
              Effect.mapError(
                (cause) =>
                  new ProjectSearchEntriesError({
                    cwd: input.cwd,
                    queryLength: input.query.length,
                    limit: input.limit,
                    ...projectEntriesFailureContext(cause),
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsSearchContents]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsSearchContents,
            workspaceEntries.searchContents(input).pipe(
              Effect.mapError(
                (cause) =>
                  new ProjectSearchContentsError({
                    cwd: input.cwd,
                    queryLength: input.query.length,
                    limit: input.limit,
                    ...projectEntriesFailureContext(cause),
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsListEntries]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsListEntries,
            workspaceEntries.list(input).pipe(
              Effect.mapError(
                (cause) =>
                  new ProjectListEntriesError({
                    ...input,
                    ...projectEntriesFailureContext(cause),
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsReadFile]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsReadFile,
            workspaceFileSystem.readFile(input).pipe(
              Effect.mapError(
                (cause) =>
                  new ProjectReadFileError({
                    ...input,
                    ...projectFileFailureContext(cause),
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsWriteFile]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsWriteFile,
            workspaceFileSystem.writeFile(input).pipe(
              Effect.mapError(
                (cause) =>
                  new ProjectWriteFileError({
                    cwd: input.cwd,
                    relativePath: input.relativePath,
                    ...projectFileFailureContext(cause),
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.shellOpenInEditor]: (input) =>
          observeRpcEffect(WS_METHODS.shellOpenInEditor, externalLauncher.launchEditor(input), {
            "rpc.aggregate": "workspace",
          }),
        [WS_METHODS.filesystemBrowse]: (input) =>
          observeRpcEffect(
            WS_METHODS.filesystemBrowse,
            workspaceEntries.browse(input).pipe(
              Effect.mapError(
                (cause) =>
                  new FilesystemBrowseError({
                    ...input,
                    ...filesystemBrowseFailureContext(cause),
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.attachmentsCreateUploadUrl]: (input) =>
          observeRpcEffect(WS_METHODS.attachmentsCreateUploadUrl, issueAttachmentUploadUrl(input), {
            "rpc.aggregate": "workspace",
          }),
        [WS_METHODS.attachmentsDelete]: (input) =>
          observeRpcEffect(
            WS_METHODS.attachmentsDelete,
            deletePendingAttachment(input.attachmentId),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.assetsCreateUrl]: (input) =>
          observeRpcEffect(
            WS_METHODS.assetsCreateUrl,
            Effect.gen(function* () {
              if (input.resource._tag === "attachment") {
                return yield* issueAssetUrl({ resource: input.resource });
              }
              if (input.resource._tag === "project-favicon") {
                const project = yield* projectionSnapshotQuery
                  .getActiveProjectByWorkspaceRoot(input.resource.cwd)
                  .pipe(
                    Effect.mapError(
                      (cause) =>
                        new AssetWorkspaceContextResolutionError({
                          resource: input.resource,
                          cause,
                        }),
                    ),
                  );
                if (Option.isNone(project)) {
                  return yield* new AssetWorkspaceContextNotFoundError({
                    resource: input.resource,
                  });
                }
                return yield* issueAssetUrl({
                  resource: input.resource,
                  ...(project.value.faviconPath
                    ? { projectFaviconPath: project.value.faviconPath }
                    : {}),
                });
              }
              const thread = yield* projectionSnapshotQuery
                .getThreadShellById(input.resource.threadId)
                .pipe(
                  Effect.mapError(
                    (cause) =>
                      new AssetWorkspaceContextResolutionError({
                        resource: input.resource,
                        cause,
                      }),
                  ),
                );
              if (Option.isNone(thread)) {
                return yield* new AssetWorkspaceContextNotFoundError({
                  resource: input.resource,
                });
              }
              const project = yield* projectionSnapshotQuery
                .getProjectShellById(thread.value.projectId)
                .pipe(
                  Effect.mapError(
                    (cause) =>
                      new AssetWorkspaceContextResolutionError({
                        resource: input.resource,
                        cause,
                      }),
                  ),
                );
              if (Option.isNone(project)) {
                return yield* new AssetWorkspaceContextNotFoundError({
                  resource: input.resource,
                });
              }
              return yield* issueAssetUrl({
                resource: input.resource,
                workspaceRoot: thread.value.worktreePath ?? project.value.workspaceRoot,
              });
            }),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.subscribeVcsStatus]: (input) =>
          observeRpcStream(
            WS_METHODS.subscribeVcsStatus,
            vcsStatusBroadcaster.streamStatus(input, {
              automaticRemoteRefreshInterval: automaticGitFetchInterval,
            }),
            {
              "rpc.aggregate": "vcs",
            },
          ),
        [WS_METHODS.vcsRefreshStatus]: (input) =>
          observeRpcEffect(
            WS_METHODS.vcsRefreshStatus,
            vcsStatusBroadcaster.refreshStatus(input.cwd),
            {
              "rpc.aggregate": "vcs",
            },
          ),
        [WS_METHODS.vcsPull]: (input) =>
          observeRpcEffect(
            WS_METHODS.vcsPull,
            gitWorkflow.pullCurrentBranch(input.cwd).pipe(
              Effect.matchCauseEffect({
                onFailure: (cause) => Effect.failCause(cause),
                onSuccess: (result) =>
                  refreshGitStatus(input.cwd).pipe(Effect.ignore({ log: true }), Effect.as(result)),
              }),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitRunStackedAction]: (input) =>
          observeRpcStream(
            WS_METHODS.gitRunStackedAction,
            Stream.callback<GitActionProgressEvent, GitManagerServiceError>((queue) =>
              gitWorkflow
                .runStackedAction(input, {
                  actionId: input.actionId,
                  progressReporter: {
                    publish: (event) => Queue.offer(queue, event).pipe(Effect.asVoid),
                  },
                })
                .pipe(
                  Effect.matchCauseEffect({
                    onFailure: (cause) => Queue.failCause(queue, cause),
                    onSuccess: (result) =>
                      attachCreatedPullRequestToCodingSession(
                        codingSessionStore,
                        input.cwd,
                        result,
                      ).pipe(
                        Effect.ignore({ log: true }),
                        Effect.andThen(refreshGitStatus(input.cwd)),
                        Effect.andThen(Queue.end(queue).pipe(Effect.asVoid)),
                      ),
                  }),
                ),
            ),
            { "rpc.aggregate": "vcs" },
          ),
        [WS_METHODS.gitResolvePullRequest]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitResolvePullRequest,
            gitWorkflow.resolvePullRequest(input),
            {
              "rpc.aggregate": "git",
            },
          ),
        [WS_METHODS.gitPreparePullRequestThread]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitPreparePullRequestThread,
            gitWorkflow
              .preparePullRequestThread(input)
              .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.vcsListRefs]: (input) =>
          observeRpcEffect(WS_METHODS.vcsListRefs, gitWorkflow.listRefs(input), {
            "rpc.aggregate": "vcs",
          }),
        [WS_METHODS.vcsCreateWorktree]: (input) =>
          observeRpcEffect(
            WS_METHODS.vcsCreateWorktree,
            gitWorkflow.createWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "vcs" },
          ),
        [WS_METHODS.vcsRemoveWorktree]: (input) =>
          observeRpcEffect(
            WS_METHODS.vcsRemoveWorktree,
            gitWorkflow.removeWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "vcs" },
          ),
        [WS_METHODS.vcsCreateRef]: (input) =>
          observeRpcEffect(
            WS_METHODS.vcsCreateRef,
            gitWorkflow.createRef(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "vcs" },
          ),
        [WS_METHODS.vcsSwitchRef]: (input) =>
          observeRpcEffect(
            WS_METHODS.vcsSwitchRef,
            gitWorkflow.switchRef(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "vcs" },
          ),
        [WS_METHODS.vcsInit]: (input) =>
          observeRpcEffect(
            WS_METHODS.vcsInit,
            vcsProvisioning
              .initRepository(input)
              .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "vcs" },
          ),
        [WS_METHODS.reviewGetDiffPreview]: (input) =>
          observeRpcEffect(WS_METHODS.reviewGetDiffPreview, review.getDiffPreview(input), {
            "rpc.aggregate": "review",
          }),
        [WS_METHODS.reviewGetDiffFileContents]: (input) =>
          observeRpcEffect(
            WS_METHODS.reviewGetDiffFileContents,
            review.getDiffFileContents(input),
            { "rpc.aggregate": "review" },
          ),
        [WS_METHODS.terminalOpen]: (input) =>
          observeRpcEffect(WS_METHODS.terminalOpen, terminalManager.open(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalAttach]: (input) =>
          observeRpcStream(
            WS_METHODS.terminalAttach,
            Stream.callback<TerminalAttachStreamEvent, TerminalError>((queue) =>
              Effect.acquireRelease(
                terminalManager.attachStream(input, (event) => Queue.offer(queue, event)),
                (unsubscribe) => Effect.sync(unsubscribe),
              ),
            ),
            { "rpc.aggregate": "terminal" },
          ),
        [WS_METHODS.terminalWrite]: (input) =>
          observeRpcEffect(WS_METHODS.terminalWrite, terminalManager.write(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalResize]: (input) =>
          observeRpcEffect(WS_METHODS.terminalResize, terminalManager.resize(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalClear]: (input) =>
          observeRpcEffect(WS_METHODS.terminalClear, terminalManager.clear(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalRestart]: (input) =>
          observeRpcEffect(WS_METHODS.terminalRestart, terminalManager.restart(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalClose]: (input) =>
          observeRpcEffect(WS_METHODS.terminalClose, terminalManager.close(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.subscribeTerminalEvents]: (_input) =>
          observeRpcStream(
            WS_METHODS.subscribeTerminalEvents,
            Stream.callback<TerminalEvent>((queue) =>
              Effect.acquireRelease(
                terminalManager.subscribe((event) => Queue.offer(queue, event)),
                (unsubscribe) => Effect.sync(unsubscribe),
              ),
            ),
            { "rpc.aggregate": "terminal" },
          ),
        [WS_METHODS.subscribeTerminalMetadata]: (_input) =>
          observeRpcStream(
            WS_METHODS.subscribeTerminalMetadata,
            Stream.callback<TerminalMetadataStreamEvent>((queue) =>
              Effect.acquireRelease(
                terminalManager.subscribeMetadata((event) => Queue.offer(queue, event)),
                (unsubscribe) => Effect.sync(unsubscribe),
              ),
            ),
            { "rpc.aggregate": "terminal" },
          ),
        [WS_METHODS.previewOpen]: (input) =>
          observeRpcEffect(WS_METHODS.previewOpen, previewManager.open(input), {
            "rpc.aggregate": "preview",
          }),
        [WS_METHODS.previewNavigate]: (input) =>
          observeRpcEffect(WS_METHODS.previewNavigate, previewManager.navigate(input), {
            "rpc.aggregate": "preview",
          }),
        [WS_METHODS.previewResize]: (input) =>
          observeRpcEffect(WS_METHODS.previewResize, previewManager.resize(input), {
            "rpc.aggregate": "preview",
          }),
        [WS_METHODS.previewRefresh]: (input) =>
          observeRpcEffect(WS_METHODS.previewRefresh, previewManager.refresh(input), {
            "rpc.aggregate": "preview",
          }),
        [WS_METHODS.previewClose]: (input) =>
          observeRpcEffect(WS_METHODS.previewClose, previewManager.close(input), {
            "rpc.aggregate": "preview",
          }),
        [WS_METHODS.previewList]: (input) =>
          observeRpcEffect(WS_METHODS.previewList, previewManager.list(input), {
            "rpc.aggregate": "preview",
          }),
        [WS_METHODS.previewReportStatus]: (input) =>
          observeRpcEffect(WS_METHODS.previewReportStatus, previewManager.reportStatus(input), {
            "rpc.aggregate": "preview",
          }),
        [WS_METHODS.previewAutomationConnect]: (input) =>
          observeRpcStreamEffect(
            WS_METHODS.previewAutomationConnect,
            previewAutomationBroker.connect(input),
            { "rpc.aggregate": "preview-automation" },
          ),
        [WS_METHODS.previewAutomationRespond]: (input) =>
          observeRpcEffect(
            WS_METHODS.previewAutomationRespond,
            previewAutomationBroker.respond(input),
            { "rpc.aggregate": "preview-automation" },
          ),
        [WS_METHODS.previewAutomationFocusHost]: (input) =>
          observeRpcEffect(
            WS_METHODS.previewAutomationFocusHost,
            previewAutomationBroker.focusHost(input),
            { "rpc.aggregate": "preview-automation" },
          ),
        [WS_METHODS.subscribePreviewEvents]: (_input) =>
          observeRpcStream(WS_METHODS.subscribePreviewEvents, previewManager.events, {
            "rpc.aggregate": "preview",
          }),
        [WS_METHODS.subscribeDiscoveredLocalServers]: (input) =>
          observeRpcStream(
            WS_METHODS.subscribeDiscoveredLocalServers,
            Stream.callback<DiscoveredLocalServerList>((queue) =>
              Effect.gen(function* () {
                const configuredUrls = input.configuredUrls ?? [];
                yield* portDiscovery.retain;
                const initial = yield* portDiscovery.scan(configuredUrls);
                const initialScannedAt = DateTime.formatIso(yield* DateTime.now);
                yield* Queue.offer(queue, {
                  servers: initial,
                  scannedAt: initialScannedAt,
                  configuredUrlProbing: true,
                });
                yield* portDiscovery.subscribe(
                  { configuredUrls, initialSnapshot: initial },
                  (servers) =>
                    Effect.gen(function* () {
                      const scannedAt = DateTime.formatIso(yield* DateTime.now);
                      yield* Queue.offer(queue, {
                        servers,
                        scannedAt,
                        configuredUrlProbing: true,
                      });
                    }),
                );
              }),
            ),
            { "rpc.aggregate": "preview" },
          ),
        [WS_METHODS.subscribeServerConfig]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeServerConfig,
            Effect.gen(function* () {
              const keybindingsUpdates = keybindings.streamChanges.pipe(
                Stream.map((event) => ({
                  version: 1 as const,
                  type: "keybindingsUpdated" as const,
                  payload: {
                    keybindings: event.keybindings,
                    issues: event.issues,
                  },
                })),
              );
              const providerStatuses = providerRegistry.streamChanges.pipe(
                Stream.map((providers) => ({
                  version: 1 as const,
                  type: "providerStatuses" as const,
                  payload: { providers },
                })),
                Stream.debounce(Duration.millis(PROVIDER_STATUS_DEBOUNCE_MS)),
              );
              const settingsUpdates = serverSettings.streamChanges.pipe(
                Stream.map((settings) => ServerSettings.redactServerSettingsForClient(settings)),
                Stream.map((settings) => ({
                  version: 1 as const,
                  type: "settingsUpdated" as const,
                  payload: { settings },
                })),
              );

              yield* providerRegistry
                .refresh()
                .pipe(Effect.ignoreCause({ log: true }), Effect.forkScoped);

              const liveUpdates = Stream.merge(
                keybindingsUpdates,
                Stream.merge(providerStatuses, settingsUpdates),
              );

              return Stream.concat(
                Stream.make({
                  version: 1 as const,
                  type: "snapshot" as const,
                  config: yield* loadServerConfig,
                }),
                liveUpdates,
              );
            }),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.subscribeServerLifecycle]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeServerLifecycle,
            Effect.gen(function* () {
              const snapshot = yield* lifecycleEvents.snapshot;
              const snapshotEvents = Array.from(snapshot.events).toSorted(
                (left, right) => left.sequence - right.sequence,
              );
              const liveEvents = lifecycleEvents.stream.pipe(
                Stream.filter((event) => event.sequence > snapshot.sequence),
              );
              return Stream.concat(Stream.fromIterable(snapshotEvents), liveEvents);
            }),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.subscribeAuthAccess]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeAuthAccess,
            Effect.gen(function* () {
              const initialSnapshot = yield* loadAuthAccessSnapshot();
              const revisionRef = yield* Ref.make(1);
              const accessChanges: Stream.Stream<
                PairingGrantStore.BootstrapCredentialChange | SessionStore.SessionCredentialChange
              > = Stream.merge(bootstrapCredentials.streamChanges, sessions.streamChanges);

              const liveEvents: Stream.Stream<AuthAccessStreamEvent> = accessChanges.pipe(
                Stream.mapEffect((change) =>
                  Ref.updateAndGet(revisionRef, (revision) => revision + 1).pipe(
                    Effect.map((revision) =>
                      toAuthAccessStreamEvent(change, revision, currentSessionId),
                    ),
                  ),
                ),
              );

              return Stream.concat(
                Stream.make({
                  version: 1 as const,
                  revision: 1,
                  type: "snapshot" as const,
                  payload: initialSnapshot,
                }),
                liveEvents,
              );
            }),
            { "rpc.aggregate": "auth" },
          ),
        [WS_METHODS.subscribeBackgroundPolicy]: (_input) =>
          observeRpcStream(
            WS_METHODS.subscribeBackgroundPolicy,
            Stream.unwrap(
              Effect.map(backgroundPolicy.subscribe, ({ latest, changes }) =>
                Stream.concat(Stream.make(latest), changes),
              ),
            ),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.subscribeResourceTelemetry]: (_input) =>
          observeRpcStream(
            WS_METHODS.subscribeResourceTelemetry,
            Stream.unwrap(
              Effect.map(resourceTelemetry.subscribe, ({ latest, changes }) =>
                Stream.concat(Stream.make(latest), changes),
              ),
            ),
            { "rpc.aggregate": "server" },
          ),
      });
    }),
  );

export const websocketRpcRouteLayer = Layer.unwrap(
  Effect.gen(function* () {
    const previewAutomationBroker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
    const serverSelfUpdate = yield* ServerSelfUpdate.ServerSelfUpdate;
    const pullRequests = yield* PullRequestService.PullRequestService;
    return HttpRouter.add(
      "GET",
      "/ws",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
        const sessions = yield* SessionStore.SessionStore;
        const analytics = yield* AnalyticsService.AnalyticsService;
        const session = yield* serverAuth.authenticateWebSocketUpgrade(request).pipe(
          Effect.catchIf(EnvironmentAuth.isServerAuthCredentialError, (error) =>
            failEnvironmentAuthInvalid(EnvironmentAuth.serverAuthCredentialReason(error)),
          ),
          Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
            failEnvironmentInternal("internal_error", error),
          ),
        );
        const clientOrigin = readClientConnectionOrigin(request);
        yield* sessions.recordClientConnection(session.sessionId, clientOrigin);
        yield* analytics.record("client.connected", {
          ...clientOriginAnalyticsProps(clientOrigin),
          ...readMobileDeviceAnalyticsProps(request),
        });
        const rpcWebSocketHttpEffect = yield* RpcServer.toHttpEffectWebsocket(WsRpcGroup, {
          disableTracing: true,
        }).pipe(
          Effect.provide(
            makeWsRpcLayer(session, clientOrigin, previewAutomationBroker).pipe(
              Layer.provideMerge(RpcSerialization.layerJson),
              Layer.provide(ProviderMaintenanceRunner.layer),
              Layer.provide(Layer.succeed(ServerSelfUpdate.ServerSelfUpdate, serverSelfUpdate)),
              // One server-lifetime service means clients share the same PR caches, and a WS
              // mutation invalidates the HTTP diff cache that every client reads from.
              Layer.provide(Layer.succeed(PullRequestService.PullRequestService, pullRequests)),
              Layer.provide(
                SourceControlDiscovery.layer.pipe(
                  Layer.provide(
                    SourceControlProviderRegistry.layer.pipe(
                      Layer.provide(
                        Layer.mergeAll(
                          AzureDevOpsCli.layer,
                          BitbucketApi.layer,
                          GitHubCli.layer,
                          GitLabCli.layer,
                        ),
                      ),
                      Layer.provideMerge(GitVcsDriver.layer),
                      Layer.provide(
                        VcsDriverRegistry.layer.pipe(Layer.provide(VcsProjectConfig.layer)),
                      ),
                    ),
                  ),
                  Layer.provide(VcsProcess.layer),
                ),
              ),
            ),
          ),
        );
        return yield* Effect.acquireUseRelease(
          sessions.markConnected(session.sessionId),
          () => rpcWebSocketHttpEffect,
          () => sessions.markDisconnected(session.sessionId),
        );
      }).pipe(
        Effect.catchTags({
          EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
          EnvironmentInternalError: HttpServerRespondable.toResponse,
        }),
      ),
    );
  }),
);
