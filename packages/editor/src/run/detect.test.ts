import { describe, expect, it } from "vite-plus/test";

import { detectRunnables, type RunKind } from "./detect.ts";

const found = (path: string, text: string) =>
  detectRunnables(path, text)?.items.map(
    ({ kind, names, line }): readonly [RunKind, string, number] => [kind, names.join(" > "), line],
  );

describe("detectRunnables", () => {
  it.each([
    [
      "Rust's entry point, tests and test modules",
      "src/lib.rs",
      `fn main() {}

fn helper() {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds() {}

    /// Awaits.
    #[tokio::test]
    #[ignore]
    async fn waits() {}

    #[bench]
    fn fast(b: &mut Bencher) {}

    fn not_a_test() {}

    mod inner {
        #[test]
        pub fn deep() {}
    }
}
`,
      [
        ["main", "main", 1],
        ["suite", "tests", 6],
        ["test", "tests > adds", 10],
        ["test", "tests > waits", 15],
        ["benchmark", "tests > fast", 18],
        ["test", "tests > inner > deep", 24],
      ],
    ],
    [
      "Go's tests and benchmarks, by their signature",
      "pkg/money_test.go",
      `package money

func TestAdd(t *testing.T) {}
func TestMain(m *testing.M) {}
func Testable(t *testing.T) {}
func BenchmarkAdd(b *testing.B) {}
func helper(t *testing.T) {}
`,
      [
        ["test", "TestAdd", 3],
        ["benchmark", "BenchmarkAdd", 6],
      ],
    ],
    ["Go's main", "main.go", "package main\n\nfunc main() {\n}\n", [["main", "main", 3]]],
    ["a main outside package main", "lib.go", "package lib\n\nfunc main() {\n}\n", []],
    ["a test function outside a test file", "add.go", "func TestAdd(t *testing.T) {}\n", []],
    [
      "pytest's functions and classes",
      "tests/test_money.py",
      `def test_adds():
    def test_inner():
        pass

async def test_waits():
    pass

def helper():
    pass

class TestMoney:
    def test_rounds(self):
        pass

    def helper(self):
        pass

class Helper:
    def test_not_collected(self):
        pass

class MoneyCase(unittest.TestCase):
    def test_old_style(self):
        pass
`,
      [
        ["test", "test_adds", 1],
        ["test", "test_waits", 5],
        ["suite", "TestMoney", 11],
        ["test", "TestMoney > test_rounds", 12],
        ["suite", "MoneyCase", 22],
        ["test", "MoneyCase > test_old_style", 23],
      ],
    ],
    [
      "a def nested in a test, however its signature or comments run",
      "tests/test_nested.py",
      `class TestMoney:
    def test_outer(self):
        def test_helper():
            pass
        class TestInner:
            def test_in_a_function(self):
                pass

    def test_long(
        self,
    ):
        def test_after_signature():
            pass

# A comment at the margin ends nothing.
    def test_after_comment(self):
        pass
`,
      [
        ["suite", "TestMoney", 1],
        ["test", "TestMoney > test_outer", 2],
        ["test", "TestMoney > test_long", 9],
        ["test", "TestMoney > test_after_comment", 16],
      ],
    ],
    [
      "Python's entry point in any file",
      "app.py",
      `def test_not_collected():
    pass

if __name__ == "__main__":
    main()
`,
      [["main", "app.py", 4]],
    ],
    [
      "describes, tests and their modifiers",
      "src/money.test.ts",
      `import { describe, it } from "vitest";

describe("money", () => {
  it("adds \\"two\\"", () => {});
  it.only('rounds', () => {});
  it.effect(\`waits\`, () => {});

  describe.skip("nested", () => {
    test("deep", () => {});
  });
});

test("alone", () => {});
it.each([1, 2])("table %d", () => {});
it(\`made \${name}\`, () => {});
`,
      [
        ["suite", "money", 3],
        ["test", 'money > adds "two"', 4],
        ["test", "money > rounds", 5],
        ["test", "money > waits", 6],
        ["suite", "money > nested", 8],
        ["test", "money > nested > deep", 9],
        ["test", "alone", 13],
      ],
    ],
    ["a test call in a file no runner reads", "src/money.ts", 'test("alone", () => {});\n', []],
    [
      "a test file by what it imports",
      "test/money.mjs",
      'import test from "node:test";\n\ntest("alone", () => {});\n',
      [["test", "alone", 3]],
    ],
    [
      "JUnit's tests and main",
      "src/test/java/com/acme/MoneyTest.java",
      `package com.acme;

import org.junit.jupiter.api.Test;

public class MoneyTest {
    @Test
    void adds() {}

    @org.junit.Test
    @DisplayName("rounds")
    public void rounds() throws Exception {
    }

    void helper() {}

    @Nested
    class Inner {
        @ParameterizedTest
        void deep(int value) {}
    }

    public static void main(String[] args) {
    }
}
`,
      [
        ["suite", "com.acme.MoneyTest", 5],
        ["test", "com.acme.MoneyTest > adds", 7],
        ["test", "com.acme.MoneyTest > rounds", 11],
        ["suite", "com.acme.MoneyTest$Inner", 17],
        ["test", "com.acme.MoneyTest$Inner > deep", 19],
        ["main", "com.acme.MoneyTest", 22],
      ],
    ],
    ["a class with nothing to run", "src/Money.java", "class Money {\n  void add() {}\n}\n", []],
  ])("finds %s", (_title, path, text, expected) => {
    expect(found(path, text)).toEqual(expected);
  });

  it("leaves C and C++ alone, among what it doesn't run", () => {
    expect(detectRunnables("src/main.cpp", "int main() {}\n")).toBeNull();
    expect(detectRunnables("src/main.c", "int main() {}\n")).toBeNull();
    expect(detectRunnables("README", "fn main() {}\n")).toBeNull();
  });

  it("skips what the syntax tree says is a comment or a string", () => {
    const text = 'test("real", () => {});\n// test("commented", () => {});\n  test("in a string"\n';
    const lines = detectRunnables("a.test.ts", text, (line) => line === 1)!;
    expect(lines.items.map((item) => item.names)).toEqual([["real"]]);
  });

  it("spans a block, attributes included, for what the cursor is in", () => {
    const text = `#[test]
fn adds(
    a: u32,
) {
    body();
}

fn other() {}
`;
    expect(detectRunnables("src/lib.rs", text)!.items).toEqual([
      { kind: "test", names: ["adds"], line: 2, startLine: 1, endLine: 6 },
    ]);
  });

  it("says when a file runs under node:test, whatever its package says", () => {
    const text = 'import { test } from "node:test";\ntest("x", () => {});\n';
    expect(detectRunnables("a.test.ts", text)!.nodeTest).toBe(true);
    expect(detectRunnables("a.test.ts", 'test("x", () => {});\n')!.nodeTest).toBe(false);
  });
});
