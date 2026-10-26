// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalConsole:off - A one-shot build-time script, run by hand.

/**
 * The Rust helpers ship as binaries inside the desktop app and the CLI archive, so the licenses of
 * the crates compiled into them ship too: as `THIRD-PARTY-NOTICES.txt` beside each helper's
 * Cargo.toml, which `third-party-licenses.config.json` adds to every build's notices list.
 *
 * Run `vp run licenses:native` after changing a helper's Cargo.lock.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const HELPERS = ["resource-monitor", "hyprland-snap-shot", "kde-snap-shot"];
const NOTICE_FILE = /^(?:licen[cs]e|copying|notice|unlicense)(?:[-._].*)?$/i;

interface CargoPackage {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly license: string | null;
  readonly repository: string | null;
  readonly manifest_path: string;
}
interface CargoMetadata {
  readonly packages: ReadonlyArray<CargoPackage>;
  readonly workspace_members: ReadonlyArray<string>;
  readonly resolve: {
    readonly nodes: ReadonlyArray<{
      readonly id: string;
      readonly deps: ReadonlyArray<{
        readonly pkg: string;
        readonly dep_kinds: ReadonlyArray<{ readonly kind: string | null }>;
      }>;
    }>;
  };
}

function shippedPackages(metadata: CargoMetadata): ReadonlyArray<CargoPackage> {
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const queue = [...metadata.workspace_members];
  while (queue.length > 0) {
    const id = queue.pop()!;
    for (const dep of nodes.get(id)?.deps ?? []) {
      // Dev-dependencies build only the helper's tests.
      if (dep.dep_kinds.every((kind) => kind.kind === "dev") || seen.has(dep.pkg)) continue;
      seen.add(dep.pkg);
      queue.push(dep.pkg);
    }
  }
  return metadata.packages
    .filter((pkg) => seen.has(pkg.id) && !metadata.workspace_members.includes(pkg.id))
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

// A crate that publishes no license file is covered by its declared license, whose standard text
// follows the crates. From an "A OR B" choice (old crates write "A/B") we take MIT, else the first.
function electedLicenses(expression: string): ReadonlyArray<string> {
  const choices = expression
    .split(/\s+OR\s+|\//)
    .map((choice) => choice.replace(/[()]/g, "").trim());
  const elected = choices.find((choice) => choice === "MIT") ?? choices[0]!;
  return elected.split(/\s+AND\s+/).map((id) => id.trim());
}

// Dual-licensed crates often ship one file per license (LICENSE-MIT, LICENSE-APACHE); keep the
// elected license's file and any NOTICE, and every file when none names the elected license.
const LICENSE_FILE_HINTS: Record<string, RegExp> = {
  MIT: /mit/i,
  "Apache-2.0": /apache/i,
  Zlib: /zlib/i,
  Unlicense: /unlicense/i,
};
function electedFiles(
  files: ReadonlyArray<string>,
  elected: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const hints = elected.flatMap((id) => LICENSE_FILE_HINTS[id] ?? []);
  const named = files.filter((file) => hints.some((hint) => hint.test(file)));
  if (hints.length !== elected.length || named.length === 0) return files;
  return files.filter((file) => named.includes(file) || /notice/i.test(file));
}

async function spdxText(id: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/spdx/license-list-data/main/text/${id}.txt`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${String(response.status)}.`);
  return (await response.text()).trim();
}

for (const helper of HELPERS) {
  const dir = NodePath.resolve(import.meta.dirname, "../native", helper);
  const metadata = JSON.parse(
    NodeChildProcess.execFileSync("cargo", ["metadata", "--format-version", "1", "--locked"], {
      cwd: dir,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }),
  ) as CargoMetadata;
  const standardLicenses = new Set<string>();
  const sections = shippedPackages(metadata).map((pkg) => {
    const crateDir = NodePath.dirname(pkg.manifest_path);
    const elected = pkg.license ? electedLicenses(pkg.license) : [];
    const files = electedFiles(
      NodeFS.readdirSync(crateDir)
        .filter((file) => NOTICE_FILE.test(file))
        .toSorted(),
      elected,
    );
    const title = `${pkg.name} ${pkg.version} (${pkg.license ?? "no declared license"})`;
    if (files.length === 0) {
      if (!pkg.license) throw new Error(`${pkg.name}@${pkg.version} declares no license.`);
      for (const id of elected) standardLicenses.add(id);
      return `${title}\n\nThe published crate includes no license file. Used under ${elected.join(" AND ")}; its text follows the crates.${pkg.repository ? ` Source: ${pkg.repository}` : ""}`;
    }
    const texts = files.map((file) =>
      NodeFS.readFileSync(NodePath.join(crateDir, file), "utf8").trim(),
    );
    return [title, ...texts].join("\n\n");
  });
  for (const id of [...standardLicenses].toSorted()) {
    sections.push(`${id}\n\n${await spdxText(id)}`);
  }
  const header = `Crates compiled into Astrolabe's ${helper} helper, and their licenses.\nGenerated by scripts/sync-native-license-notices.ts.`;
  NodeFS.writeFileSync(
    NodePath.join(dir, "THIRD-PARTY-NOTICES.txt"),
    `${[header, ...sections].join(`\n\n${"-".repeat(72)}\n\n`)}\n`,
  );
  console.log(
    `[native-licenses] ${helper}: ${String(sections.length - standardLicenses.size)} crates`,
  );
}
