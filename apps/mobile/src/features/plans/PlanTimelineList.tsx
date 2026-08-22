import { KeyboardAwareLegendList } from "@legendapp/list/keyboard";
import { providerLabel } from "@t3tools/client-runtime/state/plan-composer";
import type {
  PlanCodingSessionRecord,
  PlanGroundingItem,
  PlanInFlightImplement,
  PlanInFlightTurn,
  PlanQuestion,
  PlanQuestionRecord,
  PlanTimelineItem,
  ServerProvider,
} from "@t3tools/contracts";
import { useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { ControlPill } from "../../components/ControlPill";
import { cn } from "../../lib/cn";
import { IMPLEMENT_ANALYZING_COPY } from "./mobileImplementCopy";
import { useThemeColor } from "../../lib/useThemeColor";
import { PlanMarkdown } from "./markdownStyles";
import { derivePlanTimelineRows, type PlanTimelineRow } from "./planTimelineRows";

export function PlanTimelineList(props: {
  readonly timeline: ReadonlyArray<PlanTimelineItem>;
  readonly visibleCommitIds: ReadonlySet<string>;
  readonly inFlightTurn?: PlanInFlightTurn | undefined;
  readonly inFlightImplement?: PlanInFlightImplement | undefined;
  readonly codingSessions: ReadonlyArray<PlanCodingSessionRecord>;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly onAnswerQuestion: (answers: Readonly<Record<string, unknown>>) => void;
  readonly onStop: () => void;
}) {
  const rows = useMemo(
    () =>
      derivePlanTimelineRows({
        timeline: props.timeline,
        visibleCommitIds: props.visibleCommitIds,
        inFlightTurn: props.inFlightTurn,
        inFlightImplement: props.inFlightImplement,
        codingSessions: props.codingSessions,
      }),
    [
      props.codingSessions,
      props.inFlightImplement,
      props.inFlightTurn,
      props.timeline,
      props.visibleCommitIds,
    ],
  );

  return (
    <KeyboardAwareLegendList
      style={{ flex: 1 }}
      data={rows}
      keyExtractor={(row) => row.key}
      renderItem={({ item }) => (
        <PlanTimelineRowView
          row={item}
          providers={props.providers}
          onAnswerQuestion={props.onAnswerQuestion}
          onStop={props.onStop}
        />
      )}
      getItemType={(row) => row.type}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="none"
      keyboardLiftBehavior="whenAtEnd"
      alignItemsAtEnd
      initialScrollAtEnd
      maintainScrollAtEnd
      estimatedItemSize={140}
      contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16 }}
      ListEmptyComponent={
        <View className="flex-1 items-center justify-center px-6 py-12">
          <Text className="text-center text-sm text-foreground-muted">
            Start the conversation below.
          </Text>
        </View>
      }
    />
  );
}

function PlanTimelineRowView(props: {
  readonly row: PlanTimelineRow;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly onAnswerQuestion: (answers: Readonly<Record<string, unknown>>) => void;
  readonly onStop: () => void;
}) {
  const row = props.row;
  if (row.type === "human-message") {
    return (
      <View className="mb-4 items-end">
        <View className="max-w-[82%] rounded-2xl bg-user-bubble px-3.5 py-3">
          <Text className="text-sm leading-5 text-user-bubble-foreground">{row.item.text}</Text>
        </View>
      </View>
    );
  }
  if (row.type === "effect") {
    return (
      <View className="mb-3 flex-row items-center gap-2 px-1">
        <View className="size-1.5 rounded-full bg-icon-subtle" />
        <Text className="text-xs text-foreground-muted">{row.label}</Text>
      </View>
    );
  }
  if (row.type === "coding-session") {
    return (
      <View className="mb-4 rounded-xl border border-border bg-subtle px-3 py-3">
        <Text className="text-sm font-t3-medium text-foreground">
          Coding session · {row.item.repositoryName}
        </Text>
        <Text className="mt-1 text-xs text-foreground-muted">
          {[row.status, row.record?.branch].filter(Boolean).join(" · ")}
        </Text>
      </View>
    );
  }
  if (row.type === "in-flight-implement") {
    return (
      <View className="mb-4 rounded-xl border border-border bg-subtle px-3 py-3">
        <View className="flex-row items-center gap-2">
          <ActivityIndicator size="small" />
          <Text className="min-w-0 flex-1 text-sm text-foreground-muted">
            {IMPLEMENT_ANALYZING_COPY}
          </Text>
          <ControlPill label="Stop" variant="danger" onPress={props.onStop} />
        </View>
        <GroundingFold items={row.implement.grounding} live />
      </View>
    );
  }
  if (row.type === "in-flight-turn") {
    return (
      <AssistantShell
        text={row.turn.text}
        grounding={row.turn.grounding}
        groundingScope={row.turn.groundingScope}
        live
      >
        {row.questionState === "awaiting" && row.turn.questions ? (
          <QuestionCard questions={row.turn.questions} onSubmit={props.onAnswerQuestion} />
        ) : null}
      </AssistantShell>
    );
  }
  return (
    <AssistantShell
      text={row.item.text}
      grounding={row.item.grounding ?? []}
      groundingScope={row.item.groundingScope}
    >
      {row.item.question ? <QuestionRecord record={row.item.question} /> : null}
      <View className="mt-2 flex-row flex-wrap items-center gap-2">
        {row.item.generatedBy ? (
          <Text className="text-xs text-foreground-muted">
            {modelAttribution(row.item.generatedBy, props.providers)}
          </Text>
        ) : null}
        {row.interrupted ? (
          <View className="rounded-md bg-amber-500/15 px-2 py-1">
            <Text className="text-xs font-t3-medium text-amber-700 dark:text-amber-300">
              Interrupted
            </Text>
          </View>
        ) : null}
      </View>
    </AssistantShell>
  );
}

