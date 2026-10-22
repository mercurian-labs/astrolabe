import { useNavigation } from "@react-navigation/native";
import { CHANGE_GROUP_STATE_LABELS } from "@t3tools/shared/changeGroups";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { useChangeGroups } from "../../state/changeGroups";
import { ThreadListV2SectionDivider } from "../threads/thread-list-v2-items";
import { changeGroupColorClass } from "./changeGroupPresentation";

/**
 * Astrolabe: the change groups at the top of the Change requests tab, as web's list leads with
 * them: each a card with its colour, state and members; a tap opens the group. The tab's search
 * narrows them by title. Nothing without any.
 */
export function ChangeGroupsSection({ query }: { readonly query: string }) {
  const navigation = useNavigation();
  const needle = query.trim().toLowerCase();
  const groups = useChangeGroups().filter(
    (group) =>
      group.state !== "merged" &&
      (needle === "" ||
        group.title.toLowerCase().includes(needle) ||
        group.members.some((member) => member.title.toLowerCase().includes(needle))),
  );
  if (groups.length === 0) return null;
  return (
    <View accessibilityLabel="Change groups">
      <ThreadListV2SectionDivider label={`Groups · ${groups.length}`} />
      {groups.map((group) => (
        <Pressable
          key={`${group.environmentId}:${group.groupId}`}
          accessibilityRole="button"
          accessibilityLabel={`${group.title}, change group, ${CHANGE_GROUP_STATE_LABELS[group.state]}`}
          onPress={() =>
            navigation.navigate("ChangeGroup", {
              environmentId: String(group.environmentId),
              groupId: group.groupId,
            })
          }
          className="gap-1 px-4 py-3 active:opacity-60"
        >
          <View className="flex-row items-center gap-2">
            <View
              className={`size-2.5 rounded-full ${changeGroupColorClass(group.environmentId, group.groupId)}`}
            />
            <Text className="flex-1 text-[15px] font-t3-medium text-foreground" numberOfLines={1}>
              {group.title}
            </Text>
            <Text className="text-xs text-foreground-muted">
              {CHANGE_GROUP_STATE_LABELS[group.state]}
            </Text>
          </View>
          {group.members.map((member) => (
            <Text
              key={member.key}
              className="pl-4.5 text-xs text-foreground-muted"
              numberOfLines={1}
            >
              {member.ref.kind === "pull-request"
                ? `#${member.ref.number} ${member.title} · ${member.place}`
                : `${member.title} · ${member.place}`}
            </Text>
          ))}
        </Pressable>
      ))}
    </View>
  );
}
