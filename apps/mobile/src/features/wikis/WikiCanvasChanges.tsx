import {
  canvasChangeSections,
  canvasChangeSummary,
  CANVAS_MARK_LABELS,
  type CanvasMark,
  type CanvasReview,
} from "@mercurian/wiki/canvas";
import { useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";

type Change = CanvasReview["changes"][number];

const MARK_TONE: Readonly<Record<CanvasMark, string>> = {
  added: "text-link",
  removed: "text-danger-foreground",
  text: "text-warning-foreground",
  restyled: "text-foreground",
  moved: "text-foreground-muted",
};

const FOLD = "moved" as const;

function ChangeRow({
  change,
  onPick,
}: {
  readonly change: Change;
  readonly onPick: (id: string) => void;
}) {
  const also = change.also.map((mark) => CANVAS_MARK_LABELS[mark]).join(", ");
  const detail = [
    change.was === null ? null : `Was: ${change.was}`,
    also === "" ? null : `Also: ${also}`,
    change.drawn ? null : "Not on the board",
  ].filter(Boolean);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${CANVAS_MARK_LABELS[change.mark]}: ${change.name}`}
      disabled={!change.drawn}
      onPress={() => onPick(change.id)}
      className="gap-0.5 border-t border-border-subtle px-4 py-2 active:opacity-70"
    >
      <View className="flex-row items-baseline gap-2">
        <Text className={`text-sm font-t3-medium ${MARK_TONE[change.mark]}`}>
          {CANVAS_MARK_LABELS[change.mark]}
        </Text>
        <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
          {change.name}
        </Text>
      </View>
      {detail.length > 0 ? (
        <Text className="text-xs text-foreground-muted" numberOfLines={1}>
          {detail.join(" · ")}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** A canvas's change list under its board: picking a row brings the card into view. */
export function WikiCanvasChanges({
  review,
  onPick,
}: {
  readonly review: CanvasReview;
  readonly onPick: (id: string) => void;
}) {
  const [movesOpen, setMovesOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const { changed, moved } = canvasChangeSections(review.changes);
  const rows: ReadonlyArray<Change | typeof FOLD> = [
    ...changed,
    ...(moved.length > 0 ? ([FOLD] as const) : []),
    ...(movesOpen ? moved : []),
  ];
  return (
    <View className="bg-screen" style={{ maxHeight: "40%" }}>
      <FlatList
        data={rows}
        contentContainerStyle={{ paddingBottom: insets.bottom }}
        keyExtractor={(row) => (row === FOLD ? FOLD : `${row.item}:${row.id}`)}
        ListHeaderComponent={
          <Text className="px-4 py-2 text-xs font-t3-medium text-foreground-muted">
            {canvasChangeSummary(review.changes)}
          </Text>
        }
        ListFooterComponent={
          review.rest ? (
            <Text className="border-t border-border-subtle px-4 py-2 text-xs text-foreground-muted">
              Data outside the cards and arrows changed too. Open it on a computer to see the JSON.
            </Text>
          ) : undefined
        }
        renderItem={({ item }) =>
          item === FOLD ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: movesOpen }}
              onPress={() => setMovesOpen(!movesOpen)}
              className="border-t border-border-subtle px-4 py-2 active:opacity-70"
            >
              <Text className="text-sm text-foreground-muted">
                {`${movesOpen ? "Hide" : "Show"} ${moved.length} moved or resized`}
              </Text>
            </Pressable>
          ) : (
            <ChangeRow change={item} onPick={onPick} />
          )
        }
      />
    </View>
  );
}
