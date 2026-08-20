import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, TurnId } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  useCheckpointDiff: vi.fn(),
  useThread: vi.fn(),
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => ({ availableEditors: [], cwd: "/workspace" }),
}));
vi.mock("@tanstack/react-router", () => ({ useParams: () => null }));
vi.mock("../../editorPreferences", () => ({ useOpenInPreferredEditor: () => vi.fn() }));
vi.mock("../../diffPanelStore", () => {
  const state = {
    byThreadKey: {},
    diffRenderMode: "stacked",
    setDiffRenderMode: vi.fn(),
    reconcileTurnSelection: vi.fn(),
    selectTurn: vi.fn(),
    selectGitScope: vi.fn(),
    selectSessionScope: vi.fn(),
    selectBranchBaseRef: vi.fn(),
  };
  const useDiffPanelStore = (selector: (value: typeof state) => unknown) => selector(state);
  useDiffPanelStore.getState = () => state;
  return {
    selectThreadDiffPanelSelection: () => ({ kind: "session" }),
    useDiffPanelStore,
  };
});
vi.mock("~/lib/checkpointDiffState", () => ({
  useCheckpointDiff: (...args: unknown[]) => mocks.useCheckpointDiff(...args),
}));
vi.mock("../../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("../../lib/diffRendering", () => ({
  buildFileDiffRenderKey: vi.fn(),
  getDiffCollapseIconClassName: () => "",
  getDiffLineStat: () => ({ additions: 0, deletions: 0 }),
  getRenderablePatch: () => null,
  resolveDiffThemeName: () => "light",
  resolveFileDiffPath: () => "",
  DIFF_SURFACE_THEME_UNSAFE_CSS: "",
}));
vi.mock("../../hooks/useTurnDiffSummaries", () => ({
  useTurnDiffSummaries: () => ({
    turnDiffSummaries: [
      {
        turnId: TurnId.make("turn-3"),
        checkpointTurnCount: 3,
        completedAt: "2026-08-20T12:00:00.000Z",
      },
    ],
    inferredCheckpointTurnCountByTurnId: {},
  }),
}));
vi.mock("../../state/entities", () => ({
  useThread: (...args: unknown[]) => mocks.useThread(...args),
  useProject: () => ({ workspaceRoot: "/workspace" }),
}));
vi.mock("../../hooks/useSettings", () => ({
  useClientSettings: () => ({
    wordWrap: false,
    diffIgnoreWhitespace: false,
    timestampFormat: "24-hour",
  }),
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (query: unknown) => ({
    data: query === "git-status" ? { isRepo: true } : undefined,
    error: null,
    isPending: false,
    refresh: vi.fn(),
  }),
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../../state/server", () => ({
  serverEnvironment: { configValueAtom: vi.fn() },
}));
vi.mock("../../state/review", () => ({
  reviewEnvironment: { diffFileContents: Symbol("diffFileContents"), diffPreview: vi.fn() },
}));
vi.mock("../../state/vcs", () => ({
  vcsEnvironment: { status: () => "git-status", listRefs: vi.fn() },
}));
vi.mock("../DiffPanelShell", () => ({
  DiffPanelShell: ({
    header,
    children,
  }: {
    readonly header: ReactNode;
    readonly children: ReactNode;
  }) => (
    <div>
      {header}
      {children}
    </div>
  ),
  DiffPanelLoadingState: ({ label }: { readonly label: string }) => <div>{label}</div>,
}));
vi.mock("../DiffWorkerPoolProvider", () => ({
  DiffWorkerPoolProvider: ({ children }: { readonly children: ReactNode }) => <>{children}</>,
}));
vi.mock("../ui/menu", () => {
  const Container = ({ children }: { readonly children?: ReactNode }) => <div>{children}</div>;
  const Item = ({
    children,
    disabled,
  }: {
    readonly children?: ReactNode;
    readonly disabled?: boolean;
  }) => (
    <button type="button" disabled={disabled}>
      {children}
    </button>
  );
  return {
    DropdownMenu: Container,
    DropdownMenuContent: Container,
    DropdownMenuItem: Item,
    DropdownMenuSub: Container,
    DropdownMenuSubContent: Container,
    DropdownMenuSubTrigger: Item,
    DropdownMenuTrigger: Item,
  };
});
vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { readonly children?: ReactNode }) => <>{children}</>,
  TooltipPopup: ({ children }: { readonly children?: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { readonly children?: ReactNode }) => <>{children}</>,
}));
vi.mock("../ui/toggle-group", () => ({
  ToggleGroup: ({ children }: { readonly children?: ReactNode }) => <div>{children}</div>,
  Toggle: ({ children }: { readonly children?: ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

import DiffPanel from "../DiffPanel";

const threadRef = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-1"));

describe("DiffPanel", () => {
  beforeEach(() => {
    mocks.useThread.mockReturnValue({
      environmentId: threadRef.environmentId,
      id: threadRef.threadId,
      projectId: "project-1",
      worktreePath: "/workspace",
    });
    mocks.useCheckpointDiff.mockReturnValue({
      data: { diff: "" },
      error: null,
      isPending: false,
    });
  });

  it("uses a thread prop without route params and renders the session scopes", () => {
    const markup = renderToStaticMarkup(
      <DiffPanel composerDraftTarget={threadRef} initialGitScope="branch" threadRef={threadRef} />,
    );

    expect(mocks.useThread).toHaveBeenCalledWith(threadRef);
    expect(mocks.useCheckpointDiff).toHaveBeenCalledWith(
      expect.objectContaining({
        environmentId: threadRef.environmentId,
        threadId: threadRef.threadId,
        fromTurnCount: 0,
        toTurnCount: 3,
        cacheScope: "session",
      }),
      { enabled: true },
    );
    expect(markup).toContain("Whole session");
    expect(markup).toContain("Working tree");
    expect(markup).toContain("Branch changes");
    expect(markup).toContain("Latest turn");
    expect(markup).not.toContain("Select a thread to inspect turn diffs.");
  });
});
