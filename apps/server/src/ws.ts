import { isMemoryReadUnavailableError } from "@t3tools/contracts";
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
  ClientConnectionMethod,
  ClientDeviceType,
  ClientOs,
  ClientSurface,
  ClientWebDeployment,
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
  type ThreadWorkspaceMember,
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
  type MemoryLineRef,
  MercurianRepositoryId,
  MercurianPlanningError,
  MercurianRepositoryError,
  MercurianMemoryError,
  MercurianTrackerError,
  MercurianWorkspaceError,
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
  PlanId,
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
  ProviderSetupError,
  RelayClientInstallFailedError,
  type RelayClientInstallProgressEvent,
  ServerSelfUpdateError,
  type ServerSelfUpdateProgressEvent,
  type FilesystemBrowseFailure,
  FilesystemBrowseError,
  AssetWorkspaceContextNotFoundError,
  AssetWorkspaceContextResolutionError,
  RpcClientId,
  EnvironmentAuthorizationError,
  ThreadId,
  type TerminalAttachStreamEvent,
  TerminalCwdStatError,
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
import * as EnvironmentTheme from "./environmentTheme.ts";
import * as Keybindings from "./keybindings.ts";
import * as ExternalLauncher from "./process/externalLauncher.ts";
import {
  projectActivityEvent,
  projectThreadDetailSnapshot,
} from "./orchestration/ActivityPayloadProjection.ts";
import { makeThreadLiveEventCoalescer } from "./orchestration/ThreadLiveEventCoalescer.ts";
import {
  cleanupFailedUploadedAttachments,
  normalizeDispatchCommand,
} from "./orchestration/Normalizer.ts";
import * as OrchestrationEngine from "./orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import * as LineTurnReactor from "./mercurian/assistant/LineTurnReactor.ts";
import { CommitId } from "./mercurian/commitTree/schema.ts";
import { lineRootCommitIdFor } from "./mercurian/commitTree/LineBranchReactor.ts";
import { removePlanAttachments } from "./mercurian/planning/attachments.ts";
import * as PlanningStore from "./mercurian/planning/PlanningStore.ts";
import * as LegacySessionStore from "./mercurian/lineRuntimes/LegacySessionStore.ts";
import * as LineRuntimeStore from "./mercurian/lineRuntimes/LineRuntimeStore.ts";
import * as LineRuntimeService from "./mercurian/lineRuntimes/LineRuntimeService.ts";
import { resolveThreadLine } from "./mercurian/lineRuntimes/resolveThreadLine.ts";
import * as LineBranchStore from "./mercurian/commitTree/LineBranchStore.ts";
import * as SlotStore from "./mercurian/worktreeSlots/SlotStore.ts";
import * as SlotRegistry from "./mercurian/worktreeSlots/SlotRegistry.ts";
import * as SlotService from "./mercurian/worktreeSlots/SlotService.ts";
import { lineSnapshotRef } from "./mercurian/worktreeSlots/SnapshotChain.ts";
import { toWireSlotSnapshot } from "./mercurian/worktreeSlots/wire.ts";
import {
  toWireCodingSessionRecord,
  toWireLineRuntimeRecord,
} from "./mercurian/lineRuntimes/wire.ts";
import {
  toWirePlanCommitEvent,
  composePlanRowStatus,
  toWirePlanDetail,
  toWirePlanImport,
  toWirePlanRevision,
  toWirePlanSpecRevision,
  toWirePlanTextAt,
  toWireSpecAt,
  toWireProject,
  toWireTreeSnapshot,
} from "./mercurian/planning/wire.ts";
import * as RepositoryStore from "./mercurian/repositories/RepositoryStore.ts";
import type { RepositoryView } from "./mercurian/repositories/schema.ts";
import * as MemorySourceStore from "./mercurian/memory/MemorySourceStore.ts";
import * as MemoryIndex from "./mercurian/memory/MemoryIndex.ts";
import * as MemoryDashboard from "./mercurian/memory/MemoryDashboard.ts";
import { memoryInvalidations } from "./mercurian/memory/MemoryInvalidations.ts";
import { toWireMemorySourcesSnapshot } from "./mercurian/memory/wire.ts";
import * as WorkspaceSettingsStore from "./mercurian/workspace/WorkspaceSettingsStore.ts";
import { toWireRepositoriesSnapshot, toWireRepository } from "./mercurian/repositories/wire.ts";
import * as TrackerStore from "./mercurian/trackers/TrackerStore.ts";
import { toWireConnection, toWireTrackersSnapshot } from "./mercurian/trackers/wire.ts";
import { ThreadDeletionReactor } from "./orchestration/Services/ThreadDeletionReactor.ts";
import {
  observeRpcEffect as instrumentRpcEffect,
  observeRpcStream as instrumentRpcStream,
  observeRpcStreamEffect as instrumentRpcStreamEffect,
} from "./observability/RpcInstrumentation.ts";
import * as ProviderRegistry from "./provider/Services/ProviderRegistry.ts";
import * as ProviderService from "./provider/Services/ProviderService.ts";
import * as ProviderMaintenanceRunner from "./provider/providerMaintenanceRunner.ts";
import { ProviderAuthService } from "./provider/Services/ProviderAuthService.ts";
import { ProviderInstanceRegistry } from "./provider/Services/ProviderInstanceRegistry.ts";
import { makeProviderInstallation } from "./provider/providerInstallation.ts";
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
import * as UsageLimitSources from "./usage/UsageLimitSources.ts";
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
      | "thread.session-set";
  }
