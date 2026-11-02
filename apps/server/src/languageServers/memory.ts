import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

/** Resident memory of each process and everything it started, in bytes. */
export type MemoryReader = (
  pids: ReadonlyArray<number>,
) => Effect.Effect<ReadonlyMap<number, number>>;

/** `ps` on macOS and Linux; Windows reports nothing, so the budget never stops a server there. */
export const makeMemoryReader = Effect.fn("LanguageServers.makeMemoryReader")(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const platform = yield* HostProcess.Platform;
  const read: MemoryReader = (pids) => {
    if (platform === "win32" || pids.length === 0) return Effect.succeed(new Map());
    return Effect.scoped(
      Effect.gen(function* () {
        const child = yield* spawner.spawn(
          ChildProcess.make("ps", ["-A", "-o", "pid=,ppid=,rss="], { stdin: "ignore" }),
        );
        const output = yield* child.stdout.pipe(Stream.decodeText(), Stream.mkString);
        const children = new Map<number, Array<number>>();
        const rss = new Map<number, number>();
        for (const line of output.split("\n")) {
          const [pid, ppid, kilobytes] = line.trim().split(/\s+/).map(Number);
          if (pid === undefined || ppid === undefined || kilobytes === undefined) continue;
          if (Number.isNaN(pid) || Number.isNaN(ppid) || Number.isNaN(kilobytes)) continue;
          rss.set(pid, kilobytes * 1024);
          children.set(ppid, [...(children.get(ppid) ?? []), pid]);
        }
        const tree = (pid: number, seen: Set<number>): number => {
          if (seen.has(pid)) return 0;
          seen.add(pid);
          return (
            (rss.get(pid) ?? 0) +
            (children.get(pid) ?? []).reduce((sum, child) => sum + tree(child, seen), 0)
          );
        };
        return new Map(pids.map((pid) => [pid, tree(pid, new Set())] as const));
      }),
    ).pipe(Effect.orElseSucceed(() => new Map<number, number>()));
  };
  return read;
});
