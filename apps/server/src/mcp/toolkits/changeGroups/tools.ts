import {
  ChangeGroupDecisions,
  ChangeGroupReason,
  OrchestratorMcpFailure,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ChangeGroupService from "../../../changeGroups/ChangeGroupService.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ChangeGroupService.ChangeGroupService,
  ],
};

const RULES =
  "A change group is the change requests in different projects that are one effort: a repository's pull requests and the wiki change requests documenting them. A thread's own change requests, a coordinator's children's, and a fork's join its group on their own; people add, take out, and accept suggestions on top. Each member is reviewed and merged in its own place.";

const groupId = TrimmedNonEmptyString.annotate({
  description: "The group's id, as t3_change_groups shows it: the thread the group started from.",
});
const memberKey = TrimmedNonEmptyString.annotate({
  description:
    "A change request's key, as t3_change_groups shows it: `pr:<host>/<owner>/<repo>#<number>` or `wiki:<wikiId>/<changeRequestId>`.",
});

export const ChangeGroupSummary = Schema.Struct({
  groupId: Schema.String,
  title: Schema.String,
  state: Schema.Literals(["in-sync", "docs-behind", "waiting-on-code", "docs-missing", "merged"]),
  armed: Schema.Boolean,
  threadIds: Schema.Array(Schema.String),
  members: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      side: Schema.Literals(["code", "docs"]),
      title: Schema.String,
      place: Schema.String,
      state: Schema.Literals(["open", "draft", "merged", "closed"]),
      reason: ChangeGroupReason,
      note: Schema.String,
      url: Schema.NullOr(Schema.String),
    }),
  ),
});

const ChangeGroupsTool = Tool.make("t3_change_groups", {
  ...shared,
  description: `List this environment's change groups: each group's members (code and documentation, with why each is there), its state, and whether its documentation merges with its code. ${RULES}`,
  success: Schema.Struct({ groups: Schema.Array(ChangeGroupSummary) }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const ChangeGroupSuggestTool = Tool.make("t3_change_group_suggest", {
  ...shared,
  description:
    "Suggest a change request for a group, with one sentence on why it is part of the same effort. A person accepts or dismisses it; a dismissed suggestion is not suggested again.",
  parameters: Schema.Struct({
    groupId,
    memberKey,
    note: TrimmedNonEmptyString.annotate({ description: "Why it belongs, in one sentence." }),
  }),
  success: ChangeGroupDecisions,
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false);

const ChangeGroupUpdateTool = Tool.make("t3_change_group_update", {
  ...shared,
  description:
    "Add a change request to a group, or take one out, as a coordinator builds its group on purpose. Prefer t3_change_group_suggest when the person should decide.",
  parameters: Schema.Struct({
    groupId,
    action: Schema.Literals(["add", "remove"]),
    memberKey,
    note: Schema.optional(Schema.String).annotate({ description: "Why, for an added member." }),
  }),
  success: ChangeGroupDecisions,
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false);

export const ChangeGroupToolkit = Toolkit.make(
  ChangeGroupsTool,
  ChangeGroupSuggestTool,
  ChangeGroupUpdateTool,
);
