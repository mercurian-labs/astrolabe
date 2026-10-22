import { EnvironmentId } from "@t3tools/contracts";
import { CHANGE_GROUP_STATE_LABELS, type ChangeGroupMember } from "@t3tools/shared/changeGroups";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { Pressable, ScrollView, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import { appAtomRegistry } from "../../state/atom-registry";
import { changeGroupEnvironment, useChangeGroups } from "../../state/changeGroups";
import { useThreadShells } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";
import { changeGroupColorClass, changeGroupReasonLabel } from "./changeGroupPresentation";

type Props = StaticScreenProps<{ readonly environmentId: string; readonly groupId: string }>;

/**
 * Astrolabe: a change group on the phone: its state, Merge with the code, and its members by
 * side with why each is there; a tap opens a member's own screen, where it is reviewed and
 * merged. Taking a member out is one tap. Adding members and asking agents stay on web for now.
 */
export function ChangeGroupRouteScreen(props: Props) {
  const navigation = useNavigation();
  const environmentId = EnvironmentId.make(props.route.params.environmentId);
  const group = useChangeGroups().find(
    (candidate) =>
      candidate.environmentId === environmentId && candidate.groupId === props.route.params.groupId,
  );
  const threads = useThreadShells();
  const update = useAtomCommand(changeGroupEnvironment.update);
  const decide = async (change: Parameters<typeof update>[0]["input"]["change"]) => {
    if (!group) return;
    await update({ environmentId, input: { groupId: group.groupId, change } });
    appAtomRegistry.refresh(changeGroupEnvironment.decisions({ environmentId, input: {} }));
  };
  if (!group) {
    return (
      <View className="flex-1 items-center justify-center bg-screen px-8">
        <Text className="text-center text-sm text-foreground-muted">
          This group has fewer than two change requests now.
        </Text>
      </View>
    );
  }
  const sides = [
    { label: "Code", members: group.members.filter((member) => member.side === "code") },
    { label: "Documentation", members: group.members.filter((member) => member.side === "docs") },
  ];
  const openMember = (member: ChangeGroupMember) => {
    const { ref } = member;
    if (ref.kind === "wiki-change-request") {
      navigation.dispatch(
        StackActions.push("WikiChangeRequest", {
          environmentId: String(environmentId),
          wikiId: String(ref.wikiId),
          changeRequestId: String(ref.changeRequestId),
        }),
      );
      return;
    }
    const thread = threads.find(
      (candidate) => candidate.environmentId === environmentId && candidate.id === member.threadId,
    );
    if (!thread) return;
    navigation.dispatch(
      StackActions.push("PullRequest", {
        environmentId: String(environmentId),
        projectId: String(thread.projectId),
        repository: ref.repository,
        number: ref.number,
        host: ref.host,
      }),
    );
  };

  return (
    <ScrollView className="flex-1 bg-screen" contentInsetAdjustmentBehavior="automatic">
      <View className="gap-4 px-4 py-4">
        <View className="flex-row items-center gap-2">
          <View
            className={`size-3 rounded-full ${changeGroupColorClass(group.environmentId, group.groupId)}`}
          />
          <Text className="flex-1 text-lg font-t3-semibold text-foreground">{group.title}</Text>
          <Text className="text-sm text-foreground-muted">
            {CHANGE_GROUP_STATE_LABELS[group.state]}
          </Text>
        </View>
        <View className="flex-row items-center gap-3 rounded-xl bg-subtle px-3 py-3">
          <View className="flex-1">
            <Text className="text-[15px] font-t3-medium text-foreground">Merge with the code</Text>
            <Text className="text-xs text-foreground-muted">
              The documentation merges the moment the code has.
            </Text>
          </View>
          <ThemedSwitch
            accessibilityLabel="Merge with the code"
            value={group.armed}
            onValueChange={(armed) => void decide({ type: "arm", armed })}
          />
        </View>
        {sides.map((side) =>
          side.members.length === 0 ? null : (
            <View key={side.label} className="gap-1">
              <Text className="text-xs font-t3-medium text-foreground-muted">{side.label}</Text>
              {side.members.map((member) => (
                <MemberRow
                  key={member.key}
                  member={member}
                  onOpen={() => openMember(member)}
                  onRemove={() => void decide({ type: "remove", memberKey: member.key })}
                />
              ))}
            </View>
          ),
        )}
      </View>
    </ScrollView>
  );
}

function MemberRow(props: {
  readonly member: ChangeGroupMember;
  readonly onOpen: () => void;
  readonly onRemove: () => void;
}) {
  const { member } = props;
  return (
    <View className="flex-row items-center gap-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={member.title}
        onPress={props.onOpen}
        className="flex-1 flex-row items-center gap-3 py-2 active:opacity-60"
      >
        <SymbolView
          name={member.side === "code" ? PullRequestGlyph.pullRequest : "book"}
          size={16}
          tintColorClassName="accent-icon"
        />
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] text-foreground" numberOfLines={2}>
            {member.ref.kind === "pull-request"
              ? `#${member.ref.number} ${member.title}`
              : member.title}
          </Text>
          <Text className="text-xs text-foreground-muted" numberOfLines={2}>
            {`${member.place} · ${changeGroupReasonLabel(member)}`}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Take ${member.title} out of the group`}
        onPress={props.onRemove}
        className="p-2 active:opacity-60"
      >
        <SymbolView name="xmark" size={13} tintColorClassName="accent-icon" />
      </Pressable>
    </View>
  );
}
