import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { ProjectContentSearchDialog } from "./ProjectContentSearchDialog";

const threadRef = {
  environmentId: EnvironmentId.make("local"),
  threadId: ThreadId.make("thread"),
};

// Astrolabe: a match opens its file in Projects rather than the thread's right panel.
const { openFile, search } = vi.hoisted(() => ({
  openFile: vi.fn(),
  search: {
    canReadFiles: true,
    isCheckingAccess: false,
    hasQuery: true,
    isPending: false,
    error: null,
    invalidRegex: false,
    truncated: false,
    matches: [
      { path: "a.ts", lineNumber: 1, lineContent: "計画", matchRanges: [] },
      { path: "b.ts", lineNumber: 2, lineContent: "計画", matchRanges: [] },
      { path: "c.ts", lineNumber: 3, lineContent: "計画", matchRanges: [] },
    ],
  },
}));

vi.mock("~/hooks/useActiveProjectTarget", () => ({
  useActiveProjectTarget: () => ({
    environmentId: threadRef.environmentId,
    projectId: ProjectId.make("project"),
    cwd: "/workspace",
    projectName: "workspace",
    threadRef,
  }),
}));
vi.mock("~/hooks/useTheme", () => ({
  useRenderedAppearance: () => "light",
  useTheme: () => ({ theme: "t3-chat", resolvedTheme: "light", appearanceMode: "light" }),
}));
vi.mock("../repositories/openInRepositories", async (original) => ({
  ...(await original<typeof import("../repositories/openInRepositories")>()),
  openRepositoryFileAtLine: openFile,
}));
vi.mock("~/state/session", async (original) => ({
  ...(await original<typeof import("~/state/session")>()),
  readEnvironmentScope: () => true,
}));
vi.mock("~/state/queries", async (original) => ({
  ...(await original<typeof import("~/state/queries")>()),
  useProjectContentSearch: () => search,
}));

it("ignores composing keys in the search", async () => {
  openFile.mockReset();
  const onOpenChange = vi.fn();
  await using _screen = await render(<ProjectContentSearchDialog onOpenChange={onOpenChange} />);
  const input = page.getByRole("combobox");
  await input.fill("計画");

  for (const composition of [
    { key: "ArrowDown", isComposing: true, keyCode: 40 },
    { key: "ArrowDown", isComposing: false, keyCode: 229 },
    { key: "Enter", isComposing: true, keyCode: 13 },
    { key: "Enter", isComposing: false, keyCode: 229 },
  ]) {
    const event = new KeyboardEvent("keydown", { ...composition, bubbles: true, cancelable: true });
    await act(() => input.element().dispatchEvent(event));
  }
  expect(onOpenChange).not.toHaveBeenCalled();
  expect(openFile).not.toHaveBeenCalled();

  await userEvent.keyboard("{Enter}");
  expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  expect(openFile).toHaveBeenCalledExactlyOnceWith(
    {
      environmentId: threadRef.environmentId,
      projectId: ProjectId.make("project"),
      cwd: "/workspace",
      path: "a.ts",
      line: 1,
    },
    expect.any(Function),
  );
});
