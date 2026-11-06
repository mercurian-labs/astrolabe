import { describe, expect, it } from "vite-plus/test";

import { type RunContext, runTargetFor, shellQuote } from "./command.ts";
import { detectRunnables } from "./detect.ts";

const CONTEXT: RunContext = {
  root: "",
  python: "python3",
  testRunner: null,
  packageRunner: "npx",
  buildTool: null,
  buildCommand: null,
};

const commands = (path: string, text: string, context: Partial<RunContext> = {}) => {
  const file = detectRunnables(path, text)!;
  return file.items.map((item) => {
    const target = runTargetFor(file, item, path, { ...CONTEXT, ...context });
    return target && [target.name, target.command];
  });
};

const RUST = `fn main() {}

#[cfg(test)]
mod tests {
    #[test]
    fn adds() {}
}
`;

describe("runTargetFor", () => {
  it.each<[string, string, Partial<RunContext>, unknown]>([
    [
      "src/main.rs",
      RUST,
      {},
      [
        ["Run main.rs", "cargo run"],
        ["tests", "cargo test tests"],
        ["tests::adds", "cargo test tests::adds"],
      ],
    ],
    [
      "crates/core/src/bin/tool.rs",
      "fn main() {}\n",
      { root: "crates/core" },
      [["Run tool.rs", "cargo run --bin tool"]],
    ],
    ["examples/demo.rs", "fn main() {}\n", {}, [["Run demo.rs", "cargo run --example demo"]]],
    ["tests/api.rs", "#[test]\nfn works() {}\n", {}, [["works", "cargo test --test api works"]]],
    ["benches/fast.rs", "#[bench]\nfn fast() {}\n", {}, [["fast", "cargo bench fast"]]],
    [
      "pkg/money/money_test.go",
      "package money\n\nfunc TestAdd(t *testing.T) {}\nfunc BenchmarkAdd(b *testing.B) {}\n",
      {},
      [
        ["TestAdd", "go test -run '^TestAdd$' ./pkg/money"],
        ["BenchmarkAdd", "go test -run '^$' -bench '^BenchmarkAdd$' ./pkg/money"],
      ],
    ],
    [
      "money_test.go",
      "package money\n\nfunc TestAdd(t *testing.T) {}\n",
      {},
      [["TestAdd", "go test -run '^TestAdd$' ."]],
    ],
    ["main.go", "package main\n\nfunc main() {}\n", {}, [["Run main.go", "go run ."]]],
    [
      "cmd/tool/main.go",
      "package main\n\nfunc main() {}\n",
      {},
      [["Run main.go", "go run ./cmd/tool"]],
    ],
    [
      "services/api/tests/test_money.py",
      "class TestMoney:\n    def test_adds(self):\n        pass\n",
      { root: "services/api", python: "/repo/My Env/bin/python" },
      [
        ["TestMoney", "'/repo/My Env/bin/python' -m pytest tests/test_money.py::TestMoney"],
        [
          "TestMoney.test_adds",
          "'/repo/My Env/bin/python' -m pytest tests/test_money.py::TestMoney::test_adds",
        ],
      ],
    ],
    ["app.py", 'if __name__ == "__main__":\n    run()\n', {}, [["Run app.py", "python3 app.py"]]],
    [
      "src/money.test.ts",
      'describe("money", () => {\n  it("adds (two)", () => {});\n});\n',
      { testRunner: "vitest" },
      [
        ["money", "npx vitest run src/money.test.ts -t money"],
        ["money adds (two)", "npx vitest run src/money.test.ts -t 'money adds \\(two\\)'"],
      ],
    ],
    [
      "packages/web/src/a.test.tsx",
      'test("it\'s fine", () => {});\n',
      { root: "packages/web", testRunner: "jest", packageRunner: "pnpm exec" },
      [["it's fine", `pnpm exec jest src/a.test.tsx -t 'it'\\''s fine'`]],
    ],
    [
      "a.test.ts",
      'test("adds", () => {});\n',
      { testRunner: "vp" },
      [["adds", "vp test run a.test.ts -t adds"]],
    ],
    [
      "a.test.ts",
      'import { describe, it } from "node:test";\ndescribe("a", () => {\n  it("b", () => {});\n});\n',
      { testRunner: "vitest" },
      [
        ["a", "node --test --test-name-pattern=a a.test.ts"],
        ["a b", "node --test --test-name-pattern=b a.test.ts"],
      ],
    ],
    ["a.test.ts", 'test("no runner", () => {});\n', {}, [null]],
    [
      "src/test/java/com/acme/MoneyTest.java",
      "package com.acme;\nclass MoneyTest {\n  @Test\n  void adds() {}\n}\n",
      { buildTool: "maven", buildCommand: "./mvnw" },
      [
        ["MoneyTest", "./mvnw test -Dtest=com.acme.MoneyTest"],
        ["MoneyTest.adds", "./mvnw test -Dtest='com.acme.MoneyTest#adds'"],
      ],
    ],
    [
      "app/src/test/java/MoneyTest.java",
      "class MoneyTest {\n  @Test\n  void adds() {}\n}\n",
      { root: "app", buildTool: "gradle", buildCommand: "../gradlew" },
      [
        ["MoneyTest", "../gradlew test --tests MoneyTest"],
        ["MoneyTest.adds", "../gradlew test --tests MoneyTest.adds"],
      ],
    ],
    [
      "src/main/java/com/acme/Main.java",
      "package com.acme;\nclass Main {\n  public static void main(String[] args) {}\n}\n",
      { buildTool: "maven", buildCommand: "mvn" },
      [["Run Main.java", "mvn compile exec:java -Dexec.mainClass=com.acme.Main"]],
    ],
    [
      "src/Main.java",
      "class Main {\n  public static void main(String... args) {}\n}\n",
      { buildTool: "gradle", buildCommand: "gradle" },
      [["Run Main.java", "gradle run"]],
    ],
    [
      "Main.java",
      "class Main {\n  public static void main(String[] args) {}\n}\n",
      {},
      [["Run Main.java", "java Main.java"]],
    ],
    ["MoneyTest.java", "class MoneyTest {\n  @Test\n  void adds() {}\n}\n", {}, [null, null]],
  ])("builds for %s", (path, text, context, expected) => {
    expect(commands(path, text, context)).toEqual(expected);
  });

  it("refuses a file outside the root it was told", () => {
    expect(commands("src/main.rs", "fn main() {}\n", { root: "crates/core" })).toEqual([null]);
  });

  it("runs from the root it was told", () => {
    const file = detectRunnables("crates/core/src/main.rs", "fn main() {}\n")!;
    const context = { ...CONTEXT, root: "crates/core" };
    expect(runTargetFor(file, file.items[0]!, "crates/core/src/main.rs", context)?.directory).toBe(
      "crates/core",
    );
  });
});

describe("shellQuote", () => {
  it.each([
    ["plain/path-1.0_x", "plain/path-1.0_x"],
    ["two words", "'two words'"],
    ["it's", "'it'\\''s'"],
    ["$HOME;rm", "'$HOME;rm'"],
  ])("quotes %s", (text, expected) => {
    expect(shellQuote(text)).toBe(expected);
  });
});
