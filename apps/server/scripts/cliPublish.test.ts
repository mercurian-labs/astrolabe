import { assert, describe, it } from "@effect/vitest";

import {
  createPublishPackageJson,
  createVpPmPublishArgs,
  MERCURIAN_REPOSITORY_URL,
  type PublishPackageJson,
  THIRD_PARTY_NOTICES_FILE,
} from "./cliPublish.ts";

const sourcePackageJson: PublishPackageJson = {
  name: "t3",
  license: "MIT",
  repository: {
    type: "git",
    url: "https://github.com/pingdotgg/t3code",
    directory: "apps/server",
  },
  bin: {
    t3: "./dist/bin.mjs",
  },
  type: "module",
  version: "0.0.28",
  engines: {
    node: ">=22",
  },
  files: ["dist"],
  dependencies: {
    effect: "catalog:",
  },
  overrides: {},
};

describe("server CLI publish manifest", () => {
  it("preserves the upstream package identity when no publish overrides are supplied", () => {
    const manifest = createPublishPackageJson(sourcePackageJson, {
      version: "1.2.3",
      dependencies: {
        effect: "3.0.0",
      },
      overrides: {
        vite: "7.0.0",
      },
    });

    assert.equal(manifest.name, "t3");
    assert.deepEqual(manifest.bin, {
      t3: "./dist/bin.mjs",
    });
    assert.equal(manifest.repository.url, "https://github.com/pingdotgg/t3code");
    assert.equal(manifest.version, "1.2.3");
    assert.deepEqual(manifest.dependencies, {
      effect: "3.0.0",
    });
    assert.deepEqual(manifest.overrides, {
      vite: "7.0.0",
    });
  });

  it("applies the Mercurian name, bin, and repository only to the publish manifest", () => {
    const manifest = createPublishPackageJson(sourcePackageJson, {
      version: "1.2.3-nightly.20260729.42",
      dependencies: {
        effect: "3.0.0",
      },
      overrides: {},
      publishName: "@mercurian/astrolabe",
      publishBin: "astrolabe",
    });

    assert.equal(manifest.name, "@mercurian/astrolabe");
    assert.deepEqual(manifest.bin, {
      astrolabe: "./dist/bin.mjs",
    });
    assert.equal(manifest.repository.url, MERCURIAN_REPOSITORY_URL);
    assert.equal(sourcePackageJson.name, "t3");
    assert.deepEqual(sourcePackageJson.bin, {
      t3: "./dist/bin.mjs",
    });
  });

  it("carries the source license into the publish manifest with and without identity overrides", () => {
    const options = {
      version: "1.2.3",
      dependencies: {},
      overrides: {},
    };

    assert.equal(createPublishPackageJson(sourcePackageJson, options).license, "MIT");
    assert.equal(
      createPublishPackageJson(sourcePackageJson, {
        ...options,
        publishName: "@mercurian/astrolabe",
        publishBin: "astrolabe",
      }).license,
      "MIT",
    );
  });

  it("ships the generated third-party notices alongside dist, without duplicating the entry", () => {
    const options = {
      version: "1.2.3",
      dependencies: {},
      overrides: {},
    };

    assert.deepEqual(createPublishPackageJson(sourcePackageJson, options).files, [
      "dist",
      THIRD_PARTY_NOTICES_FILE,
    ]);
    assert.deepEqual(
      createPublishPackageJson(
        { ...sourcePackageJson, files: ["dist", THIRD_PARTY_NOTICES_FILE] },
        options,
      ).files,
      ["dist", THIRD_PARTY_NOTICES_FILE],
    );
  });

  it("rejects a publish bin override when the source exposes multiple bins", () => {
    assert.throws(
      () =>
        createPublishPackageJson(
          {
            ...sourcePackageJson,
            bin: {
              t3: "./dist/bin.mjs",
              "t3-admin": "./dist/admin.mjs",
            },
          },
          {
            version: "1.2.3",
            dependencies: {},
            overrides: {},
            publishBin: "astrolabe",
          },
        ),
      /expected exactly one source bin entry, found t3, t3-admin/,
    );
  });

  it("keeps dry-run publishing on the workspace package while forwarding npm options", () => {
    assert.deepEqual(
      createVpPmPublishArgs({
        access: "public",
        tag: "nightly",
        provenance: true,
        dryRun: true,
      }),
      [
        "publish",
        "--filter",
        "t3",
        "--access",
        "public",
        "--tag",
        "nightly",
        "--no-git-checks",
        "--provenance",
        "--dry-run",
      ],
    );
  });
});
