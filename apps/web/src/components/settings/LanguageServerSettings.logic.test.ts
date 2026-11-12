import { describe, expect, it } from "vite-plus/test";

import {
  type CustomFormFields,
  customFormFields,
  describeOverrides,
  EMPTY_CUSTOM_FORM,
  moved,
  parseCustomForm,
  parseServerForm,
  type ServerFormFields,
  serverFormFields,
} from "./LanguageServerSettings.logic";

const blank = serverFormFields(undefined);

describe("parseServerForm", () => {
  it("keeps what was typed, and whether the server was on, at that scope", () => {
    const result = parseServerForm(
      {
        binary: " /opt/bin/server ",
        args: "--stdio\n\n  --log=2 \n",
        env: "A=1\nB=x=y\n",
        initializationOptions: '{"a":{"b":1}}',
        settings: "",
      },
      false,
    );
    expect(result).toEqual({
      override: {
        enabled: false,
        binary: "/opt/bin/server",
        args: ["--stdio", "--log=2"],
        env: { A: "1", B: "x=y" },
        initializationOptions: { a: { b: 1 } },
      },
    });
  });

  it("clears a server's settings when nothing is left in the form", () => {
    expect(parseServerForm(blank, undefined)).toEqual({ override: {} });
  });

  it.each<[keyof ServerFormFields, string, RegExp]>([
    ["initializationOptions", "{ not json", /JSON|expected|property/i],
    ["initializationOptions", "[1]", /JSON object/],
    ["settings", "3", /JSON object/],
    ["settings", "null", /JSON object/],
    ["env", "NOPE", /NAME=value/],
    ["env", "1BAD=x", /NAME=value/],
    ["binary", "relative/server", /full path/],
  ])("puts a bad %s at its field: %s", (field, text, says) => {
    const result = parseServerForm({ ...blank, [field]: text }, undefined);
    expect("errors" in result && result.errors[field]).toMatch(says);
  });

  it("reads a stored server's settings back as they were typed", () => {
    const override = {
      binary: "server",
      args: ["--a", "--b"],
      env: { A: "1" },
      settings: { x: { y: true } },
    };
    expect(parseServerForm(serverFormFields(override), undefined)).toEqual({ override });
  });
});

describe("parseCustomForm", () => {
  const form = {
    ...EMPTY_CUSTOM_FORM,
    name: "Mine",
    command: "mine-ls",
    extensions: ".FOO foo\nbar",
  };

  it("takes a language id per extension, each defaulting to the extension", () => {
    expect(parseCustomForm({ ...form, args: "--stdio", rootFiles: "foo.toml" })).toEqual({
      server: {
        name: "Mine",
        command: "mine-ls",
        args: ["--stdio"],
        env: {},
        languageIds: { foo: "foo", bar: "bar" },
        rootFiles: ["foo.toml"],
        replaces: false,
      },
    });
  });

  it.each<[keyof CustomFormFields, Partial<CustomFormFields>, RegExp]>([
    ["name", { name: " " }, /name/],
    ["command", { command: "" }, /what to run/],
    ["command", { command: "./here" }, /full path/],
    ["extensions", { extensions: "" }, /at least one/],
    ["extensions", { extensions: "a/b" }, /isn't a file extension/],
    ["env", { env: "x" }, /NAME=value/],
    ["rootFiles", { rootFiles: "../up" }, /inside the checkout/],
  ])("puts a bad %s at its field", (field, patch, says) => {
    const result = parseCustomForm({ ...form, ...patch });
    expect("errors" in result && result.errors[field]).toMatch(says);
  });

  it("reads a stored server back for editing", () => {
    const parsed = parseCustomForm(form);
    if (!("server" in parsed)) throw new Error("expected a server");
    const stored = { id: "custom:mine", ...parsed.server } as const;
    expect(parseCustomForm(customFormFields(stored))).toEqual(parsed);
  });
});

it("names what's overridden and where from", () => {
  expect(
    describeOverrides({
      overrides: [
        { field: "args", source: "project" },
        { field: "settings", source: "file" },
        { field: "enabled", source: "machine" },
      ],
    }),
  ).toBe(
    "Arguments from this project, Settings from .astrolabe/language-servers.json, On or off from all projects",
  );
});

it("moves a server a place, and no further than the ends", () => {
  expect(moved(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
  expect(moved(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
  expect(moved(["a", "b"], "a", -1)).toEqual(["a", "b"]);
  expect(moved(["a", "b"], "b", 1)).toEqual(["a", "b"]);
});
