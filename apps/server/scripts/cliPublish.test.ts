import { assert, describe, it } from "@effect/vitest";

import {
  createPublishPackageJson,
  createVpPmPublishArgs,
  MERCURIAN_REPOSITORY_URL,
  type PublishPackageJson,
} from "./cliPublish.ts";

const sourcePackageJson: PublishPackageJson = {
  name: "t3",
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
