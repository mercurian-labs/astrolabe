import { describe, expect, it } from "vite-plus/test";

import { createLogText } from "./logText";

function setup(): Disposable & { readonly text: ReturnType<typeof createLogText> } {
  const parent = document.body.appendChild(document.createElement("div"));
  const text = createLogText(parent);
  return {
    text,
    [Symbol.dispose]() {
      text.destroy();
      parent.remove();
    },
  };
}

describe("a log's text", () => {
  it("adds batches as lines, and a reconnect's snapshot replaces them", () => {
    using log = setup();
    log.text.append(["one", "two"]);
    log.text.append(["three"]);
    expect(log.text.text()).toBe("one\ntwo\nthree");
    log.text.replace(["fresh"]);
    expect(log.text.text()).toBe("fresh");
  });

  it("drops whole lines from its start past what it keeps", () => {
    using log = setup();
    const line = "x".repeat(1024 * 1024 - 1);
    log.text.append(["first", line, line, line]);
    log.text.append([line, "last"]);
    const lines = log.text.text().split("\n");
    expect(lines[0]).toBe(line);
    expect(lines.at(-1)).toBe("last");
    expect(lines).toHaveLength(4);
  });
});
