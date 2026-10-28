import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_THREADS_FILTER,
  filterKindState,
  filterProjectGroupKeys,
  parseThreadsFilter,
  threadStatusFilterOf,
  toggleFilterKind,
  toggleFilterProject,
  toggleFilterStatus,
} from "./threadsFilter";

const repositories = ["r1", "r2", "r3"];
const groups = [
  { key: "r1", kind: "repositories" as const },
  { key: "r2", kind: "repositories" as const },
  { key: "w1", kind: "wikis" as const },
];

describe("the threads filter", () => {
  it("picks several projects, each toggling on its own", () => {
    const two = toggleFilterProject(
      toggleFilterProject(EMPTY_THREADS_FILTER, "r1", "repositories", repositories),
      "w1",
      "wikis",
      ["w1"],
    );
    expect(filterProjectGroupKeys(two, groups)).toEqual(new Set(["r1", "w1"]));
    const one = toggleFilterProject(two, "r1", "repositories", repositories);
    expect(filterProjectGroupKeys(one, groups)).toEqual(new Set(["w1"]));
  });

  it("turns a picked kind into its other projects when one of them is unpicked", () => {
    const kind = toggleFilterKind(EMPTY_THREADS_FILTER, "repositories", repositories);
    const next = toggleFilterProject(kind, "r2", "repositories", repositories);
    expect(next.kinds).toEqual([]);
    expect(next.projects).toEqual(["r1", "r3"]);
    expect(filterKindState(next, "repositories", repositories)).toBe("partial");
  });

  it("replaces a kind's single picks with the kind, and unpicking it clears them", () => {
    const picked = toggleFilterProject(EMPTY_THREADS_FILTER, "r1", "repositories", repositories);
    const kind = toggleFilterKind(picked, "repositories", repositories);
    expect(kind).toMatchObject({ kinds: ["repositories"], projects: [] });
    expect(toggleFilterKind(kind, "repositories", repositories)).toMatchObject({
      kinds: [],
      projects: [],
    });
  });

  it("reads picks whose projects are gone as every project", () => {
    const gone = toggleFilterProject(EMPTY_THREADS_FILTER, "gone", "repositories", repositories);
    expect(filterProjectGroupKeys(gone, groups)).toBeNull();
    const kept = toggleFilterProject(gone, "r2", "repositories", repositories);
    expect(filterProjectGroupKeys(kept, groups)).toEqual(new Set(["r2"]));
  });

  it("keeps an empty kind narrowing to nothing, as the single-pick filter did", () => {
    const wikis = toggleFilterKind(EMPTY_THREADS_FILTER, "wikis", []);
    expect(filterProjectGroupKeys(wikis, groups.slice(0, 2))).toEqual(new Set());
  });

  it("files each row status under the filter its dot reads as", () => {
    expect(
      (["approval", "input", "request", "working", "waiting", "failed", "limited"] as const).map(
        threadStatusFilterOf,
      ),
    ).toEqual(["needs-you", "needs-you", "needs-you", "working", "working", "errored", "errored"]);
    expect(threadStatusFilterOf("ready")).toBeNull();
  });

  it("reads storage back leniently, dropping what it no longer offers", () => {
    const stored = JSON.stringify(
      toggleFilterStatus({ ...EMPTY_THREADS_FILTER, kinds: ["wikis"] }, "needs-you"),
    );
    expect(parseThreadsFilter(stored)).toEqual({
      projects: [],
      kinds: ["wikis"],
      statuses: ["needs-you"],
    });
    expect(
      parseThreadsFilter('{"projects":["r1",4],"kinds":["teams"],"statuses":["asleep"]}'),
    ).toEqual({ projects: ["r1"], kinds: [], statuses: [] });
    expect(parseThreadsFilter("not json")).toBeNull();
  });
});
