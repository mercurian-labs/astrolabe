import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { indexProject } from "@mercurian/wiki";
import { ProjectId, type ProjectRootCheckout, RootKey } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProjectRoots from "../workspace/ProjectRoots.ts";
import * as TurnDocsCheck from "./TurnDocsCheck.ts";
import * as WikiService from "./WikiService.ts";

const root = (key: string, kind: ProjectRootCheckout["kind"] = "tracked"): ProjectRootCheckout => ({
  key: RootKey.make(key),
  name: key,
  path: `/work/${key}`,
  kind,
  state: "git",
  hostBacked: false,
  checkout: `/work/${key}`,
  writable: true,
});

const FILES = {
  app: {
    "docs/Deploys.md": "# Deploys\n\nSee [[Release train]] and [[Rollbacks]].\n",
    "docs/Notes.md": "# Notes\n\nOur own [[Deploys]].\n",
  },
  handbook: {
    "Release train.md": "# Release train\n",
    "Projects.base": "views:\n  - type: table\n    columns: [x]\n",
  },
  ops: { "Release train.md": "# Release train\n", "Rollbacks.md": "# Rollbacks\n" },
};

const run = (changed: ReadonlyArray<{ readonly cwd: string; readonly file: string }>) => {
  const reads: string[] = [];
  const layer = TurnDocsCheck.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeServices.layer,
        Layer.mock(ProjectRoots.ProjectRoots)({
          forThread: () =>
            Effect.sync(() => {
              reads.push("roots");
              return [root("app", "workspace"), root("handbook"), root("ops")];
            }),
        }),
        Layer.mock(WikiService.WikiService)({
          projectIndex: (roots) =>
            Effect.succeed(
              indexProject(
                roots.map(({ key }) => [key, FILES[key as keyof typeof FILES]] as const),
              ),
            ),
        }),
      ),
    ),
  );
  return Effect.gen(function* () {
    const problems = yield* (yield* TurnDocsCheck.TurnDocsCheck).check({
      projectId: ProjectId.make("project-docs"),
      worktreePath: null,
      changed,
    });
    return { problems, reads };
  }).pipe(Effect.provide(layer));
};

it.effect("flags the bases and ambiguous links in the documents a turn changed", () =>
  Effect.gen(function* () {
    const { problems } = yield* run([
      { cwd: "/work/app", file: "docs/Deploys.md" },
      { cwd: "/work/app", file: "docs/Notes.md" },
      { cwd: "/work/app", file: "src/deploy.ts" },
      { cwd: "/work/handbook", file: "Projects.base" },
      // Deleted by the turn, so in no index.
      { cwd: "/work/handbook", file: "Gone.md" },
    ]);
    assert.deepEqual(problems, {
      bases: [
        {
          root: "handbook",
          file: "Projects.base",
          path: "/work/handbook/Projects.base",
          problems: ["views[0].columns is not a view key and is ignored; did you mean order?"],
        },
      ],
      links: [
        {
          root: "app",
          file: "docs/Deploys.md",
          path: "/work/app/docs/Deploys.md",
          target: "Release train",
          matches: ["handbook:Release train.md", "ops:Release train.md"],
        },
      ],
    });
    const message = TurnDocsCheck.turnDocsMessage(problems);
    assert.isTrue(
      message.startsWith(
        "Astrolabe checked the documents your last turn changed, and one base doesn't work as written and one link is ambiguous.",
      ),
    );
    assert.include(
      message,
      "docs/Deploys.md in app (/work/app/docs/Deploys.md):\n- [[Release train]] could open handbook:Release train.md or ops:Release train.md, so it opens none of them.",
    );
    assert.equal(TurnDocsCheck.turnDocsSummary(problems), "2 documents need fixing");
  }),
);

it.effect("reads nothing when the turn changed no document", () =>
  Effect.gen(function* () {
    const { problems, reads } = yield* run([{ cwd: "/work/app", file: "src/deploy.ts" }]);
    assert.deepEqual(problems, { bases: [], links: [] });
    assert.deepEqual(reads, []);
  }),
);
