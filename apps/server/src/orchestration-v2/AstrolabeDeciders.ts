import { canvasFileName, canvasNameKey, canvasUniqueTitle } from "@mercurian/wiki/canvas";
import { applyCanvasHandEdits } from "@mercurian/wiki/canvas-edits";
import {
  CANVAS_SHOW_TOOL_NAME,
  type OrchestrationV2Command,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2InternalCommand,
  type OrchestrationV2ProviderTurn,
  type OrchestrationV2Run,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
  THREAD_EDITED_FILES_MAX,
} from "@t3tools/contracts";
import { resolveT3McpToolId } from "@t3tools/shared/t3McpToolPresentation";
import { toolArguments } from "@t3tools/shared/toolOutput";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import type { PendingOrchestrationEffectV2 } from "./EffectOutbox.ts";
import { isCheckoutRelativePath } from "./EditedFilesNote.ts";
import type { OrchestratorDispatchError, OrchestratorProjectionError } from "./Orchestrator.ts";
import type { ProjectionStoreV2Shape } from "./ProjectionStore.ts";

/**
 * Astrolabe's commands (agent boards and the thread's edited files), decided here so
 * `Orchestrator.ts` keeps one delegating line per command for upstream syncs.
 */
export interface AstrolabeDeciderDeps {
  readonly projectionStore: ProjectionStoreV2Shape;
  readonly emit: (
    events: Ref.Ref<Array<OrchestrationV2DomainEvent>>,
    command: OrchestrationV2ServerCommand,
  ) => <Event extends OrchestrationV2DomainEvent>(
    event: Omit<Event, "id">,
  ) => Effect.Effect<Event, OrchestratorDispatchError>;
  readonly nextTurnItemOrdinal: (
    projection: Pick<OrchestrationV2ThreadProjection, "thread"> &
      Partial<Pick<OrchestrationV2ThreadProjection, "turnItems">>,
  ) => Effect.Effect<number, OrchestratorProjectionError>;
  readonly providerTurnForRun: (
    projection: Pick<OrchestrationV2ThreadProjection, "providerTurns" | "attempts">,
    run: OrchestrationV2Run,
  ) => OrchestrationV2ProviderTurn | undefined;
  readonly OrchestratorDispatchError: typeof OrchestratorDispatchError;
  readonly OrchestratorProjectionError: typeof OrchestratorProjectionError;
}

