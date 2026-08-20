import { ThreadId, type DiscoveredLocalServer } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { sessionPreviewOffers } from "./SessionPreviewOffer.logic";

const port: DiscoveredLocalServer = {
  host: "localhost",
  port: 5173,
  url: "http://localhost:5173",
  processName: "vite",
  pid: 123,
  terminal: { threadId: ThreadId.make("thread-1"), terminalId: "terminal-1" },
};

describe("sessionPreviewOffers", () => {
  it("labels a discovered port by host and port", () => {
    expect(sessionPreviewOffers([port])).toEqual([{ port, label: "localhost:5173" }]);
  });

  it("returns no offer for an empty port list", () => {
    expect(sessionPreviewOffers([])).toEqual([]);
  });
});
