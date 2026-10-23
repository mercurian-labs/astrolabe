import type { ChangeGroupReason } from "@t3tools/contracts";
import type { ChangeGroupMember, ChangeGroupState } from "@t3tools/shared/changeGroups";

/** Why a member is in its group, in words. */
export function changeGroupReasonLabel(member: Pick<ChangeGroupMember, "reason" | "note">): string {
  const labels: Record<ChangeGroupReason, string> = {
    "same-thread": "From its thread",
    coordinator: "From the coordinator's work",
    lineage: "From a fork of the thread",
    reference: "Shares an issue key",
    manual: "Added by hand",
    suggested: "Suggested",
  };
  const label = labels[member.reason];
  return member.reason === "suggested" && member.note ? `${label}: ${member.note}` : label;
}

/** The group state's badge variant. */
export function changeGroupStateVariant(
  state: ChangeGroupState,
): "success" | "warning" | "info" | "secondary" {
  switch (state) {
    case "merged":
    case "in-sync":
      return "success";
    case "docs-behind":
    case "docs-missing":
      return "warning";
    case "waiting-on-code":
      return "info";
  }
}

/** A member's state, in words. */
export const CHANGE_GROUP_MEMBER_STATE_LABELS: Readonly<
  Record<ChangeGroupMember["state"], string>
> = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
};
