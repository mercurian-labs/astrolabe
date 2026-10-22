import { changeGroupColorIndex, type ChangeGroupMember } from "@t3tools/shared/changeGroups";

/** A group's colour, as web's tab label and card show it. */
const GROUP_COLORS = [
  "bg-sky-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-rose-500",
  "bg-teal-500",
] as const;

export const changeGroupColorClass = (environmentId: string, groupId: string) =>
  GROUP_COLORS[changeGroupColorIndex(`${environmentId}:${groupId}`)]!;

/** Why a member is in its group, in words, as web says it. */
export function changeGroupReasonLabel(member: Pick<ChangeGroupMember, "reason" | "note">): string {
  switch (member.reason) {
    case "same-thread":
      return "From its thread";
    case "coordinator":
      return "From the coordinator's work";
    case "lineage":
      return "From a fork of the thread";
    case "reference":
      return "Shares an issue key";
    case "manual":
      return "Added by hand";
    case "suggested":
      return member.note ? `Suggested: ${member.note}` : "Suggested";
  }
}
