import { describe, expect, it } from "vite-plus/test";

import { CATALOG_ENTRIES } from "./catalog";
import {
  cataloguedMercurianSourcePaths,
  declaredMercurianModulePaths,
  MERCURIAN_CLASSIFICATIONS,
  mercurianCoverageRows,
  UI_CLASSIFICATIONS,
  uiInventoryRows,
} from "./coverage";
import { MERCURIAN_MODULE_PATHS, UI_MODULE_PATHS } from "./coverage.modules";

describe("design-system coverage inventories", () => {
  it("classifies every Mercurian component module exactly once", () => {
    const modulePaths = new Set(MERCURIAN_MODULE_PATHS);
    const catalogued = cataloguedMercurianSourcePaths(CATALOG_ENTRIES, MERCURIAN_MODULE_PATHS);
    const staleClassifications = Object.keys(MERCURIAN_CLASSIFICATIONS).filter(
      (modulePath) => !modulePaths.has(modulePath),
    );
    const overlappingClassifications = Object.keys(MERCURIAN_CLASSIFICATIONS).filter((modulePath) =>
      catalogued.has(modulePath),
    );
    const unclassified = mercurianCoverageRows(CATALOG_ENTRIES, MERCURIAN_MODULE_PATHS).filter(
      ({ category }) => category === "unclassified",
    );

    expect(staleClassifications).toEqual([]);
    expect(overlappingClassifications).toEqual([]);
    expect(unclassified).toEqual([]);
    expect(new Set(declaredMercurianModulePaths(CATALOG_ENTRIES))).toEqual(modulePaths);
    expect(catalogued.size).toBe(10);
    expect(MERCURIAN_MODULE_PATHS).toHaveLength(41);
    for (const { reason } of Object.values(MERCURIAN_CLASSIFICATIONS)) {
      expect(reason.trim()).not.toBe("");
    }
  });

  it("keeps the ui inventory structurally sound without failing on unreviewed modules", () => {
    const modulePaths = new Set(UI_MODULE_PATHS);
    const staleClassifications = Object.keys(UI_CLASSIFICATIONS).filter(
      (modulePath) => !modulePaths.has(modulePath),
    );
    const rows = uiInventoryRows(CATALOG_ENTRIES, UI_MODULE_PATHS);
    const rowPaths = rows.map(({ modulePath }) => modulePath);

    expect(staleClassifications).toEqual([]);
    expect(new Set(rowPaths).size).toBe(rowPaths.length);
    expect(rows).toHaveLength(UI_MODULE_PATHS.length);
    expect(rows.some(({ category }) => category === "unreviewed")).toBe(true);
    for (const { reason } of Object.values(UI_CLASSIFICATIONS)) {
      expect(reason.trim()).not.toBe("");
    }
  });
});
