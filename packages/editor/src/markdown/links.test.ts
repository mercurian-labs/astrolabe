import { afterEach, describe, expect, it } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  caret,
  destroyViews,
  line,
  lines,
  mount,
  select,
  sourceText,
  texts,
} from "./testSupport.ts";
import { decodeDestination, defaultUrlPolicy } from "./url.ts";

afterEach(destroyViews);

const hrefs = (view: EditorView) =>
  [...view.contentDOM.querySelectorAll<HTMLElement>("[data-href]")].map(
    (element) => element.dataset.href,
  );

describe("links", () => {
  it("A24. `[word]` with no definition: brackets visible off-range and on-range, no link styling", () => {
    const view = mount("[word]");
    expect(sourceText(line(view, 1))).toBe("[word]");
    expect(view.contentDOM.querySelector(".cm-md-link")).toBeNull();
    const focused = mount("[word]", { focused: true, selection: [0] });
    expect(sourceText(line(focused, 1))).toBe("[word]");
    expect(focused.contentDOM.querySelector(".cm-md-syntax")).toBeNull();
  });

  it("A25. a shortcut reference resolves to its definition; brackets and the definition line hide off-range", () => {
    const view = mount("[shortcut ref]\n\n[shortcut ref]: https://x");
    expect(hrefs(view)).toEqual(["https://x"]);
    expect(sourceText(line(view, 1))).toBe("shortcut ref");
    expect(sourceText(line(view, 3))).toBe("");
  });

  it("A26. `[text][]//[text]: https://x`: resolves", () => {
    const view = mount("[text][]\n\n[text]: https://x");
    expect(hrefs(view)).toEqual(["https://x"]);
    expect(sourceText(line(view, 1))).toBe("text");
  });

  it("A27. two definitions of the same label: the first wins", () => {
    const view = mount("[a] and [b][A]\n\n[a]: https://first\n[A]: https://second");
    expect(hrefs(view)).toEqual(["https://first", "https://first"]);
  });

  it("A28. `[a](<https://x>)`: target `https://x`", () => {
    const view = mount("[a](<https://x>)");
    expect(hrefs(view)).toEqual(["https://x"]);
    expect(sourceText(line(view, 1))).toBe("a");
  });

  it("A29. angle autolinks hide their brackets; emails get mailto:, `www.` gets https://", () => {
    const view = mount("<https://x>\n\n<foo@bar.com>\n\nwww.x.com");
    expect(hrefs(view)).toEqual(["https://x", "mailto:foo@bar.com", "https://www.x.com"]);
    expect(sourceText(line(view, 1))).toBe("https://x");
    expect(sourceText(line(view, 3))).toBe("foo@bar.com");
    expect(sourceText(line(view, 5))).toBe("www.x.com");
  });

  it("A30. `[bad](javascript:alert(1))`: syntax hidden, no target, unsafe class present", () => {
    const view = mount("[bad](javascript:alert(1))");
    expect(sourceText(line(view, 1))).toBe("bad");
    expect(hrefs(view)).toEqual([]);
    expect(texts(view, ".cm-md-link-unsafe")).toEqual(["bad"]);
  });

  it("A31. `# A **b** [c](https://x)`: bold and link decorated inside the heading", () => {
    const view = mount("# A **b** [c](https://x)");
    expect(texts(view, ".cm-md-strong")).toEqual(["b"]);
    expect(hrefs(view)).toEqual(["https://x"]);
    expect(sourceText(line(view, 1))).toBe("A b c");
  });

  it("A32. `[![alt](https://i)](https://x)`: image rendered, link-styled, target `https://x`", () => {
    const view = mount("[![alt](https://i)](https://x)");
    const img = view.contentDOM.querySelector(".cm-md-image img");
    expect(img?.getAttribute("src")).toBe("https://i");
    expect(img?.closest(".cm-md-link")?.getAttribute("data-href")).toBe("https://x");
  });

  it.todo(
    "A33. Mod-click on a link opens it once with noopener,noreferrer and adds no cursor; plain click opens nothing (browser)",
  );

  it("A66. `[a](https://x)`, `<https://x>`, and `https://x` carry one external-link glyph off-range and none while revealed; `[a](notes/a.md)` carries none", () => {
    // GFM's bare-URL rule needs a dotted domain, so the bare case is `https://x.com`:
    // Lezer does not parse a bare `https://x` as a URL at all.
    for (const doc of ["[a](https://x)", "<https://x>", "https://x.com"]) {
      const view = mount(`${doc}\n\nnext`, { focused: true, selection: [doc.length + 2] });
      const glyphs = view.contentDOM.querySelectorAll(".cm-md-external");
      expect(glyphs, doc).toHaveLength(1);
      expect(glyphs[0]?.getAttribute("aria-hidden")).toBe("true");
      select(view, 1);
      expect(view.contentDOM.querySelectorAll(".cm-md-external"), `${doc} revealed`).toHaveLength(
        0,
      );
    }
    for (const doc of ["[a](notes/a.md)", "<me@x.com>", "[[Note]]", "[bad](javascript:x)"]) {
      expect(mount(doc).contentDOM.querySelectorAll(".cm-md-external"), doc).toHaveLength(0);
    }
  });

  it("A34. wikilinks show `Note`, `Alias`, `Note > Head`, carry the target as typed, and hide syntax off-range", () => {
    const view = mount("[[Note]] [[Note|Alias]] [[Note#Head]]");
    const targets = [...view.contentDOM.querySelectorAll<HTMLElement>(".cm-md-wikilink")].map(
      (element) => element.dataset.wikilink,
    );
    expect(targets).toEqual(["Note", "Note", "Note#Head"]);
    expect(line(view, 1).textContent).toBe("Note Alias Note > Head");
  });

  it("a plain click follows a wikilink only on a read-only document whose host opens links on click", () => {
    const click = (view: EditorView) => {
      const link = view.contentDOM.querySelector<HTMLElement>("[data-wikilink]");
      link?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    };
    const opened: string[] = [];
    const openWikilink = (target: string) => opened.push(target);
    const readOnly = [EditorState.readOnly.of(true)];
    // (An editable document places the caret instead, which happy-dom cannot replay.)
    click(mount("[[Note]]", { options: { openWikilink }, extensions: readOnly }));
    expect(opened).toEqual([]);
    click(
      mount("[[Note]]", {
        options: { openWikilink, linksOpenOnClick: true },
        extensions: readOnly,
      }),
    );
    expect(opened).toEqual(["Note"]);
  });

  it("A35. `![[Embed]]`: placeholder chip; `![[pic.png|200]]`: image with the host-resolved source", () => {
    const view = mount("![[Embed]]\n\n![[pic.png|200]]", {
      options: { resolveEmbed: (target) => `/vault/${target}` },
    });
    expect(texts(view, ".cm-md-embed-label")).toEqual(["Embed"]);
    // A chip wraps as one unit and never breaks inside itself.
    const chip = view.contentDOM.querySelector(".cm-md-embed");
    const label = view.contentDOM.querySelector(".cm-md-embed-label");
    expect(chip && getComputedStyle(chip).whiteSpace).toBe("nowrap");
    expect(label && getComputedStyle(label).whiteSpace).toBe("nowrap");
    // The chip's icon takes the shared 1em icon box, so it is not drawn at zero size.
    const icon = chip?.querySelector("svg");
    expect(icon?.classList.contains("cm-md-icon")).toBe(true);
    const iconStyle = icon ? getComputedStyle(icon) : null;
    // happy-dom resolves the 1em rule against the font size.
    expect(iconStyle?.width).toBe(iconStyle?.fontSize);
    expect(iconStyle?.width).not.toBe("0px");
    const img = view.contentDOM.querySelector(".cm-md-image img");
    expect(img?.getAttribute("src")).toBe("/vault/pic.png");
    expect(img?.getAttribute("width")).toBe("200");
    expect(img?.closest<HTMLElement>(".cm-md-image")?.dataset.embed).toBe("pic.png");
  });
});