function AssistantShell(props: {
  readonly text: string;
  readonly grounding: ReadonlyArray<PlanGroundingItem>;
  readonly groundingScope?: { readonly unreachableRepositories: ReadonlyArray<string> } | undefined;
  readonly live?: boolean;
  readonly children?: ReactNode;
}) {
  return (
    <View className="mb-5 min-w-0 px-1">
      <View className="mb-1 flex-row items-center gap-2">
        {props.live ? <ActivityIndicator size="small" /> : null}
        {props.live ? (
          <Text className="text-xs text-foreground-muted">
            {props.children ? "waiting on you" : "replying…"}
          </Text>
        ) : null}
      </View>
      {props.groundingScope ? (
        <Text className="mb-1 text-xs text-foreground-muted">
          Grounded without {props.groundingScope.unreachableRepositories.join(", ")} — out of reach
          for this provider.
        </Text>
      ) : null}
      <GroundingFold items={props.grounding} live={props.live} />
      {props.text.length > 0 ? <PlanMarkdown markdown={props.text} /> : null}
      {props.children}
    </View>
  );
}

function GroundingFold(props: {
  readonly items: ReadonlyArray<PlanGroundingItem>;
  readonly live?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const iconColor = useThemeColor("--color-icon-subtle");
  if (props.items.length === 0) return null;
  return (
    <View className="mb-2">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        className="flex-row items-center gap-1 py-1"
      >
        <SymbolView
          name={expanded ? "chevron.down" : "chevron.right"}
          size={11}
          tintColor={iconColor}
          type="monochrome"
        />
        <Text className="text-xs text-foreground-muted">
          Consulted {props.items.length} {props.items.length === 1 ? "item" : "items"}
          {props.live ? "…" : ""}
        </Text>
      </Pressable>
      {expanded ? (
        <View className="ml-2 border-l border-border pl-3">
          {props.items.map((item) => (
            <Text
              key={`${item.kind}:${item.label}:${item.detail ?? ""}`}
              className="py-0.5 text-xs text-foreground-muted"
            >
              {item.label}
              {item.detail ? ` · ${item.detail}` : ""}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function QuestionCard(props: {
  readonly questions: ReadonlyArray<PlanQuestion>;
  readonly onSubmit: (answers: Readonly<Record<string, unknown>>) => void;
}) {
  const [selections, setSelections] = useState<Record<string, ReadonlyArray<string>>>({});
  const complete = props.questions.every((question) => (selections[question.id]?.length ?? 0) > 0);
  return (
    <View className="mt-3 gap-3 rounded-xl border border-border bg-subtle p-3">
      {props.questions.map((question) => (
        <View key={question.id} className="gap-1.5">
          <Text className="text-xs font-t3-bold uppercase text-foreground-muted">
            {question.header}
          </Text>
          <Text className="text-sm text-foreground">{question.question}</Text>
          {question.options.map((option) => {
            const selected = selections[question.id]?.includes(option.label) ?? false;
            return (
              <Pressable
                key={option.label}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() =>
                  setSelections((current) => {
                    const chosen = current[question.id] ?? [];
                    return {
                      ...current,
                      [question.id]:
                        question.multiSelect === true
                          ? selected
                            ? chosen.filter((label) => label !== option.label)
                            : [...chosen, option.label]
                          : [option.label],
                    };
                  })
                }
                className={cn(
                  "rounded-lg border px-3 py-2.5",
                  selected ? "border-primary bg-subtle-strong" : "border-border bg-sheet",
                )}
              >
                <Text className="text-sm font-t3-medium text-foreground">{option.label}</Text>
                <Text className="text-xs text-foreground-muted">{option.description}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        disabled={!complete}
        onPress={() => {
          const answers: Record<string, unknown> = {};
          for (const question of props.questions) {
            const selected = selections[question.id] ?? [];
            answers[question.id] = question.multiSelect === true ? selected : selected[0];
          }
          props.onSubmit(answers);
        }}
        className={cn(
          "h-11 items-center justify-center rounded-full",
          complete ? "bg-primary" : "bg-subtle-strong",
        )}
      >
        <Text
          className={complete ? "font-t3-bold text-primary-foreground" : "text-foreground-muted"}
        >
          Answer
        </Text>
      </Pressable>
    </View>
  );
}

function QuestionRecord(props: { readonly record: PlanQuestionRecord }) {
  return (
    <View className="mt-3 gap-2 rounded-xl border border-border bg-subtle p-3">
      {props.record.questions.map((question) => {
        const answer = props.record.answers?.[question.id];
        const label = Array.isArray(answer)
          ? answer.join(", ")
          : typeof answer === "string"
            ? answer
            : "Not answered";
        return (
          <View key={question.id}>
            <Text className="text-xs text-foreground-muted">{question.question}</Text>
            <Text className="mt-0.5 text-sm font-t3-medium text-foreground">{label}</Text>
          </View>
        );
      })}
    </View>
  );
}

function modelAttribution(
  selection: { readonly provider: ServerProvider["driver"]; readonly model: string },
  providers: ReadonlyArray<ServerProvider>,
): string {
  const model = providers
    .flatMap((provider) => (provider.driver === selection.provider ? provider.models : []))
    .find((candidate) => candidate.slug === selection.model)?.name;
  return `${providerLabel(selection.provider)} · ${model ?? selection.model}`;
}
