import type { CatalogSectionId } from "../../design-system/catalog";

export type DesignLabNavEntry = Readonly<{
  id: string;
  section: CatalogSectionId;
  group?: string;
  title: string;
  description: string;
}>;

export type DesignLabNavSection = Readonly<{
  id: CatalogSectionId;
  title: string;
}>;

export type DesignLabNavGroup<Entry extends DesignLabNavEntry = DesignLabNavEntry> = Readonly<{
  group: string;
  entries: ReadonlyArray<Entry>;
}>;

export type DesignLabNavSectionGroup<Entry extends DesignLabNavEntry = DesignLabNavEntry> =
  Readonly<{
    section: DesignLabNavSection;
    groups: ReadonlyArray<DesignLabNavGroup<Entry>>;
  }>;

export type DesignLabExpandedSections = Readonly<Record<CatalogSectionId, boolean>>;

export type DesignLabExpandedSectionsAction =
  | Readonly<{ type: "toggle"; sectionId: CatalogSectionId }>
  | Readonly<{ type: "show-active"; sectionId: CatalogSectionId }>;

export function filterDesignLabEntries<Entry extends DesignLabNavEntry>(
  entries: ReadonlyArray<Entry>,
  filter: string,
): ReadonlyArray<Entry> {
  const normalizedFilter = filter.trim().toLocaleLowerCase();
  if (normalizedFilter.length === 0) return entries;

  return entries.filter(({ title, description, group, id }) =>
    `${title} ${description} ${group ?? ""} ${id}`.toLocaleLowerCase().includes(normalizedFilter),
  );
}

export function groupDesignLabEntries<Entry extends DesignLabNavEntry>(
  sections: ReadonlyArray<DesignLabNavSection>,
  entries: ReadonlyArray<Entry>,
): ReadonlyArray<DesignLabNavSectionGroup<Entry>> {
  return sections.flatMap((section) => {
    const sectionEntries = entries.filter((entry) => entry.section === section.id);
    if (sectionEntries.length === 0) return [];

    const groups = new Map<string, Array<Entry>>();
    for (const entry of sectionEntries) {
      const group = entry.group ?? "";
      const groupedEntries = groups.get(group) ?? [];
      groupedEntries.push(entry);
      groups.set(group, groupedEntries);
    }

    return [
      {
        section,
        groups: [...groups].map(([group, groupedEntries]) => ({
          group,
          entries: groupedEntries,
        })),
      },
    ];
  });
}

export function createDesignLabExpandedSections(
  sections: ReadonlyArray<DesignLabNavSection>,
): DesignLabExpandedSections {
  return Object.fromEntries(sections.map((section) => [section.id, false])) as Record<
    CatalogSectionId,
    boolean
  >;
}

export function designLabExpandedSectionsReducer(
  current: DesignLabExpandedSections,
  action: DesignLabExpandedSectionsAction,
): DesignLabExpandedSections {
  if (action.type === "show-active" && current[action.sectionId]) return current;

  return {
    ...current,
    [action.sectionId]: action.type === "show-active" ? true : !current[action.sectionId],
  };
}

export function isDesignLabSectionExpanded({
  filter,
  expandedSections,
  sectionId,
}: {
  filter: string;
  expandedSections: DesignLabExpandedSections;
  sectionId: CatalogSectionId;
}): boolean {
  return filter.trim().length > 0 || expandedSections[sectionId];
}
