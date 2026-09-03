import { ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../../test/reactElementTree";

const commands = vi.hoisted(() => ({
  recreateLineBranch: vi.fn(),
}));

vi.mock("../../state/mercurian", () => ({
  useRecreateLineBranch: () => commands.recreateLineBranch,
}));

import { LineBranchMissingBanner } from "./LineBranchMissingBanner";

const threadId = ThreadId.make("thread-test");

describe("LineBranchMissingBanner", () => {
  beforeEach(() => {
    commands.recreateLineBranch.mockClear();
  });

  it("renders only when a missing branch oid is recorded", () => {
    const hiddenMarkup = renderToStaticMarkup(
      <LineBranchMissingBanner
        threadId={threadId}
        branch="mercurian/session"
        lineBranchMissingOid={null}
      />,
    );
    const visibleMarkup = renderToStaticMarkup(
      <LineBranchMissingBanner
        threadId={threadId}
        branch="mercurian/session"
        lineBranchMissingOid="1234567890abcdef"
      />,
    );

    expect(hiddenMarkup).toBe("");
    expect(visibleMarkup).toContain('role="alert"');
    expect(visibleMarkup).toContain("Branch <code>mercurian/session</code> no longer exists");
    expect(visibleMarkup).toContain("Recreate at 1234567");
  });

  it("recreates the branch for the session thread", () => {
    const banner = LineBranchMissingBanner({
      threadId,
      branch: "mercurian/session",
      lineBranchMissingOid: "1234567890abcdef",
    });
    const button = visitElements(banner, (element) => typeof element.props.onClick === "function");

    expect(button).not.toBeNull();
    (button?.props.onClick as (() => void) | undefined)?.();
    expect(commands.recreateLineBranch).toHaveBeenCalledWith({ threadId });
  });
});
