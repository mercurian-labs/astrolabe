import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  collectInstalledPackages,
  generateThirdPartyNotices,
  ThirdPartyNoticesError,
  vendoredComponents,
} from "./generate-third-party-notices.ts";

const encodeJsonString = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const writeFixtureFile = Effect.fn("writeFixtureFile")(function* (
  filePath: string,
  contents: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });
  yield* fs.writeFileString(filePath, contents);
});

const writeManifestFixture = Effect.fn("writeManifestFixture")(function* (
  filePath: string,
  manifest: unknown,
) {
  yield* writeFixtureFile(filePath, yield* encodeJsonString(manifest));
});

/** Builds a miniature pnpm virtual store plus the vendored license files the generator requires. */
const writeWorkspaceFixture = Effect.fn("writeWorkspaceFixture")(function* (rootDir: string) {
  const path = yield* Path.Path;
  const store = path.join(rootDir, "node_modules", ".pnpm");

  yield* writeManifestFixture(
    path.join(store, "left@1.0.0", "node_modules", "left", "package.json"),
    { name: "left", version: "1.0.0", license: "MIT" },
  );
  yield* writeFixtureFile(
    path.join(store, "left@1.0.0", "node_modules", "left", "LICENSE"),
    "MIT License\n\nCopyright (c) 2026 Left Authors\n",
  );

  // The same package under a second peer-dependency variant, without the license file pnpm
  // materialized in the first: it must collapse to one entry that still carries the text.
  yield* writeManifestFixture(
    path.join(store, "left@1.0.0_peer@2.0.0", "node_modules", "left", "package.json"),
    { name: "left", version: "1.0.0", license: "MIT" },
  );

  // Scoped package declaring the legacy {type} license shape, with no license file at all.
  yield* writeManifestFixture(
    path.join(store, "@scope+right@2.0.0", "node_modules", "@scope", "right", "package.json"),
    { name: "@scope/right", version: "2.0.0", license: { type: "ISC" } },
  );

  // Workspace-local package: first-party, never a third-party notice.
  yield* writeManifestFixture(
    path.join(store, "@t3tools+shared@0.0.0", "node_modules", "@t3tools", "shared", "package.json"),
    { name: "@t3tools/shared", version: "0.0.0" },
  );

  for (const component of vendoredComponents) {
    yield* writeFixtureFile(
      path.join(rootDir, component.licensePath),
      `LICENSE TEXT FOR ${component.title}\n`,
    );
  }
});

it.layer(NodeServices.layer)("generate-third-party-notices", (it) => {
  it.effect("collects each installed package once and skips first-party workspace packages", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const rootDir = yield* fs.makeTempDirectoryScoped({
        prefix: "third-party-notices-collect-",
      });

      yield* writeWorkspaceFixture(rootDir);
      const entries = yield* collectInstalledPackages(rootDir);

      assert.deepStrictEqual(
        entries.map((entry) => `${entry.name}@${entry.version}`),
        ["@scope/right@2.0.0", "left@1.0.0"],
      );
      assert.equal(entries[0]?.license, "ISC");
      assert.equal(entries[0]?.licenseText, undefined);
      assert.equal(entries[1]?.license, "MIT");
      assert.match(entries[1]?.licenseText ?? "", /Copyright \(c\) 2026 Left Authors/);
    }),
  );

  it.effect("writes a notices file that leads with the vendored components", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const rootDir = yield* fs.makeTempDirectoryScoped({
        prefix: "third-party-notices-render-",
      });

      yield* writeWorkspaceFixture(rootDir);
      const result = yield* generateThirdPartyNotices("THIRD-PARTY-NOTICES.md", { rootDir });
      const rendered = yield* fs.readFileString(path.join(rootDir, "THIRD-PARTY-NOTICES.md"));

      assert.equal(result.packageCount, 2);

      // T3 Code leads the file, ahead of every dependency entry.
      const t3Index = rendered.indexOf("### T3 Code");
      const packagesIndex = rendered.indexOf("## Packages");
      assert.isAbove(t3Index, -1);
      assert.isBelow(t3Index, packagesIndex);

      for (const component of vendoredComponents) {
        assert.include(rendered, `LICENSE TEXT FOR ${component.title}`);
      }
      assert.include(rendered, "### left@1.0.0");
      assert.include(rendered, "### @scope/right@2.0.0");
      assert.notInclude(rendered, "@t3tools/shared@0.0.0");
    }),
  );

  it.effect("fails when a vendored license file is missing rather than shipping without it", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const rootDir = yield* fs.makeTempDirectoryScoped({
        prefix: "third-party-notices-missing-",
      });

      const error = yield* generateThirdPartyNotices("THIRD-PARTY-NOTICES.md", {
        rootDir,
      }).pipe(Effect.flip);

      assert.instanceOf(error, ThirdPartyNoticesError);
      assert.equal(error.operation, "read");
    }),
  );
});
