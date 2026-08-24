import { ChevronRightIcon } from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

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
import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "../../workspaceTitlebar";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import {
  createDesignLabExpandedSections,
  designLabExpandedSectionsReducer,
  filterDesignLabEntries,
  groupDesignLabEntries,
  isDesignLabSectionExpanded,
} from "./designLabNav.logic";

export type DesignLabSearch = Readonly<{
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

function DesignLabHeader({ children }: { children: ReactNode }) {
  const content = (
    <>
      <WorkspaceBreadcrumb ariaLabel="Design Lab breadcrumb" className="shrink-0">
        <WorkspaceBreadcrumbItem current>Design Lab</WorkspaceBreadcrumbItem>
      </WorkspaceBreadcrumb>
      {children}
    </>
  );

  return !isElectron ? (
    <header
      className={cn(
        "workspace-topbar gap-3 px-3 transition-[padding-left] duration-200 ease-linear motion-reduce:transition-none sm:px-5",
        COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
      )}
    >
      {content}
    </header>
  ) : (
    <div
      className={cn(
        "drag-region flex h-[52px] shrink-0 items-center gap-3 px-5 transition-[padding-left] duration-200 ease-linear motion-reduce:transition-none wco:h-[env(titlebar-area-height)] wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]",
        COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
      )}
    >
      {content}
    </div>
  );
}

export function DesignLabLayout({
  search,
  onSearchChange,
}: {
  search: DesignLabSearch;
  onSearchChange: (next: DesignLabSearch) => void;
}) {
  const activeEntry = resolveCatalogPage(search.page);
  const themes = foundationsThemes();
  const [filter, setFilter] = useState("");
  const [expandedSections, dispatchExpandedSections] = useReducer(
    designLabExpandedSectionsReducer,
    CATALOG_SECTIONS,
    createDesignLabExpandedSections,
  );
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

  const filteredEntries = useMemo(() => filterDesignLabEntries(CATALOG_ENTRIES, filter), [filter]);
  const navSections = useMemo(
    () => groupDesignLabEntries(CATALOG_SECTIONS, filteredEntries),
    [filteredEntries],
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

  useEffect(() => {
    dispatchExpandedSections({ type: "show-active", sectionId: activeEntry.section });
  }, [activeEntry.section]);

  const canvasClass = CANVAS_WIDTHS.find(({ id }) => id === canvasWidth)?.className ?? "max-w-none";
  const renderContext = { themeId, appearance } as const;
  const activeThemeLabel = themes.find((theme) => theme.id === themeId)?.label ?? themeId;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <DesignLabHeader>
          <div className="ms-auto flex min-w-0 items-center gap-1 overflow-x-auto [-webkit-app-region:no-drag]">
            <Select
              value={themeId}
              onValueChange={(value) => {
                if (typeof value === "string") setThemeId(value);
              }}
            >
              <SelectTrigger aria-label="Palette" className="w-32 shrink-0" size="xs">
                <SelectValue>{activeThemeLabel}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {themes.map((theme) => (
                  <SelectItem hideIndicator key={theme.id} value={theme.id}>
                    {theme.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>

            <fieldset className="flex gap-1" aria-label="Appearance">
              {(["light", "dark"] as const).map((mode) => (
                <Button
                  aria-pressed={appearance === mode}
                  key={mode}
                  onClick={() => setAppearance(mode)}
                  size="xs"
                  variant={appearance === mode ? "secondary" : "ghost"}
                >
                  <span className="capitalize">{mode}</span>
                </Button>
              ))}
            </fieldset>

            <fieldset className="flex gap-1" aria-label="Canvas conditions">
              <Button
                aria-pressed={increasedText}
                onClick={() => setIncreasedText((enabled) => !enabled)}
                size="xs"
                variant={increasedText ? "secondary" : "ghost"}
              >
                Increased text
              </Button>
              <Button
                aria-pressed={reducedMotion}
                onClick={() => setReducedMotion((enabled) => !enabled)}
                size="xs"
                title="Suppresses all animation and transitions within the catalog canvas."
                variant={reducedMotion ? "secondary" : "ghost"}
              >
                Reduced motion
              </Button>
            </fieldset>

            <fieldset className="flex gap-1" aria-label="Canvas width">
              {CANVAS_WIDTHS.map(({ id, label }) => (
                <Button
                  aria-pressed={canvasWidth === id}
                  key={id}
                  onClick={() => setCanvasWidth(id)}
                  size="xs"
                  variant={canvasWidth === id ? "secondary" : "ghost"}
                >
                  {label}
                </Button>
              ))}
            </fieldset>
          </div>
        </DesignLabHeader>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
          <section className="order-2 flex min-h-0 min-w-0 flex-1 flex-col md:order-1">
            {activeEntry.viewportTags?.length ? (
              <div
                aria-label="Declared viewport tags"
                className="flex shrink-0 flex-wrap gap-1.5 border-b border-border px-4 py-2"
              >
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

          <aside className="order-1 flex max-h-[42dvh] shrink-0 flex-col border-b border-border bg-card md:order-2 md:max-h-none md:w-72 md:border-b-0 md:border-l">
            <div className="border-b border-border p-3">
              <label className="sr-only" htmlFor="design-lab-filter">
                Filter Design Lab pages
              </label>
              <Input
                id="design-lab-filter"
                onChange={(event) => setFilter(event.currentTarget.value)}
                placeholder="Filter pages"
                type="search"
                value={filter}
              />
            </div>

            <nav aria-label="Design Lab catalog" className="min-h-0 flex-1 overflow-y-auto p-3">
              {navSections.map(({ section, groups }) => {
                const expanded = isDesignLabSectionExpanded({
                  filter,
                  expandedSections,
                  sectionId: section.id,
                });

                return (
                  <section className="mb-5" key={section.id}>
                    <h2 className="mb-1">
                      <button
                        aria-expanded={expanded}
                        className="flex w-full items-center gap-1 px-2 text-left text-xs font-medium text-muted-foreground uppercase"
                        onClick={() =>
                          dispatchExpandedSections({ type: "toggle", sectionId: section.id })
                        }
                        type="button"
                      >
                        <ChevronRightIcon
                          aria-hidden
                          className={cn(
                            "size-3 shrink-0 transition-transform motion-reduce:transition-none",
                            expanded && "rotate-90",
                          )}
                        />
                        {section.title}
                      </button>
                    </h2>
                    {expanded
                      ? groups.map(({ group, entries }) => (
                          <div className={group ? "mt-3" : undefined} key={group || section.id}>
                            {group ? (
                              <h3 className="mb-1 px-2 text-xs font-medium text-foreground">
                                {group}
                              </h3>
                            ) : null}
                            <ul className="space-y-1">
                              {entries.map((entry) => {
                                const active = entry.id === activeEntry.id;
                                return (
                                  <li key={entry.id}>
                                    <button
                                      aria-current={active ? "page" : undefined}
                                      className={cn(
                                        "w-full rounded-md px-2 py-1.5 text-left text-sm",
                                        active
                                          ? "bg-accent font-medium text-accent-foreground"
                                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                      )}
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
                        ))
                      : null}
                  </section>
                );
              })}
              {filteredEntries.length === 0 ? (
                <p className="px-2 text-sm text-muted-foreground">No catalog pages match.</p>
              ) : null}
            </nav>
          </aside>
        </div>
      </div>
    </SidebarInset>
  );
}
