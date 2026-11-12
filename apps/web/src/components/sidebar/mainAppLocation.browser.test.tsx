import { EnvironmentId, MessageId, ThreadId, type AssistantCitation } from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import {
  assistantCitationFromLocation,
  assistantCitationNavigation,
} from "../../lib/assistantCitationNavigation";
import { startMainAppLocationTracking, useCloseAppModal } from "./mainAppLocation";

const THREAD_PATH = "/environment-one/thread-one";

const citation: AssistantCitation = {
  version: 1,
  environmentId: EnvironmentId.make("environment-one"),
  threadId: ThreadId.make("thread-one"),
  messageId: MessageId.make("assistant-one"),
  text: "quoted reply",
  start: 0,
  end: 12,
  prefix: "",
  suffix: "",
};

// Astrolabe: Pull Requests is a section, so only Settings and Usage lead back.
function ReturnControls() {
  const closeAppModal = useCloseAppModal();
  return (
    <button type="button" onClick={() => void closeAppModal()}>
      Close modal
    </button>
  );
}

// The tracker records on onResolved, which the router emits only once React commits the page.
async function settled(router: AnyRouter, navigation: Promise<void>) {
  await navigation;
  await vi.waitFor(() =>
    expect(router.state.resolvedLocation?.href).toBe(router.state.location.href),
  );
}

describe("main app return location", () => {
  it("returns to the thread without re-opening the quote source it was opened at", async () => {
    await using screen = await render(<ReturnControls />, { router: THREAD_PATH });
    const router = screen.router!;
    using _tracking = { [Symbol.dispose]: startMainAppLocationTracking(router) };

    await settled(router, router.navigate(assistantCitationNavigation(citation)));
    expect(assistantCitationFromLocation(router.state.location.href)).toEqual(citation);
    await settled(router, router.navigate({ href: "/usage" }));
    await userEvent.click(screen.getByRole("button", { name: "Close modal" }));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe(THREAD_PATH));

    expect(router.state.location.href).toBe(THREAD_PATH);
  });
});
