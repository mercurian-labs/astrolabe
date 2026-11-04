import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import type { ProjectWorktreeChange } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import { changedDirectories, type RawChange, WorkspaceWatcher, layer } from "./WorkspaceWatcher.ts";

const layerBase = GitVcsDriver.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "workspace-watcher-" })),
  Layer.provideMerge(NodeServices.layer),
);

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const repo = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "watched-repo-" }));
  const command = (args: ReadonlyArray<string>) =>
    git.execute({ operation: "workspace-watcher-test", cwd: repo, args });
  yield* command(["init", "-b", "main"]);
  yield* command(["config", "user.email", "watcher@example.test"]);
  yield* command(["config", "user.name", "Watcher test"]);
  yield* fs.writeFileString(`${repo}/tracked.txt`, "original\n");
  yield* fs.writeFileString(`${repo}/.gitignore`, "dist/\n");
  yield* fs.makeDirectory(`${repo}/dist`);
  yield* fs.writeFileString(`${repo}/dist/built.js`, "built\n");
  yield* command(["add", "."]);
  yield* command(["commit", "-m", "initial"]);

  const statusRefreshes = yield* Queue.unbounded<string>();
  const indexRefreshes = yield* Queue.unbounded<string>();
  const context = yield* Layer.build(layer).pipe(
    Effect.provideService(VcsStatusBroadcaster.VcsStatusBroadcaster, {
      refreshLocalStatus: (cwd: string) => Queue.offer(statusRefreshes, cwd),
    } as unknown as VcsStatusBroadcaster.VcsStatusBroadcaster["Service"]),
    Effect.provideService(WorkspaceEntries.WorkspaceEntries, {
      refresh: (cwd: string) => Queue.offer(indexRefreshes, cwd).pipe(Effect.asVoid),
    } as unknown as WorkspaceEntries.WorkspaceEntries["Service"]),
  );
  const watcher = Context.get(context, WorkspaceWatcher);
  return { fs, repo, command, watcher, statusRefreshes, indexRefreshes };
});

const named = (change: ProjectWorktreeChange) =>
  change._tag === "changed" ? (change.directories ?? []) : [];

describe("changedDirectories", () => {
  it.effect("names each folder whose listing changed, and gives up past the limit", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const changes: ReadonlyArray<RawChange> = [
        { type: "create", path: "/repo/src/new.ts" },
        { type: "delete", path: "/repo/old.txt" },
        { type: "update", path: "/repo/lib/edited.ts" },
        { type: "git" },
        { type: "create", path: "/elsewhere/file.txt" },
      ];
      expect(changedDirectories(path, "/repo", changes)).toEqual(["", "src"]);
      expect(changedDirectories(path, "/repo", changes, 1)).toBeNull();
      expect(changedDirectories(path, "/repo", [...changes, { type: "overflow" }])).toBeNull();
      expect(changedDirectories(path, "/repo", [{ type: "git" }])).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("WorkspaceWatcher", () => {
  it.live("reports changed folders, skips ignored ones, and refreshes status and search", () =>
    Effect.gen(function* () {
      const { fs, repo, watcher, statusRefreshes, indexRefreshes } = yield* fixture;
      const changes = yield* watcher.changes(repo);
      yield* fs.writeFileString(`${repo}/dist/rebuilt.js`, "ignored\n");
      yield* fs.makeDirectory(`${repo}/node_modules/dep`, { recursive: true });
      yield* fs.writeFileString(`${repo}/node_modules/dep/index.js`, "ignored\n");
      yield* fs.makeDirectory(`${repo}/src`);
      // inotify only watches a new folder once it hears of it: a file written sooner goes unseen.
      const before = yield* changes.pipe(
        Stream.takeUntil((change) => named(change).includes("")),
        Stream.runCollect,
      );
      yield* fs.writeFileString(`${repo}/src/new.ts`, "export {};\n");

      const after = yield* changes.pipe(
        Stream.takeUntil((change) => named(change).includes("src")),
        Stream.runCollect,
      );
      const seen = [...before, ...after].flatMap(named);
      expect(seen).toContain("");
      expect(seen.filter((folder) => /dist|node_modules/.test(folder))).toEqual([]);
      expect(yield* Queue.take(statusRefreshes)).toBe(repo);
      expect(yield* Queue.take(indexRefreshes)).toBe(repo);
    }).pipe(Effect.provide(layerBase), Effect.scoped),
  );

  it.live("reports a commit, which changes git's state and no folder", () =>
    Effect.gen(function* () {
      const { repo, command, watcher } = yield* fixture;
      const changes = yield* watcher.changes(repo);
      yield* command(["commit", "--allow-empty", "-m", "nothing but a commit"]);

      const reports = yield* changes.pipe(
        Stream.takeUntil((change) => change._tag === "changed" && change.directories?.length === 0),
        Stream.runCollect,
      );
      expect(reports.at(-1)).toEqual({ _tag: "changed", directories: [] });
    }).pipe(Effect.provide(layerBase), Effect.scoped),
  );

  it.live("says when a folder can't be watched", () =>
    Effect.gen(function* () {
      const { repo, watcher } = yield* fixture;
      const changes = yield* watcher.changes(`${repo}/missing`);
      const reports = yield* Stream.runCollect(changes);
      expect(reports).toHaveLength(1);
      expect(reports[0]?._tag).toBe("unwatched");
    }).pipe(Effect.provide(layerBase), Effect.scoped),
  );
});