describe("multi-line links and images", () => {
  it.each(["![one\ntwo](https://x/a.png)", "[x](\nhttps://x\n)"])(
    "renders %j unfocused and focused without replacing a line break",
    (doc) => {
      const view = mount(doc);
      expect(lines(view)).toHaveLength(doc.split("\n").length);
      expect(view.contentDOM.querySelector(".cm-md-image img")).toBeNull();
      const focused = mount(doc, { focused: true, selection: [1] });
      expect(lines(focused)).toHaveLength(doc.split("\n").length);
    },
  );

  it("hides a multi-line link's syntax per line", () => {
    const view = mount("[x](\nhttps://x\n)");
    expect(lines(view).map((element) => sourceText(element))).toEqual(["x", "", ""]);
    expect(hrefs(view)).toEqual(["https://x"]);
  });
});

describe("images", () => {
  it("A36. `![alt](https://x/a.png)`: image off-range; on-range the image stays and dimmed source precedes it", () => {
    const doc = "![alt](https://x/a.png)";
    const view = mount(doc);
    expect(view.contentDOM.querySelector(".cm-md-image img")?.getAttribute("src")).toBe(
      "https://x/a.png",
    );
    expect(sourceText(line(view, 1))).toBe("");

    const focused = mount(doc, { focused: true, selection: [0] });
    const source = focused.contentDOM.querySelector(".cm-md-syntax");
    const img = focused.contentDOM.querySelector(".cm-md-image img");
    expect(source?.textContent).toBe(doc);
    expect(img).not.toBeNull();
    if (source && img) {
      expect(source.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("a plain click on an image puts the caret at the image's source start, hidden or revealed", () => {
    const doc = "x ![alt](https://x/a.png)";
    for (const selection of [0, doc.length]) {
      const view = mount(doc, { focused: true, selection: [selection] });
      const image = view.contentDOM.querySelector(".cm-md-image");
      image?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
      );
      expect(caret(view), `caret from ${selection}`).toBe(2);
    }
  });

  it("A37. `![bad](javascript:1)`: broken-image placeholder with alt, source hidden", () => {
    const view = mount("![bad](javascript:1)");
    expect(view.contentDOM.querySelector(".cm-md-image img")).toBeNull();
    expect(texts(view, ".cm-md-image-broken")).toEqual(["bad"]);
    expect(sourceText(line(view, 1))).toBe("");
  });
});

describe("URL policy", () => {
  it("accepts web, mail, relative, and data:image targets and blocks the rest", () => {
    expect(defaultUrlPolicy(" https://x ", "link")).toBe("https://x");
    expect(defaultUrlPolicy("mailto:a@b.c", "link")).toBe("mailto:a@b.c");
    expect(defaultUrlPolicy("mailto:a@b.c", "image")).toBeNull();
    expect(defaultUrlPolicy("notes/a.md#top", "link")).toBe("notes/a.md#top");
    expect(defaultUrlPolicy("#top", "link")).toBe("#top");
    expect(defaultUrlPolicy("data:image/png;base64,AA", "image")).toBe("data:image/png;base64,AA");
    expect(defaultUrlPolicy("data:text/html,x", "image")).toBeNull();
    expect(defaultUrlPolicy("data:image/png;base64,AA", "link")).toBeNull();
    expect(defaultUrlPolicy("//evil.example", "link")).toBeNull();
    expect(defaultUrlPolicy("JavaScript:alert(1)", "link")).toBeNull();
    expect(defaultUrlPolicy("javascript&colon;alert(1)", "link")).toBeNull();
    expect(defaultUrlPolicy("java\tscript:alert(1)", "link")).toBeNull();
    expect(defaultUrlPolicy("vbscript:x", "link")).toBeNull();
    expect(defaultUrlPolicy("file:///etc/passwd", "link")).toBeNull();
  });

  it("blocks two leading slashes or backslashes in any mix, encoded or not", () => {
    for (const raw of ["/\\evil", "\\/evil", "\\\\evil", "&sol;&bsol;evil"]) {
      expect(defaultUrlPolicy(raw, "link"), raw).toBeNull();
      expect(defaultUrlPolicy(raw, "image"), raw).toBeNull();
    }
    expect(defaultUrlPolicy("/notes/a.md", "link")).toBe("/notes/a.md");
  });

  it("decodes the full, case-sensitive HTML5 entity set", () => {
    expect(decodeDestination("https://example.com/&copy;")).toBe("https://example.com/\u00a9");
    expect(decodeDestination("a&Tab;b")).toBe("a\tb");
    expect(decodeDestination("a&tab;b")).toBe("a&tab;b");
    expect(decodeDestination("&#x41;&#66;&notanentity;")).toBe("AB&notanentity;");
  });
});
