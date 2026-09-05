import { describe, expect, it } from "vite-plus/test";

import { THEME_COLOR_ROLES } from "../themePalette";
import {
  assertValidCatalogRegistry,
  CATALOG_ENTRIES,
  CATALOG_SECTIONS,
  CATALOG_VIEWPORT_TAGS,
  resolveCatalogPage,
  type CatalogEntry,
} from "./catalog";
import { FOUNDATION_COLOR_ROLES } from "./foundations";

const overview: CatalogEntry = CATALOG_ENTRIES[0]!;

const MIGRATED_STORY_TITLES = [
  "Awaiting input",
  "Working",
  "Unseen updates",
  "Plan hover card",
  "Reading",
  "Earlier checkpoint",
  "Memory note with links",
  "Memory note not yet written",
  "Memory needs review",
  "Memory merge review prepared",
  "Memory at an earlier checkpoint",
  "Memory map-only change",
  "Memory asset-only amendment",
  "Memory with nothing changed",
  "Memory not designated",
  "Imported from an issue",
  "No spec yet",
  "Turn with a model switch",
  "Coding-session leaf",
  "Spatial map canvas",
  "Thread view",
  "Columns at a fork",
  "Graph map",
  "Stale artifacts flagged",
] as const;

function entry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    ...overview,
    id: "test-entry",
    ...overrides,
  };
}

describe("design-system catalog registry", () => {
  it("accepts the shipped registry", () => {
    expect(() => assertValidCatalogRegistry(CATALOG_SECTIONS, CATALOG_ENTRIES)).not.toThrow();
  });

  it("registers profiles immediately after the axis controls", () => {
    expect(CATALOG_SECTIONS.slice(0, 2).map(({ id }) => id)).toEqual(["axes", "profiles"]);
    expect(resolveCatalogPage("profiles")).toMatchObject({
      section: "profiles",
      sourcePath: "src/design-system/profiles/ProfilesPage.tsx",
      layout: "document",
    });
  });

  it("only uses known viewport tags", () => {
    const knownTags = new Set<string>(CATALOG_VIEWPORT_TAGS);

    for (const catalogEntry of CATALOG_ENTRIES) {
      for (const tag of catalogEntry.viewportTags ?? []) {
        expect(knownTags.has(tag), `${catalogEntry.id} declares unknown viewport tag ${tag}`).toBe(
          true,
        );
      }
    }
  });

  it("rejects duplicate entry ids", () => {
    expect(() => assertValidCatalogRegistry(CATALOG_SECTIONS, [entry(), entry()])).toThrow(
      /Duplicate catalog entry id/,
    );
  });

  it("rejects entries that reference an unknown section", () => {
    expect(() =>
      assertValidCatalogRegistry(CATALOG_SECTIONS, [
        entry({ section: "missing" as CatalogEntry["section"] }),
      ]),
    ).toThrow(/Unknown catalog section/);
  });

  it("rejects missing or empty source paths", () => {
    expect(() => assertValidCatalogRegistry(CATALOG_SECTIONS, [entry({ sourcePath: "" })])).toThrow(
      /needs a source path/,
    );
    expect(() =>
      assertValidCatalogRegistry(CATALOG_SECTIONS, [entry({ sourcePath: "   " })]),
    ).toThrow(/needs a source path/);
  });

  it("rejects empty descriptions", () => {
    expect(() =>
      assertValidCatalogRegistry(CATALOG_SECTIONS, [entry({ description: "   " })]),
    ).toThrow(/needs a description/);
  });

  it("exposes exactly the production theme color roles", () => {
    expect(new Set(FOUNDATION_COLOR_ROLES)).toEqual(new Set(THEME_COLOR_ROLES));
    expect(FOUNDATION_COLOR_ROLES).toHaveLength(THEME_COLOR_ROLES.length);
  });

  it("resolves known pages and falls back to overview for missing or unknown ids", () => {
    expect(resolveCatalogPage("foundations-color").id).toBe("foundations-color");
    expect(resolveCatalogPage(undefined).id).toBe("overview");
    expect(resolveCatalogPage("does-not-exist").id).toBe("overview");
  });

  it("registers and resolves every migrated Mercurian story state", () => {
    const migratedEntries = CATALOG_ENTRIES.filter(({ section }) =>
      ["mercurian-grammar", "checkpoint-graph"].includes(section),
    );

    expect(migratedEntries.map(({ title }) => title)).toEqual(MIGRATED_STORY_TITLES);
    expect(migratedEntries).toHaveLength(24);
    for (const migratedEntry of migratedEntries) {
      expect(resolveCatalogPage(migratedEntry.id)).toBe(migratedEntry);
    }
  });
});
