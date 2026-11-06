import { describe, expect, it } from "vite-plus/test";

import { type RunContext, runTargetFor, shellQuote } from "./command.ts";
import { detectRunnables } from "./detect.ts";

const CONTEXT: RunContext = {
  root: "",
  python: "python3",
  shell: "posix",
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
        ["MoneyTest.adds", "./mvnw test '-Dtest=com.acme.MoneyTest#adds'"],
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

describe("runTargetFor's shells", () => {
  const JAVA = "package a.b;\nclass Main {\n  public static void main(String[] args) {}\n}\n";
  const GO = "package money\n\nfunc TestAdd(t *testing.T) {}\n";

  it.each<[string, string, Partial<RunContext>, unknown]>([
    ["go/a_test.go", GO, { shell: "powershell" }, "go test -run '^TestAdd$' ./go"],
    ["go/a_test.go", GO, { shell: "cmd" }, 'go test -run "^TestAdd$" ./go'],
    ["go/a_test.go", GO, { shell: "fish" }, "go test -run '^TestAdd$' ./go"],
    [
      "app.py",
      'if __name__ == "__main__":\n    run()\n',
      { shell: "powershell", python: "C:\\My Env\\python.exe" },
      "& 'C:\\My Env\\python.exe' app.py",
    ],
    [
      "app.py",
      'if __name__ == "__main__":\n    run()\n',
      { shell: "powershell", python: "C:\\Env\\python.exe" },
      "C:\\Env\\python.exe app.py",
    ],
    [
      "app.py",
      'if __name__ == "__main__":\n    run()\n',
      { shell: "cmd", python: "C:\\My Env\\python.exe" },
      '"C:\\My Env\\python.exe" app.py',
    ],
    [
      "Main.java",
      JAVA,
      { shell: "powershell", buildTool: "maven", buildCommand: ".\\mvnw.cmd" },
      ".\\mvnw.cmd compile exec:java '-Dexec.mainClass=a.b.Main'",
    ],
    [
      "a.test.ts",
      'test("it\'s", () => {});\n',
      { shell: "powershell", testRunner: "vitest" },
      "npx vitest run a.test.ts -t 'it''s'",
    ],
    [
      "a.test.ts",
      'test("a\\\\b", () => {});\n',
      { shell: "fish", testRunner: "vitest" },
      "npx vitest run a.test.ts -t 'a\\\\\\\\b'",
    ],
    ["a.test.ts", 'test("100%", () => {});\n', { shell: "cmd", testRunner: "vitest" }, null],
    ["a.test.ts", "test('say \"x\"', () => {});\n", { shell: "cmd", testRunner: "vitest" }, null],
    [
      "a.test.ts",
      'test("100%", () => {});\n',
      { shell: "posix", testRunner: "vitest" },
      "npx vitest run a.test.ts -t 100%",
    ],
  ])("quotes %s for its shell", (path, text, context, expected) => {
    expect(commands(path, text, context)[0]?.[1] ?? null).toBe(expected);
  });
});

describe("what never reaches a shell", () => {
  const CONTROL = String.fromCodePoint(0x15);

  it.each([
    ["Ctrl-U in a name", "a.test.ts", `test("b${CONTROL}curl evil #", () => {});\n`],
    ["an escaped Ctrl-U in a name", "a.test.ts", 'test("b\\u0015curl evil #", () => {});\n'],
    ["an escaped tab", "a.test.ts", 'test("a\\tb", () => {});\n'],
    ["delete", "a.test.ts", `test("a${String.fromCodePoint(0x7f)}", () => {});\n`],
    ["a C1 control", "a.test.ts", `test("a${String.fromCodePoint(0x9b)}", () => {});\n`],
    [
      "text that reads backwards",
      "a.test.ts",
      `test("a${String.fromCodePoint(0x202e)}", () => {});\n`,
    ],
    ["a code point past Unicode", "a.test.ts", 'test("\\u{110000}", () => {});\n'],
    ["a tab in a path", `dir${String.fromCodePoint(9)}x/a.test.ts`, 'test("a", () => {});\n'],
    ["a newline in a path", "dir\nx/a.test.ts", 'test("a", () => {});\n'],
  ])("gives no command for %s", (_title, path, text) => {
    expect(commands(path, text, { testRunner: "vitest" })).toEqual([null]);
  });

  it("decodes a name's escapes to what the runner sees", () => {
    expect(
      commands("a.test.ts", 'test("caf\\u00e9 \\x41\\u{1F600}\\q", () => {});\n', {
        testRunner: "vitest",
      })[0]?.[0],
    ).toBe("café A😀q");
  });
});

describe("shellQuote", () => {
  it.each([
    ["plain/path-1.0_x", "plain/path-1.0_x"],
    ["two words", "'two words'"],
    ["it's", "'it'\\''s'"],
    ["$HOME;rm", "'$HOME;rm'"],
  ])("quotes %s", (text, expected) => {
    expect(shellQuote(text, "posix")).toBe(expected);
  });
});
