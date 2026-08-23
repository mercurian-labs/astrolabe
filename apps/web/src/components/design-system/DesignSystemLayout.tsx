import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { foundationsThemes } from "../../foundations/foundations.logic";
import {
  applyThemePalette,
  getThemeColorVariable,
  THEME_COLOR_ROLES,
  type ThemeAppearance,
} from "../../themePalette";
import {
  CATALOG_ENTRIES,
  CATALOG_SECTIONS,
  resolveCatalogPage,
  type CatalogCanvasWidth,
  type CatalogEntry,
  type CatalogViewportTag,
} from "../../design-system/catalog";

export type DesignSystemSearch = Readonly<{
  page?: string;
  entry?: string;
}>;

const CANVAS_WIDTHS: ReadonlyArray<{
  id: CatalogCanvasWidth;
  label: string;
  className: string;
}> = [
  { id: "compact", label: "Compact", className: "max-w-2xl" },
  { id: "desktop", label: "Desktop", className: "max-w-5xl" },
  { id: "wide", label: "Wide", className: "max-w-none" },
];

const VIEWPORT_TAG_LABELS: Record<CatalogViewportTag, string> = {
  narrow: "narrow",
  desktop: "desktop",
  "increased-text": "increased text",
  "reduced-motion": "reduced motion",
};

type InlineStyleSnapshot = Readonly<{
  value: string;
  priority: string;
}>;

function restoreInlineStyle(
  style: CSSStyleDeclaration,
  property: string,
  snapshot: InlineStyleSnapshot,
) {
  if (snapshot.value) style.setProperty(property, snapshot.value, snapshot.priority);
  else style.removeProperty(property);
}

function applyCatalogPalette(themeId: string, appearance: ThemeAppearance) {
  const root = document.documentElement;
  root.classList.toggle("dark", appearance === "dark");
  applyThemePalette(themeId === "standard" ? appearance : themeId, appearance);
}

function CatalogEntryCanvas({
  entry,
  renderContext,
}: {
  entry: CatalogEntry;
  renderContext: Parameters<CatalogEntry["render"]>[0];
}) {
  const [setupComplete, setSetupComplete] = useState(entry.setup === undefined);

  useLayoutEffect(() => {
    if (entry.setup === undefined) return;
    const cleanup = entry.setup();
    setSetupComplete(true);
    return cleanup;
  }, [entry]);

  if (!setupComplete) return null;

  return entry.layout === "preview" ? (
    <div className="flex min-h-full min-w-0 items-center justify-center p-6">
      {entry.render(renderContext)}
    </div>
  ) : (
    <div className="flex min-h-full min-w-0 flex-col">{entry.render(renderContext)}</div>
  );
}

