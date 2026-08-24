import { describe, expect, it } from "vite-plus/test";

import {
  createDesignLabExpandedSections,
  designLabExpandedSectionsReducer,
  filterDesignLabEntries,
  groupDesignLabEntries,
  isDesignLabSectionExpanded,
  type DesignLabNavEntry,
  type DesignLabNavSection,
} from "./designLabNav.logic";

const sections: ReadonlyArray<DesignLabNavSection> = [
  { id: "overview", title: "Overview" },
  { id: "foundations", title: "Foundations" },
  { id: "audit", title: "Audit" },
];

const entries: ReadonlyArray<DesignLabNavEntry> = [
  {
    id: "overview-introduction",
    section: "overview",
    title: "Introduction",
    description: "Catalog scope and boundaries",
  },
  {
    id: "foundation-color-roles",
    section: "foundations",
    group: "Color",
    title: "Theme roles",
    description: "Semantic palette tokens",
  },
  {
    id: "foundation-typography",
    section: "foundations",
    group: "Type",
    title: "Typography voices",
    description: "Interface and code families",
  },
];

describe("groupDesignLabEntries", () => {
  it("groups entries by section and then group while omitting empty sections", () => {
    const grouped = groupDesignLabEntries(sections, entries);

    expect(grouped.map(({ section }) => section.id)).toEqual(["overview", "foundations"]);
    expect(grouped[0]?.groups).toEqual([{ group: "", entries: [entries[0]] }]);
    expect(grouped[1]?.groups.map(({ group }) => group)).toEqual(["Color", "Type"]);
    expect(grouped[1]?.groups[0]?.entries).toEqual([entries[1]]);
  });
});

describe("filterDesignLabEntries", () => {
  it.each([
    ["typography", "foundation-typography"],
    ["palette tokens", "foundation-color-roles"],
    ["color", "foundation-color-roles"],
    ["FOUNDATION-COLOR", "foundation-color-roles"],
  ])("matches %s across title, description, group, and id", (filter, expectedId) => {
    expect(filterDesignLabEntries(entries, filter).map(({ id }) => id)).toEqual([expectedId]);
  });

  it("returns every entry for an empty or whitespace-only filter", () => {
    expect(filterDesignLabEntries(entries, "")).toBe(entries);
    expect(filterDesignLabEntries(entries, "   ")).toBe(entries);
  });
});

describe("expanded Design Lab sections", () => {
  it("automatically expands the active entry's section", () => {
    const collapsed = createDesignLabExpandedSections(sections);
    const expanded = designLabExpandedSectionsReducer(collapsed, {
      type: "show-active",
      sectionId: "foundations",
    });

    expect(expanded.foundations).toBe(true);
    expect(expanded.overview).toBe(false);
  });

  it("expands every matching section while a filter is active", () => {
    const expandedSections = createDesignLabExpandedSections(sections);

    expect(
      isDesignLabSectionExpanded({
        filter: "theme",
        expandedSections,
        sectionId: "foundations",
      }),
    ).toBe(true);
  });
});