export const makeAstrolabeDeciders = (deps: AstrolabeDeciderDeps) => {
  const {
    projectionStore,
    emit,
    nextTurnItemOrdinal,
    providerTurnForRun,
    OrchestratorDispatchError,
    OrchestratorProjectionError,
  } = deps;

  /** Records a board an agent drew, laid out once so it never moves after. */
  const dispatchCanvasRecord = Effect.fn("orchestrationV2.dispatch.canvasRecord")(function* (
    command: Extract<OrchestrationV2InternalCommand, { readonly type: "canvas.record" }>,
    events: Ref.Ref<Array<OrchestrationV2DomainEvent>>,
  ) {
    const projection = yield* projectionStore
      .getThreadRecords(
        command.threadId,
        ["runs", "nodes", "turnItems", "attempts", "providerTurns"],
        { turnItemTypes: ["canvas", "dynamic_tool"], messageRoles: [] },
      )
      .pipe(
        Effect.mapError(
          (cause) => new OrchestratorProjectionError({ threadId: command.threadId, cause }),
        ),
      );
    const run = projection.runs.find((candidate) => candidate.id === command.runId);
    if (run === undefined || run.rootNodeId !== command.nodeId) {
      return yield* new OrchestratorDispatchError({
        commandId: command.commandId,
        commandType: command.type,
        cause: `Node ${command.nodeId} is not the root of run ${command.runId}.`,
      });
    }
    const canvases = projection.turnItems.filter(
      (item): item is Extract<OrchestrationV2TurnItem, { readonly type: "canvas" }> =>
        item.type === "canvas",
    );
    const byId = projection.turnItems.find((item) => item.id === command.turnItemId);
    if (byId !== undefined && byId.type !== "canvas") {
      return yield* new OrchestratorDispatchError({
        commandId: command.commandId,
        commandType: command.type,
        cause: `Turn item ${command.turnItemId} is not a canvas.`,
      });
    }
    const now = yield* DateTime.now;
    // A board is recorded once on retries unless `replace: true` asks to overwrite that item.
    if (byId !== undefined && command.replace !== true) {
      yield* emit(
        events,
        command,
      )({
        type: "turn-item.updated",
        threadId: command.threadId,
        ...(byId.runId === null ? {} : { runId: byId.runId }),
        ...(byId.nodeId === null ? {} : { nodeId: byId.nodeId }),
        providerInstanceId: run.providerInstanceId,
        occurredAt: now,
        payload: byId,
      });
      return;
    }

    let target: Extract<OrchestrationV2TurnItem, { readonly type: "canvas" }> | undefined = byId;
    if (target === undefined) {
      if (command.update !== undefined) {
        const updateTarget = command.update;
        const wantedKey = canvasNameKey(updateTarget);
        target = canvases.findLast(
          (item) =>
            item.id === updateTarget ||
            (item.title !== null &&
              (canvasNameKey(canvasFileName(item.title)) === wantedKey ||
                canvasNameKey(item.title) === wantedKey)),
        );
        if (target === undefined) {
          const available = canvases
            .flatMap((item) => (item.title === null ? [] : [canvasFileName(item.title)]))
            .join(", ");
          return yield* new OrchestratorDispatchError({
            commandId: command.commandId,
            commandType: command.type,
            cause:
              available.length > 0
                ? `No canvas named "${updateTarget}" exists in this thread. Existing canvases: ${available}.`
                : `No canvas named "${updateTarget}" exists in this thread yet. Leave out \`update\` to draw a new board.`,
          });
        }
      } else {
        // Across turns, reusing an earlier unedited board's exact title updates that board in
        // place instead of forking "Title 2.canvas". Hand-edited boards require explicit `update`
        // so user edits are never clobbered silently; within one turn, duplicate titles stay distinct.
        const wantedKey = canvasNameKey(canvasFileName(command.title));
        target = canvases.findLast(
          (item) =>
            item.runId !== command.runId &&
            item.editedAt === undefined &&
            item.title !== null &&
            canvasNameKey(canvasFileName(item.title)) === wantedKey,
        );
      }
    }

    const claimedToolIds = new Set(canvases.flatMap((item) => item.sourceToolItemIds ?? []));
    const activeCanvasTools = projection.turnItems.filter(
      (item): item is Extract<OrchestrationV2TurnItem, { readonly type: "dynamic_tool" }> =>
        item.type === "dynamic_tool" &&
        item.runId === command.runId &&
        (item.status === "running" || item.status === "pending" || item.status === "waiting") &&
        resolveT3McpToolId(item.toolName) === CANVAS_SHOW_TOOL_NAME &&
        !claimedToolIds.has(item.id),
    );
    const wantedInputTitleKey = canvasNameKey(command.title);
    const wantedUpdateKey =
      command.update === undefined ? undefined : canvasNameKey(command.update);
    const matchedTool =
      activeCanvasTools.findLast((item) => {
        const args = toolArguments(item.input);
        if (args === null || typeof args !== "object") return false;
        const rawTitle = "title" in args && typeof args.title === "string" ? args.title : undefined;
        const rawUpdate =
          "update" in args && typeof args.update === "string" ? args.update : undefined;
        if (wantedUpdateKey !== undefined) {
          return rawUpdate !== undefined && canvasNameKey(rawUpdate) === wantedUpdateKey;
        }
        return (
          rawUpdate === undefined &&
          rawTitle !== undefined &&
          canvasNameKey(rawTitle) === wantedInputTitleKey
        );
      }) ??
      (activeCanvasTools.length === 1 &&
      (() => {
        const args = toolArguments(activeCanvasTools[0]!.input);
        if (args === null || typeof args !== "object") return true;
        const hasTitle = "title" in args && typeof args.title === "string";
        const hasUpdate = "update" in args && typeof args.update === "string";
        return !hasTitle && !hasUpdate;
      })()
        ? activeCanvasTools[0]
        : undefined);
    const sourceToolItemIds = Array.from(
      new Set([
        ...(target?.sourceToolItemIds ?? []),
        ...(matchedTool === undefined ? [] : [matchedTool.id]),
      ]),
    );

    const payload: Extract<OrchestrationV2TurnItem, { readonly type: "canvas" }> =
      target !== undefined
        ? (() => {
            const {
              editedAt: _editedAt,
              code: _code,
              sourceToolItemIds: _sourceToolItemIds,
              ...kept
            } = target;
            return {
              ...kept,
              runId: command.runId,
              nodeId: command.nodeId,
              providerThreadId: run.providerThreadId,
              providerTurnId: providerTurnForRun(projection, run)?.id ?? null,
              // Keeping the existing title preserves every earlier embed (`![[File.canvas]]`).
              title: target.title ?? command.title,
              document: command.document,
              updatedAt: now,
              ...(command.code === undefined ? {} : { code: command.code }),
              ...(sourceToolItemIds.length === 0 ? {} : { sourceToolItemIds }),
            };
          })()
        : {
            id: command.turnItemId,
            threadId: command.threadId,
            runId: command.runId,
            nodeId: command.nodeId,
            providerThreadId: run.providerThreadId,
            providerTurnId: providerTurnForRun(projection, run)?.id ?? null,
            nativeItemRef: null,
            parentItemId: null,
            ordinal: yield* nextTurnItemOrdinal(projection),
            status: "completed",
            // File names come from titles and replies embed by them: keep them unique in the thread.
            title: canvasUniqueTitle(
              command.title,
              canvases.flatMap((item) => (item.title !== null ? [item.title] : [])),
            ),
            startedAt: now,
            completedAt: now,
            updatedAt: now,
            type: "canvas",
            document: command.document,
            ...(command.code === undefined ? {} : { code: command.code }),
            ...(sourceToolItemIds.length === 0 ? {} : { sourceToolItemIds }),
          };

    const nextPayload =
      target !== undefined && target.runId !== command.runId
        ? { ...payload, ordinal: yield* nextTurnItemOrdinal(projection) }
        : payload;

    yield* emit(
      events,
      command,
    )({
      type: "turn-item.updated",
      threadId: command.threadId,
      runId: command.runId,
      nodeId: command.nodeId,
      providerInstanceId: run.providerInstanceId,
      occurredAt: now,
      payload: nextPayload,
    });
  });

  /**
   * The file moves to the front of the thread's edited files, at this edit; then a check drops it
   * if the edits net out to nothing.
   */
  const dispatchThreadFileEdit = Effect.fn("orchestrationV2.dispatch.threadFileEdit")(function* (
    command: Extract<OrchestrationV2Command, { readonly type: "thread.file-edit.record" }>,
    events: Ref.Ref<Array<OrchestrationV2DomainEvent>>,
    effects: Ref.Ref<Array<PendingOrchestrationEffectV2>>,
  ) {
    const thread = yield* projectionStore
      .getThread(command.threadId)
      .pipe(
        Effect.mapError(
          (cause) => new OrchestratorProjectionError({ threadId: command.threadId, cause }),
        ),
      );
    if (thread.deletedAt !== null || !isCheckoutRelativePath(command.path)) {
      return yield* new OrchestratorDispatchError({
        commandId: command.commandId,
        commandType: command.type,
        cause:
          thread.deletedAt !== null
            ? `Thread ${command.threadId} is deleted.`
            : `${command.path} is not a path in the thread's checkout.`,
      });
    }
    const occurredAt = yield* DateTime.now;
    const others = (thread.editedFiles ?? []).filter((file) => file.path !== command.path);
    yield* emit(
      events,
      command,
    )({
      type: "thread.file-edited",
      threadId: command.threadId,
      providerInstanceId: thread.providerInstanceId,
      occurredAt,
      payload: {
        ...thread,
        editedFiles: [{ path: command.path, editedAt: occurredAt }, ...others].slice(
          0,
          THREAD_EDITED_FILES_MAX,
        ),
      },
    });
    yield* Ref.update(effects, (existing) => [
      ...existing,
      {
        id: `effect:${command.commandId}:thread.file-edit.check`,
        commandId: command.commandId,
        threadId: command.threadId,
        request: { type: "thread.file-edit.check", path: command.path, editedAt: occurredAt },
      } satisfies PendingOrchestrationEffectV2,
    ]);
  });

  /** Drops the file's edit, unless a newer edit replaced the one the check compared. */
  const dispatchThreadFileEditClear = Effect.fn("orchestrationV2.dispatch.threadFileEditClear")(
    function* (
      command: Extract<OrchestrationV2InternalCommand, { readonly type: "thread.file-edit.clear" }>,
      events: Ref.Ref<Array<OrchestrationV2DomainEvent>>,
    ) {
      const thread = yield* projectionStore
        .getThread(command.threadId)
        .pipe(
          Effect.mapError(
            (cause) => new OrchestratorProjectionError({ threadId: command.threadId, cause }),
          ),
        );
      const editedFiles = thread.editedFiles ?? [];
      const edit = editedFiles.find((file) => file.path === command.path);
      if (
        thread.deletedAt !== null ||
        edit === undefined ||
        !DateTime.Equivalence(edit.editedAt, command.editedAt)
      ) {
        return;
      }
      yield* emit(
        events,
        command,
      )({
        type: "thread.file-edit-cleared",
        threadId: command.threadId,
        providerInstanceId: thread.providerInstanceId,
        occurredAt: yield* DateTime.now,
        payload: { ...thread, editedFiles: editedFiles.filter((file) => file !== edit) },
      });
    },
  );

  /** The user's edits, replayed on the board as it is now, so a save sent twice lands once. */
  const dispatchCanvasEdit = Effect.fn("orchestrationV2.dispatch.canvasEdit")(function* (
    command: Extract<OrchestrationV2Command, { readonly type: "canvas.edit" }>,
    events: Ref.Ref<Array<OrchestrationV2DomainEvent>>,
  ) {
    const projection = yield* projectionStore
      .getThreadRecords(command.threadId, ["runs", "turnItems"], {
        turnItemTypes: ["canvas"],
        messageRoles: [],
      })
      .pipe(
        Effect.mapError(
          (cause) => new OrchestratorProjectionError({ threadId: command.threadId, cause }),
        ),
      );
    const fail = (cause: string) =>
      new OrchestratorDispatchError({
        commandId: command.commandId,
        commandType: command.type,
        cause,
      });
    const item = projection.turnItems.find((candidate) => candidate.id === command.turnItemId);
    if (item === undefined || item.type !== "canvas") {
      return yield* fail(`Turn item ${command.turnItemId} is not a canvas.`);
    }
    const run = projection.runs.find((candidate) => candidate.id === item.runId);
    if (run === undefined || item.runId === null || item.nodeId === null) {
      return yield* fail(`The run that drew ${command.turnItemId} was not found.`);
    }
    const document = yield* Effect.try({
      try: () => applyCanvasHandEdits(item.document, command.edits).document,
      catch: (cause) => fail(cause instanceof Error ? cause.message : String(cause)),
    });
    const now = yield* DateTime.now;
    yield* emit(
      events,
      command,
    )({
      type: "turn-item.updated",
      threadId: command.threadId,
      runId: item.runId,
      nodeId: item.nodeId,
      providerInstanceId: run.providerInstanceId,
      occurredAt: now,
      payload: { ...item, document, updatedAt: now, editedAt: now },
    });
  });
  return {
    dispatchCanvasRecord,
    dispatchCanvasEdit,
    dispatchThreadFileEdit,
    dispatchThreadFileEditClear,
  };
};