export function DesignSystemLayout({
  search,
  onSearchChange,
}: {
  search: DesignSystemSearch;
  onSearchChange: (next: DesignSystemSearch) => void;
}) {
  const activeEntry = resolveCatalogPage(search.page);
  const themes = foundationsThemes();
  const [filter, setFilter] = useState("");
  const [themeId, setThemeId] = useState("standard");
  const [appearance, setAppearance] = useState<ThemeAppearance>(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
      ? "dark"
      : "light",
  );
  const [canvasWidth, setCanvasWidth] = useState<CatalogCanvasWidth>(activeEntry.preferredCanvas);
  const [increasedText, setIncreasedText] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const originalRootFontSize = useRef<InlineStyleSnapshot | null>(null);

  const normalizedFilter = filter.trim().toLocaleLowerCase();
  const filteredEntries = useMemo(
    () =>
      normalizedFilter.length === 0
        ? CATALOG_ENTRIES
        : CATALOG_ENTRIES.filter(({ title, description, group, id }) =>
            `${title} ${description} ${group ?? ""} ${id}`
              .toLocaleLowerCase()
              .includes(normalizedFilter),
          ),
    [normalizedFilter],
  );

  useEffect(() => {
    const root = document.documentElement;
    const originalDark = root.classList.contains("dark");
    const originalThemeId = root.dataset.themeId;
    const originalFontSize = {
      value: root.style.getPropertyValue("font-size"),
      priority: root.style.getPropertyPriority("font-size"),
    };
    originalRootFontSize.current = originalFontSize;
    const originalVariables = THEME_COLOR_ROLES.map((role) => {
      const variable = getThemeColorVariable(role);
      return [variable, root.style.getPropertyValue(variable)] as const;
    });

    return () => {
      root.classList.toggle("dark", originalDark);
      if (originalThemeId === undefined) delete root.dataset.themeId;
      else root.dataset.themeId = originalThemeId;
      restoreInlineStyle(root.style, "font-size", originalFontSize);
      for (const [variable, value] of originalVariables) {
        if (value) root.style.setProperty(variable, value);
        else root.style.removeProperty(variable);
      }
    };
  }, []);

  useEffect(() => {
    applyCatalogPalette(themeId, appearance);
  }, [appearance, themeId]);

  useEffect(() => {
    const originalFontSize = originalRootFontSize.current;
    if (originalFontSize === null) return;

    if (increasedText) document.documentElement.style.fontSize = "18px";
    else restoreInlineStyle(document.documentElement.style, "font-size", originalFontSize);
  }, [increasedText]);

  useEffect(() => {
    if (!search.entry) return;
    document.getElementById(search.entry)?.scrollIntoView({ block: "start" });
  }, [activeEntry.id, search.entry]);

  const canvasClass = CANVAS_WIDTHS.find(({ id }) => id === canvasWidth)?.className ?? "max-w-none";
  const renderContext = { themeId, appearance } as const;

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background text-foreground md:flex-row">
      <aside className="flex max-h-[42dvh] shrink-0 flex-col border-b border-border bg-card md:max-h-none md:w-72 md:border-r md:border-b-0">
        <header className="space-y-1 border-b border-border p-4">
          <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
            Astrolabe
          </p>
          <p className="text-lg font-semibold">Design system</p>
        </header>

        <div className="border-b border-border p-3">
          <label className="sr-only" htmlFor="catalog-filter">
            Filter catalog pages
          </label>
          <input
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-placeholder focus-visible:ring-2 focus-visible:ring-ring"
            id="catalog-filter"
            onChange={(event) => setFilter(event.currentTarget.value)}
            placeholder="Filter pages"
            type="search"
            value={filter}
          />
        </div>

        <nav aria-label="Design system catalog" className="min-h-0 flex-1 overflow-y-auto p-3">
          {CATALOG_SECTIONS.map((section) => {
            const entries = filteredEntries.filter((entry) => entry.section === section.id);
            if (entries.length === 0) return null;
            const groupedEntries = entries.reduce((groups, entry) => {
              const group = entry.group ?? "";
              const current = groups.get(group) ?? [];
              current.push(entry);
              groups.set(group, current);
              return groups;
            }, new Map<string, Array<CatalogEntry>>());
            return (
              <section className="mb-5" key={section.id}>
                <h2 className="mb-1 px-2 text-xs font-medium text-muted-foreground uppercase">
                  {section.title}
                </h2>
                {[...groupedEntries].map(([group, grouped]) => (
                  <div className={group ? "mt-3" : undefined} key={group || section.id}>
                    {group ? (
                      <h3 className="mb-1 px-2 text-xs font-medium text-foreground">{group}</h3>
                    ) : null}
                    <ul className="space-y-1">
                      {grouped.map((entry) => {
                        const active = entry.id === activeEntry.id;
                        return (
                          <li key={entry.id}>
                            <button
                              aria-current={active ? "page" : undefined}
                              className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
                                active
                                  ? "bg-accent font-medium text-accent-foreground"
                                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
                              }`}
                              onClick={() => {
                                setCanvasWidth(entry.preferredCanvas);
                                onSearchChange({ page: entry.id });
                              }}
                              type="button"
                            >
                              {entry.title}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </section>
            );
          })}
          {filteredEntries.length === 0 ? (
            <p className="px-2 text-sm text-muted-foreground">No catalog pages match.</p>
          ) : null}
        </nav>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-end gap-3 border-b border-border bg-card px-4 py-3">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Palette
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onChange={(event) => setThemeId(event.currentTarget.value)}
              value={themeId}
            >
              {themes.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.label}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="flex gap-1" aria-label="Appearance">
            {(["light", "dark"] as const).map((mode) => (
              <button
                aria-pressed={appearance === mode}
                className={`h-9 rounded-md border px-3 text-sm capitalize ${
                  appearance === mode
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-foreground hover:bg-muted"
                }`}
                key={mode}
                onClick={() => setAppearance(mode)}
                type="button"
              >
                {mode}
              </button>
            ))}
          </fieldset>

          <fieldset className="flex gap-1" aria-label="Canvas conditions">
            <button
              aria-pressed={increasedText}
              className={`h-9 rounded-md border px-3 text-sm ${
                increasedText
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-foreground hover:bg-muted"
              }`}
              onClick={() => setIncreasedText((enabled) => !enabled)}
              type="button"
            >
              Increased text
            </button>
            <button
              aria-pressed={reducedMotion}
              className={`h-9 rounded-md border px-3 text-sm ${
                reducedMotion
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-foreground hover:bg-muted"
              }`}
              onClick={() => setReducedMotion((enabled) => !enabled)}
              title="Suppresses all animation and transitions within the catalog canvas."
              type="button"
            >
              Reduced motion
            </button>
          </fieldset>

          <fieldset className="ms-auto flex gap-1" aria-label="Canvas width">
            {CANVAS_WIDTHS.map(({ id, label }) => (
              <button
                aria-pressed={canvasWidth === id}
                className={`h-9 rounded-md border px-3 text-xs ${
                  canvasWidth === id
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-foreground hover:bg-muted"
                }`}
                key={id}
                onClick={() => setCanvasWidth(id)}
                type="button"
              >
                {label}
              </button>
            ))}
          </fieldset>

          {activeEntry.viewportTags?.length ? (
            <div aria-label="Declared viewport tags" className="flex w-full flex-wrap gap-1.5">
              {activeEntry.viewportTags.map((tag) => (
                <span
                  className="rounded-full border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground"
                  key={tag}
                >
                  {VIEWPORT_TAG_LABELS[tag]}
                </span>
              ))}
            </div>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-auto bg-background">
          <style>{`
            .design-system-reduced-motion *,
            .design-system-reduced-motion *::before,
            .design-system-reduced-motion *::after {
              animation: none !important;
              transition: none !important;
            }
          `}</style>
          <div
            className={`mx-auto min-h-full w-full ${canvasClass} ${
              reducedMotion ? "design-system-reduced-motion" : ""
            }`}
          >
            <CatalogEntryCanvas
              entry={activeEntry}
              key={activeEntry.id}
              renderContext={renderContext}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
