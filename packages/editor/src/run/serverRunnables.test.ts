import { describe, expect, it } from "vite-plus/test";

import { goTestLenses, rustRunnables } from "./serverRunnables.ts";

const location = (line: number) => ({
  targetUri: "file:///repo/src/lib.rs",
  targetRange: { start: { line, character: 0 }, end: { line: line + 3, character: 1 } },
  targetSelectionRange: {
    start: { line: line + 1, character: 3 },
    end: { line: line + 1, character: 7 },
  },
});

const cargo = (cargoArgs: readonly string[], executableArgs: readonly string[], cwd = "/repo") => ({
  kind: "cargo",
  args: { cwd, workspaceRoot: "/repo", overrideCargo: null, cargoArgs, executableArgs },
});

describe("rustRunnables", () => {
  it("reads rust-analyzer's answer as whole commands", () => {
    const answer = [
      { label: "cargo check --workspace", ...cargo(["check", "--workspace"], []) },
      {
        label: "test tests::adds",
        location: location(11),
        ...cargo(
          ["test", "--package", "rsfix", "--lib"],
          ["tests::adds", "--exact", "--nocapture"],
          "/repo/crates/core",
        ),
      },
      {
        label: "test-mod tests",
        location: location(7),
        ...cargo(["test", "--lib"], ["tests", "--nocapture"]),
      },
      {
        label: "run rsfix",
        location: location(0),
        ...cargo(["run", "--package", "rsfix", "--bin", "rsfix"], []),
      },
      {
        label: "doctest doc",
        location: location(2),
        ...cargo(["test", "--doc"], ["doc thing", "--nocapture"]),
      },
    ];
    expect(
      rustRunnables(answer, "/repo").map(({ kind, name, command, directory, at }) => [
        kind,
        name,
        command,
        directory,
        at.line,
      ]),
    ).toEqual([
      [
        "test",
        "tests::adds",
        "cargo test --package rsfix --lib -- tests::adds --exact --nocapture",
        "crates/core",
        12,
      ],
      ["suite", "tests", "cargo test --lib -- tests --nocapture", "", 8],
      ["main", "Run rsfix", "cargo run --package rsfix --bin rsfix", "", 1],
      ["test", "doc", "cargo test --doc -- 'doc thing' --nocapture", "", 3],
    ]);
  });

  it("leaves out what runs outside the checkout, or isn't cargo", () => {
    const outside = {
      label: "test a",
      location: location(0),
      ...cargo(["test"], [], "/elsewhere"),
    };
    const shell = { label: "test b", location: location(0), kind: "shell", args: {} };
    expect(rustRunnables([outside, shell], "/repo")).toEqual([]);
    expect(rustRunnables(null, "/repo")).toEqual([]);
  });
});

describe("goTestLenses", () => {
  const range = { start: { line: 4, character: 0 }, end: { line: 4, character: 4 } };
  const lens = (args: object, command = "gopls.run_tests", title = "run test") => ({
    range,
    command: { title, command, arguments: [{ URI: "file:///a_test.go", ...args }] },
  });

  it("reads one test or benchmark from each lens", () => {
    expect(
      goTestLenses([
        lens({ Tests: ["TestAdd"], Benchmarks: null }),
        lens({ Tests: null, Benchmarks: ["BenchmarkAdd"] }),
        lens({ Tests: [], Benchmarks: ["BenchmarkA", "BenchmarkB"] }),
        lens({ Tests: null, Benchmarks: ["BenchmarkAdd"] }, undefined, "run file benchmarks"),
        lens({ Tests: ["TestAdd"] }, "gopls.tidy"),
        { range },
      ]),
    ).toEqual([
      { range, kind: "test", name: "TestAdd" },
      { range, kind: "benchmark", name: "BenchmarkAdd" },
    ]);
  });
});
