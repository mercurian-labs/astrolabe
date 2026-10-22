import {
  changeGroupMemberRefOfKey,
  OrchestratorMcpFailure,
  type ChangeGroupChange,
  type ChangeGroupError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

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

const memberOf = (memberKey: string) =>
  Effect.gen(function* () {
    const member = changeGroupMemberRefOfKey(memberKey);
    if (member === null) {
      return yield* new OrchestratorMcpFailure({
        code: "invalid_request",
        message: `"${memberKey}" names no change request or thread; use a key t3_change_groups shows.`,
      });
    }
    return member;
  });

export const layer = McpToolAccess.toLayer(ChangeGroupToolkit, {
  t3_change_groups: McpToolAccess.reads(() =>
    ChangeGroupService.ChangeGroupService.pipe(
      Effect.flatMap((service) => service.groups),
      Effect.map((groups) => ({ groups })),
      Effect.mapError(failure),
    ),
  ),
  // Suggestions and edits come from a live thread's agent, as wiki amendments do.
  t3_change_group_suggest: McpToolAccess.actsAsCaller(({ groupId, memberKey, note }) =>
    memberOf(memberKey).pipe(
      Effect.flatMap((member) => update(groupId, { type: "suggest", member, note })),
    ),
  ),
  t3_change_group_update: McpToolAccess.actsAsCaller(({ groupId, action, memberKey, note }) =>
    action === "remove"
      ? update(groupId, { type: "remove", memberKey })
      : memberOf(memberKey).pipe(
          Effect.flatMap((member) =>
            update(groupId, { type: "add", member, reason: "manual", note: note ?? "" }),
          ),
        ),
  ),
});
