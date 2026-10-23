import { ScrollView } from "react-native";

import { ListFilterMenu } from "../workspace/ListFilterMenu";

/** The filter by wiki, as the thread list's filter by project: all wikis or one. */
export function WikiListFilters(props: {
  readonly choices: ReadonlyArray<{ readonly scope: string; readonly label: string }>;
  readonly scope: string | null;
  readonly onScopeChange: (scope: string | null) => void;
}) {
  const selected = props.choices.find((choice) => choice.scope === props.scope);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16, gap: 6, paddingBottom: 8 }}
    >
      <ListFilterMenu
        label={selected?.label ?? "All wikis"}
        accessibilityLabel="Filter by wiki"
        active={selected !== undefined}
        actions={[
          { id: "all", title: "All wikis", state: selected ? "off" : "on" },
          ...props.choices.map((choice) => ({
            id: JSON.stringify(choice.scope),
            title: choice.label,
            state: choice.scope === props.scope ? ("on" as const) : ("off" as const),
          })),
        ]}
        onSelect={(id) => {
          if (id === "all") props.onScopeChange(null);
          else {
            const choice = props.choices.find(
              (candidate) => JSON.stringify(candidate.scope) === id,
            );
            if (choice) props.onScopeChange(choice.scope);
          }
        }}
      />
    </ScrollView>
  );
}
