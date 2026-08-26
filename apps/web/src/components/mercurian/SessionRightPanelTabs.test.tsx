import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../preview/PreviewPanelShell", () => ({
  PreviewPanelShell: ({ children }: { readonly children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("~/hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));
vi.mock("~/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { readonly children: ReactNode }) => <div>{children}</div>,
}));

import { RightPanelTabs } from "../RightPanelTabs";

function props(
  overrides: Partial<ComponentProps<typeof RightPanelTabs>> = {},
): ComponentProps<typeof RightPanelTabs> {
  const noop = () => undefined;
  return {
    mode: "inline",
    surfaces: [],
    activeSurfaceId: null,
    pendingSurfaceIds: new Set(),
    previewSessions: {},
    desktopByTabId: {},
    terminalLabelsById: new Map(),
    onActivate: noop,
    onCloseSurface: noop,
    onCloseOtherSurfaces: noop,
    onCloseSurfacesToRight: noop,
    onCloseAllSurfaces: noop,
    onCopyFilePath: noop,
    onAddBrowser: noop,
    onAddTerminal: noop,
    onAddDiff: noop,
    onAddFiles: noop,
    onAddPullRequest: noop,
    onAddAgents: noop,
    onAddPlan: noop,
    browserAvailable: false,
    terminalAvailable: false,
    diffAvailable: true,
    filesAvailable: true,
    planAvailable: true,
    pullRequestAvailable: false,
    agentsAvailable: false,
    liveAgentCount: 0,
    children: <div>Panel content</div>,
    ...overrides,
  };
}

describe("RightPanelTabs", () => {
  it("offers the standing Plan surface when it is available", () => {
    const markup = renderToStaticMarkup(<RightPanelTabs {...props()} />);

    expect(markup).toContain("Plan");
    expect(markup).toContain("Read the plan this session implements.");
    expect(markup).not.toContain('aria-keyshortcuts="L"');
    expect(markup).not.toMatch(/<kbd[^>]*>L<\/kbd>/);
  });

  it("omits the Plan surface when no owning plan is available", () => {
    const markup = renderToStaticMarkup(<RightPanelTabs {...props({ planAvailable: false })} />);

    expect(markup).not.toContain("Read the plan this session implements.");
    expect(markup).not.toMatch(/>Plan</);
  });
});
