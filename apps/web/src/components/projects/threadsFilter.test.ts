import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_THREADS_FILTER,
  filterAsShown,
  filterHasProject,
  filterKindState,
  filterProjectGroupKeys,
  parseThreadsFilter,
  threadStatusFilterOf,
  toggleFilterPick,
  toggleFilterStatus,
  type ThreadsFilter,
} from "./threadsFilter";

const groups = [
  { key: "r1", kind: "repositories" as const },
  { key: "r2", kind: "repositories" as const },
  { key: "r3", kind: "repositories" as const },
  { key: "w1", kind: "wikis" as const },
];
const repositories = ["r1", "r2", "r3"];
const project = (filter: ThreadsFilter, key: string) =>
  toggleFilterPick(
    filter,
    { kind: "project", projectKind: key.startsWith("w") ? "wikis" : "repositories", key },
    groups,
  );
const kind = (filter: ThreadsFilter, projectKind: "repositories" | "wikis") =>
  toggleFilterPick(filter, { kind: "kind", projectKind }, groups);

describe("the threads filter", () => {
  it("picks several projects, each toggling on its own", () => {
    const two = project({ ...EMPTY_THREADS_FILTER, projects: ["r1"] }, "w1");
    expect(filterProjectGroupKeys(two, groups)).toEqual(new Set(["r1", "w1"]));
    expect(filterProjectGroupKeys(project(two, "r1"), groups)).toEqual(new Set(["w1"]));
  });

  it("shows every kind and project ticked under All projects", () => {
    const shown = filterAsShown(EMPTY_THREADS_FILTER, groups);
    expect(filterKindState(shown, "repositories", repositories)).toBe("checked");
    expect(filterKindState(shown, "wikis", ["w1"])).toBe("checked");
    expect(filterHasProject(shown, "r2", "repositories")).toBe(true);
  });

  it("keeps the rest when one project is unticked under All projects", () => {
    const next = project(EMPTY_THREADS_FILTER, "r2");
    expect(filterProjectGroupKeys(next, groups)).toEqual(new Set(["r1", "r3", "w1"]));
    expect(next).toMatchObject({ kinds: ["wikis"], projects: ["r1", "r3"] });
  });

  it("keeps the other kind when a kind is unticked under All projects", () => {
    expect(kind(EMPTY_THREADS_FILTER, "repositories")).toMatchObject({
      kinds: ["wikis"],
      projects: [],
    });
  });

  it("reads ticking every project, or unticking the last, as All projects", () => {
    const allButR2 = project(EMPTY_THREADS_FILTER, "r2");
    expect(project(allButR2, "r2")).toMatchObject({ kinds: [], projects: [] });
    const onlyR1 = project(project(project(kind(EMPTY_THREADS_FILTER, "wikis"), "r2"), "r3"), "r1");
    expect(onlyR1).toMatchObject({ kinds: [], projects: [] });
  });

  it("turns a picked kind into its other projects when one of them is unpicked", () => {
    const repos = kind(EMPTY_THREADS_FILTER, "wikis");
    expect(repos).toMatchObject({ kinds: ["repositories"], projects: [] });
    const next = project(repos, "r2");
    expect(next).toMatchObject({ kinds: [], projects: ["r1", "r3"] });
    expect(filterKindState(next, "repositories", repositories)).toBe("partial");
  });

  it("replaces a kind's single picks with the kind, and unpicking it clears them", () => {
    const withKind = kind({ ...EMPTY_THREADS_FILTER, projects: ["r1"] }, "repositories");
    expect(withKind).toMatchObject({ kinds: ["repositories"], projects: [] });
    expect(kind(withKind, "repositories")).toMatchObject({ kinds: [], projects: [] });
  });

  it("reads picks whose projects are gone as every project", () => {
    const gone = { ...EMPTY_THREADS_FILTER, projects: ["gone"] };
    expect(filterProjectGroupKeys(gone, groups)).toBeNull();
    expect(filterProjectGroupKeys({ ...gone, projects: ["gone", "r2"] }, groups)).toEqual(
      new Set(["r2"]),
    );
  });

  it("keeps an empty kind narrowing to nothing, as the single-pick filter did", () => {
    const wikis = { ...EMPTY_THREADS_FILTER, kinds: ["wikis" as const] };
    expect(filterProjectGroupKeys(wikis, groups.slice(0, 3))).toEqual(new Set());
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
