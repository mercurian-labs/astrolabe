import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";

import { checkSidecar, moduleSpecifiers, type Violation } from "./sidecar-check.ts";

const roots: Array<string> = [];

NodeTest.afterEach(() => {
  for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});

const git = (root: string, ...args: Array<string>): string =>
  NodeChildProcess.execFileSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "init.defaultBranch=main",
      ...args,
    ],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();

const write = (root: string, files: Record<string, string>) => {
  for (const [file, contents] of Object.entries(files)) {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(root, file)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(root, file), contents);
  }
};

const commit = (root: string, message: string, files: Record<string, string>): string => {
  write(root, files);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", message);
  return git(root, "rev-parse", "HEAD");
};

const config = (base: string) =>
  JSON.stringify({
    upstream: { repository: "unused", branch: "upstream", base },
    allowedChangesOutsideMercurian: ["AGENTS.md"],
    importableUpstreamPackages: ["@t3tools/contracts"],
  });

/** An upstream history, plus main carrying only the sidecar config on top of it. */
const setup = () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "sidecar-check-"));
  roots.push(root);
  git(root, "init", "-q");
  const base = commit(root, "upstream", {
    "AGENTS.md": "# T3 Code\n",
    "apps/web/package.json": JSON.stringify({ name: "@t3tools/web" }),
    "apps/web/src/index.ts": "export const web = 1;\n",
    "packages/contracts/package.json": JSON.stringify({ name: "@t3tools/contracts" }),
    "packages/shared/package.json": JSON.stringify({ name: "@t3tools/shared" }),
  });
  git(root, "branch", "upstream");
  commit(root, "sidecar", { "apps/mercurian/sidecar.json": config(base) });
  return { root, base };
};

const rules = (violations: ReadonlyArray<Violation>) => violations.map((v) => v.rule);
const files = (violations: ReadonlyArray<Violation>) => violations.map((v) => v.file);

NodeTest.describe("changed files", () => {
  NodeTest.it("passes Mercurian code, Mercurian docs, and allowed upstream edits", () => {
    const { root } = setup();
    commit(root, "ours", {
      "apps/mercurian/web/index.ts": "export const ours = 1;\n",
      "docs/mercurian/README.md": "# Mercurian\n",
      "AGENTS.md": "# Astrolabe\n\n# T3 Code\n",
    });
    NodeAssert.deepEqual(checkSidecar(root, "upstream"), []);
  });

  NodeTest.it("fails an edit to an upstream file and names it", () => {
    const { root } = setup();
    commit(root, "edit upstream", { "apps/web/src/index.ts": "export const web = 2;\n" });
    const violations = checkSidecar(root, "upstream");
    NodeAssert.deepEqual(rules(violations), ["upstream-edit"]);
    NodeAssert.deepEqual(files(violations), ["apps/web/src/index.ts"]);
  });

  NodeTest.it("fails a new file outside the Mercurian directories", () => {
    const { root } = setup();
    commit(root, "new upstream file", { "packages/ours/index.ts": "export {};\n" });
    NodeAssert.deepEqual(files(checkSidecar(root, "upstream")), ["packages/ours/index.ts"]);
  });
});

