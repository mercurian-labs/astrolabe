import { describe, expect, it } from "vite-plus/test";

import { rekeyCatalog, type KeyHasher } from "./astrolabe-rekey-catalogs.ts";

describe("rekeyCatalog", () => {
  it("carries translations onto rebranded keys and rewrites the product name", () => {
    const result = rekeyCatalog({
      locale: "de",
      upstreamEn: {
        a: "Restart T3 Code",
        same: "Thread",
        gone: "Old",
        t: ["Open ", { c: "T3 Code" }],
      },
      upstreamLocale: {
        a: "T3 Code neu starten",
        same: "Thread",
        gone: "Alt",
        t: [{ c: "T3 Code" }, " öffnen"],
      },
      currentEn: {
        same: "Thread",
        b: "Restart Astrolabe",
        own: "Wikis",
        u: ["Open ", { c: "Astrolabe" }],
      },
      currentLocale: {
        same: "Thread",
        b: "Restart Astrolabe",
        own: "Wikis",
        u: ["Open ", { c: "Astrolabe" }],
      },
    });
    expect(result.catalog).toEqual({
      same: "Thread",
      b: "Astrolabe neu starten",
      own: "Wikis",
      u: [{ c: "Astrolabe" }, " öffnen"],
    });
    expect(result.carried).toEqual(["b", "u"]);
    expect(result.unmatched).toEqual(["own"]);
  });

  it("keeps remote-access sentences English and maps the bare name through the glossary", () => {
    const result = rekeyCatalog({
      locale: "de",
      upstreamEn: { s: "{org}'s policy does not allow T3 Connect.", n: "T3 Connect" },
      upstreamLocale: { s: "Die Richtlinie von {org} erlaubt T3 Connect nicht.", n: "T3 Connect" },
      currentEn: { s2: "{org}'s policy does not allow Remote access.", n2: "Remote access" },
      currentLocale: { s2: "{org}'s policy does not allow Remote access.", n2: "Remote access" },
    });
    expect(result.catalog).toEqual({
      s2: "{org}'s policy does not allow Remote access.",
      n2: "Fernzugriff",
    });
    expect(result.english).toEqual(["s2"]);
  });

  it("falls back to English when the translation does not spell the name", () => {
    const result = rekeyCatalog({
      locale: "ja",
      upstreamEn: { a: "Open T3 Code" },
      upstreamLocale: { a: "ティースリーコードを開く" },
      currentEn: { b: "Open Astrolabe" },
      currentLocale: { b: "Open Astrolabe" },
    });
    expect(result.catalog).toEqual({ b: "Open Astrolabe" });
    expect(result.english).toEqual(["b"]);
  });

  it("never overwrites a translation written by hand", () => {
    const result = rekeyCatalog({
      locale: "de",
      upstreamEn: { a: "T3 Code" },
      upstreamLocale: { a: "T3 Code" },
      currentEn: { b: "Astrolabe" },
      currentLocale: { b: "Astrolabium" },
    });
    expect(result.catalog).toEqual({ b: "Astrolabium" });
    expect(result.carried).toEqual([]);
  });

  it("pairs same-text entries by $context when given the key hasher", () => {
    const hashKey: KeyHasher = (text, context) => `${text}|${context ?? ""}`;
    const result = rekeyCatalog({
      locale: "de",
      upstreamEn: { "Open T3 Code|verb": "Open T3 Code", "Open T3 Code|state": "Open T3 Code" },
      upstreamLocale: {
        "Open T3 Code|verb": "T3 Code öffnen",
        "Open T3 Code|state": "T3 Code geöffnet",
      },
      currentEn: {
        "Open Astrolabe|state": "Open Astrolabe",
        "Open Astrolabe|verb": "Open Astrolabe",
      },
      currentLocale: {
        "Open Astrolabe|state": "Open Astrolabe",
        "Open Astrolabe|verb": "Open Astrolabe",
      },
      hashKey,
      contexts: ["verb", "state"],
    });
    expect(result.catalog).toEqual({
      "Open Astrolabe|state": "Astrolabe geöffnet",
      "Open Astrolabe|verb": "Astrolabe öffnen",
    });
  });

  it("pairs same-text entries by source order without a hasher, and reports a mismatch", () => {
    const paired = rekeyCatalog({
      locale: "de",
      upstreamEn: { u1: "Open T3 Code", u2: "Open T3 Code" },
      upstreamLocale: { u1: "T3 Code öffnen", u2: "T3 Code geöffnet" },
      currentEn: { c1: "Open Astrolabe", c2: "Open Astrolabe" },
      currentLocale: { c1: "Open Astrolabe", c2: "Open Astrolabe" },
    });
    expect(paired.catalog).toEqual({ c1: "Astrolabe öffnen", c2: "Astrolabe geöffnet" });

    const mismatched = rekeyCatalog({
      locale: "de",
      upstreamEn: { u1: "Open T3 Code", u2: "Open T3 Code" },
      upstreamLocale: { u1: "T3 Code öffnen", u2: "T3 Code geöffnet" },
      currentEn: { c1: "Open Astrolabe" },
      currentLocale: { c1: "Open Astrolabe" },
    });
    expect(mismatched.ambiguous).toEqual(["c1"]);
    expect(mismatched.catalog).toEqual({ c1: "Open Astrolabe" });
  });
});
