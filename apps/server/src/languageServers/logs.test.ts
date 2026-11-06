import { describe, expect, it } from "vite-plus/test";

import { makeServerLog } from "./logs.ts";

describe("a server's log", () => {
  it("joins stderr chunks into lines, and keeps what an exit leaves unfinished", () => {
    const log = makeServerLog();
    log.stderr("one\ntw");
    log.stderr("o\r\nthr");
    expect(log.lines().map((line) => line.text)).toEqual(["one", "two"]);
    log.endStderr();
    expect(log.lines().map((line) => line.text)).toEqual(["one", "two", "thr"]);
  });

  it("keeps only the newest lines, however long each ring runs", () => {
    const log = makeServerLog();
    for (let line = 1; line <= 7000; line++) log.line("environment", `${line}`);
    const lines = log.lines();
    expect(lines).toHaveLength(2000);
    expect(lines[0]?.text).toBe("5001");
    expect(lines.at(-1)?.text).toBe("7000");
  });

  it("bounds a trace by its length, cutting a long message", () => {
    const log = makeServerLog();
    const message = "x".repeat(100_000);
    for (let entry = 0; entry < 500; entry++) log.trace("sent", message);
    const entries = log.entries();
    expect(entries[0]?.text).toContain("(100000 characters)");
    expect(entries.reduce((sum, entry) => sum + entry.text.length, 0)).toBeLessThanOrEqual(
      2 * 1024 * 1024,
    );
    expect(entries.length).toBeGreaterThan(100);
  });

  it("stops a trace and forgets it when its last reader goes", () => {
    const log = makeServerLog();
    log.setTracing(true);
    log.trace("received", "{}");
    log.onLastSubscriberGone();
    expect(log.tracing).toBe(false);
    expect(log.entries()).toEqual([]);
  });
});
