import { describe, expect, it } from "vite-plus/test";

import {
  checkVimrc,
  createVimrcApplier,
  parseVimrc,
  removeVimrcMapping,
  setVimrcOption,
  upsertVimrcMapping,
  vimrcMappings,
  vimrcOptions,
  type VimrcTarget,
} from "./vimrc.ts";

/** A stand-in for `Vim`: a keymap with user mappings first, and two options. */
function fakeVim() {
  const keymap: Array<{ lhs: string; rhs: string; context: string | undefined; noremap: boolean }> =
    [];
  const options = new Map<string, unknown>([
    ["textwidth", 80],
    ["pcre", true],
  ]);
  const target: VimrcTarget = {
    map: (lhs, rhs, context) => keymap.unshift({ lhs, rhs, context, noremap: false }),
    noremap: (lhs, rhs, context) => keymap.unshift({ lhs, rhs, context, noremap: true }),
    unmap: (lhs, context) => {
      const at = keymap.findIndex((entry) => entry.lhs === lhs && entry.context === context);
      if (at !== -1) keymap.splice(at, 1);
    },
    setOption: (name, value) => {
      if (!options.has(name)) return new Error(`Unknown option: ${name}`);
      options.set(name, value);
      return undefined;
    },
    getOption: (name) =>
      options.has(name) ? options.get(name) : new Error(`Unknown option: ${name}`),
  };
  return { keymap, options, target };
}

describe("parseVimrc", () => {
  it("reads maps with their modes, unmaps, sets, and skips comments and blank lines", () => {
    const { commands, errors } = parseVimrc(
      [
        '" a comment',
        "",
        "nnoremap j gj",
        ":imap jk <Esc>",
        "xmap s  S )",
        "nunmap j",
        "set tw=100 nopcre",
      ].join("\n"),
    );
    expect(errors).toEqual([]);
    expect(commands).toEqual([
      { kind: "map", line: 3, lhs: "j", rhs: "gj", context: "normal", noremap: true },
      { kind: "map", line: 4, lhs: "jk", rhs: "<Esc>", context: "insert", noremap: false },
      { kind: "map", line: 5, lhs: "s", rhs: "S )", context: "visual", noremap: false },
      { kind: "unmap", line: 6, lhs: "j", context: "normal" },
      { kind: "set", line: 7, name: "tw", value: "100" },
      { kind: "set", line: 7, name: "pcre", value: false },
    ]);
  });

  it("gives an error on each line it cannot read", () => {
    expect(parseVimrc("nmap j\nlet mapleader = ','\nset").errors).toEqual([
      { line: 1, message: "nmap needs a key and what it maps to" },
      { line: 2, message: "Not supported here: let" },
      { line: 3, message: "set needs an option" },
    ]);
  });
});

describe("createVimrcApplier", () => {
  it("applies maps and options, and reports what it could not apply on its line", () => {
    const vim = fakeVim();
    const apply = createVimrcApplier(vim.target);
    const errors = apply(
      [
        "nnoremap j gj",
        "set textwidth=100",
        "set nosuchoption",
        "set textwidth=wide",
        "nunmap k",
        "set textwidth",
      ].join("\n"),
    );
    expect(vim.keymap).toEqual([{ lhs: "j", rhs: "gj", context: "normal", noremap: true }]);
    expect(vim.options.get("textwidth")).toBe(100);
    expect(errors).toEqual([
      { line: 3, message: "Unknown option: suchoption" },
      { line: 4, message: "Invalid argument: textwidth" },
      { line: 5, message: "No such mapping: k" },
      { line: 6, message: "Invalid argument: textwidth" },
    ]);
  });

  it("undoes the last vimrc's mappings and options before applying the next", () => {
    const vim = fakeVim();
    const apply = createVimrcApplier(vim.target);
    apply("nmap j gj\nimap jk <Esc>\nset nopcre\nset textwidth=100");
    expect(vim.keymap).toHaveLength(2);
    apply("nmap k gk");
    expect(vim.keymap).toEqual([{ lhs: "k", rhs: "gk", context: "normal", noremap: false }]);
    expect(vim.options.get("pcre")).toBe(true);
    expect(vim.options.get("textwidth")).toBe(80);
    apply("");
    expect(vim.keymap).toEqual([]);
  });

  it("unmaps what the vimrc itself mapped, and reports a thrown error on its line", () => {
    const vim = fakeVim();
    const apply = createVimrcApplier({
      ...vim.target,
      map: (lhs, rhs, context) => {
        if (lhs.startsWith(":") && context) throw new Error("Mode not supported for ex mappings");
        vim.target.map(lhs, rhs, context);
      },
    });
    expect(apply("nmap j gj\nnunmap j\nnmap :W :w")).toEqual([
      { line: 3, message: "Mode not supported for ex mappings" },
    ]);
    expect(vim.keymap).toEqual([]);
  });
});

describe("checkVimrc", () => {
  it("reports what Vim would not apply, without a Vim", () => {
    expect(
      checkVimrc(
        [
          "set nopcre tw=100",
          "nmap :W :w",
          "set pcre=1",
          "set nosuchoption",
          "let mapleader = ','",
          "nunmap q",
          "map :W :w",
          "set ft=markdown",
        ].join("\n"),
      ),
    ).toEqual([
      { line: 2, message: "Mode not supported for ex mappings" },
      { line: 3, message: "Invalid argument: pcre" },
      { line: 4, message: "Unknown option: suchoption" },
      { line: 5, message: "Not supported here: let" },
      { line: 6, message: "No such mapping: q" },
    ]);
  });
});