NodeTest.describe("imports", () => {
  NodeTest.it(
    "allows the contracts package, its subpaths, npm packages, and Mercurian's own files",
    () => {
      const { root } = setup();
      commit(root, "ours", {
        "apps/mercurian/web/index.ts": [
          'import { Thread } from "@t3tools/contracts";',
          'import type { Turn } from "@t3tools/contracts/orchestration";',
          'import * as Effect from "effect/Effect";',
          'import { helper } from "../shared/helper.ts";',
          'import * as NodeFS from "node:fs";',
        ].join("\n"),
        "apps/mercurian/shared/helper.ts": "export const helper = 1;\n",
        "apps/mercurian/web/package.json": JSON.stringify({
          name: "@mercurian/web",
          dependencies: { "@t3tools/contracts": "workspace:*", effect: "catalog:" },
        }),
      });
      NodeAssert.deepEqual(checkSidecar(root, "upstream"), []);
    },
  );

  NodeTest.it("fails every way code can reach upstream client code", () => {
    const { root } = setup();
    commit(root, "reach upstream", {
      "apps/mercurian/web/static.ts": 'import { web } from "@t3tools/web";\n',
      "apps/mercurian/web/reexport.ts": 'export * from "@t3tools/shared/Array";\n',
      "apps/mercurian/web/dynamic.ts": 'const shared = await import("@t3tools/shared");\n',
      "apps/mercurian/web/require.cjs": 'const web = require("@t3tools/web");\n',
      "apps/mercurian/web/relative.ts": 'import { web } from "../../web/src/index.ts";\n',
      "apps/mercurian/web/package.json": JSON.stringify({
        name: "@mercurian/web",
        devDependencies: { "@t3tools/shared": "workspace:*" },
      }),
      "apps/mercurian/web/tsconfig.json": [
        "{",
        "  // Aliases the upstream web source.",
        '  "compilerOptions": { "paths": { "~/*": ["../../web/src/*"], }, },',
        "}",
      ].join("\n"),
    });
    const violations = checkSidecar(root, "upstream");
    NodeAssert.deepEqual(new Set(rules(violations)), new Set(["upstream-import"]));
    NodeAssert.deepEqual(files(violations).toSorted(), [
      "apps/mercurian/web/dynamic.ts",
      "apps/mercurian/web/package.json",
      "apps/mercurian/web/reexport.ts",
      "apps/mercurian/web/relative.ts",
      "apps/mercurian/web/require.cjs",
      "apps/mercurian/web/static.ts",
      "apps/mercurian/web/tsconfig.json",
    ]);
  });

  NodeTest.it(
    "reads specifiers in code, never in comments, other strings, or property calls",
    () => {
      NodeAssert.deepEqual(
        moduleSpecifiers(
          [
            '// import { web } from "@t3tools/web";',
            '/* require("@t3tools/shared") */',
            'const url = "https://example.com"; import { a } from "./a.ts";',
            "const fixture = 'import { web } from \"@t3tools/web\";';",
            'const b = await import("./b.ts"), c = require("./c.cjs");',
            'const bytes = Buffer.from("not a module");',
          ].join("\n"),
        ),
        ["./a.ts", "./b.ts", "./c.cjs"],
      );
    },
  );
});

NodeTest.describe("history", () => {
  NodeTest.it("fails when upstream is merged into main", () => {
    const { root } = setup();
    git(root, "switch", "-q", "upstream");
    commit(root, "upstream moves on", { "apps/web/src/index.ts": "export const web = 3;\n" });
    git(root, "switch", "-q", "main");
    git(root, "merge", "-q", "--no-edit", "upstream");
    NodeAssert.ok(rules(checkSidecar(root, "upstream")).includes("history"));
  });

  NodeTest.it("fails when upstream history that shares no base is merged in", () => {
    const { root } = setup();
    git(root, "switch", "-q", "--orphan", "rewritten");
    commit(root, "force-pushed upstream", { "apps/web/src/index.ts": "export const web = 4;\n" });
    git(root, "switch", "-q", "main");
    git(
      root,
      "merge",
      "-q",
      "--no-edit",
      "--allow-unrelated-histories",
      "-X",
      "theirs",
      "rewritten",
    );
    const violations = checkSidecar(root);
    NodeAssert.ok(violations.some((v) => v.rule === "history" && v.message.includes("Merge")));
  });

  NodeTest.it(
    "passes after main moves onto newer upstream by rebase and records the new base",
    () => {
      const { root, base } = setup();
      git(root, "switch", "-q", "upstream");
      const newBase = commit(root, "upstream moves on", {
        "apps/web/src/index.ts": "export const web = 5;\n",
      });
      git(root, "switch", "-q", "main");
      git(root, "rebase", "-q", "--onto", "upstream", base, "main");
      commit(root, "record new base", { "apps/mercurian/sidecar.json": config(newBase) });
      NodeAssert.deepEqual(checkSidecar(root, "upstream"), []);
    },
  );

  NodeTest.it("fails after a rebase that forgot to record the new base", () => {
    const { root, base } = setup();
    git(root, "switch", "-q", "upstream");
    commit(root, "upstream moves on", { "apps/web/src/index.ts": "export const web = 6;\n" });
    git(root, "switch", "-q", "main");
    git(root, "rebase", "-q", "--onto", "upstream", base, "main");
    const violations = checkSidecar(root, "upstream");
    NodeAssert.ok(
      violations.some((v) => v.rule === "history" && v.message.includes("upstream commit")),
    );
  });

  NodeTest.it("fails when the recorded base is not in main's history", () => {
    const { root } = setup();
    git(root, "switch", "-q", "--orphan", "elsewhere");
    const stranger = commit(root, "unrelated", { "README.md": "elsewhere\n" });
    git(root, "switch", "-q", "main");
    commit(root, "wrong base", { "apps/mercurian/sidecar.json": config(stranger) });
    NodeAssert.deepEqual(rules(checkSidecar(root, "upstream")), ["history"]);
  });
});