> {
  return (
    event.type === "thread.message-sent" ||
    event.type === "thread.proposed-plan-upserted" ||
    event.type === "thread.activity-appended" ||
    event.type === "thread.turn-diff-completed" ||
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
  getByThreadId: (threadId: ThreadId) => Effect.Effect<Option.Option<unknown>, Error>,
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
  lineRuntimeStore: Pick<
    LineRuntimeStore.LineRuntimeStore["Service"],
    "getByBranch" | "attachPullRequest"
  >,
  legacySessionStore: Pick<LegacySessionStore.LegacySessionStore["Service"], "getByBranch">,
  result: GitRunStackedActionResult,
  sessionBranch: string | null,
  actingCwd: string,
  getThreadShellById: ProjectionSnapshotQuery.ProjectionSnapshotQuery["Service"]["getThreadShellById"],
  repositories: ReadonlyArray<RepositoryView>,
) {
  if (result.pr.status !== "created" || result.pr.url === undefined) return;
  if (sessionBranch === null) return;
  const runtime = yield* lineRuntimeStore.getByBranch(sessionBranch);
  const legacy = Option.isNone(runtime)
    ? yield* legacySessionStore.getByBranch(sessionBranch)
    : Option.none();
  const session = Option.isSome(runtime) ? runtime.value : Option.getOrUndefined(legacy);
  if (session === undefined) return;
  const shell = yield* getThreadShellById(session.threadId);
  const repositoryId =
    Option.getOrUndefined(shell)?.workspaceMembers?.find(
      (member) => member.worktreePath === actingCwd,
    )?.repositoryId ??
    repositories
      .filter(
        (repository) =>
          actingCwd === repository.path || actingCwd.startsWith(`${repository.path}/`),
      )
      .sort((left, right) => right.path.length - left.path.length)[0]?.repositoryId ??
    ("homeRepositoryId" in session ? session.homeRepositoryId : session.repositoryId);
  if (repositoryId == null) return;
  yield* lineRuntimeStore.attachPullRequest({
    threadId: session.threadId,
    repositoryId: MercurianRepositoryId.make(repositoryId),
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
// Row count alone does not bound replay memory: a few events with large tool
// payloads can decode to gigabytes. Before replaying, sum the serialized
// payload bytes of the range in SQL and reset with a snapshot past this budget.
const ORCHESTRATION_REPLAY_PAYLOAD_BUDGET_BYTES = 8 * 1024 * 1024;

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
const isClientConnectionMethod = Schema.is(ClientConnectionMethod);
const isClientDeviceType = Schema.is(ClientDeviceType);
const isClientOs = Schema.is(ClientOs);
const isClientWebDeployment = Schema.is(ClientWebDeployment);
const MAX_CLIENT_APP_VERSION_LENGTH = 64;
const MAX_CLIENT_BROWSER_LENGTH = 64;
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

// Client telemetry stays in this socket's RPC layer. It must not become a
// server-global "current client" because several client types can connect at once.
function readClientAnalyticsProps(request: HttpServerRequest.HttpServerRequest) {
  const url = HttpServerRequest.toURL(request);
  if (Option.isNone(url)) {
    return {};
  }

  const surface = url.value.searchParams.get("clientSurface");
  const appVersion = url.value.searchParams.get("clientAppVersion")?.trim() ?? "";
  const deviceType = url.value.searchParams.get("clientDeviceType");
  const os = url.value.searchParams.get("clientOs");
  const webDeployment = url.value.searchParams.get("clientWebDeployment");
  const browser = url.value.searchParams.get("clientBrowser")?.trim() ?? "";
  const connectionMethod = url.value.searchParams.get("connectionMethod");
  const rawOsMajorVersion = url.value.searchParams.get("clientOsMajorVersion") ?? "";
  const osMajorVersion = Number(rawOsMajorVersion);
  const deviceModel = url.value.searchParams.get("clientDeviceModel")?.trim() ?? "";
  const isMobile = surface === "mobile";
  const hasOsMajorVersion =
    isMobile && rawOsMajorVersion !== "" && Number.isInteger(osMajorVersion) && osMajorVersion > 0;
  const hasDeviceModel =
    isMobile && deviceModel !== "" && deviceModel.length <= MAX_CLIENT_DEVICE_MODEL_LENGTH;

  return {
    ...(isClientSurface(surface) ? { surface } : {}),
    ...(appVersion !== "" && appVersion.length <= MAX_CLIENT_APP_VERSION_LENGTH
      ? { appVersion, clientAppVersion: appVersion }
      : {}),
    ...(isClientOs(os)
      ? {
          clientOs: os,
          ...(isMobile && (os === "iOS" || os === "Android") ? { os } : {}),
        }
      : {}),
    ...(isClientDeviceType(deviceType) ? { clientDeviceType: deviceType } : {}),
    ...(surface === "web" && isClientWebDeployment(webDeployment) ? { webDeployment } : {}),
    ...(surface === "web" && browser !== "" && browser.length <= MAX_CLIENT_BROWSER_LENGTH
      ? { clientBrowser: browser }
      : {}),
    ...(hasOsMajorVersion ? { osMajorVersion, clientOsMajorVersion: osMajorVersion } : {}),
    ...(hasDeviceModel ? { deviceModel, clientDeviceModel: deviceModel } : {}),
    ...(isClientConnectionMethod(connectionMethod) ? { connectionMethod } : {}),
  };
}

interface CodingSessionSlotMetadata {
  readonly branch: string;
  readonly worktreePath: string;
  readonly workspaceMembers: ReadonlyArray<ThreadWorkspaceMember>;
}

export function codingSessionSlotMetadataChanged(
  current:
    | {
        readonly branch: string | null;
        readonly worktreePath: string | null;
        readonly workspaceMembers?: ReadonlyArray<ThreadWorkspaceMember> | null | undefined;
      }
    | undefined,
  desired: CodingSessionSlotMetadata,
): boolean {
  if (current?.branch !== desired.branch || current.worktreePath !== desired.worktreePath) {
    return true;
  }
  const currentMembers = current.workspaceMembers;
  return (
    currentMembers === undefined ||
    currentMembers === null ||
    currentMembers.length !== desired.workspaceMembers.length ||
    currentMembers.some((member, index) => {
      const desiredMember = desired.workspaceMembers[index];
      return (
        desiredMember === undefined ||
        member.repositoryId !== desiredMember.repositoryId ||
        member.worktreePath !== desiredMember.worktreePath
      );
    })
  );
}

export function updateCodingSessionSlotMetadataIfChanged<E, R>(
  current: Parameters<typeof codingSessionSlotMetadataChanged>[0],
  desired: CodingSessionSlotMetadata,
  dispatch: Effect.Effect<unknown, E, R>,
): Effect.Effect<boolean, E, R> {
  return codingSessionSlotMetadataChanged(current, desired)
    ? dispatch.pipe(Effect.as(true))
    : Effect.succeed(false);
}

const makeWsRpcLayer = (
  currentSession: EnvironmentAuth.AuthenticatedSession,
  clientOrigin: OrchestrationClientOrigin,
  clientAnalyticsProps: Readonly<Record<string, unknown>>,
  previewAutomationBroker: PreviewAutomationBroker.PreviewAutomationBroker["Service"],
) =>
  WsRpcGroup.toLayer(
    Effect.gen(function* () {
      const currentSessionId = currentSession.sessionId;
      const crypto = yield* Crypto.Crypto;
      const projectionSnapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
      const orchestrationEngine = yield* OrchestrationEngine.OrchestrationEngineService;
      const planningStore = yield* PlanningStore.PlanningStore;
      const legacySessionStore = yield* LegacySessionStore.LegacySessionStore;
      const lineRuntimeStore = yield* LineRuntimeStore.LineRuntimeStore;
      const lineBranchStore = yield* LineBranchStore.LineBranchStore;
      const slotStore = yield* SlotStore.SlotStore;
      const slotRegistry = yield* SlotRegistry.SlotRegistry;
      const slotService = yield* SlotService.SlotService;
      const lineTurnReactor = yield* LineTurnReactor.LineTurnReactor;
      const lineRuntimeService = yield* LineRuntimeService.LineRuntimeService;
      const repositoryStore = yield* RepositoryStore.RepositoryStore;
      const memorySourceStore = yield* MemorySourceStore.MemorySourceStore;
      const memoryIndex = yield* MemoryIndex.MemoryIndex;
      const memoryDashboard = yield* MemoryDashboard.MemoryDashboard;
      const trackerStore = yield* TrackerStore.TrackerStore;
      const workspaceSettingsStore = yield* WorkspaceSettingsStore.WorkspaceSettingsStore;
      const threadDeletionReactor = yield* ThreadDeletionReactor;
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
      const recordClientCommandAnalytics = (command: OrchestrationCommand) => {
        switch (command.type) {
          case "thread.create":
            return analytics.record("client.thread.started", clientAnalyticsProps);
          case "thread.turn.start":
            return command.bootstrap?.createThread
              ? Effect.andThen(
                  analytics.record("client.thread.started", clientAnalyticsProps),
                  analytics.record("client.turn.requested", clientAnalyticsProps),
                )
              : analytics.record("client.turn.requested", clientAnalyticsProps);
          default:
            return Effect.void;
        }
      };
      const checkpointDiffQuery = yield* CheckpointDiffQuery.CheckpointDiffQuery;
      const keybindings = yield* Keybindings.Keybindings;
      const environmentTheme = yield* EnvironmentTheme.EnvironmentThemeService;
      const usageLimitSources = yield* UsageLimitSources.UsageLimitSources;
      const externalLauncher = yield* ExternalLauncher.ExternalLauncher;
      const remoteOpenTargets = yield* RemoteOpenTargets.RemoteOpenTargets;
      const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
      const gitDriver = yield* GitVcsDriver.GitVcsDriver;
      const review = yield* ReviewService.ReviewService;
      const vcsProvisioning = yield* VcsProvisioningService.VcsProvisioningService;
      const vcsStatusBroadcaster = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
      const terminalManager = yield* TerminalManager.TerminalManager;
      const previewManager = yield* PreviewManager.PreviewManager;

      const planIdForMemoryLine = Effect.fn("ws.planIdForMemoryLine")(function* (
        line: MemoryLineRef,
        operation:
          | "readLineMemoryChanges"
          | "markMemoryChangeReviewed"
          | "revertMemoryChange"
          | "mergeMemoryHome",
      ) {
        if ("planId" in line) return line.planId;
        const resolved = yield* resolveThreadLine(
          lineRuntimeStore,
          legacySessionStore,
          line.threadId,
        );
        if (Option.isSome(resolved)) return resolved.value.planId;
        return yield* new MercurianMemoryError({
          operation,
          cause: new Error(`Memory line thread ${line.threadId} is missing`),
        });
      });

      const slotForCodingSessionThread = Effect.fn("ws.slotForCodingSessionThread")(function* (
        threadId: ThreadId,
      ) {
        const session = yield* resolveThreadLine(lineRuntimeStore, legacySessionStore, threadId);
        if (Option.isNone(session)) return Option.none();
        const detail = yield* planningStore.getPlanSnapshot({ planId: session.value.planId });
        const slot = (yield* slotStore.listAll).find(
          (candidate) =>
            candidate.projectId === detail.plan.projectId &&
            candidate.members.some(
              (member) =>
                member.repositoryId === session.value.homeRepositoryId &&
                member.currentBranch === session.value.branch,
            ),
        );
        return Option.fromNullishOr(slot);
      });

      const retainTerminalSlot = Effect.fn("ws.retainTerminalSlot")(function* (input: {
        readonly threadId: string;
        readonly terminalId: string;
      }) {
        return yield* acquireLineSlot(ThreadId.make(input.threadId), {
          kind: "terminal",
          threadId: input.threadId,
          terminalId: input.terminalId,
        });
      });

      const releaseTerminalSlots = Effect.fn("ws.releaseTerminalSlots")(function* (input: {
        readonly threadId: string;
        readonly terminalId?: string;
      }) {
        const slot = yield* slotForCodingSessionThread(ThreadId.make(input.threadId));
        if (Option.isNone(slot)) return;
        const lease = yield* slotRegistry.lease(slot.value.slotId);
        if (Option.isNone(lease)) return;
        for (const holder of lease.value.holders) {
          if (
            holder.kind === "terminal" &&
            holder.threadId === input.threadId &&
            (input.terminalId === undefined || holder.terminalId === input.terminalId)
          ) {
            yield* slotService.release(slot.value.slotId, holder);
          }
        }
      });

      const retainPreviewSlot = Effect.fn("ws.retainPreviewSlot")(function* (
        threadId: ThreadId,
        previewId: string,
      ) {
        return yield* acquireLineSlot(threadId, {
          kind: "preview",
          threadId,
          previewId,
        });
      });

      const releasePreviewSlots = Effect.fn("ws.releasePreviewSlots")(function* (input: {
        readonly threadId: ThreadId;
        readonly previewId?: string;
      }) {
        const slot = yield* slotForCodingSessionThread(input.threadId);
        if (Option.isNone(slot)) return;
        const lease = yield* slotRegistry.lease(slot.value.slotId);
        if (Option.isNone(lease)) return;
        for (const holder of lease.value.holders) {
          if (
            holder.kind === "preview" &&
            holder.threadId === input.threadId &&
            (input.previewId === undefined || holder.previewId === input.previewId)
          ) {
            yield* slotService.release(slot.value.slotId, holder);
          }
        }
      });

      const acquireLineSlot = Effect.fn("ws.acquireLineSlot")(function* (
        threadId: ThreadId,
        holder: SlotService.ClaimSlotInput["holder"],
      ) {
        const session = yield* resolveThreadLine(lineRuntimeStore, legacySessionStore, threadId);
        if (Option.isNone(session)) return Option.none();
        const runtime = yield* lineRuntimeStore.getByThreadId(threadId);
        if (Option.isNone(runtime)) {
          return yield* new OrchestrationDispatchCommandError({
            message:
              "This coding session predates threads. Open its line from the plan's checkpoints to continue.",
          });
        }
        const serviceHolder =
          holder.kind === "turn"
            ? ({ kind: "turn" } as const)
            : holder.kind === "terminal"
              ? ({ kind: "terminal", terminalId: holder.terminalId } as const)
              : ({ kind: "preview", previewId: holder.previewId } as const);
        const ensured = yield* lineRuntimeService.ensureSlot({ threadId, holder: serviceHolder });
        return Option.some({ slotId: ensured.slotId, worktreePath: ensured.record.worktreePath });
      });
      const recordLineSend = Effect.fn("ws.recordLineSend")(function* (
        command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
      ) {
        const line = yield* resolveThreadLine(
          lineRuntimeStore,
          legacySessionStore,
          command.threadId,
        );
        if (Option.isNone(line)) return;
        const runtime = yield* lineRuntimeStore.getByThreadId(command.threadId);
        if (Option.isNone(runtime)) {
          return yield* new OrchestrationDispatchCommandError({
            message:
              "This coding session predates threads. Open its line from the plan's checkpoints to continue.",
          });
        }
        yield* lineTurnReactor.recordSend({
          threadId: command.threadId,
          messageId: command.message.messageId,
          text: command.message.text,
          attachments: command.message.attachments,
          ...(command.modelSelection === undefined
            ? {}
            : { modelSelection: command.modelSelection }),
          createdAt: command.createdAt,
        });
      });
      const acquireCodingSessionTurnSlot = (threadId: ThreadId) =>
        acquireLineSlot(threadId, { kind: "turn", threadId }).pipe(
          Effect.map(Option.map((claimed) => claimed.slotId)),
        );
      const acquireCodingSessionTurnSlotForDispatch = (threadId: ThreadId) =>
        acquireCodingSessionTurnSlot(threadId).pipe(
          Effect.catchTag("LineBranchMissingError", (error) =>
            lineRuntimeStore.recordLineBranchMissing(threadId, error.commitOid).pipe(
              Effect.andThen(
                Effect.fail(
                  new OrchestrationDispatchCommandError({
                    message: `The line's branch \`${error.branch}\` no longer exists in the repository; recreate it from the session header to continue.`,
                  }),
                ),
              ),
            ),
          ),
          Effect.catchTag("RepositoryNotGitError", () =>
            Effect.fail(
              new OrchestrationDispatchCommandError({
                message: "This Mercurian line needs a linked Git repository before it can run.",
              }),
            ),
          ),
        );
      const portDiscovery = yield* PortScanner.PortDiscovery;
      const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
      const providerService = yield* ProviderService.ProviderService;
      const providerMaintenanceRunner = yield* ProviderMaintenanceRunner.ProviderMaintenanceRunner;
      const providerAuth = yield* ProviderAuthService;
      const providerInstances = yield* ProviderInstanceRegistry;
      const providerInstallation = yield* makeProviderInstallation();
      const serverUpdate = yield* ServerSelfUpdate.ServerSelfUpdate;
      const config = yield* ServerConfig.ServerConfig;
      const lifecycleEvents = yield* ServerLifecycleEvents.ServerLifecycleEvents;
      const serverSettings = yield* ServerSettings.ServerSettingsService;
      const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;
      const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
      const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
      const canReplayPersistedRange = Effect.fnUntraced(function* (
        afterSequence: number,
        headSequence: number,
        maxGap: number,
      ) {
        const replayGap = headSequence - afterSequence;
        if (replayGap < 0 || replayGap > maxGap) {
          return false;
        }
        const stats = yield* projectionSnapshotQuery
          .getEventReplayStats({
            fromSequenceExclusive: afterSequence,
            toSequenceInclusive: headSequence,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetSnapshotError({
                  message: "Failed to measure orchestration replay range",
                  cause,
                }),
            ),
          );
        if (stats.payloadBytes > ORCHESTRATION_REPLAY_PAYLOAD_BUDGET_BYTES) {
          yield* Effect.logDebug("orchestration replay replaced by snapshot", {
            afterSequence,
            headSequence,
            replayGap,
            eventCount: stats.eventCount,
            payloadBytes: stats.payloadBytes,
            payloadBudgetBytes: ORCHESTRATION_REPLAY_PAYLOAD_BUDGET_BYTES,
          });
          return false;
        }
        return true;
      });
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
              const created = yield* dispatchFromClient({
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
              // The successful create is a fence in the engine command queue:
              // every delete for the prior incarnation committed before it.
              // Drain through that event before setup or turn start can own
              // terminals and provider sessions under the reused thread id.
              yield* threadDeletionReactor.drainThrough(created.sequence);
              yield* lineTurnReactor.drainThrough(created.sequence);
              createdThread = true;
            }

            if (bootstrap?.prepareWorktree) {
              let worktreeBaseRef = bootstrap.prepareWorktree.baseBranch;
              // "Start from origin" is a stored default; repos without the
              // requested remote branch fall back to the local base branch.
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
                const remoteBaseExists = yield* gitWorkflow.remoteBranchExists({
                  cwd: bootstrap.prepareWorktree.projectCwd,
                  refName: bootstrap.prepareWorktree.baseBranch,
                  remoteName: "origin",
                });
                if (remoteBaseExists) {
                  const resolvedRemoteBase = yield* gitWorkflow.resolveRemoteTrackingCommit({
                    cwd: bootstrap.prepareWorktree.projectCwd,
                    refName: bootstrap.prepareWorktree.baseBranch,
                    fallbackRemoteName: "origin",
                  });
                  worktreeBaseRef = resolvedRemoteBase.commitSha;
                }
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

            yield* recordLineSend(finalTurnStartCommand);
            // Mercurian drafts do not set prepareWorktree. If a line bootstrap
            // ever does, this claim runs after its metadata update so the
            // line slot's branch and worktree metadata win.
            const acquiredSlot = yield* acquireCodingSessionTurnSlotForDispatch(command.threadId);

            return yield* dispatchFromClient(finalTurnStartCommand).pipe(
              Effect.tapError(() =>
                Option.isSome(acquiredSlot)
                  ? slotService
                      .release(acquiredSlot.value, {
                        kind: "turn",
                        threadId: command.threadId,
                      })
                      .pipe(Effect.ignoreCause({ log: true }))
                  : Effect.void,
              ),
            );
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
          normalizedCommand.type === "thread.turn.start"
            ? Effect.gen(function* () {
                if (normalizedCommand.bootstrap) {
                  return yield* dispatchBootstrapTurnStart(normalizedCommand);
                }
                // As before Phase D, the human message remains recorded if
                // slot acquisition or orchestration later refuses the turn.
                yield* recordLineSend(normalizedCommand);
                const acquiredSlot = yield* acquireCodingSessionTurnSlotForDispatch(
                  normalizedCommand.threadId,
                );
                return yield* dispatchFromClient(normalizedCommand).pipe(
                  Effect.mapError((cause) =>
                    toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
                  ),
                  Effect.tapError(() =>
                    Option.isSome(acquiredSlot)
                      ? slotService
                          .release(acquiredSlot.value, {
                            kind: "turn",
                            threadId: normalizedCommand.threadId,
                          })
                          .pipe(Effect.ignoreCause({ log: true }))
                      : Effect.void,
                  ),
                );
              }).pipe(
                Effect.mapError((cause) =>
                  toDispatchCommandError(
                    cause,
                    "Failed to acquire the coding-session worktree slot",
                  ),
                ),
              )
            : dispatchFromClient(normalizedCommand).pipe(
                Effect.tap(({ sequence }) =>
                  normalizedCommand.type === "thread.create"
                    ? Effect.all([
                        threadDeletionReactor.drainThrough(sequence),
                        lineTurnReactor.drainThrough(sequence),
                      ]).pipe(Effect.asVoid)
                    : Effect.void,
                ),
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
        const [snapshot, status] = yield* Effect.all([
          planningStore.getTreeSnapshot,
          lineTurnReactor.status,
        ]);
        const lineRuntimes = (yield* Effect.forEach(snapshot.plans, (plan) =>
          lineRuntimeStore.listByPlan(plan.planId),
        )).flat();
        const legacySessions = (yield* Effect.forEach(snapshot.plans, (plan) =>
          legacySessionStore.listByPlan(plan.planId),
        )).flat();
        const runtimesWithLiveStatus = yield* Effect.forEach(lineRuntimes, (runtime) =>
          projectionSnapshotQuery.getThreadShellById(runtime.threadId).pipe(
            Effect.map(
              (shell) =>
                [
                  runtime,
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
        const liveStatusByPlan = new Map<
          PlanId,
          Array<(typeof runtimesWithLiveStatus)[number][1]>
        >();
        for (const [runtime, liveStatus] of runtimesWithLiveStatus) {
          const liveEntries = liveStatusByPlan.get(runtime.planId) ?? [];
          liveEntries.push(liveStatus);
          liveStatusByPlan.set(runtime.planId, liveEntries);
        }
        for (const [planId, liveStatuses] of liveStatusByPlan) {
          composedStatus.set(
            planId,
            composePlanRowStatus(composedStatus.get(planId), liveStatuses),
          );
        }
        return toWireTreeSnapshot(snapshot, composedStatus, [
          ...lineRuntimes.map((runtime) => ({
            planId: runtime.planId,
            threadId: runtime.threadId,
            lineRootCommitId: runtime.lineRootCommitId,
          })),
          ...legacySessions.map((session) => ({
            planId: session.planId,
            threadId: session.threadId,
          })),
        ]);
      }).pipe(
        Effect.tapError((cause) =>
          Effect.logError("mercurian planning tree snapshot load failed", { cause }),
        ),
        Effect.mapError(
          (cause) => new MercurianPlanningError({ operation: "subscribeTree", cause }),
        ),
      );

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
              // Archive removes the thread from the client, so this transport
              // closes its session and terminals after the command lands.
              // Settlement cleanup is driven by thread.settled events in the
              // provider reactor, including settlements that have no client.
              const archiveCommand =
                normalizedCommand.type === "thread.archive" ? normalizedCommand : undefined;
              // Best-effort on purpose: the user's archive must not
              // fail because this cleanup read blipped, so a failed read
              // logs and skips the stop instead of propagating.
              const shouldStopSessionAfterCommand = archiveCommand
                ? yield* projectionSnapshotQuery.getThreadShellById(archiveCommand.threadId).pipe(
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
                        { threadId: archiveCommand.threadId, cause },
                      ).pipe(Effect.as(false)),
                    ),
                  )
                : false;
              const result = yield* dispatchNormalizedCommand(normalizedCommand).pipe(
                Effect.tapError(() => cleanupFailedUploadedAttachments(command, normalizedCommand)),
              );
              yield* recordClientCommandAnalytics(normalizedCommand);
              if (archiveCommand) {
                if (shouldStopSessionAfterCommand) {
                  yield* Effect.gen(function* () {
                    const stopCommand = yield* normalizeDispatchCommand({
                      type: "thread.session.stop",
                      commandId: CommandId.make(
                        `session-stop-for-archive:${archiveCommand.commandId}`,
                      ),
                      threadId: archiveCommand.threadId,
                      createdAt: yield* nowIso,
                    });

                    yield* dispatchNormalizedCommand(stopCommand);
                  }).pipe(
                    Effect.catchCause((cause) =>
                      Effect.logWarning("failed to stop provider session during archive", {
                        threadId: archiveCommand.threadId,
                        cause,
                      }),
                    ),
                  );
                }

                // Archive removes the thread from view, so its user-opened
                // terminal panes close with it.
                yield* terminalManager.close({ threadId: archiveCommand.threadId }).pipe(
                  Effect.catch((error) =>
                    Effect.logWarning("failed to close thread terminals after archive", {
                      threadId: archiveCommand.threadId,
                      error: error.message,
                    }),
                  ),
                );
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
                if (
                  !(yield* canReplayPersistedRange(
                    afterSequence,
                    headSequence,
                    SHELL_RESUME_MAX_GAP,
                  ))
                ) {
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
                  event,
                })),
              );

              // Attach live delivery before reading either replay or snapshot state.
              // Otherwise an event published while the snapshot is loading is lost.
              const liveBuffer = yield* makeThreadLiveEventCoalescer();
              yield* Effect.forkScoped(liveStream.pipe(Stream.runForEach(liveBuffer.offer)), {
                startImmediately: true,
              });
              const bufferedLiveStream = liveBuffer.stream;

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
                if (
                  yield* canReplayPersistedRange(afterSequence, headSequence, THREAD_RESUME_MAX_GAP)
                ) {
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
                            liveBuffer
                              .offerAndWait({ kind: "synchronized" as const })
                              .pipe(Effect.andThen(liveBuffer.takeAll)),
                          ).pipe(Stream.flatMap((items) => Stream.fromIterable(items))),
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
                        liveBuffer
                          .offerAndWait({ kind: "synchronized" as const })
                          .pipe(Effect.andThen(liveBuffer.takeAll)),
                      ).pipe(Stream.flatMap((items) => Stream.fromIterable(items))),
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
                (threadId) => resolveThreadLine(lineRuntimeStore, legacySessionStore, threadId),
              ).pipe(
                Stream.mapError(
                  (cause) => new MercurianPlanningError({ operation: "subscribeTree", cause }),
                ),
              );
              yield* Effect.forkScoped(
                Stream.merge(
                  Stream.merge(
                    Stream.merge(planningStore.changes, lineTurnReactor.changes),
                    lineRuntimeStore.changes,
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
        [MERCURIAN_WS_METHODS.subscribeWorktreeSlots]: (_input) =>
          observeRpcStreamEffect(
            MERCURIAN_WS_METHODS.subscribeWorktreeSlots,
            Effect.sync(() => {
              const snapshot = Effect.gen(function* () {
                const rows = yield* slotStore.listAll;
                const leased = new Set<string>();
                for (const row of rows) {
                  if (Option.isSome(yield* slotRegistry.lease(row.slotId))) leased.add(row.slotId);
                }
                return {
                  kind: "snapshot" as const,
                  snapshot: toWireSlotSnapshot(rows, leased),
                };
              });
              return Stream.concat(
                Stream.fromEffect(snapshot),
                Stream.merge(slotStore.changes, slotRegistry.changes).pipe(
                  Stream.debounce(Duration.millis(25)),
                  Stream.mapEffect(() => snapshot),
                ),
              ).pipe(
                Stream.mapError(
                  (cause) =>
                    new MercurianPlanningError({ operation: "subscribeWorktreeSlots", cause }),
                ),
              );
            }).pipe(
              Effect.mapError(
                (cause) =>
                  new MercurianPlanningError({ operation: "subscribeWorktreeSlots", cause }),
              ),
            ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_WS_METHODS.readLineUncommittedDiff]: (input) =>
          observeRpcEffect(
            MERCURIAN_WS_METHODS.readLineUncommittedDiff,
            checkpointDiffQuery.getLineUncommittedDiff(input).pipe(
              Effect.mapError(
                (cause) =>
                  new MercurianPlanningError({
                    operation: "readLineUncommittedDiff",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_WS_METHODS.recreateLineBranch]: (input) =>
          observeRpcEffect(
            MERCURIAN_WS_METHODS.recreateLineBranch,
            Effect.gen(function* () {
              const resolution = yield* "threadId" in input
                ? Effect.gen(function* () {
                    const line = yield* resolveThreadLine(
                      lineRuntimeStore,
                      legacySessionStore,
                      input.threadId,
                    );
                    if (Option.isNone(line)) {
                      return yield* new MercurianPlanningError({
                        operation: "recreateLineBranch",
                        cause: new Error(`Coding session ${input.threadId} is missing`),
                      });
                    }
                    const detail = yield* planningStore.getPlanSnapshot({
                      planId: line.value.planId,
                    });
                    return {
                      detail,
                      lineRootCommitId:
                        line.value.runtime?.lineRootCommitId ??
                        lineRootCommitIdFor(
                          detail,
                          String(line.value.legacySession?.commitId ?? line.value.lineRootCommitId),
                        ),
                      repositoryIds:
                        line.value.repositories.length === 0
                          ? [line.value.homeRepositoryId]
                          : line.value.repositories.map((repository) => repository.repositoryId),
                    };
                  })
                : Effect.gen(function* () {
                    const detail = yield* planningStore.getPlanSnapshot({ planId: input.planId });
                    const repositoryIds =
                      input.repositoryId === undefined
                        ? (yield* repositoryStore.getSnapshot).projectRepositories
                            .filter((link) => link.projectId === detail.plan.projectId)
                            .map((link) => link.repositoryId)
                        : [input.repositoryId];
                    return {
                      detail,
                      lineRootCommitId: lineRootCommitIdFor(detail, String(input.commitId)),
                      repositoryIds,
                    };
                  });
              const repositorySnapshot = yield* repositoryStore.getSnapshot;
              // Recreate every missing branch of the line across the repositories
              // asked for; a branch that still exists is left alone. The line
              // continues from the chain's recorded commit in each repository.
              const recreated: Array<{ readonly branch: string; readonly commitOid: string }> = [];
              for (const repositoryId of resolution.repositoryIds) {
                const line = yield* lineBranchStore.get({
                  lineRootCommitId: resolution.lineRootCommitId,
                  repositoryId,
                });
                if (Option.isNone(line)) continue;
                const repository = repositorySnapshot.repositories.find(
                  (candidate) => candidate.repositoryId === repositoryId,
                );
                if (repository === undefined || !repository.hasGit) continue;
                const resolveCommit = Effect.fn("ws.recreateLineBranch.resolveCommit")(function* (
                  ref: string,
                ) {
                  const result = yield* gitDriver.execute({
                    operation: "ws.recreateLineBranch.resolveCommit",
                    cwd: repository.path,
                    args: ["rev-parse", "--verify", "--quiet", ref],
                    allowNonZeroExit: true,
                  });
                  return result.exitCode === 0 ? result.stdout.trim() || null : null;
                });
                if ((yield* resolveCommit(`refs/heads/${line.value.branch}`)) !== null) continue;
                const snapshotRef = lineSnapshotRef(resolution.lineRootCommitId);
                const commitOid =
                  (yield* resolveCommit(`${snapshotRef}^2`)) ??
                  (yield* resolveCommit(`${snapshotRef}^1`)) ??
                  line.value.baseOid;
                yield* gitDriver.execute({
                  operation: "ws.recreateLineBranch.create",
                  cwd: repository.path,
                  args: ["branch", line.value.branch, commitOid],
                });
                recreated.push({ branch: line.value.branch, commitOid });
              }
              if (recreated.length === 0) {
                return yield* new MercurianPlanningError({
                  operation: "recreateLineBranch",
                  cause: new Error("No line branch is missing in the repositories asked for"),
                });
              }
              for (const runtime of yield* lineRuntimeStore.listByPlan(
                resolution.detail.plan.planId,
              )) {
                if (runtime.lineRootCommitId === resolution.lineRootCommitId) {
                  yield* lineRuntimeStore.recordLineBranchMissing(runtime.threadId, null);
                }
              }
              return recreated[0]!;
            }).pipe(
              Effect.mapError((cause) =>
                cause._tag === "MercurianPlanningError"
                  ? cause
                  : new MercurianPlanningError({ operation: "recreateLineBranch", cause }),
              ),
            ),
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
        [MERCURIAN_WS_METHODS.ensureProjectRuntime]: (input) =>
          observeRpcEffect(
            MERCURIAN_WS_METHODS.ensureProjectRuntime,
            lineRuntimeService.ensureProjectRuntime(input.projectId).pipe(
              Effect.map((orchestrationProjectId) => ({ orchestrationProjectId })),
              Effect.mapError(
                (cause) => new MercurianPlanningError({ operation: "ensureProjectRuntime", cause }),
              ),
            ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_WS_METHODS.forkLine]: (input) =>
          observeRpcEffect(
            MERCURIAN_WS_METHODS.forkLine,
            lineRuntimeService
              .ensureThread({
                planId: input.planId,
                forkParentCommitId: input.parentCommitId,
              })
              .pipe(
                Effect.map(({ threadId }) => ({ threadId })),
                Effect.mapError(
                  (cause) => new MercurianPlanningError({ operation: "forkLine", cause }),
                ),
              ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_WS_METHODS.openLine]: (input) =>
          observeRpcEffect(
            MERCURIAN_WS_METHODS.openLine,
            lineRuntimeService
              .ensureThread({
                planId: input.planId,
                lineRootCommitId: input.lineRootCommitId,
              })
              .pipe(
                Effect.map(({ threadId }) => ({ threadId })),
                Effect.mapError(
                  (cause) => new MercurianPlanningError({ operation: "openLine", cause }),
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
        [MERCURIAN_WS_METHODS.visitPlan]: (input) =>
          observeRpcEffect(
            MERCURIAN_WS_METHODS.visitPlan,
            DateTime.now.pipe(
              // The act names the plan; the moment is ours. A client clock
              // could otherwise put a visit in the future and silence a row.
              Effect.flatMap((visitedAt) =>
                planningStore.recordPlanVisit({
                  planId: input.planId,
                  ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
                  visitedAt,
                }),
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
                lineTurnReactor.teardownPlan({ planId: input.planId, commitPartial: true }),
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
            Effect.gen(function* () {
              const lineRuntimes = yield* lineRuntimeStore.listByPlan(input.planId);
              const deletion = yield* planningStore.deletePlan({ planId: input.planId });
              // Bytes go after the rows that named them, never before: a
              // refused delete must leave the plan's images where they are.
              yield* removePlanAttachments(deletion);
              // The history is gone; a partial reply has nothing to land in.
              // Discard the turn and delete every captured line thread.
              yield* lineTurnReactor.teardownPlan({
                planId: input.planId,
                commitPartial: false,
                lineRuntimes,
              });
              return {};
            }).pipe(
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
                lineRuntimeStore.changes.pipe(
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
                lineTurnReactor
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
                        lineTurnReactor.inFlightTurns(input.planId).pipe(
                          Effect.map((inFlightTurns) => ({
                            cursor: detail.snapshotSequence,
                            items: [
                              {
                                kind: "snapshot" as const,
                                snapshot: {
                                  ...toWirePlanDetail(detail),
                                  inFlightTurns,
                                },
                              },
                            ] satisfies ReadonlyArray<PlanStreamItem>,
                          })),
                        ),
                      ),
                      Effect.mapError(toPlanStreamError),
                    )
                  : {
                      cursor: resume.at(-1)?.item.sequence ?? input.afterSequence ?? 0,
                      items: resume.map(toWirePlanCommitEvent),
                    };

              const cursor = yield* Ref.make(opening.cursor);
              const readSessionFrame = legacySessionStore.listByPlan(input.planId).pipe(
                Effect.map((sessions) => ({
                  kind: "coding-sessions" as const,
                  sessions: sessions.map(toWireCodingSessionRecord),
                })),
                Effect.mapError(toPlanStreamError),
              );
              const openingSessionFrame = yield* readSessionFrame;
              const readLineRuntimeFrame = lineRuntimeStore.listByPlan(input.planId).pipe(
                Effect.map((lineRuntimes) => ({
                  kind: "line-runtimes" as const,
                  lineRuntimes: lineRuntimes.map(toWireLineRuntimeRecord),
                })),
                Effect.mapError(toPlanStreamError),
              );
              const openingLineRuntimeFrame = yield* readLineRuntimeFrame;

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
                  openingLineRuntimeFrame,
                  { kind: "synchronized" as const },
                ]),
                // Turn frames are transport beside the commit events: no
                // sequence, never resumable, and `synchronized` keeps meaning
                // caught-up-on-commits (ADR 002 §3).
                Stream.merge(
                  Stream.merge(liveStream, Stream.fromQueue(turnFrames)),
                  Stream.fromQueue(sessionChanges).pipe(
                    Stream.mapEffect(() => Effect.all([readSessionFrame, readLineRuntimeFrame])),
                    Stream.flatMap(Stream.fromIterable),
                  ),
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
        [MERCURIAN_MEMORY_WS_METHODS.readMemoryCatalog]: (input) =>
          observeRpcEffect(
            MERCURIAN_MEMORY_WS_METHODS.readMemoryCatalog,
            memoryDashboard.readCatalog(input),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_MEMORY_WS_METHODS.readMemoryDashboard]: (input) =>
          observeRpcEffect(
            MERCURIAN_MEMORY_WS_METHODS.readMemoryDashboard,
            memoryDashboard.readDashboard(input),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_MEMORY_WS_METHODS.readMemoryDocument]: (input) =>
          observeRpcEffect(
            MERCURIAN_MEMORY_WS_METHODS.readMemoryDocument,
            memoryDashboard.readDocument(input),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_MEMORY_WS_METHODS.readMemoryComparison]: (input) =>
          observeRpcEffect(
            MERCURIAN_MEMORY_WS_METHODS.readMemoryComparison,
            memoryDashboard.readComparison(input),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_MEMORY_WS_METHODS.subscribeMemoryInvalidations]: (input) =>
          observeRpcStreamEffect(
            MERCURIAN_MEMORY_WS_METHODS.subscribeMemoryInvalidations,
            Effect.gen(function* () {
              const changes = yield* Queue.sliding<void, MercurianMemoryError>(1);
              const relevant = yield* memoryInvalidations(input.scope);
              yield* Effect.forkScoped(
                relevant.pipe(
                  Stream.runForEach(() => Queue.offer(changes, undefined)),
                  Effect.catch((error) => Queue.fail(changes, error)),
                ),
                { startImmediately: true },
              );
              return Stream.concat(
                Stream.make({ kind: "invalidate" as const }),
                Stream.fromQueue(changes).pipe(
                  Stream.debounce(Duration.millis(50)),
                  Stream.map(() => ({ kind: "invalidate" as const })),
                ),
              );
            }).pipe(
              Effect.mapError(
                (cause) =>
                  new MercurianMemoryError({ operation: "subscribeMemoryInvalidations", cause }),
              ),
            ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_MEMORY_WS_METHODS.readMemoryIndex]: (input) =>
          observeRpcEffect(
            MERCURIAN_MEMORY_WS_METHODS.readMemoryIndex,
            memoryIndex
              .readIndex(input.projectId, input.line, input.position)
              .pipe(
                Effect.mapError((cause) =>
                  isMemoryNotDesignatedError(cause) ||
                  isMemorySourceInvalidError(cause) ||
                  isMemoryReadUnavailableError(cause)
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
              .readNote(input.projectId, input.name, input.line, input.position)
              .pipe(
                Effect.mapError((cause) =>
                  isMemoryNotDesignatedError(cause) ||
                  isMemorySourceInvalidError(cause) ||
                  isMemoryReadUnavailableError(cause)
                    ? cause
                    : new MercurianMemoryError({ operation: "readMemoryNote", cause }),
                ),
              ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_MEMORY_WS_METHODS.readLineMemoryChanges]: (input) =>
          observeRpcEffect(
            MERCURIAN_MEMORY_WS_METHODS.readLineMemoryChanges,
            Effect.gen(function* () {
              const line = input.line;
              const planId = yield* planIdForMemoryLine(line, "readLineMemoryChanges");
              const detail = yield* planningStore.getPlanSnapshot({
                planId,
              });
              return yield* memoryIndex.readLineChanges({
                projectId: detail.plan.projectId,
                line,
                ...(input.position === undefined ? {} : { position: input.position }),
              });
            }).pipe(
              Effect.mapError((cause) =>
                isMemoryNotDesignatedError(cause) ||
                isMemorySourceInvalidError(cause) ||
                isMemoryReadUnavailableError(cause)
                  ? cause
                  : new MercurianMemoryError({ operation: "readLineMemoryChanges", cause }),
              ),
            ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_MEMORY_WS_METHODS.markMemoryChangeReviewed]: (input) =>
          observeRpcEffect(
            MERCURIAN_MEMORY_WS_METHODS.markMemoryChangeReviewed,
            Effect.gen(function* () {
              const line = input.line;
              const planId = yield* planIdForMemoryLine(line, "markMemoryChangeReviewed");
              const detail = yield* planningStore.getPlanSnapshot({ planId });
              yield* memoryIndex.markChangeReviewed({
                projectId: detail.plan.projectId,
                line,
                commitOid: input.commitOid,
                ...(input.position ? { position: input.position } : {}),
              });
              yield* memoryDashboard.invalidate({ projectId: detail.plan.projectId, line });
            }).pipe(
              Effect.mapError((cause) =>
                isMemoryNotDesignatedError(cause) ||
                isMemorySourceInvalidError(cause) ||
                (typeof cause === "object" &&
                  cause !== null &&
                  "_tag" in cause &&
                  cause._tag === "MemoryReviewBlockedError")
                  ? cause
                  : new MercurianMemoryError({ operation: "markMemoryChangeReviewed", cause }),
              ),
            ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_MEMORY_WS_METHODS.revertMemoryChange]: (input) =>
          observeRpcEffect(
            MERCURIAN_MEMORY_WS_METHODS.revertMemoryChange,
            Effect.gen(function* () {
              const line = input.line;
              const planId = yield* planIdForMemoryLine(line, "revertMemoryChange");
              const detail = yield* planningStore.getPlanSnapshot({ planId });
              yield* memoryIndex.revertChange({
                projectId: detail.plan.projectId,
                line,
                target: input.target,
                ...(input.position ? { position: input.position } : {}),
                ...(input.expectedVersion ? { expectedVersion: input.expectedVersion } : {}),
              });
              yield* memoryDashboard.invalidate({ projectId: detail.plan.projectId, line });
            }).pipe(
              Effect.mapError((cause) =>
                isMemoryNotDesignatedError(cause) ||
                isMemorySourceInvalidError(cause) ||
                (typeof cause === "object" &&
                  cause !== null &&
                  "_tag" in cause &&
                  cause._tag === "MemoryReviewBlockedError")
                  ? cause
                  : new MercurianMemoryError({ operation: "revertMemoryChange", cause }),
              ),
            ),
            { "rpc.aggregate": "mercurian" },
          ),
        [MERCURIAN_MEMORY_WS_METHODS.mergeMemoryHome]: (input) =>
          observeRpcEffect(
            MERCURIAN_MEMORY_WS_METHODS.mergeMemoryHome,
            Effect.gen(function* () {
              const line = input.line;
              const planId = yield* planIdForMemoryLine(line, "mergeMemoryHome");
              const detail = yield* planningStore.getPlanSnapshot({ planId });
              const result = yield* memoryIndex.mergeHome({
                projectId: detail.plan.projectId,
                line,
                ...(input.position ? { position: input.position } : {}),
                ...(input.expectedVersion ? { expectedVersion: input.expectedVersion } : {}),
                ...(input.reviewedUnmarkedId !== undefined
                  ? { reviewedUnmarkedId: input.reviewedUnmarkedId }
                  : {}),
              });
              if (result.kind === "merged" || result.kind === "deferred-to-push")
                yield* memoryDashboard.invalidate({ projectId: detail.plan.projectId, line });
              return result;
            }).pipe(
              Effect.mapError((cause) =>
                isMemoryNotDesignatedError(cause) ||
                isMemorySourceInvalidError(cause) ||
                (typeof cause === "object" &&
                  cause !== null &&
                  "_tag" in cause &&
                  (cause._tag === "MemoryReviewBlockedError" ||
                    cause._tag === "MergeMemoryHomeBlockedError"))
                  ? cause
                  : new MercurianMemoryError({ operation: "mergeMemoryHome", cause }),
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
            Effect.gen(function* () {
              // An untargeted refresh is "re-read everything's status", which
              // includes quota from configured usage-limit sources. Awaited,
              // not forked: the RPC scope closes on return and would
              // interrupt a fork before the hub answered.
              if (input.instanceId === undefined) {
                yield* usageLimitSources.refresh;
              }
              let providers = yield* input.cwd !== undefined && input.instanceId !== undefined
                ? providerRegistry.refreshWorkspaceSnapshot({
                    instanceId: input.instanceId,
                    cwd: input.cwd,
                  })
                : input.instanceId !== undefined
                  ? providerRegistry.refreshInstance(input.instanceId)
                  : providerRegistry.refresh();
              if (input.refreshModels) {
                const instances = yield* providerInstances.listInstances;
                for (const instance of instances) {
                  if (
                    !instance.refreshModels ||
                    (input.instanceId !== undefined && input.instanceId !== instance.instanceId) ||
                    !providers.some(
                      (provider) =>
                        provider.instanceId === instance.instanceId &&
                        provider.enabled &&
                        provider.installed,
                    )
                  )
                    continue;
                  yield* instance.refreshModels().pipe(
                    Effect.mapError(
                      (error) =>
                        new ProviderSetupError({
                          instanceId: instance.instanceId,
                          operation: "refresh-models",
                          detail: error.detail,
                        }),
                    ),
                  );
                  providers = yield* providerRegistry.refreshInstance(instance.instanceId);
                }
              }
              return { providers };
            }),
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
        [WS_METHODS.providerAuthStart]: (input) =>
          observeRpcEffect(
            WS_METHODS.providerAuthStart,
            providerAuth.start(input, currentSessionId),
            { "rpc.aggregate": "provider" },
          ),
        [WS_METHODS.providerAuthComplete]: (input) =>
          observeRpcEffect(
            WS_METHODS.providerAuthComplete,
            providerAuth.complete(input, currentSessionId),
            { "rpc.aggregate": "provider" },
          ),
        [WS_METHODS.providerAuthCancel]: (input) =>
          observeRpcEffect(
            WS_METHODS.providerAuthCancel,
            providerAuth.cancel(input, currentSessionId),
            { "rpc.aggregate": "provider" },
          ),
        [WS_METHODS.providerAuthLogout]: (input) =>
          observeRpcEffect(WS_METHODS.providerAuthLogout, providerAuth.logout(input), {
            "rpc.aggregate": "provider",
          }),
        [WS_METHODS.providerAuthSubscribe]: (input) =>
          observeRpcStream(
            WS_METHODS.providerAuthSubscribe,
            providerAuth.subscribe(input, currentSessionId),
            { "rpc.aggregate": "provider" },
          ),
        [WS_METHODS.providerInstallStart]: (input) =>
          observeRpcEffect(WS_METHODS.providerInstallStart, providerInstallation.start(input), {
            "rpc.aggregate": "provider",
          }),
        [WS_METHODS.providerInstallCancel]: (input) =>
          observeRpcEffect(WS_METHODS.providerInstallCancel, providerInstallation.cancel(input), {
            "rpc.aggregate": "provider",
          }),
        [WS_METHODS.providerInstallSubscribe]: (input) =>
          observeRpcStream(
            WS_METHODS.providerInstallSubscribe,
            providerInstallation.subscribe(input),
            { "rpc.aggregate": "provider" },
          ),
        [WS_METHODS.providerInstallRemove]: (input) =>
          observeRpcEffect(WS_METHODS.providerInstallRemove, providerInstallation.remove(input), {
            "rpc.aggregate": "provider",
          }),
        [WS_METHODS.serverUpdateServer]: (input) =>
          observeRpcEffect(WS_METHODS.serverUpdateServer, serverUpdate.update(input), {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverUpdateServerWithProgress]: (input) =>
          observeRpcStream(
            WS_METHODS.serverUpdateServerWithProgress,
            Stream.callback<ServerSelfUpdateProgressEvent, ServerSelfUpdateError>((queue) =>
              serverUpdate
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
        [WS_METHODS.serverCommitDesktopUpdate]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverCommitDesktopUpdate,
            serverUpdate.commitDesktopUpdate(input.requestId),
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
        [WS_METHODS.serverRefreshUsageRates]: (_input) =>
          observeRpcEffect(WS_METHODS.serverRefreshUsageRates, usage.refreshRates, {
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
        [WS_METHODS.pullRequestsSummary]: (input) =>
          observeRpcEffect(WS_METHODS.pullRequestsSummary, pullRequests.summary(input), {
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
        [WS_METHODS.pullRequestsLabelCandidates]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsLabelCandidates,
            pullRequests.labelCandidates(input),
            { "rpc.aggregate": "pull-requests" },
          ),
        [WS_METHODS.pullRequestsSetLabels]: (input) =>
          observeRpcEffect(WS_METHODS.pullRequestsSetLabels, pullRequests.setLabels(input), {
            "rpc.aggregate": "pull-requests",
          }),
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
              if (
                input.resource._tag === "attachment" ||
                input.resource._tag === "native-app-icon"
              ) {
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
              Effect.gen(function* () {
                // The session row carries the local branch checked out when the
                // action begins. PR head labels can be remote-qualified, and a
                // feature-branch action updates the session row asynchronously.
                const sessionBranch =
                  input.action === "create_pr" || input.action === "commit_push_pr"
                    ? (yield* gitWorkflow.localStatus({ cwd: input.cwd })).refName
                    : null;
                const repositorySnapshot = yield* repositoryStore.getSnapshot.pipe(Effect.orDie);
                yield* gitWorkflow
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
                          lineRuntimeStore,
                          legacySessionStore,
                          result,
                          sessionBranch,
                          input.cwd,
                          projectionSnapshotQuery.getThreadShellById,
                          repositorySnapshot.repositories,
                        ).pipe(
                          Effect.ignore({ log: true }),
                          Effect.andThen(refreshGitStatus(input.cwd)),
                          Effect.andThen(Queue.end(queue).pipe(Effect.asVoid)),
                        ),
                    }),
                  );
              }),
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
          observeRpcEffect(
            WS_METHODS.terminalOpen,
            Effect.gen(function* () {
              const claimed = yield* retainTerminalSlot(input).pipe(
                Effect.mapError((cause) => new TerminalCwdStatError({ cwd: input.cwd, cause })),
              );
              return yield* terminalManager
                .open(
                  Option.match(claimed, {
                    onNone: () => input,
                    onSome: ({ worktreePath }) => ({
                      ...input,
                      cwd: worktreePath,
                      worktreePath,
                    }),
                  }),
                )
                .pipe(
                  Effect.tapError(() =>
                    Option.match(claimed, {
                      onNone: () => Effect.void,
                      onSome: ({ slotId }) =>
                        slotService
                          .release(slotId, {
                            kind: "terminal",
                            threadId: input.threadId,
                            terminalId: input.terminalId,
                          })
                          .pipe(Effect.ignoreCause({ log: true })),
                    }),
                  ),
                );
            }),
            {
              "rpc.aggregate": "terminal",
            },
          ),
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
          observeRpcEffect(
            WS_METHODS.terminalClose,
            terminalManager.close(input).pipe(
              Effect.tap(() =>
                releaseTerminalSlots({
                  threadId: input.threadId,
                  ...(input.terminalId === undefined ? {} : { terminalId: input.terminalId }),
                }).pipe(Effect.ignoreCause({ log: true })),
              ),
            ),
            {
              "rpc.aggregate": "terminal",
            },
          ),
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
          observeRpcEffect(
            WS_METHODS.previewOpen,
            previewManager
              .open(input)
              .pipe(
                Effect.tap((snapshot) =>
                  retainPreviewSlot(input.threadId, snapshot.tabId).pipe(
                    Effect.ignoreCause({ log: true }),
                  ),
                ),
              ),
            {
              "rpc.aggregate": "preview",
            },
          ),
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
          observeRpcEffect(
            WS_METHODS.previewClose,
            previewManager.close(input).pipe(
              Effect.tap(() =>
                releasePreviewSlots({
                  threadId: input.threadId,
                  ...(input.tabId === undefined ? {} : { previewId: input.tabId }),
                }).pipe(Effect.ignoreCause({ log: true })),
              ),
            ),
            {
              "rpc.aggregate": "preview",
            },
          ),
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
        [WS_METHODS.subscribeServerConfig]: (input) =>
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
              // The only source of published themes: the stream emits the
              // current set before any change, so the snapshot carrying it too
              // would just send every client the same array twice per connect.
              // Gated on the subscriber's capability flag because an
              // already-shipped client decodes this stream against the old
              // event union and its whole config subscription dies on an
              // unknown member.
              const environmentThemeUpdates =
                input.environmentThemes === true
                  ? environmentTheme.streamChanges.pipe(
                      Stream.map((themes) => ({
                        version: 1 as const,
                        type: "environmentThemesUpdated" as const,
                        payload: { themes },
                      })),
                    )
                  : Stream.empty;
              // Same gate as themes: an older client dies on an unknown event.
              const usageLimitSourceUpdates =
                input.usageLimitSources === true
                  ? usageLimitSources.streamChanges.pipe(
                      Stream.map((sources) => ({
                        version: 1 as const,
                        type: "usageLimitSourcesUpdated" as const,
                        payload: { sources },
                      })),
                    )
                  : Stream.empty;
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
                Stream.merge(
                  providerStatuses,
                  Stream.merge(
                    settingsUpdates,
                    Stream.merge(environmentThemeUpdates, usageLimitSourceUpdates),
                  ),
                ),
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
    const baseServerSelfUpdate = yield* ServerSelfUpdate.ServerSelfUpdate;
    const config = yield* ServerConfig.ServerConfig;
    const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;
    const serverSelfUpdate = yield* ServerSelfUpdate.withRunningThreadContinuation({
      mode: config.mode,
      selfUpdate: baseServerSelfUpdate,
      prepare: startup.markRunningProviderSessionsForContinuation.pipe(
        Effect.mapError(
          (cause) =>
            new ServerSelfUpdateError({
              reason: "Could not prepare running threads to continue after the update.",
              cause,
            }),
        ),
      ),
      clear: (threadIds) =>
        startup.clearProviderSessionContinuationMarkers(threadIds).pipe(
          Effect.mapError(
            (cause) =>
              new ServerSelfUpdateError({
                reason: "Could not clear thread continuation markers after the update failed.",
                cause,
              }),
          ),
        ),
    });
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
            failEnvironmentAuthInvalid(
              EnvironmentAuth.serverAuthCredentialReason(error),
              EnvironmentAuth.serverAuthDpopFailureReason(error),
            ),
          ),
          Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
            failEnvironmentInternal("internal_error", error),
          ),
        );
        const clientOrigin = readClientConnectionOrigin(request);
        const clientAnalyticsProps = readClientAnalyticsProps(request);
        yield* sessions.recordClientConnection(session.sessionId, clientOrigin);
        yield* analytics.record("client.connected", clientAnalyticsProps);
        const rpcWebSocketHttpEffect = yield* RpcServer.toHttpEffectWebsocket(WsRpcGroup, {
          disableTracing: true,
        }).pipe(
          Effect.provide(
            makeWsRpcLayer(
              session,
              clientOrigin,
              clientAnalyticsProps,
              previewAutomationBroker,
            ).pipe(
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