describe("vimrcMappings", () => {
  it("lists the mappings in effect, by mode and keys, leaving out operator-pending ones", () => {
    const text = [
      '" mine',
      "inoremap jk <Esc>",
      "nmap H ^",
      "xnoremap s S )",
      "onoremap w iw",
      "noremap Q gq",
      "nnoremap H 0",
      "imap kj <Esc>",
      "iunmap kj",
    ].join("\n");
    expect(vimrcMappings(text)).toEqual([
      { mode: "insert", keys: "jk", does: "<Esc>", recursive: false, line: 2 },
      { mode: "normal", keys: "H", does: "0", recursive: false, line: 7 },
      { mode: "visual", keys: "s", does: "S )", recursive: false, line: 4 },
      { mode: "all", keys: "Q", does: "gq", recursive: false, line: 6 },
    ]);
  });
});

describe("upsertVimrcMapping", () => {
  const text = [
    '" Vim, my way',
    "set nopcre",
    "inoremap jk <Esc>",
    "let mapleader = ','",
    "nnoremap H ^",
    "",
  ].join("\n");

  it("adds a mapping at the end, keeping every other line as written", () => {
    expect(
      upsertVimrcMapping(text, {
        mode: "normal",
        keys: "<C-d>",
        does: "<C-d>zz",
        recursive: false,
      }),
    ).toBe(`${text}nnoremap <C-d> <C-d>zz\n`);
  });

  it("rewrites the mapping's own line in place, recursive when asked", () => {
    expect(
      upsertVimrcMapping(text, { mode: "insert", keys: "jk", does: "<Esc>l", recursive: true }),
    ).toBe(text.replace("inoremap jk <Esc>", "imap jk <Esc>l"));
  });

  it("moves a mapping to new keys or a new mode on the replaced one's line", () => {
    expect(
      upsertVimrcMapping(
        text,
        { mode: "all", keys: "L", does: "$", recursive: false },
        { mode: "normal", keys: "H" },
      ),
    ).toBe(text.replace("nnoremap H ^", "noremap L $"));
  });

  it("drops the mapping's other lines, unmaps included, so it is in effect once", () => {
    const repeated = "nmap j gj\nnunmap j\n:nnoremap j gk\n";
    expect(
      upsertVimrcMapping(repeated, { mode: "normal", keys: "j", does: "gj", recursive: false }),
    ).toBe("nnoremap j gj\n");
  });

  it("starts an empty file, and keeps a file's CRLF line ends", () => {
    expect(
      upsertVimrcMapping("", { mode: "insert", keys: "jk", does: "<Esc>", recursive: false }),
    ).toBe("inoremap jk <Esc>\n");
    expect(
      upsertVimrcMapping('" a\r\nset nopcre', {
        mode: "normal",
        keys: "H",
        does: "^",
        recursive: false,
      }),
    ).toBe('" a\r\nset nopcre\r\nnnoremap H ^');
  });
});

describe("removeVimrcMapping", () => {
  it("removes the mapping's lines and nothing else", () => {
    expect(
      removeVimrcMapping('" keep\nnmap H ^\nimap H x\nnunmap H\nlet x = 1\n', {
        mode: "normal",
        keys: "H",
      }),
    ).toBe('" keep\nimap H x\nlet x = 1\n');
  });
});

describe("vimrc options", () => {
  it("reads the options Settings offers by their last set, under any of their names", () => {
    expect(
      vimrcOptions(
        "set insertModeEscKeysTimeout=100 nopcre\nset pcre!\nset insertModeEscKeysTimeout=wide",
      ),
    ).toEqual({
      insertModeEscKeysTimeout: 100,
      pcre: true,
    });
    expect(vimrcOptions('" nothing set')).toEqual({});
  });

  it("sets an option on its first set line, leaving the line's other options", () => {
    const text =
      '" opts\nset insertModeEscKeysTimeout=100 nopcre\nset insertModeEscKeysTimeout=120\n';
    expect(setVimrcOption(text, { name: "insertModeEscKeysTimeout", value: 72 })).toBe(
      '" opts\nset nopcre\nset insertModeEscKeysTimeout=72\n',
    );
    expect(setVimrcOption(text, { name: "pcre", value: true })).toBe(
      '" opts\nset insertModeEscKeysTimeout=100\nset pcre\nset insertModeEscKeysTimeout=120\n',
    );
    expect(setVimrcOption('" opts\n', { name: "insertModeEscKeysTimeout", value: 300 })).toBe(
      '" opts\nset insertModeEscKeysTimeout=300\n',
    );
  });

  it("removes an option back to its default", () => {
    expect(
      setVimrcOption(
        'set insertModeEscKeysTimeout=100 nopcre\nset insertModeEscKeysTimeout=120\n" end\n',
        {
          name: "insertModeEscKeysTimeout",
          value: null,
        },
      ),
    ).toBe('set nopcre\n" end\n');
  });
});
