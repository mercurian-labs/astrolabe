// @effect-diagnostics nodeBuiltinImport:off - fixtures are files beside the test.
/**
 * Bases against Obsidian itself. `fixtures/obsidian-parity/vault` was opened in Obsidian 1.14.4
 * and every view exported as CSV into `expected/`; REPORT.md records what the CSVs don't carry
 * (summaries, group headings), which the tables below transcribe. Obsidian ran in
 * America/New_York, so the dates here do too.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  baseCorpus,
  parseBase,
  queryBase,
  type BaseCell,
  type BaseFile,
  type BaseResult,
} from "./index.ts";

process.env.TZ = "America/New_York";

const ROOT = new URL("./fixtures/obsidian-parity/", import.meta.url).pathname;
const VAULT = NodePath.join(ROOT, "vault");
const NOW = Date.parse("2026-11-02T12:00:00.000Z");

const walk = (folder: string): string[] =>
  NodeFS.readdirSync(NodePath.join(VAULT, folder), { withFileTypes: true }).flatMap((entry) => {
    const path = folder ? `${folder}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walk(path) : [path];
  });

const FILES: BaseFile[] = walk("").map((file) => {
  const bytes = NodeFS.readFileSync(NodePath.join(VAULT, file));
  const text = /\.(md|canvas|base)$/.test(file);
  return text ? { file, source: bytes.toString("utf8") } : { file, size: bytes.length };
});
const CORPUS = baseCorpus(FILES);

const run = (base: string, view: string): BaseResult =>
  queryBase(CORPUS, parseBase(NodeFS.readFileSync(NodePath.join(VAULT, `${base}.base`), "utf8")), {
    view,
    self: `${base}.base`,
    now: NOW,
  });

const field = (text: string) => (/[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text);
const cellText = (value: BaseCell | undefined): string =>
  value === null || value === undefined
    ? ""
    : Array.isArray(value)
      ? value.map((item) => (item === null ? "" : String(item))).join(", ")
      : String(value);

/** A result as Obsidian's Export CSV writes one: a header, then a line per row. */
const csv = (result: BaseResult): string[] => [
  result.columns.map((column) => field(column.label)).join(","),
  ...result.rows.map((row) =>
    result.columns.map((column) => field(cellText(row.values[column.id]))).join(","),
  ),
];

const expected = (base: string, view: string): string[] =>
  NodeFS.readFileSync(NodePath.join(ROOT, "expected", `${base} - ${view}.csv`), "utf8").split("\n");

// Grouped views export rows in their sort order, not under their groups as the screen shows them.
const VIEWS: ReadonlyArray<readonly [string, string, "ordered" | "grouped"]> = [
  ["Files", "Every file", "ordered"],
  ["Files", "In projects", "ordered"],
  ["Files", "Not notes", "ordered"],
  ["Files", "File fields", "ordered"],
  ["Strings", "Text", "ordered"],
  ["Strings", "Tests", "ordered"],
  ["Numbers", "Numbers", "ordered"],
  ["Lists", "Lists", "ordered"],
  ["Dates", "Dates", "ordered"],
  ["Links", "Links", "ordered"],
  ["Formulas", "Weighted", "ordered"],
  ["Formulas", "By bucket", "grouped"],
  ["Summaries", "Number summaries", "ordered"],
  ["Summaries", "More number summaries", "ordered"],
  ["Summaries", "Min max range", "ordered"],
  ["Summaries", "Date and check summaries", "ordered"],
  ["Summaries", "Other summaries", "ordered"],
  ["Summaries", "Grouped summaries", "grouped"],
  ["Groups", "By status", "grouped"],
  ["Groups", "Only open and closed", "grouped"],
  ["Groups", "With ungrouped", "grouped"],
  ["Groups", "By folder", "grouped"],
  ["Groups", "As a list", "ordered"],
  ["Groups", "As a board", "grouped"],
  ["Groups", "As cards", "ordered"],
];

describe("parity with Obsidian 1.14.4", () => {
  it.each(VIEWS)("%s / %s gives Obsidian's rows and cells", (base, view, kind) => {
    const ours = csv(run(base, view));
    const theirs = expected(base, view);
    if (kind === "ordered") expect(ours).toEqual(theirs);
    else {
      expect(ours[0]).toEqual(theirs[0]);
      expect(ours.slice(1).toSorted()).toEqual(theirs.slice(1).toSorted());
    }
  });

  it("groups as Obsidian's screen does, groupOrder showing only the groups it lists", () => {
    const groups = (base: string, view: string) => {
      const result = run(base, view);
      return result.groups.map((group) => [
        group.value,
        result.rows.filter((row) => row.group === group.value).map((row) => row.name),
      ]);
    };
    expect(groups("Groups", "By status")).toEqual([
      ["open", ["Gamma", "Alpha", "Delta"]],
      ["closed", ["Beta"]],
      ["archived", ["Epsilon"]],
      [null, ["Priya", "README", "Sam", "Untitled"]],
    ]);
    expect(groups("Groups", "Only open and closed")).toEqual([
      ["closed", ["Beta"]],
      ["open", ["Alpha", "Delta", "Gamma"]],
    ]);
    expect(groups("Groups", "With ungrouped")).toEqual([
      ["open", ["Alpha", "Delta", "Gamma"]],
      [null, ["Priya", "README", "Sam", "Untitled"]],
    ]);
    expect(groups("Groups", "By folder")).toEqual([
      ["/", ["Alpha", "Beta"]],
      ["projects", ["Delta"]],
      ["projects/archive", ["Epsilon"]],
    ]);
    expect(groups("Groups", "As a board")).toEqual([
      ["archived", ["Epsilon"]],
      ["closed", ["Beta"]],
      ["open", ["Alpha", "Delta", "Gamma"]],
    ]);
    expect(groups("Formulas", "By bucket")).toEqual([
      ["heavy", ["Alpha", "Delta"]],
      ["light", ["Gamma"]],
    ]);
  });

  it("summarizes each column as Obsidian displays it, per group too", () => {
    const summaries = (view: string) =>
      run("Summaries", view).summaries.map(({ column, name, value }) => [column, name, value]);
    expect(summaries("Number summaries")).toEqual([
      ["priority", "Sum", "11"],
      ["score", "Average", "2.25"],
      ["formula.double", "doubled_total", "44"],
    ]);
    expect(summaries("More number summaries")).toEqual([
      ["priority", "Median", "2"],
      ["score", "Stddev", "4.36"],
    ]);
    expect(summaries("Min max range")).toEqual([
      ["priority", "Min", "0"],
      ["score", "Max", "10"],
      ["due", "Range", "2 years"],
    ]);
    expect(summaries("Date and check summaries")).toEqual([
      ["due", "Earliest", "2024-02-29T00:00:00"],
      ["done", "Checked", "2"],
      ["status", "Unique", "3"],
      ["owner", "Filled", "3"],
    ]);
    expect(summaries("Other summaries")).toEqual([
      ["due", "Latest", "2025-12-31T14:30:00"],
      ["done", "Unchecked", "3"],
      ["owner", "Empty", "2"],
      ["status", "how_many", "5"],
    ]);
    const grouped = run("Summaries", "Grouped summaries");
    expect(grouped.groups.map((group) => [group.value, group.summaries[0]?.value])).toEqual([
      ["archived", "0"],
      ["closed", "1"],
      ["open", "10"],
    ]);
    expect(grouped.summaries[0]?.value).toBe("11");
  });
});
