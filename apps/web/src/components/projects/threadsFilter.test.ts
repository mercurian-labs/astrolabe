import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_THREADS_FILTER,
  filterHasProject,
  filterProjectGroupKeys,
  parseThreadsFilter,
  threadStatusFilterOf,
  toggleFilterProject,
  toggleFilterStatus,
  type ThreadsFilter,
} from "./threadsFilter";

const groupKeys = ["r1", "r2", "r3"];
const project = (filter: ThreadsFilter, key: string) => toggleFilterProject(filter, key, groupKeys);

describe("the threads filter", () => {
  it("picks several projects, each toggling on its own", () => {
    const two = project({ ...EMPTY_THREADS_FILTER, projects: ["r1"] }, "r3");
    expect(filterProjectGroupKeys(two, groupKeys)).toEqual(new Set(["r1", "r3"]));
    expect(filterProjectGroupKeys(project(two, "r1"), groupKeys)).toEqual(new Set(["r3"]));
  });

  it("shows every project ticked under All projects", () => {
    expect(groupKeys.every((key) => filterHasProject(EMPTY_THREADS_FILTER, key, groupKeys))).toBe(
      true,
    );
  });

  it("keeps the rest when one project is unticked under All projects", () => {
    const next = project(EMPTY_THREADS_FILTER, "r2");
    expect(next.projects).toEqual(["r1", "r3"]);
    expect(filterHasProject(next, "r2", groupKeys)).toBe(false);
  });

  it("reads ticking every project, or unticking the last, as All projects", () => {
    const allButR2 = project(EMPTY_THREADS_FILTER, "r2");
    expect(project(allButR2, "r2").projects).toEqual([]);
    const onlyR1 = { ...EMPTY_THREADS_FILTER, projects: ["r1"] };
    expect(project(onlyR1, "r1").projects).toEqual([]);
  });

  it("reads picks whose projects are gone as every project", () => {
    const gone = { ...EMPTY_THREADS_FILTER, projects: ["gone"] };
    expect(filterProjectGroupKeys(gone, groupKeys)).toBeNull();
    expect(filterProjectGroupKeys({ ...gone, projects: ["gone", "r2"] }, groupKeys)).toEqual(
      new Set(["r2"]),
    );
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
      toggleFilterStatus({ ...EMPTY_THREADS_FILTER, projects: ["r1"] }, "needs-you"),
    );
    expect(parseThreadsFilter(stored)).toEqual({ projects: ["r1"], statuses: ["needs-you"] });
    expect(
      parseThreadsFilter('{"projects":["r1",4],"kinds":["wikis"],"statuses":["asleep"]}'),
    ).toEqual({ projects: ["r1"], statuses: [] });
    expect(parseThreadsFilter("not json")).toBeNull();
  });
});
