import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, TurnId } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  useCheckpointDiff: vi.fn(),
  useThread: vi.fn(),
  lineUncommittedDiff: vi.fn((_input: unknown) => "line-uncommitted-query"),
  getRenderablePatch: vi.fn(
    (_patch: string | undefined, _key: string, _options: unknown) =>
      null as null | { kind: "files"; files: Array<object> },
  ),
  diffSelection: { kind: "session" } as
    | { kind: "session" }
    | { kind: "branch"; baseRef: null }
    | { kind: "line-uncommitted" },
  isMercurianSession: true,
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
    selectLineUncommittedScope: vi.fn(),
    selectSessionScope: vi.fn(),
    selectBranchBaseRef: vi.fn(),
  };
  const useDiffPanelStore = (selector: (value: typeof state) => unknown) => selector(state);
  useDiffPanelStore.getState = () => state;
  return {
    selectThreadDiffPanelSelection: () => mocks.diffSelection,
    useDiffPanelStore,
  };
});
vi.mock("~/lib/checkpointDiffState", () => ({
  useCheckpointDiff: (...args: unknown[]) => mocks.useCheckpointDiff(...args),
}));
vi.mock("../../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("../../lib/diffRendering", () => ({
  buildFileDiffContentVersion: () => "snapshot-version",
  buildFileDiffIdentityKey: () => "src/snapshot.ts",
  buildFileDiffRenderKey: () => "src/snapshot.ts",
  getDiffCollapseIconClassName: () => "",
  getDiffLineStat: () => ({ additions: 0, deletions: 0 }),
  getRenderablePatch: (patch: string | undefined, key: string, options: unknown) =>
    mocks.getRenderablePatch(patch, key, options),
  resolveDiffThemeName: () => "light",
  resolveFileDiffPath: () => "src/snapshot.ts",
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
  useUpdateClientSettings: () => vi.fn(),
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (query: unknown) => ({
    data:
      query === "git-status"
        ? { isRepo: true }
        : query === "line-uncommitted-query"
          ? { threadId: ThreadId.make("thread-1"), diff: "snapshot diff" }
          : undefined,
    error: null,
    isPending: false,
    refresh: vi.fn(),
  }),
}));
vi.mock("../../state/mercurian", () => ({
  usePlanDetail: () => ({
    detail: mocks.isMercurianSession
      ? {
          lineRuntimes: [{ threadId: ThreadId.make("thread-1") }],
          codingSessions: [],
        }
      : null,
    isPending: false,
    error: null,
  }),
}));
vi.mock("../../state/mercurianDiff", () => ({
  lineUncommittedDiff: (input: unknown) => mocks.lineUncommittedDiff(input),
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
vi.mock("../diffs/AnnotatableCodeView", () => ({
  AnnotatableCodeView: ({ sectionTitle }: { readonly sectionTitle: string }) => (
    <div data-testid="diff-viewer">{sectionTitle}</div>
  ),
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
    mocks.diffSelection = { kind: "session" };
    mocks.isMercurianSession = true;
    mocks.lineUncommittedDiff.mockClear();
    mocks.getRenderablePatch.mockReset();
    mocks.getRenderablePatch.mockReturnValue(null);
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
    expect(markup).toContain("Uncommitted");
    expect(markup).toContain("Latest turn");
    expect(markup.indexOf("Branch changes")).toBeLessThan(markup.indexOf("Uncommitted"));
    expect(markup).not.toContain("Select a thread to inspect turn diffs.");
  });

  it("does not offer the line-uncommitted scope for a plain thread", () => {
    mocks.diffSelection = { kind: "branch", baseRef: null };
    mocks.isMercurianSession = false;

    const markup = renderToStaticMarkup(
      <DiffPanel composerDraftTarget={threadRef} initialGitScope="branch" threadRef={threadRef} />,
    );

    expect(markup).not.toContain("Uncommitted");
    expect(mocks.lineUncommittedDiff).not.toHaveBeenCalled();
  });

  it("requests and renders the ref-backed diff for the line-uncommitted scope", () => {
    mocks.diffSelection = { kind: "line-uncommitted" };
    mocks.getRenderablePatch.mockReturnValue({ kind: "files", files: [{}] });

    const markup = renderToStaticMarkup(
      <DiffPanel composerDraftTarget={threadRef} initialGitScope="branch" threadRef={threadRef} />,
    );

    expect(mocks.lineUncommittedDiff).toHaveBeenCalledWith({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, ignoreWhitespace: false },
    });
    expect(mocks.getRenderablePatch).toHaveBeenCalledWith(
      "snapshot diff",
      "diff-panel:light",
      expect.any(Object),
    );
    expect(markup).toContain('data-testid="diff-viewer"');
    expect(markup).toContain(">Uncommitted</div>");
  });
});
