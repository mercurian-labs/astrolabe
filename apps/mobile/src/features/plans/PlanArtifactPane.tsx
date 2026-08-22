import {
  snapshotTextIsForPath,
  lastPlanRevision,
} from "@t3tools/client-runtime/state/plan-artifact";
import type {
  EnvironmentId,
  MercurianCommitId,
  PlanId,
  PlanTimelineItem,
} from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { mercurianPlanning } from "../../state/mercurian";
import { useAtomCommand } from "../../state/use-atom-command";
import { PlanMarkdown } from "./markdownStyles";

export function PlanArtifactPane(props: {
  readonly environmentId: EnvironmentId;
  readonly planId: PlanId;
  readonly head: MercurianCommitId | null;
  readonly timeline: ReadonlyArray<PlanTimelineItem>;
  readonly visibleTimeline: ReadonlyArray<PlanTimelineItem>;
  readonly snapshotText: string;
}) {
  const getPlanTextAt = useAtomCommand(mercurianPlanning.getPlanTextAt, { reportFailure: false });
  const needsPathText =
    props.head !== null && !snapshotTextIsForPath(props.timeline, props.visibleTimeline);
  const [pathText, setPathText] = useState<string | null>(null);

  useEffect(() => {
    if (!needsPathText || props.head === null) {
      setPathText(null);
      return;
    }
    let cancelled = false;
    setPathText(null);
    void getPlanTextAt({
      environmentId: props.environmentId,
      input: { planId: props.planId, commitId: props.head },
    }).then((result) => {
      if (!cancelled && result._tag === "Success") setPathText(result.value.planText);
    });
    return () => {
      cancelled = true;
    };
  }, [getPlanTextAt, needsPathText, props.environmentId, props.head, props.planId]);

  const attribution = lastPlanRevision(props.visibleTimeline);
  const text = needsPathText ? pathText : props.snapshotText;
  return (
    <ScrollView
      className="flex-1 bg-sheet"
      contentContainerStyle={{ padding: 18 }}
      keyboardShouldPersistTaps="handled"
    >
      <View className="mx-auto w-full max-w-[760px]">
        <Text className="mb-3 text-xs text-foreground-muted">
          {attribution === null
            ? "No plan revision yet"
            : `Edited by ${attribution.authorKind === "human" ? "you" : "the assistant"} · ${relativeTime(attribution.createdAt)}`}
        </Text>
        {text === null ? (
          <Text className="text-sm text-foreground-muted">Reading the plan as of then…</Text>
        ) : text.length === 0 ? (
          <Text className="text-sm text-foreground-muted">This plan is blank.</Text>
        ) : (
          <PlanMarkdown markdown={text} />
        )}
      </View>
    </ScrollView>
  );
}

function relativeTime(createdAt: string): string {
  const elapsed = Date.now() - Date.parse(createdAt);
  if (!Number.isFinite(elapsed) || elapsed < 0) return "just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
