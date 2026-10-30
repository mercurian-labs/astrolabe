import { describe, expect, it } from "@effect/vitest";

import { replacementsIn, textMatcher } from "./textReplace.ts";

const apply = (text: string, query: Parameters<typeof textMatcher>[0], replacement: string) => {
  let result = text;
  for (const change of replacementsIn(text, textMatcher(query), replacement).toReversed()) {
    result = result.slice(0, change.from) + change.insert + result.slice(change.to);
  }
  return result;
};

const plain = { caseSensitive: false, wholeWord: false, useRegex: false };

describe("replacementsIn", () => {
  it("replaces plain text literally, case-insensitively by default", () => {
    expect(apply("Foo foo $1\nfoo.bar", { ...plain, query: "foo" }, "$1x")).toBe(
      "$1x $1x $1\n$1x.bar",
    );
  });

  it("only matches whole words when asked", () => {
    expect(apply("foo food foo_bar (foo)", { ...plain, wholeWord: true, query: "foo" }, "X")).toBe(
      "X food foo_bar (X)",
    );
  });

  it("expands groups and escapes in a regular expression's replacement", () => {
    const query = { ...plain, useRegex: true, caseSensitive: true, query: "(\\w+)=(?<v>\\d+)" };
    expect(apply("a=1, b=22", query, "$<v>:$1\\n$$")).toBe("1:a\n$, 22:b\n$");
  });

  it("does not match again inside its own replacement", () => {
    expect(apply("## Notes\n## Notes", { ...plain, query: "## Notes" }, "## Notes extra")).toBe(
      "## Notes extra\n## Notes extra",
    );
  });

  it("leaves text alone where the replacement is the same", () => {
    expect(replacementsIn("aaa", textMatcher({ ...plain, query: "a" }), "a")).toEqual([]);
  });

  it("matches nothing for an invalid regular expression", () => {
    const matcher = textMatcher({ ...plain, useRegex: true, query: "(" });
    expect(matcher.error).not.toBeNull();
    expect(replacementsIn("(((", matcher, "x")).toEqual([]);
  });
});
