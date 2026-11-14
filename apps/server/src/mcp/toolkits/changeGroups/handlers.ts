import {
  changeGroupMemberRefOfKey,
  OrchestratorMcpFailure,
  type ChangeGroupChange,
  type ChangeGroupError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { Tool } from "effect/ai";

import * as ChangeGroupService from "../../../changeGroups/ChangeGroupService.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { ChangeGroupToolkit } from "./tools.ts";

const failure = (error: ChangeGroupError) =>
  new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message });

const update = (groupId: string, change: ChangeGroupChange) =>
  ChangeGroupService.ChangeGroupService.pipe(
    Effect.flatMap((service) => service.update({ groupId, change })),
    Effect.mapError(failure),
  );

const memberOf = Effect.fn("ChangeGroupToolkit.memberOf")(function* (memberKey: string) {
  const member = changeGroupMemberRefOfKey(memberKey);
  if (member === null) {
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message: `"${memberKey}" names no pull request or thread; use a key astrolabe_change_groups shows.`,
    });
  }
  return member;
});

type ChangeGroupsResult = Tool.Success<
  (typeof ChangeGroupToolkit.tools)["astrolabe_change_groups"]
>;

const readGroup = Effect.fn("ChangeGroupToolkit.readGroup")(function* (
  groupId: string | null,
  memberKeys: ReadonlyArray<string>,
): Effect.fn.Return<
  ChangeGroupsResult,
  OrchestratorMcpFailure,
  ChangeGroupService.ChangeGroupService
> {
  const service = yield* ChangeGroupService.ChangeGroupService;
  const group = yield* service.group({ groupId, memberKeys }).pipe(Effect.mapError(failure));
  if (group === null) {
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message: `No change group ${groupId === null ? "" : `has the id "${groupId}" or `}holds those members now; call astrolabe_change_groups without arguments to list them.`,
    });
  }
  return { group };
});

export const layer = McpToolAccess.toLayer(ChangeGroupToolkit, {
  astrolabe_change_groups: McpToolAccess.reads(({ groupId, memberKeys }) =>
    groupId === undefined && memberKeys === undefined
      ? ChangeGroupService.ChangeGroupService.pipe(
          Effect.flatMap((service) => service.groups),
          Effect.map((groups): ChangeGroupsResult => ({ groups })),
          Effect.mapError(failure),
        )
      : readGroup(groupId ?? null, memberKeys ?? []),
  ),
  // Suggestions and edits come from a live thread's agent, as wiki amendments do.
  astrolabe_change_group_suggest: McpToolAccess.actsAsCaller(({ groupId, memberKey, note }) =>
    memberOf(memberKey.trim()).pipe(
      Effect.flatMap((member) =>
        update(groupId.trim(), { type: "suggest", member, note: note.trim() }),
      ),
    ),
  ),
  astrolabe_change_group_update: McpToolAccess.actsAsCaller(
    ({ groupId, action, memberKey, note }) =>
      action === "remove"
        ? update(groupId.trim(), { type: "remove", memberKey: memberKey.trim() })
        : memberOf(memberKey.trim()).pipe(
            Effect.flatMap((member) =>
              update(groupId.trim(), {
                type: "add",
                member,
                reason: "manual",
                note: note?.trim() ?? "",
              }),
            ),
          ),
  ),
});
