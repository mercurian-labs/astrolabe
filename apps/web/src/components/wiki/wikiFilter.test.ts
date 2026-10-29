import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_WIKI_FILTER,
  filterWikiKeys,
  parseWikiFilter,
  toggleFilterWiki,
  wikiFilterKeepsDocument,
} from "./wikiFilter";

const keys = ["a", "b", "c"];

describe("the wikis filter", () => {
  it("keeps the rest when one wiki is unticked under every wiki", () => {
    const next = toggleFilterWiki(EMPTY_WIKI_FILTER, "b", keys);
    expect(next.wikis).toEqual(["a", "c"]);
    expect(filterWikiKeys(next, keys)).toEqual(new Set(["a", "c"]));
  });

  it("reads ticking every wiki, or unticking the last, as every wiki", () => {
    const allButB = toggleFilterWiki(EMPTY_WIKI_FILTER, "b", keys);
    expect(toggleFilterWiki(allButB, "b", keys).wikis).toEqual([]);
    const onlyA = { ...EMPTY_WIKI_FILTER, wikis: ["a"] };
    expect(toggleFilterWiki(onlyA, "a", keys).wikis).toEqual([]);
  });

  it("picks several wikis, each toggling on its own", () => {
    const two = toggleFilterWiki({ ...EMPTY_WIKI_FILTER, wikis: ["a"] }, "c", keys);
    expect(filterWikiKeys(two, keys)).toEqual(new Set(["a", "c"]));
  });

  it("reads picks whose wikis are gone as every wiki", () => {
    expect(filterWikiKeys({ ...EMPTY_WIKI_FILTER, wikis: ["gone"] }, keys)).toBeNull();
    expect(filterWikiKeys({ ...EMPTY_WIKI_FILTER, wikis: ["gone", "b"] }, keys)).toEqual(
      new Set(["b"]),
    );
  });

  it("keeps a document by its wiki, and only with changes when asked", () => {
    const changed = { ...EMPTY_WIKI_FILTER, changed: true };
    const kept = new Set(["a"]);
    expect(wikiFilterKeepsDocument(changed, null, { wikiKey: "b", changes: [] })).toBe(false);
    expect(wikiFilterKeepsDocument(changed, null, { wikiKey: "b", changes: [{}] })).toBe(true);
    expect(wikiFilterKeepsDocument(EMPTY_WIKI_FILTER, kept, { wikiKey: "b", changes: [{}] })).toBe(
      false,
    );
  });

  it("reads storage back leniently", () => {
    expect(parseWikiFilter('{"wikis":["a",3],"changed":true}')).toEqual({
      wikis: ["a"],
      changed: true,
    });
    expect(parseWikiFilter('{"changed":"yes"}')).toEqual(EMPTY_WIKI_FILTER);
    expect(parseWikiFilter("nope")).toBeNull();
  });
});
