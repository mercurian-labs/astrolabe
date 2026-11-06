import { isRunnableText, type ShellFamily, shellQuote } from "./command.ts";
import type { RunKind } from "./detect.ts";

/**
 * Astrolabe: what a language server says can run in a file. rust-analyzer's answer is a whole
 * command, knowing the package, target and test path; gopls's lenses name the test.
 */

// LSP messages are untyped JSON; each use checks the shape it reads.
type Json = any;

interface Position {
  readonly line: number;
  readonly character: number;
}

export interface LspRange {
  readonly start: Position;
  readonly end: Position;
}

export interface RustRunnable {
  /** Where its name is, for the marker. */
  readonly at: Position;
  /** All of it, attributes included. */
  readonly range: LspRange;
  readonly kind: RunKind;
  readonly name: string;
  readonly command: string;
  readonly directory: string;
}

const RUST_LABELS: ReadonlyArray<readonly [RegExp, RunKind]> = [
  [/^test-mod\s+/, "suite"],
  [/^(?:test|doctest)\s+/, "test"],
  [/^bench\s+/, "benchmark"],
  [/^run\s+/, "main"],
];

/** The folder within `checkout`, "" at its root; null outside it. */
function folderWithin(checkout: string, folder: string): string | null {
  const relative = folder === checkout ? "" : folder.startsWith(`${checkout}/`) ? folder : null;
  if (relative === null) return null;
  return relative === "" ? "" : relative.slice(checkout.length + 1);
}

/** `experimental/runnables`' answer; those with no place in the file aren't a marker's. */
export function rustRunnables(
  answer: Json,
  checkout: string,
  shell: ShellFamily,
): readonly RustRunnable[] {
  if (!Array.isArray(answer)) return [];
  return answer.flatMap((runnable: Json): RustRunnable[] => {
    const { args, location, label } = runnable ?? {};
    const range = location?.targetRange;
    const at = location?.targetSelectionRange?.start;
    if (runnable?.kind !== "cargo" || !Array.isArray(args?.cargoArgs) || !range || !at) return [];
    const matched = RUST_LABELS.find(([pattern]) => pattern.test(String(label)));
    if (matched === undefined) return [];
    const directory = folderWithin(checkout, String(args.cwd ?? args.workspaceRoot ?? checkout));
    if (directory === null) return [];
    const words = (args.cargoArgs as ReadonlyArray<unknown>).map(String);
    const after = Array.isArray(args.executableArgs) ? args.executableArgs.map(String) : [];
    const program = typeof args.overrideCargo === "string" ? args.overrideCargo : "cargo";
    const typed = [String(label), directory, program, ...words, ...after];
    if (!typed.every((text) => isRunnableText(text, shell))) return [];
    const quote = (text: string) => shellQuote(text, shell);
    return [
      {
        at,
        range,
        kind: matched[1],
        name:
          matched[1] === "main"
            ? String(label).replace(/^run/, "Run")
            : String(label).replace(matched[0], ""),
        command: [
          ...[program, ...words].map(quote),
          ...(after.length > 0 ? ["--", ...after.map(quote)] : []),
        ].join(" "),
        directory,
      },
    ];
  });
}

export interface GoTestLens {
  readonly range: LspRange;
  readonly kind: "test" | "benchmark";
  readonly name: string;
}

const GO_RUN_TESTS = "gopls.run_tests";

/** A lens that a marker stands for, so a row of the same text would only repeat it. */
export const isRunLens = (command: { readonly command: string }) =>
  command.command === GO_RUN_TESTS;

/**
 * gopls's test lenses, one per test or benchmark. Its "run file benchmarks" lens sits on the
 * `package` line, naming them all, so one benchmark alone would read as that line's.
 */
export function goTestLenses(lenses: Json): readonly GoTestLens[] {
  if (!Array.isArray(lenses)) return [];
  return lenses.flatMap((lens: Json): GoTestLens[] => {
    if (lens?.command?.command !== GO_RUN_TESTS || !lens.range) return [];
    if (/\bfile\b/.test(String(lens.command.title))) return [];
    const { Tests: tests, Benchmarks: benchmarks } = lens.command.arguments?.[0] ?? {};
    const test = Array.isArray(tests) ? tests : [];
    const benchmark = Array.isArray(benchmarks) ? benchmarks : [];
    if (test.length + benchmark.length !== 1) return [];
    return [
      {
        range: lens.range,
        kind: test.length === 1 ? "test" : "benchmark",
        name: String(test[0] ?? benchmark[0]),
      },
    ];
  });
}
